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
use std::sync::mpsc;
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
    let has_network = if needs_probe { network_available() } else { true };

    match decide_provider(provider_override.as_deref(), has_key, has_network) {
        ProviderKind::Gemini => {
            // has_key is true here (decide_provider guarantees it), so unwrap is safe.
            Box::new(gemini::GeminiTts::new(
                key.expect("key present for gemini"),
                model,
                voice,
            ))
        }
        ProviderKind::Say => Box::new(say::SayTts::new()),
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

    #[test]
    fn decide_override_say_always_say() {
        assert_eq!(decide_provider(Some("say"), true, true), ProviderKind::Say);
        assert_eq!(decide_provider(Some("say"), false, false), ProviderKind::Say);
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
