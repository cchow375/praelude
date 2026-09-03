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
//! QUEUEING CONTRACT (see [`RequestQueue`]): the ≥1s spacing between live
//! requests is enforced by *reserving* a start time under a briefly-held mutex
//! and then sleeping outside it — never by sleeping while holding the lock. A
//! sleeping lock turned every queued search into a serialized one-per-second
//! drain that the newest query had to wait out; with reservations a waiter
//! learns its own deadline immediately, and a search superseded by a later one
//! abandons its slot instead of spending a round trip nobody is waiting for.
//!
//! Testability: all network egress goes through the [`HttpGet`] seam, so the
//! JSON/wikitext parsers are exercised against canned fixtures with no live
//! network (mirroring the brain module's `Transport` trait). Exactly one
//! `#[ignore]`d live smoke test hits the real API.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

/// The one IMSLP MediaWiki API endpoint. Every call is a GET against this.
const API_ENDPOINT: &str = "https://imslp.org/api.php";

/// Descriptive User-Agent per IMSLP etiquette (§5 of the research notes).
const USER_AGENT: &str = "Praelude/10.0 personal practice app";

/// Minimum spacing between live requests. The research notes observed a
/// `Crawl-delay: 2` in robots.txt; the spec floor is ≥1s. We adopt 1s as the
/// hard rate guard (the app also debounces search-as-you-type on the frontend).
const MIN_REQUEST_SPACING: Duration = Duration::from_secs(1);

/// Per-request network timeout. Honest failure over an indefinite hang.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// The exact error a search returns when a NEWER search replaced it while it was
/// still waiting for its rate-guard slot. It is a control signal, not a failure:
/// the frontend swallows it (the newer search owns the panel), so it must stay
/// byte-identical to `SEARCH_SUPERSEDED` in `src/features/pieces/imslpText.ts`.
pub const SEARCH_SUPERSEDED: &str = "IMSLP search superseded by a newer query.";

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

    /// GET a *search* URL, which the transport may abandon with
    /// [`SEARCH_SUPERSEDED`] if a later search starts while this one is still
    /// queued behind the rate guard. Search-as-you-type is the one caller whose
    /// older requests are worthless the instant a newer one exists, so it is the
    /// one caller allowed to be dropped.
    ///
    /// Default: no supersession at all — a transport with no request queue (every
    /// test fake) behaves exactly like [`HttpGet::get`], which keeps fixture-driven
    /// tests deterministic even when they run in parallel.
    fn get_search(&self, url: &str) -> Result<String, String> {
        self.get(url)
    }
}

/// The live-request queue: IMSLP etiquette (≥ [`MIN_REQUEST_SPACING`] between
/// requests) plus the notion of a search being superseded.
///
/// The mutex protects one value — the earliest [`Instant`] the *next* request may
/// start — and is held only long enough to read-and-bump it. Callers then sleep
/// on their own reserved deadline with no lock held. The previous design slept
/// *inside* the lock, so a second caller blocked in `lock()` and a third blocked
/// behind that: an invisible, un-cancellable queue that grew one second per
/// waiter and put the newest search dead last.
#[derive(Debug, Default)]
struct RequestQueue {
    /// Earliest start time for the next request; `None` before the first one.
    next_slot: Mutex<Option<Instant>>,
    /// Monotonic counter — the highest value ever handed out is the newest search.
    search_epoch: AtomicU64,
}

impl RequestQueue {
    /// Take the next start time out of the queue, bumping it by
    /// [`MIN_REQUEST_SPACING`] for whoever asks next. Returns immediately; the
    /// caller does the waiting.
    fn reserve_slot(&self) -> Instant {
        let now = Instant::now();
        let mut next = self.next_slot.lock().expect("imslp rate-guard lock");
        let start_at = match *next {
            Some(at) if at > now => at,
            _ => now,
        };
        *next = Some(start_at + MIN_REQUEST_SPACING);
        start_at
    }

    /// Reserve a slot and sleep until it arrives — never holding the lock while
    /// asleep (see the struct docs).
    fn await_slot(&self) {
        let start_at = self.reserve_slot();
        let wait = start_at.saturating_duration_since(Instant::now());
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
    }

    /// Claim this search's epoch. Every later claim supersedes it.
    fn claim_search(&self) -> u64 {
        self.search_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether `epoch` is still the newest search claimed on this queue.
    fn is_newest_search(&self, epoch: u64) -> bool {
        self.search_epoch.load(Ordering::SeqCst) == epoch
    }
}

/// Production [`HttpGet`]: a blocking reqwest client with a descriptive
/// User-Agent, a bounded timeout, and the shared [`RequestQueue`] that keeps every
/// live request ≥ [`MIN_REQUEST_SPACING`] apart.
pub struct NativeHttp {
    client: reqwest::blocking::Client,
    queue: RequestQueue,
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
            queue: RequestQueue::default(),
        }
    }

    /// The actual round trip, with no queueing — callers wait for their slot first.
    fn send(&self, url: &str) -> Result<String, String> {
        let response = self.client.get(url).send().map_err(|_| {
            "Could not reach IMSLP. Check your connection and try again.".to_string()
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("IMSLP returned an unexpected status ({status})."));
        }
        response
            .text()
            .map_err(|_| "IMSLP sent a response Praelude could not read.".to_string())
    }
}

impl Default for NativeHttp {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpGet for NativeHttp {
    fn get(&self, url: &str) -> Result<String, String> {
        self.queue.await_slot();
        self.send(url)
    }

    fn get_search(&self, url: &str) -> Result<String, String> {
        let epoch = self.queue.claim_search();
        self.queue.await_slot();
        // Re-check on the way out of the queue: if the user has typed on, this
        // request's results are already stale, so spend neither the round trip
        // nor the caller's attention on them.
        if !self.queue.is_newest_search(epoch) {
            return Err(SEARCH_SUPERSEDED.to_string());
        }
        self.send(url)
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
    /// Empty results are `Ok(vec![])`, not an error; a search that a newer search
    /// superseded while it was queued is `Err(`[`SEARCH_SUPERSEDED`]`)`.
    ///
    /// The returned list is what the picker should *show*: see [`usable_hits`].
    pub fn search(&self, query: &str) -> Result<Vec<WorkHit>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "{API_ENDPOINT}?action=query&list=search&srsearch={}&format=json&srlimit=20",
            percent_encode(trimmed)
        );
        let body = self.http.get_search(&url)?;
        Ok(usable_hits(parse_search(&body)?))
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
        .map_err(|_| "IMSLP sent a search response Praelude could not parse.".to_string())?;
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

/// Reduce a raw hit list to the rows the picker should show.
///
/// Two things happen, both of which the UI depends on and neither of which the
/// API guarantees:
///
/// 1. **Unique titles.** A hit's identity IS its title (IMSLP sends no `pageid`,
///    so `page_id` is always 0 — see [`WorkHit::page_id`]). The picker keys its
///    React list on the title and marks the selected row by comparing titles, so
///    two rows sharing a title would mean a duplicate key *and* one click
///    pressing both rows. Titles are unique per wiki page and no duplicate has
///    ever been observed live, so this enforces the invariant rather than
///    trusting the response to hold it. First occurrence wins (best-ranked).
/// 2. **No `#REDIRECT` stubs.** Live `chopin scherzo` returns 12 hits, 8 of them
///    54-byte redirect stubs (`Scherzo No.1 (Chopin, Frederic)` →
///    `Scherzo No.1, Op.20 (Chopin, Frédéric)`) whose targets are already in the
///    list — two thirds of the panel was junk. They are dropped ONLY when a real
///    hit survives: if every hit is a redirect, showing them beats showing
///    nothing, since `action=parse` resolves a redirect title transparently.
fn usable_hits(hits: Vec<WorkHit>) -> Vec<WorkHit> {
    let mut seen: HashSet<String> = HashSet::with_capacity(hits.len());
    let mut unique: Vec<WorkHit> = Vec::with_capacity(hits.len());
    for hit in hits {
        if seen.insert(hit.title.clone()) {
            unique.push(hit);
        }
    }
    if unique.iter().any(|hit| !hit.is_redirect) {
        unique.retain(|hit| !hit.is_redirect);
    }
    unique
}

/// Parse an `action=parse&prop=wikitext` JSON response into [`Edition`]s.
fn parse_editions(body: &str) -> Result<Vec<Edition>, String> {
    let root: Value = serde_json::from_str(body)
        .map_err(|_| "IMSLP sent a work page Praelude could not parse.".to_string())?;
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
        .map_err(|_| "IMSLP sent a file record Praelude could not parse.".to_string())?;
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

    /// A hand-written 3-item sample in the SHAPE of an IMSLP `list=search`
    /// response. It is not a capture: the items are Nocturne pages with
    /// shortened snippets and reformatted whitespace, not the live
    /// `chopin scherzo` hits (for those, see [`LIVE_SEARCH_JSON`]).
    ///
    /// What IS faithful — and the only thing the tests below rest on — is the
    /// per-item field set observed live on 2026-07-30:
    /// `ns/title/snippet/size/wordcount/timestamp` and **no `pageid`**. This
    /// fixture used to invent `"pageid": 12345`, which kept the suite green
    /// while the real UI keyed its result list on an always-0 id (duplicate
    /// React keys; selecting one work highlighted every row). Keep the absent
    /// `pageid`.
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

    /// A verbatim slice of the live response, captured 2026-07-30 from
    /// `api.php?action=query&list=search&srsearch=chopin%20scherzo&srlimit=20&format=json`
    /// (HTTP 200 in 0.23s). Items 1, 5 and 9 of the 12 that came back, copied
    /// byte for byte — including the single-quoted `class='searchmatch'`
    /// highlight markup, the trailing `\n` in each snippet, and the absent
    /// `pageid`.
    ///
    /// It is here for one reason: 8 of those 12 live hits were 54-byte
    /// `#REDIRECT` stubs pointing at other hits in the same list. This is the
    /// junk [`usable_hits`] filters, in the exact form IMSLP sends it.
    const LIVE_SEARCH_JSON: &str = r##"{
      "batchcomplete": "",
      "query": {
        "search": [
          {
            "ns": 0,
            "title": "Scherzo No.1, Op.20 (Chopin, Frédéric)",
            "snippet": "|File Name 1=PMLP02354-<span class='searchmatch'>Chopin</span>-Scherzo_No.1_in_B_minor.mp3\n|File Name 2=PMLP02354-<span class='searchmatch'>Scherzo</span>,_op._20_-_Chopin.pdf\n",
            "size": 13016,
            "wordcount": 1528,
            "timestamp": "2026-06-09T22:37:04Z"
          },
          {
            "ns": 0,
            "title": "Scherzo No.1 (Chopin, Frederic)",
            "snippet": "#REDIRECT [[<span class='searchmatch'>Scherzo</span> No.1, Op.20 (<span class='searchmatch'>Chopin</span>, Frédéric)]]\n",
            "size": 54,
            "wordcount": 8,
            "timestamp": "2011-08-14T14:39:05Z"
          },
          {
            "ns": 0,
            "title": "Scherzo No.1, Op.20 (Chopin, Frederic)",
            "snippet": "#REDIRECT [[<span class='searchmatch'>Scherzo</span> No.1, Op.20 (<span class='searchmatch'>Chopin</span>, Frédéric)]]\n",
            "size": 54,
            "wordcount": 8,
            "timestamp": "2010-08-21T02:40:40Z"
          }
        ]
      }
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

    /// The picker's identity invariant, enforced in code rather than assumed:
    /// whatever the API sends, [`ImslpClient::search`] hands back rows whose
    /// titles are unique. A duplicate would be a duplicate React key AND a click
    /// that presses two rows at once.
    #[test]
    fn search_collapses_duplicate_titles_to_one_row() {
        const DUPLICATE_TITLES_JSON: &str = r##"{
          "query": { "search": [
            { "ns": 0, "title": "Nocturnes, Op.9 (Chopin, Frédéric)",
              "snippet": "first", "size": 42942, "wordcount": 3000 },
            { "ns": 0, "title": "Nocturnes, Op.9 (Chopin, Frédéric)",
              "snippet": "a second row with the same title", "size": 42942, "wordcount": 3000 },
            { "ns": 0, "title": "Nocturnes, Op.15 (Chopin, Frédéric)",
              "snippet": "other", "size": 100, "wordcount": 10 }
          ] }
        }"##;
        // The parser stays faithful — it reports what the API actually sent…
        assert_eq!(parse_search(DUPLICATE_TITLES_JSON).unwrap().len(), 3);

        // …and `search` is where the UI's invariant is enforced.
        let (http, _urls) = FakeHttp::recording(DUPLICATE_TITLES_JSON);
        let hits = ImslpClient::with_http(Box::new(http))
            .search("chopin")
            .unwrap();
        assert_eq!(hits.len(), 2, "the duplicate title collapsed: {hits:?}");
        assert_eq!(hits[0].snippet, "first", "first occurrence wins");
        let mut titles: Vec<&str> = hits.iter().map(|h| h.title.as_str()).collect();
        titles.sort_unstable();
        let before = titles.len();
        titles.dedup();
        assert_eq!(titles.len(), before, "search returned a duplicate title");
    }

    /// Two thirds of the live `chopin scherzo` list is `#REDIRECT` junk whose
    /// targets are already in the list. The parser still reports it; `search`
    /// drops it.
    #[test]
    fn search_drops_redirect_stubs_from_the_live_response() {
        assert_eq!(
            parse_search(LIVE_SEARCH_JSON).unwrap().len(),
            3,
            "the parser reports every hit IMSLP sent"
        );

        let (http, _urls) = FakeHttp::recording(LIVE_SEARCH_JSON);
        let hits = ImslpClient::with_http(Box::new(http))
            .search("chopin scherzo")
            .unwrap();
        assert_eq!(hits.len(), 1, "only the real work survives: {hits:?}");
        assert_eq!(hits[0].title, "Scherzo No.1, Op.20 (Chopin, Frédéric)");
        assert!(hits.iter().all(|h| !h.is_redirect));
    }

    /// …but never filter the list down to nothing: a redirect title still
    /// resolves through `action=parse`, so showing it beats showing "no matches".
    #[test]
    fn usable_hits_keeps_redirects_when_they_are_all_there_is() {
        let all_redirects = vec![
            WorkHit {
                title: "Scherzo No.1 (Chopin, Frederic)".into(),
                page_id: 0,
                snippet: "#REDIRECT [[Scherzo No.1, Op.20]]".into(),
                size: 54,
                word_count: 8,
                is_redirect: true,
            },
            WorkHit {
                title: "Scherzo No.2 (Chopin, Frederic)".into(),
                page_id: 0,
                snippet: "#REDIRECT [[Scherzo No.2, Op.31]]".into(),
                size: 54,
                word_count: 8,
                is_redirect: true,
            },
        ];
        assert_eq!(usable_hits(all_redirects.clone()), all_redirects);
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

    // ---- request queue: rate guard + search supersession ----

    /// THE lag regression. The old rate guard slept while HOLDING its mutex, so
    /// the Nth concurrent request could not even find out when it was allowed to
    /// run until N-1 seconds had passed — a hidden serial queue that put the
    /// query the user actually typed last in line (14 queued searches ⇒ ≥13s
    /// before the newest one started).
    ///
    /// With reservations, every waiter learns its own deadline immediately. Four
    /// threads must all be told their start time in well under one spacing
    /// interval, and those start times must still honour the ≥1s etiquette.
    #[test]
    fn slots_are_reserved_without_ever_holding_the_lock_while_waiting() {
        let queue = Arc::new(RequestQueue::default());
        let started = Instant::now();

        let mut handles = Vec::new();
        for _ in 0..4 {
            let queue = Arc::clone(&queue);
            handles.push(std::thread::spawn(move || queue.reserve_slot()));
        }
        let mut slots: Vec<Instant> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let elapsed = started.elapsed();

        assert!(
            elapsed < MIN_REQUEST_SPACING / 2,
            "reserving 4 slots took {elapsed:?}; the old sleep-under-lock guard took ~3s"
        );
        slots.sort_unstable();
        for pair in slots.windows(2) {
            assert!(
                pair[1].duration_since(pair[0]) >= MIN_REQUEST_SPACING,
                "IMSLP etiquette broken: two slots only {:?} apart",
                pair[1].duration_since(pair[0])
            );
        }
    }

    #[test]
    fn a_later_search_supersedes_an_earlier_one() {
        let queue = RequestQueue::default();
        let first = queue.claim_search();
        assert!(queue.is_newest_search(first), "nothing has replaced it yet");

        let second = queue.claim_search();
        assert!(!queue.is_newest_search(first), "the newer search wins");
        assert!(queue.is_newest_search(second));
    }

    /// The whole point, end to end: a search still WAITING for its rate-guard
    /// slot when the user types on must abandon itself rather than spend the
    /// round trip. Deterministic — the waiter is provably still asleep when the
    /// newer search is claimed.
    #[test]
    fn a_search_queued_behind_the_rate_guard_abandons_itself_when_superseded() {
        let queue = Arc::new(RequestQueue::default());
        queue.await_slot(); // consume the free slot; the next one is ≥1s out

        let waiter = {
            let queue = Arc::clone(&queue);
            std::thread::spawn(move || {
                let epoch = queue.claim_search();
                queue.await_slot(); // parks for ~1s
                queue.is_newest_search(epoch)
            })
        };

        // Well inside the waiter's parked second: the user typed another letter.
        std::thread::sleep(Duration::from_millis(100));
        let newest = queue.claim_search();

        assert!(
            !waiter.join().unwrap(),
            "the queued search should have found itself superseded"
        );
        assert!(queue.is_newest_search(newest));
    }

    /// The superseded signal crosses the IPC boundary as a plain error string and
    /// the frontend matches it exactly, so it is a contract, not a message.
    /// Keep in lockstep with `SEARCH_SUPERSEDED` in
    /// `src/features/pieces/imslpText.ts`.
    #[test]
    fn superseded_error_string_is_the_frontend_contract() {
        assert_eq!(
            SEARCH_SUPERSEDED,
            "IMSLP search superseded by a newer query."
        );
    }

    /// A transport with no queue (every test fake) never supersedes, so fixture
    /// tests stay deterministic however the harness schedules them.
    #[test]
    fn fake_transports_never_supersede_a_search() {
        let (http, urls) = FakeHttp::recording(EMPTY_SEARCH_JSON);
        assert!(http.get_search("https://example.invalid/x").is_ok());
        assert!(http.get_search("https://example.invalid/y").is_ok());
        assert_eq!(urls.lock().unwrap().len(), 2);
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

        // `usable_hits` must have stripped the redirect stubs. Live
        // `chopin scherzo` returns 12 hits of which 8 are 54-byte `#REDIRECT`
        // pages; every one of them has to be gone by the time the picker sees
        // the list (with the all-redirects fallback the only exception, which a
        // query this ordinary can never hit).
        assert!(
            hits.iter().all(|h| !h.is_redirect),
            "a #REDIRECT stub reached the picker: {:?}",
            hits.iter()
                .filter(|h| h.is_redirect)
                .map(|h| &h.title)
                .collect::<Vec<_>>()
        );

        // The query is specific enough that a working full-text index has to
        // return the Chopin scherzi. If this fails, IMSLP's search changed.
        assert!(
            hits.iter()
                .any(|h| h.title.to_lowercase().contains("scherzo")),
            "no live hit mentioned 'scherzo': {:?}",
            hits.iter().map(|h| &h.title).collect::<Vec<_>>()
        );

        // A real work page must be reachable from a hit, and yield real editions
        // with non-empty file names — this is the path the picker takes next.
        let work = hits
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
