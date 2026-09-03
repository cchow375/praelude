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
//!
//! the sliding window is safe ONLY because every ack closes the STT gate; if
//! acks ever become silent, revisit
//!
//! # Fast path (S9)
//!
//! The settler holds a finished utterance for a 600 ms quiet gap before calling
//! it final (`stt::supervisor`, `SttConfig::settle`). For a long dictation that
//! wait is what makes the framing correct; for `"metronome off"` it is 600 ms of
//! dead air on top of the ack's own gate cycle, and it is a third of Christian's
//! reported "five second" delay.
//!
//! So a **short allowlist of complete-utterance commands** ([`FAST_PATH_PHRASES`])
//! acts on the PARTIAL hypothesis, the moment the recognizer first emits exactly
//! that phrase — no settle wait. Everything downstream is unchanged: the partial
//! is forwarded to the same action thread, through the same [`Router`], with the
//! same half-duplex gate ordering and the same speak-before-stop rule.
//!
//! The settled final for that utterance arrives ~600 ms later and must not act
//! twice. Two things stop it, in order:
//!
//! 1. the ack closes the STT gate, so most re-sends are dropped at the reader;
//! 2. [`ActionCtx::fast_path`] — a dedicated ledger, separate from the command
//!    dedup ledger — suppresses AT MOST ONE later final inside [`DEDUP_WINDOW`]
//!    whose ROUTED INTENT equals the intent the fast path acted on (B70: not a
//!    text-prefix match — a settled final that revises the fired partial into
//!    a different intent, e.g. `"metronome on"` → `"metronome on ninety six"`,
//!    must still reach the router, and an unrelated ambient sentence that
//!    merely starts with the same words must not be silently swallowed; it
//!    surfaces normally as a `handled = false` ambient final instead).
//!
//! The guard is consumed the instant it suppresses a final, and is also
//! cleared the instant any OTHER genuine (non-fast-path) command dispatches —
//! whichever comes first ends the fired utterance's context, so a later,
//! differently-worded final with the same intent is judged as a fresh command,
//! never swallowed against a fire that is now history.
//!
//! The marker is only armed when the fast path actually ACTED — a phrase that
//! routed to [`Intent::Ignored`] leaves the later final free to route normally.
//! (No phrase currently on the allowlist can route Ignored; the rule is kept
//! because it is what makes adding one safe.)
//!
//! **The bet, and how it turned out.** A partial is a hypothesis about an
//! utterance that may still be growing, so acting on one is a bet that the user
//! has stopped talking. S9 took that bet for ten phrases. It **lost on all seven
//! single-word entries** and survives only on the three multi-word metronome
//! phrases.
//!
//! It lost because the recognizer does not emit one partial per utterance — it
//! emits a GROWING PREFIX, one line per word ("Natural" → "Metronome" →
//! "Metronome 90" → "Metronome 96"; NOTES.md). So a single-word entry fires on
//! the first word of any sentence that starts with it, and the tail guard then
//! suppresses the real final, meaning the user is not even shown what they
//! actually said. The narrated corpus proves the collision four times over:
//!
//! * `scherzo1-0028` — `" Again, that I might be on console roll,"` → phantom rep
//! * `scherzo1-0050` — `" Stop if I need to."` → the metronome stopped
//! * `scherzo3-0118` — `" Again, like, you have to recognize that"`
//! * `scherzo3-0157` — `" again, just to double check"`
//!
//! Every one of those is asserted INERT by the finals-replay gate, which never
//! saw the prefix partials and so never saw the bug. The fix was to remove all
//! seven single words; they return to the normal 600 ms settle path, where they
//! always worked — latency was only ever a complaint about the metronome.
//!
//! What survives: a sweep of all 1,309 corpus utterances found no sentence whose
//! growing prefix passes through `"metronome off"`, `"metronome stop"` or
//! `"metronome on"`. Two words of a rare noun is enough of a moat, and those
//! three are the phrases the sub-second win was for.
//!
//! # Ack policy (S9): chime for routine, speech for information
//!
//! Every command still gets an audible acknowledgement **whenever the audio
//! engine is up** — that is load-bearing, because the sliding-window dedup above
//! is only safe while each ack closes the STT gate. The exception is real and
//! stated here rather than buried: with the metronome stopped there is no engine
//! to play through, so [`Metronome::tts_enqueue`] drops the ack silently
//! (`metronome.rs`) and a command in that state is acknowledged only on screen.
//! Stop acks are unaffected (they fire while the engine is still alive) and a
//! start ack follows the start that revives it, but a rep check-off in a
//! metronome-off block is genuinely silent. What changed in S9 is the *shape* of
//! the ack.
//!
//! The rule: **speech is for an ack that carries a word the user could not have
//! predicted; everything else chimes.** A spoken "Ninety-six." after "metronome
//! ninety six" tells the pianist what they just said, at the cost of a synthesis
//! round trip, ~1.2 s of talking, and the 300 ms tail before the mic reopens —
//! all while the number is already on screen. A 120 ms blip
//! ([`crate::audio::chime`]) closes the same gate cycle far sooner and does not
//! narrate the practice back at them.
//!
//! | Outcome | Ack |
//! |---|---|
//! | metronome start (success) | chime |
//! | metronome stop | chime, still **before** `do_stop` (engine-alive rule) |
//! | tempo set / delta (success) | chime |
//! | `accent every N` | speech — names a number nothing else announces |
//! | rep: clean, no ladder step, no milestone | chime |
//! | rep: flawed / failed | speech — the streak reset is news |
//! | rep: ladder step (`new_bpm`) | speech — "Up to 84." is the new tempo |
//! | rep: one away from mastery | speech — the "three in a row" cue |
//! | rep: mastery earned / set complete | speech |
//! | rep-open, rep-status, rep-close, session-end | speech (all carry counts) |
//! | errors, including "Busy — try again." | speech |
//! | questions / assistant answers | speech |
//!
//! See [`ActionCtx::rep_ack_speaks`] for the rep half, which is the only part
//! with any judgement in it.
//!
//! The chime rides the *same* PCM sink and gate as speech ([`AckPlayer`]), so the
//! half-duplex ordering, the mute hardening, and the metronome's speak-before-stop
//! rule all apply to it unchanged. One consequence is inherited rather than
//! chosen: like speech, the chime is dropped when there is no audio engine (see
//! [`Metronome::tts_enqueue`] — a stopped metronome has nowhere to play). Stop
//! acks are unaffected because they still fire while the engine is alive, and a
//! start ack follows the start; a rep check-off in a metronome-off block is
//! silent, exactly as its spoken ack was before this change.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::audio::PcmError;
use crate::intent::{Intent, MetroSetArgs, Mode, RepOpenSpec, Router, Verdict};
use crate::metronome::{MetroState, Metronome};
use crate::rep::{RepEngine, RepVerdict};
use crate::sessions::SessionService;
use crate::store::model::RepOpenArgs;
use crate::store::Store;
use crate::stt::{DownReason, SttConfig, SttEvent, SttHandle, SttSupervisor, Transcript};
use crate::tts::{Gate, PcmSink, Speaker, SpeakerConfig};

/// How long an identical final is treated as a spurious repeat. Sized to cover
/// the STT engine's measured re-send latency (0.5–2.3 s) with margin, while
/// staying below the gap that separates genuine repeated commands. Applies to
/// ALL intents (see the module docs, "Dedup policy").
const DEDUP_WINDOW: Duration = Duration::from_millis(2500);

/// The longest first-partial→action span the D1 instrument will publish.
///
/// A real utterance runs partial → ~600 ms settle → final, so a credible span
/// is a couple of seconds. Anything beyond this means the tracked start does
/// not belong to the utterance that just ended — the engine never finalised an
/// earlier utterance (exactly the "I said done and nothing happened" case this
/// instrument exists to measure), or the mic was muted in between. Publishing
/// that arithmetic would put a fabricated latency in front of the user, which
/// is worse than publishing nothing: the whole point of this figure is that it
/// is measured, not modelled.
const MAX_CREDIBLE_UTTERANCE: Duration = Duration::from_secs(30);

/// Phrases allowed to finalize on a PARTIAL hypothesis, skipping the settler's
/// 600 ms quiet gap. See the module docs, "Fast path".
///
/// Membership rule (tightened after the bet lost on single words — see the
/// module docs, "Fast path"): the phrase must be a complete command on its own
/// AND **must not be a prefix any English sentence walks through**. The
/// recognizer emits growing prefix partials, one per word, so a single-word
/// entry fires on the first word of every sentence that happens to start with
/// it. That is not a hypothetical: the narrated corpus has `"Again, that I
/// might be on console roll,"` and `"Stop if I need to."` in it.
///
/// Two words is what buys the safety. `"metronome off"` is not a prefix any
/// sentence in the 1,309-utterance corpus passes through; `"stop"` is a prefix
/// of an unbounded number of them.
///
/// Deliberately excluded:
///
/// * every **single word** (`"stop"`, `"done"`, `"clean"`, `"miss"`, `"again"`,
///   `"faster"`, `"slower"`) — see above. They still work; they just pay the
///   600 ms settle, which was never the latency complaint.
/// * `"no"` — same reason, twice over ("no, the left hand").
/// * anything carrying a number (`"metronome 96"`) — a partial `"metronome 90"`
///   is routinely revised to `"metronome 96"` before the utterance ends, and
///   acting on the first hypothesis would set the wrong tempo (see the
///   `progressive_revision` case in the narrated-replay contract).
/// * anything longer than a breath — a long phrase has no latency problem worth
///   this tradeoff.
///
/// Entries must already be in canonical form ([`crate::intent::canonicalize`]) —
/// which is also why `"metranome off"` reaches the fast path without appearing
/// here: the mangle is folded before the lookup, exactly as the router folds it.
const METRO_FAST_PATH_PHRASES: &[&str] = &["metronome off", "metronome stop", "metronome on"];
const REP_FAST_PATH_PHRASES: &[&str] = &["mark done", "rep done", "mark sloppy", "mark again"];
const FAST_PATH_PHRASES: &[&str] = &[
    "metronome off",
    "metronome stop",
    "metronome on",
    "mark done",
    "rep done",
    "mark sloppy",
    "mark again",
];

/// The allowlisted phrase this partial is exactly, or `None`. Cheap enough for
/// the settler thread: one normalize pass plus a walk of ten short strings.
fn fast_path_phrase(text: &str) -> Option<&'static str> {
    let norm = crate::intent::canonicalize(text);
    FAST_PATH_PHRASES.iter().copied().find(|p| *p == norm)
}

fn fast_path_allowed(phrase: &str, rep_active: bool) -> bool {
    METRO_FAST_PATH_PHRASES.contains(&phrase)
        || (rep_active && REP_FAST_PATH_PHRASES.contains(&phrase))
}

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

/// Blocking acknowledgement. The concrete impl is [`AckPlayer`]; tests record
/// calls. Blocking so the gate cycle completes before the next command acts.
///
/// Two shapes, one contract (see "Ack policy" in the module docs): [`Self::say`]
/// for an ack that carries words, [`Self::chime`] for one that only has to mean
/// "heard you". Both close and reopen the half-duplex gate the same way, so from
/// the loop's point of view they are interchangeable.
trait Confirm: Send {
    fn say(&self, text: &str);
    /// Play the ack chime ([`crate::audio::chime`]) through the same PCM sink and
    /// gate cycle a spoken confirmation uses.
    fn chime(&self);
    fn speech_enabled(&self) -> bool {
        true
    }
}

/// The production [`Confirm`]: a [`Speaker`] for words, plus a direct PCM path to
/// the same sink and gate for the chime.
///
/// The chime cannot go through the [`Speaker`] — its worker takes text and
/// synthesizes it, and there is no provider that renders a blip. So the chime is
/// played from *this* thread, straight into the sink, replicating the Speaker's
/// gate ordering exactly (see [`Self::chime`]).
///
/// **Why that does not break the engine's single-producer contract**
/// ([`crate::audio::EngineHandle::enqueue_pcm`]): both ack shapes are only ever
/// called from the action thread, and [`Self::say`] blocks until the Speaker's
/// worker has finished the whole utterance — enqueue, drain, tail, reopen. So the
/// worker thread and this thread are never inside the sink at the same time; they
/// hand off, they do not interleave.
struct AckPlayer {
    speaker: Speaker,
    sink: Arc<dyn PcmSink>,
    gate: Arc<dyn Gate>,
    config: SpeakerConfig,
    /// Shared with [`VoiceLoop`] so a settings write silences the app on the
    /// next ack rather than on the next relaunch — a mute you cannot verify
    /// immediately is a mute you do not trust.
    speech_muted: Arc<AtomicBool>,
}

impl Confirm for AckPlayer {
    /// Muted, this falls through to [`Self::chime`] instead of going silent.
    /// The words were never the point of an ack — the point is "heard you", and
    /// the blip carries that without narrating. Going quiet outright would cost
    /// the only feedback that a spoken command registered at all.
    ///
    /// Either branch runs one complete gate cycle, so the half-duplex contract
    /// (module docs) and the dedup window are unchanged by the flag.
    fn say(&self, text: &str) {
        if self.speech_muted.load(Ordering::Relaxed) {
            self.chime();
            return;
        }
        let _ = self.speaker.speak_blocking(text.to_string());
    }

    fn chime(&self) {
        play_pcm_gated(
            &*self.sink,
            &*self.gate,
            &self.config,
            crate::audio::chime::ack_chime(),
            crate::audio::chime::CHIME_RATE,
        );
    }

    fn speech_enabled(&self) -> bool {
        !self.speech_muted.load(Ordering::Relaxed)
    }
}

/// Reopens the gate exactly once on drop — the same guarantee `tts`'s own
/// `ReopenGuard` gives a spoken utterance, restated here because that type is
/// private to the TTS worker. A stuck-closed gate is a deaf app; nothing on this
/// path may be able to cause one, panic included.
struct GateReopen<'a>(&'a dyn Gate);
impl Drop for GateReopen<'_> {
    fn drop(&mut self) {
        self.0.set_gate(true);
    }
}

/// Play a pre-rendered mono buffer through the TTS PCM path, driving the
/// half-duplex gate in the same order [`crate::tts`] does for speech: close the
/// gate before the first sample is enqueued, play, wait for the engine to drain,
/// hold for the acoustic tail, and only then reopen.
///
/// Blocking, and bounded: a wedged sink can never hold the gate shut forever, so
/// the enqueue and drain phases each carry a deadline generous enough that normal
/// playback finishes long before it. On a deadline we give up on the audio, not on
/// the mic.
fn play_pcm_gated(
    sink: &dyn PcmSink,
    gate: &dyn Gate,
    config: &SpeakerConfig,
    samples: &[f32],
    rate: u32,
) {
    if samples.is_empty() {
        return;
    }
    gate.set_gate(false);
    let _reopen = GateReopen(gate);

    let dur = Duration::from_secs_f64(samples.len() as f64 / rate.max(1) as f64);
    let deadline = Instant::now() + dur.mul_f64(2.0) + Duration::from_secs(2);
    let chunk = config.chunk_samples.max(1);
    'chunks: for piece in samples.chunks(chunk) {
        while sink.enqueue(piece, rate).is_err() {
            // Backpressure: the queue is momentarily full. Retry, never drop —
            // half a chime is a click, which is precisely the sound we avoid.
            if Instant::now() >= deadline {
                break 'chunks;
            }
            std::thread::sleep(config.retry_delay);
        }
    }
    while !sink.done() {
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(config.poll_interval);
    }
    // Acoustic-tail margin, then the guard reopens the gate as it drops.
    std::thread::sleep(config.reopen_delay);
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
    capture_suspended: Arc<AtomicBool>,
}
impl Gate for AtomicGate {
    fn set_gate(&self, open: bool) {
        if open
            && (self.muted.load(Ordering::Acquire)
                || self.capture_suspended.load(Ordering::Acquire))
        {
            // Mute and an exclusive-capture lease both win: don't let a
            // completing utterance's reopen re-arm the recognizer while either
            // owner says it must stay closed.
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
    rep: Arc<RepEngine>,
    sessions: Arc<SessionService>,
    speaker: Box<dyn Confirm>,
    emitter: Arc<dyn VoiceEmitter>,
    wake_word: Option<String>,
    muted: Arc<AtomicBool>,
    capture_suspended: Arc<AtomicBool>,
    last: Option<(String, Instant)>,
    /// The routed [`Intent`] the fast path actually acted on, with the timestamp
    /// of the partial that fired it. A later final that routes to the SAME
    /// intent inside [`DEDUP_WINDOW`] is the same utterance arriving late (the
    /// settler finishing what the fast path already handled), never a new
    /// command — matched on the routed meaning, not on text prefix (B70: a text
    /// prefix match either swallowed a final that revised the intent, e.g.
    /// "metronome on ninety six" losing its tempo, or swallowed an unrelated
    /// ambient sentence that merely started with the same words). Kept separate
    /// from `last` so the command dedup ledger's locked identical-text rule
    /// stays exactly as it is.
    fast_path: Option<(Intent, Instant)>,
    /// The `at` of the current utterance's FIRST partial (D1 latency
    /// instrument). Set once per utterance, on the first partial that reaches
    /// this ctx (when `None`); read-and-cleared the moment a final is routed
    /// (handled or `Ignored`) so `app_ms` in the next utterance's
    /// `voice://transcript` payload starts fresh. This is deliberately NOT
    /// `t.at` at the final — the settler stamps `at` at EMIT time, ~600 ms
    /// after the last partial for a settled final, which would hide the
    /// wait this instrument exists to show (module docs on `settle`,
    /// `stt/supervisor.rs`). A plain field, not shared state: every partial
    /// and final for an utterance passes through this same ctx on the single
    /// action thread ([`ActionMessage::Partial`] carries interim hypotheses
    /// there too now, purely so this can be stamped).
    utterance_start: Option<Instant>,
}

enum ActionMessage {
    Transcript(Transcript),
    /// A partial hypothesis that exactly matched [`FAST_PATH_PHRASES`], promoted
    /// to a final so it acts now instead of after the settle wait.
    FastPath(Transcript),
    /// An interim (non-final, non-fast-path) hypothesis, forwarded ONLY so
    /// [`ActionCtx::handle_partial`] can stamp the utterance's start for the
    /// D1 latency instrument. It takes no other action — the frontend's
    /// interim event is still emitted directly from the settler thread
    /// (`on_event`), unchanged.
    Partial(Transcript),
    SpeakBrain(String),
    /// Explicit teardown sentinel. Restartable capture keeps its event sink
    /// (and therefore a sender clone) for the app lifetime, so channel-drop is
    /// no longer sufficient to end the action thread.
    Shutdown,
}

impl ActionCtx {
    /// A settled final from the settler: route it and act.
    fn handle_final(&mut self, t: &Transcript) {
        self.route_and_act(t, false);
    }

    /// An interim hypothesis: stamp the utterance's start (D1 latency
    /// instrument) if this is the first partial seen since the last final was
    /// routed. Takes no other action.
    ///
    /// A tracked start older than [`MAX_CREDIBLE_UTTERANCE`] is treated as
    /// belonging to a dead utterance and replaced: the engine can simply never
    /// finalise what it heard (the "I said done and nothing happened" case),
    /// which would otherwise leave a stale start to be charged against the
    /// NEXT command the user speaks.
    fn handle_partial(&mut self, t: &Transcript) {
        let stale = self
            .utterance_start
            .is_some_and(|start| t.at.saturating_duration_since(start) > MAX_CREDIBLE_UTTERANCE);
        if self.utterance_start.is_none() || stale {
            self.utterance_start = Some(t.at);
        }
    }

    /// A partial that matched [`FAST_PATH_PHRASES`], acting ahead of the settle
    /// wait. Identical handling apart from arming the tail guard — same router,
    /// same dedup, same gate ordering.
    fn handle_fast_path(&mut self, t: &Transcript) {
        self.route_and_act(t, true);
    }

    fn route_and_act(&mut self, t: &Transcript, via_fast_path: bool) {
        if self.muted.load(Ordering::Acquire) || self.capture_suspended.load(Ordering::Acquire) {
            // Muting ends whatever utterance was in flight. Without this the
            // tracked start survives the entire muted stretch and is charged
            // against the first command spoken after unmuting — the mic toggle
            // shipped in this same release makes that an ordinary thing to do,
            // so the instrument would routinely report a fabricated figure.
            self.utterance_start = None;
            return;
        }
        let mode = Mode {
            // Live from the engine — a block opened by voice or by the UI makes
            // rep-check phrases route as reps immediately.
            rep_block_active: self.rep.active(),
            wake_word: self.wake_word.clone(),
            metro_running: self.metro.snapshot().running,
        };
        let routed = mode
            .rep_block_active
            .then(|| crate::settings::custom_verdict(&self.store, &t.text))
            .flatten();
        let intent = Router::route(routed.unwrap_or(&t.text), &mode);

        // The settled tail of an utterance the fast path already acted on: this
        // final routes to the SAME intent as the partial that fired, inside
        // DEDUP_WINDOW. Drop it — silently, exactly like the dedup path below,
        // so the frontend sees AT MOST ONE ACTED final per utterance, not two.
        // Matched on the routed intent, not a text prefix (B70): a final that
        // revises the fired partial into a DIFFERENT intent (e.g. "metronome
        // on" firing a bare resume, then "metronome on ninety six" settling to
        // an explicit tempo) must still reach the router. An out-of-vocabulary
        // tail that routes to `Ignored` is NOT suppressed here either — it
        // falls through to the ambient branch below and surfaces honestly as a
        // second `handled = false` final (hiding heard speech is the recorded
        // anti-lesson; see the module docs). Consumed on use: the guard
        // suppresses AT MOST ONE final, so it is cleared the moment it fires
        // (below) rather than staying armed for the rest of the window.
        if !via_fast_path {
            if let Some((fired, at)) = &self.fast_path {
                if t.at.saturating_duration_since(*at) < DEDUP_WINDOW && intent == *fired {
                    self.fast_path = None;
                    // This final ENDS the utterance even though it is dropped.
                    // It is not enough to assume the fast-path fire already
                    // cleared the start: the engine keeps streaming interim
                    // partials after we act, and any one of them re-arms
                    // `utterance_start` (it sees `None` and treats the tail as
                    // a new utterance). Returning without clearing would charge
                    // that stray start to the user's NEXT command.
                    self.utterance_start = None;
                    return;
                }
            }
        }

        // Ambient speech takes no action, but its transcript still reaches the
        // frontend marked `handled = false` so Lane B may draft it. Ambient is
        // deliberately kept OUT of the command dedup ledger below: that ledger's
        // 2.5 s window is a locked hot-loop invariant, and letting ambient text
        // seed `self.last` could wrongly swallow a later genuine verdict that
        // happens to repeat the ambient words (e.g. a UI-opened rep followed by
        // the spoken verdict within the window).
        if matches!(intent, Intent::Ignored) {
            let app_ms = self.take_app_ms(t);
            self.emit_transcript(&t.text, t.is_final, false, app_ms);
            return;
        }

        // Spurious-final dedup — ONE rule for EVERY command intent (see the module
        // docs, "Dedup policy"). The STT engine re-sends an identical final
        // 0.5–2.3 s after an utterance, so an identical normalized transcript
        // within DEDUP_WINDOW of the previous occurrence of the same text is a
        // re-send, not a genuine repeat, and is dropped — reps and deltas included.
        // Keyed on `t.at` (the settler's own emit timestamp), NOT `Instant::now()`
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
        let suppress = self.last.as_ref().is_some_and(|(prev, at)| {
            *prev == norm && t.at.saturating_duration_since(*at) < DEDUP_WINDOW
        });
        self.last = Some((norm, t.at));
        if suppress {
            // Same reasoning as the tail guard above: a suppressed re-send is
            // still the end of an utterance, and an interim partial arriving
            // between the original final and this re-send can have re-armed
            // `utterance_start`. Clear it here rather than assuming.
            self.utterance_start = None;
            return;
        }

        // Arm the fast-path tail guard only now: the phrase routed to a real
        // intent AND survived dedup, so it is about to act and the settled final
        // that follows is a duplicate of work already done. Store the routed
        // intent itself (not the text) — the guard above compares intents.
        // Overwriting on consecutive fires is intended: only the most recent
        // fired intent is ever guarded against.
        //
        // A genuine (non-fast-path) command reaching this point has already
        // survived the tail-guard check and dedup above, so it is about to act
        // in its own right — the fired utterance's context is over. Clear any
        // stale guard so a LATER final with the same intent (a real repeat,
        // not the settled tail of the original fire) is judged fresh rather
        // than swallowed against a fire that is now history (reviewer PROBE-A
        // / PROBE-B: "metronome off" fires, a restart intervenes, then a later
        // genuine "turn the metronome off" must still stop the click).
        if via_fast_path {
            self.fast_path = Some((intent.clone(), t.at));
        } else {
            self.fast_path = None;
        }

        // A routed command is authoritative. Emit its transcript carrying
        // `handled = true` BEFORE the action's state events, so a downstream
        // consumer sees transcript-before-state ordering and Lane B never drafts
        // a final the backend already routed. `app_ms` is read (and the
        // utterance cleared) here rather than after the `act_*` dispatch below
        // so this ordering invariant is not disturbed — the dispatch itself is
        // a synchronous, deterministic, DB-light call (constraint 2: no LLM in
        // this path), so the difference is on the order of microseconds against
        // a measurement whose whole point is the ~600 ms settle wait.
        let app_ms = self.take_app_ms(t);
        self.emit_transcript(&t.text, t.is_final, true, app_ms);

        match intent {
            Intent::MetroStart(bpm) => self.act_start(bpm, &t.text),
            Intent::MetroStop => self.act_stop(&t.text),
            Intent::MetroSet(args) => self.act_set(args, &t.text),
            Intent::RepCheck(v, note) => self.act_rep(v, note, &t.text),
            Intent::RepAdd(count) => self.act_rep_add(count, &t.text),
            Intent::RepUndo(count) => self.act_rep_undo(count, &t.text),
            Intent::RepOpen(spec) => self.act_rep_open(spec, &t.text),
            Intent::RepStatus => self.act_rep_status(&t.text),
            Intent::RepClose => self.act_rep_close(&t.text),
            Intent::SessionEnd => self.act_session_end(&t.text),
            Intent::ScorePage(value) => self.act_score_navigation("page", value, &t.text),
            Intent::ScoreMeasure(value) => self.act_score_navigation("measure", value, &t.text),
            Intent::Question(q) => {
                self.emit_intent("question", &q, None);
            }
            Intent::Ignored => {}
        }
    }

    fn act_start(&self, bpm: Option<f64>, text: &str) {
        let (before, state, res) = self.metro.serialized(|| {
            let before = self.metro.snapshot();
            let (_, res) = self.metro.do_ensure_running(&self.store, bpm);
            if res.is_ok() {
                self.metro.claim_manual();
            }
            let state = self.metro.snapshot();
            self.emit_state(&state);
            (before, state, res)
        });
        match res {
            Ok(()) => {
                self.emit_intent("start", text, Some(state.bpm));
                self.log_metro_action("start", text, &before, &state, Some(state.bpm));
                // Routine: the tempo the chime does not name is already on screen,
                // and about to be audible as clicks. (Was `bpm_to_speech`.)
                self.speaker.chime();
            }
            Err(e) => self.speak_error(&e, text),
        }
    }

    fn act_stop(&self, text: &str) {
        let (before, state) = self.metro.serialized(|| {
            let before = self.metro.snapshot();
            // Ack BEFORE stopping: the engine must still be alive to play the
            // confirmation (stop drops it). The command boundary stays held so
            // another source cannot change the engine between ack and stop. This
            // rule is why the chime goes through the PCM sink rather than the
            // metronome's own click voice — the clicks stop with the engine.
            self.speaker.chime();
            let _ = self.metro.do_stop();
            self.metro.claim_manual();
            let state = self.metro.snapshot();
            self.emit_state(&state);
            (before, state)
        });
        self.emit_intent("stop", text, None);
        self.log_metro_action("stop", text, &before, &state, None);
    }

    fn act_set(&self, args: MetroSetArgs, text: &str) {
        let Some((snap, state, res, spoken, bpm_for_evt, kind)) = self.metro.serialized(|| {
            let snap = self.metro.snapshot();
            let (_, res, spoken, bpm_for_evt, kind) = if let Some(d) = args.bpm_delta {
                let nb = (snap.bpm + d).clamp(1.0, 1000.0);
                let (s, r) = self.set_bpm_only(nb);
                (s, r, bpm_to_speech(nb), Some(nb), "set")
            } else if let Some(v) = args.bpm_abs {
                let (s, r) = self.set_bpm_only(v);
                (s, r, bpm_to_speech(v), Some(v), "set")
            } else {
                let bp = args.beats_per_bar?;
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
                // "accent", not "set" — this is a beats-per-bar/accent change,
                // not a tempo change, so the UI toast must not mislabel it.
                (
                    s,
                    r,
                    format!("Accent every {}.", cardinal(bp as i64)),
                    None,
                    "accent",
                )
            };
            if res.is_ok() {
                self.metro.claim_manual();
            }
            let state = self.metro.snapshot();
            self.emit_state(&state);
            Some((snap, state, res, spoken, bpm_for_evt, kind))
        }) else {
            return;
        };
        match res {
            Ok(()) => {
                self.emit_intent(kind, text, bpm_for_evt);
                self.log_metro_action(kind, text, &snap, &state, bpm_for_evt);
                // A tempo change is routine — the new number is on screen and in
                // the click. An accent change is not: "Accent every three" is the
                // only place that count is ever stated. (Ack policy, module docs.)
                if kind == "accent" {
                    self.speaker.say(&spoken);
                } else {
                    self.speaker.chime();
                }
            }
            Err(e) => self.speak_error(&e, text),
        }
    }

    /// Record a rep through the engine (the single source of the ladder + spoken
    /// line), then follow any tempo step on a *running* metronome. When the
    /// metronome is stopped, the engine still persisted the new tempo for the
    /// block, so we just speak the composed line.
    fn act_rep(&self, v: Verdict, note: Option<String>, text: &str) {
        let verdict = match v {
            Verdict::Pass => RepVerdict::Clean,
            Verdict::Flawed => RepVerdict::Flawed,
            Verdict::Fail => RepVerdict::Failed,
        };
        match self.rep.check_voice(verdict, note) {
            Ok(outcome) => {
                self.follow_rep_retune(&outcome);
                self.emit_intent("rep", text, outcome.new_bpm);
                // Every verdict gets the low-latency chime immediately. Spoken
                // detail is a second, opt-in layer; default-off never converts
                // an informational result into a delayed synthesized ack.
                self.speaker.chime();
                if Self::rep_ack_speaks(&outcome, verdict) && self.speaker.speech_enabled() {
                    self.speaker.say(&outcome.say);
                }
            }
            // The router only produces RepCheck while a block is active, but a
            // block could close between routing and here — degrade quietly.
            Err(e) => eprintln!("voice: rep check ignored: {e}"),
        }
    }

    fn follow_rep_retune(&self, outcome: &crate::store::model::CheckOutcome) {
        let Some(nb) = outcome.new_bpm else {
            return;
        };
        if !outcome.snap.use_metronome {
            return;
        }
        self.metro.serialized(|| {
            if self.metro.snapshot().running {
                let _ = self.metro.do_practice_retune(
                    &self.store,
                    outcome.snap.block_id,
                    nb,
                    None,
                    None,
                );
                self.emit_state(&self.metro.snapshot());
            }
        });
    }

    fn act_rep_add(&self, count: u32, text: &str) {
        let mut completed = 0_u32;
        let mut final_outcome = None;
        for _ in 0..count {
            match self.rep.check_voice(RepVerdict::Clean, None) {
                Ok(outcome) => {
                    self.follow_rep_retune(&outcome);
                    completed += 1;
                    final_outcome = Some(outcome);
                }
                Err(error) => {
                    eprintln!("voice: counted rep add stopped after {completed}: {error}");
                    break;
                }
            }
        }
        let Some(outcome) = final_outcome else {
            return;
        };
        self.emit_adjustment_intent("rep_add", text, completed, outcome.new_bpm);
        self.speaker.chime();
        if self.speaker.speech_enabled() {
            self.speaker.say(&format!(
                "Added {} clean {}. {} tries.",
                completed,
                if completed == 1 { "rep" } else { "reps" },
                outcome.snap.tries
            ));
        }
    }

    fn act_rep_undo(&self, count: u32, text: &str) {
        let available = self.rep.snapshot().map_or(0, |snap| snap.tries);
        if available < count {
            self.emit_adjustment_intent("rep_undo_rejected", text, count, None);
            self.speaker.chime();
            if self.speaker.speech_enabled() {
                self.speaker
                    .say("There are not that many reps to take back.");
            }
            return;
        }

        let mut final_outcome = None;
        for _ in 0..count {
            match self.rep.undo_voice() {
                Ok(outcome) => {
                    self.follow_rep_retune(&outcome);
                    final_outcome = Some(outcome);
                }
                Err(error) => {
                    eprintln!("voice: counted rep undo failed: {error}");
                    break;
                }
            }
        }
        let Some(outcome) = final_outcome else {
            return;
        };
        self.emit_adjustment_intent("rep_undo", text, count, outcome.new_bpm);
        self.speaker.chime();
        if self.speaker.speech_enabled() {
            self.speaker.say(&format!(
                "Took back {} {}. {} tries remain.",
                count,
                if count == 1 { "rep" } else { "reps" },
                outcome.snap.tries
            ));
        }
    }

    /// Whether this rep outcome has to be *spoken* rather than chimed — the only
    /// part of the ack policy (module docs) with any judgement in it.
    ///
    /// A pianist mid-block does not need to be told "Attempt 4 saved — clean.
    /// Streak 2 of 4." forty times an hour; they need to know they were heard, and
    /// the panel already shows the count. So the ordinary clean rep chimes, and
    /// speech is kept for the four things that are genuinely news:
    ///
    /// * **the block finished / mastery was earned** — the outcome the whole set
    ///   was for;
    /// * **the ladder stepped** (`new_bpm`) — a tempo the pianist has to play at
    ///   next, which they cannot infer from a blip;
    /// * **a non-clean verdict** — flawed and failed reset the streak, and silently
    ///   losing progress is the one thing worse than being talked at;
    /// * **one away from the requirement** — the "three in a row, one more" cue.
    ///   Deliberately not every count: only the rep that makes the next one decisive.
    ///
    /// `verdict` is the verdict as recorded, passed in rather than re-derived from
    /// the snapshot: `snap.last` is the same rep, but reading the outcome we just
    /// produced is the honest source.
    fn rep_ack_speaks(outcome: &crate::store::model::CheckOutcome, verdict: RepVerdict) -> bool {
        if outcome.block_done
            || outcome.new_bpm.is_some()
            || outcome.snap.mastery_status == "satisfied"
            || !matches!(verdict, RepVerdict::Clean)
        {
            return true;
        }
        let (_, progress, required) = crate::rep::v2_progress(&outcome.snap);
        // One away, and there is a requirement to be one away from.
        required > 0 && progress + 1 == required
    }

    /// Open a rep block from voice. Resolves the piece from `ui.current_piece`;
    /// with no piece selected, says so and does nothing. Starts the metronome at
    /// the block's start tempo, live-retuning an existing click without a restart.
    fn act_rep_open(&self, spec: RepOpenSpec, text: &str) {
        let Some(piece_id) = self.current_piece_id() else {
            self.speaker.say("Pick a piece first.");
            return;
        };
        // Default the start tempo to the metronome's current bpm when unspoken.
        let start_bpm = spec.start_bpm.unwrap_or_else(|| self.metro.snapshot().bpm);
        let args = RepOpenArgs {
            tuning: Default::default(),
            piece_id,
            region_id: None,
            m_start: spec.m_start,
            m_end: spec.m_end,
            label: None,
            start_bpm,
            target_bpm: spec.target_bpm,
            planned_reps: spec.reps,
            required_clean_streak: None,
            attempt_target: None,
            increment: None,
            variants: vec![],
            focus: "tempo".into(),
            use_metronome: true,
        };
        match self.rep.open_voice(args) {
            Ok(snap) => {
                let result = self.metro.serialized(|| {
                    let (_, result) = self.metro.do_practice_start(
                        &self.store,
                        snap.block_id,
                        snap.start_bpm,
                        None,
                        None,
                    );
                    let state = self.metro.snapshot();
                    self.emit_state(&state);
                    result
                });
                if let Err(error) = result {
                    self.speak_error(&error, text);
                    return;
                }
                self.emit_intent("rep_open", text, Some(snap.start_bpm));
                self.speaker.say(&format!(
                    "Measures {} to {} at {}. Go.",
                    snap.m_start,
                    snap.m_end,
                    fmt_bpm(snap.start_bpm)
                ));
            }
            Err(e) if e.contains("close the current block") => {
                self.speaker.say("Close the current block first.");
            }
            Err(e) => eprintln!("voice: rep open failed: {e}"),
        }
    }

    fn act_rep_status(&self, text: &str) {
        match self.rep.snapshot() {
            Some(s) => {
                self.emit_intent("rep_status", text, s.bpm);
                // Same rung-vs-streak reading the engine speaks after a rep, from
                // the one place that decides it (`rep::v2_progress`) — a second
                // copy here is exactly how the two lines would drift apart.
                let (label, progress, required) = crate::rep::v2_progress(&s);
                let tempo = s
                    .bpm
                    .map(|bpm| format!(" At {}.", fmt_bpm(bpm)))
                    .unwrap_or_default();
                self.speaker.say(&format!(
                    "{} tries. {} {} of {}.{tempo}",
                    s.tries, label, progress, required
                ));
            }
            None => self.speaker.say("No block open."),
        }
    }

    fn act_rep_close(&self, text: &str) {
        match self.rep.close_voice() {
            Ok(Some(s)) => {
                self.emit_intent("rep_close", text, None);
                let verb = if s.status == "done" { "done" } else { "closed" };
                self.speaker.say(&format!(
                    "Block {}. {} reps, {} clean.",
                    verb, s.reps_done, s.verdicts.clean
                ));
                self.metro.serialized(|| {
                    let state = self.metro.do_practice_close(s.block_id);
                    self.emit_state(&state);
                });
            }
            Ok(None) => self.speaker.say("No block open."),
            Err(error) => eprintln!("voice: rep close failed: {error}"),
        }
    }

    fn act_session_end(&self, text: &str) {
        let pieces_dir = crate::pieces_dir(&self.store);
        match self.rep.end_session_and_export(&pieces_dir) {
            Ok(Some(result)) => {
                self.emit_intent("session_end", text, None);
                self.speaker.say(&format!(
                    "Session saved. {} reps across {} pieces.",
                    result.reps, result.pieces
                ));
            }
            Ok(None) => self.speaker.say("No session to save."),
            Err(_) => self
                .speaker
                .say("Close the current practice set before ending the session."),
        }
    }

    /// The selected piece id from `ui.current_piece`, or `None` if unset/invalid.
    fn current_piece_id(&self) -> Option<i64> {
        self.store
            .get_setting("ui.current_piece")
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| s.trim().parse::<i64>().ok())
    }

    /// Change only the tempo of a running (or stored) metronome via `do_set`.
    fn set_bpm_only(&self, bpm: f64) -> (MetroState, Result<(), String>) {
        self.metro
            .do_set(&self.store, Some(bpm), None, None, None, None, None, None)
    }

    /// Persist the exact phrase that produced a handled metronome action. The
    /// recognizer does not expose confidence or alternatives, so retain the raw
    /// final plus before/after state; this makes ASR homophones (for example
    /// "stop" arriving as "sixty") diagnosable from the local session ledger.
    fn log_metro_action(
        &self,
        action: &str,
        text: &str,
        before: &MetroState,
        after: &MetroState,
        bpm: Option<f64>,
    ) {
        let normalized_text = text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        self.sessions.log(
            "metro",
            json!({
                "action": action,
                "bpm": bpm,
                "raw_text": text,
                "normalized_text": normalized_text,
                "routed_intent": format!("metronome_{action}"),
                "recognition": {
                    "source": "macos_speech",
                    "confidence": serde_json::Value::Null,
                },
                "metro_before": before,
                "metro_after": after,
            }),
        );
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
        self.emitter.emit(
            "voice://intent",
            json!({ "kind": kind, "text": text, "bpm": bpm }),
        );
    }

    fn emit_adjustment_intent(&self, kind: &str, text: &str, count: u32, bpm: Option<f64>) {
        self.emitter.emit(
            "voice://intent",
            json!({ "kind": kind, "text": text, "count": count, "bpm": bpm }),
        );
    }

    /// Emit a final's transcript carrying the backend's authoritative routing
    /// outcome. `handled` is true when a deterministic intent routed and acted,
    /// false for an ambient final the backend declined to route (which the
    /// frontend Lane B is then free to draft). Interim (non-final) hypotheses are
    /// emitted straight from the settler thread with `handled = false`.
    ///
    /// `app_ms` (D1 latency instrument) is milliseconds from the utterance's
    /// FIRST PARTIAL to this call — the only span the app can actually measure
    /// (see [`ActionCtx::take_app_ms`] and the module docs). It is NOT
    /// utterance→action: the macOS engine's own recognition delay happens
    /// upstream of every timestamp this app can see.
    fn emit_transcript(&self, text: &str, is_final: bool, handled: bool, app_ms: Option<u64>) {
        let mut payload = json!({ "text": text, "is_final": is_final, "handled": handled });
        // Omitted entirely when there is nothing honest to report, so the UI
        // renders no figure at all rather than a misleading "app 0.0s".
        if let Some(ms) = app_ms {
            payload["app_ms"] = json!(ms);
        }
        self.emitter.emit("voice://transcript", payload);
    }

    /// Read-and-clear the current utterance's tracked first-partial `Instant`
    /// (D1 latency instrument), returning elapsed milliseconds to this call.
    ///
    /// `None` — meaning "publish no figure at all" — when either there was no
    /// tracked partial (nothing to measure from) or the span exceeds
    /// [`MAX_CREDIBLE_UTTERANCE`] (the tracked start cannot belong to the
    /// utterance that just ended). Both cases used to produce a number anyway:
    /// the first fell back to `t.at` and reported a flat `0`, which the UI
    /// rendered as "app 0.0s"; the second reported the whole dead gap. A
    /// measurement that is wrong is worse than no measurement, because the
    /// entire justification for showing this figure is that it is measured
    /// rather than modelled.
    ///
    /// Clearing here (not on `t.is_final` generally) means only finals that
    /// actually reach an emit point — routed or `Ignored` — close out the
    /// utterance. A final dropped earlier by the fast-path tail guard or the
    /// spurious-final dedup never reaches this call, which is correct: those
    /// are re-sends of an utterance whose ORIGINAL final already cleared the
    /// start here. The paths that genuinely ended an utterance without
    /// reaching this call are handled at their own sites — muting clears in
    /// `route_and_act`, and an utterance the engine never finalises is aged
    /// out by `handle_partial`.
    fn take_app_ms(&mut self, t: &Transcript) -> Option<u64> {
        let start = self.utterance_start.take()?;
        // Measured against `t.at` (the FINAL's own timestamp), like every
        // other time comparison in this module (e.g. `DEDUP_WINDOW`), not
        // `Instant::now()` — fixture/replayed transcripts carry synthetic
        // `at` values that are never actually slept through, and real
        // production transcripts already carry real `Instant`s, so this is
        // correct in both worlds. `saturating_duration_since` never panics if
        // a fixture's `at` values are out of order.
        let span = t.at.saturating_duration_since(start);
        (span <= MAX_CREDIBLE_UTTERANCE).then_some(span.as_millis() as u64)
    }

    /// Score navigation is intentionally silent: a spoken acknowledgement would
    /// cover the practice the user is trying to inspect. The score event is a
    /// stateless absolute destination, so replaying it is harmless; the global
    /// transcript de-dup above suppresses `hear`'s common duplicate finals too.
    fn act_score_navigation(&self, kind: &str, value: u32, text: &str) {
        self.emitter
            .emit("score://navigate", json!({ "kind": kind, "value": value }));
        self.emit_intent(&format!("score_{kind}"), text, None);
    }
}

/// Numeric BPM for rep lines (`"Measures 40 to 56 at 80. Go."`), a whole number
/// printed without a trailing decimal. (Metronome tempo confirmations use the
/// spoken-word [`bpm_to_speech`] instead.)
fn fmt_bpm(bpm: f64) -> String {
    if bpm.fract() == 0.0 {
        (bpm as i64).to_string()
    } else {
        bpm.to_string()
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
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
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

type SttEventSink = Arc<dyn Fn(SttEvent) + Send + Sync + 'static>;

/// Restartable ownership of the native recognizer process.
///
/// Listen Back may hold more than one short-lived lease while React effects are
/// settling (Strict Mode, a quick toggle, or an unmount racing an in-flight
/// command). Capture stays down until every issued lease is returned. Epochs
/// make release idempotent: a late or duplicate release cannot restart capture
/// underneath a newer owner.
struct CaptureRuntime {
    handle: Option<SttHandle>,
    config: SttConfig,
    sink: SttEventSink,
    leases: BTreeSet<u64>,
    /// Request identity → active epoch. `None` is a release tombstone: if an
    /// unmount's resume IPC outruns its suspend IPC, the later suspend sees the
    /// tombstone and cannot strand a microphone lease.
    requests: BTreeMap<String, Option<u64>>,
    next_epoch: u64,
    resume_after_leases: bool,
}

/// Owns the STT supervisor, the TTS speaker (inside the action thread), and the
/// action thread. Managed by Tauri; [`Self::shutdown`] tears everything down with
/// no zombie processes or hung joins.
pub struct VoiceLoop {
    capture: Mutex<CaptureRuntime>,
    action_tx: Mutex<Option<mpsc::Sender<ActionMessage>>>,
    action_thread: Mutex<Option<JoinHandle<()>>>,
    gate: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    capture_suspended: Arc<AtomicBool>,
    shutting_down: AtomicBool,
    /// "Stay quiet": shared with the [`AckPlayer`] on the action thread, so a
    /// settings write takes effect on the very next ack without a relaunch.
    speech_muted: Arc<AtomicBool>,
    settle_ms: Arc<AtomicU64>,
    status: Arc<Mutex<VoiceStatus>>,
    emitter: Arc<dyn VoiceEmitter>,
}

impl VoiceLoop {
    /// Wire and start the whole pipeline. `stt_config` selects the `hear` binary
    /// (or a fake, via the config seam). `wake_word` gates all commands when set.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        app: &AppHandle,
        metro: Arc<Metronome>,
        store: Arc<Store>,
        rep: Arc<RepEngine>,
        sessions: Arc<SessionService>,
        mut stt_config: SttConfig,
        wake_word: Option<String>,
    ) -> Arc<VoiceLoop> {
        let emitter: Arc<dyn VoiceEmitter> = Arc::new(TauriEmitter(app.clone()));
        let provider = store
            .get_setting("tts.provider")
            .ok()
            .flatten()
            .filter(|value| value != "auto");
        let voice = store.get_setting("tts.voice").ok().flatten();
        stt_config.settle =
            Duration::from_millis(u64::from(crate::settings::stt_settle_ms(&store)));
        Self::start_with(
            emitter,
            metro,
            store,
            rep,
            sessions,
            stt_config,
            wake_word,
            move |m, g, mu, cs, sm| Self::build_speaker(m, g, mu, cs, sm, provider, voice),
        )
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
        capture_suspended: Arc<AtomicBool>,
        speech_muted: Arc<AtomicBool>,
        provider_override: Option<String>,
        voice: Option<String>,
    ) -> Box<dyn Confirm> {
        let provider = crate::tts::select_provider(provider_override, None, voice);
        let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(metro));
        let gate_seam: Arc<dyn Gate> = Arc::new(AtomicGate {
            gate,
            muted,
            capture_suspended,
        });
        let config = SpeakerConfig::default();
        // The Speaker and the chime share the same sink and gate — one output
        // path, one gate cycle, whichever shape the ack takes.
        Box::new(AckPlayer {
            speaker: Speaker::spawn(provider, sink.clone(), gate_seam.clone(), config.clone()),
            sink,
            gate: gate_seam,
            config,
            speech_muted,
        })
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
    #[allow(clippy::too_many_arguments)]
    fn start_with(
        emitter: Arc<dyn VoiceEmitter>,
        metro: Arc<Metronome>,
        store: Arc<Store>,
        rep: Arc<RepEngine>,
        sessions: Arc<SessionService>,
        mut stt_config: SttConfig,
        wake_word: Option<String>,
        make_speaker: impl FnOnce(
                Arc<Metronome>,
                Arc<AtomicBool>,
                Arc<AtomicBool>,
                Arc<AtomicBool>,
                Arc<AtomicBool>,
            ) -> Box<dyn Confirm>
            + Send
            + 'static,
    ) -> Arc<VoiceLoop> {
        let muted = Arc::new(AtomicBool::new(false));
        let capture_suspended = Arc::new(AtomicBool::new(false));
        // Stable across every recognizer restart. TTS, the user mute and the
        // Listen Back capture lease must all drive this exact same atom.
        let gate = Arc::new(AtomicBool::new(true));
        // Read before the store moves onto the action thread. Inverted here, at
        // the app boundary, because `tts` knows nothing about muting: the flag
        // it hands out is "speak acks", the flag the loop holds is "stay quiet".
        let speech_muted = Arc::new(AtomicBool::new(!crate::settings::speak_acks(&store)));
        let initial_settle_ms = u64::try_from(stt_config.settle.as_millis()).unwrap_or(600);
        let settle_ms = Arc::new(AtomicU64::new(initial_settle_ms));
        stt_config.settle_control = Some(settle_ms.clone());
        let status = Arc::new(Mutex::new(VoiceStatus {
            muted: false,
            down: None,
        }));
        let (tx, rx) = mpsc::channel::<ActionMessage>();

        // on_event: emit interim transcripts + status for the UI; forward finals
        // to the action thread. A FINAL's transcript is emitted there instead,
        // AFTER routing, so it can carry the backend's authoritative `handled`
        // outcome (see `ActionCtx::handle_final` / `emit_transcript`). Emitting a
        // final here too would double-emit and lose that outcome. Non-blocking
        // (the settler thread calls this).
        let ev_emitter = emitter.clone();
        let ev_status = status.clone();
        let fwd_tx = tx.clone();
        let event_rep = rep.clone();
        let event_capture_suspended = capture_suspended.clone();
        let on_event: SttEventSink = Arc::new(move |ev: SttEvent| match ev {
            SttEvent::Transcript(t) => {
                // A shutdown can already have read a line before the manager is
                // reaped. The capture lease is the last authoritative guard:
                // once acquired, no queued tail may reach the action thread.
                if event_capture_suspended.load(Ordering::Acquire) {
                    return;
                }
                if t.is_final {
                    let _ = fwd_tx.send(ActionMessage::Transcript(t));
                } else if fast_path_phrase(&t.text)
                    .is_some_and(|phrase| fast_path_allowed(phrase, event_rep.active()))
                {
                    // A complete command, spoken and finished — act now instead
                    // of paying the settle wait (module docs, "Fast path"). It is
                    // promoted to a final so the action thread treats it as the
                    // one authoritative utterance; the settled final that follows
                    // is dropped by the fast-path tail guard. No interim event is
                    // emitted for it — `handle_final` emits the final instead.
                    let _ = fwd_tx.send(ActionMessage::FastPath(Transcript {
                        is_final: true,
                        ..t
                    }));
                } else {
                    // Interim hypotheses are liveness only; nothing routes
                    // them. They ARE forwarded to the action thread as
                    // `ActionMessage::Partial` so `ActionCtx` can stamp the
                    // utterance's first-partial `Instant` for the D1 latency
                    // instrument (`handle_partial`) — this is a timestamp
                    // capture only, never a routing decision.
                    ev_emitter.emit(
                        "voice://transcript",
                        json!({ "text": t.text, "is_final": false, "handled": false }),
                    );
                    let _ = fwd_tx.send(ActionMessage::Partial(t));
                }
            }
            SttEvent::Down(reason) => {
                let (code, guidance) = match reason {
                    DownReason::UnsupportedPlatform => (
                        "unsupported-platform",
                        "Hands-free voice commands are unavailable in this Windows build. Use the on-screen controls or verdict hotkeys instead.",
                    ),
                    DownReason::DictationDisabled => (
                        "dictation-disabled",
                        "Enable macOS Dictation (System Settings ▸ Keyboard ▸ Dictation) to use voice control.",
                    ),
                    DownReason::MicDenied => (
                        "mic-denied",
                        "Microphone or Speech Recognition permission is off. System Settings ▸ Privacy & Security ▸ Microphone (and Speech Recognition) → allow Praelude, then relaunch.",
                    ),
                    DownReason::RestartStorm => (
                        "restart-storm",
                        "Voice input stopped after repeated failures — often a Microphone or Speech Recognition permission issue. Check System Settings ▸ Privacy & Security ▸ Microphone (and Speech Recognition) for Praelude, then relaunch.",
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
        });

        let handle = SttSupervisor::spawn_with_config_and_gate(
            stt_config.clone(),
            {
                let on_event = on_event.clone();
                move |event| on_event(event)
            },
            gate.clone(),
        );

        let action_emitter = emitter.clone();
        let action_muted = muted.clone();
        let action_capture_suspended = capture_suspended.clone();
        let action_gate = gate.clone();
        let action_speech_muted = speech_muted.clone();
        let action_thread = std::thread::Builder::new()
            .name("codakiller-voice".into())
            .spawn(move || {
                // Build the speaker (owns the TTS worker + does the blocking
                // provider/network/Keychain work) here, on the action thread —
                // NOT on the caller of `start_with` — so app startup never waits
                // on it. See the doc comment above for the full rationale.
                let speaker = make_speaker(
                    metro.clone(),
                    action_gate,
                    action_muted.clone(),
                    action_capture_suspended.clone(),
                    action_speech_muted,
                );
                let mut ctx = ActionCtx {
                    metro,
                    store,
                    rep,
                    sessions,
                    speaker,
                    emitter: action_emitter,
                    wake_word,
                    muted: action_muted,
                    capture_suspended: action_capture_suspended,
                    last: None,
                    fast_path: None,
                    utterance_start: None,
                };
                for message in rx.iter() {
                    match message {
                        ActionMessage::Transcript(transcript) => ctx.handle_final(&transcript),
                        ActionMessage::FastPath(transcript) => ctx.handle_fast_path(&transcript),
                        ActionMessage::Partial(transcript) => ctx.handle_partial(&transcript),
                        // Reuse the exact same Speaker → PCM sink → STT gate as
                        // command confirmations. A provider answer can never be
                        // played through an ungated WebView speech API.
                        ActionMessage::SpeakBrain(answer) => ctx.speaker.say(&answer),
                        ActionMessage::Shutdown => break,
                    }
                }
                // Channel closed: drop ctx (and its Speaker → TTS worker join).
            })
            .expect("spawn voice action thread");

        Arc::new(VoiceLoop {
            capture: Mutex::new(CaptureRuntime {
                handle: Some(handle),
                config: stt_config,
                sink: on_event,
                leases: BTreeSet::new(),
                requests: BTreeMap::new(),
                next_epoch: 0,
                resume_after_leases: true,
            }),
            action_tx: Mutex::new(Some(tx)),
            action_thread: Mutex::new(Some(action_thread)),
            gate,
            muted,
            capture_suspended,
            shutting_down: AtomicBool::new(false),
            speech_muted,
            settle_ms,
            status,
            emitter,
        })
    }

    /// Silence (`true`) or restore spoken acknowledgements. The ack chime is
    /// unaffected either way — see [`AckPlayer::say`]. Called from
    /// `settings_update` so the change is audible on the next command.
    pub fn set_speech_muted(&self, muted: bool) {
        self.speech_muted.store(muted, Ordering::Relaxed);
    }

    /// Whether spoken acknowledgements are currently silenced.
    pub fn speech_muted(&self) -> bool {
        self.speech_muted.load(Ordering::Relaxed)
    }

    /// Change the transcript quiet-gap for the next settler wait.
    pub fn set_settle_ms(&self, milliseconds: u32) {
        self.settle_ms
            .store(u64::from(milliseconds), Ordering::Relaxed);
    }

    #[cfg(test)]
    pub fn settle_ms(&self) -> u64 {
        self.settle_ms.load(Ordering::Relaxed)
    }

    /// Mute (`true`) or unmute the mic. Closes the STT gate AND flips the
    /// action-thread `muted` flag (belt and suspenders — a TTS-reopened gate can
    /// briefly let a line through, but it is still never actioned while muted).
    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Release);
        self.gate.store(
            !muted && !self.capture_suspended.load(Ordering::Acquire),
            Ordering::Release,
        );
        if let Ok(mut s) = self.status.lock() {
            s.muted = muted;
        }
        self.emitter.emit(
            "voice://status",
            json!({ "state": if muted { "muted" } else { "live" } }),
        );
    }

    /// Acquire an exclusive native-capture lease for Listen Back.
    ///
    /// This is deliberately stronger than [`Self::set_muted`]: it terminates
    /// and reaps the supervised `hear` process, releasing the macOS microphone
    /// device instead of merely dropping its transcripts. Multiple leases may
    /// overlap; capture is restarted only after the last exact epoch returns.
    pub fn suspend_capture(&self, request_id: &str) -> Result<u64, String> {
        let request_id = request_id.trim();
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("Voice capture request id is invalid".into());
        }
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("Voice loop is shutting down".into());
        }
        let pipeline_was_down = self
            .status
            .lock()
            .map(|status| status.down.is_some())
            .unwrap_or(false);
        let mut capture = self
            .capture
            .lock()
            .map_err(|_| "Voice capture lifecycle is unavailable".to_string())?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("Voice loop is shutting down".into());
        }
        if let Some(epoch) = capture.requests.get(request_id) {
            return Ok(epoch.unwrap_or(0));
        }

        capture.next_epoch = capture.next_epoch.wrapping_add(1).max(1);
        let epoch = capture.next_epoch;
        let first = capture.leases.is_empty();
        capture.leases.insert(epoch);
        capture.requests.insert(request_id.to_string(), Some(epoch));
        if !first {
            return Ok(epoch);
        }

        self.capture_suspended.store(true, Ordering::Release);
        self.gate.store(false, Ordering::Release);
        capture.resume_after_leases = capture.handle.is_some() && !pipeline_was_down;
        if let Some(mut handle) = capture.handle.take() {
            handle.shutdown();
        }
        self.emitter.emit(
            "voice://capture",
            json!({ "state": "suspended", "epoch": epoch }),
        );
        Ok(epoch)
    }

    /// Return one exact capture lease. A stale/duplicate epoch is inert, and a
    /// newer overlapping lease keeps the microphone released. Returns `true`
    /// only for the call that actually restored the recognizer.
    pub fn resume_capture(&self, request_id: &str) -> Result<bool, String> {
        let request_id = request_id.trim();
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("Voice capture request id is invalid".into());
        }
        let mut capture = self
            .capture
            .lock()
            .map_err(|_| "Voice capture lifecycle is unavailable".to_string())?;
        let Some(epoch) = capture.requests.get(request_id).copied().flatten() else {
            // Release-before-acquire is a real WebView unmount race. Keep a
            // tombstone so that a late suspend carrying this same request id is
            // inert instead of acquiring a lease nobody remains to return.
            capture.requests.insert(request_id.to_string(), None);
            return Ok(false);
        };
        capture.requests.insert(request_id.to_string(), None);
        if !capture.leases.remove(&epoch) {
            return Ok(false);
        }
        if !capture.leases.is_empty() {
            return Ok(false);
        }
        if self.shutting_down.load(Ordering::Acquire) {
            capture.resume_after_leases = false;
            return Ok(false);
        }

        let should_resume = capture.resume_after_leases;
        capture.resume_after_leases = false;
        if should_resume {
            let sink = capture.sink.clone();
            let handle = SttSupervisor::spawn_with_config_and_gate(
                capture.config.clone(),
                move |event| sink(event),
                self.gate.clone(),
            );
            // The shared gate remained closed throughout the handoff. Apply the
            // user's independent mute state before capture becomes visible.
            handle.set_gate(!self.muted.load(Ordering::Acquire));
            capture.handle = Some(handle);
        }
        self.capture_suspended.store(false, Ordering::Release);
        self.gate.store(
            should_resume && !self.muted.load(Ordering::Acquire),
            Ordering::Release,
        );
        self.emitter.emit(
            "voice://capture",
            json!({ "state": "resumed", "epoch": epoch }),
        );
        Ok(should_resume)
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

    /// Queue a completed wake-word answer for half-duplex speech. Provider work
    /// happens elsewhere; this method is non-blocking and only accepts a bounded
    /// already-policy-checked answer.
    pub fn speak_brain_answer(&self, answer: &str) -> Result<(), String> {
        let answer = answer.trim();
        if answer.is_empty() || answer.chars().count() > 4_000 {
            return Err("Brain answer is empty or too long to speak".into());
        }
        self.action_tx
            .lock()
            .map_err(|_| "Voice action queue is unavailable".to_string())?
            .as_ref()
            .ok_or_else(|| "Voice loop is shut down".to_string())?
            .send(ActionMessage::SpeakBrain(answer.to_string()))
            .map_err(|_| "Voice action queue is closed".to_string())
    }

    /// Tear the whole pipeline down: stop `hear` (SIGTERM + reap), close the action
    /// channel so the loop ends and the TTS worker joins, then join the action
    /// thread. Idempotent.
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        self.capture_suspended.store(true, Ordering::Release);
        self.gate.store(false, Ordering::Release);
        if let Ok(mut capture) = self.capture.lock() {
            capture.leases.clear();
            capture.requests.clear();
            capture.resume_after_leases = false;
            if let Some(mut h) = capture.handle.take() {
                h.shutdown();
            }
        }
        // Drop our sender; the on_event closure's clone is dropped as the STT
        // threads (now joined) release it, so the action loop's rx ends.
        if let Ok(mut g) = self.action_tx.lock() {
            if let Some(sender) = g.take() {
                let _ = sender.send(ActionMessage::Shutdown);
            }
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
        /// Chime acks (ack policy, module docs). Counted, not compared: a chime
        /// has no text, only a "the user was acknowledged" meaning.
        chimed: Mutex<usize>,
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }
    impl Recorder {
        fn chimes(&self) -> usize {
            *self.chimed.lock().unwrap()
        }
        /// Every acknowledgement, in either shape. What the dedup invariant
        /// actually cares about is that a command produced exactly one ack.
        fn acks(&self) -> usize {
            self.said.lock().unwrap().len() + self.chimes()
        }
    }
    struct RecConfirm(Arc<Recorder>);
    impl Confirm for RecConfirm {
        fn say(&self, text: &str) {
            self.0.said.lock().unwrap().push(text.to_string());
        }
        fn chime(&self) {
            *self.0.chimed.lock().unwrap() += 1;
        }
    }
    struct QuietRecConfirm(Arc<Recorder>);
    impl Confirm for QuietRecConfirm {
        fn say(&self, text: &str) {
            self.0.said.lock().unwrap().push(text.to_string());
        }
        fn chime(&self) {
            *self.0.chimed.lock().unwrap() += 1;
        }
        fn speech_enabled(&self) -> bool {
            false
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

    /// Records `rep://state` / `session://event` into the same recorder.
    struct RecState(Arc<Recorder>);
    impl crate::sessions::StateEmitter for RecState {
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

    static TEST_PIECE_SEQ: AtomicUsize = AtomicUsize::new(0);

    /// A Metronome wired to a mock engine (no audio device), an in-memory store
    /// seeded with one selected piece, and a rep engine + session service that
    /// share the recorder as their event emitter.
    fn test_ctx(rec: &Arc<Recorder>) -> ActionCtx {
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

        // A selected piece in a real (unique) temp folder, so a voice rep-open
        // resolves `ui.current_piece` and a session export has somewhere to write.
        let n = TEST_PIECE_SEQ.fetch_add(1, Ordering::SeqCst);
        let folder = std::env::temp_dir().join(format!("ck_test_piece_{}_{n}", std::process::id()));
        let _ = std::fs::create_dir_all(&folder);
        let pid = store
            .upsert_piece(&crate::store::model::ScanPiece {
                folder_path: folder.to_string_lossy().into_owned(),
                title: "Test Piece".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        store
            .set_setting("ui.current_piece", &pid.to_string())
            .unwrap();

        let sessions = Arc::new(SessionService::new(store.clone()));
        sessions.set_emitter(Arc::new(RecState(rec.clone())));
        let rep = Arc::new(RepEngine::new(store.clone(), sessions.clone()));
        rep.set_emitter(Arc::new(RecState(rec.clone())));

        ActionCtx {
            metro,
            store,
            rep,
            sessions,
            speaker: Box::new(RecConfirm(rec.clone())),
            emitter: Arc::new(RecEmitter(rec.clone())),
            fast_path: None,
            wake_word: None,
            muted: Arc::new(AtomicBool::new(false)),
            capture_suspended: Arc::new(AtomicBool::new(false)),
            last: None,
            utterance_start: None,
        }
    }

    #[test]
    fn start_actions_metronome_and_chimes() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome ninety six"));
        assert!(ctx.metro.snapshot().running, "metronome started");
        assert_eq!(ctx.metro.snapshot().bpm, 96.0);
        assert_eq!(
            ctx.metro.snapshot().owner,
            Some(crate::metronome::MetroOwner::Manual)
        );
        // A start is routine (ack policy, module docs): one chime, no speech.
        assert_eq!(rec.chimes(), 1, "start acknowledged with a chime");
        assert!(
            rec.said.lock().unwrap().is_empty(),
            "a routine start says nothing: {:?}",
            rec.said.lock().unwrap()
        );
        // An intent event was emitted.
        assert!(rec
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(e, _)| e == "voice://intent"));
    }

    #[test]
    fn stop_acks_before_stopping() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        // Swap in a [`Confirm`] that reports whether the engine was still alive
        // when the ack fired. The stop ack is a chime now, and a chime has no
        // text to assert on — but the property that mattered was never the words,
        // it was the ordering: `do_stop` drops the engine, so an ack issued after
        // it would play into nothing.
        let alive: Arc<Mutex<Vec<bool>>> = Arc::new(Mutex::new(Vec::new()));
        struct EngineWitness {
            metro: Arc<crate::metronome::Metronome>,
            alive: Arc<Mutex<Vec<bool>>>,
        }
        impl EngineWitness {
            fn note(&self) {
                self.alive
                    .lock()
                    .unwrap()
                    .push(self.metro.snapshot().running);
            }
        }
        impl Confirm for EngineWitness {
            fn say(&self, _text: &str) {
                self.note();
            }
            fn chime(&self) {
                self.note();
            }
        }
        ctx.speaker = Box::new(EngineWitness {
            metro: ctx.metro.clone(),
            alive: alive.clone(),
        });

        ctx.handle_final(&final_t("metronome 120")); // start first
        ctx.handle_final(&final_t("stop"));
        assert!(!ctx.metro.snapshot().running, "metronome stopped");
        assert_eq!(
            ctx.metro.snapshot().owner,
            Some(crate::metronome::MetroOwner::Manual)
        );
        let alive = alive.lock().unwrap();
        assert_eq!(alive.len(), 2, "one ack for the start, one for the stop");
        assert!(
            alive[1],
            "the stop ack must fire while the engine is still alive to play it"
        );
    }

    #[test]
    fn explicit_metronome_stop_persists_the_raw_handled_phrase() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome 120"));
        ctx.handle_final(&final_t("metronome stop"));

        assert!(!ctx.metro.snapshot().running);
        let session = ctx
            .sessions
            .current()
            .expect("voice actions open a session");
        let stopped = session
            .events
            .iter()
            .find(|event| event.kind == "metro" && event.payload["action"] == "stop")
            .expect("stop action is persisted");
        assert_eq!(stopped.payload["raw_text"], json!("metronome stop"));
        assert_eq!(stopped.payload["routed_intent"], json!("metronome_stop"));
        assert_eq!(stopped.payload["metro_before"]["running"], json!(true));
        assert_eq!(stopped.payload["metro_after"]["running"], json!(false));
        assert_eq!(
            stopped.payload["recognition"]["source"],
            json!("macos_speech")
        );
    }

    #[test]
    fn repeated_start_while_running_is_idempotent_even_with_speech_buffered() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome ninety six"));
        ctx.metro
            .tts_enqueue(&[0.25; 64], 48_000)
            .expect("test engine accepts buffered speech");

        ctx.handle_final(&final_t("metronome on"));

        assert!(ctx.metro.snapshot().running);
        assert_eq!(ctx.metro.snapshot().bpm, 96.0);
        assert_eq!(
            rec.chimes(),
            2,
            "both starts acked with a chime — the second must not hit the \
             restart Busy path, which speaks"
        );
        assert!(
            rec.said.lock().unwrap().is_empty(),
            "no Busy error was spoken: {:?}",
            rec.said.lock().unwrap()
        );
    }

    // ------------------------------------------------------------- FAST PATH
    // See the module docs, "Fast path". These pin the three claims that make it
    // safe: the allowlist is the whole surface, the settled final that follows a
    // fired partial never acts twice, and a partial that routes to Ignored does
    // not arm the tail guard.

    /// Replay an utterance the way the recognizer actually delivers it: one
    /// GROWING PREFIX partial per word ("Again" → "Again, that" → "Again, that
    /// I" → …), each offered to the same `fast_path_phrase` filter the
    /// `on_event` closure uses, and then the settled final 600 ms later.
    ///
    /// This shape is the whole point. A finals-only replay never shows the
    /// recognizer emitting a bare first word, so it cannot see the fast path
    /// firing on a prefix of a sentence that means nothing of the kind — which
    /// is exactly how the single-word allowlist entries got through the corpus
    /// gate and into a shipped build (NOTES.md, "Natural / Metronome /
    /// Metronome 90 / Metronome 96").
    fn replay_partial_stream(ctx: &mut ActionCtx, text: &str, at: Instant) {
        let words: Vec<&str> = text.split_whitespace().collect();
        for i in 0..words.len() {
            let partial = words[..=i].join(" ");
            if fast_path_phrase(&partial)
                .is_some_and(|phrase| fast_path_allowed(phrase, ctx.rep.active()))
            {
                ctx.handle_fast_path(&final_at(
                    &partial,
                    at + Duration::from_millis(10 * i as u64),
                ));
            }
        }
        ctx.handle_final(&final_at(text, at + Duration::from_millis(600)));
    }

    /// Open a real rep block on the seeded piece, so rep-check vocabulary
    /// ("done", "clean", "again") routes as a rep rather than as ambient noise.
    fn open_test_block(ctx: &ActionCtx) {
        ctx.rep
            .open(crate::store::model::RepOpenArgs {
                tuning: Default::default(),
                piece_id: 1,
                region_id: None,
                m_start: 1,
                m_end: 4,
                label: None,
                start_bpm: 80.0,
                target_bpm: None,
                planned_reps: Some(30),
                required_clean_streak: None,
                attempt_target: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();
    }

    /// The four utterances from the narrated corpus that a single-word fast-path
    /// entry turns into commands. Every one of them is asserted INERT by the
    /// shipped finals-replay gate — and every one of them begins with a bare
    /// allowlisted word, so the recognizer's first prefix partial fired it
    /// anyway. Worst case is silent: the fast-path tail guard then swallowed the
    /// real final, so the user never even saw what they had said.
    #[test]
    fn corpus_prefix_collisions_replayed_as_partials_stay_inert() {
        for line in [
            // scherzo1-0028 — "Again" opened a phantom rep.
            " Again, that I might be on console roll,",
            // scherzo1-0050 — "Stop" killed the click mid-thought.
            " Stop if I need to.",
            // scherzo3-0118
            " Again, like, you have to recognize that",
            // scherzo3-0157
            " again, just to double check",
        ] {
            let rec = Arc::new(Recorder::default());
            let mut ctx = test_ctx(&rec);
            open_test_block(&ctx);
            let at = Instant::now();
            ctx.handle_final(&final_at("metronome 120", at));
            let before = ctx.metro.snapshot();
            let acks_before = rec.acks();

            replay_partial_stream(&mut ctx, line, at + Duration::from_millis(100));

            let after = ctx.metro.snapshot();
            assert_eq!(rec.acks(), acks_before, "{line:?} acknowledged something");
            assert!(after.running, "{line:?} stopped the metronome");
            assert_eq!(after.bpm, before.bpm, "{line:?} moved the tempo");
            assert!(
                !rec.events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(e, p)| e == "voice://intent" && p["text"] == json!(line)),
                "{line:?} routed to an intent"
            );
        }
    }

    /// "Clean" as a prefix of a sentence about pedalling, with a block open: the
    /// most expensive collision, because a phantom clean rep corrupts the
    /// practice record rather than just annoying the user.
    #[test]
    fn a_clean_sentence_in_an_open_block_records_nothing() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        open_test_block(&ctx);
        replay_partial_stream(
            &mut ctx,
            "Clean up the pedaling in that spot",
            Instant::now(),
        );
        assert_eq!(rec.acks(), 0, "no rep was checked off: {:?}", rec.acks());
    }

    /// "Stop me if you have heard this one" — the click keeps running.
    #[test]
    fn a_stop_sentence_leaves_the_click_running() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        assert!(ctx.metro.snapshot().running);
        replay_partial_stream(
            &mut ctx,
            "Stop me if you have heard this one",
            at + Duration::from_millis(100),
        );
        assert!(
            ctx.metro.snapshot().running,
            "a sentence beginning 'stop' is not a stop command"
        );
    }

    /// "Faster than yesterday for sure" — the tempo does not move.
    #[test]
    fn a_faster_sentence_leaves_the_tempo_alone() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        replay_partial_stream(
            &mut ctx,
            "Faster than yesterday for sure",
            at + Duration::from_millis(100),
        );
        assert_eq!(
            ctx.metro.snapshot().bpm,
            120.0,
            "a sentence beginning 'faster' is not a delta"
        );
    }

    /// The other half of the bet, still paying: the multi-word metronome phrases
    /// DO fire from a partial, so the sub-second stop Christian asked for is
    /// retained. A full sweep of the 1,309-utterance corpus found no sentence
    /// whose growing prefix passes through any of these three.
    #[test]
    fn metronome_phrases_still_fast_path_from_partials() {
        for (phrase, expect_running) in [
            ("Metronome off", false),
            ("metronome stop", false),
            ("metronome on", true),
        ] {
            let rec = Arc::new(Recorder::default());
            let mut ctx = test_ctx(&rec);
            let at = Instant::now();
            ctx.handle_final(&final_at("metronome 120", at));

            // The partial stream, WITHOUT the settled final: the fast path must
            // have acted before it ever arrives.
            let words: Vec<&str> = phrase.split_whitespace().collect();
            for i in 0..words.len() {
                let partial = words[..=i].join(" ");
                if fast_path_phrase(&partial).is_some() {
                    ctx.handle_fast_path(&final_at(
                        &partial,
                        at + Duration::from_millis(10 * i as u64),
                    ));
                }
            }
            assert_eq!(
                ctx.metro.snapshot().running,
                expect_running,
                "{phrase:?} must still act on the partial"
            );
        }
    }

    #[test]
    fn approved_two_word_verdicts_fast_path_only_with_an_active_set() {
        for (phrase, verdict) in [
            ("mark done", "clean"),
            ("rep done", "clean"),
            ("mark sloppy", "flawed"),
            ("mark again", "failed"),
        ] {
            let rec = Arc::new(Recorder::default());
            let mut ctx = test_ctx(&rec);
            let at = Instant::now();

            replay_partial_stream(&mut ctx, phrase, at);
            assert_eq!(rec.acks(), 0, "{phrase:?} acted outside rep mode");

            open_test_block(&ctx);
            let before = ctx.rep.snapshot().unwrap().tries;
            let words: Vec<&str> = phrase.split_whitespace().collect();
            for i in 0..words.len() {
                let partial = words[..=i].join(" ");
                if fast_path_phrase(&partial)
                    .is_some_and(|candidate| fast_path_allowed(candidate, ctx.rep.active()))
                {
                    ctx.handle_fast_path(&final_at(
                        &partial,
                        at + Duration::from_millis(700 + 10 * i as u64),
                    ));
                }
            }
            let snap = ctx.rep.snapshot().unwrap();
            assert_eq!(snap.tries, before + 1, "{phrase:?} did not act early");
            assert_eq!(snap.last.unwrap().verdict, verdict);
        }

        for bare in ["done", "clean", "sloppy", "again"] {
            assert_eq!(fast_path_phrase(bare), None, "bare-word B70 law");
        }
    }

    /// And the settled final that follows a fired multi-word partial is still
    /// suppressed — one stop per utterance, replayed through the real partial
    /// stream rather than by hand. `replay_partial_stream` appends that
    /// settled tail itself (see its doc comment); no OTHER command intervenes
    /// between the fire and the tail here, which is the case the guard
    /// protects (review finding 1: an intervening genuine command now clears
    /// the guard instead — see
    /// `a_genuine_command_between_the_fire_and_a_later_same_intent_final_clears_the_guard`
    /// — so this test no longer restarts in between; that scenario is covered
    /// separately).
    #[test]
    fn the_settled_final_after_a_multi_word_fire_is_still_suppressed() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));

        replay_partial_stream(&mut ctx, "metronome off", at + Duration::from_millis(50));
        assert!(!ctx.metro.snapshot().running, "the partial stopped it");

        let stops = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, p)| e == "voice://intent" && p["kind"] == json!("stop"))
            .count();
        assert_eq!(
            stops, 1,
            "one stop action, from the partial — its own settled tail must be inert"
        );

        let offs = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, p)| e == "voice://transcript" && p["text"] == json!("metronome off"))
            .count();
        assert_eq!(offs, 1, "one final per utterance, not two");
    }

    /// The shipped allowlist, spelled out so a future edit is a deliberate one.
    /// Every entry must be exactly what `intent::canonicalize` produces, or the
    /// lookup silently never fires.
    #[test]
    fn fast_path_allowlist_is_the_whole_surface() {
        for phrase in FAST_PATH_PHRASES {
            assert_eq!(
                crate::intent::canonicalize(phrase),
                *phrase,
                "allowlist entries must already be normalized"
            );
            assert_eq!(fast_path_phrase(phrase), Some(*phrase));
        }
        // Punctuation and casing as the recognizer may render them.
        assert_eq!(fast_path_phrase("Metronome off."), Some("metronome off"));
        assert_eq!(fast_path_phrase("  METRONOME OFF  "), Some("metronome off"));

        // Not on the fast path — these keep paying the settle wait.
        for text in [
            // Every single word is off the list now: the recognizer's growing
            // prefix makes each of them the first partial of any sentence that
            // starts with it (module docs, "Fast path" — the bet that lost).
            "stop",
            "done",
            "clean",
            "miss",
            "again",
            "faster",
            "slower",
            "no",                 // too common mid-sentence to bet on
            "metronome 96",       // a partial tempo is routinely revised
            "metronome",          // bare resume is not latency-critical
            "stop the metronome", // longer explicit form; settles normally
            "stop the car",
            "done with that",
            "",
        ] {
            assert_eq!(fast_path_phrase(text), None, "must not fast-path {text:?}");
        }
    }

    /// No allowlist entry may be a single word — the invariant the corpus
    /// collisions bought. A future addition trips this before it ships.
    #[test]
    fn no_fast_path_phrase_is_a_bare_prefix_word() {
        for phrase in FAST_PATH_PHRASES {
            assert!(
                phrase.split_whitespace().count() >= 2,
                "{phrase:?} is a single word — it will fire on the first prefix \
                 partial of every sentence starting with it"
            );
        }
    }

    /// July 31, both complaints at once: the phrases reported as delayed, said
    /// the way the recognizer actually spells them. The allowlist stays short and
    /// exact — the manglings reach it because `intent::canonicalize` folds them
    /// before the lookup (S9), not because they were added here.
    #[test]
    fn fast_path_accepts_the_asr_manglings_of_metronome() {
        for text in [
            "metranome off",
            "metrodome off",
            "metro gnome off",
            "metro nome off",
            "Metro-Gnome, off!",
        ] {
            assert_eq!(
                fast_path_phrase(text),
                Some("metronome off"),
                "mangled 'metronome off' must still fast-path: {text:?}"
            );
        }
        for text in ["metranome on", "metro nome on"] {
            assert_eq!(fast_path_phrase(text), Some("metronome on"), "{text:?}");
        }
        for text in ["metranome stop", "metro gnome stop"] {
            assert_eq!(fast_path_phrase(text), Some("metronome stop"), "{text:?}");
        }
        // A natural form is longer than a breath and deliberately NOT on the
        // fast path — it routes normally, through the settle wait (S9).
        for text in [
            "can you stop the metronome",
            "turn the metronome off",
            "metronome please stop",
        ] {
            assert_eq!(
                fast_path_phrase(text),
                None,
                "natural forms take the normal settle path: {text:?}"
            );
        }
    }

    /// A mangled partial does not just match the allowlist, it acts: the whole
    /// point of the fold is that "metranome off" stops the metronome as fast as
    /// "metronome off" does.
    #[test]
    fn a_mangled_partial_stops_the_metronome() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        assert!(ctx.metro.snapshot().running);
        ctx.handle_fast_path(&final_at("metranome off", at + Duration::from_millis(10)));
        assert!(
            !ctx.metro.snapshot().running,
            "a mangled partial stops the metronome on the fast path"
        );
    }

    /// The core latency claim: a PARTIAL "metronome off" stops the metronome
    /// without waiting for the settler, and the settled final that arrives
    /// afterwards — with nothing else dispatched in between — is dropped: one
    /// stop, not two. (Review finding 1: an intervening genuine command now
    /// clears the guard instead of leaving this inert; that case is covered
    /// separately, so this test no longer restarts in between — it observes
    /// "not acted again" via the stop-event count rather than via toggling
    /// `running`, since the click is already stopped either way.)
    #[test]
    fn fast_path_partial_acts_and_its_settled_final_is_dropped() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        assert!(ctx.metro.snapshot().running);

        // The partial fires immediately (no settle wait).
        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        assert!(
            !ctx.metro.snapshot().running,
            "partial stopped the metronome"
        );

        // The settler's final for the SAME utterance lands 600 ms later, with
        // nothing intervening, and must be inert.
        ctx.handle_final(&final_at("metronome off", at + Duration::from_millis(610)));
        assert!(!ctx.metro.snapshot().running, "still stopped");

        let stops = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, p)| e == "voice://intent" && p["kind"] == json!("stop"))
            .count();
        assert_eq!(
            stops, 1,
            "the settled final of a fast-pathed utterance must not act again"
        );

        // Only one final transcript reached the frontend for that utterance.
        let offs = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, p)| e == "voice://transcript" && p["text"] == json!("metronome off"))
            .count();
        assert_eq!(offs, 1, "one final per utterance, not two");
    }

    /// The extension rule the plain identical-text dedup cannot express: the
    /// recognizer appended words after we already committed — and, since the
    /// extension still routes to the same intent, the intent-match guard
    /// catches it too. (Review finding 1: an intervening genuine command
    /// would clear the guard — covered separately — so this test has nothing
    /// intervene between the fire and the extended tail. The click is already
    /// stopped either way, so "not acted again" is observed via the stop-event
    /// count.)
    #[test]
    fn fast_path_suppresses_a_final_that_extends_the_fired_phrase() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        assert!(!ctx.metro.snapshot().running);

        ctx.handle_final(&final_at(
            "metronome off please",
            at + Duration::from_millis(700),
        ));

        let stops = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|(e, p)| e == "voice://intent" && p["kind"] == json!("stop"))
            .count();
        assert_eq!(
            stops, 1,
            "an extension of the fired phrase, with nothing intervening, must not act again"
        );
    }

    /// The guard expires with the dedup window: a genuine second command, spoken
    /// later, still acts.
    #[test]
    fn fast_path_guard_expires_with_the_dedup_window() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        ctx.handle_final(&final_at("metronome 120", at + Duration::from_millis(20)));

        // Keyed on the PARTIAL's timestamp (at + 10 ms), so clear that instead.
        ctx.handle_final(&final_at(
            "metronome off",
            at + DEDUP_WINDOW + Duration::from_millis(100),
        ));
        assert!(
            !ctx.metro.snapshot().running,
            "a genuine later stop must still act"
        );
    }

    /// A partial that live state makes inert ("stop" with the metronome already
    /// stopped) takes no action, so it must NOT arm the tail guard — the longer
    /// utterance it was a prefix of stays free to route. No phrase on the
    /// trimmed allowlist can reach this state any more, so the call below drives
    /// `handle_fast_path` directly: the rule is what makes it safe to ever add a
    /// state-gated phrase back, and it is worth keeping proven.
    #[test]
    fn an_ignored_fast_path_partial_does_not_arm_the_guard() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();

        ctx.handle_fast_path(&final_at("stop", at));
        assert!(ctx.fast_path.is_none(), "an ignored partial arms nothing");
        assert!(rec.said.lock().unwrap().is_empty());

        // The same words as the start of a real later command still route.
        ctx.handle_final(&final_at("metronome 120", at + Duration::from_millis(100)));
        assert!(ctx.metro.snapshot().running);
    }

    /// B70(a): the tail guard used to key on a TEXT PREFIX match, so a settled
    /// final that only shares its opening words with the fired partial — but
    /// routes to a genuinely different intent — was swallowed. "metronome on"
    /// fires `MetroStart(None)` (a bare resume) on the partial; the settled
    /// final "metronome on ninety six" routes to `MetroStart(Some(96))`, a
    /// different intent, and MUST reach the router so the tempo actually lands.
    #[test]
    fn a_final_with_a_different_intent_is_not_swallowed_by_the_tail_guard() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();

        replay_partial_stream(&mut ctx, "metronome on ninety six", at);

        assert!(ctx.metro.snapshot().running, "click should be running");
        assert_eq!(
            ctx.metro.snapshot().bpm,
            96.0,
            "the settled final must set 96, not keep the resumed tempo"
        );
    }

    /// B70(b): the mirror bug — an ambient final that merely happens to START
    /// with the fired phrase's words, but routes to `Ignored`, used to be
    /// dropped by the old prefix match: silently, without ever reaching the
    /// frontend. It must surface in the transcript like any other ambient
    /// speech, and — since a real routed action already restarted the click in
    /// between — it must not phantom-stop it.
    #[test]
    fn an_ambient_final_routing_to_ignored_does_not_phantom_act() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));

        replay_partial_stream(&mut ctx, "metronome off", at + Duration::from_millis(50));
        assert!(!ctx.metro.snapshot().running);

        // Click deliberately restarted by a later, genuine command.
        ctx.handle_final(&final_at("metronome 120", at + Duration::from_millis(700)));
        assert!(ctx.metro.snapshot().running);

        // An unrelated ambient sentence that merely starts with "metronome off",
        // inside the dedup window of the fired partial, but routes to Ignored.
        ctx.handle_final(&final_at(
            "metronome off the whole time honestly",
            at + Duration::from_millis(1200),
        ));
        assert!(
            ctx.metro.snapshot().running,
            "an Ignored-routing ambient sentence must not phantom-stop"
        );
        assert!(
            rec.events
                .lock()
                .unwrap()
                .iter()
                .any(|(e, p)| e == "voice://transcript"
                    && p["text"] == json!("metronome off the whole time honestly")),
            "the ambient final must surface, not be swallowed"
        );
    }

    /// Review finding 1, PROBE-A: the guard used to stay armed for the whole
    /// window even after an unrelated genuine command dispatched in between,
    /// so a LATER final that happens to share the fired intent was wrongly
    /// judged against a fire that was already history. Sequence: fast-path
    /// "metronome off" fires (guard = MetroStop); a genuine "metronome 132"
    /// restarts the click (a different intent — does not consume the guard by
    /// matching, but MUST clear it because it is itself a dispatched command);
    /// then, still inside the ORIGINAL fire's dedup window, a genuine
    /// out-of-allowlist "turn the metronome off" arrives. It must stop the
    /// click — the stale guard must not have swallowed it.
    #[test]
    fn a_genuine_command_between_the_fire_and_a_later_same_intent_final_clears_the_guard() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();

        ctx.handle_final(&final_at("metronome 120", at));
        assert!(ctx.metro.snapshot().running);

        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        assert!(!ctx.metro.snapshot().running, "the fast path stopped it");

        // An intervening genuine command — a different intent, so it is not
        // suppressed by the guard, but it dispatches and must clear it.
        ctx.handle_final(&final_at("metronome 132", at + Duration::from_millis(20)));
        assert!(ctx.metro.snapshot().running, "the restart must act");
        assert_eq!(ctx.metro.snapshot().bpm, 132.0);

        // Still well inside DEDUP_WINDOW of the ORIGINAL "metronome off" fire
        // (10ms + 1600ms = 1610ms < 2500ms), a genuine later stop, spoken in a
        // form outside the fast-path allowlist, must still act.
        ctx.handle_final(&final_at(
            "turn the metronome off",
            at + Duration::from_millis(1600),
        ));
        assert!(
            !ctx.metro.snapshot().running,
            "a genuine later stop must not be swallowed by a stale, already-superseded guard"
        );
    }

    /// Review finding 1, PROBE-B: the mirror of PROBE-A with `MetroStart(None)`
    /// as the fired intent. Fast-path "metronome on" fires (bare resume); a
    /// genuine "metronome off" intervenes and must clear the guard; a later
    /// genuine "start the metronome" (also a bare resume — same intent as the
    /// original fire) must still act rather than being swallowed against the
    /// now-superseded fire.
    #[test]
    fn a_genuine_command_between_the_fire_and_a_later_same_intent_final_clears_the_guard_for_start()
    {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();

        ctx.handle_final(&final_at("metronome 120", at));
        ctx.handle_final(&final_at("metronome off", at + Duration::from_millis(5)));
        assert!(!ctx.metro.snapshot().running);

        ctx.handle_fast_path(&final_at("metronome on", at + Duration::from_millis(10)));
        assert!(ctx.metro.snapshot().running, "the fast path resumed it");

        // An intervening genuine command — a different intent — dispatches and
        // must clear the guard.
        ctx.handle_final(&final_at("metronome off", at + Duration::from_millis(20)));
        assert!(
            !ctx.metro.snapshot().running,
            "the intervening stop must act"
        );

        // Still well inside DEDUP_WINDOW of the ORIGINAL "metronome on" fire, a
        // genuine later resume, spoken outside the fast-path allowlist, must
        // still act rather than being swallowed against the superseded fire.
        ctx.handle_final(&final_at(
            "start the metronome",
            at + Duration::from_millis(1600),
        ));
        assert!(
            ctx.metro.snapshot().running,
            "a genuine later start must not be swallowed by a stale, already-superseded guard"
        );
    }

    /// Review finding 1: the guard suppresses AT MOST ONE final. Once it has
    /// consumed itself by suppressing the settled tail, a SECOND final that
    /// happens to share the same routed intent — still inside the original
    /// fire's window, with no new fast-path fire in between — must NOT be
    /// suppressed again: it surfaces its own transcript like any other routed
    /// command (the click is already stopped, so the stop action itself is
    /// idempotent, but the final itself must not be silently eaten).
    #[test]
    fn the_tail_guard_suppresses_at_most_one_final() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));
        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        assert!(!ctx.metro.snapshot().running);

        let events_before = rec.events.lock().unwrap().len();

        // The settled tail of the SAME utterance: same intent, inside the
        // window — suppressed, and fully silent (no event at all), exactly as
        // before. The guard is consumed here.
        ctx.handle_final(&final_at("metronome off", at + Duration::from_millis(50)));
        assert_eq!(
            rec.events.lock().unwrap().len(),
            events_before,
            "the first tail final must still be fully silent"
        );

        // A second, differently-worded but same-intent final, still inside the
        // ORIGINAL fire's window, and with no new fast-path fire re-arming the
        // guard: must NOT be suppressed a second time.
        ctx.handle_final(&final_at(
            "turn the metronome off",
            at + Duration::from_millis(200),
        ));
        assert!(
            rec.events
                .lock()
                .unwrap()
                .iter()
                .any(|(e, p)| e == "voice://transcript"
                    && p["text"] == json!("turn the metronome off")),
            "a second same-intent final must not be swallowed by an already-consumed guard"
        );
    }

    /// Review finding 2 (ruled accepted-as-designed, pinned by regression
    /// test): an out-of-vocabulary settled tail — the fast path fired on
    /// "metronome off", but the settler's full utterance carries trailing
    /// words that make it route to `Ignored`, not `MetroStop` — is NOT
    /// suppressed by the tail guard (which only matches on routed INTENT). It
    /// surfaces honestly as a second `handled = false` final, exactly the
    /// intended consequence of routed-intent suppression: hiding heard speech
    /// from the user is the recorded anti-lesson, worse than a duplicate pill.
    /// Pinned here: exactly one stop action fires (from the partial), the
    /// out-of-vocab tail does not touch metronome state, and it surfaces as
    /// its own ambient transcript.
    #[test]
    fn an_out_of_vocab_tail_surfaces_honestly_and_does_not_touch_state() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();
        ctx.handle_final(&final_at("metronome 120", at));

        ctx.handle_fast_path(&final_at("metronome off", at + Duration::from_millis(10)));
        assert!(!ctx.metro.snapshot().running, "the fast path stopped it");

        ctx.handle_final(&final_at(
            "metronome off now ok",
            at + Duration::from_millis(600),
        ));

        assert!(
            !ctx.metro.snapshot().running,
            "the out-of-vocab tail must not touch metronome state"
        );

        let events = rec.events.lock().unwrap();
        let stops = events
            .iter()
            .filter(|(e, p)| e == "voice://intent" && p["kind"] == json!("stop"))
            .count();
        assert_eq!(stops, 1, "exactly one stop action, from the partial");

        assert!(
            events.iter().any(|(e, p)| e == "voice://transcript"
                && p["text"] == json!("metronome off now ok")
                && p["handled"] == json!(false)),
            "the out-of-vocab tail must surface as its own ambient final"
        );
    }

    /// Mute wins over the fast path exactly as it wins over a final.
    #[test]
    fn fast_path_is_inert_while_muted() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome 120"));
        ctx.muted.store(true, Ordering::Release);
        ctx.handle_fast_path(&final_t("metronome off"));
        assert!(ctx.metro.snapshot().running, "muted mic actions nothing");
    }

    #[test]
    fn ambient_speech_is_silent() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("I stopped by the store yesterday"));
        assert!(rec.said.lock().unwrap().is_empty(), "no confirmation");
        assert!(!ctx.metro.snapshot().running);
        // Ambient speech takes no action, but its transcript still reaches the
        // frontend marked handled=false so Lane B may draft it. That transcript
        // is the ONLY event — no intent or state event is emitted.
        let events = rec.events.lock().unwrap();
        assert_eq!(events.len(), 1, "only the transcript event: {events:?}");
        assert_eq!(events[0].0, "voice://transcript");
        assert_eq!(events[0].1["handled"], json!(false));
    }

    /// The double-open regression guard (backend half): a final the router routes
    /// and acts on carries handled=true on its transcript; a final the backend
    /// declines to route carries handled=false. The frontend gates Lane B on this
    /// authoritative flag so a backend-routed command never also drafts.
    #[test]
    fn final_transcript_carries_authoritative_routing_outcome() {
        // A routed final (the canonical rep-open command) → handled=true.
        let routed = Arc::new(Recorder::default());
        let mut routed_ctx = test_ctx(&routed);
        routed_ctx.handle_final(&final_t("start a rep tracker measures 40 to 56 at 80"));
        assert!(routed_ctx.rep.active(), "rep-open routed and acted");
        assert_eq!(transcript_handled(&routed), Some(true));

        // An ambient final the backend declines to route → handled=false.
        let ambient = Arc::new(Recorder::default());
        let mut ambient_ctx = test_ctx(&ambient);
        ambient_ctx.handle_final(&final_t("i think that sounded warmer"));
        assert!(!ambient_ctx.rep.active(), "ambient speech opens nothing");
        assert_eq!(transcript_handled(&ambient), Some(false));
    }

    /// The `handled` flag on the single emitted `voice://transcript`, if any.
    fn transcript_handled(rec: &Arc<Recorder>) -> Option<bool> {
        rec.events
            .lock()
            .unwrap()
            .iter()
            .find(|(e, _)| e == "voice://transcript")
            .and_then(|(_, p)| p["handled"].as_bool())
    }

    /// The most recently emitted payload for `event`, if any — mirrors the
    /// plan's illustrative `emitter.last_payload(...)`, adapted to the real
    /// `Recorder`/`RecEmitter` harness (a flat `Vec<(String, Value)>`).
    fn last_payload(rec: &Arc<Recorder>, event: &str) -> Option<serde_json::Value> {
        rec.events
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(e, _)| e == event)
            .map(|(_, p)| p.clone())
    }

    // --- D1: voice latency instrumentation (the honest baseline) ----------
    //
    // Only the app-side span is measurable: first partial → action complete.
    // `Transcript.at` on a settled FINAL is stamped by the settler at emit
    // time (`stt/supervisor.rs`), ~600 ms after the last partial — using it as
    // the start would silently absorb the very wait this instrument exists to
    // show. See the module docs and `ActionCtx::take_app_ms`.

    #[test]
    fn a_routed_final_reports_the_app_side_latency_it_can_actually_measure() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let started = Instant::now();

        // A partial opens the utterance, a final closes it.
        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: started,
        });
        ctx.handle_final(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: started + Duration::from_millis(700),
        });

        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        let app_ms = payload["app_ms"]
            .as_u64()
            .expect("app_ms present on a routed final");
        assert!(
            app_ms >= 700,
            "app_ms must span from the FIRST PARTIAL, not the final: got {app_ms}"
        );
    }

    #[test]
    fn an_ignored_final_still_reports_latency_so_misses_are_measurable() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let started = Instant::now();
        ctx.handle_partial(&Transcript {
            text: "something the router".to_string(),
            is_final: false,
            at: started,
        });
        ctx.handle_final(&Transcript {
            text: "something the router ignores".to_string(),
            is_final: true,
            at: started + Duration::from_millis(400),
        });
        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        assert!(
            payload["app_ms"].is_u64(),
            "an Ignored final must carry app_ms too — invisible misses are the whole D1 complaint"
        );
    }

    #[test]
    fn a_final_with_no_tracked_partial_publishes_no_figure_rather_than_zero() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&Transcript {
            text: "something the router ignores".to_string(),
            is_final: true,
            at: Instant::now(),
        });
        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        assert!(
            payload.get("app_ms").is_none(),
            "with nothing to measure from, the field must be ABSENT — a flat 0 renders as \
             'app 0.0s', a measurement the app never made: {payload}"
        );
    }

    #[test]
    fn muting_ends_the_tracked_utterance_so_it_is_not_charged_to_the_next_command() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let started = Instant::now();

        // A partial opens an utterance, then the mic is muted before any final.
        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: started,
        });
        ctx.muted.store(true, Ordering::Release);
        ctx.handle_final(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: started + Duration::from_millis(300),
        });
        assert!(
            ctx.utterance_start.is_none(),
            "muting must end the in-flight utterance"
        );

        // Much later, unmuted, the user speaks a fresh command.
        ctx.muted.store(false, Ordering::Release);
        let later = started + Duration::from_secs(600);
        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: later,
        });
        ctx.handle_final(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: later + Duration::from_millis(500),
        });

        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        let app_ms = payload["app_ms"].as_u64().expect("app_ms present");
        assert!(
            app_ms < 2_000,
            "the muted stretch must not be charged to the next command: got {app_ms} ms"
        );
    }

    #[test]
    fn a_partial_after_a_fast_path_fire_is_not_charged_to_the_next_command() {
        // Refutation found by adversarial verification of the first D1 fix.
        // The fast-path fire clears the tracked start, but the engine keeps
        // streaming interim partials for the SAME utterance; one of them sees
        // `None` and re-arms the start. The settled final is then dropped by
        // the tail guard, which used to return WITHOUT clearing — so the stray
        // start was charged to whatever the user said next.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let started = Instant::now();

        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: started,
        });
        // The fast path acts on the partial and charges the utterance.
        ctx.handle_fast_path(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: started + Duration::from_millis(200),
        });
        // The engine keeps streaming this same utterance; this re-arms the start.
        ctx.handle_partial(&Transcript {
            text: "metronome off pl".to_string(),
            is_final: false,
            at: started + Duration::from_millis(300),
        });
        // Its settled final is swallowed by the tail guard.
        ctx.handle_final(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: started + Duration::from_millis(900),
        });
        assert!(
            ctx.utterance_start.is_none(),
            "the swallowed tail final must still end the utterance"
        );

        // A genuinely fast later command must report its OWN latency.
        let later = started + Duration::from_secs(8);
        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: later,
        });
        ctx.handle_final(&Transcript {
            text: "metronome on".to_string(),
            is_final: true,
            at: later + Duration::from_millis(400),
        });
        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        let app_ms = payload["app_ms"].as_u64().expect("app_ms present");
        assert!(
            app_ms < 2_000,
            "a stray start from the previous utterance's tail must not be charged here: got \
             {app_ms} ms"
        );
    }

    #[test]
    fn an_utterance_the_engine_never_finalised_is_aged_out_not_charged_to_the_next_one() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let started = Instant::now();

        // Christian's actual complaint: he speaks, the OS never finalises it.
        ctx.handle_partial(&Transcript {
            text: "done".to_string(),
            is_final: false,
            at: started,
        });

        // Minutes later he speaks a command that DOES land.
        let later = started + Duration::from_secs(300);
        ctx.handle_partial(&Transcript {
            text: "metro".to_string(),
            is_final: false,
            at: later,
        });
        ctx.handle_final(&Transcript {
            text: "metronome off".to_string(),
            is_final: true,
            at: later + Duration::from_millis(500),
        });

        let payload = last_payload(&rec, "voice://transcript").expect("transcript emitted");
        let app_ms = payload["app_ms"].as_u64().expect("app_ms present");
        assert!(
            app_ms < 2_000,
            "a dead utterance's start must not be charged to a later command: got {app_ms} ms"
        );
    }

    #[test]
    fn brain_answer_is_bounded_and_queued_for_the_voice_owner() {
        let recorder = Arc::new(Recorder::default());
        let (tx, rx) = mpsc::channel();
        let capture_suspended = Arc::new(AtomicBool::new(false));
        let voice = VoiceLoop {
            capture: Mutex::new(CaptureRuntime {
                handle: None,
                config: SttConfig::hear("/usr/bin/true".into()),
                sink: Arc::new(|_| {}),
                leases: BTreeSet::new(),
                requests: BTreeMap::new(),
                next_epoch: 0,
                resume_after_leases: false,
            }),
            action_tx: Mutex::new(Some(tx)),
            action_thread: Mutex::new(None),
            gate: Arc::new(AtomicBool::new(true)),
            muted: Arc::new(AtomicBool::new(false)),
            capture_suspended,
            shutting_down: AtomicBool::new(false),
            speech_muted: Arc::new(AtomicBool::new(true)),
            settle_ms: Arc::new(AtomicU64::new(600)),
            status: Arc::new(Mutex::new(VoiceStatus {
                muted: false,
                down: None,
            })),
            emitter: Arc::new(RecEmitter(recorder)),
        };
        assert_eq!(voice.settle_ms(), 600);
        voice.set_settle_ms(350);
        assert_eq!(voice.settle_ms(), 350);
        voice
            .speak_brain_answer("Use three silent landings.")
            .unwrap();
        match rx.recv().unwrap() {
            ActionMessage::SpeakBrain(answer) => {
                assert_eq!(answer, "Use three silent landings.")
            }
            ActionMessage::Transcript(_)
            | ActionMessage::FastPath(_)
            | ActionMessage::Partial(_)
            | ActionMessage::Shutdown => {
                panic!("expected a brain speech message")
            }
        }
        assert!(voice.speak_brain_answer("").is_err());
        assert!(voice.speak_brain_answer(&"x".repeat(4_001)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn listen_back_capture_leases_release_and_restore_the_native_process_once() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let unique = TEST_PIECE_SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir();
        let script = dir.join(format!(
            "fake_hear_capture_{}_{}.sh",
            std::process::id(),
            unique
        ));
        let pid_log = dir.join(format!(
            "fake_hear_capture_{}_{}.pids",
            std::process::id(),
            unique
        ));
        {
            let mut file = std::fs::File::create(&script).unwrap();
            writeln!(file, "#!/bin/sh").unwrap();
            writeln!(file, "echo $$ >> \"$CK_CAPTURE_PID_LOG\"").unwrap();
            writeln!(file, "trap 'exit 0' TERM").unwrap();
            writeln!(file, "while :; do sleep 1; done").unwrap();
            let mut permissions = file.metadata().unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&script, permissions).unwrap();
        }

        let rec = Arc::new(Recorder::default());
        let ctx = test_ctx(&rec);
        let mut config = SttConfig::hear(script.clone());
        config.args.clear();
        config.use_stdbuf = false;
        config.env.insert(
            "CK_CAPTURE_PID_LOG".into(),
            pid_log.to_string_lossy().into_owned(),
        );
        let voice = VoiceLoop::start_with(
            Arc::new(RecEmitter(rec.clone())),
            ctx.metro,
            ctx.store,
            ctx.rep,
            ctx.sessions,
            config,
            None,
            move |_m, _g, _mu, _cs, _sm| Box::new(RecConfirm(rec)),
        );

        let read_pids = || -> Vec<i32> {
            std::fs::read_to_string(&pid_log)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| line.parse().ok())
                .collect()
        };
        let wait_for_pid_count = |count: usize| -> Vec<i32> {
            for _ in 0..100 {
                let pids = read_pids();
                if pids.len() >= count {
                    return pids;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            panic!("fake recognizer did not reach spawn count {count}");
        };

        let original_pid = wait_for_pid_count(1)[0];
        assert!(!voice.resume_capture("already-unmounted").unwrap());
        assert_eq!(
            voice.suspend_capture("already-unmounted").unwrap(),
            0,
            "a late suspend cannot outrun an unmount release"
        );
        assert_eq!(read_pids().len(), 1);
        // User mute is independent state and must survive the physical capture
        // handoff exactly as it was.
        voice.set_muted(true);
        let first = voice.suspend_capture("review-a").unwrap();
        assert_eq!(
            voice.suspend_capture("review-a").unwrap(),
            first,
            "a lost suspend reply can retry without leaking another lease"
        );
        let second = voice.suspend_capture("review-b").unwrap();
        assert!(second > first, "overlapping owners receive ordered epochs");
        assert!(voice.capture_suspended.load(Ordering::Acquire));
        assert_eq!(
            unsafe { libc::kill(original_pid, 0) },
            -1,
            "suspend must terminate and reap the process that owned the mic"
        );

        assert!(!voice.resume_capture("review-a").unwrap());
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(read_pids().len(), 1, "one live lease keeps capture down");
        assert!(voice.resume_capture("review-b").unwrap());
        let pids = wait_for_pid_count(2);
        assert_ne!(pids[0], pids[1], "resume starts a fresh recognizer owner");
        assert!(voice.state().muted, "review must preserve the user's mute");
        assert!(
            !voice.gate.load(Ordering::Acquire),
            "a resumed recognizer stays gated while the user remains muted"
        );

        assert!(
            !voice.resume_capture("review-b").unwrap(),
            "a duplicate/stale release cannot restart capture again"
        );
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(read_pids().len(), 2, "capture was restored exactly once");

        voice.set_muted(false);
        assert!(voice.gate.load(Ordering::Acquire));
        voice.shutdown();
        let _ = std::fs::remove_file(&script);
        let _ = std::fs::remove_file(&pid_log);
    }

    #[test]
    fn capture_suspension_drops_a_queued_tail_before_it_can_act() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.capture_suspended.store(true, Ordering::Release);
        ctx.handle_final(&final_t("metronome ninety six"));
        assert!(!ctx.metro.snapshot().running);
        assert!(
            rec.events.lock().unwrap().is_empty(),
            "a final already queued at the capture boundary stays inert"
        );
    }

    #[test]
    fn spurious_duplicate_final_is_deduped() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome 100"));
        ctx.handle_final(&final_t("metronome 100")); // spurious repeat
                                                     // Only one confirmation despite two identical finals.
        assert_eq!(rec.acks(), 1);
    }

    // -------------------------------------------------------- ACK POLICY (S9)
    // See the module docs, "Ack policy". These pin the split itself — which
    // outcome gets words and which gets a blip — and the chime's gate ordering.

    /// The chime rides the same half-duplex cycle as speech: gate CLOSED before
    /// the first sample is enqueued, gate reopened only after the buffer has
    /// drained. This is the property that lets the sliding-window dedup stay
    /// safe with a silent-ish ack (module docs, "Dedup policy").
    #[test]
    fn chime_closes_the_gate_before_playing_and_reopens_after_draining() {
        #[derive(Default)]
        struct Log(Mutex<Vec<String>>);
        struct FakeSink(Arc<Log>);
        impl PcmSink for FakeSink {
            fn enqueue(&self, samples: &[f32], _rate: u32) -> Result<(), crate::audio::PcmError> {
                self.0
                     .0
                    .lock()
                    .unwrap()
                    .push(format!("enqueue {}", samples.len()));
                Ok(())
            }
            fn done(&self) -> bool {
                true
            }
        }
        struct FakeGate(Arc<Log>);
        impl Gate for FakeGate {
            fn set_gate(&self, open: bool) {
                self.0 .0.lock().unwrap().push(format!("gate {open}"));
            }
        }

        let log = Arc::new(Log::default());
        let config = SpeakerConfig {
            reopen_delay: Duration::from_millis(1),
            poll_interval: Duration::from_millis(1),
            retry_delay: Duration::from_millis(1),
            chunk_samples: 4096,
        };
        let chime = crate::audio::chime::ack_chime();
        play_pcm_gated(
            &FakeSink(log.clone()),
            &FakeGate(log.clone()),
            &config,
            chime,
            crate::audio::chime::CHIME_RATE,
        );

        let log = log.0.lock().unwrap();
        assert_eq!(log.first().map(String::as_str), Some("gate false"));
        assert_eq!(log.last().map(String::as_str), Some("gate true"));
        let enqueued: usize = log
            .iter()
            .filter_map(|line| line.strip_prefix("enqueue "))
            .map(|n| n.parse::<usize>().unwrap())
            .sum();
        assert_eq!(
            enqueued,
            chime.len(),
            "the whole chime was played, not part"
        );
        assert_eq!(
            log.iter().filter(|l| l.starts_with("gate")).count(),
            2,
            "exactly one close and one reopen"
        );
    }

    // ------------------------------------------------------- SPEECH MUTE (A)
    // Christian: "i dont want the voice to talk when i say again or restart
    // sets or anything just have that turned off for now." Muting must not cost
    // him the acknowledgement itself, so `say` degrades to the chime rather than
    // to silence. These exercise the REAL `AckPlayer` — the flag lives on the
    // production impl, so a recording double would prove nothing.

    /// Records everything an [`AckPlayer`] does to the world: what the provider
    /// was asked to synthesize, how many samples reached the sink, and every
    /// gate transition.
    #[derive(Default)]
    struct AckSpy {
        synthesized: Mutex<Vec<String>>,
        enqueued: AtomicUsize,
        gate: Mutex<Vec<bool>>,
    }

    /// One short buffer, whatever the text — this test is about which path ran,
    /// not about audio content.
    const SPY_SYNTH_SAMPLES: usize = 32;

    struct SpyProvider(Arc<AckSpy>);
    impl crate::tts::TtsProvider for SpyProvider {
        fn synth(&self, text: &str) -> crate::tts::Result<crate::tts::Pcm> {
            self.0.synthesized.lock().unwrap().push(text.to_string());
            Ok(crate::tts::Pcm {
                rate: 24_000,
                mono_f32: vec![0.0; SPY_SYNTH_SAMPLES],
            })
        }
    }

    struct SpySink(Arc<AckSpy>);
    impl PcmSink for SpySink {
        fn enqueue(&self, samples: &[f32], _rate: u32) -> Result<(), PcmError> {
            self.0.enqueued.fetch_add(samples.len(), Ordering::Relaxed);
            Ok(())
        }
        fn done(&self) -> bool {
            true
        }
    }

    struct SpyGate(Arc<AckSpy>);
    impl Gate for SpyGate {
        fn set_gate(&self, open: bool) {
            self.0.gate.lock().unwrap().push(open);
        }
    }

    /// A production [`AckPlayer`] with the audio device and the network replaced
    /// by `spy`, and its mute flag preset.
    fn spy_ack_player(spy: &Arc<AckSpy>, muted: bool) -> AckPlayer {
        let sink: Arc<dyn PcmSink> = Arc::new(SpySink(spy.clone()));
        let gate: Arc<dyn Gate> = Arc::new(SpyGate(spy.clone()));
        let config = SpeakerConfig {
            reopen_delay: Duration::from_millis(1),
            poll_interval: Duration::from_millis(1),
            retry_delay: Duration::from_millis(1),
            chunk_samples: 4096,
        };
        AckPlayer {
            speaker: Speaker::spawn(
                Box::new(SpyProvider(spy.clone())),
                sink.clone(),
                gate.clone(),
                config.clone(),
            ),
            sink,
            gate,
            config,
            speech_muted: Arc::new(AtomicBool::new(muted)),
        }
    }

    #[test]
    fn muted_say_chimes_instead_of_speaking() {
        let spy = Arc::new(AckSpy::default());
        let player = spy_ack_player(&spy, true);
        player.say("Ninety-six.");

        assert!(
            spy.synthesized.lock().unwrap().is_empty(),
            "muted, no text may reach a TTS provider"
        );
        assert_eq!(
            spy.enqueued.load(Ordering::Relaxed),
            crate::audio::chime::ack_chime().len(),
            "the ack is not lost — the whole chime played in the words' place"
        );
        let gate = spy.gate.lock().unwrap();
        assert_eq!(
            gate.as_slice(),
            [false, true],
            "the chime runs the same single close/reopen half-duplex cycle speech does"
        );
    }

    #[test]
    fn unmuted_say_still_speaks_the_words_verbatim() {
        let spy = Arc::new(AckSpy::default());
        let player = spy_ack_player(&spy, false);
        player.say("Ninety-six.");

        assert_eq!(
            spy.synthesized.lock().unwrap().as_slice(),
            ["Ninety-six.".to_string()],
            "unmuted behaviour is unchanged: the exact ack text is synthesized"
        );
        assert_eq!(
            spy.enqueued.load(Ordering::Relaxed),
            SPY_SYNTH_SAMPLES,
            "the utterance played, not the chime"
        );
        assert_eq!(
            spy.gate.lock().unwrap().as_slice(),
            [false, true],
            "one gate cycle either way — the flag cannot strand the mic"
        );
    }

    /// The flag is shared, not copied: flipping it on the [`VoiceLoop`] reaches
    /// an `AckPlayer` already living on the action thread, which is what makes
    /// the settings toggle apply without a relaunch.
    #[test]
    fn the_mute_flag_is_shared_with_the_live_ack_player() {
        let spy = Arc::new(AckSpy::default());
        let flag = Arc::new(AtomicBool::new(false));
        let mut player = spy_ack_player(&spy, false);
        player.speech_muted = flag.clone();

        player.say("Ninety-six.");
        flag.store(true, Ordering::Relaxed);
        player.say("One hundred twenty.");

        assert_eq!(
            spy.synthesized.lock().unwrap().len(),
            1,
            "only the pre-mute ack was spoken; the flip took effect immediately"
        );
    }

    /// The rep half of the split, walked through one real block: routine cleans
    /// chime, the one-away rep and the mastery rep speak, and a miss speaks
    /// because a reset streak is news.
    #[test]
    fn rep_acks_chime_when_routine_and_speak_when_they_carry_information() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        // No target tempo => judged by the mastery streak, requirement 4.
        ctx.rep
            .open(crate::store::model::RepOpenArgs {
                tuning: Default::default(),
                piece_id: 1,
                region_id: None,
                m_start: 1,
                m_end: 4,
                label: None,
                start_bpm: 80.0,
                target_bpm: None,
                planned_reps: Some(30),
                required_clean_streak: Some(4),
                attempt_target: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();

        let mut at = Instant::now();
        let mut rep = |ctx: &mut ActionCtx, text: &str| {
            // Space the finals well past DEDUP_WINDOW: these are genuine reps.
            at += Duration::from_millis(4000);
            let mut t = final_t(text);
            t.at = at;
            ctx.handle_final(&t);
        };

        rep(&mut ctx, "done"); // streak 1 of 4 — routine
        assert_eq!(rec.chimes(), 1, "first clean rep chimed");
        assert!(rec.said.lock().unwrap().is_empty());

        rep(&mut ctx, "again"); // a miss: streak reset — news
        assert_eq!(rec.chimes(), 2, "a miss chimes immediately before detail");
        assert_eq!(
            rec.said.lock().unwrap().len(),
            1,
            "a miss speaks the reset: {:?}",
            rec.said.lock().unwrap()
        );

        rep(&mut ctx, "done"); // 1 of 4
        rep(&mut ctx, "done"); // 2 of 4
        assert_eq!(rec.chimes(), 4, "every verdict chimes");
        rep(&mut ctx, "done"); // 3 of 4 — one away, the "three in a row" cue
        assert_eq!(rec.chimes(), 5, "one-away chimes, then speaks");
        rep(&mut ctx, "done"); // 4 of 4 — mastery
        let said = rec.said.lock().unwrap();
        assert_eq!(said.len(), 3, "miss + one-away + mastery: {said:?}");
        assert!(
            said.last().unwrap().starts_with("Mastery earned"),
            "said: {said:?}"
        );
    }

    #[test]
    fn default_off_rep_ack_is_one_immediate_chime_with_no_spoken_followup() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.speaker = Box::new(QuietRecConfirm(rec.clone()));
        open_test_block(&ctx);
        ctx.handle_final(&final_t("again"));
        assert_eq!(rec.chimes(), 1);
        assert!(rec.said.lock().unwrap().is_empty());
    }

    #[test]
    fn voice_can_add_and_undo_counted_reps_through_the_native_engine() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        open_test_block(&ctx);
        let at = Instant::now();

        ctx.handle_final(&final_at("add three cleans", at));
        let added = ctx.rep.snapshot().unwrap();
        assert_eq!(added.tries, 3);
        assert_eq!(added.attempts_recorded, 3);
        assert_eq!(added.verdicts.clean, 3);
        let add_event = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .find(|(event, payload)| {
                event == "voice://intent" && payload["kind"] == json!("rep_add")
            })
            .cloned()
            .expect("counted add intent");
        assert_eq!(add_event.1["count"], json!(3));

        ctx.handle_final(&final_at("take two back", at + Duration::from_secs(3)));
        let undone = ctx.rep.snapshot().unwrap();
        assert_eq!(undone.attempts_recorded, 3, "undo stays append-only");
        assert_eq!(undone.tries, 1);
        assert_eq!(undone.voided_attempts, 2);
        assert_eq!(undone.verdicts.clean, 1);
        let undo_event = rec
            .events
            .lock()
            .unwrap()
            .iter()
            .find(|(event, payload)| {
                event == "voice://intent" && payload["kind"] == json!("rep_undo")
            })
            .cloned()
            .expect("counted undo intent");
        assert_eq!(undo_event.1["count"], json!(2));
        assert_eq!(rec.chimes(), 2, "one immediate chime per spoken command");
    }

    #[test]
    fn counted_undo_rejects_without_partially_mutating_the_set() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        open_test_block(&ctx);
        let at = Instant::now();
        ctx.handle_final(&final_at("count that", at));
        ctx.handle_final(&final_at("take two back", at + Duration::from_secs(3)));

        let snap = ctx.rep.snapshot().unwrap();
        assert_eq!(snap.tries, 1);
        assert_eq!(snap.voided_attempts, 0);
        assert!(rec.events.lock().unwrap().iter().any(|(event, payload)| {
            event == "voice://intent" && payload["kind"] == json!("rep_undo_rejected")
        }));
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
    #[cfg(unix)]
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
        let rep = ctx.rep.clone();
        let sessions = ctx.sessions.clone();
        let rec_for_speaker = rec.clone();

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![]; // the fake ignores args
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200); // finalize quickly for the test

        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(rec.clone()));
        let voice = VoiceLoop::start_with(
            emitter,
            metro.clone(),
            store,
            rep,
            sessions,
            cfg,
            None,
            move |_m, _g, _mu, _cs, _sm| Box::new(RecConfirm(rec_for_speaker)),
        );

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

        assert!(
            started,
            "fake-hear command started the metronome end-to-end"
        );
        assert_eq!(metro.snapshot().bpm, 96.0);
        assert_eq!(
            rec.chimes(),
            1,
            "chimed the confirmation (a start is routine — ack policy)"
        );
    }

    /// END-TO-END rep-tracker hero flow through the REAL STT supervisor (no mic,
    /// no audio device): a fake `hear` prints the hero open phrase, then two
    /// `done` lines spaced > 2.5 s apart (so the dedup treats them as distinct
    /// reps). Asserts the block opened for the SELECTED piece, the metronome
    /// started at 80, both reps persisted to the store, and the spoken acks were
    /// recorded. This is the deterministic stand-in for the "speak the hero
    /// phrase" live smoke the brief calls for (a mic cannot be driven here).
    #[cfg(unix)]
    #[test]
    fn e2e_fake_hear_rep_tracker_hero_flow() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir();
        let script = dir.join(format!("fake_hear_rep_{}.sh", std::process::id()));
        {
            let mut f = std::fs::File::create(&script).unwrap();
            writeln!(f, "#!/bin/sh").unwrap();
            writeln!(
                f,
                "/usr/bin/printf 'open a rep tracker measures 40 to 56 start at 80 target 120\\n'"
            )
            .unwrap();
            writeln!(f, "sleep 3").unwrap();
            writeln!(f, "/usr/bin/printf 'done\\n'").unwrap();
            writeln!(f, "sleep 3").unwrap();
            writeln!(f, "/usr/bin/printf 'done\\n'").unwrap();
            writeln!(f, "sleep 3").unwrap();
            let mut perms = f.metadata().unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script, perms).unwrap();
        }

        // Mock-engine metronome + a store seeded with a SELECTED piece.
        let metro = Arc::new(crate::metronome::Metronome::with_seams(
            Default::default(),
            crate::metronome::MetroState::default(),
            80,
            |_cfg| Ok(crate::audio::EngineHandle::test_handle(48_000, 0)),
            |lvl| crate::sysvol::BoostGuard::engage_with(lvl, || 40, |_v| {}),
        ));
        let store = Arc::new(Store::open(":memory:").unwrap());
        let pid = store
            .upsert_piece(&crate::store::model::ScanPiece {
                folder_path: "/tmp/ck_e2e_hero".into(),
                title: "Hero".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        store
            .set_setting("ui.current_piece", &pid.to_string())
            .unwrap();
        let sessions = Arc::new(SessionService::new(store.clone()));
        let rep = Arc::new(RepEngine::new(store.clone(), sessions.clone()));

        let rec = Arc::new(Recorder::default());
        let rec_for_speaker = rec.clone();
        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![];
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200);

        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(rec.clone()));
        let voice = VoiceLoop::start_with(
            emitter,
            metro.clone(),
            store.clone(),
            rep.clone(),
            sessions,
            cfg,
            None,
            move |_m, _g, _mu, _cs, _sm| Box::new(RecConfirm(rec_for_speaker)),
        );

        // Poll until both reps are recorded (or time out ~15s covering the sleeps).
        let mut reps_done = 0;
        for _ in 0..150 {
            reps_done = store
                .block_history(pid)
                .unwrap()
                .first()
                .map(|b| b.reps_done)
                .unwrap_or(0);
            if reps_done >= 2 {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        voice.shutdown();
        let _ = std::fs::remove_file(&script);

        // Block opened for the selected piece, metronome started at 80.
        let hist = store.block_history(pid).unwrap();
        assert_eq!(hist.len(), 1, "one block opened for the selected piece");
        assert!(metro.snapshot().running, "metronome started");
        assert_eq!(metro.snapshot().bpm, 80.0);
        // Both reps persisted.
        assert_eq!(reps_done, 2, "two spaced 'done's persisted as two reps");
        assert_eq!(hist[0].verdicts.clean, 2);
        // Acks recorded end-to-end, in the shapes the ack policy calls for: the
        // open speaks (it states the measures and the tempo), the first rep is
        // routine and chimes, the second is one clean away from the rung
        // requirement of 3 and therefore speaks.
        let said = rec.said.lock().unwrap();
        assert!(
            said.iter().any(|s| s == "Measures 40 to 56 at 80. Go."),
            "said: {said:?}"
        );
        assert!(
            !said
                .iter()
                .any(|s| s == "Attempt 1 saved — clean. Rung 1 of 3."),
            "a routine first rep chimes rather than narrating: {said:?}"
        );
        assert!(
            said.iter()
                .any(|s| s == "Attempt 2 saved — clean. Rung 2 of 3."),
            "the one-away rep still speaks: {said:?}"
        );
        assert_eq!(rec.chimes(), 2, "both verdicts chime immediately");
    }

    /// LIVE on-device smoke (needs an output device + `say`): fake `hear` →
    /// router → REAL metronome (real cpal engine) + REAL Speaker playing the
    /// confirmation through the SAME engine via the MetroSink handoff, with the
    /// real STT gate closing/reopening around it. Verifies the audio handoff for
    /// real (the seam test above uses a mock engine). Makes sound. Run with:
    ///   cargo test --lib e2e_live_audio -- --ignored --nocapture
    #[cfg(unix)]
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
        let sessions = Arc::new(SessionService::new(store.clone()));
        let rep = Arc::new(RepEngine::new(store.clone(), sessions.clone()));
        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(Arc::new(Recorder::default())));

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![];
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200);

        // REAL Speaker (say provider, offline-safe) wired to the metronome engine.
        let voice = VoiceLoop::start_with(
            emitter,
            metro.clone(),
            store,
            rep,
            sessions,
            cfg,
            None,
            |m, g, mu, cs, sm| {
                let provider: Box<dyn crate::tts::TtsProvider> =
                    Box::new(crate::tts::say::SayTts::new());
                let sink: Arc<dyn PcmSink> = Arc::new(MetroSink(m));
                let gate: Arc<dyn Gate> = Arc::new(AtomicGate {
                    gate: g,
                    muted: mu,
                    capture_suspended: cs,
                });
                let config = SpeakerConfig::default();
                Box::new(AckPlayer {
                    speaker: Speaker::spawn(provider, sink.clone(), gate.clone(), config.clone()),
                    sink,
                    gate,
                    config,
                    // This test asserts real speech reaches the engine, so it
                    // wires the flag through rather than hard-coding it.
                    speech_muted: sm,
                })
            },
        );

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
        assert!(
            gate_open,
            "half-duplex gate reopened after the confirmation"
        );
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
        // Open a real block so rep-check phrases route as reps (rep_block_active
        // is now read live from the engine, not a field).
        ctx.rep
            .open(crate::store::model::RepOpenArgs {
                tuning: Default::default(),
                piece_id: 1,
                region_id: None,
                m_start: 1,
                m_end: 4,
                label: None,
                start_bpm: 80.0,
                target_bpm: None,
                planned_reps: Some(30),
                required_clean_streak: None,
                attempt_target: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();

        // Three "done" finals within the 2.5 s window (a re-send burst) → ONE ack.
        let base = Instant::now();
        for off in [0u64, 500, 1900] {
            let mut t = final_t("done");
            t.at = base + Duration::from_millis(off);
            ctx.handle_final(&t);
        }
        assert_eq!(
            rec.acks(),
            1,
            "a re-send burst of identical reps within the window counts once"
        );

        // A genuine second rep, heard well after the passage was played (> 2.5 s
        // past the last occurrence), fires again.
        let mut t = final_t("done");
        t.at = base + Duration::from_millis(1900 + 3000);
        ctx.handle_final(&t);
        assert_eq!(
            rec.acks(),
            2,
            "a genuine rep after > 2.5 s fires as a distinct rep"
        );
    }

    // -----------------------------------------------------------------------
    // Task 13 fix round 1 regression tests.
    // -----------------------------------------------------------------------

    /// A [`Confirm`] that sleeps ~2.8s per `say`, standing in for a real
    /// blocking `speak_blocking` confirmation cycle (synth + play + drain +
    /// 300ms tail routinely adds up to >=1.5s, i.e. >= [`DEDUP_WINDOW`]).
    struct BlockingConfirm(Arc<Recorder>);
    impl Confirm for BlockingConfirm {
        fn say(&self, text: &str) {
            std::thread::sleep(Duration::from_millis(2800));
            self.0.said.lock().unwrap().push(text.to_string());
        }
        fn chime(&self) {
            // A chime is far shorter than an utterance, but it still blocks for
            // its own gate cycle — the property under test here.
            std::thread::sleep(Duration::from_millis(2800));
            *self.0.chimed.lock().unwrap() += 1;
        }
    }

    #[test]
    fn dedup_survives_a_blocking_confirmation_speak() {
        // The bug: the old code recorded `Instant::now()` at *processing* time
        // (before speaking). By the time the second identical final was
        // processed, the first call's blocking speak had already elapsed
        // past DEDUP_WINDOW (2.5s), so the "same text within the window" check
        // failed and the duplicate fired again (e.g. applying a tempo change
        // twice). The fix keys off `t.at` (the settler's emit timestamp)
        // instead, so what matters is how far apart the transcripts were
        // actually *heard*, not how long we spent speaking in between.
        //
        // The sleep here (2.8s) must exceed DEDUP_WINDOW (2.5s): this is what
        // makes the test discriminate between a correct `t.at`-keyed dedup
        // (still passes, since `t.at` for t2 is only 600ms after t1) and a
        // buggy processing-time-keyed (`Instant::now()`) implementation (would
        // fail, since by the time t2 is processed, wall-clock time since t1's
        // recorded `Instant::now()` has already exceeded DEDUP_WINDOW). A
        // sleep shorter than DEDUP_WINDOW would pass under either
        // implementation and prove nothing.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.speaker = Box::new(BlockingConfirm(rec.clone()));

        let t1 = final_t("metronome 100");
        let mut t2 = final_t("metronome 100");
        t2.at = t1.at + Duration::from_millis(600); // heard 600ms apart

        ctx.handle_final(&t1); // blocks ~1.8s here, simulating the confirmation
        ctx.handle_final(&t2); // processed well over 1.8s of *wall clock* later

        assert_eq!(
            rec.acks(),
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
            rec.acks(),
            1,
            "a re-sent identical delta within 2.5 s is suppressed (no phantom double-bump)"
        );

        // A genuine repeat spoken > 2.5 s later fires again.
        let mut t3 = final_t("faster");
        t3.at = t1.at + Duration::from_millis(3000);
        ctx.handle_final(&t3);
        assert_eq!(
            rec.acks(),
            2,
            "an identical delta heard > 2.5 s later is a genuine new command"
        );
    }

    #[cfg(unix)]
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
        let rep = ctx.rep.clone();
        let sessions = ctx.sessions.clone();

        let mut cfg = SttConfig::hear(script.clone());
        cfg.args = vec![];
        cfg.use_stdbuf = false;
        cfg.settle = Duration::from_millis(200);

        let emitter: Arc<dyn VoiceEmitter> = Arc::new(RecEmitter(rec.clone()));
        let started = Instant::now();
        let voice = VoiceLoop::start_with(
            emitter,
            metro,
            store,
            rep,
            sessions,
            cfg,
            None,
            move |_m, _g, _mu, _cs, _sm| {
                // A slow provider-builder: sleeps well past the 50ms budget.
                std::thread::sleep(Duration::from_millis(500));
                Box::new(RecConfirm(rec)) as Box<dyn Confirm>
            },
        );
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
        let capture_suspended = Arc::new(AtomicBool::new(false));
        let ag = AtomicGate {
            gate: gate.clone(),
            muted: muted.clone(),
            capture_suspended: capture_suspended.clone(),
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

    // -----------------------------------------------------------------------
    // Task 18: rep voice paths through ActionCtx.
    // -----------------------------------------------------------------------

    fn final_at(text: &str, at: Instant) -> Transcript {
        Transcript {
            text: text.to_string(),
            is_final: true,
            at,
        }
    }

    /// Space genuine repeats far enough apart that the 2.5 s dedup treats them as
    /// distinct commands.
    fn feed_spaced(ctx: &mut ActionCtx, text: &str, n: usize) {
        let base = Instant::now();
        for i in 0..n {
            ctx.handle_final(&final_at(
                text,
                base + Duration::from_millis(4000 * i as u64),
            ));
        }
    }

    #[test]
    fn voice_rep_open_starts_metro_and_speaks_go() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t(
            "open a rep tracker measures 40 to 56 start at 80 target 120",
        ));
        assert!(ctx.rep.active(), "a block is open");
        assert!(ctx.metro.snapshot().running, "metronome started");
        assert_eq!(ctx.metro.snapshot().bpm, 80.0);
        assert!(
            rec.said
                .lock()
                .unwrap()
                .iter()
                .any(|s| s == "Measures 40 to 56 at 80. Go."),
            "said: {:?}",
            rec.said.lock().unwrap()
        );
    }

    #[test]
    fn voice_score_navigation_emits_navigation_and_intent_without_speaking() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);

        ctx.handle_final(&final_t("show measure eighty three"));

        assert!(
            rec.said.lock().unwrap().is_empty(),
            "score navigation must stay silent"
        );
        let events = rec.events.lock().unwrap();
        assert!(
            events
                .iter()
                .any(|(event, payload)| event == "score://navigate"
                    && payload == &json!({ "kind": "measure", "value": 83 })),
            "navigation event missing: {events:?}"
        );
        assert!(
            events
                .iter()
                .any(|(event, payload)| event == "voice://intent"
                    && payload["kind"] == "score_measure"
                    && payload["text"] == "show measure eighty three"),
            "voice intent missing: {events:?}"
        );
    }

    #[test]
    fn duplicate_score_navigation_delivery_is_idempotent() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let at = Instant::now();

        ctx.handle_final(&final_at("go to page 12", at));
        ctx.handle_final(&final_at("go to page 12", at + Duration::from_millis(500)));

        let events = rec.events.lock().unwrap();
        let navigation: Vec<_> = events
            .iter()
            .filter(|(event, _)| event == "score://navigate")
            .collect();
        assert_eq!(
            navigation.len(),
            1,
            "STT duplicate must emit one navigation event"
        );
        assert_eq!(
            navigation[0].1,
            json!({ "kind": "page", "value": 12 }),
            "page navigation payload must be absolute and typed"
        );
        drop(events);
        assert!(
            rec.said.lock().unwrap().is_empty(),
            "duplicate navigation must stay silent"
        );
    }

    #[test]
    fn voice_rep_open_without_a_piece_says_pick_first() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.store.set_setting("ui.current_piece", "").unwrap(); // deselect
        ctx.handle_final(&final_t("open a rep tracker measures 1 to 8 at 80"));
        assert!(!ctx.rep.active(), "no block opened without a piece");
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "Pick a piece first."
        );
    }

    #[test]
    fn voice_rep_open_live_retunes_an_existing_metronome_without_restart() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("metronome ninety six"));
        ctx.metro
            .tts_enqueue(&[0.25; 64], 48_000)
            .expect("test engine accepts buffered speech");

        ctx.handle_final(&final_t(
            "open a rep tracker measures 40 to 56 start at 80 target 120",
        ));

        assert!(ctx.rep.active());
        assert_eq!(ctx.metro.snapshot().bpm, 80.0);
        assert_eq!(
            ctx.metro.snapshot().owner,
            Some(crate::metronome::MetroOwner::Manual),
            "opening a set must not steal a running manual click"
        );
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "Measures 40 to 56 at 80. Go.",
            "live retune must not hit the restart Busy path"
        );

        ctx.handle_final(&final_t("close the block"));
        assert!(
            ctx.metro.snapshot().running,
            "closing a set must not stop a manually owned click"
        );
        assert_eq!(
            ctx.metro.snapshot().owner,
            Some(crate::metronome::MetroOwner::Manual)
        );
    }

    #[test]
    fn voice_rep_check_speaks_ladder_and_follows_step_when_running() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t(
            "open a rep tracker measures 40 to 56 start at 80 target 120",
        )); // starts metro at 80
        feed_spaced(&mut ctx, "done", 3); // 3rd clean steps 80 → 84
        assert_eq!(
            ctx.metro.snapshot().bpm,
            84.0,
            "metro follows the step while running"
        );
        assert!(
            rec.said
                .lock()
                .unwrap()
                .iter()
                .any(|s| s == "Attempt 3 saved — clean. Rung 0 of 3. Up to 84."),
            "said: {:?}",
            rec.said.lock().unwrap()
        );
    }

    #[test]
    fn voice_rep_step_not_applied_to_a_stopped_metronome() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        // Open a block directly (engine), leaving the metronome stopped.
        ctx.rep
            .open(crate::store::model::RepOpenArgs {
                tuning: Default::default(),
                piece_id: 1,
                region_id: None,
                m_start: 40,
                m_end: 56,
                label: None,
                start_bpm: 80.0,
                target_bpm: Some(120.0),
                planned_reps: Some(30),
                required_clean_streak: None,
                attempt_target: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: true,
            })
            .unwrap();
        assert!(!ctx.metro.snapshot().running);
        feed_spaced(&mut ctx, "done", 3);
        assert!(
            !ctx.metro.snapshot().running,
            "a stopped metronome is not started by a step"
        );
        assert!(
            rec.said
                .lock()
                .unwrap()
                .iter()
                .any(|s| s == "Attempt 3 saved — clean. Rung 0 of 3. Up to 84."),
            "the step is still spoken: {:?}",
            rec.said.lock().unwrap()
        );
    }

    #[test]
    fn voice_rep_step_does_not_retune_metronome_when_use_metronome_off() {
        // The retune gate lives in `act_rep` (`if outcome.snap.use_metronome &&
        // running`), not the rep engine (which holds no metronome handle) — so a
        // `use_metronome=false` tempo block must advance its ladder + log a
        // `tempo_change` while the RUNNING metronome is left untouched. This is
        // the only place that path can be exercised.
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        let pid: i64 = ctx
            .store
            .get_setting("ui.current_piece")
            .unwrap()
            .unwrap()
            .parse()
            .unwrap();

        // Metronome RUNNING at 80.
        let _ = ctx.metro.do_start(Some(80.0));
        assert!(ctx.metro.snapshot().running, "metronome is running");
        let metro_bpm_before = ctx.metro.snapshot().bpm;
        assert_eq!(metro_bpm_before, 80.0);

        // Open a `tempo` block with the metronome DECOUPLED. Opened directly via
        // the engine because `act_rep_open` hardcodes `use_metronome: true` (there
        // is no voice grammar for it yet), same as the sibling stopped-metro test.
        ctx.rep
            .open(crate::store::model::RepOpenArgs {
                tuning: Default::default(),
                piece_id: pid,
                region_id: None,
                m_start: 40,
                m_end: 56,
                label: None,
                start_bpm: 80.0,
                target_bpm: Some(120.0),
                planned_reps: Some(30),
                required_clean_streak: None,
                attempt_target: None,
                increment: None,
                variants: vec![],
                focus: "tempo".into(),
                use_metronome: false,
            })
            .unwrap();

        // Drive the ladder through `act_rep` (the gate under test): the 3rd clean
        // rep steps 80 → 84 in the engine.
        feed_spaced(&mut ctx, "done", 3);

        // (a) the ladder DID advance — new_bpm was Some(84) (feed_spaced routes
        // through act_rep and does not surface the CheckOutcome, so the engine's
        // advanced working tempo + the spoken "Up to 84." line are the proxy).
        assert_eq!(
            ctx.rep.snapshot().unwrap().bpm,
            Some(84.0),
            "engine tempo advanced"
        );
        assert!(
            rec.said
                .lock()
                .unwrap()
                .iter()
                .any(|s| s == "Attempt 3 saved — clean. Rung 0 of 3. Up to 84."),
            "step spoken: {:?}",
            rec.said.lock().unwrap()
        );

        // (b) a durable tempo_change event was logged.
        let evs = ctx.store.events_for_piece(pid).unwrap();
        assert!(
            evs.iter().any(|e| e.kind == "tempo_change"),
            "tempo_change logged despite metronome-off"
        );

        // (c) the RUNNING metronome was NOT physically retuned.
        assert!(ctx.metro.snapshot().running, "metronome still running");
        assert_eq!(
            ctx.metro.snapshot().bpm,
            metro_bpm_before,
            "metronome bpm unchanged — no retune when use_metronome=false"
        );
    }

    #[test]
    fn voice_rep_note_reaches_the_session_log() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("open a rep tracker measures 1 to 8 at 80"));
        ctx.handle_final(&final_t("nope missed the left hand jump"));
        let events = rec.events.lock().unwrap();
        assert!(
            events.iter().any(|(e, p)| e == "session://event"
                && p["kind"] == "rep"
                && p["payload"]["note"] == "missed the left hand jump"
                && p["payload"]["verdict"] == "failed"),
            "the fail note was logged with the rep: {events:?}"
        );
    }

    #[test]
    fn configured_verdict_alias_routes_only_inside_an_open_rep_block() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.store
            .set_setting(
                "voice.verdict_aliases",
                r#"{"clean":["solid landing"],"flawed":[],"failed":[]}"#,
            )
            .unwrap();
        ctx.handle_final(&final_t("solid landing"));
        {
            // Inert outside rep mode: no rep/session/state event — only the
            // transcript, carrying the backend's handled=false decision.
            let events = rec.events.lock().unwrap();
            assert!(
                events.iter().all(|(e, _)| e == "voice://transcript"),
                "alias is inert outside rep mode: {events:?}"
            );
            assert!(
                events
                    .iter()
                    .any(|(e, p)| e == "voice://transcript" && p["handled"] == json!(false)),
                "unrouted alias is marked handled=false: {events:?}"
            );
        }
        ctx.handle_final(&final_t("open a rep tracker measures 1 to 8 at 80"));
        ctx.handle_final(&final_t("solid landing"));
        let events = rec.events.lock().unwrap();
        assert!(events.iter().any(|(event, payload)| {
            event == "session://event"
                && payload["kind"] == "rep"
                && payload["payload"]["verdict"] == "clean"
        }));
    }

    #[test]
    fn voice_rep_status_reports_progress() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t(
            "open a rep tracker measures 40 to 56 start at 80 target 120",
        ));
        ctx.handle_final(&final_t("status"));
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "0 tries. Rung 0 of 3. At 80."
        );
    }

    #[test]
    fn voice_rep_close_summarizes_and_clears_the_block() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("open a rep tracker measures 1 to 8 at 80"));
        ctx.handle_final(&final_t("done"));
        ctx.handle_final(&final_t("close the block"));
        assert!(!ctx.rep.active(), "block closed");
        assert!(
            !ctx.metro.snapshot().running,
            "practice-owned click stopped"
        );
        assert_eq!(ctx.metro.snapshot().owner, None);
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "Block closed. 1 reps, 1 clean."
        );
    }

    #[test]
    fn voice_session_end_saves_and_speaks_totals() {
        let rec = Arc::new(Recorder::default());
        let mut ctx = test_ctx(&rec);
        ctx.handle_final(&final_t("open a rep tracker measures 1 to 8 at 80"));
        ctx.handle_final(&final_t("done"));
        ctx.handle_final(&final_t("end the session"));
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "Close the current practice set before ending the session."
        );
        assert!(ctx.rep.active(), "rejected session end preserves the set");
        assert!(
            ctx.sessions.current_id().is_some(),
            "rejected session end preserves the session"
        );

        ctx.handle_final(&final_t("close the block"));
        ctx.handle_final(&final_t("end the session"));
        assert_eq!(
            rec.said.lock().unwrap().last().unwrap(),
            "Session saved. 1 reps across 1 pieces."
        );
        assert!(ctx.sessions.current_id().is_none(), "session ended");
    }
}
