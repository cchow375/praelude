//! Vision-based per-page measure scan (Plan C, task C2).
//!
//! This module is the vision half of measure mapping: given one page image,
//! ask a Claude-primary/Gemini-fallback vision model to report the printed
//! system/bar geometry as strict JSON, and hand back a typed
//! [`ScanPageOutput`] the reconciliation task (C3) consumes verbatim.
//!
//! It talks to NOTHING but the provider chain and (when the caller has no
//! JPEG already) the existing screen-resolution page-image fast path
//! (`super::page_image::render_page_image`). It never writes to
//! `measure_map` — that table is only ever changed by an explicit user Apply
//! (see `store::measure_map`), and this module holds no state of its own: a
//! scan is never cached (`global-constraints.md`: "Never cached — scans are
//! explicit").
//!
//! # Coordinate system
//!
//! Every coordinate `ScanPageOutput` reports is a normalized `0.0..=1.0`
//! fraction of the page image, top-left origin — the same convention as
//! `store::measure_map::MapSystem`.
//!
//! # The client-raster contract
//!
//! When the caller passes no `page_jpeg`, this tries the server-side fast
//! path (`render_page_image`, 2048-px-long-edge bucket) first. That path
//! refuses anything it is not a single full-page image scan of (a vector
//! page, in particular) — see `score::page_image`'s module docs. On a
//! refusal this returns [`ScanError::NeedsClientRaster`], whose `Display` is
//! the exact literal `"needs_client_raster"` (never wrapped in extra prose),
//! so the frontend can match it and re-call with a canvas-encoded JPEG (the
//! `firstPageCache` idiom already used for vector-page rendering elsewhere).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::brain::{BrainError, ProviderChain, Transport};
use crate::store::Store;

use super::page_image;

/// Hard cap on a caller-supplied `page_jpeg`. Matches the brief's "≤8 MB
/// cap" — generous above what a screen-resolution page image ever is (a few
/// hundred KB to low single-digit MB), but small enough to keep a malformed
/// or hostile payload from ever reaching the vision request builders.
pub const SCAN_PAGE_JPEG_MAX_BYTES: usize = 8 * 1024 * 1024;

/// Vision scan prompt, v1 (Plan C, C2). Sent as the request's `system` text
/// to both providers. Versioned because the strict JSON contract it demands
/// is parsed verbatim into [`ScanPageOutput`] (`#[serde(deny_unknown_fields)]`)
/// — a future v2 prompt must be its own constant rather than silently
/// drifting this one out of sync with the type it feeds.
pub(crate) const SCAN_PAGE_PROMPT_V1: &str = r#"You are a precise sheet-music page scanner. You are given one page image of a piano score. Your ONLY job is to report the geometry of the printed systems and bar lines — never to interpret, perform, or grade the music.

Coordinate system: every coordinate is a fraction of the page image, 0.0 to 1.0, with the origin (0,0) at the TOP-LEFT corner and (1,1) at the bottom-right corner. x increases rightward, y increases downward.

For EVERY system (one continuous line of music, top to bottom of the page), report:
- y_top, y_bottom: the system's vertical span (the top of its highest staff line to the bottom of its lowest staff line, including any bracket/brace).
- x_left, x_right: the system's horizontal span (the start of the first bar to the end of the last bar).
- barline_xs: the x position of EVERY bar line in the system, left to right, including the final bar line at x_right.
- staves: how many individual staff lines make up this system (a grand staff for solo piano is 2; a single melody line is 1; a multi-instrument system is however many parts are bracketed together).
- printed_numbers: ONLY measure numbers that are ACTUALLY PRINTED on the page as visible text (small numerals above or below a bar line, as engravers print them). For each one report the exact number printed, its x/y position, and your confidence (0.0-1.0) that you read the digits correctly. If NO numbers are printed on this page, printed_numbers MUST be an empty array. NEVER infer, guess, or count out a measure number that is not actually printed on the page — an unprinted number must never appear here.

System-shape examples (illustrative only — always report what is ACTUALLY on the page):

Grand staff (solo piano, 2 staves bracketed together):
{"y_top":0.08,"y_bottom":0.22,"x_left":0.10,"x_right":0.95,"barline_xs":[0.10,0.32,0.55,0.78,0.95],"printed_numbers":[{"number":17,"x":0.10,"y":0.075,"confidence":0.98}],"staves":2}

Multi-instrument system (e.g. a trio, 3 staves bracketed together):
{"y_top":0.30,"y_bottom":0.58,"x_left":0.10,"x_right":0.93,"barline_xs":[0.10,0.28,0.46,0.64,0.82,0.93],"printed_numbers":[],"staves":3}

Single-line system (one melodic staff, no bracket):
{"y_top":0.65,"y_bottom":0.74,"x_left":0.10,"x_right":0.90,"barline_xs":[0.10,0.40,0.70,0.90],"printed_numbers":[{"number":33,"x":0.10,"y":0.645,"confidence":0.9}],"staves":1}

Output contract — STRICT JSON, nothing else:
Return EXACTLY ONE JSON object, no markdown code fence, no prose before or after it, matching this shape and no other keys:
{"systems":[{"y_top":NUMBER,"y_bottom":NUMBER,"x_left":NUMBER,"x_right":NUMBER,"barline_xs":[NUMBER,...],"printed_numbers":[{"number":INTEGER,"x":NUMBER,"y":NUMBER,"confidence":NUMBER}],"staves":INTEGER}]}
Systems MUST be ordered top-to-bottom by y_top. Every coordinate MUST be a finite number in 0.0..=1.0. Do not add any key not shown above. Do not wrap the JSON in ```json fences or any other markup."#;

/// The (short) user-turn text. The real instructions live in the system
/// prompt above; this just names the task.
const SCAN_USER_PROMPT: &str =
    "Scan this score page and return the measure-map JSON exactly as instructed. Report only what is actually printed.";

/// Appended to the user prompt on the one allowed retry after a
/// parse/validation failure.
const SCAN_RETRY_INSTRUCTION: &str = "\n\nYour previous reply did not parse as the exact JSON contract above (it may have included markdown fences, prose, or an unknown field). Return ONLY the single JSON object, with no code fence and no other text.";

/// One page's vision scan result. `systems` is top-to-bottom (`y_top`
/// ascending); the reconciliation task (C3) consumes this type verbatim to
/// produce `store::measure_map`'s `MeasureMapPage`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ScanPageOutput {
    pub systems: Vec<ScanSystem>,
}

/// One system (a line of music) as the vision model read it.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ScanSystem {
    pub y_top: f64,
    pub y_bottom: f64,
    pub x_left: f64,
    pub x_right: f64,
    pub barline_xs: Vec<f64>,
    pub printed_numbers: Vec<PrintedNumber>,
    pub staves: u32,
}

/// One measure number the model actually saw printed on the page.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PrintedNumber {
    pub number: u32,
    pub x: f64,
    pub y: f64,
    pub confidence: f64,
}

/// A typed, distinguishable scan failure. Every variant's `Display` is a
/// short, stable, string the frontend can match; [`ScanError::NeedsClientRaster`]
/// in particular is the exact literal `"needs_client_raster"` and MUST never
/// change shape or gain a suffix — the frontend matches it verbatim to decide
/// whether to retry with a client-rasterized JPEG.
#[derive(Debug, Clone, PartialEq)]
pub enum ScanError {
    /// The server-side fast path refused this page (not a single-image
    /// scan). The frontend re-calls with a canvas-encoded `page_jpeg`.
    NeedsClientRaster,
    /// A caller-supplied `page_jpeg` failed the magic-byte check.
    InvalidJpeg(String),
    /// A caller-supplied `page_jpeg` exceeded [`SCAN_PAGE_JPEG_MAX_BYTES`].
    TooLarge { bytes: usize, max: usize },
    /// The piece/edition could not be resolved to a real PDF path.
    Edition(String),
    /// The provider chain itself failed (no key, transport, bad HTTP).
    Provider(BrainError),
    /// Every candidate reply, on both the first attempt and the one retry,
    /// failed to parse as the strict `ScanPageOutput` contract.
    InvalidOutput,
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NeedsClientRaster => write!(f, "needs_client_raster"),
            Self::InvalidJpeg(reason) => write!(f, "page image is not usable: {reason}"),
            Self::TooLarge { bytes, max } => {
                write!(
                    f,
                    "page image is {bytes} bytes, over the {max}-byte scan cap"
                )
            }
            Self::Edition(message) => write!(f, "{message}"),
            Self::Provider(error) => write!(f, "{}", error.reason()),
            Self::InvalidOutput => write!(
                f,
                "scan response did not match the required JSON contract, even after one retry"
            ),
        }
    }
}

impl std::error::Error for ScanError {}

/// A coordinate/fraction is finite and normalized `0.0..=1.0`.
fn is_fraction(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

impl ScanPageOutput {
    fn is_valid(&self) -> bool {
        self.systems.iter().all(ScanSystem::is_valid)
    }
}

impl ScanSystem {
    fn is_valid(&self) -> bool {
        is_fraction(self.y_top)
            && is_fraction(self.y_bottom)
            && is_fraction(self.x_left)
            && is_fraction(self.x_right)
            && self.y_top < self.y_bottom
            && self.x_left < self.x_right
            && self.staves >= 1
            && self.barline_xs.iter().all(|x| is_fraction(*x))
            && self.printed_numbers.iter().all(PrintedNumber::is_valid)
    }
}

impl PrintedNumber {
    fn is_valid(&self) -> bool {
        is_fraction(self.x) && is_fraction(self.y) && is_fraction(self.confidence)
    }
}

/// Strip an accidental ```json ... ``` (or bare ``` ... ```) fence a vision
/// model added despite the prompt's explicit instruction not to. Anything
/// that is not fenced passes through untouched (after trimming).
fn strip_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    // Drop an optional language tag on the fence's opening line ("json\n").
    let rest = rest.split_once('\n').map_or(rest, |(_, after)| after);
    rest.strip_suffix("```").unwrap_or(rest).trim()
}

/// Parse and validate one candidate reply as the strict `ScanPageOutput`
/// contract. `deny_unknown_fields` bites first; then every coordinate is
/// range-checked. Any failure returns `None` — the caller decides what to do
/// (try the next candidate, retry, or give up).
fn parse_scan_output(text: &str) -> Option<ScanPageOutput> {
    let stripped = strip_code_fence(text);
    let output: ScanPageOutput = serde_json::from_str(stripped).ok()?;
    output.is_valid().then_some(output)
}

/// Ask the provider chain to scan `jpeg`, trying every candidate reply for a
/// valid `ScanPageOutput`; on total failure, retry ONCE with a corrective
/// instruction appended (a whole new provider round-trip); then a clear
/// typed error. No caching — every call is a fresh, explicit vision request.
fn scan_jpeg(
    jpeg: &[u8],
    chain: &ProviderChain,
    transport: &dyn Transport,
) -> Result<ScanPageOutput, ScanError> {
    let texts = chain
        .vision_texts(SCAN_PAGE_PROMPT_V1, SCAN_USER_PROMPT, jpeg, transport)
        .map_err(ScanError::Provider)?;
    if let Some(output) = texts.iter().find_map(|text| parse_scan_output(text)) {
        return Ok(output);
    }
    let retry_prompt = format!("{SCAN_USER_PROMPT}{SCAN_RETRY_INSTRUCTION}");
    let texts = chain
        .vision_texts(SCAN_PAGE_PROMPT_V1, &retry_prompt, jpeg, transport)
        .map_err(ScanError::Provider)?;
    texts
        .iter()
        .find_map(|text| parse_scan_output(text))
        .ok_or(ScanError::InvalidOutput)
}

/// Validate a caller-supplied (client-rasterized) JPEG: magic bytes plus the
/// size cap. The bytes are otherwise used as-is — this module never decodes
/// or re-encodes a client-supplied image.
fn validate_client_jpeg(bytes: &[u8]) -> Result<(), ScanError> {
    if bytes.len() > SCAN_PAGE_JPEG_MAX_BYTES {
        return Err(ScanError::TooLarge {
            bytes: bytes.len(),
            max: SCAN_PAGE_JPEG_MAX_BYTES,
        });
    }
    if bytes.len() < 2 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Err(ScanError::InvalidJpeg(
            "missing the JPEG SOI magic bytes".into(),
        ));
    }
    Ok(())
}

/// Render the page server-side at the screen-resolution fast path's 2048-px
/// long-edge bucket. `Err` from `render_page_image` (not a single-image
/// scan) becomes the typed client-raster signal, never a generic error.
fn render_server_jpeg(pdf_path: &Path, page: u32) -> Result<Vec<u8>, ScanError> {
    page_image::render_page_image(pdf_path, page, page_image::SCREEN_TARGET_LONG_EDGE)
        .map(|image| image.jpeg)
        .map_err(|_| ScanError::NeedsClientRaster)
}

/// Scan one page of one edition for its measure geometry (Plan C, C2).
///
/// When `page_jpeg` is `None`, the page is rendered through the existing
/// screen-resolution fast path; a refusal (vector page) surfaces as
/// [`ScanError::NeedsClientRaster`] so the frontend re-calls with a
/// canvas-encoded JPEG. When `page_jpeg` is `Some`, it is validated (JPEG
/// magic + the 8 MB cap) and used as-is. Never cached.
#[allow(clippy::too_many_arguments)]
pub fn measure_scan_page(
    store: &Store,
    piece_id: i64,
    edition_id: &str,
    edition_fingerprint: &str,
    page: u32,
    page_jpeg: Option<Vec<u8>>,
    chain: &ProviderChain,
    transport: &dyn Transport,
) -> Result<ScanPageOutput, ScanError> {
    if piece_id < 1 {
        return Err(ScanError::Edition(format!("piece {piece_id} not found")));
    }
    if edition_fingerprint.trim().is_empty() {
        return Err(ScanError::Edition(
            "edition fingerprint must not be empty".into(),
        ));
    }
    if page < 1 {
        return Err(ScanError::Edition(format!(
            "page {page} is not a page number"
        )));
    }

    let jpeg = match page_jpeg {
        Some(bytes) => {
            validate_client_jpeg(&bytes)?;
            bytes
        }
        None => {
            let edition =
                super::resolve_edition(store, piece_id, edition_id).map_err(ScanError::Edition)?;
            render_server_jpeg(&edition.path, page)?
        }
    };

    scan_jpeg(&jpeg, chain, transport)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brain::{FakeTransport, HttpResponse, ProviderConfig, ProviderPreference};
    use crate::store::model::ScanPiece;
    use lopdf::{dictionary, Document};
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    // ── SCAN_PAGE_PROMPT_V1 (L3): the load-bearing instructions ──────────
    //
    // The prompt is the whole contract with the vision model: three things in
    // it are load-bearing enough that quietly editing them away would silently
    // degrade every scan without failing any other test. Pinned verbatim.

    #[test]
    fn scan_prompt_v1_pins_its_load_bearing_instructions() {
        // 1. The bar-line instruction MUST keep the final bar line — dropping
        //    it loses the last measure of every system.
        assert!(
            SCAN_PAGE_PROMPT_V1.contains("including the final bar line"),
            "prompt must still ask for the final bar line"
        );

        // 2. The never-infer rule — the app's golden rule (report only what is
        //    printed) applied to the model.
        assert!(
            SCAN_PAGE_PROMPT_V1.contains(
                "NEVER infer, guess, or count out a measure number that is not actually printed"
            ),
            "prompt must still forbid inferring unprinted measure numbers"
        );
        assert!(
            SCAN_PAGE_PROMPT_V1
                .contains("ONLY measure numbers that are ACTUALLY PRINTED on the page"),
            "prompt must still scope printed_numbers to actually-printed numbers"
        );

        // 3. All THREE worked system-shape examples (grand staff /
        //    multi-instrument / single line) — the staves field is read
        //    straight off these.
        assert!(SCAN_PAGE_PROMPT_V1.contains("System-shape examples"));
        for example in [
            "Grand staff (solo piano, 2 staves bracketed together):",
            "Multi-instrument system (e.g. a trio, 3 staves bracketed together):",
            "Single-line system (one melodic staff, no bracket):",
        ] {
            assert!(
                SCAN_PAGE_PROMPT_V1.contains(example),
                "prompt must still carry the worked example: {example}"
            );
        }
        assert_eq!(
            SCAN_PAGE_PROMPT_V1.matches("\"y_top\":0.").count(),
            3,
            "exactly three worked system examples are expected \
             (the fourth \"y_top\" is the output-contract shape, not an example)"
        );

        // And the strict-JSON output contract the deny_unknown_fields type
        // depends on.
        assert!(SCAN_PAGE_PROMPT_V1.contains("Return EXACTLY ONE JSON object"));
        assert!(SCAN_PAGE_PROMPT_V1.contains("Systems MUST be ordered top-to-bottom by y_top."));
    }

    // ── strip_code_fence / parse_scan_output ────────────────────────────

    #[test]
    fn strip_code_fence_removes_a_json_fence() {
        let fenced = "```json\n{\"systems\":[]}\n```";
        assert_eq!(strip_code_fence(fenced), "{\"systems\":[]}");
    }

    #[test]
    fn strip_code_fence_removes_a_bare_fence() {
        let fenced = "```\n{\"systems\":[]}\n```";
        assert_eq!(strip_code_fence(fenced), "{\"systems\":[]}");
    }

    #[test]
    fn strip_code_fence_passes_through_unfenced_text() {
        assert_eq!(strip_code_fence("  {\"systems\":[]}  "), "{\"systems\":[]}");
    }

    #[test]
    fn parse_scan_output_accepts_a_fenced_strict_json_reply() {
        let fenced = "```json\n{\"systems\":[{\"y_top\":0.1,\"y_bottom\":0.2,\"x_left\":0.1,\"x_right\":0.9,\"barline_xs\":[0.1,0.9],\"printed_numbers\":[],\"staves\":2}]}\n```";
        let output = parse_scan_output(fenced).expect("fenced reply parses");
        assert_eq!(output.systems.len(), 1);
        assert_eq!(output.systems[0].staves, 2);
    }

    #[test]
    fn parse_scan_output_rejects_unknown_fields() {
        let text = "{\"systems\":[],\"bogus\":true}";
        assert!(parse_scan_output(text).is_none());
    }

    #[test]
    fn parse_scan_output_rejects_out_of_range_coordinates() {
        let text = "{\"systems\":[{\"y_top\":0.1,\"y_bottom\":1.4,\"x_left\":0.1,\"x_right\":0.9,\"barline_xs\":[],\"printed_numbers\":[],\"staves\":1}]}";
        assert!(parse_scan_output(text).is_none());
    }

    #[test]
    fn parse_scan_output_rejects_inverted_span() {
        let text = "{\"systems\":[{\"y_top\":0.5,\"y_bottom\":0.2,\"x_left\":0.1,\"x_right\":0.9,\"barline_xs\":[],\"printed_numbers\":[],\"staves\":1}]}";
        assert!(parse_scan_output(text).is_none());
    }

    #[test]
    fn parse_scan_output_rejects_a_confidence_outside_zero_one() {
        let text = "{\"systems\":[{\"y_top\":0.1,\"y_bottom\":0.2,\"x_left\":0.1,\"x_right\":0.9,\"barline_xs\":[],\"printed_numbers\":[{\"number\":3,\"x\":0.1,\"y\":0.1,\"confidence\":1.5}],\"staves\":1}]}";
        assert!(parse_scan_output(text).is_none());
    }

    // ── validate_client_jpeg ─────────────────────────────────────────────

    #[test]
    fn valid_client_jpeg_bytes_pass() {
        assert!(validate_client_jpeg(&[0xFF, 0xD8, 0xFF, 0xD9]).is_ok());
    }

    #[test]
    fn client_jpeg_missing_magic_bytes_is_rejected() {
        let error = validate_client_jpeg(&[0x00, 0x01, 0x02]).unwrap_err();
        assert!(matches!(error, ScanError::InvalidJpeg(_)));
    }

    #[test]
    fn oversized_client_jpeg_is_rejected() {
        let bytes = vec![0xFFu8; SCAN_PAGE_JPEG_MAX_BYTES + 1];
        let mut bytes = bytes;
        bytes[1] = 0xD8; // valid magic; only the size should trip this
        let error = validate_client_jpeg(&bytes).unwrap_err();
        assert_eq!(
            error,
            ScanError::TooLarge {
                bytes: SCAN_PAGE_JPEG_MAX_BYTES + 1,
                max: SCAN_PAGE_JPEG_MAX_BYTES,
            }
        );
    }

    #[test]
    fn client_jpeg_exactly_at_the_cap_is_accepted() {
        let mut bytes = vec![0u8; SCAN_PAGE_JPEG_MAX_BYTES];
        bytes[0] = 0xFF;
        bytes[1] = 0xD8;
        assert!(validate_client_jpeg(&bytes).is_ok());
    }

    // ── render_server_jpeg (vector-page refusal) ────────────────────────

    /// A one-page PDF with a text-drawing operator but no image XObject —
    /// exactly the "vector page" shape `render_page_image` refuses.
    fn write_vector_pdf(path: &Path) {
        let mut document = Document::with_version("1.5");
        let content = lopdf::content::Content {
            operations: vec![lopdf::content::Operation::new("Tj", vec![])],
        };
        let content_id = document.add_object(lopdf::Stream::new(
            dictionary! {},
            content.encode().unwrap(),
        ));
        let pages_id = document.new_object_id();
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content_id,
        });
        document.objects.insert(
            pages_id,
            lopdf::Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Count" => 1,
                "Kids" => vec![page_id.into()],
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document.save(path).unwrap();
    }

    #[test]
    fn a_vector_page_refuses_with_needs_client_raster() {
        let td = TempDir::new().unwrap();
        let pdf = td.path().join("vector.pdf");
        write_vector_pdf(&pdf);
        let error = render_server_jpeg(&pdf, 1).unwrap_err();
        assert_eq!(error, ScanError::NeedsClientRaster);
        assert_eq!(error.to_string(), "needs_client_raster");
    }

    // ── scan_jpeg (provider round-trip, retry-once, mock transport) ────

    fn claude_chain() -> ProviderChain {
        ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "test-key",
            "claude-test",
        )])
    }

    fn claude_text_response(text: &str) -> HttpResponse {
        HttpResponse::ok(json!({
            "content": [{"type": "text", "text": text}]
        }))
    }

    const VALID_SCAN_JSON: &str = "{\"systems\":[{\"y_top\":0.1,\"y_bottom\":0.2,\"x_left\":0.1,\"x_right\":0.9,\"barline_xs\":[0.1,0.5,0.9],\"printed_numbers\":[{\"number\":1,\"x\":0.1,\"y\":0.09,\"confidence\":0.95}],\"staves\":2}]}";

    #[test]
    fn a_clean_first_reply_parses_with_a_single_provider_call() {
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![claude_text_response(VALID_SCAN_JSON)]);
        let output = scan_jpeg(&[0xFF, 0xD8], &chain, &transport).unwrap();
        assert_eq!(output.systems.len(), 1);
        assert_eq!(transport.requests().len(), 1);
    }

    #[test]
    fn a_fenced_first_reply_is_stripped_and_accepted() {
        let chain = claude_chain();
        let fenced = format!("```json\n{VALID_SCAN_JSON}\n```");
        let transport = FakeTransport::responses(vec![claude_text_response(&fenced)]);
        let output = scan_jpeg(&[0xFF, 0xD8], &chain, &transport).unwrap();
        assert_eq!(output.systems.len(), 1);
        assert_eq!(transport.requests().len(), 1);
    }

    #[test]
    fn a_malformed_first_reply_retries_once_then_succeeds() {
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![
            claude_text_response("not json at all"),
            claude_text_response(VALID_SCAN_JSON),
        ]);
        let output = scan_jpeg(&[0xFF, 0xD8], &chain, &transport).unwrap();
        assert_eq!(output.systems.len(), 1);
        // Exactly one corrective retry: two whole provider round-trips.
        assert_eq!(transport.requests().len(), 2);
        // The retry's prompt carries the corrective instruction.
        let second_request_body = transport.requests()[1].body.to_string();
        assert!(second_request_body.contains("did not parse as the exact JSON contract"));
    }

    #[test]
    fn two_malformed_replies_in_a_row_return_a_typed_error_not_a_third_attempt() {
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![
            claude_text_response("still not json"),
            claude_text_response("also not json"),
        ]);
        let error = scan_jpeg(&[0xFF, 0xD8], &chain, &transport).unwrap_err();
        assert_eq!(error, ScanError::InvalidOutput);
        assert_eq!(transport.requests().len(), 2);
    }

    // ── measure_scan_page (full command surface) ────────────────────────

    fn fixture_store_and_piece() -> (TempDir, Store, i64) {
        let td = TempDir::new().unwrap();
        let piece_dir = td.path().join("Chopin - Scherzo");
        fs::create_dir_all(piece_dir.join("score")).unwrap();
        write_vector_pdf(&piece_dir.join("score/Henle.pdf"));
        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: piece_dir.to_string_lossy().into_owned(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: Some(piece_dir.join("score/Henle.pdf")),
            })
            .unwrap();
        (td, store, id)
    }

    #[test]
    fn measure_scan_page_surfaces_needs_client_raster_for_a_vector_edition() {
        let (_td, store, piece_id) = fixture_store_and_piece();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![]);
        let error = measure_scan_page(
            &store,
            piece_id,
            "score/Henle.pdf",
            "fp-a",
            1,
            None,
            &chain,
            &transport,
        )
        .unwrap_err();
        assert_eq!(error, ScanError::NeedsClientRaster);
        // The refusal is a routine fast-path answer, not a provider call.
        assert_eq!(transport.requests().len(), 0);
    }

    #[test]
    fn measure_scan_page_accepts_a_valid_client_supplied_jpeg() {
        let (_td, store, piece_id) = fixture_store_and_piece();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![claude_text_response(VALID_SCAN_JSON)]);
        let output = measure_scan_page(
            &store,
            piece_id,
            "score/Henle.pdf",
            "fp-a",
            1,
            Some(vec![0xFF, 0xD8, 0xFF, 0xD9]),
            &chain,
            &transport,
        )
        .unwrap();
        assert_eq!(output.systems.len(), 1);
    }

    #[test]
    fn measure_scan_page_rejects_an_oversized_client_jpeg_before_any_provider_call() {
        let (_td, store, piece_id) = fixture_store_and_piece();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![]);
        let mut bytes = vec![0u8; SCAN_PAGE_JPEG_MAX_BYTES + 1];
        bytes[0] = 0xFF;
        bytes[1] = 0xD8;
        let error = measure_scan_page(
            &store,
            piece_id,
            "score/Henle.pdf",
            "fp-a",
            1,
            Some(bytes),
            &chain,
            &transport,
        )
        .unwrap_err();
        assert!(matches!(error, ScanError::TooLarge { .. }));
        assert_eq!(transport.requests().len(), 0);
    }

    #[test]
    fn measure_scan_page_rejects_an_empty_fingerprint() {
        let (_td, store, piece_id) = fixture_store_and_piece();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![]);
        let error = measure_scan_page(
            &store,
            piece_id,
            "score/Henle.pdf",
            "  ",
            1,
            Some(vec![0xFF, 0xD8]),
            &chain,
            &transport,
        )
        .unwrap_err();
        assert!(matches!(error, ScanError::Edition(_)));
    }
}
