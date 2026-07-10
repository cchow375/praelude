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
//! # Spurious-final dedup (with a deliberate asymmetry)
//!
//! Task 10's framing can emit two identical finals if `hear` re-sends an identical
//! line. The action thread drops a repeat of the *same* text within a short window
//! — but ONLY for non-rep intents. Rep-mode "done, done, done" repeats are REAL
//! (three cleared reps), so [`Intent::RepCheck`] is never deduped.

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

/// How long an identical final is treated as a spurious repeat (non-rep intents).
const DEDUP_WINDOW: Duration = Duration::from_millis(1500);

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
struct AtomicGate(Arc<AtomicBool>);
impl Gate for AtomicGate {
    fn set_gate(&self, open: bool) {
        self.0.store(open, Ordering::Release);
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

        // Spurious-final dedup for everything EXCEPT rep checks (which are real
        // repeats). Records the text up front so a duplicate arriving during the
        // ~1.5s of speak_blocking is still caught.
        if !matches!(intent, Intent::RepCheck(..)) {
            let norm: String = t.text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
            if let Some((prev, at)) = &self.last {
                if *prev == norm && at.elapsed() < DEDUP_WINDOW {
                    return;
                }
            }
            self.last = Some((norm, Instant::now()));
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
        let (state, res, spoken, bpm_for_evt) = if let Some(d) = args.bpm_delta {
            let nb = (snap.bpm + d).clamp(1.0, 1000.0);
            let (s, r) = self.set_bpm_only(nb);
            (s, r, bpm_to_speech(nb), Some(nb))
        } else if let Some(v) = args.bpm_abs {
            let (s, r) = self.set_bpm_only(v);
            (s, r, bpm_to_speech(v), Some(v))
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
            (s, r, format!("Accent every {}.", cardinal(bp as i64)), None)
        } else {
            return;
        };
        self.emit_state(&state);
        match res {
            Ok(()) => {
                self.emit_intent("set", text, bpm_for_evt);
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
        Self::start_with(emitter, metro, store, stt_config, wake_word, |m, st| {
            Self::build_speaker(m, st)
        })
    }

    /// Build the production TTS speaker (provider chosen from settings) plugged
    /// into the metronome engine + STT gate.
    fn build_speaker(metro: Arc<Metronome>, gate: Arc<AtomicBool>) -> Box<dyn Confirm> {
        let provider = crate::tts::select_provider(None, None, None);
        let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(metro));
        let gate_seam: Arc<dyn Gate> = Arc::new(AtomicGate(gate));
        Box::new(Speaker::spawn(
            provider,
            sink,
            gate_seam,
            SpeakerConfig::default(),
        ))
    }

    /// Core wiring, parameterized over the emitter and a speaker factory so tests
    /// can inject fakes and avoid the audio device / network.
    fn start_with(
        emitter: Arc<dyn VoiceEmitter>,
        metro: Arc<Metronome>,
        store: Arc<Store>,
        stt_config: SttConfig,
        wake_word: Option<String>,
        make_speaker: impl FnOnce(Arc<Metronome>, Arc<AtomicBool>) -> Box<dyn Confirm>,
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

        // Build the speaker (owns the TTS worker) now that we have the gate atom.
        let speaker = make_speaker(metro.clone(), gate.clone());

        let mut ctx = ActionCtx {
            metro,
            store,
            speaker,
            emitter: emitter.clone(),
            wake_word,
            rep_active: false,
            muted: muted.clone(),
            last: None,
        };
        let action_thread = std::thread::Builder::new()
            .name("codakiller-voice".into())
            .spawn(move || {
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
        let voice = VoiceLoop::start_with(emitter, metro.clone(), store, cfg, None, move |_m, _g| {
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
        let voice = VoiceLoop::start_with(emitter, metro.clone(), store, cfg, None, |m, g| {
            let provider: Box<dyn crate::tts::TtsProvider> = Box::new(crate::tts::say::SayTts::new());
            let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(m));
            let gate: Arc<dyn Gate> = Arc::new(AtomicGate(g.clone()));
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
    fn rep_repeats_are_not_deduped() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.rep_active = true;
        ctx.handle_final(&final_t("done"));
        ctx.handle_final(&final_t("done"));
        ctx.handle_final(&final_t("done"));
        // Three real reps → three acknowledgements (asymmetry vs non-rep dedup).
        assert_eq!(rec.said.lock().unwrap().len(), 3);
    }
}
