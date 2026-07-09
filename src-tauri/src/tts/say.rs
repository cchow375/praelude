//! macOS `say` TTS fallback — used when Gemini is unavailable (no key / offline /
//! `tts.provider=say`). Always available on macOS, fully offline.
//!
//! `say -o <tmp>.wav --data-format=LEI16@22050 <text>` writes a standard 16-bit
//! PCM mono WAVE (verified on this Mac: fmt tag 1, 1 ch, 22050 Hz, with a leading
//! JUNK chunk that hound skips). We decode it with `hound` → f32 and delete the
//! temp file. AIFF (say's default) is intentionally avoided: hound cannot read
//! AIFF-C.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use super::{Pcm, Result, TtsError, TtsProvider};

/// `say` writes at this rate with the `LEI16` (signed-16 LE) data format.
const SAY_RATE: u32 = 22_050;

/// The macOS `say` provider.
pub struct SayTts {
    /// Optional voice name (`say -v <voice>`); `None` uses the system default.
    voice: Option<String>,
}

impl SayTts {
    pub fn new() -> SayTts {
        SayTts { voice: None }
    }

    pub fn with_voice(voice: impl Into<String>) -> SayTts {
        SayTts {
            voice: Some(voice.into()),
        }
    }
}

impl Default for SayTts {
    fn default() -> Self {
        SayTts::new()
    }
}

/// A unique temp WAV path per call so concurrent/back-to-back utterances never
/// collide. (The Speaker serializes anyway, but this keeps `say.rs` self-contained
/// and safe if reused.)
fn temp_wav_path() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("codakiller-say-{}-{nanos}-{n}.wav", std::process::id()))
}

/// Delete the temp file, ignoring errors (best-effort cleanup).
struct TempFileGuard(PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl TtsProvider for SayTts {
    fn synth(&self, text: &str) -> Result<Pcm> {
        let path = temp_wav_path();
        let _guard = TempFileGuard(path.clone());

        let mut cmd = Command::new("say");
        cmd.arg("-o")
            .arg(&path)
            .arg("--data-format=LEI16@22050");
        if let Some(v) = &self.voice {
            cmd.arg("-v").arg(v);
        }
        // `--` so text starting with '-' is not parsed as a flag.
        cmd.arg("--").arg(text);

        let output = cmd
            .output()
            .map_err(|e| TtsError::Say(format!("failed to run `say`: {e}")))?;
        if !output.status.success() {
            return Err(TtsError::Say(format!(
                "`say` exited {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        decode_wav(&path)
    }
}

/// Decode a 16-bit PCM WAV into mono f32. Multi-channel input is downmixed by
/// averaging (defensive; `say --data-format=LEI16@22050` is mono).
fn decode_wav(path: &std::path::Path) -> Result<Pcm> {
    let reader = hound::WavReader::open(path)
        .map_err(|e| TtsError::Say(format!("`say` output not readable as WAV: {e}")))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;

    let samples: std::result::Result<Vec<f32>, _> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect()
        }
        hound::SampleFormat::Float => reader.into_samples::<f32>().collect(),
    };
    let interleaved =
        samples.map_err(|e| TtsError::Say(format!("decoding `say` WAV samples: {e}")))?;

    let mono = if channels <= 1 {
        interleaved
    } else {
        interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    if mono.is_empty() {
        return Err(TtsError::Say("`say` produced no audio samples".into()));
    }
    Ok(Pcm {
        rate: spec.sample_rate,
        mono_f32: mono,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_paths_are_unique() {
        let a = temp_wav_path();
        let b = temp_wav_path();
        assert_ne!(a, b);
        assert!(a.extension().is_some_and(|e| e == "wav"));
    }

    // Real `say` invocation (macOS only, needs the binary). Not #[ignore]d: `say`
    // is always present on macOS and this is the fastest way to guard the decode
    // path against a format regression. Runs offline, ~100ms.
    #[test]
    fn say_synthesizes_decodable_pcm() {
        let pcm = SayTts::new()
            .synth("test one two")
            .expect("say should synthesize on macOS");
        assert_eq!(pcm.rate, SAY_RATE, "LEI16@22050 => 22050 Hz");
        assert!(
            pcm.mono_f32.len() > SAY_RATE as usize / 10,
            "expected >0.1s of audio, got {} samples",
            pcm.mono_f32.len()
        );
        assert!(
            pcm.mono_f32.iter().any(|s| s.abs() > 0.01),
            "audio should not be silent"
        );
    }
}
