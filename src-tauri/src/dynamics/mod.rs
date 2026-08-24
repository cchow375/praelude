//! Loudness-only dynamics meter: a cpal **input** stream, A-weighting, and an
//! RMS/peak readout published as `dynamics://level`.
//!
//! # THE LAW
//!
//! Loudness only, forever. There is no FFT here, no pitch/onset/note detection,
//! no transcription and no grading. The entire public surface of this module is
//! **dB figures** — [`LevelEvent`] carries `rms_db`, `peak_db` and a timestamp,
//! and nothing else will ever be added to it. The app reports levels; the
//! musician judges the music.
//!
//! # Isolation
//!
//! This module is completely separate from [`crate::audio`], which owns the
//! *output* Engine (playback). Nothing here touches that Engine, the metronome,
//! voice/STT, or any practice table. The only device this module opens is the
//! default **input** device.
//!
//! # The mic never runs idle
//!
//! The cpal input stream exists only between [`DynamicsMeter::start`] and
//! [`DynamicsMeter::stop`]. There is no "warm" or "paused" state that holds the
//! device open: `stop` drops the `Stream`, which closes the device, and joins
//! the meter thread. Panel close, window close and app exit all route to `stop`.
//!
//! # Real-time discipline
//!
//! Mirrors `crate::audio`'s rules (see that module's header) verbatim. The input
//! callback owns its [`AWeighting`] cascade and its [`RmsRing`] outright — both
//! are constructed *before* the closure and moved into it — and does only
//! arithmetic plus three atomic stores. It never locks, never allocates, never
//! frees and never does I/O. State leaves the callback exclusively through
//! [`SharedLevels`]' atomics. The `app.emit` happens on the control-side ticker,
//! never in the callback.
//!
//! # Levels above 0 dBFS are real
//!
//! Core Audio float input is **not** hard-clipped at ±1.0; readings slightly
//! above 0 dBFS occur in practice (+0.28 dBFS was measured on the target
//! machine during the B0 spike). Nothing here asserts, panics or errors on a
//! level being ≤ 0 dBFS. Clamping is a *display* concern and belongs in the UI.

pub mod weighting;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use tauri::{AppHandle, Emitter, State};

use weighting::AWeighting;

/// dBFS floor. Digital silence reports exactly this, never -inf.
pub const DB_FLOOR: f32 = -100.0;
/// RMS integration window. 125 ms == IEC "fast" weighting.
pub const RMS_WINDOW_MS: u32 = 125;
/// Control-side emit rate. 8 Hz — one event per RMS window, no faster.
pub const TICK_HZ: u32 = 8;

/// Amplitudes at or below this are treated as digital silence, so
/// [`amplitude_to_dbfs`] can never hand back `-inf` or `NaN`.
const SILENCE_EPSILON: f32 = 1e-10;

/// Levels published by the audio callback, read by the ticker thread.
///
/// # f32-bits-as-u32 encoding
///
/// `AtomicF32` does not exist in `std`. Both fields hold `f32::to_bits(v)` of a
/// dBFS figure and are read back with `f32::from_bits(..)`. The transform is
/// lossless and total for every finite f32 (`to_bits`/`from_bits` are exact
/// inverses), so no precision is traded for lock-freedom. Each field is stored
/// with `Ordering::Relaxed`: the two are INDEPENDENT readings, never a pair that
/// must be observed atomically together — a ticker that catches `rms` from
/// window N and `peak` from window N+1 is displaying two truthful numbers 125 ms
/// apart, which is invisible at 8 Hz and costs nothing. `seq` (Release on write,
/// Acquire on read) exists only so the ticker can tell "the callback is alive and
/// producing" from "the stream died silently".
#[derive(Debug)]
pub struct SharedLevels {
    rms_db_bits: AtomicU32,
    peak_db_bits: AtomicU32,
    seq: AtomicU64,
}

impl Default for SharedLevels {
    fn default() -> Self {
        Self::new()
    }
}

impl SharedLevels {
    pub fn new() -> Self {
        Self {
            rms_db_bits: AtomicU32::new(DB_FLOOR.to_bits()),
            peak_db_bits: AtomicU32::new(DB_FLOOR.to_bits()),
            seq: AtomicU64::new(0),
        }
    }

    /// Called ONLY from the audio callback. Two relaxed stores + one release
    /// store; no allocation, no lock, wait-free.
    #[inline(always)]
    pub fn publish(&self, rms_db: f32, peak_db: f32) {
        self.rms_db_bits.store(rms_db.to_bits(), Ordering::Relaxed);
        self.peak_db_bits.store(peak_db.to_bits(), Ordering::Relaxed);
        self.seq.fetch_add(1, Ordering::Release);
    }

    /// Called ONLY from the ticker thread.
    pub fn read(&self) -> (f32, f32, u64) {
        let seq = self.seq.load(Ordering::Acquire);
        let rms = f32::from_bits(self.rms_db_bits.load(Ordering::Relaxed));
        let peak = f32::from_bits(self.peak_db_bits.load(Ordering::Relaxed));
        (rms, peak, seq)
    }
}

/// Fixed-capacity sum-of-squares ring. Allocated ONCE at stream build (before
/// the callback exists) and moved into the callback; `push` never allocates,
/// never grows, never frees.
pub struct RmsRing {
    /// Squares of the weighted samples currently in the window.
    sq: Vec<f32>,
    /// Absolute values of the *raw* samples currently in the window.
    abs: Vec<f32>,
    idx: usize,
    sum_sq: f64,
    peak_abs: f32,
    filled: usize,
}

impl RmsRing {
    pub fn new(sample_rate: u32, window_ms: u32) -> Self {
        // At least one sample, so `push` can never divide by zero.
        let capacity = (((sample_rate as u64) * (window_ms as u64)) / 1_000).max(1) as usize;
        Self {
            sq: vec![0.0; capacity],
            abs: vec![0.0; capacity],
            idx: 0,
            sum_sq: 0.0,
            peak_abs: 0.0,
            filled: 0,
        }
    }

    /// Number of samples in one full window. Analysis/test surface: the
    /// callback never needs it, so it is dead outside `cfg(test)`.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn capacity(&self) -> usize {
        self.sq.len()
    }

    /// Push one weighted sample; returns `(rms_dbfs, peak_dbfs)` for the window.
    ///
    /// Callback-safe: no allocation, no lock, no I/O. The only unbounded-ish
    /// work is the peak rescan, which runs *only* when the evicted sample was
    /// itself the window's peak — a bounded compare loop over an already-owned
    /// buffer, never a resize.
    #[inline(always)]
    pub fn push(&mut self, weighted: f32, raw_abs: f32) -> (f32, f32) {
        let cap = self.sq.len();
        let out_sq = self.sq[self.idx];
        let out_abs = self.abs[self.idx];

        let in_sq = weighted * weighted;
        self.sum_sq += in_sq as f64 - out_sq as f64;
        // Floating-point drift over millions of pushes can make a mathematically
        // zero sum go very slightly negative; clamp rather than hand `sqrt` a
        // negative.
        if self.sum_sq < 0.0 {
            self.sum_sq = 0.0;
        }
        self.sq[self.idx] = in_sq;
        self.abs[self.idx] = raw_abs;

        if raw_abs >= self.peak_abs {
            self.peak_abs = raw_abs;
        } else if out_abs >= self.peak_abs {
            // The sample leaving the window WAS the peak: rescan.
            let mut m = 0.0_f32;
            for v in self.abs.iter() {
                if *v > m {
                    m = *v;
                }
            }
            self.peak_abs = m;
        }

        self.idx += 1;
        if self.idx == cap {
            self.idx = 0;
        }
        if self.filled < cap {
            self.filled += 1;
        }

        let mean_sq = self.sum_sq / self.filled as f64;
        let rms = mean_sq.max(0.0).sqrt() as f32;
        (amplitude_to_dbfs(rms), amplitude_to_dbfs(self.peak_abs))
    }
}

/// Linear amplitude (0.0..=1.0-ish) -> dBFS, floored at [`DB_FLOOR`].
/// Never returns -inf or NaN.
///
/// Deliberately **not** capped above: input above full scale is real (see the
/// module header) and a `+0.3 dBFS` reading is the truth, not an error.
pub fn amplitude_to_dbfs(amplitude: f32) -> f32 {
    let a = amplitude.abs();
    if !a.is_finite() || a <= SILENCE_EPSILON {
        DB_FLOOR
    } else {
        (20.0 * a.log10()).max(DB_FLOOR)
    }
}

/// Whether the meter is currently capturing, and whether there is any input
/// device to capture from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct MeterState {
    pub running: bool,
    pub has_input_device: bool,
}

/// The `dynamics://level` payload. dBFS figures and a timestamp. NOTHING else —
/// no spectrum, no pitch, no onset, no note, no verdict. THE LAW.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct LevelEvent {
    pub rms_db: f32,
    pub peak_db: f32,
    pub ts_ms: i64,
}

/// The live half of a running meter: the flag that tells the meter thread to
/// tear down, and the thread's join handle.
struct RunningStream {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

/// The control-side handle. Mutex-guarded state machine over a lock-free core —
/// the same shape `metronome.rs` uses over `audio::EngineHandle`.
///
/// The `cpal::Stream` itself is **not** held here: it is owned outright by the
/// meter thread (it is not `Send` on every platform), exactly as
/// `audio::EngineHandle` does. The thread parks on the ticker sleep and drops
/// the stream when `stop` flips.
pub struct DynamicsMeter {
    running: Mutex<Option<RunningStream>>,
    levels: Arc<SharedLevels>,
}

impl Default for DynamicsMeter {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicsMeter {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
            levels: Arc::new(SharedLevels::new()),
        }
    }

    /// Idempotent: starting an already-running meter is `Ok(())` and does NOT
    /// reopen the device.
    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut guard = self
            .running
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if guard.is_some() {
            return Ok(());
        }

        let stop = Arc::new(AtomicBool::new(false));
        let levels = Arc::clone(&self.levels);
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("dynamics-meter".into())
            .spawn(move || meter_thread(app, levels, thread_stop, ready_tx))
            .map_err(|e| format!("failed to spawn dynamics meter thread: {e}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                *guard = Some(RunningStream {
                    stop,
                    thread: Some(thread),
                });
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = thread.join();
                Err("dynamics meter thread exited before reporting readiness".into())
            }
        }
    }

    /// Idempotent: stopping an already-stopped meter is `Ok(())`. FULLY tears
    /// the cpal stream down (drops the `Stream`, joins the ticker) — no idle
    /// capture.
    pub fn stop(&self) -> Result<(), String> {
        let taken = {
            let mut guard = self
                .running
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            guard.take()
        };
        if let Some(mut running) = taken {
            running.stop.store(true, Ordering::Release);
            if let Some(handle) = running.thread.take() {
                let _ = handle.join();
            }
        }
        self.levels.publish(DB_FLOOR, DB_FLOOR);
        Ok(())
    }

    pub fn state(&self) -> MeterState {
        let running = self
            .running
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .is_some();
        MeterState {
            running,
            has_input_device: has_input_device(),
        }
    }

    /// Called from `lib.rs`'s window-destroyed handler. The mic must never
    /// outlive the window.
    pub fn shutdown(&self) {
        let _ = self.stop();
    }
}

/// Is there a default input device at all? Answered fresh each time so that
/// plugging a mic in mid-session is picked up without a restart.
fn has_input_device() -> bool {
    cpal::default_host().default_input_device().is_some()
}

/// Pick an f32 **input** config: prefer the device default, otherwise search the
/// supported configs. Mirrors `audio::choose_f32_config`'s output-side logic;
/// deliberately a separate function so `audio/mod.rs` (the playback Engine) is
/// not touched by this module.
fn choose_f32_input_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    let default = device
        .default_input_config()
        .map_err(|e| format!("no default input config: {e}"))?;
    if default.sample_format() == SampleFormat::F32 {
        return Ok(default);
    }
    let want_rate = default.sample_rate();
    let ranges = device
        .supported_input_configs()
        .map_err(|e| format!("no supported input configs: {e}"))?;
    for range in ranges {
        if range.sample_format() == SampleFormat::F32 {
            let rate = want_rate.clamp(range.min_sample_rate(), range.max_sample_rate());
            return Ok(range.with_sample_rate(rate));
        }
    }
    Err(format!(
        "input device has no f32 config (default is {:?})",
        default.sample_format()
    ))
}

/// Milliseconds since the Unix epoch. Control-side only.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The meter thread: owns the cpal input stream for its whole life, ticks at
/// [`TICK_HZ`], and drops the stream (closing the device) on the way out.
fn meter_thread(
    app: AppHandle,
    levels: Arc<SharedLevels>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(), String>>,
) {
    let stream = match build_input_stream(Arc::clone(&levels)) {
        Ok(s) => s,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready.send(Err(format!("failed to start dynamics input stream: {e}")));
        return;
    }
    let _ = ready.send(Ok(()));

    let period = Duration::from_millis((1_000 / TICK_HZ.max(1)) as u64);
    while !stop.load(Ordering::Acquire) {
        std::thread::sleep(period);
        if stop.load(Ordering::Acquire) {
            break;
        }
        let (rms_db, peak_db, _seq) = levels.read();
        let payload = LevelEvent {
            rms_db,
            peak_db,
            ts_ms: now_ms(),
        };
        if let Err(e) = app.emit("dynamics://level", payload) {
            eprintln!("dynamics: failed to emit dynamics://level: {e}");
        }
    }
    // Dropping the stream closes the input device. Explicit for the reader.
    drop(stream);
}

/// Build (and do not yet play) the cpal input stream. Everything the callback
/// needs is constructed HERE and moved in: after this returns, the callback
/// allocates nothing.
fn build_input_stream(levels: Arc<SharedLevels>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no default input device".to_string())?;

    let supported = choose_f32_input_config(&device)?;
    let sample_rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let stream_config: cpal::StreamConfig = supported.config();

    // Both owned by the callback, allocated once, right here.
    let mut weighting = AWeighting::new(sample_rate as f64);
    let mut ring = RmsRing::new(sample_rate, RMS_WINDOW_MS);
    let inv_channels = 1.0 / channels.max(1) as f32;

    let err_fn = |e| eprintln!("dynamics: input stream error: {e}");

    let stream = device
        .build_input_stream::<f32, _, _>(
            stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Arithmetic + three atomic stores. No lock, no alloc, no I/O.
                let mut last = (DB_FLOOR, DB_FLOOR);
                for frame in data.chunks(channels) {
                    let mut sum = 0.0_f32;
                    for s in frame.iter() {
                        sum += *s;
                    }
                    let mono = sum * inv_channels;
                    let weighted = weighting.process(mono);
                    last = ring.push(weighted, mono.abs());
                }
                if !data.is_empty() {
                    levels.publish(last.0, last.1);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("failed to build dynamics input stream: {e}"))?;

    Ok(stream)
}

// ── Tauri commands ────────────────────────────────────────────────────────
//
// dB figures in, dB figures out. No verdicts, no writes, no practice truth.

#[tauri::command]
pub async fn dynamics_meter_start(
    app: AppHandle,
    meter: State<'_, Arc<DynamicsMeter>>,
) -> Result<MeterState, String> {
    let meter = meter.inner().clone();
    // Opening the device blocks; never on Tauri's main thread. Same reasoning as
    // `metronome::metro_start`.
    tauri::async_runtime::spawn_blocking(move || {
        meter.start(app)?;
        Ok::<MeterState, String>(meter.state())
    })
    .await
    .map_err(|e| format!("dynamics meter start failed: {e}"))?
}

#[tauri::command]
pub async fn dynamics_meter_stop(
    meter: State<'_, Arc<DynamicsMeter>>,
) -> Result<MeterState, String> {
    let meter = meter.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        meter.stop()?;
        Ok::<MeterState, String>(meter.state())
    })
    .await
    .map_err(|e| format!("dynamics meter stop failed: {e}"))?
}

#[tauri::command]
pub fn dynamics_meter_state(meter: State<'_, Arc<DynamicsMeter>>) -> MeterState {
    meter.state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dbfs_conversion_floors_instead_of_returning_neg_infinity() {
        assert!((amplitude_to_dbfs(1.0) - 0.0).abs() < 1e-4);
        assert!((amplitude_to_dbfs(0.5) - (-6.0206)).abs() < 1e-3);
        assert_eq!(amplitude_to_dbfs(0.0), DB_FLOOR);
        assert_eq!(amplitude_to_dbfs(-0.0), DB_FLOOR);
        assert!(amplitude_to_dbfs(1e-12).is_finite());
    }

    #[test]
    fn dbfs_reports_above_full_scale_honestly() {
        // Core Audio float input is NOT hard-clipped at ±1.0; +0.28 dBFS was
        // measured live on the target machine. The meter must report it, not
        // clamp, assert or error. Clamping is the UI's job.
        let db = amplitude_to_dbfs(1.0328);
        assert!(db > 0.0, "above-full-scale must read positive, got {db}");
        assert!(db.is_finite());
    }

    #[test]
    fn rms_ring_reports_full_scale_dc_as_zero_dbfs_once_the_window_fills() {
        let mut ring = RmsRing::new(48_000, RMS_WINDOW_MS); // 6000 samples
        let mut last = (DB_FLOOR, DB_FLOOR);
        for _ in 0..6_000 {
            last = ring.push(1.0, 1.0);
        }
        assert!((last.0 - 0.0).abs() < 0.01, "rms {} want 0 dBFS", last.0);
        assert!((last.1 - 0.0).abs() < 0.01, "peak {} want 0 dBFS", last.1);
    }

    #[test]
    fn rms_ring_reports_a_sine_three_db_below_its_peak() {
        let fs = 48_000_u32;
        let mut ring = RmsRing::new(fs, RMS_WINDOW_MS);
        let mut last = (DB_FLOOR, DB_FLOOR);
        for n in 0..fs {
            let s = (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / fs as f32).sin();
            last = ring.push(s, s.abs());
        }
        // RMS of a full-scale sine is 1/sqrt(2) -> -3.01 dBFS; peak is 0 dBFS.
        assert!((last.0 - (-3.01)).abs() < 0.2, "rms {}", last.0);
        assert!((last.1 - 0.0).abs() < 0.2, "peak {}", last.1);
    }

    #[test]
    fn rms_ring_window_is_exactly_the_configured_duration() {
        assert_eq!(RmsRing::new(48_000, 125).capacity(), 6_000);
        assert_eq!(RmsRing::new(44_100, 125).capacity(), 5_512);
    }

    #[test]
    fn rms_ring_peak_decays_once_the_loud_sample_leaves_the_window() {
        let mut ring = RmsRing::new(1_000, 10); // 10 samples
        // One bang, then silence for a full window.
        let loud = ring.push(1.0, 1.0);
        assert!((loud.1 - 0.0).abs() < 0.01, "peak {} want 0 dBFS", loud.1);
        let mut last = loud;
        for _ in 0..10 {
            last = ring.push(0.0, 0.0);
        }
        assert_eq!(last.1, DB_FLOOR, "peak must decay out of the window");
    }

    #[test]
    fn shared_levels_round_trip_through_the_u32_bit_encoding() {
        let s = SharedLevels::new();
        s.publish(-42.5, -12.25);
        let (rms, peak, seq) = s.read();
        assert_eq!(rms, -42.5);
        assert_eq!(peak, -12.25);
        assert_eq!(seq, 1);
        s.publish(DB_FLOOR, DB_FLOOR);
        let (rms, _, seq) = s.read();
        assert_eq!(rms, DB_FLOOR);
        assert_eq!(seq, 2);
    }

    #[test]
    fn meter_state_machine_is_idempotent_and_starts_stopped() {
        // Device-free path: `start` may fail on a headless CI box, but the
        // state machine's own invariants must hold either way.
        let m = DynamicsMeter::new();
        assert!(!m.state().running, "meter must never start itself");
        assert!(m.stop().is_ok(), "stopping a stopped meter is a no-op");
        assert!(m.stop().is_ok(), "…and stays a no-op");
        assert!(!m.state().running);
    }

    #[test]
    fn shutdown_is_safe_on_a_meter_that_never_ran() {
        let m = DynamicsMeter::new();
        m.shutdown();
        assert!(!m.state().running);
    }

    /// THE LAW, asserted in code: the event payload carries dB figures and a
    /// timestamp — three fields, no fourth. If someone ever adds a `pitch` or a
    /// `verdict`, this test is the tripwire.
    #[test]
    fn level_event_serializes_db_figures_and_nothing_else() {
        let json = serde_json::to_value(LevelEvent {
            rms_db: -28.5,
            peak_db: -19.0,
            ts_ms: 1_700_000_000_000,
        })
        .unwrap();
        let obj = json.as_object().unwrap();
        let mut keys: Vec<_> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["peak_db", "rms_db", "ts_ms"]);
    }
}
