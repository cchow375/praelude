//! Live, `#[ignore]`d TTS smoke tests. They open the real audio device and
//! (for Gemini) hit the network with the real key, so they are opt-in:
//!
//!   cargo test --test tts_live gemini_live -- --ignored --nocapture
//!   cargo test --test tts_live say_live    -- --ignored --nocapture
//!
//! Each speaks "CodaKiller online" audibly THROUGH the engine via the real
//! [`Speaker`] worker + half-duplex gate, proving the whole path end-to-end.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use codakiller_lib::audio::{Engine, EngineConfig, EngineHandle};
use codakiller_lib::tts::{
    select_provider, Gate, PcmSink, Speaker, SpeakerConfig, TtsProvider,
};

/// A gate that just logs transitions (no real STT needed to prove audio output).
struct LogGate {
    n: AtomicUsize,
}
impl Gate for LogGate {
    fn set_gate(&self, open: bool) {
        let n = self.n.fetch_add(1, Ordering::SeqCst);
        eprintln!("[gate] #{n} -> {}", if open { "OPEN" } else { "CLOSED" });
    }
}

fn speak_through_engine(provider: Box<dyn TtsProvider>, label: &str) {
    let engine: EngineHandle = Engine::start(EngineConfig::default()).expect("audio engine starts");
    eprintln!("[{label}] engine up @ {} Hz", engine.sample_rate());
    let sink: Arc<dyn PcmSink> = Arc::new(engine);
    let gate: Arc<dyn Gate> = Arc::new(LogGate {
        n: AtomicUsize::new(0),
    });
    let speaker = Speaker::spawn(provider, sink, gate, SpeakerConfig::default());
    eprintln!("[{label}] speaking 'CodaKiller online' ...");
    speaker
        .speak_blocking("CodaKiller online")
        .unwrap_or_else(|e| panic!("[{label}] speak failed: {e}"));
    eprintln!("[{label}] done (heard it?).");
    drop(speaker);
}

/// Live Gemini path (needs the real key + network). Uses `select_provider` with
/// no override so it exercises the real selection + key resolution.
#[test]
#[ignore]
fn gemini_live() {
    let provider = select_provider(Some("gemini".to_string()), None, None);
    speak_through_engine(provider, "gemini");
}

/// Live `say` fallback path (offline; always works on macOS). Forces the `say`
/// provider via the override.
#[test]
#[ignore]
fn say_live() {
    let provider = select_provider(Some("say".to_string()), None, None);
    speak_through_engine(provider, "say");
}
