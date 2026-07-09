//! Gemini TTS provider — the `v1beta/interactions` single-speaker speech API.
//!
//! Verified against ai.google.dev + context7 (2026-07; see NOTES.md). The request
//! and response shapes here are the current `interactions` API, NOT the older
//! `generateContent`/`inlineData` form. Request/response helpers are pure so they
//! are unit-tested with no network.
//!
//! * Endpoint: `POST {BASE}/v1beta/interactions`
//! * Auth: header `x-goog-api-key: <key>` (never logged)
//! * Body: `{model, input, response_format:{type:"audio"},
//!   generation_config:{speech_config:[{voice}]}}`
//! * Response: `{output_audio:{data:"<base64>"}}`, audio = raw headerless PCM,
//!   mono, 24 kHz, signed 16-bit little-endian.

use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};

use super::{Pcm, Result, TtsError, TtsProvider};

/// API host (overridable in tests via [`GeminiTts::with_base_url`], though the
/// unit tests never hit the network).
const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com";
/// Default single-speaker TTS model (verified current 2026-07).
pub const DEFAULT_MODEL: &str = "gemini-3.1-flash-tts-preview";
/// Default prebuilt voice.
pub const DEFAULT_VOICE: &str = "Kore";
/// Gemini TTS returns 24 kHz mono s16le PCM.
const GEMINI_RATE: u32 = 24_000;
/// Per-request timeout (whole request, including body read).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The Gemini TTS provider. Holds the API key, model, voice, and a blocking
/// reqwest client with a 10 s timeout. `synth` runs synchronously on the caller
/// (the [`Speaker`](super::Speaker) worker) thread.
pub struct GeminiTts {
    api_key: String,
    model: String,
    voice: String,
    base_url: String,
    client: reqwest::blocking::Client,
}

impl GeminiTts {
    /// Build a provider. `model`/`voice` default to [`DEFAULT_MODEL`]/[`DEFAULT_VOICE`].
    pub fn new(api_key: String, model: Option<String>, voice: Option<String>) -> GeminiTts {
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default();
        GeminiTts {
            api_key,
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            voice: voice.unwrap_or_else(|| DEFAULT_VOICE.to_string()),
            base_url: DEFAULT_BASE_URL.to_string(),
            client,
        }
    }

    /// Override the base URL (for a live test against a mock, not used in prod).
    pub fn with_base_url(mut self, base: impl Into<String>) -> Self {
        self.base_url = base.into();
        self
    }

    /// Full endpoint URL for the interactions call.
    fn endpoint(&self) -> String {
        format!("{}/v1beta/interactions", self.base_url.trim_end_matches('/'))
    }
}

/// Build the JSON request body for `text` with the given `model`/`voice`. Pure —
/// unit-tested without a client.
pub fn build_request_body(text: &str, model: &str, voice: &str) -> Value {
    json!({
        "model": model,
        "input": text,
        "response_format": { "type": "audio" },
        "generation_config": {
            "speech_config": [ { "voice": voice } ]
        }
    })
}

/// Parse an `interactions` response body. VERIFIED against the live API
/// (2026-07): audio lives at `steps[].content[].{mime_type,data}`, where
/// `mime_type` is `audio/l16` (linear 16-bit PCM). The docs' summarized
/// `output_audio.data` field does NOT exist. We concatenate every audio chunk
/// across all steps (there may be more than one), decode base64 → s16le → f32,
/// and take the sample rate from a `rate=NNNN` in the mime_type if present, else
/// the 24 kHz Gemini TTS default.
pub fn parse_response(body: &[u8]) -> Result<Pcm> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| TtsError::Decode(format!("response was not JSON: {e}")))?;

    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .ok_or_else(|| TtsError::Decode("response has no `steps` array".into()))?;

    let mut bytes: Vec<u8> = Vec::new();
    let mut rate: Option<u32> = None;
    for step in steps {
        let Some(contents) = step.get("content").and_then(|c| c.as_array()) else {
            continue;
        };
        for c in contents {
            let mime = c.get("mime_type").and_then(|m| m.as_str()).unwrap_or("");
            // Only audio parts carry PCM; skip any text/other parts.
            if !mime.starts_with("audio/") {
                continue;
            }
            if rate.is_none() {
                rate = rate_from_mime(mime);
            }
            if let Some(data) = c.get("data").and_then(|d| d.as_str()) {
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|e| TtsError::Decode(format!("audio data not base64: {e}")))?;
                bytes.extend_from_slice(&decoded);
            }
        }
    }

    if bytes.is_empty() {
        return Err(TtsError::Decode(
            "response steps contained no audio data".into(),
        ));
    }
    Ok(Pcm {
        rate: rate.unwrap_or(GEMINI_RATE),
        mono_f32: pcm_s16le_to_f32(&bytes),
    })
}

/// Extract `rate=NNNN` from a mime_type like `audio/L16;codec=pcm;rate=24000`.
/// `audio/l16` with no rate returns `None` (caller defaults to 24 kHz).
fn rate_from_mime(mime: &str) -> Option<u32> {
    mime.split(';')
        .find_map(|p| p.trim().strip_prefix("rate="))
        .and_then(|r| r.trim().parse().ok())
}

/// Reinterpret raw signed-16-bit little-endian bytes as normalized f32 samples in
/// [-1, 1). A trailing odd byte (never expected) is ignored.
pub fn pcm_s16le_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

impl TtsProvider for GeminiTts {
    fn synth(&self, text: &str) -> Result<Pcm> {
        let body = build_request_body(text, &self.model, &self.voice);
        let resp = self
            .client
            .post(self.endpoint())
            // Header name is the ONLY place the key is used; it is never logged.
            .header("x-goog-api-key", &self.api_key)
            .json(&body)
            .send()
            .map_err(|e| TtsError::Transport(e.to_string()))?;

        let status = resp.status();
        let bytes = resp
            .bytes()
            .map_err(|e| TtsError::Transport(format!("reading response body: {e}")))?;

        if !status.is_success() {
            // Body may carry a Google error message; include it but never the key.
            let snippet = String::from_utf8_lossy(&bytes);
            let snippet = snippet.chars().take(500).collect::<String>();
            return Err(TtsError::Status(status.as_u16(), snippet));
        }

        parse_response(&bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_matches_verified_shape() {
        let body = build_request_body("CodaKiller online", "gemini-3.1-flash-tts-preview", "Kore");
        assert_eq!(body["model"], "gemini-3.1-flash-tts-preview");
        assert_eq!(body["input"], "CodaKiller online");
        assert_eq!(body["response_format"]["type"], "audio");
        // speech_config is an ARRAY of {voice}, per the verified docs.
        assert_eq!(body["generation_config"]["speech_config"][0]["voice"], "Kore");
        assert!(
            body["generation_config"]["speech_config"].is_array(),
            "speech_config must be an array"
        );
    }

    #[test]
    fn voice_and_model_pass_through() {
        let body = build_request_body("hi", "custom-model", "Puck");
        assert_eq!(body["model"], "custom-model");
        assert_eq!(body["generation_config"]["speech_config"][0]["voice"], "Puck");
    }

    #[test]
    fn endpoint_is_interactions() {
        let g = GeminiTts::new("k".into(), None, None);
        assert_eq!(
            g.endpoint(),
            "https://generativelanguage.googleapis.com/v1beta/interactions"
        );
        assert_eq!(g.model, DEFAULT_MODEL);
        assert_eq!(g.voice, DEFAULT_VOICE);
    }

    #[test]
    fn s16le_decode_endianness_and_scale() {
        // 0x0000 = 0.0, 0x7FFF = ~+1.0, 0x8000 (-32768) = -1.0. LE byte order.
        let bytes = [0x00, 0x00, 0xFF, 0x7F, 0x00, 0x80];
        let f = pcm_s16le_to_f32(&bytes);
        assert_eq!(f.len(), 3);
        assert!((f[0]).abs() < 1e-9, "zero maps to 0.0");
        assert!((f[1] - 0.999_97).abs() < 1e-3, "max positive ~ +1.0");
        assert!((f[2] + 1.0).abs() < 1e-9, "min maps to -1.0");
    }

    #[test]
    fn parse_response_extracts_pcm_from_steps() {
        // Real verified shape: steps[].content[].{mime_type,data}. Two s16le
        // samples: 0 and 16384 (~0.5). base64 of [00 00 00 40]. mime `audio/l16`
        // (no rate) => default 24 kHz.
        let raw = [0u8, 0, 0, 0x40];
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
        let body = format!(
            r#"{{"status":"completed","steps":[{{"content":[{{"mime_type":"audio/l16","data":"{b64}"}}]}}]}}"#
        );
        let pcm = parse_response(body.as_bytes()).expect("parses");
        assert_eq!(pcm.rate, 24_000, "audio/l16 with no rate defaults to 24 kHz");
        assert_eq!(pcm.mono_f32.len(), 2);
        assert!((pcm.mono_f32[0]).abs() < 1e-9);
        assert!((pcm.mono_f32[1] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn parse_response_concatenates_multiple_audio_chunks_and_reads_rate() {
        let a = base64::engine::general_purpose::STANDARD.encode([0u8, 0]); // 1 sample
        let b = base64::engine::general_purpose::STANDARD.encode([0u8, 0x40]); // 1 sample
        // Two content parts across steps, mime carries an explicit rate.
        let body = format!(
            r#"{{"steps":[{{"content":[{{"mime_type":"audio/L16;codec=pcm;rate=16000","data":"{a}"}}]}},{{"content":[{{"mime_type":"audio/l16","data":"{b}"}}]}}]}}"#
        );
        let pcm = parse_response(body.as_bytes()).expect("parses");
        assert_eq!(pcm.rate, 16_000, "rate parsed from the first mime_type");
        assert_eq!(pcm.mono_f32.len(), 2, "both chunks concatenated");
    }

    #[test]
    fn parse_response_rejects_missing_audio() {
        let err = parse_response(br#"{"error":{"code":429}}"#).unwrap_err();
        assert!(matches!(err, TtsError::Decode(_)), "got {err:?}");
        // A step with no audio content is also a decode error.
        let err2 = parse_response(br#"{"steps":[{"content":[]}]}"#).unwrap_err();
        assert!(matches!(err2, TtsError::Decode(_)), "got {err2:?}");
    }

    #[test]
    fn rate_from_mime_parses_or_defaults() {
        assert_eq!(rate_from_mime("audio/L16;codec=pcm;rate=24000"), Some(24_000));
        assert_eq!(rate_from_mime("audio/l16"), None);
    }
}
