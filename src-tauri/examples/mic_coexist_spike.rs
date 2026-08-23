//! THROWAWAY spike for v7 B0 (see docs/superpowers/plans/2026-08-23-codakiller-v7-foundations.md).
//! Answers: can a cpal INPUT stream coexist with the vendored `hear` STT binary on the same
//! default mic, on the 8 GB M2 Air, for 60s, without device-steal or a CPU/RSS spike that
//! would compete with the realtime audio output callback?
//!
//! This program NEVER touches src-tauri/src/audio/mod.rs's output Engine. It opens the
//! default INPUT device only, computes 125ms-window RMS -> dBFS, and prints one line per
//! second for 60 seconds, then exits. Run it CONCURRENTLY with the vendored `hear` binary
//! transcribing speech on the same mic (see the plan's procedure step) — this file only
//! produces the meter side of the experiment.
//!
//! `cargo run --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml`

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const RUN_SECS: u64 = 60;
const WINDOW_MS: u64 = 125;

fn main() {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .expect("no default input device found — grant mic permission and retry");
    println!("spike: using input device {device}");

    let config = device
        .default_input_config()
        .expect("no default input config on this device");
    let sample_rate = config.sample_rate() as usize;
    let channels = config.channels() as usize;
    let window_frames = (sample_rate * WINDOW_MS as usize) / 1000;

    // dBFS of the most recently completed 125ms window, shared with the print loop below.
    // Stored as millidecibels (i64) so an AtomicI64 can hold it lock-free from the audio
    // callback — the callback must never block.
    let latest_millidb = Arc::new(AtomicI64::new(-9000)); // -90.0 dBFS floor
    let latest_millidb_cb = Arc::clone(&latest_millidb);

    let mut window_buf: Vec<f32> = Vec::with_capacity(window_frames);

    let stream = device
        .build_input_stream(
            config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                for frame in data.chunks(channels.max(1)) {
                    // Mono-fold by averaging channels in the frame — loudness only, no
                    // spatial info needed for a coexistence spike.
                    let sample: f32 =
                        frame.iter().copied().sum::<f32>() / (frame.len().max(1) as f32);
                    window_buf.push(sample);
                    if window_buf.len() >= window_frames {
                        let sum_sq: f32 = window_buf.iter().map(|s| s * s).sum();
                        let rms = (sum_sq / window_buf.len() as f32).sqrt();
                        let dbfs = if rms > 0.0 { 20.0 * rms.log10() } else { -90.0 };
                        latest_millidb_cb.store((dbfs * 1000.0) as i64, Ordering::Relaxed);
                        window_buf.clear();
                    }
                }
            },
            move |err| eprintln!("spike: input stream error: {err}"),
            None,
        )
        .expect("failed to build input stream — this itself is a coexistence-failure signal");

    stream.play().expect("failed to start input stream");
    println!(
        "spike: streaming for {RUN_SECS}s, one dBFS line per second. Start the vendored \
         `hear` binary transcribing speech NOW in another terminal per the plan's procedure."
    );

    let start = Instant::now();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    while start.elapsed() < Duration::from_secs(RUN_SECS) {
        if last_print.elapsed() >= Duration::from_secs(1) {
            let dbfs = latest_millidb.load(Ordering::Relaxed) as f64 / 1000.0;
            println!(
                "t={:>3.0}s  input_dbfs={:>7.2}",
                start.elapsed().as_secs_f64(),
                dbfs
            );
            last_print = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    println!("spike: done ({RUN_SECS}s elapsed). Stop `hear` now and record the verdict.");
}
