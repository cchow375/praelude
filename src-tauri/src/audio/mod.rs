//! Real-time audio engine: a sample-accurate click clock, a mixer, and a cpal
//! output stream. See [`clock`] for scheduling and [`mixer`] for voicing.
//!
//! # Real-time discipline
//!
//! The cpal callback owns the [`ClickClock`] and [`Mixer`] outright (moved into
//! the closure). Everything the *outside world* pushes at it crosses the thread
//! boundary through lock-free [`ArrayQueue`]s, never a mutex:
//!
//! * **Pattern changes** ride a small `ArrayQueue<ClickPattern>`; the callback
//!   drains it and keeps the newest. `ClickPattern` is `Copy`, so this is a wait-
//!   free hand-off.
//! * **TTS PCM** rides an `ArrayQueue<Vec<f32>>` of already-resampled chunks
//!   (resampling happens on the *enqueue* thread, never in the callback).
//!
//! The callback does not lock, does not do I/O, and **never allocates or frees**,
//! not even on the bursty voice path. (The two warm-up allocations — growing the
//! scratch and event scratch buffers on the first buffer — settle immediately.)
//! To keep the TTS path allocation-free *and* free-free:
//!
//! * The mixer's `pcm_queue` is pre-reserved to the hard pending cap
//!   ([`PCM_CAP_SECONDS`]) at engine start, and `enqueue_pcm` refuses any chunk
//!   that would push total pending past that cap — so the callback's `extend`
//!   into `pcm_queue` can never reallocate.
//! * Instead of dropping (freeing) each drained chunk `Vec`, the callback copies
//!   its samples out, clears it, and pushes the now-empty `Vec` onto a **recycle
//!   `ArrayQueue<Vec<f32>>`** for `enqueue_pcm` to refill. The recycle queue is
//!   sized larger than the chunk queue (see [`RECYCLE_QUEUE_CHUNKS`]) so that
//!   push can never fail — the callback therefore never has to free a chunk.
//!
//! # `pcm_done` semantics
//!
//! `pcm_pending` counts enqueued-but-not-yet-*output* PCM samples: reserved
//! (incremented) at enqueue *before* the chunk is published to the queue,
//! decremented only as `Mixer::render` actually consumes samples. Reserving first
//! is the load-bearing ordering: if we pushed the chunk and *then* incremented, a
//! concurrent [`EngineHandle::pcm_done`] could observe the count at 0 while the
//! samples already sit in the queue, falsely report "done", and open Task 11's
//! half-duplex mic gate over still-audible TTS. Reserve-first makes the count a
//! conservative over-estimate during the tiny publish window, never an
//! under-estimate — so `pcm_done` can never be falsely `true` while any TTS audio
//! is buffered anywhere. If the push fails, the reservation is backed out.

pub mod chime;
pub mod clock;
pub mod mixer;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use crossbeam_queue::ArrayQueue;

#[allow(unused_imports)]
pub use clock::{
    ClickClock, ClickEvent, ClickKind, ClickPattern, MAX_BPM, MAX_SUBDIVISION, MIN_BPM,
};
#[allow(unused_imports)]
pub use mixer::Mixer;

/// Click samples for [`EngineConfig`], at `src_rate` Hz (resampled to the stream
/// rate when the engine starts). Empty vectors mean "silent for that kind".
#[derive(Clone, Default)]
pub struct Clicks {
    pub accent: Vec<f32>,
    pub beat: Vec<f32>,
    pub sub: Vec<f32>,
    pub src_rate: u32,
}

/// How to start the engine.
pub struct EngineConfig {
    /// Initial pattern (adopted on the very first beat).
    pub pattern: ClickPattern,
    /// Click samples, or `None` to run silent until Task 6's WAV assets load.
    pub clicks: Option<Clicks>,
    /// Initial click-voice gain (metronome volume). Seeds the atomic so the very
    /// first rendered buffer is already at the intended level (no unity-gain blip
    /// before the first `set_click_gain`).
    pub click_gain: f32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        EngineConfig {
            pattern: ClickPattern::default(),
            clicks: None,
            click_gain: 1.0,
        }
    }
}

/// Capacity (in chunks / patterns) of the lock-free hand-off queues.
const PCM_QUEUE_CHUNKS: usize = 1024;
const PATTERN_QUEUE_LEN: usize = 16;
/// Capacity of the empty-`Vec` recycle queue. Must exceed [`PCM_QUEUE_CHUNKS`]:
/// at most `PCM_QUEUE_CHUNKS` chunk `Vec`s can sit in `pcm_q`, plus one held
/// transiently by the callback and one by the *single* enqueue producer, so `+2`
/// guarantees the callback's push-to-recycle can never fail (and it therefore
/// never frees a chunk in the real-time path). This proof relies on the
/// single-producer contract documented on [`EngineHandle::enqueue_pcm`]: with N
/// concurrent producers the transient-hold term becomes N, not 1, and no fixed
/// size would suffice.
const RECYCLE_QUEUE_CHUNKS: usize = PCM_QUEUE_CHUNKS + 2;
/// Hard cap on buffered TTS: `enqueue_pcm` refuses any chunk that would push
/// total pending PCM past this many seconds (at the stream rate). The mixer's
/// `pcm_queue` is pre-reserved to exactly this many samples so the callback's
/// `extend` never reallocates. 30 s comfortably exceeds any single TTS utterance.
const PCM_CAP_SECONDS: usize = 30;

/// A running engine. `Send + Sync`: it holds only `Arc`s to lock-free state and a
/// join handle — the non-`Send` cpal `Stream` lives entirely on the audio thread
/// and is never moved across threads.
pub struct EngineHandle {
    pattern_q: Arc<ArrayQueue<ClickPattern>>,
    pcm_q: Arc<ArrayQueue<Vec<f32>>>,
    /// Emptied chunk `Vec`s recycled by the callback for `enqueue_pcm` to refill,
    /// so the callback never allocates or frees. See module docs.
    recycle_q: Arc<ArrayQueue<Vec<f32>>>,
    /// Enqueued-but-not-yet-output PCM samples. See module docs.
    pcm_pending: Arc<AtomicUsize>,
    /// Click-voice gain as `f32` bits, read by the callback each buffer. This is
    /// the metronome-volume control: it extends the engine's lock-free input
    /// design (like `pattern_q`) rather than reaching into the callback-owned
    /// `Mixer` across threads. Relaxed ordering is fine — a gain change need only
    /// be picked up "soon", never synchronized against other state.
    click_gain: Arc<AtomicU32>,
    /// Hard cap (in samples at the stream rate) on `pcm_pending`; enqueues that
    /// would exceed it are refused. Equals `sample_rate * PCM_CAP_SECONDS`.
    pcm_cap: usize,
    sample_rate: u32,
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// Static proof that the handle really is thread-safe (it is documented as
/// `Send + Sync` and shared across the UI and audio threads). A compile-time
/// assertion here fails loudly if a future field breaks the guarantee.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<EngineHandle>();
};

/// Why an [`EngineHandle::enqueue_pcm`] chunk was refused (dropped rather than
/// buffered). Both variants mean the caller should try again later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PcmError {
    /// Buffering this chunk would push total pending PCM past the ~30 s hard cap.
    CapExceeded,
    /// The fixed-size chunk hand-off queue is momentarily full.
    QueueFull,
}

impl EngineHandle {
    /// The output stream's sample rate (Hz). TTS enqueued via [`Self::enqueue_pcm`]
    /// is resampled to this rate.
    #[allow(dead_code)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Set the click-voice gain (metronome volume). Applied by the callback on
    /// its next buffer via a lock-free atomic — no allocation, no lock, no engine
    /// restart. Non-finite values are ignored.
    pub fn set_click_gain(&self, gain: f32) {
        if gain.is_finite() {
            self.click_gain.store(gain.to_bits(), Ordering::Relaxed);
        }
    }

    /// Change the metronome pattern. Takes effect at the next beat boundary.
    pub fn set_pattern(&self, pattern: ClickPattern) {
        // Newest wins; if the tiny queue is momentarily full, make room.
        if self.pattern_q.push(pattern).is_err() {
            let _ = self.pattern_q.pop();
            let _ = self.pattern_q.push(pattern);
        }
    }

    /// Enqueue TTS PCM (`samples` at `src_rate` Hz, mono f32) for playback. The
    /// samples are resampled to the stream rate *here*, off the audio thread,
    /// into a `Vec` reused from the callback's recycle pool when one is available
    /// (bounding allocation on the voice path).
    ///
    /// **Single-producer contract:** call this from one producer thread only.
    /// TTS is an inherently serial stream (one utterance's chunks after another),
    /// so this is the natural shape. The recycle-pool sizing that keeps the audio
    /// callback free-free ([`RECYCLE_QUEUE_CHUNKS`]) is proven under this
    /// precondition; concurrent callers could grow the pool past its bound and
    /// force the callback to free a chunk. `EngineHandle` is still `Send + Sync`
    /// because the *read/observer* methods ([`Self::pcm_done`],
    /// [`Self::sample_rate`], [`Self::set_pattern`]) are safe from any thread —
    /// only `enqueue_pcm` carries the single-producer requirement.
    ///
    /// Returns `Err` — without buffering anything — if the chunk would push total
    /// pending PCM past the ~30 s hard cap ([`PcmError::CapExceeded`]) or if the
    /// chunk hand-off queue is momentarily full ([`PcmError::QueueFull`]). On
    /// either refusal the pending count and recycle pool are left exactly as they
    /// were, so `pcm_done` accounting stays consistent.
    pub fn enqueue_pcm(&self, samples: &[f32], src_rate: u32) -> Result<(), PcmError> {
        // Refill a recycled buffer if the callback has handed one back; otherwise
        // this is the only place on the TTS path that may allocate (off the audio
        // thread, which is fine).
        let mut buf = self.recycle_q.pop().unwrap_or_default();
        resample_linear_into(samples, src_rate, self.sample_rate, &mut buf);
        if buf.is_empty() {
            let _ = self.recycle_q.push(buf); // nothing to play; return the Vec
            return Ok(());
        }
        let len = buf.len();

        // Reserve first: bump the pending count BEFORE the chunk is visible in the
        // queue, so a concurrent `pcm_done` can never see 0 while samples are
        // already buffered (see module docs). Back the reservation out on refusal.
        let prev = self.pcm_pending.fetch_add(len, Ordering::AcqRel);
        if prev + len > self.pcm_cap {
            self.pcm_pending.fetch_sub(len, Ordering::AcqRel);
            let _ = self.recycle_q.push(buf); // recycle, never free
            return Err(PcmError::CapExceeded);
        }
        if let Err(buf) = self.pcm_q.push(buf) {
            self.pcm_pending.fetch_sub(len, Ordering::AcqRel);
            let _ = self.recycle_q.push(buf); // recycle the rejected Vec
            return Err(PcmError::QueueFull);
        }
        Ok(())
    }

    /// `true` once every enqueued TTS sample has been output through the callback
    /// (nothing left in the hand-off queue *or* the mixer). Callable from any
    /// thread. Vacuously `true` when nothing has been enqueued.
    pub fn pcm_done(&self) -> bool {
        self.pcm_pending.load(Ordering::Acquire) == 0
    }
}

#[cfg(test)]
impl EngineHandle {
    /// Test-only, device-free handle for exercising control-path logic (e.g. the
    /// metronome's TTS-drop restart guard) without opening an audio stream.
    /// `pcm_pending` seeds the busy indicator: any nonzero value makes
    /// [`Self::pcm_done`] return `false` (as if speech were still playing).
    /// `thread: None` so `Drop` is a no-op.
    pub(crate) fn test_handle(sample_rate: u32, pcm_pending: usize) -> EngineHandle {
        EngineHandle {
            pattern_q: Arc::new(ArrayQueue::new(PATTERN_QUEUE_LEN)),
            pcm_q: Arc::new(ArrayQueue::new(4)),
            recycle_q: Arc::new(ArrayQueue::new(6)),
            pcm_pending: Arc::new(AtomicUsize::new(pcm_pending)),
            click_gain: Arc::new(AtomicU32::new(1.0f32.to_bits())),
            pcm_cap: sample_rate as usize * PCM_CAP_SECONDS,
            sample_rate,
            shutdown: Arc::new(AtomicBool::new(false)),
            thread: None,
        }
    }
}

impl Drop for EngineHandle {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            t.thread().unpark();
            let _ = t.join();
        }
    }
}

/// Namespace for engine construction.
pub struct Engine;

impl Engine {
    /// Open the default output device, start an f32 output stream, and return a
    /// handle. Blocks only until the stream is built (or fails); audio then runs
    /// on a dedicated thread until the handle is dropped.
    pub fn start(config: EngineConfig) -> Result<EngineHandle, String> {
        let pattern_q = Arc::new(ArrayQueue::new(PATTERN_QUEUE_LEN));
        let pcm_q = Arc::new(ArrayQueue::new(PCM_QUEUE_CHUNKS));
        let recycle_q = Arc::new(ArrayQueue::new(RECYCLE_QUEUE_CHUNKS));
        let pcm_pending = Arc::new(AtomicUsize::new(0));
        let click_gain = Arc::new(AtomicU32::new(config.click_gain.to_bits()));
        let shutdown = Arc::new(AtomicBool::new(false));

        // The cpal Stream is not Send on CoreAudio, so it must be built, played,
        // and dropped all on one thread. `ready` reports the build outcome back.
        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();

        let t_pattern_q = pattern_q.clone();
        let t_pcm_q = pcm_q.clone();
        let t_recycle_q = recycle_q.clone();
        let t_pcm_pending = pcm_pending.clone();
        let t_click_gain = click_gain.clone();
        let t_shutdown = shutdown.clone();

        let thread = std::thread::Builder::new()
            .name("codakiller-audio".into())
            .spawn(move || {
                match build_stream(
                    &config,
                    t_pattern_q,
                    t_pcm_q,
                    t_recycle_q,
                    t_pcm_pending,
                    t_click_gain,
                ) {
                    Ok((stream, sample_rate)) => {
                        if stream.play().is_err() {
                            let _ = ready_tx.send(Err("failed to start output stream".into()));
                            return;
                        }
                        let _ = ready_tx.send(Ok(sample_rate));
                        // Keep the stream alive until asked to stop; dropping it
                        // stops the audio.
                        while !t_shutdown.load(Ordering::Acquire) {
                            std::thread::park_timeout(Duration::from_millis(100));
                        }
                        drop(stream);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| format!("failed to spawn audio thread: {e}"))?;

        match ready_rx.recv() {
            Ok(Ok(sample_rate)) => Ok(EngineHandle {
                pattern_q,
                pcm_q,
                recycle_q,
                pcm_pending,
                click_gain,
                pcm_cap: sample_rate as usize * PCM_CAP_SECONDS,
                sample_rate,
                shutdown,
                thread: Some(thread),
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                let _ = thread.join();
                Err("audio thread exited before reporting readiness".into())
            }
        }
    }
}

/// Build (but do not play) the output stream and wire the callback. Returns the
/// stream and its sample rate.
fn build_stream(
    config: &EngineConfig,
    pattern_q: Arc<ArrayQueue<ClickPattern>>,
    pcm_q: Arc<ArrayQueue<Vec<f32>>>,
    recycle_q: Arc<ArrayQueue<Vec<f32>>>,
    pcm_pending: Arc<AtomicUsize>,
    click_gain: Arc<AtomicU32>,
) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "no default output device".to_string())?;

    let supported = choose_f32_config(&device)?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let stream_config: cpal::StreamConfig = supported.config();

    // Build clock + mixer owned by the callback.
    let mut clock = ClickClock::new(sample_rate);
    clock.set_pattern(config.pattern);

    let mut mixer = Mixer::new();
    mixer.click_gain = config.click_gain;
    // Reserve to the hard pending cap so the callback's `extend` into `pcm_queue`
    // never reallocates (enqueue_pcm refuses anything past this cap).
    mixer.reserve_pcm(sample_rate as usize * PCM_CAP_SECONDS);
    if let Some(c) = &config.clicks {
        mixer.set_clicks(
            resample_linear(&c.accent, c.src_rate, sample_rate),
            resample_linear(&c.beat, c.src_rate, sample_rate),
            resample_linear(&c.sub, c.src_rate, sample_rate),
        );
    }

    // Reusable scratch, sized on the first buffer (grows at most once).
    let mut scratch: Vec<f32> = Vec::new();
    // Event scratch. Capacity 64 cannot realloc in practice: the clock clamps
    // subdivisions to MAX_SUBDIVISION (16) and bpm to ≤1000, so at 48 kHz the
    // shortest tick spacing is ~180 frames; a typical ≤4096-frame CoreAudio
    // buffer emits far fewer than 64 events. Any first-buffer growth (warm-up)
    // settles immediately, as with `scratch`.
    let mut events: Vec<ClickEvent> = Vec::with_capacity(64);

    let err_fn = |e| eprintln!("audio stream error: {e}");

    let stream = device
        .build_output_stream::<f32, _, _>(
            stream_config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                // 1. Adopt the newest pending pattern (drain, keep last).
                let mut latest = None;
                while let Some(p) = pattern_q.pop() {
                    latest = Some(p);
                }
                if let Some(p) = latest {
                    clock.set_pattern(p);
                }

                // Pick up the latest click gain (metronome volume). Lock-free
                // atomic read; no allocation.
                mixer.click_gain = f32::from_bits(click_gain.load(Ordering::Relaxed));

                // 2. Move any enqueued TTS chunks into the mixer's queue. Copy the
                //    samples out (pcm_queue is pre-reserved to the cap, so this
                //    never reallocates), then hand the emptied Vec back to the
                //    recycle pool instead of dropping it — the callback never
                //    frees. The recycle queue is sized so this push cannot fail.
                while let Some(mut chunk) = pcm_q.pop() {
                    mixer.pcm_queue.extend(chunk.iter().copied());
                    chunk.clear();
                    let _ = recycle_q.push(chunk);
                }

                // 3. Schedule + render this buffer (mono), then fan out to
                //    every output channel.
                let chans = channels.max(1);
                let frames = data.len() / chans;
                if scratch.len() < frames {
                    scratch.resize(frames, 0.0);
                }
                clock.next_events_into(frames, &mut events);
                for e in events.iter() {
                    mixer.trigger(e.kind, e.offset_in_buffer);
                }
                let consumed = mixer.render(&mut scratch[..frames]);
                if consumed > 0 {
                    pcm_pending.fetch_sub(consumed, Ordering::AcqRel);
                }
                for (i, frame) in data.chunks_mut(chans).enumerate() {
                    // cpal supplies whole frames (data.len() % chans == 0), so a
                    // trailing partial chunk never occurs — but never panic in the
                    // callback if one somehow did.
                    let v = scratch.get(i).copied().unwrap_or(0.0);
                    for s in frame.iter_mut() {
                        *s = v;
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("failed to build output stream: {e}"))?;

    Ok((stream, sample_rate))
}

/// Pick an f32 output config: prefer the device default, otherwise search the
/// supported configs. cpal on macOS/CoreAudio supplies f32 by default.
fn choose_f32_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    let default = device
        .default_output_config()
        .map_err(|e| format!("no default output config: {e}"))?;
    if default.sample_format() == SampleFormat::F32 {
        return Ok(default);
    }
    let want_rate = default.sample_rate();
    let ranges = device
        .supported_output_configs()
        .map_err(|e| format!("no supported output configs: {e}"))?;
    for range in ranges {
        if range.sample_format() == SampleFormat::F32 {
            let rate = want_rate.clamp(range.min_sample_rate(), range.max_sample_rate());
            return Ok(range.with_sample_rate(rate));
        }
    }
    Err(format!(
        "device has no f32 output config (default is {:?})",
        default.sample_format()
    ))
}

/// Linear-interpolation resample of mono f32 from `src_rate` to `dst_rate`.
/// Adequate for v1 TTS. Off the audio thread; allocation is fine here. Thin
/// allocating wrapper around [`resample_linear_into`].
pub fn resample_linear(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    let mut out = Vec::new();
    resample_linear_into(input, src_rate, dst_rate, &mut out);
    out
}

/// Resample into a caller-provided `out` (cleared first, then filled). Lets the
/// enqueue path reuse a recycled buffer's allocation instead of allocating a
/// fresh `Vec` each call. Off the audio thread.
pub fn resample_linear_into(input: &[f32], src_rate: u32, dst_rate: u32, out: &mut Vec<f32>) {
    out.clear();
    if input.is_empty() || src_rate == 0 || dst_rate == 0 {
        return;
    }
    if src_rate == dst_rate {
        out.extend_from_slice(input);
        return;
    }
    let ratio = dst_rate as f64 / src_rate as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    out.reserve(out_len);
    let last = input.len() - 1;
    for i in 0..out_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input[idx.min(last)];
        let b = input[(idx + 1).min(last)];
        out.push(a + (b - a) * frac);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure-math check on the enqueue-time resampler (no device).
    #[test]
    fn resample_upsamples_and_preserves_endpoints() {
        // 2 samples at 24 kHz -> 48 kHz. Endpoints preserved, length scales.
        let out = resample_linear(&[0.0, 1.0], 24_000, 48_000);
        assert_eq!(out.len(), 4);
        // src positions 0, 0.5, 1.0, 1.5 -> [0.0, 0.5, 1.0, 1.0] (tail clamps).
        assert!((out[0] - 0.0).abs() < 1e-6, "start preserved");
        assert!((out[1] - 0.5).abs() < 1e-6, "interpolated midpoint");
        assert!((out[2] - 1.0).abs() < 1e-6, "end sample reached");
        assert!(
            (out[3] - 1.0).abs() < 1e-6,
            "past-end clamps to last sample"
        );
        // Same rate is identity.
        assert_eq!(
            resample_linear(&[0.1, 0.2, 0.3], 24_000, 24_000),
            vec![0.1, 0.2, 0.3]
        );
    }

    // A device-free `EngineHandle` for exercising the `enqueue_pcm` accounting
    // paths (queue full / cap exceeded / backout) without opening an audio
    // stream. `thread: None` so `Drop` is a no-op. Same-module test => private
    // fields are reachable.
    fn headless_handle(sample_rate: u32, chunks: usize, cap_seconds: usize) -> EngineHandle {
        EngineHandle {
            pattern_q: Arc::new(ArrayQueue::new(PATTERN_QUEUE_LEN)),
            pcm_q: Arc::new(ArrayQueue::new(chunks)),
            recycle_q: Arc::new(ArrayQueue::new(chunks + 2)),
            pcm_pending: Arc::new(AtomicUsize::new(0)),
            click_gain: Arc::new(AtomicU32::new(1.0f32.to_bits())),
            pcm_cap: sample_rate as usize * cap_seconds,
            sample_rate,
            shutdown: Arc::new(AtomicBool::new(false)),
            thread: None,
        }
    }

    // Backout path: when the chunk queue is full, `enqueue_pcm` must reserve then
    // fully back out its reservation, leaving `pcm_pending` (and `pcm_done`)
    // exactly as before the refused call.
    #[test]
    fn enqueue_backs_out_reservation_when_queue_full() {
        // src_rate == sample_rate => identity resample, so chunk len == input len.
        let handle = headless_handle(48_000, 4, 30);
        let chunk = vec![0.1f32; 100];

        // Fill all 4 chunk slots.
        for _ in 0..4 {
            handle.enqueue_pcm(&chunk, 48_000).expect("slot available");
        }
        let pending_before = handle.pcm_pending.load(Ordering::Acquire);
        assert_eq!(pending_before, 400, "4 chunks * 100 samples pending");
        assert!(!handle.pcm_done(), "not done while chunks are buffered");

        // The 5th enqueue cannot push (queue full) and must back its reservation
        // out completely.
        let err = handle.enqueue_pcm(&chunk, 48_000).unwrap_err();
        assert_eq!(err, PcmError::QueueFull);
        assert_eq!(
            handle.pcm_pending.load(Ordering::Acquire),
            pending_before,
            "pending must return to its prior value after a refused enqueue"
        );
        assert!(
            !handle.pcm_done(),
            "still not done; nothing was lost or falsely cleared"
        );

        // The refused chunk's Vec was recycled, not leaked/freed: a fresh enqueue
        // after freeing a queue slot succeeds again. (A raw `pcm_q.pop` here does
        // not touch `pcm_pending` — only `render` decrements it — so pending rises
        // from 400 to 500 with the newly accepted chunk.)
        assert!(handle.pcm_q.pop().is_some(), "drain one slot");
        handle.enqueue_pcm(&chunk, 48_000).expect("slot free again");
        assert_eq!(handle.pcm_pending.load(Ordering::Acquire), 500);
    }

    // Cap path: `enqueue_pcm` refuses (and backs out) when total pending would
    // exceed the ~PCM_CAP_SECONDS hard cap, before the chunk queue is full.
    #[test]
    fn enqueue_refuses_past_the_pending_cap() {
        // sample_rate 100, cap 3 s => cap = 300 samples. Plenty of chunk slots so
        // the cap (not the queue) is what refuses.
        let handle = headless_handle(100, 1024, 3);
        let chunk = vec![0.2f32; 100];
        for _ in 0..3 {
            handle.enqueue_pcm(&chunk, 100).expect("under cap");
        }
        assert_eq!(
            handle.pcm_pending.load(Ordering::Acquire),
            300,
            "at the cap"
        );
        let err = handle.enqueue_pcm(&chunk, 100).unwrap_err();
        assert_eq!(err, PcmError::CapExceeded);
        assert_eq!(
            handle.pcm_pending.load(Ordering::Acquire),
            300,
            "over-cap enqueue backs out; pending stays at the cap"
        );
    }

    // Live check of the pcm_done contract through the real stream: false while
    // TTS is buffered, true once fully output. Needs a device:
    //   cargo test pcm_done_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn pcm_done_live() {
        let handle = Engine::start(EngineConfig::default()).expect("engine starts");
        assert!(handle.pcm_done(), "vacuously done before any enqueue");
        // ~0.4s of quiet-ish tone at 24 kHz (TTS rate).
        let rate = 24_000u32;
        let n = (rate as f32 * 0.4) as usize;
        let pcm: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / rate as f32).sin() * 0.2)
            .collect();
        handle.enqueue_pcm(&pcm, rate).expect("enqueue accepted");
        assert!(!handle.pcm_done(), "not done immediately after enqueue");
        // Poll until drained (or fail after a generous timeout).
        let mut done = false;
        for _ in 0..200 {
            if handle.pcm_done() {
                done = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(done, "pcm_done must become true once the queue drains");
        eprintln!("pcm_done transitioned false -> true correctly");
        drop(handle);
    }

    // A short audible run: 4 beats at 120 bpm through the real cpal stream.
    // Ignored by default (needs an output device); run with:
    //   cargo test click_audible -- --ignored --nocapture
    #[test]
    #[ignore]
    fn click_audible() {
        // Synthetic click: a short decaying sine burst (Task 6 replaces this
        // with real WAVs via Mixer::load_clicks).
        fn click(rate: u32, freq: f32, secs: f32) -> Vec<f32> {
            let n = (rate as f32 * secs) as usize;
            (0..n)
                .map(|i| {
                    let t = i as f32 / rate as f32;
                    let env = (-t * 40.0).exp(); // fast decay
                    (2.0 * std::f32::consts::PI * freq * t).sin() * env * 0.6
                })
                .collect()
        }
        let rate = 48_000;
        let clicks = Clicks {
            accent: click(rate, 1760.0, 0.06),
            beat: click(rate, 880.0, 0.05),
            sub: click(rate, 660.0, 0.04),
            src_rate: rate,
        };
        let handle = Engine::start(EngineConfig {
            pattern: ClickPattern {
                bpm: 120.0,
                beats_per_bar: 4,
                accent_first: true,
                subdivision: 1,
            },
            clicks: Some(clicks),
            click_gain: 1.0,
        })
        .expect("engine should start on this Mac");
        eprintln!(
            "playing 4 beats at 120 bpm @ {} Hz...",
            handle.sample_rate()
        );
        // 4 beats at 120 bpm = 2 seconds; give the tail a moment.
        std::thread::sleep(Duration::from_millis(2300));
        eprintln!("done; pcm_done()={}", handle.pcm_done());
        drop(handle);
    }
}
