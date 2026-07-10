//! The end-to-end voice loop: STT transcripts → [`intent::Router`] → metronome +
//! spoken confirmation, with the half-duplex gate proving itself on every reply.
//!
//! # Data flow
//!
//! ```text
//!   hear ──▶ SttSupervisor ──(SttEvent)──▶ on_event closure
//!                                              │  emits voice://transcript / voice://status
//!                                              │  forwards FINAL transcripts ▼
//!                                        mpsc::Sender<Transcript>
//!                                              ▼
//!                                        action thread ── Router::route ──▶ act
//!                                              │  metro.do_start/do_stop/do_set (direct, sync)
//!                                              │  Speaker::speak_blocking (gate cycle)
//!                                              ▼  emits voice://intent + metro://state
//! ```
//!
//! The STT reader/settler threads must never block (their sink is called on the
//! settler thread), so the `on_event` closure only *forwards* finals over a
//! channel and does the (blocking) TTS + metronome work on a dedicated **action
//! thread**. That thread speaks with [`Speaker::speak_blocking`] so each utterance
//! fully completes its gate cycle — close → play → drain → 300 ms tail → reopen —
//! before the next command is acted on. That serialization also means a
//! voice-initiated `do_start`/`do_set` never observes `!pcm_done()` from our *own*
//! previous confirmation, so we never self-inflict a Busy.
//!
//! # The EngineHandle handoff (the careful part)
//!
//! The Speaker plays through the metronome's audio engine, but that `EngineHandle`
//! is replaced on a sound-change restart and dropped on stop. So the Speaker's
//! [`PcmSink`] is [`MetroSink`], which forwards each chunk to
//! [`Metronome::tts_enqueue`]/[`Metronome::tts_done`] — reaching the *current*
//! handle under the metronome's own lock every time (see those methods). The Busy
//! guard in the metronome refuses a restart while speech is buffered, so a restart
//! can never race an in-flight utterance. Because a stop drops the engine, a stop
//! confirmation ("Stopped.") is spoken BEFORE `do_stop`, while the engine is still
//! alive to play it.
//!
//! # Mute
//!
//! [`VoiceLoop::set_muted`] both closes the STT gate (lines dropped at the reader)
//! and flips a `muted` flag the action thread checks, so a stray transcript that
//! slips through a TTS-reopened gate is still never actioned while muted.
//!
//! # Spurious-final dedup (ONE unified rule)
//!
//! ## Dedup policy (Task 13 fix round 2 — empirically grounded)
//!
//! The Task 13 live run proved the STT engine RE-SENDS the final hypothesis
//! 0.5–2.3 s after an utterance (measured: one spoken "done" produced identical
//! `Done` lines at t=5.441, 5.939, 7.838). Those re-sends are byte-identical to
//! the original and indistinguishable from a very fast human repeat. The old
//! policy — which excluded rep checks and relative deltas from dedup — therefore
//! DOUBLE-FIRED those intents in production (a re-sent "faster" bumped the tempo
//! twice, a re-sent "done" cleared two reps for one).
//!
//! The fix is ONE rule applied to EVERY intent (including [`Intent::RepCheck`]
//! and relative-delta [`Intent::MetroSet`]): an identical normalized transcript
//! within a [`DEDUP_WINDOW`] (2.5 s) of the previous occurrence of the same text
//! is suppressed. The window is keyed on the transcript's OWN emit timestamp
//! ([`Transcript::at`], stamped by the settler), never on `Instant::now()`
//! re-sampled at processing time — a prior [`Speaker::speak_blocking`] can block
//! the action thread for the full gate cycle (synth + playback + 300 ms tail),
//! so an `Instant::now()` re-sample would already have overrun the window and let
//! the genuine duplicate through. The stored timestamp SLIDES forward on every
//! matching occurrence, so a chain of re-sends (each < 2.5 s from the last) is
//! fully collapsed even when the first and last are > 2.5 s apart.
//!
//! Why 2.5 s is safe for reps and deltas too: a *genuine* rep is separated by
//! actually playing the passage (≫ 2.5 s), and a *genuine* repeated delta is
//! separated by hearing the spoken confirmation (≈ 1.5 s of speech + the 300 ms
//! reopen tail, but typically the user waits to hear the new tempo before asking
//! again). The one accepted tradeoff: a deliberate identical delta ("faster" then
//! "faster") repeated in under 2.5 s is lost — judged far cheaper than a
//! phantom double-bump on every single spoken command.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::audio::PcmError;
use crate::intent::{Intent, MetroSetArgs, Mode, Router, Verdict};
use crate::metronome::{MetroState, Metronome};
use crate::stt::{DownReason, SttConfig, SttEvent, SttHandle, SttSupervisor, Transcript};
use crate::store::Store;
use crate::tts::{Gate, PcmSink, Speaker, SpeakerConfig};

/// How long an identical final is treated as a spurious repeat. Sized to cover
/// the STT engine's measured re-send latency (0.5–2.3 s) with margin, while
/// staying below the gap that separates genuine repeated commands. Applies to
/// ALL intents (see the module docs, "Dedup policy").
const DEDUP_WINDOW: Duration = Duration::from_millis(2500);

// ---------------------------------------------------------------------------
// Seams: emit + speak, abstracted so the action logic is unit-testable without a
// Tauri app handle or a real audio device.
// ---------------------------------------------------------------------------

/// Sink for the app-facing `voice://*` and `metro://state` events.
pub trait VoiceEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

struct TauriEmitter(AppHandle);
impl VoiceEmitter for TauriEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Err(e) = self.0.emit(event, payload) {
            eprintln!("voice: failed to emit {event}: {e}");
        }
    }
}

/// Blocking speech confirmation. The concrete impl is [`Speaker`]; tests record
/// calls. Blocking so the gate cycle completes before the next command acts.
trait Confirm: Send {
    fn say(&self, text: &str);
}
impl Confirm for Speaker {
    fn say(&self, text: &str) {
        let _ = self.speak_blocking(text.to_string());
    }
}

// ---------------------------------------------------------------------------
// Speaker <-> engine + gate seams.
// ---------------------------------------------------------------------------

/// [`PcmSink`] that plays through the metronome's current engine handle. See the
/// module docs / [`Metronome::tts_enqueue`] for why it must not capture a handle.
struct MetroSink(Arc<Metronome>);
impl PcmSink for MetroSink {
    fn enqueue(&self, samples: &[f32], src_rate: u32) -> Result<(), PcmError> {
        self.0.tts_enqueue(samples, src_rate)
    }
    fn done(&self) -> bool {
        self.0.tts_done()
    }
}

/// [`Gate`] over the shared STT gate atom (see [`SttHandle::gate_flag`]). A
/// `Send + Sync` seam so the Speaker can mute the mic without holding the
/// non-`Sync` `SttHandle`.
///
/// # Mute hardening (Task 13 fix round 1)
///
/// [`ReopenGuard`](crate::tts) always calls `set_gate(true)` once an utterance's
/// gate cycle completes — including one that was in flight when the user muted.
/// Without a check here, that reopen would silently un-mute the mic: mute is
/// still active, but the gate is open again. `AtomicGate` therefore also holds
/// the `muted` flag and refuses to open the gate while muted (closing is always
/// honored). `VoiceLoop::set_muted(false)` reopens the gate directly (not
/// through this seam), so unmuting still works immediately.
struct AtomicGate {
    gate: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
}
impl Gate for AtomicGate {
    fn set_gate(&self, open: bool) {
        if open && self.muted.load(Ordering::Acquire) {
            // Mute wins: don't let a completing utterance's reopen re-arm the
            // mic while the user has it muted.
            return;
        }
        self.gate.store(open, Ordering::Release);
    }
}

// ---------------------------------------------------------------------------
// Action thread.
// ---------------------------------------------------------------------------

struct ActionCtx {
    metro: Arc<Metronome>,
    store: Arc<Store>,
    speaker: Box<dyn Confirm>,
    emitter: Arc<dyn VoiceEmitter>,
    wake_word: Option<String>,
    rep_active: bool,
    muted: Arc<AtomicBool>,
    last: Option<(String, Instant)>,
}

impl ActionCtx {
    fn handle_final(&mut self, t: &Transcript) {
        if self.muted.load(Ordering::Acquire) {
            return;
        }
        let mode = Mode {
            rep_block_active: self.rep_active,
            wake_word: self.wake_word.clone(),
            metro_running: self.metro.snapshot().running,
        };
        let intent = Router::route(&t.text, &mode);
        if matches!(intent, Intent::Ignored) {
            return; // ambient speech: no event, no action
        }

        // Spurious-final dedup — ONE rule for EVERY intent (see the module docs,
        // "Dedup policy"). The STT engine re-sends an identical final 0.5–2.3 s
        // after an utterance, so an identical normalized transcript within
        // DEDUP_WINDOW of the previous occurrence of the same text is a re-send,
        // not a genuine repeat, and is dropped — reps and deltas included. Keyed
        // on `t.at` (the settler's own emit timestamp), NOT `Instant::now()`
        // sampled here: a prior blocking speak may already have eaten the whole
        // window, which would make a stale re-sample never catch the duplicate.
        // The stored timestamp slides forward on every match so a chain of
        // re-sends (each < window from the last) collapses fully.
        let norm: String = t
            .text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let suppress = self
            .last
            .as_ref()
            .is_some_and(|(prev, at)| *prev == norm && t.at.saturating_duration_since(*at) < DEDUP_WINDOW);
        self.last = Some((norm, t.at));
        if suppress {
            return;
        }

        match intent {
            Intent::MetroStart(bpm) => self.act_start(bpm, &t.text),
            Intent::MetroStop => self.act_stop(&t.text),
            Intent::MetroSet(args) => self.act_set(args, &t.text),
            Intent::RepCheck(v, _) => self.act_rep(v, &t.text),
            Intent::Question(q) => {
                self.emit_intent("question", &q, None);
            }
            Intent::Ignored => {}
        }
    }

    fn act_start(&self, bpm: Option<f64>, text: &str) {
        let running = self.metro.snapshot().running;
        let (state, res) = match bpm {
            // A tempo change on an already-running metronome is a smooth live set,
            // not a full engine restart.
            Some(b) if running => self.set_bpm_only(b),
            Some(b) => self.metro.do_start(Some(b)),
            None => self.metro.do_start(None),
        };
        self.emit_state(&state);
        match res {
            Ok(()) => {
                self.emit_intent("start", text, Some(state.bpm));
                self.speaker.say(&bpm_to_speech(state.bpm));
            }
            Err(e) => self.speak_error(&e, text),
        }
    }

    fn act_stop(&self, text: &str) {
        // Speak BEFORE stopping: the engine must still be alive to play the
        // confirmation (stop drops it). See the module docs.
        self.speaker.say("Stopped.");
        let state = self.metro.do_stop();
        self.emit_state(&state);
        self.emit_intent("stop", text, None);
    }

    fn act_set(&self, args: MetroSetArgs, text: &str) {
        let snap = self.metro.snapshot();
        let (state, res, spoken, bpm_for_evt, kind) = if let Some(d) = args.bpm_delta {
            let nb = (snap.bpm + d).clamp(1.0, 1000.0);
            let (s, r) = self.set_bpm_only(nb);
            (s, r, bpm_to_speech(nb), Some(nb), "set")
        } else if let Some(v) = args.bpm_abs {
            let (s, r) = self.set_bpm_only(v);
            (s, r, bpm_to_speech(v), Some(v), "set")
        } else if let Some(bp) = args.beats_per_bar {
            let (s, r) = self.metro.do_set(
                &self.store,
                None,
                Some(bp),
                None,
                Some(true),
                None,
                None,
                None,
            );
            // "accent", not "set" — this is a beats-per-bar/accent change, not a
            // tempo change, and the UI toast label should say so instead of
            // mislabeling it "Tempo set".
            (s, r, format!("Accent every {}.", cardinal(bp as i64)), None, "accent")
        } else {
            return;
        };
        self.emit_state(&state);
        match res {
            Ok(()) => {
                self.emit_intent(kind, text, bpm_for_evt);
                self.speaker.say(&spoken);
            }
            Err(e) => self.speak_error(&e, text),
        }
    }

    fn act_rep(&self, v: Verdict, text: &str) {
        // P3 consumes rep verdicts; for now acknowledge minimally so the gate still
        // proves itself and the UI sees the intent.
        self.emit_intent(
            match v {
                Verdict::Pass => "rep_pass",
                Verdict::Fail => "rep_fail",
            },
            text,
            None,
        );
        self.speaker.say(match v {
            Verdict::Pass => "Got it.",
            Verdict::Fail => "Again.",
        });
    }

    /// Change only the tempo of a running (or stored) metronome via `do_set`.
    fn set_bpm_only(&self, bpm: f64) -> (MetroState, Result<(), String>) {
        self.metro
            .do_set(&self.store, Some(bpm), None, None, None, None, None, None)
    }

    /// A metronome command rejected. A Busy ("speech playing") gets a spoken
    /// nudge; other errors are logged (speaking the raw error would be gibberish).
    fn speak_error(&self, err: &str, text: &str) {
        if err.contains("busy") {
            self.emit_intent("busy", text, None);
            self.speaker.say("Busy — try again.");
        } else {
            eprintln!("voice: metronome command failed: {err}");
        }
    }

    fn emit_state(&self, state: &MetroState) {
        if let Ok(v) = serde_json::to_value(state) {
            self.emitter.emit("metro://state", v);
        }
    }

    fn emit_intent(&self, kind: &str, text: &str, bpm: Option<f64>) {
        self.emitter
            .emit("voice://intent", json!({ "kind": kind, "text": text, "bpm": bpm }));
    }
}

/// Spoken form of a BPM, e.g. `96.0` → `"Ninety-six."`. ≤5 words for any tempo in
/// the 1–1000 range.
fn bpm_to_speech(bpm: f64) -> String {
    let mut s = cardinal(bpm.round() as i64);
    if let Some(first) = s.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    s.push('.');
    s
}

/// English cardinal for 0..=1000 (the metronome's clamp range).
fn cardinal(n: i64) -> String {
    const ONES: [&str; 20] = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
        "nineteen",
    ];
    const TENS: [&str; 10] = [
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    ];
    if n < 0 {
        return format!("minus {}", cardinal(-n));
    }
    if n < 20 {
        return ONES[n as usize].to_string();
    }
    if n < 100 {
        let t = TENS[(n / 10) as usize];
        let o = n % 10;
        return if o == 0 {
            t.to_string()
        } else {
            format!("{t}-{}", ONES[o as usize])
        };
    }
    if n < 1000 {
        let h = n / 100;
        let rest = n % 100;
        return if rest == 0 {
            format!("{} hundred", ONES[h as usize])
        } else {
            format!("{} hundred {}", ONES[h as usize], cardinal(rest))
        };
    }
    "one thousand".to_string()
}

// ---------------------------------------------------------------------------
// The managed voice loop.
// ---------------------------------------------------------------------------

/// Snapshot of the mic status for `voice_state()` and the top-bar glyph.
#[derive(Clone, serde::Serialize)]
pub struct VoiceStatus {
    /// The user muted the mic.
    pub muted: bool,
    /// A non-recoverable STT down reason, if any ("dictation-disabled",
    /// "restart-storm").
    pub down: Option<String>,
}

/// Owns the STT supervisor, the TTS speaker (inside the action thread), and the
/// action thread. Managed by Tauri; [`Self::shutdown`] tears everything down with
/// no zombie processes or hung joins.
pub struct VoiceLoop {
    stt: Mutex<Option<SttHandle>>,
    action_tx: Mutex<Option<mpsc::Sender<Transcript>>>,
    action_thread: Mutex<Option<JoinHandle<()>>>,
    gate: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    status: Arc<Mutex<VoiceStatus>>,
    emitter: Arc<dyn VoiceEmitter>,
}

impl VoiceLoop {
    /// Wire and start the whole pipeline. `stt_config` selects the `hear` binary
    /// (or a fake, via the config seam). `wake_word` gates all commands when set.
    pub fn start(
        app: &AppHandle,
        metro: Arc<Metronome>,
        store: Arc<Store>,
        stt_config: SttConfig,
        wake_word: Option<String>,
    ) -> Arc<VoiceLoop> {
        let emitter: Arc<dyn VoiceEmitter> = Arc::new(TauriEmitter(app.clone()));
        Self::start_with(emitter, metro, store, stt_config, wake_word, |m, g, mu| {
            Self::build_speaker(m, g, mu)
        })
    }

    /// Build the production TTS speaker (provider chosen from settings) plugged
    /// into the metronome engine + STT gate.
    ///
    /// This blocks: [`crate::tts::select_provider`] calls `network_available()`
    /// (up to a 1.5 s TCP-connect timeout) plus a Keychain lookup that can spawn
    /// a subprocess and, on some machines, prompt the user. See [`Self::start_with`]
    /// for why this must never run on the caller's thread.
    fn build_speaker(
        metro: Arc<Metronome>,
        gate: Arc<AtomicBool>,
        muted: Arc<AtomicBool>,
    ) -> Box<dyn Confirm> {
        let provider = crate::tts::select_provider(None, None, None);
        let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(metro));
        let gate_seam: Arc<dyn Gate> = Arc::new(AtomicGate { gate, muted });
        Box::new(Speaker::spawn(
            provider,
            sink,
            gate_seam,
            SpeakerConfig::default(),
        ))
    }

    /// Core wiring, parameterized over the emitter and a speaker factory so tests
    /// can inject fakes and avoid the audio device / network.
    ///
    /// # Async speaker init (Task 13 fix round 1)
    ///
    /// `make_speaker` used to run synchronously here, on the caller's thread —
    /// which for [`Self::start`] is Tauri's `setup` hook, i.e. the main thread.
    /// Since [`Self::build_speaker`] can block up to ~1.5 s (network probe) plus
    /// however long a Keychain prompt takes, that blocked app startup. Fixed:
    /// `make_speaker` is now called on the action thread itself, not here, so
    /// this function (and therefore `VoiceLoop::start`) returns as soon as the
    /// action thread is spawned. While the speaker is being built, finals
    /// already in flight simply accumulate in the `rx` mpsc channel (nothing is
    /// dropped or crashes) and get processed — in order, with the usual
    /// `t.at`-based dedup — once the speaker is ready and the thread starts its
    /// `rx.iter()` loop. We queue rather than drop: an early command a user
    /// actually spoke should still fire once voice is up, not be silently lost.
    fn start_with(
        emitter: Arc<dyn VoiceEmitter>,
        metro: Arc<Metronome>,
        store: Arc<Store>,
        stt_config: SttConfig,
        wake_word: Option<String>,
        make_speaker: impl FnOnce(Arc<Metronome>, Arc<AtomicBool>, Arc<AtomicBool>) -> Box<dyn Confirm>
            + Send
            + 'static,
    ) -> Arc<VoiceLoop> {
        let muted = Arc::new(AtomicBool::new(false));
        let status = Arc::new(Mutex::new(VoiceStatus {
            muted: false,
            down: None,
        }));
        let (tx, rx) = mpsc::channel::<Transcript>();

        // on_event: emit transcript/status for the UI; forward finals to the action
        // thread. Non-blocking (the settler thread calls this).
        let ev_emitter = emitter.clone();
        let ev_status = status.clone();
        let fwd_tx = tx.clone();
        let on_event = move |ev: SttEvent| match ev {
            SttEvent::Transcript(t) => {
                ev_emitter.emit(
                    "voice://transcript",
                    json!({ "text": t.text, "is_final": t.is_final }),
                );
                if t.is_final {
                    let _ = fwd_tx.send(t);
                }
            }
            SttEvent::Down(reason) => {
                let (code, guidance) = match reason {
                    DownReason::DictationDisabled => (
                        "dictation-disabled",
                        "Enable macOS Dictation (System Settings ▸ Keyboard ▸ Dictation) to use voice control.",
                    ),
                    DownReason::RestartStorm => (
                        "restart-storm",
                        "Voice input stopped after repeated failures.",
                    ),
                };
                if let Ok(mut s) = ev_status.lock() {
                    s.down = Some(code.to_string());
                }
                ev_emitter.emit(
                    "voice://status",
                    json!({ "state": "down", "reason": code, "guidance": guidance }),
                );
            }
        };

        let handle = SttSupervisor::spawn_with_config(stt_config, on_event);
        let gate = handle.gate_flag();

        let action_emitter = emitter.clone();
        let action_muted = muted.clone();
        let action_gate = gate.clone();
        let action_thread = std::thread::Builder::new()
            .name("codakiller-voice".into())
            .spawn(move || {
                // Build the speaker (owns the TTS worker + does the blocking
                // provider/network/Keychain work) here, on the action thread —
                // NOT on the caller of `start_with` — so app startup never waits
                // on it. See the doc comment above for the full rationale.
                let speaker = make_speaker(metro.clone(), action_gate, action_muted.clone());
                let mut ctx = ActionCtx {
                    metro,
                    store,
                    speaker,
                    emitter: action_emitter,
                    wake_word,
                    rep_active: false,
                    muted: action_muted,
                    last: None,
                };
                for t in rx.iter() {
                    ctx.handle_final(&t);
                }
                // Channel closed: drop ctx (and its Speaker → TTS worker join).
            })
            .expect("spawn voice action thread");

        Arc::new(VoiceLoop {
            stt: Mutex::new(Some(handle)),
            action_tx: Mutex::new(Some(tx)),
            action_thread: Mutex::new(Some(action_thread)),
            gate,
            muted,
            status,
            emitter,
        })
    }

    /// Mute (`true`) or unmute the mic. Closes the STT gate AND flips the
    /// action-thread `muted` flag (belt and suspenders — a TTS-reopened gate can
    /// briefly let a line through, but it is still never actioned while muted).
    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Release);
        self.gate.store(!muted, Ordering::Release);
        if let Ok(mut s) = self.status.lock() {
            s.muted = muted;
        }
        self.emitter.emit(
            "voice://status",
            json!({ "state": if muted { "muted" } else { "live" } }),
        );
    }

    /// Current mic status for `voice_state()`.
    pub fn state(&self) -> VoiceStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(VoiceStatus {
                muted: self.muted.load(Ordering::Acquire),
                down: None,
            })
    }

    /// Tear the whole pipeline down: stop `hear` (SIGTERM + reap), close the action
    /// channel so the loop ends and the TTS worker joins, then join the action
    /// thread. Idempotent.
    pub fn shutdown(&self) {
        if let Ok(mut g) = self.stt.lock() {
            if let Some(mut h) = g.take() {
                h.shutdown();
            }
        }
        // Drop our sender; the on_event closure's clone is dropped as the STT
        // threads (now joined) release it, so the action loop's rx ends.
        if let Ok(mut g) = self.action_tx.lock() {
            *g = None;
        }
        if let Ok(mut g) = self.action_thread.lock() {
            if let Some(t) = g.take() {
                let _ = t.join();
            }
        }
    }
}

impl Drop for VoiceLoop {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn bpm_speech_forms() {
        assert_eq!(bpm_to_speech(96.0), "Ninety-six.");
        assert_eq!(bpm_to_speech(120.0), "One hundred twenty.");
        assert_eq!(bpm_to_speech(60.0), "Sixty.");
        assert_eq!(bpm_to_speech(7.0), "Seven.");
        assert_eq!(bpm_to_speech(200.0), "Two hundred.");
        assert_eq!(bpm_to_speech(144.0), "One hundred forty-four.");
    }

    // A recording confirm + emitter so the action logic can be exercised with a
    // seam-backed Metronome (mock engine) and no audio device.
    #[derive(Default)]
    struct Recorder {
        said: Mutex<Vec<String>>,
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }
    struct RecConfirm(Arc<Recorder>);
    impl Confirm for RecConfirm {
        fn say(&self, text: &str) {
            self.0.said.lock().unwrap().push(text.to_string());
        }
    }
    struct RecEmitter(Arc<Recorder>);
    impl VoiceEmitter for RecEmitter {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            self.0
                .events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }
    }

    fn final_t(text: &str) -> Transcript {
        Transcript {
            text: text.to_string(),
            is_final: true,
            at: Instant::now(),
        }
    }

    fn test_ctx(rec: &Arc<Recorder>) -> ActionCtx {
        // A Metronome wired to a mock engine (no real audio device) and an
        // in-memory store.
        let engine_starts = Arc::new(AtomicUsize::new(0));
        let es = engine_starts.clone();
        let metro = Arc::new(crate::metronome::Metronome::with_seams(
            Default::default(),
            crate::metronome::MetroState::default(),
            80,
            move |_cfg| {
                es.fetch_add(1, Ordering::SeqCst);
                Ok(crate::audio::EngineHandle::test_handle(48_000, 0))
            },
            // A no-op boost guard: getter/setter never touch real system volume.
            |lvl| crate::sysvol::BoostGuard::engage_with(lvl, || 40, |_v| {}),
        ));
        let store = Arc::new(Store::open(":memory:").expect("in-memory store"));
        ActionCtx {
            metro,
            store,
            speaker: Box::new(RecConfirm(rec.clone())),
            emitter: Arc::new(RecEmitter(rec.clone())),
            wake_word: None,
            rep_active: false,
            muted: Arc::new(AtomicBool::new(false)),
            last: None,
        }
    }

    #[test]
    fn start_actions_metronome_and_confirms() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome ninety six"));
        assert!(ctx.metro.snapshot().running, "metronome started");
        assert_eq!(ctx.metro.snapshot().bpm, 96.0);
        assert_eq!(rec.said.lock().unwrap().as_slice(), &["Ninety-six.".to_string()]);
        // An intent event was emitted.
        assert!(rec
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(e, _)| e == "voice://intent"));
    }

    #[test]
    fn stop_confirms_before_stopping() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome 120")); // start first
        ctx.handle_final(&final_t("stop"));
        assert!(!ctx.metro.snapshot().running, "metronome stopped");
        assert_eq!(rec.said.lock().unwrap().last().unwrap(), "Stopped.");
    }

    #[test]
    fn ambient_speech_is_silent() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("I stopped by the store yesterday"));
        assert!(rec.said.lock().unwrap().is_empty(), "no confirmation");
        assert!(rec.events.lock().unwrap().is_empty(), "no intent event");
        assert!(!ctx.metro.snapshot().running);
    }

    #[test]
    fn spurious_duplicate_final_is_deduped() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome 100"));
        ctx.handle_final(&final_t("metronome 100")); // spurious repeat
        // Only one confirmation despite two identical finals.
        assert_eq!(rec.said.lock().unwrap().len(), 1);
    }

    #[test]
    fn muted_ignores_transcripts() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.muted.store(true, Ordering::Release);
        ctx.handle_final(&final_t("metronome 96"));
        assert!(!ctx.metro.snapshot().running);
        assert!(rec.said.lock().unwrap().is_empty());
    }

    /// END-TO-END through the REAL STT supervisor: a fake `hear` prints a spoken
    /// command, which must flow line → settler → final → channel → action thread →
    /// router → metronome + confirmation, with no mic and no audio device. This is
    /// the "product exists" path exercised deterministically.
    #[test]
    fn e2e_fake_hear_starts_metronome() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        // A fake `hear`: emit one utterance (external printf → immediate flush, no
        // shell buffering) then stay alive so the pipe stays open (no restart).
        let dir = std::env::temp_dir();
        let script = dir.join(format!("fake_hear_{}.sh", std::process::id()));
        {
            let mut f = std::fs::File::create(&script).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "/usr/bin/printf 'metronome ninety six\\n'").unwrap();
            writeln!(f, "sleep 5").unwrap();
            let mut perms = f.metadata().unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script, perms).unwrap();
        }

        let rec = Arc::new(Recorder::default());
        let ctx = test_ctx(&rec);
        let metro = ctx.metro.clone();
        let store = ctx.store.clone();
        let rec_for_speaker = rec.clone();

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![]; // the fake ignores args
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200); // finalize quickly for the test

        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(rec.clone()));
        let voice = VoiceLoop::start_with(emitter, metro.clone(), store, cfg, None, move |_m, _g, _mu| {
            Box::new(RecConfirm(rec_for_speaker))
        });

        // Poll until the metronome starts (or time out).
        let mut started = false;
        for _ in 0..100 {
            if metro.snapshot().running {
                started = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        voice.shutdown();
        let _ = std::fs::remove_file(&script);

        assert!(started, "fake-hear command started the metronome end-to-end");
        assert_eq!(metro.snapshot().bpm, 96.0);
        assert!(
            rec.said.lock().unwrap().iter().any(|s| s == "Ninety-six."),
            "spoke the confirmation: {:?}",
            rec.said.lock().unwrap()
        );
    }

    /// LIVE on-device smoke (needs an output device + `say`): fake `hear` →
    /// router → REAL metronome (real cpal engine) + REAL Speaker playing the
    /// confirmation through the SAME engine via the MetroSink handoff, with the
    /// real STT gate closing/reopening around it. Verifies the audio handoff for
    /// real (the seam test above uses a mock engine). Makes sound. Run with:
    ///   cargo test --lib e2e_live_audio -- --ignored --nocapture
    #[test]
    #[ignore]
    fn e2e_live_audio_real_engine_and_speaker() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir();
        let script = dir.join(format!("fake_hear_live_{}.sh", std::process::id()));
        {
            let mut f = std::fs::File::create(&script).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "/usr/bin/printf 'metronome ninety six\\n'").unwrap();
            writeln!(f, "sleep 6").unwrap();
            let mut perms = f.metadata().unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script, perms).unwrap();
        }

        // REAL metronome (real Engine::start) + REAL store.
        let metro = Arc::new(crate::metronome::Metronome::new(
            Default::default(),
            crate::metronome::MetroState::default(),
            80,
        ));
        let store = Arc::new(Store::open(":memory:").unwrap());
        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(Arc::new(Recorder::default())));

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![];
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200);

        // REAL Speaker (say provider, offline-safe) wired to the metronome engine.
        let voice = VoiceLoop::start_with(emitter, metro.clone(), store, cfg, None, |m, g, mu| {
            let provider: Box<dyn crate::tts::TtsProvider> = Box::new(crate::tts::say::SayTts::new());
            let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(m));
            let gate: Arc<dyn Gate> = Arc::new(AtomicGate { gate: g, muted: mu });
            Box::new(Speaker::spawn(provider, sink, gate, SpeakerConfig::default()))
        });

        let mut started = false;
        for _ in 0..120 {
            if metro.snapshot().running {
                started = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // Give the confirmation time to play + the gate to reopen.
        std::thread::sleep(Duration::from_millis(3000));
        let gate_open = voice.gate.load(Ordering::Acquire);
        voice.shutdown();
        let _ = std::fs::remove_file(&script);

        assert!(started, "real metronome started from fake-hear command");
        assert_eq!(metro.snapshot().bpm, 96.0);
        assert!(gate_open, "half-duplex gate reopened after the confirmation");
        eprintln!("LIVE OK: clicks at 96, spoke 'Ninety-six.', gate reopened");
    }

    #[test]
    fn rep_repeats_within_window_are_deduped() {
        // Fix round 2: rep checks are NO LONGER exempt from dedup. The STT
        // engine re-sends an identical "done" 0.5–2.3 s later, which the old
        // exempt-reps policy double-counted. A genuine second rep is separated
        // by actually playing the passage (≫ 2.5 s), so keying on `t.at` and
        // applying the one unified rule collapses only the re-sends.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.rep_active = true;

        // Three "done" finals within the 2.5 s window (a re-send burst) → ONE ack.
        let base = Instant::now();
        for off in [0u64, 500, 1900] {
            let mut t = final_t("done");
            t.at = base + Duration::from_millis(off);
            ctx.handle_final(&t);
        }
        assert_eq!(
            rec.said.lock().unwrap().len(),
            1,
            "a re-send burst of identical reps within the window counts once"
        );

        // A genuine second rep, heard well after the passage was played (> 2.5 s
        // past the last occurrence), fires again.
        let mut t = final_t("done");
        t.at = base + Duration::from_millis(1900 + 3000);
        ctx.handle_final(&t);
        assert_eq!(
            rec.said.lock().unwrap().len(),
            2,
            "a genuine rep after > 2.5 s fires as a distinct rep"
        );
    }

    // -----------------------------------------------------------------------
    // Task 13 fix round 1 regression tests.
    // -----------------------------------------------------------------------

    /// A [`Confirm`] that sleeps ~1.8s per `say`, standing in for a real
    /// blocking `speak_blocking` confirmation cycle (synth + play + drain +
    /// 300ms tail routinely adds up to >=1.5s, i.e. >= [`DEDUP_WINDOW`]).
    struct BlockingConfirm(Arc<Recorder>);
    impl Confirm for BlockingConfirm {
        fn say(&self, text: &str) {
            std::thread::sleep(Duration::from_millis(1800));
            self.0.said.lock().unwrap().push(text.to_string());
        }
    }

    #[test]
    fn dedup_survives_a_blocking_confirmation_speak() {
        // The bug: the old code recorded `Instant::now()` at *processing* time
        // (before speaking). By the time the second identical final was
        // processed, the first call's ~1.8s blocking speak had already elapsed
        // past DEDUP_WINDOW (1.5s), so the "same text within the window" check
        // failed and the duplicate fired again (e.g. applying a tempo change
        // twice). The fix keys off `t.at` (the settler's emit timestamp)
        // instead, so what matters is how far apart the transcripts were
        // actually *heard*, not how long we spent speaking in between.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.speaker = Box::new(BlockingConfirm(rec.clone()));

        let t1 = final_t("metronome 100");
        let mut t2 = final_t("metronome 100");
        t2.at = t1.at + Duration::from_millis(600); // heard 600ms apart

        ctx.handle_final(&t1); // blocks ~1.8s here, simulating the confirmation
        ctx.handle_final(&t2); // processed well over 1.8s of *wall clock* later

        assert_eq!(
            rec.said.lock().unwrap().len(),
            1,
            "second identical final (heard only 600ms after the first) must still be deduped, \
             even though processing it happened long after the first's blocking speak"
        );
    }

    #[test]
    fn delta_intents_are_deduped_within_window_and_pass_after() {
        // Fix round 2: relative-delta commands are NO LONGER exempt from dedup.
        // A re-sent "faster" within the window would otherwise double-bump the
        // tempo; the accepted tradeoff is that a deliberate identical delta
        // repeated in < 2.5 s is lost. Outside the window, it fires again.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);

        let t1 = final_t("faster");
        let mut t2 = final_t("faster");
        t2.at = t1.at + Duration::from_millis(50); // well inside DEDUP_WINDOW (a re-send)
        ctx.handle_final(&t1);
        ctx.handle_final(&t2);
        assert_eq!(
            rec.said.lock().unwrap().len(),
            1,
            "a re-sent identical delta within 2.5 s is suppressed (no phantom double-bump)"
        );

        // A genuine repeat spoken > 2.5 s later fires again.
        let mut t3 = final_t("faster");
        t3.at = t1.at + Duration::from_millis(3000);
        ctx.handle_final(&t3);
        assert_eq!(
            rec.said.lock().unwrap().len(),
            2,
            "an identical delta heard > 2.5 s later is a genuine new command"
        );
    }

    #[test]
    fn start_returns_before_speaker_construction_finishes() {
        // VoiceLoop::start (via start_with) used to build the speaker
        // synchronously, on the caller's thread, before returning — and
        // building a real speaker can block ~1.5s (network probe) plus a
        // Keychain call. Fixed: speaker construction now happens on the action
        // thread, so start_with returns immediately regardless of how slow
        // make_speaker is.
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir();
        let script = dir.join(format!("fake_hear_idle_{}.sh", std::process::id()));
        {
            let mut f = std::fs::File::create(&script).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(f, "sleep 5").unwrap();
            let mut perms = f.metadata().unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script, perms).unwrap();
        }

        let rec = Arc::new(Recorder::default());
        let ctx = test_ctx(&rec);
        let metro = ctx.metro.clone();
        let store = ctx.store.clone();

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![];
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200);

        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(rec.clone()));
        let started = Instant::now();
        let voice = VoiceLoop::start_with(emitter, metro, store, cfg, None, move |_m, _g, _mu| {
            // A slow provider-builder: sleeps well past the 50ms budget.
            std::thread::sleep(Duration::from_millis(500));
            Box::new(RecConfirm(rec)) as Box<dyn Confirm>
        });
        let elapsed = started.elapsed();
        voice.shutdown();
        let _ = std::fs::remove_file(&script);

        assert!(
            elapsed < Duration::from_millis(50),
            "start_with must return before the (slow) speaker is built, took {elapsed:?}"
        );
    }

    #[test]
    fn mute_during_inflight_speak_keeps_gate_closed_until_unmuted() {
        // Mute hardening: if mute happens while an utterance is in flight, the
        // ReopenGuard reopening the gate at the end of that utterance must not
        // silently re-arm the mic. AtomicGate checks the muted flag on every
        // open request and refuses to open while muted; only an explicit
        // unmute (VoiceLoop::set_muted(false), which stores the atom directly)
        // reopens it.
        let gate = Arc::new(AtomicBool::new(false)); // closed, as if speech is in flight
        let muted = Arc::new(AtomicBool::new(false));
        let ag = AtomicGate {
            gate: gate.clone(),
            muted: muted.clone(),
        };

        // User mutes mid-utterance.
        muted.store(true, Ordering::Release);
        // The in-flight utterance completes; its ReopenGuard fires.
        ag.set_gate(true);
        assert!(
            !gate.load(Ordering::Acquire),
            "gate must stay closed: mute is still active"
        );

        // User unmutes: VoiceLoop::set_muted(false) reopens the gate directly.
        muted.store(false, Ordering::Release);
        gate.store(true, Ordering::Release);
        assert!(gate.load(Ordering::Acquire), "gate reopens once unmuted");
    }
}
