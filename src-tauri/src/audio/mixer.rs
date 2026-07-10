//! Click + voice mixing.
//!
//! [`Mixer`] sums currently-playing click voices and a queue of TTS PCM samples
//! into an output buffer, applying independent gains and clamping to `[-1, 1]`.
//! Click samples are triggered by [`ClickEvent`](super::clock::ClickEvent)s and
//! may overlap (a fast click can still be ringing when the next one starts).

use std::collections::{HashMap, VecDeque};
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
/// [`Mixer::set_clicks`] (tests / synthetic) or [`load_clicks`] (Task 6
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

    /// Select one already-loaded click sound (by name, as returned by
    /// [`load_clicks`]) as the mixer's active accent/beat/sub voices. Resamples
    /// from the sound's authored `src_rate` to `stream_rate` (the engine's
    /// actual output rate) so a 44.1 kHz asset never plays detuned/wrong-length
    /// on a 48 kHz stream.
    #[allow(dead_code)]
    pub fn use_click_sound(
        &mut self,
        sounds: &HashMap<String, super::Clicks>,
        name: &str,
        stream_rate: u32,
    ) -> Result<(), String> {
        let c = sounds
            .get(name)
            .ok_or_else(|| format!("no click sound named {name:?}"))?;
        self.set_clicks(
            super::resample_linear(&c.accent, c.src_rate, stream_rate),
            super::resample_linear(&c.beat, c.src_rate, stream_rate),
            super::resample_linear(&c.sub, c.src_rate, stream_rate),
        );
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

/// Sound names produced by `scripts/gen_clicks.py` into `src-tauri/assets/clicks/`.
pub const CLICK_SOUND_NAMES: [&str; 6] = ["woodblock", "rim", "beep", "clave", "cowbell", "tick"];

/// -3 dB attenuation applied to derive the quieter "beat" variant from the
/// authored (accent) sample.
const BEAT_GAIN_DB: f32 = -3.0;
/// -6 dB attenuation applied to derive the quieter "sub" (subdivision) variant.
const SUB_GAIN_DB: f32 = -6.0;

fn db_to_lin(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Load every click WAV in `dir` (`woodblock.wav`, `rim.wav`, `beep.wav`,
/// `clave.wav`, `cowbell.wav`, `tick.wav` — see `scripts/gen_clicks.py`,
/// [`CLICK_SOUND_NAMES`]) and derive an (accent, beat, sub) [`super::Clicks`]
/// per sound name (Task 6 asset seam). Each WAV holds a single authored
/// sample, already peak-normalized to -0.3 dBFS (see `scripts/gen_clicks.py`).
///
/// Gains are applied as *relative attenuation*, never boost: you can't boost
/// a -0.3 dBFS-normalized sample without risking clipping (the old +3 dB
/// accent boost clamp clipped up to 9.3% of samples on the "beep" click).
/// Instead `accent` is left at the sample's native (already maximized)
/// loudness — gain 1.0, unmodified — so it cuts through an acoustic grand
/// piano; `beat` and `sub` are pulled down instead, to -3 dB and -6 dB
/// respectively. Because we only ever attenuate an already-safe sample, this
/// guarantees zero clipping.
///
/// Samples are kept at their WAV's native sample rate (`Clicks::src_rate`,
/// 44.1 kHz as authored) rather than resampled here: [`Mixer::use_click_sound`]
/// / `build_stream` already resample `Clicks` from `src_rate` to the engine's
/// actual output rate (48 kHz on the dev Mac) via [`super::resample_linear`],
/// so resampling here too would just do the same work twice. This keeps a
/// single source of truth for "what rate is this engine's stream" — the
/// stream's negotiated rate, discovered at `build_stream` time — rather than
/// baking a target rate into asset loading.
pub fn load_clicks(dir: &Path) -> Result<HashMap<String, super::Clicks>, String> {
    let beat_gain = db_to_lin(BEAT_GAIN_DB);
    let sub_gain = db_to_lin(SUB_GAIN_DB);
    let mut map = HashMap::with_capacity(CLICK_SOUND_NAMES.len());
    for name in CLICK_SOUND_NAMES {
        let path = dir.join(format!("{name}.wav"));
        let (accent, src_rate) = read_wav_mono_with_rate(&path)?;
        let beat: Vec<f32> = accent.iter().map(|s| s * beat_gain).collect();
        let sub: Vec<f32> = accent.iter().map(|s| s * sub_gain).collect();
        map.insert(
            name.to_string(),
            super::Clicks {
                accent,
                beat,
                sub,
                src_rate,
            },
        );
    }
    Ok(map)
}

/// Read a WAV file as mono f32 samples, downmixing and normalizing as needed.
#[allow(dead_code)]
fn read_wav_mono(path: &Path) -> Result<Vec<f32>, String> {
    read_wav_mono_with_rate(path).map(|(samples, _rate)| samples)
}

/// Like [`read_wav_mono`] but also returns the file's native sample rate, so
/// callers that need to resample (e.g. [`load_clicks`]) don't have to reopen
/// the file.
fn read_wav_mono_with_rate(path: &Path) -> Result<(Vec<f32>, u32), String> {
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
    let rate = spec.sample_rate;
    if channels <= 1 {
        return Ok((interleaved, rate));
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
    Ok((mono, rate))
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

    // Task 6: all six generated click WAVs load, and each sound's accent
    // variant is louder than its beat variant (both peak and RMS).
    #[test]
    fn load_clicks_loads_all_six_and_accent_is_louder() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/clicks");
        let sounds = load_clicks(&dir).expect("all six click WAVs should load");
        assert_eq!(sounds.len(), CLICK_SOUND_NAMES.len());

        fn peak(samples: &[f32]) -> f32 {
            samples.iter().fold(0.0f32, |m, s| m.max(s.abs()))
        }
        fn rms(samples: &[f32]) -> f32 {
            if samples.is_empty() {
                return 0.0;
            }
            (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
        }

        for name in CLICK_SOUND_NAMES {
            let c = sounds
                .get(name)
                .unwrap_or_else(|| panic!("missing click sound {name:?}"));
            assert!(!c.accent.is_empty(), "{name}: accent must not be empty");
            assert!(!c.beat.is_empty(), "{name}: beat must not be empty");
            assert!(!c.sub.is_empty(), "{name}: sub must not be empty");
            assert_eq!(c.src_rate, 44_100, "{name}: assets are authored at 44.1 kHz");

            assert!(
                peak(&c.accent) > peak(&c.beat) - 1e-6,
                "{name}: accent peak ({}) should be >= beat peak ({})",
                peak(&c.accent),
                peak(&c.beat)
            );
            assert!(
                rms(&c.accent) > rms(&c.beat),
                "{name}: accent RMS ({}) should be louder than beat RMS ({})",
                rms(&c.accent),
                rms(&c.beat)
            );
            assert!(
                rms(&c.beat) > rms(&c.sub),
                "{name}: beat RMS ({}) should be louder than sub RMS ({})",
                rms(&c.beat),
                rms(&c.sub)
            );

            // accent/beat peak ratio should be a ~3 dB step (10^(2.5/20)..10^(3.5/20)).
            let ratio = peak(&c.accent) / peak(&c.beat);
            assert!(
                (1.334..=1.496).contains(&ratio),
                "{name}: accent/beat peak ratio ({ratio}) should be ~3 dB (within [1.334, 1.496])"
            );

            // Anti-clipping: relative attenuation must never push a sample past
            // the loaded (already-safe) amplitude.
            for (variant, samples) in [("accent", &c.accent), ("beat", &c.beat), ("sub", &c.sub)] {
                for s in samples.iter() {
                    assert!(
                        s.abs() <= 0.999,
                        "{name}: {variant} sample {s} exceeds |0.999| (clipping risk)"
                    );
                }
            }
        }
    }

    // A whole click sound (all three variants) loads correctly via
    // Mixer::use_click_sound and becomes the mixer's active voices.
    #[test]
    fn use_click_sound_selects_and_resamples() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/clicks");
        let sounds = load_clicks(&dir).expect("load six click sounds");

        let mut mixer = Mixer::new();
        mixer
            .use_click_sound(&sounds, "tick", 48_000)
            .expect("tick should be selectable");

        mixer.trigger(ClickKind::Beat, 0);
        let mut buf = [0.0f32; 32];
        let _ = mixer.render(&mut buf);
        assert!(
            buf.iter().any(|s| s.abs() > 0.0),
            "selected click sound should actually voice audio"
        );
    }
}
