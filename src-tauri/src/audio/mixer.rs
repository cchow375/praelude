//! Click + voice mixing.
//!
//! [`Mixer`] sums currently-playing click voices and a queue of TTS PCM samples
//! into an output buffer, applying independent gains and clamping to `[-1, 1]`.
//! Click samples are triggered by [`ClickEvent`](super::clock::ClickEvent)s and
//! may overlap (a fast click can still be ringing when the next one starts).

use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;

use super::clock::ClickKind;

/// One in-flight click. `start_offset` is the frame within the *current* buffer
/// where playback begins (only non-zero on the buffer where it was triggered);
/// `pos` is how far into `samples` we have already played.
struct Voice {
    samples: Arc<Vec<f32>>,
    pos: usize,
    start_offset: usize,
}

/// Sums click voices + drained PCM into an output buffer.
///
/// `pcm_queue` is public so the audio thread can push resampled TTS samples into
/// it; the unit tests push directly too. Click samples are set via
/// [`Mixer::set_clicks`] (tests / synthetic) or [`Mixer::load_clicks`] (Task 6
/// WAV assets).
pub struct Mixer {
    accent: Arc<Vec<f32>>,
    beat: Arc<Vec<f32>>,
    sub: Arc<Vec<f32>>,
    voices: Vec<Voice>,
    /// TTS PCM at the stream sample rate (resampled at enqueue time).
    pub pcm_queue: VecDeque<f32>,
    /// Gain applied to click voices.
    pub click_gain: f32,
    /// Gain applied to PCM (TTS) samples.
    pub voice_gain: f32,
}

impl Default for Mixer {
    fn default() -> Self {
        Self::new()
    }
}

impl Mixer {
    /// A mixer with no click samples loaded and unity gains.
    pub fn new() -> Self {
        // Reserve for the max plausible click overlap so the callback never
        // grows this. Overlap = ringing click length / tick spacing. Click
        // samples are short (tens of ms); with the clock clamping subdivisions
        // to 16 and bpm to ≤1000 the tightest tick spacing is ~180 frames at
        // 48 kHz, so even a ~60 ms (2880-frame) click leaves at most ~16 voices
        // overlapping — comfortably under 32. `render` retains only unfinished
        // voices each buffer, so this is a steady-state ceiling, not a leak.
        let voices = Vec::with_capacity(32);
        Mixer {
            accent: Arc::new(Vec::new()),
            beat: Arc::new(Vec::new()),
            sub: Arc::new(Vec::new()),
            voices,
            pcm_queue: VecDeque::new(),
            click_gain: 1.0,
            voice_gain: 1.0,
        }
    }

    /// Reserve PCM queue capacity so the audio thread never reallocates while
    /// draining enqueued chunks (call once at engine start).
    pub fn reserve_pcm(&mut self, samples: usize) {
        self.pcm_queue.reserve(samples);
    }

    /// Install synthetic / in-memory click samples (used by tests and the
    /// synthetic clicks until Task 6's WAV assets land).
    pub fn set_clicks(&mut self, accent: Vec<f32>, beat: Vec<f32>, sub: Vec<f32>) {
        self.accent = Arc::new(accent);
        self.beat = Arc::new(beat);
        self.sub = Arc::new(sub);
    }

    /// Load `accent.wav`, `beat.wav`, `sub.wav` from `dir` (Task 6 asset seam).
    /// Any channel layout / bit depth is downmixed to mono f32.
    pub fn load_clicks(&mut self, dir: &Path) -> Result<(), String> {
        let accent = read_wav_mono(&dir.join("accent.wav"))?;
        let beat = read_wav_mono(&dir.join("beat.wav"))?;
        let sub = read_wav_mono(&dir.join("sub.wav"))?;
        self.set_clicks(accent, beat, sub);
        Ok(())
    }

    /// Start voicing `kind` at `offset` frames into the next rendered buffer.
    pub fn trigger(&mut self, kind: ClickKind, offset: usize) {
        let samples = match kind {
            ClickKind::Accent => self.accent.clone(),
            ClickKind::Beat => self.beat.clone(),
            ClickKind::Sub => self.sub.clone(),
        };
        if samples.is_empty() {
            return; // no sample loaded for this kind (e.g. before Task 6)
        }
        self.voices.push(Voice {
            samples,
            pos: 0,
            start_offset: offset,
        });
    }

    /// Mix all active click voices and drained PCM into `out`, apply gains, and
    /// clamp to `[-1, 1]`. Returns the number of PCM samples consumed this call
    /// (the engine uses it for `pcm_done` accounting).
    pub fn render(&mut self, out: &mut [f32]) -> usize {
        for s in out.iter_mut() {
            *s = 0.0;
        }

        // Click voices (may overlap). `start_offset` is only non-zero on the
        // buffer where the voice was triggered; thereafter it resumes at 0.
        let click_gain = self.click_gain;
        for voice in self.voices.iter_mut() {
            let start = voice.start_offset.min(out.len());
            let avail_out = out.len() - start;
            let avail_sample = voice.samples.len() - voice.pos;
            let n = avail_out.min(avail_sample);
            for i in 0..n {
                out[start + i] += voice.samples[voice.pos + i] * click_gain;
            }
            voice.pos += n;
            voice.start_offset = 0;
        }
        self.voices.retain(|v| v.pos < v.samples.len());

        // Drain TTS PCM in step with the output, one sample per frame.
        let voice_gain = self.voice_gain;
        let mut consumed = 0;
        for s in out.iter_mut() {
            match self.pcm_queue.pop_front() {
                Some(x) => {
                    *s += x * voice_gain;
                    consumed += 1;
                }
                None => break,
            }
        }

        // Clamp the summed signal so overlapping clicks + voice never wrap/clip
        // hard downstream.
        for s in out.iter_mut() {
            *s = s.clamp(-1.0, 1.0);
        }

        consumed
    }
}

/// Read a WAV file as mono f32 samples, downmixing and normalizing as needed.
fn read_wav_mono(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|s| s.unwrap_or(0.0))
            .collect(),
        hound::SampleFormat::Int => {
            // 8-bit WAV PCM is stored UNSIGNED (128 = silence), but hound already
            // returns it re-centered to signed [-128, 127] when read as i32 (its
            // own regression test confirms a zeroed 8-bit file decodes to -128).
            // So the same `/ 2^(bits-1)` normalization is correct for every bit
            // depth here — do NOT subtract 128 again, that would double-bias and
            // shift silence to -1.0 (guarded by `eightbit_wav_roundtrips_centered`).
            let max = ((1i64 << (spec.bits_per_sample.saturating_sub(1))) as f32).max(1.0);
            reader
                .samples::<i32>()
                .map(|s| s.unwrap_or(0) as f32 / max)
                .collect()
        }
    };
    if channels <= 1 {
        return Ok(interleaved);
    }
    // Downmix to mono by averaging channels.
    let frames = interleaved.len() / channels;
    let mut mono = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut sum = 0.0;
        for c in 0..channels {
            sum += interleaved[f * channels + c];
        }
        mono.push(sum / channels as f32);
    }
    Ok(mono)
}

#[cfg(test)]
mod tests {
    use super::*;

    // (e) The mixer applies both gains and clamps the summed output to [-1, 1].
    #[test]
    fn mixer_applies_gains_and_clamps() {
        let mut mixer = Mixer::new();
        // One-sample clicks so contributions are easy to reason about.
        mixer.set_clicks(vec![1.0], vec![1.0], vec![1.0]);

        // --- click gain is applied (no clamp needed) ---
        mixer.click_gain = 0.3;
        mixer.voice_gain = 1.0;
        mixer.trigger(ClickKind::Beat, 0);
        let mut out = [0.0f32; 4];
        let consumed = mixer.render(&mut out);
        assert_eq!(consumed, 0, "no PCM queued yet");
        assert!((out[0] - 0.3).abs() < 1e-6, "click scaled by click_gain");
        assert_eq!(out[1], 0.0);

        // --- voice gain is applied and the sum is clamped ---
        mixer.click_gain = 1.0;
        mixer.voice_gain = 0.5;
        // 5.0 * 0.5 = 2.5 -> clamps to 1.0 ; -5.0 * 0.5 = -2.5 -> clamps to -1.0
        mixer.pcm_queue.push_back(5.0);
        mixer.pcm_queue.push_back(-5.0);
        mixer.pcm_queue.push_back(0.4); // 0.4 * 0.5 = 0.2 (unclamped)
        mixer.trigger(ClickKind::Accent, 0); // +1.0 at index 0 before clamp
        let mut out = [0.0f32; 4];
        let consumed = mixer.render(&mut out);
        assert_eq!(consumed, 3, "consumed exactly the queued PCM samples");
        // index0: click 1.0 + pcm(5.0*0.5=2.5) = 3.5 -> clamp 1.0
        assert!((out[0] - 1.0).abs() < 1e-6, "positive overshoot clamps to 1.0");
        // index1: pcm -5.0*0.5 = -2.5 -> clamp -1.0
        assert!((out[1] + 1.0).abs() < 1e-6, "negative overshoot clamps to -1.0");
        // index2: pcm 0.4*0.5 = 0.2 (in range, gain applied)
        assert!((out[2] - 0.2).abs() < 1e-6, "voice_gain applied, no clamp");
        assert_eq!(out[3], 0.0, "no more PCM");
    }

    // 8-bit WAV round-trip: silence must decode to ~0.0 (not -1.0). Guards the
    // read_wav_mono normalization against a spurious "unsigned fix" that would
    // double-bias hound's already-signed 8-bit samples.
    #[test]
    fn eightbit_wav_roundtrips_centered() {
        let path = std::env::temp_dir().join(format!(
            "codakiller_8bit_{}.wav",
            std::process::id()
        ));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 44_100,
            bits_per_sample: 8,
            sample_format: hound::SampleFormat::Int,
        };
        {
            let mut w = hound::WavWriter::create(&path, spec).expect("create 8-bit wav");
            // Signed 8-bit domain: 0 = silence, 127 = ~full+, -128 = full-.
            for s in [0i8, 64, -128, 127] {
                w.write_sample(s as i32).expect("write sample");
            }
            w.finalize().expect("finalize");
        }
        let mono = read_wav_mono(&path).expect("read back");
        let _ = std::fs::remove_file(&path);

        assert_eq!(mono.len(), 4);
        assert!(mono[0].abs() < 1e-6, "silence (byte 128) must decode to ~0.0, got {}", mono[0]);
        assert!((mono[1] - 0.5).abs() < 1e-6, "64/128 = 0.5");
        assert!((mono[2] + 1.0).abs() < 1e-6, "-128/128 = -1.0 (full negative)");
        assert!((mono[3] - 127.0 / 128.0).abs() < 1e-6, "127/128 ~= +0.992");
    }

    // Overlapping click tails: a click longer than the buffer keeps ringing into
    // the next buffer, and a second trigger sums on top of the first's tail.
    #[test]
    fn click_tails_overlap_across_buffers() {
        let mut mixer = Mixer::new();
        // A 6-sample click of constant 0.5.
        mixer.set_clicks(vec![0.5; 6], vec![0.5; 6], vec![0.5; 6]);
        mixer.trigger(ClickKind::Beat, 0);
        let mut buf = [0.0f32; 4];
        let _ = mixer.render(&mut buf);
        assert_eq!(buf, [0.5, 0.5, 0.5, 0.5], "first 4 samples of the click");
        // Trigger a second click at offset 0 of the next buffer; the first click
        // still has 2 samples of tail (indices 4,5) that must sum with it.
        mixer.trigger(ClickKind::Beat, 0);
        let mut buf = [0.0f32; 4];
        let _ = mixer.render(&mut buf);
        assert!((buf[0] - 1.0).abs() < 1e-6, "old tail (0.5) + new click (0.5)");
        assert!((buf[1] - 1.0).abs() < 1e-6, "old tail (0.5) + new click (0.5)");
        assert!((buf[2] - 0.5).abs() < 1e-6, "only the new click remains");
        assert!((buf[3] - 0.5).abs() < 1e-6, "only the new click remains");
    }
}
