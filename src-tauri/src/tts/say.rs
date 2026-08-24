//! macOS `say` TTS fallback — used when Gemini is unavailable (no key / offline /
//! `tts.provider=say`). Always available on macOS, fully offline.
//!
//! `say -o <tmp>.wav --data-format=LEI16@22050 <text>` writes a standard 16-bit
//! PCM mono WAVE (verified on this Mac: fmt tag 1, 1 ch, 22050 Hz, with a leading
//! JUNK chunk that hound skips). We decode it with `hound` → f32 and delete the
//! temp file. AIFF (say's default) is intentionally avoided: hound cannot read
//! AIFF-C.
//!
//! # Voice resolution
//!
//! Never rely on the macOS *system default* voice: on some machines (verified on
//! this one) the default is a near-silent/degenerate synth — `say -o out.wav
//! --data-format=LEI16@22050 -- "test one two"` with no `-v` yields 118 decoded
//! frames (0.005s) vs. ~20,734 frames (0.94s) with `-v Samantha`. `SayTts`
//! therefore always resolves and passes an explicit `-v <voice>`, falling back
//! through a preference list of common installed voices — see [`resolve_voice`].

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use super::{Pcm, Result, TtsError, TtsProvider};

/// `say` writes at this rate with the `LEI16` (signed-16 LE) data format.
#[allow(dead_code)]
const SAY_RATE: u32 = 22_050;

// ---------------------------------------------------------------------------
// Voice enumeration seam
// ---------------------------------------------------------------------------

/// Enumerates installed `say` voices as `(name, locale)` pairs. Mirrors the
/// [`Clock`](super::Clock) / [`TtsStatusSink`] seam idiom used elsewhere in this
/// module: production shells out ([`ProcessVoiceLister`]), tests inject a fake so
/// voice resolution is unit-testable without a subprocess.
trait VoiceLister: Send + Sync {
    fn list(&self) -> Vec<(String, String)>;
}

/// The real lister: runs `say -v '?'` and parses its output. Lines look like:
/// ```text
/// Alex                en_US    # Most people recognize me by my voice.
/// Samantha            en_US    # Hello, my name is Samantha.
/// ```
/// Unparseable lines are skipped rather than erroring — a missing/malformed line
/// just means one fewer candidate voice, not a hard failure.
struct ProcessVoiceLister;

impl VoiceLister for ProcessVoiceLister {
    fn list(&self) -> Vec<(String, String)> {
        let output = match Command::new("say").arg("-v").arg("?").output() {
            Ok(o) if o.status.success() => o,
            _ => return Vec::new(),
        };
        parse_voice_list(&String::from_utf8_lossy(&output.stdout))
    }
}

/// Parse `say -v '?'` output into `(name, locale)` pairs. Pure/no I/O so it is
/// directly unit-testable.
fn parse_voice_list(text: &str) -> Vec<(String, String)> {
    let mut voices = Vec::new();
    for line in text.lines() {
        // Drop the `# <sample text>` trailer before looking for the locale.
        let before_comment = line.split('#').next().unwrap_or(line).trim_end();
        let Some(ws) = before_comment.rfind(char::is_whitespace) else {
            continue;
        };
        let (name_part, locale_part) = before_comment.split_at(ws);
        let locale = locale_part.trim();
        let name = name_part.trim();
        if name.is_empty() || !is_locale_token(locale) {
            continue;
        }
        voices.push((name.to_string(), locale.to_string()));
    }
    voices
}

/// `true` for tokens shaped like `en_US`: two lowercase letters, `_`, two
/// uppercase letters.
fn is_locale_token(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[0].is_ascii_lowercase()
        && b[1].is_ascii_lowercase()
        && b[2] == b'_'
        && b[3].is_ascii_uppercase()
        && b[4].is_ascii_uppercase()
}

// ---------------------------------------------------------------------------
// Voice resolution (pure)
// ---------------------------------------------------------------------------

/// Common en_US voices to prefer, in order, when the configured voice (if any)
/// is not installed. These ship on most macOS installs; the list is only a
/// fallback ladder, not a requirement — [`resolve_voice`] degrades gracefully
/// past it.
const PREFERRED_VOICES: &[&str] = &["Samantha", "Alex", "Daniel", "Ava", "Tom"];

/// Resolve which voice `say` should use, never depending on the (possibly
/// degenerate) system default. Pure — no subprocess — so it is directly unit
/// tested against a fake `installed` list.
///
/// Preference order:
/// 1. `configured`, if it case-sensitively matches an installed voice name.
/// 2. The first of [`PREFERRED_VOICES`] that is installed.
/// 3. Any installed voice whose locale is `en_US`.
/// 4. `None` — caller omits `-v` entirely (nothing usable was found).
fn resolve_voice(configured: Option<&str>, installed: &[(String, String)]) -> Option<String> {
    if let Some(cfg) = configured {
        if installed.iter().any(|(name, _)| name == cfg) {
            return Some(cfg.to_string());
        }
    }
    for pref in PREFERRED_VOICES {
        if let Some((name, _)) = installed.iter().find(|(name, _)| name == pref) {
            return Some(name.clone());
        }
    }
    if let Some((name, _)) = installed.iter().find(|(_, locale)| locale == "en_US") {
        return Some(name.clone());
    }
    None
}

// ---------------------------------------------------------------------------
// Command-line building (pure)
// ---------------------------------------------------------------------------

/// Build the `say` argument vector. Pure/no I/O so the "voice is always passed
/// when resolved" behavior is unit-testable without shelling out.
fn say_args(voice: Option<&str>, out: &Path, text: &str) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("-o"),
        out.as_os_str().to_owned(),
        OsString::from("--data-format=LEI16@22050"),
    ];
    if let Some(v) = voice {
        args.push(OsString::from("-v"));
        args.push(OsString::from(v));
    }
    // `--` so text starting with '-' is not parsed as a flag.
    args.push(OsString::from("--"));
    args.push(OsString::from(text));
    args
}

/// The macOS `say` provider.
pub struct SayTts {
    /// Voice requested via `tts.voice` (settings); `None` means "resolve one
    /// automatically" — see [`resolve_voice`].
    configured: Option<String>,
    /// Resolved once per instance and cached — `say -v '?'` is not re-shelled
    /// per utterance. `Some(None)` means resolution ran and found nothing
    /// installed (caller then omits `-v`); the outer `Option` from `OnceLock`
    /// tracks "has resolution run yet".
    resolved: OnceLock<Option<String>>,
    lister: Box<dyn VoiceLister>,
}

impl SayTts {
    pub fn new() -> SayTts {
        SayTts::with_seams(None, Box::new(ProcessVoiceLister))
    }

    pub fn with_voice(voice: impl Into<String>) -> SayTts {
        SayTts::with_seams(Some(voice.into()), Box::new(ProcessVoiceLister))
    }

    /// Full seam constructor (private): production goes through `new`/
    /// `with_voice`; tests inject a fake [`VoiceLister`] to avoid shelling out
    /// and to count/verify caching.
    fn with_seams(configured: Option<String>, lister: Box<dyn VoiceLister>) -> SayTts {
        SayTts {
            configured,
            resolved: OnceLock::new(),
            lister,
        }
    }

    /// The voice to pass to `say`, resolving (and caching) on first call.
    fn resolved_voice(&self) -> Option<String> {
        self.resolved
            .get_or_init(|| resolve_voice(self.configured.as_deref(), &self.lister.list()))
            .clone()
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
    std::env::temp_dir().join(format!(
        "codakiller-say-{}-{nanos}-{n}.wav",
        std::process::id()
    ))
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

        let voice = self.resolved_voice();
        let mut cmd = Command::new("say");
        cmd.args(say_args(voice.as_deref(), &path, text));

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

        let pcm = decode_wav(&path)?;
        if let Some(reason) = hollow_synth_reason(text, &pcm) {
            return Err(TtsError::Say(reason));
        }
        Ok(pcm)
    }
}

/// A synth that returns far less audio than the text could possibly produce is
/// a DEGRADED synth, not speech — so it is reported as an error rather than
/// handed back as success.
///
/// Flaw B81: with no `-v`, the macOS default voice on this machine returns 118
/// frames (0.005 s) for ANY text. Returning that as `Ok` let the app believe it
/// had spoken while emitting silence, with nothing audible and no signal — the
/// exact "claim it worked when it didn't" failure this project forbids. The
/// resolved-voice fix above prevents the usual cause; this is the backstop for
/// every other way a voice can go hollow (a half-installed voice, a revoked
/// entitlement, a future macOS change).
///
/// The bar is deliberately generous. Conversational speech runs near 80 ms per
/// character; the floor here is **10 ms** per character — roughly an eighth of
/// that — plus a 50 ms absolute minimum, so ordinary short utterances ("ok",
/// "96") can never false-trigger. Only output that is an order of magnitude too
/// small trips it.
fn hollow_synth_reason(text: &str, pcm: &Pcm) -> Option<String> {
    let chars = text.trim().chars().count();
    if chars == 0 || pcm.rate == 0 {
        return None;
    }
    let rate = pcm.rate as f32;
    let expected = (rate * 0.05).max(chars as f32 * rate * 0.01);
    let got = pcm.mono_f32.len();
    if (got as f32) < expected {
        return Some(format!(
            "`say` produced {got} samples ({:.3}s) for {chars} characters — expected at least              {} samples ({:.3}s). The system voice is not synthesizing audibly (flaw B81);              reporting this as a failure rather than \"speaking\" silence.",
            got as f32 / rate,
            expected as usize,
            expected / rate,
        ));
    }
    None
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
    use std::sync::{Arc, Mutex};

    #[test]
    fn temp_paths_are_unique() {
        let a = temp_wav_path();
        let b = temp_wav_path();
        assert_ne!(a, b);
        assert!(a.extension().is_some_and(|e| e == "wav"));
    }
    // B81 part 2: a hollow synth must be REPORTED, not spoken. These drive the
    // classifier with fixtures rather than the machine's own voice, so they hold
    // on any host.

    fn pcm_of(secs: f32) -> Pcm {
        Pcm {
            rate: SAY_RATE,
            mono_f32: vec![0.0; (SAY_RATE as f32 * secs) as usize],
        }
    }

    #[test]
    fn synth_actually_calls_the_hollow_check() {
        // The classifier is tested directly above, which would NOT catch someone
        // deleting its call from `synth`. `synth` shells out to the real `say`,
        // so it cannot be driven hollow on a healthy machine — a source-level
        // assertion is the honest guard here (the same idiom this repo already
        // uses for CSS invariants). If `synth` is ever refactored to take an
        // injectable command runner, replace this with a behavioural test.
        let src = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/tts/say.rs"),
        )
        .expect("read say.rs");
        let body_start = src.find("fn synth(&self, text: &str)").expect("synth exists");
        let body = &src[body_start..body_start + 1200];
        assert!(
            body.contains("hollow_synth_reason("),
            "synth must run the hollow-synth check before returning audio (flaw B81)"
        );
    }

    #[test]
    fn a_hollow_synth_is_reported_not_returned_as_speech() {
        // The exact B81 symptom: 118 frames for a twelve-character phrase.
        let pcm = Pcm {
            rate: SAY_RATE,
            mono_f32: vec![0.0; 118],
        };
        let reason = hollow_synth_reason("test one two", &pcm)
            .expect("118 samples for 12 characters must be classified hollow");
        assert!(reason.contains("118 samples"), "reason names what it got: {reason}");
    }

    #[test]
    fn a_normal_length_synth_is_never_called_hollow() {
        // Real measured healthy output for this phrase is ~20,734 samples.
        assert!(hollow_synth_reason("test one two", &pcm_of(0.94)).is_none());
        // And a stingy-but-plausible rendering still passes: the bar is an
        // eighth of real speech, so this must not false-trigger.
        assert!(hollow_synth_reason("test one two", &pcm_of(0.13)).is_none());
    }

    #[test]
    fn short_utterances_cannot_false_trigger() {
        // "ok" and "96" are legitimately brief; only the 50ms floor applies.
        assert!(hollow_synth_reason("ok", &pcm_of(0.06)).is_none());
        assert!(hollow_synth_reason("96", &pcm_of(0.06)).is_none());
        // Empty text has nothing to expect.
        assert!(hollow_synth_reason("", &pcm_of(0.0)).is_none());
        assert!(hollow_synth_reason("   ", &pcm_of(0.0)).is_none());
    }

    #[test]
    fn a_long_sentence_needs_proportionally_more_audio() {
        let long = "metronome ninety six and take the passage from the pickup";
        // 0.2s is fine for a short phrase but far too little for this one.
        assert!(hollow_synth_reason(long, &pcm_of(0.2)).is_some());
        assert!(hollow_synth_reason(long, &pcm_of(1.5)).is_none());
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

    // --- voice list parsing -------------------------------------------------

    #[test]
    fn parses_voice_list_lines() {
        let text = "Alex                en_US    # Most people recognize me by my voice.\n\
                     Samantha            en_US    # Hello, my name is Samantha.\n\
                     Daniel              en_GB    # Hello, my name is Daniel.\n\
                     Bad News            en_US    # Hello! My name is Bad News.\n";
        let voices = parse_voice_list(text);
        assert_eq!(
            voices,
            vec![
                ("Alex".to_string(), "en_US".to_string()),
                ("Samantha".to_string(), "en_US".to_string()),
                ("Daniel".to_string(), "en_GB".to_string()),
                ("Bad News".to_string(), "en_US".to_string()),
            ]
        );
    }

    #[test]
    fn skips_unparseable_voice_lines() {
        let text = "not a voice line at all\n\nAlex                en_US    # hi\n";
        let voices = parse_voice_list(text);
        assert_eq!(voices, vec![("Alex".to_string(), "en_US".to_string())]);
    }

    // --- resolve_voice (pure) -----------------------------------------------

    #[test]
    fn resolve_voice_prefers_configured_when_installed() {
        let installed = vec![
            ("Alex".to_string(), "en_US".to_string()),
            ("Samantha".to_string(), "en_US".to_string()),
        ];
        assert_eq!(
            resolve_voice(Some("Alex"), &installed),
            Some("Alex".to_string())
        );
    }

    /// Required test: a configured-but-uninstalled voice must fall through to a
    /// working resolution rather than erroring or returning `None`.
    #[test]
    fn resolve_voice_falls_back_when_configured_not_installed() {
        let installed = vec![("Samantha".to_string(), "en_US".to_string())];
        assert_eq!(
            resolve_voice(Some("NotInstalledVoice"), &installed),
            Some("Samantha".to_string())
        );
    }

    #[test]
    fn resolve_voice_falls_back_to_any_en_us_voice() {
        let installed = vec![("SomeOtherEnUsVoice".to_string(), "en_US".to_string())];
        assert_eq!(
            resolve_voice(None, &installed),
            Some("SomeOtherEnUsVoice".to_string())
        );
    }

    #[test]
    fn resolve_voice_none_when_nothing_installed() {
        let installed: Vec<(String, String)> = vec![];
        assert_eq!(resolve_voice(None, &installed), None);
    }

    // --- say_args (pure) ------------------------------------------------------

    /// Required test: an explicit/resolved voice is always passed as `-v <voice>`
    /// when one resolves.
    #[test]
    fn say_args_pass_resolved_voice() {
        let args = say_args(Some("Samantha"), Path::new("/tmp/out.wav"), "hi");
        let idx = args
            .iter()
            .position(|a| a == &OsString::from("-v"))
            .expect("`-v` flag must be present when a voice resolved");
        assert_eq!(args[idx + 1], OsString::from("Samantha"));
    }

    #[test]
    fn say_args_omit_voice_flag_when_none_resolved() {
        let args = say_args(None, Path::new("/tmp/out.wav"), "hi");
        assert!(!args.iter().any(|a| a == &OsString::from("-v")));
    }

    // --- caching --------------------------------------------------------------

    /// Counts calls to `list()` so the cache test can assert `say -v '?'` (or its
    /// fake stand-in) runs exactly once per `SayTts` instance.
    struct CountingLister {
        calls: Arc<Mutex<u32>>,
        voices: Vec<(String, String)>,
    }

    impl VoiceLister for CountingLister {
        fn list(&self) -> Vec<(String, String)> {
            *self.calls.lock().unwrap() += 1;
            self.voices.clone()
        }
    }

    /// Required test: voice resolution is cached per instance, not re-shelled per
    /// utterance. The `synth()` calls still exercise the real `say` binary for
    /// audio (per the task spec) — only the *lister* is faked/counted.
    #[test]
    fn voice_resolution_is_cached_across_synth_calls() {
        let calls = Arc::new(Mutex::new(0u32));
        let lister = CountingLister {
            calls: calls.clone(),
            voices: vec![("Samantha".to_string(), "en_US".to_string())],
        };
        let tts = SayTts::with_seams(None, Box::new(lister));

        let _ = tts.synth("first utterance");
        let _ = tts.synth("second utterance");

        assert_eq!(
            *calls.lock().unwrap(),
            1,
            "voice list should be resolved once and cached, not re-shelled per synth() call"
        );
    }
}
