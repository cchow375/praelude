//! IMSLP (Petrucci Music Library) client — search + edition metadata over the
//! open MediaWiki API, with the actual PDF download handed off to the user's
//! system browser.
//!
//! WHY this shape (see `.workflow/scratch/imslp-api-notes.md`, verified live
//! 2026-07-27): IMSLP's MediaWiki API (`api.php`) serves full-text search
//! (`list=search`), raw work-page wikitext (`action=parse`), and structured file
//! URLs (`prop=imageinfo`) cleanly, with no auth and clean JSON. But the raw
//! file-serving path (`/images/…`) sits behind an MTCaptcha "Bot Check" that
//! 302-redirects every programmatic GET to `/friendlytest.html` regardless of
//! User-Agent or Referer, and robots.txt disallows exactly those paths. That gate
//! is a deliberate human-interaction control, **not** an obstacle to engineer
//! around: this module NEVER fetches file bytes. [`ImslpClient::file_url`]
//! resolves the direct URL + size + mime for display, and the download step is
//! done by opening that URL in the user's real browser (they clear the one-time
//! CAPTCHA there, and the browser's normal download flow saves the PDF).
//!
//! THREADING CONTRACT: every method here BLOCKS (blocking reqwest + a sleeping
//! rate guard). Tauri runs a non-`async` `#[tauri::command]` on the **main
//! thread**, which on macOS is also the WKWebView's thread — so calling these
//! from a sync command freezes the entire UI for the duration of the round trip
//! (up to [`REQUEST_TIMEOUT`]). The `imslp_*` commands in `lib.rs` are therefore
//! `async` + `spawn_blocking`; keep them that way.
//!
//! Testability: all network egress goes through the [`HttpGet`] seam, so the
//! JSON/wikitext parsers are exercised against canned fixtures with no live
//! network (mirroring the brain module's `Transport` trait). Exactly one
//! `#[ignore]`d live smoke test hits the real API.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

/// The one IMSLP MediaWiki API endpoint. Every call is a GET against this.
const API_ENDPOINT: &str = "https://imslp.org/api.php";

/// Descriptive User-Agent per IMSLP etiquette (§5 of the research notes).
const USER_AGENT: &str = "CodaKiller/4.0 personal practice app";

/// Minimum spacing between live requests. The research notes observed a
/// `Crawl-delay: 2` in robots.txt; the spec floor is ≥1s. We adopt 1s as the
/// hard rate guard (the app also debounces search-as-you-type on the frontend).
const MIN_REQUEST_SPACING: Duration = Duration::from_secs(1);

/// Per-request network timeout. Honest failure over an indefinite hang.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// One search result — a work/page on IMSLP. Field names are `snake_case` and
/// cross the Tauri IPC boundary verbatim (repo convention, see `store::model`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkHit {
    /// The exact page title — pass this straight back to [`ImslpClient::editions`].
    pub title: String,
    /// MediaWiki page id — **0 for every IMSLP search hit.** Verified live
    /// 2026-07-30: IMSLP's `list=search` returns only
    /// `ns/title/snippet/size/wordcount/timestamp`, with no `pageid` at all.
    /// The field is kept because other endpoints (and any future IMSLP change)
    /// may supply it, but it is NOT an identity: use [`WorkHit::title`], which
    /// is unique per wiki page and is what `editions` takes.
    pub page_id: i64,
    /// HTML snippet from the search index (may contain `<span>` highlight markup).
    pub snippet: String,
    /// Wikitext byte size of the page.
    pub size: i64,
    /// Word count of the page.
    pub word_count: i64,
    /// True when the page is a `#REDIRECT` stub (snippet begins with `#REDIRECT`).
    /// `action=parse` resolves redirects transparently, so callers can still use
    /// the title, but the frontend may want to de-emphasize these rows.
    pub is_redirect: bool,
}

/// One downloadable edition/file of a work, parsed from an `{{#fte:imslpfile}}`
/// block in the work-page wikitext. One `File Name N=` entry → one `Edition`
/// (multi-volume blocks yield several editions sharing the block's metadata).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Edition {
    /// Raw `File Name N=` value, e.g. `PMLP02312-Chopin_Nocturnes…pdf`. Feed this
    /// verbatim to [`ImslpClient::file_url`] — the API normalizes it.
    pub file_name: String,
    /// `File Description N=`, e.g. "Complete Score" (empty when absent).
    pub description: String,
    /// `Editor=` value (raw wikitext, may contain templates like `{{FE}}`).
    pub editor: String,
    /// `Publisher Information=` value (raw wikitext).
    pub publisher: String,
    /// `Copyright=` value, e.g. "Public Domain".
    pub copyright: String,
    /// `Image Type=` value, e.g. "Normal Scan".
    pub image_type: String,
}

/// Resolved direct-file facts for one edition file, from `prop=imageinfo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileInfo {
    /// Absolute `https://imslp.org/images/…` URL. This is the URL to hand to the
    /// system browser — it is CAPTCHA-gated, never fetch its bytes in-app.
    pub url: String,
    /// File size in bytes (for a "download 1.9 MB" affordance before handoff).
    pub size: i64,
    /// MIME type, e.g. `application/pdf`. Guard against non-PDF editions.
    pub mime: String,
}

/// The network seam. Real code uses [`NativeHttp`]; tests inject a canned-response
/// fake so every parser is exercised without touching the network.
pub trait HttpGet: Send + Sync {
    /// GET `url`, returning the response body as a UTF-8 string, or an honest
    /// error string on any transport/status failure.
    fn get(&self, url: &str) -> Result<String, String>;
}

/// Production [`HttpGet`]: a blocking reqwest client with a descriptive
/// User-Agent, a bounded timeout, and a simple last-request-time rate guard that
/// sleeps to keep every live request ≥ [`MIN_REQUEST_SPACING`] apart.
pub struct NativeHttp {
    client: reqwest::blocking::Client,
    last_request: Mutex<Option<Instant>>,
}

impl NativeHttp {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .expect("imslp HTTP client build");
        Self {
            client,
            last_request: Mutex::new(None),
        }
    }

    /// Block until at least [`MIN_REQUEST_SPACING`] has passed since the previous
    /// request, then record now as the new last-request time.
    fn rate_guard(&self) {
        let mut last = self.last_request.lock().expect("imslp rate-guard lock");
        if let Some(prev) = *last {
            let elapsed = prev.elapsed();
            if elapsed < MIN_REQUEST_SPACING {
                std::thread::sleep(MIN_REQUEST_SPACING - elapsed);
            }
        }
        *last = Some(Instant::now());
    }
}

impl Default for NativeHttp {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpGet for NativeHttp {
    fn get(&self, url: &str) -> Result<String, String> {
        self.rate_guard();
        let response = self.client.get(url).send().map_err(|_| {
            "Could not reach IMSLP. Check your connection and try again.".to_string()
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("IMSLP returned an unexpected status ({status})."));
        }
        response
            .text()
            .map_err(|_| "IMSLP sent a response CodaKiller could not read.".to_string())
    }
}

/// The one process-wide [`NativeHttp`]. Sharing it is load-bearing twice over:
/// the rate guard only spans requests if `last_request` outlives a single call
/// (a fresh client per command silently disabled it), and reqwest's connection
/// pool only keeps TLS alive across the search → editions → file_url sequence if
/// the `Client` is reused. Building one per command cost a full TLS handshake
/// every time.
static SHARED_HTTP: OnceLock<Arc<NativeHttp>> = OnceLock::new();

/// The IMSLP client. Holds the [`HttpGet`] seam; every method makes exactly one
/// GET. No retries — a failure surfaces honestly to the caller.
pub struct ImslpClient {
    http: Arc<dyn HttpGet>,
}

impl ImslpClient {
    /// Production client over the real network, sharing the process-wide
    /// [`SHARED_HTTP`] transport (see its docs for why sharing matters).
    pub fn new() -> Self {
        Self {
            http: SHARED_HTTP
                .get_or_init(|| Arc::new(NativeHttp::new()))
                .clone(),
        }
    }

    /// Construct over an injected transport (tests / advanced callers).
    pub fn with_http(http: Box<dyn HttpGet>) -> Self {
        Self {
            http: Arc::from(http),
        }
    }

    /// Full-text search by title/composer via `action=query&list=search`.
    /// Empty results are `Ok(vec![])`, not an error.
    pub fn search(&self, query: &str) -> Result<Vec<WorkHit>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "{API_ENDPOINT}?action=query&list=search&srsearch={}&format=json&srlimit=20",
            percent_encode(trimmed)
        );
        let body = self.http.get(&url)?;
        parse_search(&body)
    }

    /// Enumerate the downloadable editions of a work via
    /// `action=parse&prop=wikitext` + `{{#fte:imslpfile}}` block parsing. A work
    /// with zero score files is `Ok(vec![])` (audio-only / misfiled), distinct
    /// from a malformed-wikitext or API `Err`.
    pub fn editions(&self, page_title: &str) -> Result<Vec<Edition>, String> {
        let url = format!(
            "{API_ENDPOINT}?action=parse&page={}&format=json&prop=wikitext",
            percent_encode(page_title)
        );
        let body = self.http.get(&url)?;
        parse_editions(&body)
    }

    /// Resolve one edition file's direct URL + size + mime via `prop=imageinfo`.
    /// The returned URL is CAPTCHA-gated: hand it to the system browser, never
    /// fetch its bytes in-app.
    pub fn file_url(&self, file_name: &str) -> Result<FileInfo, String> {
        let title = format!("File:{file_name}");
        let url = format!(
            "{API_ENDPOINT}?action=query&titles={}&prop=imageinfo&iiprop=url|size|mime|sha1&format=json",
            percent_encode(&title)
        );
        let body = self.http.get(&url)?;
        parse_file_info(&body)
    }
}

impl Default for ImslpClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Percent-encode a query-parameter value (RFC 3986 unreserved set passes
/// through). Mirrors `references::percent_encode` — byte-by-byte, no shell text.
fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// If the API returned a MediaWiki `{"error":{"code","info"}}` envelope, surface
/// its `info` as an honest error string.
fn api_error(root: &Value) -> Option<String> {
    let info = root.get("error")?.get("info")?.as_str().unwrap_or("");
    Some(if info.is_empty() {
        "IMSLP reported an API error.".to_string()
    } else {
        format!("IMSLP API error: {info}")
    })
}

/// Parse a `list=search` JSON response into [`WorkHit`]s.
fn parse_search(body: &str) -> Result<Vec<WorkHit>, String> {
    let root: Value = serde_json::from_str(body)
        .map_err(|_| "IMSLP sent a search response CodaKiller could not parse.".to_string())?;
    if let Some(err) = api_error(&root) {
        return Err(err);
    }
    let results = match root.get("query").and_then(|q| q.get("search")) {
        Some(Value::Array(items)) => items,
        // No `query.search` key at all is a shape we don't recognize.
        _ => {
            return Err("IMSLP's search response was missing its results.".to_string());
        }
    };
    let hits = results
        .iter()
        .filter_map(|item| {
            let title = item.get("title")?.as_str()?.to_string();
            let snippet = item
                .get("snippet")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(WorkHit {
                is_redirect: snippet.trim_start().starts_with("#REDIRECT"),
                title,
                page_id: item.get("pageid").and_then(Value::as_i64).unwrap_or(0),
                snippet,
                size: item.get("size").and_then(Value::as_i64).unwrap_or(0),
                word_count: item.get("wordcount").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect();
    Ok(hits)
}

/// Parse an `action=parse&prop=wikitext` JSON response into [`Edition`]s.
fn parse_editions(body: &str) -> Result<Vec<Edition>, String> {
    let root: Value = serde_json::from_str(body)
        .map_err(|_| "IMSLP sent a work page CodaKiller could not parse.".to_string())?;
    if let Some(err) = api_error(&root) {
        return Err(err);
    }
    let wikitext = root
        .get("parse")
        .and_then(|p| p.get("wikitext"))
        .and_then(|w| w.get("*"))
        .and_then(Value::as_str)
        .ok_or_else(|| "IMSLP's work page had no readable content.".to_string())?;
    parse_editions_from_wikitext(wikitext)
}

/// Extract every `{{#fte:imslpfile … }}` block and flatten its `File Name N=`
/// entries into [`Edition`]s. `{{#fte:imslpaudio}}` blocks are ignored (we only
/// match `imslpfile`). An `imslpfile` block that opens but never closes at
/// balanced brace depth is malformed → honest `Err`.
fn parse_editions_from_wikitext(wikitext: &str) -> Result<Vec<Edition>, String> {
    const MARKER: &str = "{{#fte:imslpfile";
    let bytes = wikitext.as_bytes();
    let mut editions = Vec::new();
    let mut search_from = 0;

    while let Some(rel) = wikitext[search_from..].find(MARKER) {
        let block_start = search_from + rel;
        // Scan from just after the opening `{{` to find the matching `}}`,
        // counting nested `{{ … }}` (e.g. `{{P|…}}`, `{{FE}}`).
        let inner_start = block_start + 2; // past the opening "{{"
        let mut depth = 1i32;
        let mut i = inner_start;
        let mut close_at = None;
        while i + 1 < bytes.len() {
            if bytes[i] == b'{' && bytes[i + 1] == b'{' {
                depth += 1;
                i += 2;
            } else if bytes[i] == b'}' && bytes[i + 1] == b'}' {
                depth -= 1;
                if depth == 0 {
                    close_at = Some(i);
                    break;
                }
                i += 2;
            } else {
                i += 1;
            }
        }
        let close_at = close_at.ok_or_else(|| {
            "IMSLP's work page was malformed (an unterminated file block).".to_string()
        })?;
        // Inner content is between the marker and the closing braces.
        let inner = &wikitext[(block_start + MARKER.len())..close_at];
        editions.extend(editions_from_block(inner));
        search_from = close_at + 2;
    }

    Ok(editions)
}

/// Split one `imslpfile` block's inner text into `|Field=value` fields and build
/// an [`Edition`] per `File Name N=`.
fn editions_from_block(inner: &str) -> Vec<Edition> {
    let fields = parse_fields(inner);
    let field = |key: &str| -> String {
        fields
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let editor = field("Editor");
    let publisher = field("Publisher Information");
    let copyright = field("Copyright");
    let image_type = field("Image Type");

    let mut out = Vec::new();
    for (key, value) in &fields {
        // Match `File Name` / `File Name 1` / `File Name 2` … (the suffix number
        // is optional in some blocks).
        if let Some(suffix) = key.strip_prefix("File Name") {
            let suffix = suffix.trim();
            if !suffix.is_empty() && suffix.parse::<u32>().is_err() {
                continue; // e.g. a stray "File Name Foo" — not a real entry.
            }
            let file_name = value.trim().to_string();
            if file_name.is_empty() {
                continue;
            }
            let desc_key = if suffix.is_empty() {
                "File Description".to_string()
            } else {
                format!("File Description {suffix}")
            };
            out.push(Edition {
                file_name,
                description: field(&desc_key),
                editor: editor.clone(),
                publisher: publisher.clone(),
                copyright: copyright.clone(),
                image_type: image_type.clone(),
            });
        }
    }
    out
}

/// Split MediaWiki template inner text into `(key, value)` pairs. Fields are
/// delimited by a `|` at the start of a (possibly indented) line, which is robust
/// against inline template pipes like `{{P|Kistner|Leipzig}}` inside a value.
fn parse_fields(inner: &str) -> Vec<(String, String)> {
    let mut fields = Vec::new();
    // Each field begins at a line whose first non-whitespace char is `|`.
    // Continuation lines (no leading `|`) belong to the current field's value.
    let mut current: Option<(String, String)> = None;
    for line in inner.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix('|') {
            if let Some(pair) = current.take() {
                fields.push(pair);
            }
            if let Some(eq) = rest.find('=') {
                let key = rest[..eq].trim().to_string();
                let value = rest[eq + 1..].trim().to_string();
                current = Some((key, value));
            } else {
                // A `|`-line with no `=` (rare); treat the whole thing as a key.
                current = Some((rest.trim().to_string(), String::new()));
            }
        } else if let Some((_, value)) = current.as_mut() {
            // Continuation of a multi-line value.
            let line = line.trim();
            if !line.is_empty() {
                if !value.is_empty() {
                    value.push(' ');
                }
                value.push_str(line);
            }
        }
    }
    if let Some(pair) = current.take() {
        fields.push(pair);
    }
    fields
}

/// Parse a `prop=imageinfo` JSON response into a [`FileInfo`]. A missing file
/// (`missing` flag / no `imageinfo`) is an honest `Err` so the caller can fall
/// back to opening the work's wiki page.
fn parse_file_info(body: &str) -> Result<FileInfo, String> {
    let root: Value = serde_json::from_str(body)
        .map_err(|_| "IMSLP sent a file record CodaKiller could not parse.".to_string())?;
    if let Some(err) = api_error(&root) {
        return Err(err);
    }
    let pages = root
        .get("query")
        .and_then(|q| q.get("pages"))
        .and_then(Value::as_object)
        .ok_or_else(|| "IMSLP had no file record for that edition.".to_string())?;
    // There is exactly one page in the object, keyed by (possibly "-1") pageid.
    let page = pages
        .values()
        .next()
        .ok_or_else(|| "IMSLP had no file record for that edition.".to_string())?;
    if page.get("missing").is_some() {
        return Err("IMSLP no longer has that file (it may have been renamed).".to_string());
    }
    let info = page
        .get("imageinfo")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .ok_or_else(|| "IMSLP had no downloadable file for that edition.".to_string())?;
    let raw_url = info
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "IMSLP's file record was missing its URL.".to_string())?;
    Ok(FileInfo {
        url: absolute_url(raw_url),
        size: info.get("size").and_then(Value::as_i64).unwrap_or(0),
        mime: info
            .get("mime")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

/// IMSLP returns protocol-relative `//imslp.org/images/…` URLs; make them
/// absolute `https://` so the browser handoff has a complete URL.
fn absolute_url(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("//") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// A canned-response [`HttpGet`] fake: returns the queued body for each call,
    /// recording the URLs it was asked for into a shared handle the test can read.
    struct FakeHttp {
        body: String,
        urls: Arc<Mutex<Vec<String>>>,
    }

    impl FakeHttp {
        /// Returns the fake plus a handle onto the URLs it will be asked for.
        fn recording(body: &str) -> (Self, Arc<Mutex<Vec<String>>>) {
            let urls = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    body: body.to_string(),
                    urls: Arc::clone(&urls),
                },
                urls,
            )
        }
    }

    impl HttpGet for FakeHttp {
        fn get(&self, url: &str) -> Result<String, String> {
            self.urls.lock().unwrap().push(url.to_string());
            Ok(self.body.clone())
        }
    }

    // ---- Canned fixtures (trimmed real responses from the research notes) ----

    /// The REAL shape of an IMSLP `list=search` response, captured live on
    /// 2026-07-30 from
    /// `api.php?action=query&list=search&srsearch=chopin%20scherzo&format=json`.
    ///
    /// NOTE the absence of `pageid` — IMSLP simply does not send one. This
    /// fixture used to invent `"pageid": 12345`, which kept the suite green
    /// while the real UI keyed its result list on an always-0 id (duplicate
    /// React keys; selecting one work highlighted every row). Keep this fixture
    /// byte-faithful to the live response.
    const SEARCH_JSON: &str = r##"{
      "query": {
        "search": [
          { "ns": 0, "title": "Nocturne in E minor, Op.72 No.1 (Chopin, Frédéric)",
            "snippet": "Nocturne ...", "size": 9637, "wordcount": 1175,
            "timestamp": "2025-05-28T12:16:47Z" },
          { "ns": 0, "title": "Nocturnes, Op.9 (Chopin, Frédéric)",
            "snippet": "Complete score ...", "size": 42942, "wordcount": 3000,
            "timestamp": "2025-01-01T00:00:00Z" },
          { "ns": 0, "title": "Nocturne in C sharp minor op. posth (Chopin, Frederic)",
            "snippet": "#REDIRECT [[Nocturne ...]]", "size": 40, "wordcount": 3,
            "timestamp": "2025-01-01T00:00:00Z" }
        ]
      },
      "query-continue": { "search": { "sroffset": 5 } }
    }"##;

    /// A hypothetical MediaWiki search response that DOES carry `pageid` — kept
    /// so the parser stays correct if IMSLP ever starts sending one.
    const SEARCH_JSON_WITH_PAGEID: &str = r##"{
      "query": { "search": [
        { "ns": 0, "title": "Nocturnes, Op.9 (Chopin, Frédéric)", "pageid": 6789,
          "snippet": "Complete score ...", "size": 42942, "wordcount": 3000 }
      ] }
    }"##;

    const EMPTY_SEARCH_JSON: &str = r#"{"query": {"search": []}}"#;

    const API_ERROR_JSON: &str =
        r#"{"error": {"code": "nosuchaction", "info": "Unrecognized value for parameter."}}"#;

    // A work page with two `imslpfile` editions (one full, one missing several
    // fields) plus an `imslpaudio` block that must be ignored. Real template
    // shape from the notes (`{{P|…}}`, `{{FE}}` nested templates present).
    const WORK_WIKITEXT: &str = r#"{"parse": {"title": "Nocturnes, Op.9 (Chopin, Frédéric)", "pageid": 6789, "wikitext": {"*": "==General==\n| *****FILES***** =\n{{#fte:imslpfile\n|File Name 1=PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf\n|File Description 1=Complete Score\n|Editor={{FE}} (German)\n|Image Type=Normal Scan\n|Publisher Information={{P|Kistner|Fr. Kistner|Leipzig|{{HMB|1833|7}}|1832||995}}\n|Copyright=Public Domain\n|Misc. Notes=\n}}\n{{#fte:imslpfile\n|File Name 1=PMLP02312-Chopin_Nocturnes_Peters.pdf\n|File Description 1=Complete Score\n|Copyright=Public Domain\n}}\n| *****AUDIO***** =\n{{#fte:imslpaudio\n|File Name 1=Chopin_Op9_recording.mp3\n|Performer Categories=[[User:Someone]]\n|Copyright=Creative Commons\n}}\n"}}}"#;

    // A work page whose imslpfile block never closes → malformed.
    const MALFORMED_WIKITEXT: &str = r#"{"parse": {"wikitext": {"*": "{{#fte:imslpfile\n|File Name 1=PMLP-broken.pdf\n|Editor={{FE}}\n"}}}"#;

    // A work page with only audio (no scores) → Ok(empty), not an error.
    const AUDIO_ONLY_WIKITEXT: &str = r#"{"parse": {"wikitext": {"*": "{{#fte:imslpaudio\n|File Name 1=only_audio.mp3\n|Copyright=CC\n}}\n"}}}"#;

    const IMAGEINFO_JSON: &str = r#"{
      "query": {
        "normalized": [{"from": "File:PMLP02312-x.pdf", "to": "File:PMLP02312-x.pdf"}],
        "pages": {
          "177110": {
            "pageid": 177110, "ns": 6,
            "title": "File:PMLP02312-Chopin Nocturnes Op 9 Kistner 995 First Edition 1832.pdf",
            "imageinfo": [{
              "size": 1964066, "width": 10000, "height": 10000,
              "url": "//imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf",
              "descriptionurl": "http://imslp.org/wiki/File:PMLP02312-x.pdf",
              "sha1": "a880c862248569409532d6f60abf0ba5b7f5cc7b",
              "mime": "application/pdf"
            }]
          }
        }
      }
    }"#;

    const IMAGEINFO_MISSING_JSON: &str = r#"{
      "query": { "pages": { "-1": { "ns": 6, "title": "File:Nope.pdf", "missing": "" } } }
    }"#;

    // ---- search ----

    #[test]
    fn parse_search_extracts_hits_and_flags_redirects() {
        let hits = parse_search(SEARCH_JSON).expect("search parses");
        assert_eq!(hits.len(), 3);
        assert_eq!(
            hits[0].title,
            "Nocturne in E minor, Op.72 No.1 (Chopin, Frédéric)"
        );
        assert_eq!(hits[0].size, 9637);
        assert_eq!(hits[0].word_count, 1175);
        assert!(!hits[0].is_redirect);
        assert!(hits[2].is_redirect, "the #REDIRECT stub is flagged");
    }

    /// Guards the bug this fixture once hid: IMSLP sends no `pageid`, so every
    /// hit's `page_id` is 0 and CANNOT be used to tell two results apart. The
    /// picker must key on `title` — which this asserts is present and unique.
    #[test]
    fn parse_search_titles_are_the_only_usable_identity() {
        let hits = parse_search(SEARCH_JSON).expect("search parses");
        assert!(
            hits.iter().all(|h| h.page_id == 0),
            "IMSLP sends no pageid, so every page_id must be 0: {hits:?}"
        );
        let mut titles: Vec<&str> = hits.iter().map(|h| h.title.as_str()).collect();
        assert!(titles.iter().all(|t| !t.is_empty()), "a hit had no title");
        titles.sort_unstable();
        let unique = titles.len();
        titles.dedup();
        assert_eq!(titles.len(), unique, "titles must be unique per hit");
    }

    #[test]
    fn parse_search_still_reads_a_pageid_when_one_is_present() {
        let hits = parse_search(SEARCH_JSON_WITH_PAGEID).expect("search parses");
        assert_eq!(hits[0].page_id, 6789);
    }

    #[test]
    fn parse_search_empty_is_ok_not_error() {
        assert_eq!(parse_search(EMPTY_SEARCH_JSON).unwrap(), Vec::new());
    }

    #[test]
    fn parse_search_api_error_surfaces_info() {
        let err = parse_search(API_ERROR_JSON).unwrap_err();
        assert!(err.contains("Unrecognized value"), "got: {err}");
    }

    #[test]
    fn parse_search_malformed_json_is_honest_error() {
        assert!(parse_search("not json").is_err());
    }

    #[test]
    fn search_builds_encoded_endpoint_url() {
        let (http, urls) = FakeHttp::recording(EMPTY_SEARCH_JSON);
        let client = ImslpClient::with_http(Box::new(http));
        client.search("Chopin Nocturne").unwrap();
        let urls = urls.lock().unwrap();
        assert_eq!(urls.len(), 1);
        assert!(urls[0].starts_with("https://imslp.org/api.php?action=query&list=search"));
        assert!(urls[0].contains("srsearch=Chopin%20Nocturne"));
        assert!(urls[0].contains("srlimit=20"));
    }

    #[test]
    fn editions_and_file_url_build_expected_endpoints() {
        let (http, urls) = FakeHttp::recording(AUDIO_ONLY_WIKITEXT);
        let client = ImslpClient::with_http(Box::new(http));
        client
            .editions("Nocturnes, Op.9 (Chopin, Frédéric)")
            .unwrap();
        assert!(urls.lock().unwrap()[0].contains("action=parse&page=Nocturnes%2C%20Op.9"));

        let (http, urls) = FakeHttp::recording(IMAGEINFO_JSON);
        let client = ImslpClient::with_http(Box::new(http));
        client.file_url("PMLP02312-x.pdf").unwrap();
        let u = &urls.lock().unwrap()[0];
        assert!(u.contains("titles=File%3APMLP02312-x.pdf"));
        assert!(u.contains("prop=imageinfo"));
    }

    #[test]
    fn empty_query_short_circuits_without_network() {
        // A fake that would panic if called proves no request is made.
        struct Never;
        impl HttpGet for Never {
            fn get(&self, _: &str) -> Result<String, String> {
                panic!("no request should be made for an empty query");
            }
        }
        let client = ImslpClient::with_http(Box::new(Never));
        assert_eq!(client.search("   ").unwrap(), Vec::new());
    }

    // ---- editions ----

    #[test]
    fn parse_editions_multi_edition_with_missing_fields() {
        let eds = parse_editions(WORK_WIKITEXT).expect("editions parse");
        assert_eq!(eds.len(), 2, "two imslpfile editions, audio ignored");

        assert_eq!(
            eds[0].file_name,
            "PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf"
        );
        assert_eq!(eds[0].description, "Complete Score");
        assert_eq!(eds[0].editor, "{{FE}} (German)");
        assert_eq!(eds[0].copyright, "Public Domain");
        assert_eq!(eds[0].image_type, "Normal Scan");
        assert!(
            eds[0].publisher.contains("Kistner"),
            "publisher keeps its nested template pipes: {}",
            eds[0].publisher
        );

        // Second edition is missing editor / image type / publisher → empty, not a crash.
        assert_eq!(eds[1].file_name, "PMLP02312-Chopin_Nocturnes_Peters.pdf");
        assert_eq!(eds[1].description, "Complete Score");
        assert_eq!(eds[1].editor, "");
        assert_eq!(eds[1].publisher, "");
        assert_eq!(eds[1].image_type, "");
        assert_eq!(eds[1].copyright, "Public Domain");
    }

    #[test]
    fn parse_editions_audio_only_is_empty_not_error() {
        assert_eq!(parse_editions(AUDIO_ONLY_WIKITEXT).unwrap(), Vec::new());
    }

    #[test]
    fn parse_editions_malformed_wikitext_is_honest_error() {
        let err = parse_editions(MALFORMED_WIKITEXT).unwrap_err();
        assert!(err.contains("malformed"), "got: {err}");
    }

    #[test]
    fn parse_editions_missing_wikitext_field_is_error() {
        assert!(parse_editions(r#"{"parse": {"title": "x"}}"#).is_err());
    }

    #[test]
    fn parse_editions_api_error_surfaces() {
        assert!(parse_editions(API_ERROR_JSON).is_err());
    }

    // ---- file_url / imageinfo ----

    #[test]
    fn parse_file_info_resolves_url_size_mime() {
        let info = parse_file_info(IMAGEINFO_JSON).expect("imageinfo parses");
        assert_eq!(
            info.url,
            "https://imslp.org/images/9/91/PMLP02312-Chopin_Nocturnes_Op_9_Kistner_995_First_Edition_1832.pdf"
        );
        assert_eq!(info.size, 1964066);
        assert_eq!(info.mime, "application/pdf");
    }

    #[test]
    fn parse_file_info_missing_file_is_honest_error() {
        let err = parse_file_info(IMAGEINFO_MISSING_JSON).unwrap_err();
        assert!(err.to_lowercase().contains("renamed") || err.to_lowercase().contains("no longer"));
    }

    #[test]
    fn parse_file_info_malformed_json_is_error() {
        assert!(parse_file_info("<html>bot check</html>").is_err());
    }

    #[test]
    fn absolute_url_upgrades_protocol_relative() {
        assert_eq!(
            absolute_url("//imslp.org/images/x.pdf"),
            "https://imslp.org/images/x.pdf"
        );
        assert_eq!(absolute_url("https://imslp.org/x"), "https://imslp.org/x");
    }

    // ---- field parser edge cases ----

    #[test]
    fn parse_fields_handles_inline_template_pipes() {
        let fields = parse_fields(
            "\n|Publisher Information={{P|Kistner|Leipzig|1832}}\n|Copyright=Public Domain\n",
        );
        let pub_field = fields
            .iter()
            .find(|(k, _)| k == "Publisher Information")
            .unwrap();
        assert_eq!(pub_field.1, "{{P|Kistner|Leipzig|1832}}");
        let cr = fields.iter().find(|(k, _)| k == "Copyright").unwrap();
        assert_eq!(cr.1, "Public Domain");
    }

    // ---- one #[ignore]d live smoke test (no network in normal runs) ----

    /// NOTE: **This is the ONLY real coverage of the live IMSLP API.** Every
    /// other test in this module runs against `FakeHttp` fixtures, so the suite
    /// stays green even if IMSLP changes its response shape, blocks our
    /// User-Agent, or moves the endpoint entirely. It stays `#[ignore]`d so an
    /// offline run passes, but if you touch the request builders or the
    /// parsers, run it:
    ///
    /// ```text
    /// cargo test --lib live_search_smoke -- --ignored --nocapture
    /// ```
    ///
    /// It asserts on the *contents* of the response, not merely that no error
    /// occurred — a silently-empty or field-less result must fail here.
    #[test]
    #[ignore = "hits the live IMSLP API; run explicitly with --ignored"]
    fn live_search_smoke() {
        let client = ImslpClient::new();
        let hits = client.search("chopin scherzo").expect("live search");
        assert!(!hits.is_empty(), "expected live results for a common query");

        // Every hit must carry the fields the picker actually renders. NOTE we
        // deliberately do NOT assert on page_id: IMSLP sends no `pageid`, so it
        // is always 0 — the title is the identity (see `WorkHit::page_id`).
        for hit in &hits {
            assert!(!hit.title.is_empty(), "hit has an empty title: {hit:?}");
        }
        let mut titles: Vec<&str> = hits.iter().map(|h| h.title.as_str()).collect();
        titles.sort_unstable();
        let before = titles.len();
        titles.dedup();
        assert_eq!(
            titles.len(),
            before,
            "live hits must have unique titles — they are the picker's React key"
        );

        // The query is specific enough that a working full-text index has to
        // return the Chopin scherzi. If this fails, IMSLP's search changed.
        let non_redirects: Vec<_> = hits.iter().filter(|h| !h.is_redirect).collect();
        assert!(
            !non_redirects.is_empty(),
            "every live hit was a #REDIRECT stub: {hits:?}"
        );
        assert!(
            non_redirects
                .iter()
                .any(|h| h.title.to_lowercase().contains("scherzo")),
            "no live hit mentioned 'scherzo': {:?}",
            non_redirects.iter().map(|h| &h.title).collect::<Vec<_>>()
        );

        // A real work page must be reachable from a hit, and yield real editions
        // with non-empty file names — this is the path the picker takes next.
        let work = non_redirects
            .iter()
            .find(|h| h.title.to_lowercase().contains("scherzo"))
            .expect("a scherzo hit");
        let editions = client.editions(&work.title).expect("live editions");
        assert!(
            !editions.is_empty(),
            "no editions parsed from the live work page {:?}",
            work.title
        );
        assert!(
            editions.iter().all(|e| !e.file_name.is_empty()),
            "an edition came back with no file name: {editions:?}"
        );
    }
}
