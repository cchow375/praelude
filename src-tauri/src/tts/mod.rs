//! Text-to-speech providers and the **half-duplex gate** — the mechanism that
//! guarantees CodaKiller never "hears itself" while speaking.
//!
//! # Pieces
//!
//! * [`TtsProvider`] — `synth(text) -> Pcm`. Two impls: [`gemini::GeminiTts`]
//!   (Gemini `interactions` REST TTS, 24 kHz s16le PCM) and [`say::SayTts`]
//!   (macOS `say` → WAV → PCM fallback). See [`select_provider`].
//! * [`Speaker`] — owns ONE dedicated worker thread that is the sole caller of
//!   [`EngineHandle::enqueue_pcm`], structurally satisfying that method's
//!   single-producer contract. `speak()` queues text; the worker synthesizes and
//!   plays it while driving the gate.
//!
//! # The half-duplex invariant (safety-critical)
//!
//! `hear` (STT) and TTS share the room: the speaker's output is audible to the
//! mic. If the gate were open while we spoke, `hear` would transcribe our own
//! voice and feed it back as commands. The gate ([`Gate`], backed by
//! [`SttHandle::set_gate`]) drops STT lines at the supervisor while closed.
//!
//! Per utterance the worker runs, strictly in this order:
//!
//! 1. **`synth(text)` with the gate still OPEN.** Synthesis (a network call for
//!    Gemini, up to 10 s) happens before we mute the mic, so a failed/slow synth
//!    never leaves the user unable to talk. A synth error returns here and the
//!    gate is *never touched*.
//! 2. **`set_gate(false)` — close BEFORE the first sample is enqueued.** This is
//!    the load-bearing ordering the gate test pins down.
//! 3. **Chunked `enqueue_pcm` with backpressure.** A [`PcmError`] (QueueFull /
//!    CapExceeded) means "try again later", never "drop": we sleep briefly and
//!    retry the *same* chunk (bounded by a generous deadline).
//! 4. **Poll [`pcm_done`](EngineHandle::pcm_done) until true.** Task 5's
//!    reserve-first accounting guarantees `pcm_done` stays `false` until every
//!    enqueued sample has passed the render callback — it can never report "done"
//!    while any TTS is still buffered.
//! 5. **Sleep `reopen_delay` (300 ms).** `pcm_done == true` only means the samples
//!    left the cpal callback; the physical tail is still in flight (CoreAudio
//!    output buffer + DAC + speaker→air→mic path + `hear`'s own input buffering).
//!    300 ms covers device output latency plus a short room-acoustic tail so
//!    `hear` never captures the fade-out of our own speech.
//! 6. **`set_gate(true)` — reopen.**
//!
//! Steps 3–6 run under an always-reopen guard: once the gate is closed (step 2)
//! it is *always* reopened, even if enqueue or drain hits its deadline, so the
//! gate can never get stuck closed (a permanently deaf app is a worse failure
//! than a live mic). The deadlines in steps 3–4 are generous multiples of the
//! utterance length, so normal playback always completes well before them.
//!
//! # Serialization & the single-producer contract
//!
//! `speak()` hands work to one worker thread over an mpsc channel; the worker
//! processes jobs strictly one at a time. Two overlapping `speak()` calls
//! therefore never interleave their gate cycles (no double-speak race), and
//! because that one worker is the only code that ever calls `enqueue_pcm`, the
//! engine's documented single-producer precondition holds by construction. The
//! metronome never enqueues PCM (it only sets pattern/gain and reads `pcm_done`),
//! so there is no second producer anywhere.
//!
//! Note on the metronome TOCTOU window (Task 7 review): the metronome's
//! `start_engine`/`do_set` refuse an engine restart while `!pcm_done()`. There is
//! a microsecond check-to-drop window where this worker could enqueue a chunk
//! just after the metronome observed `pcm_done()==true`. This is accepted for v1:
//! the worst case is one buffered chunk discarded by the restart, and sound
//! changes are rare and user-initiated. No cross-thread handshake is added now.

pub mod gemini;
pub mod say;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::audio::EngineHandle;
use crate::stt::SttHandle;

// Re-exported so external code (integration tests, later-task app wiring) can name
// the error a `PcmSink` returns without reaching into the private `audio` module.
pub use crate::audio::PcmError;

/// Decoded speech audio: `mono_f32` samples at `rate` Hz. Handed to the engine's
/// `enqueue_pcm`, which resamples to the output stream rate off the audio thread.
#[derive(Clone, Debug, PartialEq)]
pub struct Pcm {
    pub rate: u32,
    pub mono_f32: Vec<f32>,
}

/// Why synthesis failed. All variants are non-fatal to the app — the caller logs
/// and moves on (and the gate is never left closed on error).
#[derive(Debug, Clone)]
pub enum TtsError {
    /// No API key available (Keychain + env both empty) for a Gemini provider.
    NoKey,
    /// Transport-level failure (DNS, connect, TLS, timeout) talking to the API.
    Transport(String),
    /// The API returned a non-success HTTP status.
    Status(u16, String),
    /// The response body could not be parsed / had no audio.
    Decode(String),
    /// The `say` subprocess failed to run or produced no readable audio.
    Say(String),
}

impl fmt::Display for TtsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TtsError::NoKey => write!(f, "no Gemini API key (Keychain or GEMINI_API_KEY)"),
            TtsError::Transport(e) => write!(f, "TTS transport error: {e}"),
            TtsError::Status(code, body) => write!(f, "TTS HTTP {code}: {body}"),
            TtsError::Decode(e) => write!(f, "TTS decode error: {e}"),
            TtsError::Say(e) => write!(f, "`say` fallback error: {e}"),
        }
    }
}

impl std::error::Error for TtsError {}

/// Result alias for the contract signature `synth(&self, text) -> Result<Pcm>`.
pub type Result<T> = std::result::Result<T, TtsError>;

/// A text-to-speech backend. `Send + Sync` so a `Box<dyn TtsProvider>` can live on
/// the [`Speaker`] worker thread.
pub trait TtsProvider: Send + Sync {
    /// Synthesize `text` into mono PCM. Blocking; runs on the worker thread.
    fn synth(&self, text: &str) -> Result<Pcm>;
}

/// Default number of *consecutive* primary failures after which the primary
/// provider is put on cooldown.
const DEFAULT_FAIL_THRESHOLD: u32 = 2;

/// First cooldown applied when the primary trips the failure threshold.
const COOLDOWN_BASE: Duration = Duration::from_secs(60);

/// Ceiling for the doubling cooldown. A dead key/network then costs at most one
/// wasted synth attempt every 10 minutes, while a network that comes back is
/// picked up within 10 minutes without a relaunch.
const COOLDOWN_MAX: Duration = Duration::from_secs(600);

// ---------------------------------------------------------------------------
// Clock seam
// ---------------------------------------------------------------------------

/// Monotonic time source. Injected (like [`PcmSink`] / [`Gate`]) so the cooldown
/// state machine is testable without sleeping. Production uses [`SystemClock`].
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// The real clock: `Instant::now()`.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

// ---------------------------------------------------------------------------
// Degraded-voice status
// ---------------------------------------------------------------------------

/// Where a primary↔fallback *transition* is reported. Called only when the
/// degraded flag actually flips, never per failure.
pub trait TtsStatusSink: Send + Sync {
    fn set_degraded(&self, degraded: bool);
}

/// Process-wide "the cloud voice is degraded" flag plus an optional listener.
///
/// The TTS provider is built deep inside the voice action thread ([`Speaker`] →
/// [`select_provider`]) which has no `AppHandle` and no app state, so the status
/// is published through a process-global hub — the same idiom used elsewhere in
/// the app for handle-less subsystems (`imslp::SHARED_HTTP`,
/// `stt::supervisor::CURRENT_HEAR_PGID`). `run()` installs a listener that emits
/// `voice://tts`; `tts_degraded()` reads the flag for a fresh UI mount.
pub struct TtsStatusHub {
    degraded: AtomicBool,
    listener: Mutex<Option<StatusListener>>,
}

/// A degraded/recovered transition listener (production: the `voice://tts` emit).
pub type StatusListener = Box<dyn Fn(bool) + Send + Sync>;

impl TtsStatusHub {
    fn new() -> TtsStatusHub {
        TtsStatusHub {
            degraded: AtomicBool::new(false),
            listener: Mutex::new(None),
        }
    }

    /// Current degraded state (`true` = utterances are coming from `say`).
    pub fn degraded(&self) -> bool {
        self.degraded.load(Ordering::Acquire)
    }

    /// Install the transition listener (replacing any previous one).
    pub fn set_listener(&self, listener: StatusListener) {
        if let Ok(mut slot) = self.listener.lock() {
            *slot = Some(listener);
        }
    }
}

impl TtsStatusSink for TtsStatusHub {
    fn set_degraded(&self, degraded: bool) {
        self.degraded.store(degraded, Ordering::Release);
        if let Ok(slot) = self.listener.lock() {
            if let Some(listener) = slot.as_ref() {
                listener(degraded);
            }
        }
    }
}

/// The process-global status hub.
pub fn status_hub() -> &'static Arc<TtsStatusHub> {
    static HUB: OnceLock<Arc<TtsStatusHub>> = OnceLock::new();
    HUB.get_or_init(|| Arc::new(TtsStatusHub::new()))
}

/// A [`TtsProvider`] that speaks through a `primary` provider but **falls back**
/// to a `fallback` provider whenever the primary fails — so an utterance is never
/// silently dropped just because (e.g.) the Gemini network call errored.
///
/// This wraps at the *provider* layer, entirely inside [`TtsProvider::synth`],
/// which runs in the [`Speaker`] worker's **step 1 — with the half-duplex gate
/// still OPEN** (see the module docs). A synth failure here therefore behaves
/// exactly like any other synth failure: it happens before the gate is ever
/// touched, so the load-bearing gate ordering in [`speak_once`] is completely
/// unaffected. `FallbackTts` never enqueues PCM or touches the gate itself.
///
/// Policy (per utterance):
/// * If the primary is not on cooldown, try it first. On success the consecutive-
///   failure counter, the cooldown length, and the degraded state are all reset.
/// * On a primary failure the counter increments and we *immediately* try the
///   fallback (the user still hears the ack).
/// * After [`threshold`](FallbackTts::with_threshold) **consecutive** primary
///   failures the primary goes on **cooldown** — 60 s at first, doubling on each
///   subsequent trip up to a 10 minute cap — instead of being abandoned for the
///   whole session (v6 S9: a laptop that lost Wi-Fi for a minute must not be
///   stuck with the robot voice until relaunch). Retrying every utterance is what
///   the cooldown avoids: it would put a network timeout in front of every ack.
/// * When a cooldown expires the primary is retried on the next utterance in a
///   *probation* state: one more failure re-trips it immediately (with the
///   doubled cooldown), so a still-broken primary costs one attempt per cooldown
///   window, not `threshold` attempts.
///
/// The degraded flag flips on the trip (primary → fallback) and on the first
/// primary success after a trip (fallback → recovered), and the
/// [`TtsStatusSink`] is called on those two transitions only — never per
/// failure. Production passes [`status_hub`], which drives the `voice://tts`
/// event and the "Voice degraded" pill.
///
/// Time comes from an injected [`Clock`] so the whole state machine is unit
/// tested without sleeping.
pub struct FallbackTts {
    primary: Box<dyn TtsProvider>,
    fallback: Box<dyn TtsProvider>,
    threshold: u32,
    clock: Arc<dyn Clock>,
    status: Arc<dyn TtsStatusSink>,
    state: Mutex<CooldownState>,
}

/// Mutable cooldown bookkeeping. Behind one `Mutex` because `Instant` is not an
/// atomic; the Speaker worker is the only caller, so it is never contended.
#[derive(Debug, Default)]
struct CooldownState {
    /// Consecutive primary failures since the last success / cooldown expiry.
    fails: u32,
    /// Cooldown applied at the last trip; the next trip doubles it (capped).
    last_cooldown: Option<Duration>,
    /// While `Some(t)` and `now < t`, the primary is skipped entirely.
    disabled_until: Option<Instant>,
    /// Whether the last reported transition said "degraded".
    degraded: bool,
}

impl FallbackTts {
    /// Wrap `primary` with a `fallback`, using the default failure threshold (2),
    /// the real clock, and the process-global status hub.
    pub fn new(primary: Box<dyn TtsProvider>, fallback: Box<dyn TtsProvider>) -> FallbackTts {
        FallbackTts::with_threshold(primary, fallback, DEFAULT_FAIL_THRESHOLD)
    }

    /// Wrap with an explicit consecutive-failure `threshold` (`>= 1`).
    pub fn with_threshold(
        primary: Box<dyn TtsProvider>,
        fallback: Box<dyn TtsProvider>,
        threshold: u32,
    ) -> FallbackTts {
        FallbackTts::with_seams(
            primary,
            fallback,
            threshold,
            Arc::new(SystemClock),
            status_hub().clone(),
        )
    }

    /// Full seam constructor: explicit threshold, clock, and status sink. Used by
    /// the cooldown tests; production goes through [`FallbackTts::new`].
    pub fn with_seams(
        primary: Box<dyn TtsProvider>,
        fallback: Box<dyn TtsProvider>,
        threshold: u32,
        clock: Arc<dyn Clock>,
        status: Arc<dyn TtsStatusSink>,
    ) -> FallbackTts {
        FallbackTts {
            primary,
            fallback,
            threshold: threshold.max(1),
            clock,
            status,
            state: Mutex::new(CooldownState::default()),
        }
    }

    /// `true` if the primary should be attempted now. Clears an expired cooldown
    /// and puts the primary on probation (one failure re-trips it).
    fn primary_ready(&self, state: &mut CooldownState) -> bool {
        match state.disabled_until {
            Some(until) if self.clock.now() < until => false,
            Some(_) => {
                state.disabled_until = None;
                // Probation: the next single failure re-trips the cooldown.
                state.fails = self.threshold.saturating_sub(1);
                true
            }
            None => true,
        }
    }
}

impl TtsProvider for FallbackTts {
    fn synth(&self, text: &str) -> Result<Pcm> {
        // A transition to report after the lock is released (the listener runs
        // app code — never call it while holding our own lock).
        let mut transition: Option<bool> = None;
        let attempt_primary = {
            let mut state = self.state.lock().expect("tts fallback state");
            self.primary_ready(&mut state)
        };

        if attempt_primary {
            match self.primary.synth(text) {
                Ok(pcm) => {
                    {
                        let mut state = self.state.lock().expect("tts fallback state");
                        state.fails = 0;
                        state.last_cooldown = None;
                        state.disabled_until = None;
                        if state.degraded {
                            state.degraded = false;
                            transition = Some(false);
                        }
                    }
                    if transition.is_some() {
                        eprintln!("tts: primary provider recovered; back to the cloud voice");
                        self.status.set_degraded(false);
                    }
                    return Ok(pcm);
                }
                Err(e) => {
                    let mut cooldown = None;
                    {
                        let mut state = self.state.lock().expect("tts fallback state");
                        state.fails += 1;
                        eprintln!(
                            "tts: primary provider failed ({}/{}); using fallback: {e}",
                            state.fails, self.threshold
                        );
                        if state.fails >= self.threshold {
                            let next = match state.last_cooldown {
                                Some(prev) => (prev * 2).min(COOLDOWN_MAX),
                                None => COOLDOWN_BASE,
                            };
                            state.last_cooldown = Some(next);
                            state.disabled_until = Some(self.clock.now() + next);
                            state.fails = 0;
                            cooldown = Some(next);
                            if !state.degraded {
                                state.degraded = true;
                                transition = Some(true);
                            }
                        }
                    }
                    if let Some(cooldown) = cooldown {
                        eprintln!(
                            "tts: primary provider paused for {}s after {} consecutive failures; \
                             using the system voice until then",
                            cooldown.as_secs(),
                            self.threshold
                        );
                    }
                    if transition == Some(true) {
                        self.status.set_degraded(true);
                    }
                }
            }
        }
        // Fallback path (primary just failed, or is on cooldown). If the fallback
        // also fails, that error propagates to the Speaker, which logs it — the
        // utterance is dropped only when BOTH providers fail.
        self.fallback.synth(text)
    }
}

// ---------------------------------------------------------------------------
// Seams: the Speaker depends on these small traits, not concrete types, so the
// gate-ordering and backpressure tests can drive it with mocks + a fake clock.
// ---------------------------------------------------------------------------

/// Where synthesized PCM goes and how we learn it has finished playing. The real
/// impl is [`EngineHandle`]; tests use a time-modeled fake.
pub trait PcmSink: Send + Sync {
    /// Enqueue one chunk (mono f32 at `src_rate`). `Err` means "try again later"
    /// (see [`PcmError`]) — the caller retries, never drops.
    fn enqueue(&self, samples: &[f32], src_rate: u32) -> std::result::Result<(), PcmError>;
    /// `true` once every enqueued sample has been output (nothing buffered).
    fn done(&self) -> bool;
}

/// The half-duplex mic gate. The real impl is [`SttHandle`].
pub trait Gate: Send + Sync {
    fn set_gate(&self, open: bool);
}

impl PcmSink for EngineHandle {
    fn enqueue(&self, samples: &[f32], src_rate: u32) -> std::result::Result<(), PcmError> {
        self.enqueue_pcm(samples, src_rate)
    }
    fn done(&self) -> bool {
        self.pcm_done()
    }
}

impl Gate for SttHandle {
    fn set_gate(&self, open: bool) {
        SttHandle::set_gate(self, open)
    }
}

/// Tuning for the [`Speaker`] worker. Defaults are the production values; tests
/// shrink the delays / chunk size.
#[derive(Clone, Debug)]
pub struct SpeakerConfig {
    /// How long after the engine drains (`pcm_done`) to wait before reopening the
    /// gate. Covers output + acoustic tail. Production: 300 ms.
    pub reopen_delay: Duration,
    /// Poll cadence while waiting for `pcm_done` during drain.
    pub poll_interval: Duration,
    /// Backoff before retrying an enqueue that hit backpressure.
    pub retry_delay: Duration,
    /// Samples per `enqueue_pcm` chunk.
    pub chunk_samples: usize,
}

impl Default for SpeakerConfig {
    fn default() -> Self {
        SpeakerConfig {
            reopen_delay: Duration::from_millis(300),
            poll_interval: Duration::from_millis(5),
            retry_delay: Duration::from_millis(5),
            chunk_samples: 4096,
        }
    }
}

/// One unit of work for the worker: text to speak, plus an optional ack channel so
/// [`Speaker::speak_blocking`] can wait for (and observe the result of) an
/// utterance. Fire-and-forget [`Speaker::speak`] sends `ack: None`.
struct Job {
    text: String,
    ack: Option<mpsc::Sender<Result<()>>>,
}

/// Owns the single TTS worker thread. Dropping the `Speaker` (or calling
/// [`Speaker::shutdown`]) closes the job channel, so the worker finishes the
/// in-flight utterance and exits; the thread is then joined.
pub struct Speaker {
    tx: Option<mpsc::Sender<Job>>,
    worker: Option<JoinHandle<()>>,
}

impl Speaker {
    /// Spawn the worker. `provider` synthesizes, `sink` plays, `gate` mutes the
    /// mic. The worker is the *only* caller of `sink.enqueue`, upholding the
    /// engine's single-producer contract.
    pub fn spawn(
        provider: Box<dyn TtsProvider>,
        sink: std::sync::Arc<dyn PcmSink>,
        gate: std::sync::Arc<dyn Gate>,
        config: SpeakerConfig,
    ) -> Speaker {
        let (tx, rx) = mpsc::channel::<Job>();
        let worker = std::thread::Builder::new()
            .name("codakiller-tts".into())
            .spawn(move || {
                // Jobs are processed strictly serially: the gate cycle of one
                // utterance completes before the next begins.
                for job in rx.iter() {
                    let result = speak_once(&*provider, &*sink, &*gate, &config, &job.text);
                    if let Err(e) = &result {
                        eprintln!("tts: utterance failed: {e}");
                    }
                    if let Some(ack) = job.ack {
                        let _ = ack.send(result);
                    }
                }
            })
            .expect("spawn tts worker");
        Speaker {
            tx: Some(tx),
            worker: Some(worker),
        }
    }

    /// Queue `text` to be spoken (fire-and-forget). Returns immediately; the
    /// worker handles synthesis, playback, and the gate. Ordering is preserved.
    pub fn speak(&self, text: impl Into<String>) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(Job {
                text: text.into(),
                ack: None,
            });
        }
    }

    /// Speak `text` and block until the utterance's full gate cycle has completed,
    /// returning the synthesis/playback result. Used by the live test.
    pub fn speak_blocking(&self, text: impl Into<String>) -> Result<()> {
        let (ack_tx, ack_rx) = mpsc::channel();
        if let Some(tx) = &self.tx {
            if tx
                .send(Job {
                    text: text.into(),
                    ack: Some(ack_tx),
                })
                .is_err()
            {
                return Err(TtsError::Say("speaker worker is gone".into()));
            }
        } else {
            return Err(TtsError::Say("speaker is shut down".into()));
        }
        ack_rx
            .recv()
            .unwrap_or_else(|_| Err(TtsError::Say("worker dropped the job".into())))
    }

    /// Stop the worker: close the channel and join. Idempotent. The in-flight
    /// utterance (if any) finishes — including reopening the gate — first.
    pub fn shutdown(&mut self) {
        self.tx = None; // dropping the sender ends the worker's `rx.iter()`
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

impl Drop for Speaker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Synthesize and play one utterance, driving the half-duplex gate. See the
/// module docs for the ordering proof. Returns the synthesis result; playback
/// backpressure/deadline issues are logged but the gate is always restored.
fn speak_once(
    provider: &dyn TtsProvider,
    sink: &dyn PcmSink,
    gate: &dyn Gate,
    config: &SpeakerConfig,
    text: &str,
) -> Result<()> {
    // Step 1: synth with the gate still OPEN. A failure returns here having never
    // touched the gate — the mic stays live.
    let pcm = provider.synth(text)?;
    if pcm.mono_f32.is_empty() {
        return Ok(()); // nothing to say; gate untouched
    }

    // Step 2: close the gate BEFORE the first sample is enqueued.
    gate.set_gate(false);

    // Steps 3-6 under an RAII always-reopen guard: the gate is reopened exactly
    // once when `_reopen` drops — after the drain + 300 ms margin on the normal
    // path, or immediately if anything below panics (a deaf mic is worse than a
    // slightly-early reopen on an already-catastrophic unwind).
    let _reopen = ReopenGuard { gate };
    let outcome = play_and_drain(sink, config, &pcm);
    // Step 5: acoustic-tail margin. Step 6 (reopen) fires when `_reopen` drops.
    std::thread::sleep(config.reopen_delay);
    outcome
}

/// Reopens the gate exactly once on drop. Guarantees the half-duplex gate can
/// never get stuck closed, even if the worker panics mid-utterance.
struct ReopenGuard<'a> {
    gate: &'a dyn Gate,
}

impl Drop for ReopenGuard<'_> {
    fn drop(&mut self) {
        self.gate.set_gate(true);
    }
}

/// Enqueue every chunk (retrying backpressure) then poll `pcm_done`. Both phases
/// are bounded by generous deadlines so a wedged sink can never hang the worker
/// (and hence the gate) forever; on a deadline we log and proceed to reopen.
fn play_and_drain(sink: &dyn PcmSink, config: &SpeakerConfig, pcm: &Pcm) -> Result<()> {
    let dur = if pcm.rate > 0 {
        Duration::from_secs_f64(pcm.mono_f32.len() as f64 / pcm.rate as f64)
    } else {
        Duration::from_secs(1)
    };
    // Generous slack: normal playback finishes long before these.
    let enqueue_deadline = Instant::now() + dur.mul_f64(2.0) + Duration::from_secs(2);

    // Step 3: chunked enqueue with backpressure retry.
    let chunk = config.chunk_samples.max(1);
    for samples in pcm.mono_f32.chunks(chunk) {
        loop {
            match sink.enqueue(samples, pcm.rate) {
                Ok(()) => break,
                Err(_backpressure) => {
                    if Instant::now() >= enqueue_deadline {
                        // Sink is not draining; stop enqueueing but still reopen.
                        drain(sink, config, dur);
                        return Err(TtsError::Say(
                            "engine did not accept PCM before deadline (dropping tail)".into(),
                        ));
                    }
                    std::thread::sleep(config.retry_delay);
                }
            }
        }
    }

    // Step 4: drain.
    drain(sink, config, dur);
    Ok(())
}

/// Poll `pcm_done` until true, bounded by a deadline (`dur * 3 + 2s`). Returns
/// when drained OR the deadline passes (fail-safe: a live mic beats a stuck-closed
/// gate — see module docs).
fn drain(sink: &dyn PcmSink, config: &SpeakerConfig, dur: Duration) {
    let deadline = Instant::now() + dur.mul_f64(3.0) + Duration::from_secs(2);
    while !sink.done() {
        if Instant::now() >= deadline {
            eprintln!("tts: drain deadline exceeded; reopening gate anyway");
            return;
        }
        std::thread::sleep(config.poll_interval);
    }
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/// Which backend [`decide_provider`] chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Gemini,
    Say,
}

/// Pure selection logic (no I/O), so it is unit-testable:
/// * an explicit `tts.provider` override ("gemini" | "say") wins;
/// * otherwise Gemini iff a key is present AND the network probe succeeded;
/// * otherwise `say`.
///
/// An override of "gemini" without a key falls back to `say` (we cannot honor it).
pub fn decide_provider(
    override_setting: Option<&str>,
    has_key: bool,
    has_network: bool,
) -> ProviderKind {
    match override_setting {
        Some("say") => ProviderKind::Say,
        Some("gemini") => {
            if has_key {
                ProviderKind::Gemini
            } else {
                ProviderKind::Say
            }
        }
        _ => {
            if has_key && has_network {
                ProviderKind::Gemini
            } else {
                ProviderKind::Say
            }
        }
    }
}

/// Build the concrete provider. Reads the key (Keychain→env) and, for the auto
/// case, probes the network. `model`/`voice`/`provider` come from settings
/// (`tts.model`, `tts.voice`, `tts.provider`); `None` uses the Gemini defaults.
pub fn select_provider(
    provider_override: Option<String>,
    model: Option<String>,
    voice: Option<String>,
) -> Box<dyn TtsProvider> {
    let key = crate::keys::gemini_key();
    let has_key = key.is_some();
    // Only probe the network when the decision might actually need it.
    let needs_probe = provider_override.is_none();
    let has_network = if needs_probe {
        network_available()
    } else {
        true
    };

    match decide_provider(provider_override.as_deref(), has_key, has_network) {
        ProviderKind::Gemini => {
            // has_key is true here (decide_provider guarantees it), so unwrap is safe.
            // Wrap Gemini in a runtime fallback to `say`: if a Gemini synth fails
            // mid-session (network drop, API error), the utterance is still spoken
            // via the always-available `say`, and after repeated failures Gemini
            // goes on a doubling cooldown so acks stop paying a network timeout
            // while a recovered network is still picked up. The wrapper is a
            // plain TtsProvider, so the Speaker's half-duplex gate logic is
            // untouched (the fallback attempt happens in synth, gate still OPEN).
            let primary = Box::new(gemini::GeminiTts::new(
                key.expect("key present for gemini"),
                model,
                voice.clone(),
            ));
            // The configured voice must also reach the `say` fallback — otherwise
            // a user's `tts.voice` setting silently stops applying the moment
            // Gemini fails mid-session and `say` takes over.
            let fallback: Box<dyn TtsProvider> = match voice.clone() {
                Some(v) => Box::new(say::SayTts::with_voice(v)),
                None => Box::new(say::SayTts::new()),
            };
            Box::new(FallbackTts::new(primary, fallback))
        }
        ProviderKind::Say => match voice {
            Some(v) => Box::new(say::SayTts::with_voice(v)),
            None => Box::new(say::SayTts::new()),
        },
    }
}

/// Best-effort reachability probe for the Gemini API host: a short-timeout TCP
/// connect to port 443. Used only for auto provider selection.
fn network_available() -> bool {
    use std::net::ToSocketAddrs;
    let addrs = match ("generativelanguage.googleapis.com", 443).to_socket_addrs() {
        Ok(a) => a,
        Err(_) => return false,
    };
    for addr in addrs {
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, AtomicUsize};
    use std::sync::Arc;

    /// A fake provider whose per-call outcome is scripted, counting how many times
    /// it was actually invoked so a test can assert the primary is (or is not)
    /// called.
    struct FakeProvider {
        /// One entry per expected call: `true` => succeed, `false` => fail. Calls
        /// beyond the script reuse the last entry.
        script: Vec<bool>,
        calls: AtomicUsize,
        tag: &'static str,
    }

    impl FakeProvider {
        fn new(tag: &'static str, script: Vec<bool>) -> Arc<FakeProvider> {
            Arc::new(FakeProvider {
                script,
                calls: AtomicUsize::new(0),
                tag,
            })
        }
        fn call_count(&self) -> usize {
            self.calls.load(Ordering::Acquire)
        }
    }

    impl TtsProvider for Arc<FakeProvider> {
        fn synth(&self, _text: &str) -> Result<Pcm> {
            let n = self.calls.fetch_add(1, Ordering::AcqRel);
            let ok = *self
                .script
                .get(n)
                .or_else(|| self.script.last())
                .unwrap_or(&true);
            if ok {
                Ok(Pcm {
                    rate: 24_000,
                    // A distinct sample per provider so a test can tell them apart.
                    mono_f32: vec![if self.tag == "primary" { 1.0 } else { -1.0 }],
                })
            } else {
                Err(TtsError::Transport(format!(
                    "{} scripted failure",
                    self.tag
                )))
            }
        }
    }

    fn is_fallback(pcm: &Pcm) -> bool {
        pcm.mono_f32 == vec![-1.0f32]
    }

    /// A [`Clock`] the test drives by hand, so cooldown expiry is exercised
    /// without sleeping.
    struct FakeClock {
        base: Instant,
        offset_ms: AtomicU64,
    }

    impl FakeClock {
        fn new() -> Arc<FakeClock> {
            Arc::new(FakeClock {
                base: Instant::now(),
                offset_ms: AtomicU64::new(0),
            })
        }
        fn advance(&self, by: Duration) {
            self.offset_ms
                .fetch_add(by.as_millis() as u64, Ordering::AcqRel);
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            self.base + Duration::from_millis(self.offset_ms.load(Ordering::Acquire))
        }
    }

    /// Records every degraded transition in order, so a test can assert both the
    /// values and the exact count (transitions only, never per failure).
    #[derive(Default)]
    struct RecordingStatus {
        events: Mutex<Vec<bool>>,
    }

    impl RecordingStatus {
        fn new() -> Arc<RecordingStatus> {
            Arc::new(RecordingStatus::default())
        }
        fn events(&self) -> Vec<bool> {
            self.events.lock().unwrap().clone()
        }
    }

    impl TtsStatusSink for RecordingStatus {
        fn set_degraded(&self, degraded: bool) {
            self.events.lock().unwrap().push(degraded);
        }
    }

    /// Build a `FallbackTts` over scripted providers with a fake clock + status
    /// recorder. Returns the pieces every cooldown test needs.
    #[allow(clippy::type_complexity)]
    fn harness(
        primary_script: Vec<bool>,
        fallback_script: Vec<bool>,
        threshold: u32,
    ) -> (
        FallbackTts,
        Arc<FakeProvider>,
        Arc<FakeProvider>,
        Arc<FakeClock>,
        Arc<RecordingStatus>,
    ) {
        let primary = FakeProvider::new("primary", primary_script);
        let fallback = FakeProvider::new("fallback", fallback_script);
        let clock = FakeClock::new();
        let status = RecordingStatus::new();
        let fb = FallbackTts::with_seams(
            Box::new(primary.clone()),
            Box::new(fallback.clone()),
            threshold,
            clock.clone(),
            status.clone(),
        );
        (fb, primary, fallback, clock, status)
    }

    fn disabled(fb: &FallbackTts) -> bool {
        fb.state.lock().unwrap().disabled_until.is_some()
    }

    // Step 1: primary fails once => fallback used, and the consecutive-failure
    // counter reflects that one failure (still 1, below the threshold of 2, so the
    // primary is NOT put on cooldown).
    #[test]
    fn fallback_used_on_single_primary_failure() {
        let (fb, primary, fallback, _clock, status) = harness(vec![false, true], vec![true], 2);

        let pcm = fb.synth("hi").expect("fallback covers the failed primary");
        assert!(
            is_fallback(&pcm),
            "utterance should be spoken by the fallback"
        );
        assert_eq!(primary.call_count(), 1, "primary was tried once");
        assert_eq!(fallback.call_count(), 1, "fallback was used once");
        assert_eq!(
            fb.state.lock().unwrap().fails,
            1,
            "one consecutive fail recorded"
        );
        assert!(
            !disabled(&fb),
            "one failure (< threshold 2) must not pause the primary"
        );
        assert!(
            status.events().is_empty(),
            "a single failure is not a user-visible transition"
        );
    }

    // A primary SUCCESS after a failure resets the consecutive-failure counter, so
    // an intermittent blip never accumulates toward the cooldown threshold.
    #[test]
    fn primary_success_resets_the_fail_counter() {
        // fail, then succeed, then fail again.
        let (fb, _primary, _fallback, _clock, status) =
            harness(vec![false, true, false], vec![true], 2);

        // 1st: primary fails -> counter 1, fallback used.
        assert!(is_fallback(&fb.synth("a").unwrap()));
        assert_eq!(fb.state.lock().unwrap().fails, 1);
        // 2nd: primary succeeds -> counter reset to 0.
        let pcm = fb.synth("b").unwrap();
        assert!(!is_fallback(&pcm), "primary spoke this one");
        assert_eq!(fb.state.lock().unwrap().fails, 0, "success resets");
        // 3rd: primary fails again -> counter 1, NOT 2 (reset happened), primary
        // still in play.
        assert!(is_fallback(&fb.synth("c").unwrap()));
        assert_eq!(fb.state.lock().unwrap().fails, 1);
        assert!(!disabled(&fb));
        assert!(
            status.events().is_empty(),
            "never degraded, so no transitions"
        );
    }

    // After `threshold` consecutive failures the primary goes on cooldown: it is
    // not called again while the cooldown runs, and the degraded transition is
    // reported exactly once.
    #[test]
    fn primary_paused_for_cooldown_after_threshold_failures() {
        // The primary would succeed from the 3rd call on, but must not be reached
        // until the cooldown expires.
        let (fb, primary, fallback, clock, status) =
            harness(vec![false, false, true, true], vec![true], 2);

        assert!(is_fallback(&fb.synth("1").unwrap())); // fail 1
        assert!(is_fallback(&fb.synth("2").unwrap())); // fail 2 -> cooldown
        assert!(disabled(&fb), "cooldown armed at threshold");
        assert_eq!(status.events(), vec![true], "one degraded transition");

        // Utterances inside the cooldown window never touch the primary.
        clock.advance(Duration::from_secs(30));
        assert!(is_fallback(&fb.synth("3").unwrap()));
        assert!(is_fallback(&fb.synth("4").unwrap()));
        assert_eq!(
            primary.call_count(),
            2,
            "primary must not be called during the cooldown"
        );
        assert_eq!(fallback.call_count(), 4, "fallback carries every utterance");
        assert_eq!(status.events(), vec![true], "still exactly one transition");
    }

    // The whole point of S9: once the cooldown expires the primary is retried, and
    // a success restores the cloud voice — no relaunch needed. The fail→recover
    // cycle reports exactly two transitions.
    #[test]
    fn primary_retried_after_cooldown_and_recovery_is_reported_once() {
        let (fb, primary, _fallback, clock, status) =
            harness(vec![false, false, true], vec![true], 2);

        assert!(is_fallback(&fb.synth("1").unwrap()));
        assert!(is_fallback(&fb.synth("2").unwrap())); // -> 60 s cooldown

        // Just before expiry: still fallback, primary untouched.
        clock.advance(COOLDOWN_BASE - Duration::from_secs(1));
        assert!(is_fallback(&fb.synth("3").unwrap()));
        assert_eq!(primary.call_count(), 2);

        // After expiry: primary retried and it works again.
        clock.advance(Duration::from_secs(2));
        let pcm = fb.synth("4").unwrap();
        assert!(!is_fallback(&pcm), "primary spoke after the cooldown");
        assert_eq!(primary.call_count(), 3);
        assert!(!disabled(&fb), "cooldown cleared on success");
        assert_eq!(
            status.events(),
            vec![true, false],
            "exactly two transitions for a fail -> recover cycle"
        );

        // A later success is not another transition.
        assert!(!is_fallback(&fb.synth("5").unwrap()));
        assert_eq!(status.events(), vec![true, false]);
    }

    // Repeated trips double the cooldown (60 s, 120 s, 240 s, ...) and stop at the
    // 10 minute cap. A still-broken primary costs exactly ONE attempt per window
    // (probation), not `threshold` attempts.
    #[test]
    fn cooldown_doubles_and_caps() {
        let (fb, primary, _fallback, clock, status) = harness(vec![false], vec![true], 2);

        // Trip 1: two failures -> 60 s.
        fb.synth("a").unwrap();
        fb.synth("b").unwrap();
        assert_eq!(fb.state.lock().unwrap().last_cooldown, Some(COOLDOWN_BASE));
        assert_eq!(primary.call_count(), 2);

        let mut expected = COOLDOWN_BASE;
        for step in 0..8 {
            clock.advance(expected + Duration::from_secs(1));
            // One retry after expiry; a single failure re-trips (probation).
            fb.synth("retry").unwrap();
            expected = (expected * 2).min(COOLDOWN_MAX);
            assert_eq!(
                fb.state.lock().unwrap().last_cooldown,
                Some(expected),
                "cooldown after retry {step} should double up to the cap"
            );
            assert_eq!(
                primary.call_count(),
                3 + step,
                "exactly one primary attempt per cooldown window"
            );
        }
        assert_eq!(expected, COOLDOWN_MAX, "growth saturates at the 10 min cap");
        assert_eq!(
            status.events(),
            vec![true],
            "still degraded throughout: no repeat transitions"
        );
    }

    // When BOTH providers fail, the error propagates (the Speaker logs it); the
    // utterance is only dropped if neither backend can synthesize it.
    #[test]
    fn both_failing_propagates_error() {
        let (fb, primary, fallback, _clock, _status) = harness(vec![false], vec![false], 2);
        assert!(fb.synth("x").is_err(), "no backend could synthesize");
        assert_eq!(primary.call_count(), 1);
        assert_eq!(fallback.call_count(), 1);
    }

    // The status hub only fires its listener on the values it is given, and
    // `degraded()` reflects the latest one (the polled-state path for a UI that
    // mounts after the transition).
    #[test]
    fn status_hub_tracks_state_and_notifies() {
        let hub = TtsStatusHub::new();
        let seen: Arc<Mutex<Vec<bool>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        hub.set_listener(Box::new(move |degraded| {
            sink.lock().unwrap().push(degraded)
        }));
        assert!(!hub.degraded());
        hub.set_degraded(true);
        assert!(hub.degraded());
        hub.set_degraded(false);
        assert!(!hub.degraded());
        assert_eq!(*seen.lock().unwrap(), vec![true, false]);
    }

    #[test]
    fn decide_override_say_always_say() {
        assert_eq!(decide_provider(Some("say"), true, true), ProviderKind::Say);
        assert_eq!(
            decide_provider(Some("say"), false, false),
            ProviderKind::Say
        );
    }

    #[test]
    fn decide_override_gemini_needs_key() {
        assert_eq!(
            decide_provider(Some("gemini"), true, false),
            ProviderKind::Gemini,
            "explicit gemini honored with a key even offline"
        );
        assert_eq!(
            decide_provider(Some("gemini"), false, true),
            ProviderKind::Say,
            "explicit gemini falls back to say without a key"
        );
    }

    #[test]
    fn decide_auto_gemini_iff_key_and_network() {
        assert_eq!(decide_provider(None, true, true), ProviderKind::Gemini);
        assert_eq!(decide_provider(None, true, false), ProviderKind::Say);
        assert_eq!(decide_provider(None, false, true), ProviderKind::Say);
        assert_eq!(decide_provider(None, false, false), ProviderKind::Say);
    }
}
