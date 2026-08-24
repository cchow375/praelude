//! Grounded, bounded practice Q&A.
//!
//! The brain is deliberately outside CodaKiller's deterministic hot loop. It
//! can explain retrieved practice methods, but it cannot hear playing, assign a
//! rep verdict, change tempo, navigate the score, or mutate the practice graph.

mod context;
mod corpus;
mod library;
mod provider;
mod score_context;
mod tool_exec;
mod tools;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::sessions::SessionService;
use crate::store::model::{PieceFieldPatch, RepSnapshot};
use crate::store::Store;

pub use context::{GroundingSummary, KnowledgeShareCause};
pub use corpus::{BookExcerpt, BookKind, BookListing};
pub use library::{Citation, MethodCard};
use library::{EmbeddedLibrary, PracticeLibrary};
use provider::{ProviderOutput, SuggestionDraft};
pub use tool_exec::ToolProvenance;
// Re-exported crate-wide (not just within `brain`): `score::measure_scan`
// (Plan C, C2) drives the same Claude-primary/Gemini-fallback vision chain
// through `ProviderChain::vision_texts`, so it needs these names too.
#[cfg(test)]
pub(crate) use provider::{FakeTransport, HttpResponse, ProviderConfig, ProviderPreference};
pub(crate) use provider::{NativeTransport, ProviderChain, ProviderName, Transport};
pub use score_context::XmlMeasureFacts;

const MAX_QUESTION_CHARS: usize = 8_000;
const MAX_HISTORY_TURNS: usize = 10;
const MAX_HISTORY_TURN_CHARS: usize = 8_000;
const MAX_HISTORY_CHARS: usize = 24_000;
const DEFAULT_KNOWLEDGE_DIR: &str =
    "/Users/c3/Desktop/christian's universe/Piano Practice/Knowledge and Resources";
const INTAKE_REVIEW_TTL: Duration = Duration::from_secs(15 * 60);
static ANSWER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionSource {
    Typed,
    Voice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct ConversationTurn {
    pub role: ConversationRole,
    pub content: String,
}

/// Client-visible score context. Only IDs and display-location facts are
/// deserialized; all extra display/active-block fields are ignored by Serde.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClientBrainRegion {
    pub id: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClientBrainContext {
    pub piece_id: i64,
    #[serde(default)]
    pub surface: Option<String>,
    #[serde(default)]
    pub region: Option<ClientBrainRegion>,
    #[serde(default)]
    pub current_page: Option<u32>,
    #[serde(default)]
    pub edition_id: Option<String>,
    #[serde(default)]
    pub edition_label: Option<String>,
    /// Date-scoped plain-English intention from Today's visible plan box. It is
    /// context only; the provider cannot mutate it through this request.
    #[serde(default)]
    pub today_plan: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrainAskRequest {
    pub question: String,
    pub source: QuestionSource,
    #[serde(default)]
    pub history: Vec<ConversationTurn>,
    #[serde(default)]
    pub context: Option<ClientBrainContext>,
    // Durable per-piece conversation memory. When present, the successful
    // question + answer are appended to this thread after the answer is built.
    // The brain never resolves or mutates practice state through this id.
    #[serde(default)]
    pub thread_id: Option<i64>,
    // Legacy/diagnostic shape retained so existing callers and Rust tests do
    // not have to fabricate client display context.
    #[serde(default)]
    pub piece_id: Option<i64>,
    #[serde(default)]
    pub region_id: Option<i64>,
    #[serde(default)]
    pub measure_start: Option<u32>,
    #[serde(default)]
    pub measure_end: Option<u32>,
}

impl BrainAskRequest {
    fn selected_piece_id(&self) -> Option<i64> {
        self.context
            .as_ref()
            .map(|context| context.piece_id)
            .or(self.piece_id)
    }

    fn selected_region_id(&self) -> Option<i64> {
        self.context
            .as_ref()
            .and_then(|context| context.region.as_ref().map(|region| region.id))
            .or(self.region_id)
    }

    fn explicit_measure_range(&self) -> Result<Option<(u32, u32)>, BrainError> {
        match (self.measure_start, self.measure_end) {
            (None, None) => Ok(None),
            (Some(start), Some(end)) if start <= end => Ok(Some((start, end))),
            _ => Err(BrainError::InvalidQuestion(
                "Measure context needs both a valid start and end".into(),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntakeReviewField {
    pub field: String,
    pub label: String,
    pub current: String,
    pub proposed: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntakeReview {
    pub piece_id: i64,
    pub piece_title: String,
    pub summary: String,
    pub fields: Vec<IntakeReviewField>,
}

// `BrainAnswer` no longer derives `Eq`: a `proposed_action` may carry a float
// tempo. Equality is still available via `PartialEq` where tests need it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BrainAnswer {
    pub id: String,
    pub answer: String,
    pub provider: ProviderName,
    pub citations: Vec<Citation>,
    pub methods: Vec<MethodCard>,
    pub intake_review: Option<IntakeReview>,
    pub grounding: GroundingSummary,
    // A confirm-gated action the Brain proposes for a *spoken* practice request.
    // Never populated for typed questions, and only when the provider returned a
    // well-formed, in-bounds action object. Nothing mutates until the user
    // explicitly confirms it in the frontend.
    pub proposed_action: Option<ProposedAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProposedVerdict {
    Clean,
    Flawed,
    Failed,
}

/// The closed set of confirm-gated actions a spoken practice request may
/// propose. Serialized to the frontend, which shows a slim confirm card and
/// maps each variant to the existing backend command only on explicit confirm.
/// The provider is never trusted: `provider::ProposedActionInput::validate`
/// checks every field and drops anything malformed or out of range.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposedActionBody {
    Verdict {
        verdict: ProposedVerdict,
        note: Option<String>,
    },
    Tempo {
        bpm: f64,
    },
    Undo,
    Restart {
        required_clean_streak: Option<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProposedAction {
    /// Human-readable line the card shows. Generated deterministically from the
    /// validated body — never provider free text — so the card cannot be a
    /// vector for injected copy.
    pub summary: String,
    #[serde(flatten)]
    pub body: ProposedActionBody,
}

impl ProposedAction {
    pub fn new(body: ProposedActionBody) -> Self {
        let summary = match &body {
            ProposedActionBody::Verdict { verdict, .. } => match verdict {
                ProposedVerdict::Clean => "Record this attempt as clean".to_string(),
                ProposedVerdict::Flawed => "Record this attempt as flawed".to_string(),
                ProposedVerdict::Failed => "Record this attempt as failed".to_string(),
            },
            ProposedActionBody::Tempo { bpm } => {
                format!("Set the metronome to {}", format_bpm(*bpm))
            }
            ProposedActionBody::Undo => "Undo the last rep".to_string(),
            ProposedActionBody::Restart {
                required_clean_streak,
            } => match required_clean_streak {
                Some(streak) => format!("Restart the streak ({streak} clean in a row)"),
                None => "Restart the streak".to_string(),
            },
        };
        Self { summary, body }
    }
}

fn format_bpm(bpm: f64) -> String {
    if bpm.fract().abs() < f64::EPSILON {
        format!("{}", bpm as i64)
    } else {
        format!("{bpm:.1}")
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct IntakeChange {
    pub field: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrainIntakeApplyRequest {
    pub answer_id: String,
    pub piece_id: i64,
    pub changes: Vec<IntakeChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrainIntakeApplyResult {
    pub piece_id: i64,
    pub saved_at: String,
}

#[derive(Debug)]
struct PendingIntakeReview {
    piece_id: i64,
    allowed_fields: HashSet<String>,
    expires_at: Instant,
}

/// Process-local authorization ledger for explicit intake review saves.
/// Reviews are one-time, expire quickly, and are bound to the answer, piece,
/// and exact fields the deterministic parser actually proposed.
#[derive(Debug)]
pub struct PendingIntakeReviews {
    entries: Mutex<HashMap<String, PendingIntakeReview>>,
    ttl: Duration,
}

impl Default for PendingIntakeReviews {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl: INTAKE_REVIEW_TTL,
        }
    }
}

impl PendingIntakeReviews {
    pub fn register_answer(&self, answer: &BrainAnswer) {
        let Some(review) = &answer.intake_review else {
            return;
        };
        let allowed_fields = review
            .fields
            .iter()
            .map(|field| field.field.clone())
            .collect();
        let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        entries.retain(|_, pending| pending.expires_at > now);
        entries.insert(
            answer.id.clone(),
            PendingIntakeReview {
                piece_id: review.piece_id,
                allowed_fields,
                expires_at: now + self.ttl,
            },
        );
    }

    #[cfg(test)]
    fn with_ttl(ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl,
        }
    }
}

/// Why the provider chain ended up offline. Carried by
/// `BrainError::ProviderUnavailable` so the UI can show a truthful reason
/// instead of a swallowed `eprintln!`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfflineCause {
    /// No provider was configured, or none was ever attempted.
    NoProvider,
    /// A configured provider's transport failed (network unreachable).
    Transport,
    /// A configured provider returned a non-2xx HTTP status.
    HttpStatus(u16),
    /// A configured provider returned a 2xx body we could not use.
    BadResponse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrainError {
    InvalidQuestion(String),
    Context(String),
    ProviderUnavailable(OfflineCause),
    ProviderResponse,
    PolicyViolation,
}

impl BrainError {
    /// A short, truthful, human-readable cause the frontend can surface.
    /// Never contains a secret; the HTTP variant carries only the status code.
    pub fn reason(&self) -> String {
        match self {
            Self::ProviderUnavailable(cause) => match cause {
                OfflineCause::NoProvider => "no key configured".to_string(),
                OfflineCause::Transport => "key present but network unreachable".to_string(),
                OfflineCause::HttpStatus(status) => format!("provider error: HTTP {status}"),
                OfflineCause::BadResponse => "provider returned an unusable response".to_string(),
            },
            Self::ProviderResponse => "provider returned an unusable response".to_string(),
            Self::InvalidQuestion(message) | Self::Context(message) => message.clone(),
            Self::PolicyViolation => "the brain response crossed a safety boundary".to_string(),
        }
    }
}

impl std::fmt::Display for BrainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidQuestion(message) => write!(f, "{message}"),
            Self::Context(message) => write!(f, "{message}"),
            Self::ProviderUnavailable(_) => {
                write!(f, "No brain provider is configured or available")
            }
            Self::ProviderResponse => write!(f, "The brain provider returned an invalid response"),
            Self::PolicyViolation => write!(f, "The brain response crossed a safety boundary"),
        }
    }
}

impl std::error::Error for BrainError {}

/// Passage-helper request (spec C4). The pianist names a piece and describes the
/// passage; an optional selected region scopes the MusicXML facts. `expand_of`
/// switches to expand mode: one selected suggestion in, one fuller version out.
#[derive(Debug, Clone, Deserialize)]
pub struct AssistantSuggestRequest {
    pub piece_id: i64,
    pub description: String,
    #[serde(default)]
    pub region_id: Option<i64>,
    #[serde(default)]
    pub expand_of: Option<String>,
}

/// One passage-helper strategy row. The three source fields are all-or-nothing:
/// they are populated only when the provider cited a real corpus book that the
/// reader can open, joined against local retrieval. `source_id` is the book
/// manifest id; `source_author` labels the quiet marker; `source_heading` is a
/// verbatim book heading the reader uses as its `contains` locator — never a
/// fabricated page or a non-verbatim line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssistantSuggestion {
    pub id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_heading: Option<String>,
}

/// The reader-openable citation for one book, joined from local retrieval. Every
/// field is real book metadata, so the marker can honestly open the section.
#[derive(Debug, Clone)]
struct CitationMarker {
    book_id: String,
    author: String,
    heading: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssistantSuggestions {
    pub suggestions: Vec<AssistantSuggestion>,
}

/// The passage-helper caps the visible rows at four; the provider is already held
/// to the same ceiling, so this is defense in depth.
const MAX_ASSISTANT_SUGGESTIONS: usize = 4;

/// Production entry point for the passage-helper (C4). Reads and suggests only —
/// it has no practice-mutation authority and never enters the deterministic hot
/// loop. Offline / no key returns an honest `Err`, never a fabricated card.
pub fn assistant_suggest_native(
    request: AssistantSuggestRequest,
    store: Arc<Store>,
    sessions: Arc<SessionService>,
) -> Result<AssistantSuggestions, BrainError> {
    let library = EmbeddedLibrary::load();
    let preference = store.get_setting("brain.provider").ok().flatten();
    let chain = ProviderChain::from_native_config_with_preference(preference.as_deref());
    suggest_with(
        request,
        &store,
        &sessions,
        &library,
        &chain,
        &NativeTransport::new(),
    )
}

/// Unit-testable core of the passage-helper. Builds the same bounded, read-only
/// grounded context as `brain_ask` (the piece's MusicXML facts for the selected
/// passage plus corpus retrieval on the description), then asks the provider for
/// strategies — or, in expand mode, a fuller version of one strategy.
fn suggest_with(
    request: AssistantSuggestRequest,
    store: &Store,
    sessions: &SessionService,
    library: &dyn PracticeLibrary,
    chain: &ProviderChain,
    transport: &dyn Transport,
) -> Result<AssistantSuggestions, BrainError> {
    let description = request.description.trim();
    if description.is_empty() {
        return Err(BrainError::InvalidQuestion(
            "Describe the passage you are stuck on".into(),
        ));
    }
    if description.chars().count() > MAX_QUESTION_CHARS {
        return Err(BrainError::InvalidQuestion(format!(
            "Description is too long (maximum {MAX_QUESTION_CHARS} characters)"
        )));
    }
    // The passage-helper has no offline fallback: it must reach a provider or say
    // so honestly. This is the deliberate contrast with `brain_ask`.
    if chain.is_empty() {
        return Err(BrainError::ProviderUnavailable(OfflineCause::NoProvider));
    }

    let methods = library.retrieve(description, 3);
    let share_knowledge = store
        .get_setting("brain.share_retrieved_knowledge")
        .ok()
        .flatten()
        .as_deref()
        != Some("false");
    let directory = resolve_knowledge_dir(store);
    let corpus = corpus::search(&directory, description, 6);
    let (context, _grounding) = context::build(
        store,
        sessions,
        Some(request.piece_id),
        request.region_id,
        None,
        None,
        &methods,
        &corpus,
        share_knowledge,
        &[],
        None,
    )?;

    // Expand mode: rewrite one selected strategy into a single ≤3-line version.
    if let Some(expand_of) = request
        .expand_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let expanded = chain.expand(expand_of, &context, transport)?;
        if output_policy_violation_reason(&expanded).is_some() {
            return Err(BrainError::PolicyViolation);
        }
        return Ok(AssistantSuggestions {
            suggestions: vec![AssistantSuggestion {
                id: next_answer_id(),
                text: expanded,
                source_id: None,
                source_author: None,
                source_heading: None,
            }],
        });
    }

    let drafts = chain.suggest(description, &context, transport)?;

    // Source allowlist join, mirroring `brain_ask`'s citation discipline. A
    // provider may cite either a retrieval chunk id (what the context exposes) or
    // a book manifest id; either resolves to the same reader-openable marker. Only
    // corpus books produce a marker — they carry the manifest id, author, and a
    // verbatim heading the reader can open. Embedded method-card sources are not
    // reader books, so they never become a clickable marker; anything unknown is
    // dropped to an uncited row.
    let mut markers: HashMap<String, CitationMarker> = HashMap::new();
    if share_knowledge {
        for hit in &corpus.hits {
            let marker = CitationMarker {
                book_id: hit.source_id.clone(),
                author: hit.author.clone(),
                heading: hit.heading.clone(),
            };
            markers
                .entry(hit.id.clone())
                .or_insert_with(|| marker.clone());
            markers.entry(hit.source_id.clone()).or_insert(marker);
        }
    }

    let mut suggestions = Vec::new();
    for SuggestionDraft { text, source_id } in drafts.into_iter().take(MAX_ASSISTANT_SUGGESTIONS) {
        // The same output firewall as `brain_ask`: a strategy that claims a rep
        // verdict or app control fails the whole batch rather than reaching a card.
        if output_policy_violation_reason(&text).is_some() {
            return Err(BrainError::PolicyViolation);
        }
        let marker = source_id.and_then(|id| markers.get(&id).cloned());
        let (source_id, source_author, source_heading) = match marker {
            Some(marker) => (
                Some(marker.book_id),
                Some(marker.author),
                Some(marker.heading),
            ),
            None => (None, None, None),
        };
        suggestions.push(AssistantSuggestion {
            id: next_answer_id(),
            text,
            source_id,
            source_author,
            source_heading,
        });
    }
    if suggestions.is_empty() {
        return Err(BrainError::ProviderResponse);
    }
    Ok(AssistantSuggestions { suggestions })
}

/// Production entry point used by the Tauri command. Network work is blocking;
/// the command runs this function on Tauri's blocking pool.
pub fn ask_native(
    request: BrainAskRequest,
    store: Arc<Store>,
    sessions: Arc<SessionService>,
    active_rep: Option<RepSnapshot>,
) -> Result<BrainAnswer, BrainError> {
    let library = EmbeddedLibrary::load();
    let preference = store.get_setting("brain.provider").ok().flatten();
    let chain = ProviderChain::from_native_config_with_preference(preference.as_deref());
    ask_with(
        request,
        &store,
        &sessions,
        &library,
        &chain,
        &NativeTransport::new(),
        active_rep.as_ref(),
    )
}

/// Text-first delivery: every answer returns for rendering, and speech is an
/// extra that fires only for a Voice-sourced ask. A typed question never speaks.
pub fn should_speak_answer(source: QuestionSource) -> bool {
    matches!(source, QuestionSource::Voice)
}

/// Remove `id` from `text` wherever it stands alone as a token — bounded on
/// both sides by a non-alphanumeric character or the edge of the string — and
/// leave every other occurrence untouched.
///
/// The scoping is not fussiness. A citation id is user-influenced
/// (`local:{book.id}:{n}`, where `book.id` comes from an imported book's slug),
/// so an id can be, or contain, an ordinary English word. An unscoped
/// `replace` therefore shreds the prose it was meant to clean: id `"at"` turned
/// "The cat sat on the mat" into "The c s on the m", and id `"120"` turned
/// "not 12 or 1200" into "not 12 or 0" — spoken aloud, to a pianist, as the
/// Brain's answer.
fn strip_standalone(text: &str, id: &str) -> String {
    if id.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(hit) = rest.find(id) {
        let (before, tail) = rest.split_at(hit);
        let after = &tail[id.len()..];
        // The character to the left is the last one of this segment, or — when
        // the match sits flush against the previous one — the last character
        // already written out.
        let left = before
            .chars()
            .next_back()
            .or_else(|| out.chars().next_back());
        let standalone = left.is_none_or(|c| !c.is_alphanumeric())
            && after.chars().next().is_none_or(|c| !c.is_alphanumeric());
        out.push_str(before);
        out.push_str(if standalone { " " } else { id });
        rest = after;
    }
    out.push_str(rest);
    out
}

/// The spoken form of an answer. Citations are a separate `citations` field and
/// the system policy forbids ids inside the answer text, so this is a backstop:
/// if an id leaks through anyway it is stripped from speech only — the visible
/// answer keeps exactly what the provider wrote.
pub fn spoken_answer(answer: &BrainAnswer) -> String {
    let mut spoken = answer.answer.clone();
    for citation in &answer.citations {
        let id = citation.source_id.as_str();
        if id.is_empty() {
            continue;
        }
        for bracketed in [format!("[{id}]"), format!("({id})")] {
            spoken = spoken.replace(&bracketed, " ");
        }
        spoken = strip_standalone(&spoken, id);
    }
    // Collapse the gaps the removals left, including a space stranded before
    // sentence punctuation.
    let collapsed = spoken.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = String::with_capacity(collapsed.len());
    for part in collapsed.chars() {
        if matches!(part, '.' | ',' | ';' | ':' | '!' | '?') && out.ends_with(' ') {
            out.pop();
        }
        out.push(part);
    }
    out.trim().to_string()
}

/// Resolve the active knowledge directory: the `brain.knowledge_dir` setting
/// when set to a non-empty value, otherwise the built-in default. Shared by
/// retrieval and every book-library command so they agree on one folder.
pub fn resolve_knowledge_dir(store: &Store) -> PathBuf {
    store
        .get_setting("brain.knowledge_dir")
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_KNOWLEDGE_DIR))
}

/// Manifest entries + per-book availability for the Settings "Books" panel.
pub fn list_books(store: &Store) -> Result<Vec<BookListing>, String> {
    corpus::list_books(&resolve_knowledge_dir(store))
}

/// Copy a readable `.md` book into the knowledge folder and append the manifest.
/// The frontend owns the confirmation UI; this validates and acts.
pub fn add_book(
    store: &Store,
    path: &str,
    title: &str,
    author: &str,
    kind: BookKind,
) -> Result<BookListing, String> {
    corpus::add_book(
        &resolve_knowledge_dir(store),
        Path::new(path),
        title,
        author,
        kind,
    )
}

/// Remove a manifest entry, moving its file to `.trash/` (never hard-delete).
pub fn remove_book(store: &Store, id: &str) -> Result<(), String> {
    corpus::remove_book(&resolve_knowledge_dir(store), id)
}

/// The markdown section around a quote for the Reader window (D2).
pub fn book_excerpt(
    store: &Store,
    source_id: &str,
    heading: Option<&str>,
    contains: Option<&str>,
) -> Result<BookExcerpt, String> {
    corpus::book_excerpt(&resolve_knowledge_dir(store), source_id, heading, contains)
}

/// Truthful, no-network Brain status for the Settings/status UI. `online` means
/// a provider is configured (key present + not disabled), not that a live
/// round-trip succeeded. `reason` is set only when offline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrainStatus {
    pub online: bool,
    pub provider: Option<String>,
    pub reason: Option<String>,
}

/// Result of a real Brain round-trip (Test connection). On success it carries
/// the provider, the model that answered, and the measured latency; on failure
/// it carries the truthful reason string. Never carries a secret.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BrainTestResult {
    pub ok: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn provider_label(provider: ProviderName) -> Option<String> {
    match provider {
        ProviderName::Claude => Some("claude".to_string()),
        ProviderName::Gemini => Some("gemini".to_string()),
        ProviderName::Offline => None,
    }
}

/// Pure status mapping from the settings preference + a resolved chain. No
/// network call: it only reflects key presence and the offline/disabled setting.
fn status_from_chain(preference: Option<&str>, chain: &ProviderChain) -> BrainStatus {
    if preference == Some("offline") {
        return BrainStatus {
            online: false,
            provider: None,
            reason: Some("disabled in settings".to_string()),
        };
    }
    if chain.is_empty() {
        return BrainStatus {
            online: false,
            provider: None,
            reason: Some(chain.offline_reason().to_string()),
        };
    }
    BrainStatus {
        online: true,
        provider: chain.primary_provider().and_then(provider_label),
        reason: None,
    }
}

/// Production status entry point: reads the provider preference and resolves the
/// native chain (Keychain/env), then maps it. Performs no network request.
pub fn status_native(store: &Store) -> BrainStatus {
    let preference = store.get_setting("brain.provider").ok().flatten();
    let chain = ProviderChain::from_native_config_with_preference(preference.as_deref());
    status_from_chain(preference.as_deref(), &chain)
}

/// Whole-score MusicXML measure landmarks for the mapping wizard's measure
/// strip (ledger #31). Resolves the piece, then reuses the exact same score
/// resolution and parser as `brain_ask`'s grounded context. Read-only: it never
/// mutates practice state and never enters the deterministic voice/rep loop.
pub fn score_xml_measure_facts(store: &Store, piece_id: i64) -> Result<XmlMeasureFacts, String> {
    let piece = store
        .get_piece(piece_id)
        .map_err(|_| "Could not read the selected piece".to_string())?
        .ok_or_else(|| format!("piece {piece_id} not found"))?;
    score_context::xml_measure_facts(&piece)
}

/// Pure round-trip mapping: run one minimal question through the chain and map
/// the outcome to a `BrainTestResult`. Unit-tested with a fake transport.
fn test_connection_with(chain: &ProviderChain, transport: &dyn Transport) -> BrainTestResult {
    if chain.is_empty() {
        return BrainTestResult {
            ok: false,
            provider: None,
            model: None,
            latency_ms: None,
            error: Some(chain.offline_reason().to_string()),
        };
    }
    let context = context::GroundedContext {
        json: "{}".to_string(),
    };
    let started = Instant::now();
    match chain.ask(
        "Reply with a brief confirmation that you are reachable.",
        QuestionSource::Typed,
        &context,
        transport,
        provider::ToolRound::Final,
    ) {
        Ok(output) => BrainTestResult {
            ok: true,
            provider: provider_label(output.provider),
            model: Some(output.model),
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        },
        Err(error) => BrainTestResult {
            ok: false,
            provider: None,
            model: None,
            latency_ms: None,
            error: Some(error.reason()),
        },
    }
}

/// Production Test-connection entry point: a real round-trip over the native
/// transport using the configured provider chain.
pub fn test_connection_native(store: &Store) -> BrainTestResult {
    let preference = store.get_setting("brain.provider").ok().flatten();
    let chain = ProviderChain::from_native_config_with_preference(preference.as_deref());
    test_connection_with(&chain, &NativeTransport::new())
}

fn ask_with(
    request: BrainAskRequest,
    store: &Store,
    sessions: &SessionService,
    library: &dyn PracticeLibrary,
    chain: &ProviderChain,
    transport: &dyn Transport,
    active_rep: Option<&RepSnapshot>,
) -> Result<BrainAnswer, BrainError> {
    let question = request.question.trim();
    if question.is_empty() {
        return Err(BrainError::InvalidQuestion(
            "Ask a specific practice question".into(),
        ));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(BrainError::InvalidQuestion(format!(
            "Question is too long (maximum {MAX_QUESTION_CHARS} characters)"
        )));
    }

    let history = validated_history(&request.history)?;
    let piece_id = request.selected_piece_id();
    let region_id = request.selected_region_id();
    let measure_range = request.explicit_measure_range()?;
    let intake_review = build_intake_review(question, store, piece_id)?;
    let methods = library.retrieve(question, 3);
    let retrieval_query = retrieval_query(question, &history);
    let share_knowledge = store
        .get_setting("brain.share_retrieved_knowledge")
        .ok()
        .flatten()
        .as_deref()
        != Some("false");
    // Retrieval is always local and remains useful in offline/private mode.
    // The setting controls only whether bounded hits cross the provider
    // boundary, never whether Christian can search his own books.
    let directory = resolve_knowledge_dir(store);
    let corpus = corpus::search(&directory, &retrieval_query, 6);
    let (context, grounding) = context::build(
        store,
        sessions,
        piece_id,
        region_id,
        measure_range,
        active_rep,
        &methods,
        &corpus,
        share_knowledge,
        &history,
        request.context.as_ref(),
    )?;

    if chain.is_empty() {
        return Ok(offline_answer(
            methods,
            corpus.hits,
            intake_review,
            grounding,
            None,
        ));
    }

    let ProviderOutput {
        provider,
        model: _,
        answer,
        citation_ids,
        proposed_action,
        tool_requests: _round1_tool_requests,
    } = match chain.ask(question, request.source, &context, transport, provider::ToolRound::First) {
        Ok(output) => output,
        Err(BrainError::ProviderUnavailable(_)) => {
            return Ok(offline_answer(
                methods,
                corpus.hits,
                intake_review,
                grounding,
                None,
            ))
        }
        Err(error) => return Err(error),
    };

    // Voice-only gate: a typed question behaves exactly as before, so any action
    // the provider returned for a typed request is discarded here.
    let proposed_action = match request.source {
        QuestionSource::Voice => proposed_action,
        QuestionSource::Typed => None,
    };

    if let Some(_reason) = output_policy_violation_reason(&answer) {
        #[cfg(test)]
        eprintln!("Practice Brain output policy rejected category: {_reason}");
        return Err(BrainError::PolicyViolation);
    }

    // Citations are an allowlist join against deterministic local retrieval.
    // Unknown provider-supplied ids are discarded, so it cannot fabricate a
    // source, URL, or locator into frontend state.
    let allowed_citations = methods
        .iter()
        .flat_map(|method| method.citations.iter())
        .cloned()
        .chain(
            corpus
                .hits
                .iter()
                .filter(|_| share_knowledge)
                .map(corpus::CorpusHit::citation),
        )
        .collect::<Vec<_>>();
    let citations = allowed_citations
        .iter()
        .filter(|citation| citation_ids.iter().any(|id| id == &citation.source_id))
        .cloned()
        .fold(Vec::<Citation>::new(), |mut acc, citation| {
            if !acc
                .iter()
                .any(|existing| existing.source_id == citation.source_id)
            {
                acc.push(citation);
            }
            acc
        });

    // A provider answer without at least one locally verified source is not a
    // grounded answer. Fall back to the deterministic library card instead of
    // putting uncited prose in the UI.
    let cites_external_library = citations
        .iter()
        .any(|citation| corpus.hits.iter().any(|hit| hit.id == citation.source_id));
    if citations.is_empty()
        || (share_knowledge && !corpus.hits.is_empty() && !cites_external_library)
    {
        // The prose fell back to a grounded offline line, but a validated action
        // stands on its own bounded schema, so it still rides the safe answer.
        return Ok(offline_answer(
            methods,
            corpus.hits,
            intake_review,
            grounding,
            proposed_action,
        ));
    }

    Ok(BrainAnswer {
        id: next_answer_id(),
        answer,
        provider,
        citations,
        methods,
        intake_review,
        grounding,
        proposed_action,
    })
}

fn offline_answer(
    methods: Vec<MethodCard>,
    corpus_hits: Vec<corpus::CorpusHit>,
    intake_review: Option<IntakeReview>,
    mut grounding: GroundingSummary,
    proposed_action: Option<ProposedAction>,
) -> BrainAnswer {
    // Context construction happens before provider selection. An offline
    // fallback transmits nothing, even when online sharing is enabled.
    grounding.knowledge_shared_with_provider = false;
    grounding.knowledge_share_cause = KnowledgeShareCause::Offline;
    let citations = corpus_hits
        .iter()
        .take(3)
        .map(corpus::CorpusHit::citation)
        .chain(
            methods
                .iter()
                .flat_map(|method| method.citations.iter().cloned()),
        )
        .fold(Vec::<Citation>::new(), |mut acc, citation| {
            if !acc
                .iter()
                .any(|existing| existing.source_id == citation.source_id)
            {
                acc.push(citation);
            }
            acc
        });
    let answer = corpus_hits.first().map_or_else(
        || methods.first().map_or_else(
        || if intake_review.is_some() {
            "I prepared a field-by-field intake draft. Nothing changes until you press Save."
                .to_string()
        } else {
            "No online brain provider is configured, and the local library has no grounded match for this question.".to_string()
        },
        |method| format!(
            "Offline library match: {}. Dose: {} Watch for: {}",
            method.name, method.dose, method.watch_for
        ),
    ), |hit| format!(
        "Offline local-library match: {} — {}. Open its cited section for the full passage; local book text is kept out of conversation history so it cannot cross the provider boundary on a later turn.",
        hit.author,
        hit.heading,
    ));
    BrainAnswer {
        id: next_answer_id(),
        answer,
        provider: ProviderName::Offline,
        citations,
        methods,
        intake_review,
        grounding,
        proposed_action,
    }
}

fn validated_history(history: &[ConversationTurn]) -> Result<Vec<ConversationTurn>, BrainError> {
    if history.len() > 40 {
        return Err(BrainError::InvalidQuestion(
            "Conversation history is too long".into(),
        ));
    }
    let mut total = 0;
    let mut output = Vec::new();
    for turn in history.iter().rev().take(MAX_HISTORY_TURNS).rev() {
        let content = turn.content.trim();
        let count = content.chars().count();
        if content.is_empty() || count > MAX_HISTORY_TURN_CHARS {
            return Err(BrainError::InvalidQuestion(
                "A conversation turn is empty or too long".into(),
            ));
        }
        total += count;
        if total > MAX_HISTORY_CHARS {
            return Err(BrainError::InvalidQuestion(
                "Conversation history exceeds the safe context budget".into(),
            ));
        }
        output.push(ConversationTurn {
            role: turn.role,
            content: content.to_string(),
        });
    }
    Ok(output)
}

fn retrieval_query(question: &str, history: &[ConversationTurn]) -> String {
    history
        .iter()
        .rev()
        .filter(|turn| turn.role == ConversationRole::User)
        .take(2)
        .map(|turn| turn.content.as_str())
        .chain(std::iter::once(question))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_intake_review(
    question: &str,
    store: &Store,
    requested_piece_id: Option<i64>,
) -> Result<Option<IntakeReview>, BrainError> {
    let normalized = question.to_ascii_lowercase();
    if !(normalized.contains("intake")
        && ["review", "update", "change", "set"]
            .iter()
            .any(|word| normalized.contains(word)))
    {
        return Ok(None);
    }
    let Some(piece_id) = requested_piece_id else {
        return Ok(None);
    };
    let piece = store
        .get_piece(piece_id)
        .map_err(|_| BrainError::Context("Could not read the selected piece".into()))?
        .ok_or_else(|| BrainError::Context(format!("piece {piece_id} not found")))?;
    let mut fields = Vec::new();

    if let Some(value) = extract_change(question, &["current state to "]) {
        fields.push(IntakeReviewField {
            field: "current_state".into(),
            label: "Current state".into(),
            current: piece.current_state.unwrap_or_default(),
            proposed: value,
        });
    }
    if let Some(value) = extract_change(question, &["deadline to "])
        .and_then(|value| value.split_whitespace().next().map(str::to_string))
        .filter(|value| crate::date::is_valid(value))
    {
        fields.push(IntakeReviewField {
            field: "deadline".into(),
            label: "Deadline".into(),
            current: piece.deadline.unwrap_or_default(),
            proposed: value,
        });
    }
    if let Some(value) = extract_change(question, &["target tempo to ", "target bpm to "])
        .and_then(|value| value.split_whitespace().next().map(str::to_string))
        .and_then(|value| value.parse::<f64>().ok().map(|tempo| (value, tempo)))
        .filter(|(_, tempo)| (1.0..=1_000.0).contains(tempo))
        .map(|(value, _)| value)
    {
        fields.push(IntakeReviewField {
            field: "target_tempo".into(),
            label: "Target tempo".into(),
            current: piece
                .target_tempo
                .map(|value| value.to_string())
                .unwrap_or_default(),
            proposed: value,
        });
    }
    if let Some(value) = extract_change(question, &["notes to "]) {
        fields.push(IntakeReviewField {
            field: "notes".into(),
            label: "Notes".into(),
            current: piece.notes.unwrap_or_default(),
            proposed: value,
        });
    }

    if fields.is_empty() {
        return Ok(None);
    }
    Ok(Some(IntakeReview {
        piece_id,
        piece_title: piece.title,
        summary: "These are proposed intake edits, not saved changes.".into(),
        fields,
    }))
}

fn extract_change(question: &str, markers: &[&str]) -> Option<String> {
    let normalized = question.to_ascii_lowercase();
    let (index, marker) = markers
        .iter()
        .filter_map(|marker| normalized.find(marker).map(|index| (index, *marker)))
        .min_by_key(|(index, _)| *index)?;
    let value = question[index + marker.len()..]
        .split([';', '\n'])
        .next()?
        .trim()
        .chars()
        .take(500)
        .collect::<String>();
    (!value.is_empty()).then_some(value)
}

/// Apply only the fields that the review UI explicitly submits. Provider text
/// cannot call this function, and unknown fields fail the whole request.
pub fn apply_intake_review(
    request: BrainIntakeApplyRequest,
    store: &Store,
    pending_reviews: &PendingIntakeReviews,
) -> Result<BrainIntakeApplyResult, BrainError> {
    if request.changes.is_empty()
        || request.changes.len() > 4
        || store
            .get_piece(request.piece_id)
            .map_err(|_| BrainError::Context("Could not read the selected piece".into()))?
            .is_none()
    {
        return Err(BrainError::InvalidQuestion(
            "Invalid intake review request".into(),
        ));
    }
    let mut pending = pending_reviews
        .entries
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    pending.retain(|_, review| review.expires_at > now);
    let authorization = pending.get(&request.answer_id).ok_or_else(|| {
        BrainError::InvalidQuestion("Intake review expired or was already saved".into())
    })?;
    if authorization.piece_id != request.piece_id
        || request
            .changes
            .iter()
            .any(|change| !authorization.allowed_fields.contains(&change.field))
    {
        return Err(BrainError::InvalidQuestion(
            "Intake review does not authorize this piece or field".into(),
        ));
    }
    let mut patch = PieceFieldPatch::default();
    let mut seen = std::collections::HashSet::new();
    for change in request.changes {
        if !seen.insert(change.field.clone())
            || change
                .value
                .as_ref()
                .is_some_and(|value| value.chars().count() > 500)
        {
            return Err(BrainError::InvalidQuestion(
                "Invalid intake review field".into(),
            ));
        }
        let value = change
            .value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        match change.field.as_str() {
            "current_state" => patch.current_state = Some(value),
            "deadline" => {
                if value
                    .as_ref()
                    .is_some_and(|date| !crate::date::is_valid(date))
                {
                    return Err(BrainError::InvalidQuestion(
                        "Deadline must be YYYY-MM-DD".into(),
                    ));
                }
                patch.deadline = Some(value);
            }
            "target_tempo" => {
                let tempo = value
                    .as_deref()
                    .map(str::parse::<f64>)
                    .transpose()
                    .map_err(|_| {
                        BrainError::InvalidQuestion("Target tempo must be a number".into())
                    })?;
                if tempo.is_some_and(|tempo| !(1.0..=1_000.0).contains(&tempo)) {
                    return Err(BrainError::InvalidQuestion(
                        "Target tempo is out of range".into(),
                    ));
                }
                patch.target_tempo = Some(tempo);
            }
            "notes" => patch.notes = Some(value),
            _ => {
                return Err(BrainError::InvalidQuestion(
                    "Unsupported intake review field".into(),
                ))
            }
        }
    }
    store
        .piece_field_update(request.piece_id, patch)
        .map_err(|_| BrainError::Context("Could not save intake review".into()))?;
    pending.remove(&request.answer_id);
    Ok(BrainIntakeApplyResult {
        piece_id: request.piece_id,
        saved_at: store
            .now_rfc3339()
            .map_err(|_| BrainError::Context("Could not timestamp intake review".into()))?,
    })
}

fn next_answer_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = ANSWER_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("brain-{millis}-{sequence}")
}

#[cfg(test)]
fn output_crosses_policy(answer: &str) -> bool {
    output_policy_violation_reason(answer).is_some()
}

/// Collects every numeric leaf value reachable from a tool result payload,
/// as f64. Walks arrays/objects recursively; also pulls embedded numbers out
/// of string leaves (e.g. a formatted date component is harmless noise, but
/// a string like "27 min" in a future tool's summary field still counts).
fn collect_tool_numbers(payloads: &[serde_json::Value]) -> Vec<f64> {
    fn walk(value: &serde_json::Value, out: &mut Vec<f64>) {
        match value {
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    out.push(f);
                }
            }
            serde_json::Value::String(s) => {
                for token in NUMBER_RE.find_iter(s) {
                    if let Ok(f) = token.as_str().replace(',', "").parse::<f64>() {
                        out.push(f);
                    }
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            serde_json::Value::Object(map) => map.values().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    payloads.iter().for_each(|v| walk(v, &mut out));
    out
}

static NUMBER_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"\d[\d,]*(?:\.\d+)?").unwrap());

/// The numbers policy: once an answer is tool-grounded (`tool_provenance` is
/// non-empty), every figure the answer states must trace to a tool result —
/// exactly, as a formatted variant (comma grouping), or as an honest
/// minutes<->seconds rounding (tools mostly return seconds; answers mostly
/// say minutes). This is deliberately narrower than "any number anywhere
/// near a plausible value" — an unbacked figure is a `PolicyViolation`, same
/// as a claimed rep verdict.
fn numbers_policy_violation(
    answer: &str,
    tool_payloads: &[serde_json::Value],
) -> Option<&'static str> {
    let tool_numbers = collect_tool_numbers(tool_payloads);
    if tool_numbers.is_empty() {
        // No tool actually returned numeric data — nothing to check against,
        // and nothing in the answer can claim tool backing either. Any
        // digit in the answer text in this state is unsupported.
        if NUMBER_RE.is_match(answer) {
            return Some("unsupported_figure");
        }
        return None;
    }

    for token in NUMBER_RE.find_iter(answer) {
        let Ok(claimed) = token.as_str().replace(',', "").parse::<f64>() else {
            continue;
        };
        // A TIGHT epsilon on purpose: this is a safety boundary, not a
        // display convenience. A loose tolerance (e.g. "within half a unit
        // of any tool number") would let an unrelated but nearby figure
        // (say, a streak of 3 backing a claimed "3.4") slip through as
        // "close enough". The only slack allowed is the three honest,
        // exact roundings of a seconds<->minutes unit conversion — floor,
        // round, and ceil — because `history_days`/`streak_summary` report
        // seconds while answers naturally speak in minutes, and a
        // fractional minute count is legitimately reported either
        // truncated or rounded (e.g. 1,660s = 27.67min, honestly either
        // "27 min" or "28 min").
        const EPSILON: f64 = 1e-9;
        let backed = tool_numbers.iter().any(|&tool_value| {
            (claimed - tool_value).abs() < EPSILON // verbatim / formatted variant
                || [
                    (tool_value / 60.0).floor(),
                    (tool_value / 60.0).round(),
                    (tool_value / 60.0).ceil(),
                ]
                .iter()
                .any(|&minutes| (claimed - minutes).abs() < EPSILON) // seconds -> minutes
                || [
                    (tool_value * 60.0).floor(),
                    (tool_value * 60.0).round(),
                    (tool_value * 60.0).ceil(),
                ]
                .iter()
                .any(|&seconds| (claimed - seconds).abs() < EPSILON) // minutes -> seconds
        });
        if !backed {
            return Some("unsupported_figure");
        }
    }
    None
}

fn output_policy_violation_reason(answer: &str) -> Option<&'static str> {
    let normalized = answer.to_ascii_lowercase();
    if [
        "api key",
        "apikey",
        "password",
        "authentication token",
        "access token",
        "terminal",
        "shell command",
        "command line",
        "filesystem",
        "file path",
        "/users/",
        "click the button",
        "click save",
        "click the tab",
        "press the button",
        "press save",
    ]
    .iter()
    .any(|phrase| normalized.contains(phrase))
    {
        return Some("sensitive_or_direct_control_phrase");
    }
    normalized
        .split(['.', '!', '?', '\n'])
        .find_map(|sentence| {
            let words = sentence
                .split(|ch: char| !ch.is_ascii_alphanumeric())
                .filter(|word| !word.is_empty())
                .collect::<HashSet<_>>();
            let has = |terms: &[&str]| terms.iter().any(|term| words.contains(term));

            // Advice may tell Christian what to try. Reject these pairs only when
            // the provider falsely casts itself/the app as the actor.
            let claimed_app_actor = has(&["i", "we", "coda", "codakiller", "app", "brain"]);
            let navigation = claimed_app_actor
                && has(&[
                    "go",
                    "went",
                    "jump",
                    "jumped",
                    "navigate",
                    "navigated",
                    "open",
                    "opened",
                    "show",
                    "showed",
                    "scroll",
                    "scrolled",
                    "head",
                    "headed",
                    "seek",
                    "sought",
                    "view",
                    "viewed",
                    "move",
                    "moved",
                    "turn",
                    "turned",
                ])
                && has(&[
                    "page", "measure", "bar", "score", "region", "system", "section", "location",
                ]);
            let tempo_control = claimed_app_actor
                && has(&[
                    "start",
                    "started",
                    "stop",
                    "stopped",
                    "set",
                    "change",
                    "changed",
                    "raise",
                    "raised",
                    "lower",
                    "lowered",
                    "increase",
                    "increased",
                    "decrease",
                    "decreased",
                    "bump",
                    "bumped",
                    "retune",
                    "retuned",
                    "adjust",
                    "adjusted",
                    "dial",
                    "dialed",
                    "tune",
                    "tuned",
                    "switch",
                    "switched",
                    "put",
                    "turn",
                    "turned",
                    "pause",
                    "paused",
                    "resume",
                    "resumed",
                ])
                && has(&["tempo", "bpm", "metronome", "click"]);
            let graph_mutation = claimed_app_actor
                && has(&[
                    "delete",
                    "deleted",
                    "edit",
                    "edited",
                    "save",
                    "saved",
                    "update",
                    "updated",
                    "create",
                    "created",
                    "remove",
                    "removed",
                    "add",
                    "added",
                    "mark",
                    "marked",
                    "reschedule",
                    "rescheduled",
                    "move",
                    "moved",
                    "apply",
                    "applied",
                    "erase",
                    "erased",
                    "write",
                    "wrote",
                    "record",
                    "recorded",
                    "log",
                    "logged",
                    "rename",
                    "renamed",
                    "clear",
                    "cleared",
                    "replace",
                    "replaced",
                    "complete",
                    "completed",
                    "dismiss",
                    "dismissed",
                ])
                && has(&[
                    "goal", "block", "rep", "region", "intake", "deadline", "schedule",
                ]);
            let claimed_tempo_state = has(&["metronome", "tempo", "bpm", "click"])
                && has(&[
                    "now",
                    "currently",
                    "already",
                    "is",
                    "are",
                    "was",
                    "has",
                    "been",
                ])
                && has(&[
                    "running", "started", "stopped", "set", "changed", "raised", "lowered",
                    "retuned", "adjusted", "on", "off", "paused", "resumed",
                ]);
            let claimed_graph_state = has(&["goal", "block", "region", "intake", "schedule"])
                && has(&["was", "has", "now", "already"])
                && has(&[
                    "deleted",
                    "edited",
                    "saved",
                    "updated",
                    "created",
                    "removed",
                    "added",
                    "moved",
                    "applied",
                    "recorded",
                    "renamed",
                    "cleared",
                    "completed",
                    "dismissed",
                ]);

            // The app has no piano-audio perception. Reject app-actor
            // sensory claims and verdict language tied to an attempt/performance.
            let sensory_claim = claimed_app_actor
                && has(&["hear", "heard", "listen", "listened", "detect", "detected"])
                && has(&[
                    "playing",
                    "performance",
                    "piano",
                    "take",
                    "rep",
                    "attempt",
                    "tension",
                    "rhythm",
                    "tone",
                ]);
            let sounded_claim = sentence.contains("your playing sounds")
                || sentence.contains("your performance sounds")
                || sentence.contains("that sounded");
            let outcome = has(&[
                "clean",
                "flawed",
                "failed",
                "sloppy",
                "rough",
                "shaky",
                "perfect",
                "incorrect",
                "success",
                "successful",
                "miss",
                "missed",
                "pass",
                "passed",
                "failure",
            ]);
            let attempt = has(&[
                "rep",
                "repetition",
                "attempt",
                "playing",
                "performance",
                "take",
                "run",
                "sounded",
            ]);
            let deictic = has(&["your", "that", "this", "it", "last", "latest", "one"]);
            let verdict = outcome && attempt && deictic;
            let deictic_verdict = outcome && deictic;
            let app_verdict_action = claimed_app_actor
                && outcome
                && has(&[
                    "count",
                    "counted",
                    "record",
                    "recorded",
                    "log",
                    "logged",
                    "classify",
                    "classified",
                    "label",
                    "labeled",
                    "mark",
                    "marked",
                    "treat",
                    "treated",
                    "call",
                    "called",
                ]);
            let verdict_action = has(&[
                "count", "record", "log", "classify", "label", "mark", "treat", "call",
            ]) && attempt
                && outcome;

            if navigation {
                Some("claimed_navigation")
            } else if tempo_control {
                Some("claimed_tempo_control")
            } else if graph_mutation {
                Some("claimed_graph_mutation")
            } else if claimed_tempo_state {
                Some("claimed_tempo_state")
            } else if claimed_graph_state {
                Some("claimed_graph_state")
            } else if sensory_claim || sounded_claim {
                Some("claimed_piano_perception")
            } else if verdict || deictic_verdict || app_verdict_action || verdict_action {
                Some("claimed_rep_verdict")
            } else {
                None
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use provider::{FakeTransport, HttpResponse, ProviderConfig, ProviderPreference};
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn numbers_policy_allows_a_figure_present_verbatim_in_a_tool_payload() {
        let payloads = vec![json!({"current_streak": 3, "best_streak": 7})];
        assert_eq!(
            numbers_policy_violation("Your current streak is 3 days; your best is 7.", &payloads),
            None
        );
    }

    #[test]
    fn numbers_policy_allows_seconds_reported_as_rounded_minutes() {
        let payloads = vec![json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        // 1660 seconds = 27.67 min, rounds to 27 or 28 — either is an honest rounding.
        assert_eq!(
            numbers_policy_violation("You focused 27 min on 2026-08-20.", &payloads),
            None
        );
        assert_eq!(
            numbers_policy_violation("You focused 28 min on 2026-08-20.", &payloads),
            None
        );
    }

    #[test]
    fn numbers_policy_allows_comma_formatted_variants() {
        let payloads = vec![json!({"total_seconds": 5000})];
        assert_eq!(
            numbers_policy_violation("That's 5,000 seconds on record.", &payloads),
            None
        );
    }

    #[test]
    fn numbers_policy_rejects_a_figure_with_no_backing_tool_row() {
        let payloads = vec![json!({"current_streak": 3})];
        assert_eq!(
            numbers_policy_violation("You've practiced this passage 12 times.", &payloads),
            Some("unsupported_figure")
        );
    }

    #[test]
    fn numbers_policy_rejects_a_number_one_unit_off_the_true_rounding() {
        // Adversarial: a claim adjacent to (but not equal to) an honest
        // rounding must NOT slip through on a loose tolerance. 1660s = 27.67
        // min — 27 and 28 are honest, but 26 and 29 are not backed by
        // anything in the payload and must be rejected.
        let payloads = vec![json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        assert_eq!(
            numbers_policy_violation("You focused 26 min on 2026-08-20.", &payloads),
            Some("unsupported_figure")
        );
        assert_eq!(
            numbers_policy_violation("You focused 29 min on 2026-08-20.", &payloads),
            Some("unsupported_figure")
        );
    }

    #[test]
    fn numbers_policy_rejects_a_figure_near_but_not_equal_to_a_verbatim_tool_number() {
        // Adversarial: a claim close to a raw tool number (not a unit
        // conversion of it) must still be rejected — "close" is not a
        // policy the numbers check honors outside the three named seconds
        // <-> minutes roundings.
        let payloads = vec![json!({"current_streak": 3})];
        assert_eq!(
            numbers_policy_violation("Your streak is 4 days.", &payloads),
            Some("unsupported_figure")
        );
        assert_eq!(
            numbers_policy_violation("Your streak is 2.6 days.", &payloads),
            Some("unsupported_figure")
        );
    }

    #[test]
    fn numbers_policy_rejects_any_figure_when_no_tool_returned_numeric_data() {
        // A tool payload with no numeric leaves at all (e.g. an empty array
        // result) backs nothing — any digit in the answer is unsupported.
        let payloads: Vec<serde_json::Value> = vec![json!([])];
        assert_eq!(
            numbers_policy_violation("You've had 5 sessions.", &payloads),
            Some("unsupported_figure")
        );
    }

    #[test]
    fn numbers_policy_allows_an_answer_with_no_digits_regardless_of_payload() {
        let payloads = vec![json!({"current_streak": 3})];
        assert_eq!(
            numbers_policy_violation("Keep going, you're on a nice streak.", &payloads),
            None
        );
    }

    #[derive(Default)]
    struct TestLibrary;

    impl PracticeLibrary for TestLibrary {
        fn retrieve(&self, _question: &str, _limit: usize) -> Vec<MethodCard> {
            vec![MethodCard {
                id: "silent-landing".into(),
                name: "Silent landing".into(),
                why: "Separates the arrival shape from the leap.".into(),
                dose: "3 silent placements, then 5 slow repetitions".into(),
                watch_for: "Stop if the wrist locks.".into(),
                citations: vec![Citation {
                    source_id: "source-1".into(),
                    label: "The Musician's Way".into(),
                    excerpt: "Chapter 9".into(),
                    url: "https://example.com/source".into(),
                }],
            }]
        }
    }

    fn fixture() -> (Arc<Store>, SessionService, i64) {
        let store = Store::open(":memory:").unwrap();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Scherzo".into(),
                title: "Scherzo No. 2".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        store
            .set_setting("ui.current_piece", &piece_id.to_string())
            .unwrap();
        // Unit tests stay hermetic. Dedicated corpus/live tests explicitly
        // opt into the real external library.
        store
            .set_setting("brain.knowledge_dir", "/codakiller-test-missing")
            .unwrap();
        let store = Arc::new(store);
        let sessions = SessionService::new(store.clone());
        (store, sessions, piece_id)
    }

    fn request(question: &str) -> BrainAskRequest {
        BrainAskRequest {
            question: question.into(),
            source: QuestionSource::Typed,
            history: vec![],
            context: None,
            thread_id: None,
            piece_id: Some(1),
            region_id: None,
            measure_start: None,
            measure_end: None,
        }
    }

    fn external_corpus_fixture() -> TempDir {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join("the-complete-pianist.md"),
            "# Technique\n\nA bounded Roskell passage about lateral movement and a released wrist during leaps.",
        )
        .unwrap();
        fs::write(
            temp.path().join("learn-faster-perform-better.md"),
            "# Learning\n\nThe private-test phrase explains why a memorized wrong version persists and why unchanged slow repetition can reinforce it.",
        )
        .unwrap();
        fs::write(
            temp
                .path()
                .join("the-piano-students-guide-to-effective-practicing.md"),
            "# Practice tools\n\nA bounded Breth passage about changing rhythm groupings before returning to the written rhythm.",
        )
        .unwrap();
        temp
    }

    #[test]
    fn offline_answer_is_deterministically_retrieved_and_cited() {
        let (store, sessions, _) = fixture();
        let answer = ask_with(
            request("How do I land this leap?"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Offline);
        assert!(!answer.grounding.knowledge_shared_with_provider);
        assert_eq!(answer.methods[0].id, "silent-landing");
        assert!(answer
            .citations
            .iter()
            .any(|citation| citation.source_id == "source-1"));
        assert_eq!(
            answer.grounding.knowledge_share_cause,
            KnowledgeShareCause::Offline,
            "an offline answer transmits nothing at all"
        );
    }

    /// A chain whose single Claude provider returns exactly `answer_json`.
    fn claude_chain_returning(answer_json: String) -> (ProviderChain, FakeTransport) {
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": answer_json}]
        }))]);
        (chain, transport)
    }

    // The three grounding states the receipt must tell apart. Christian read the
    // old single boolean as "the content is hidden from the AI"; the cause is
    // what lets the copy say which of these actually happened.

    #[test]
    fn grounding_cause_is_shared_when_excerpts_cross_the_provider_boundary() {
        let (store, sessions, _) = fixture();
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        let question = "Why does my memorized wrong version persist?";
        let hit_id = corpus::search(corpus_dir.path(), question, 6).hits[0]
            .id
            .clone();
        let (chain, transport) = claude_chain_returning(format!(
            "{{\"answer\":\"Rebuild the passage from one verified unit.\",\"citation_ids\":[\"{hit_id}\"]}}"
        ));
        let answer = ask_with(
            request(question),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Claude);
        assert!(answer.grounding.knowledge_shared_with_provider);
        assert_eq!(
            answer.grounding.knowledge_share_cause,
            KnowledgeShareCause::Shared
        );
        assert_eq!(
            serde_json::to_value(answer.grounding.knowledge_share_cause).unwrap(),
            json!("shared"),
            "the frontend renders 'Retrieved excerpts shared with provider' for this exact tag"
        );
    }

    #[test]
    fn grounding_cause_is_no_matches_when_retrieval_finds_nothing() {
        let (store, sessions, _) = fixture();
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        // Indexed library, sharing on, but nothing in it is about this.
        let question = "Which airport terminal should I use tomorrow?";
        let retrieved = corpus::search(corpus_dir.path(), question, 6);
        assert!(retrieved.hits.is_empty(), "fixture question must not match");
        assert!(!retrieved.indexed_sources.is_empty());
        let (chain, transport) = claude_chain_returning(
            "{\"answer\":\"Keep the leap rehearsal short and released.\",\"citation_ids\":[\"source-1\"]}"
                .into(),
        );
        let answer = ask_with(
            request(question),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Claude);
        assert!(!answer.grounding.knowledge_shared_with_provider);
        assert_eq!(
            answer.grounding.knowledge_share_cause,
            KnowledgeShareCause::NoMatches
        );
        assert_eq!(
            serde_json::to_value(answer.grounding.knowledge_share_cause).unwrap(),
            json!("no_matches"),
            "the frontend renders 'No book excerpts matched this question' for this exact tag — nothing was withheld"
        );
    }

    #[test]
    fn grounding_cause_is_sharing_disabled_when_the_privacy_setting_holds_excerpts_back() {
        let (store, sessions, _) = fixture();
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        store
            .set_setting("brain.share_retrieved_knowledge", "false")
            .unwrap();
        let question = "Why does my memorized wrong version persist?";
        assert!(
            !corpus::search(corpus_dir.path(), question, 6)
                .hits
                .is_empty(),
            "excerpts exist; only the setting keeps them home"
        );
        let (chain, transport) = claude_chain_returning(
            "{\"answer\":\"Rebuild the passage from one verified unit.\",\"citation_ids\":[\"source-1\"]}"
                .into(),
        );
        let answer = ask_with(
            request(question),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Claude);
        assert!(!answer.grounding.knowledge_shared_with_provider);
        assert_eq!(
            answer.grounding.knowledge_share_cause,
            KnowledgeShareCause::SharingDisabled
        );
        assert_eq!(
            serde_json::to_value(answer.grounding.knowledge_share_cause).unwrap(),
            json!("sharing_disabled"),
            "the frontend renders 'Book excerpts are kept on this Mac (sharing is off in Settings)' for this exact tag"
        );
        assert!(!transport.requests()[0]
            .body
            .to_string()
            .contains("private-test phrase"));
    }

    #[test]
    fn grounding_cause_is_no_library_when_nothing_is_indexed() {
        let (store, sessions, _) = fixture();
        let (chain, transport) = claude_chain_returning(
            "{\"answer\":\"Place the arrival silently, then rebuild.\",\"citation_ids\":[\"source-1\"]}"
                .into(),
        );
        let answer = ask_with(
            request("How do I land this leap?"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(
            answer.grounding.knowledge_share_cause,
            KnowledgeShareCause::NoLibrary
        );
    }

    #[test]
    fn speech_is_text_first_and_fires_only_for_voice_asks() {
        assert!(!should_speak_answer(QuestionSource::Typed));
        assert!(should_speak_answer(QuestionSource::Voice));
    }

    /// A citation id is user-influenced — `local:{book.id}:{n}` takes `book.id`
    /// from an imported book's slug — so ids that are, or contain, ordinary
    /// words are reachable. The strip must be a TOKEN strip: an id that appears
    /// inside a word is not a citation and must survive.
    #[test]
    fn stripping_a_citation_id_never_shreds_the_prose_around_it() {
        // The word-shaped ids, against sentences that contain them as
        // substrings and never as citations. Not one character may change.
        for (id, sentence) in [
            ("at", "The cat sat on the mat"),
            ("and", "Play hands separately, and then rebuild"),
            ("chunk", "Practice this chunk by chunk, then rebuild"),
            ("120", "Set the metronome to 120 bpm, not 12 or 1200."),
        ] {
            let stripped = strip_standalone(sentence, id);
            // Every occurrence bounded by word characters survives untouched.
            for word in sentence.split_whitespace() {
                let bare = word.trim_matches(|c: char| !c.is_alphanumeric());
                if bare != id {
                    assert!(
                        stripped.contains(bare),
                        "id {id:?} destroyed {word:?} in {stripped:?}"
                    );
                }
            }
        }

        // Concretely, the two failures that motivated the fix.
        assert_eq!(
            strip_standalone("The cat sat on the mat", "at"),
            "The cat sat on the mat"
        );
        assert_eq!(
            strip_standalone("Set the metronome to 120 bpm, not 12 or 1200.", "120"),
            "Set the metronome to   bpm, not 12 or 1200."
        );
        assert_eq!(
            strip_standalone("Practice this chunk by chunk, then rebuild", "chunk"),
            "Practice this   by  , then rebuild"
        );

        // And the genuine standalone citation still goes, at every position.
        assert_eq!(strip_standalone("at", "at"), " ");
        assert_eq!(strip_standalone("see at.", "at"), "see  .");
        assert_eq!(
            strip_standalone("hands separately, and then", "and"),
            "hands separately,   then"
        );
        // An empty id is a no-op rather than an infinite loop.
        assert_eq!(strip_standalone("anything", ""), "anything");
    }

    /// The same thing through the public surface: a word-shaped id spoken over
    /// real prose leaves the sentence sayable.
    #[test]
    fn spoken_answer_survives_a_word_shaped_citation_id() {
        // Borrow a real answer's shape, then plant the word-shaped id in it —
        // cheaper than hand-building a GroundingSummary, and it exercises the
        // same struct the command path speaks from.
        let (store, sessions, _) = fixture();
        let mut answer = ask_with(
            request("How do I land this leap?"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        answer.answer = "The cat sat on the mat [at], and then rebuild.".into();
        answer.citations = vec![Citation {
            source_id: "at".into(),
            label: "At".into(),
            excerpt: String::new(),
            url: String::new(),
        }];
        assert_eq!(
            spoken_answer(&answer),
            "The cat sat on the mat, and then rebuild."
        );
    }

    #[test]
    fn spoken_answer_never_reads_citation_ids_aloud() {
        let (store, sessions, _) = fixture();
        let (chain, transport) = claude_chain_returning(
            "{\"answer\":\"Place the arrival silently [source-1], then rebuild the leap (source-1).\",\"citation_ids\":[\"source-1\"]}"
                .into(),
        );
        let answer = ask_with(
            request("How do I land this leap?"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert!(
            answer.answer.contains("source-1"),
            "the visible answer keeps what the provider wrote"
        );
        let spoken = spoken_answer(&answer);
        assert_eq!(spoken, "Place the arrival silently, then rebuild the leap.");
        assert!(!spoken.contains("source-1"));
    }

    #[test]
    fn conversational_intake_is_a_draft_until_explicit_apply() {
        let (store, sessions, piece_id) = fixture();
        let answer = ask_with(
            request("Review my intake: current state to hands together; deadline to 2026-08-01; target tempo to 144; notes to prioritize the coda"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        ).unwrap();
        let review = answer.intake_review.as_ref().expect("draft is returned");
        assert_eq!(review.fields.len(), 4);
        assert_eq!(
            store.get_piece(piece_id).unwrap().unwrap().current_state,
            None,
            "asking alone never mutates intake"
        );

        let pending = PendingIntakeReviews::default();
        pending.register_answer(&answer);
        apply_intake_review(
            BrainIntakeApplyRequest {
                answer_id: answer.id,
                piece_id,
                changes: vec![
                    IntakeChange {
                        field: "current_state".into(),
                        value: Some("hands together".into()),
                    },
                    IntakeChange {
                        field: "deadline".into(),
                        value: Some("2026-08-01".into()),
                    },
                    IntakeChange {
                        field: "target_tempo".into(),
                        value: Some("144".into()),
                    },
                ],
            },
            store.as_ref(),
            &pending,
        )
        .unwrap();
        let piece = store.get_piece(piece_id).unwrap().unwrap();
        assert_eq!(piece.current_state.as_deref(), Some("hands together"));
        assert_eq!(piece.deadline.as_deref(), Some("2026-08-01"));
        assert_eq!(piece.target_tempo, Some(144.0));
    }

    #[test]
    fn intake_apply_rejects_provider_invented_fields() {
        let (store, sessions, piece_id) = fixture();
        let answer = ask_with(
            request("Review my intake: notes to keep this bounded"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        let pending = PendingIntakeReviews::default();
        pending.register_answer(&answer);
        let result = apply_intake_review(
            BrainIntakeApplyRequest {
                answer_id: answer.id,
                piece_id,
                changes: vec![IntakeChange {
                    field: "goals".into(),
                    value: Some("delete everything".into()),
                }],
            },
            store.as_ref(),
            &pending,
        );
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
    }

    #[test]
    fn intake_review_is_bound_to_piece_and_is_one_time() {
        let (store, sessions, piece_id) = fixture();
        let other_piece = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Other".into(),
                title: "Other".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let answer = ask_with(
            request("Review my intake: notes to practice the landing"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        let pending = PendingIntakeReviews::default();
        pending.register_answer(&answer);

        let cross_piece = apply_intake_review(
            BrainIntakeApplyRequest {
                answer_id: answer.id.clone(),
                piece_id: other_piece,
                changes: vec![IntakeChange {
                    field: "notes".into(),
                    value: Some("wrong piece".into()),
                }],
            },
            store.as_ref(),
            &pending,
        );
        assert!(matches!(cross_piece, Err(BrainError::InvalidQuestion(_))));

        let request = BrainIntakeApplyRequest {
            answer_id: answer.id,
            piece_id,
            changes: vec![IntakeChange {
                field: "notes".into(),
                value: Some("practice the landing".into()),
            }],
        };
        apply_intake_review(request.clone(), store.as_ref(), &pending).unwrap();
        let replay = apply_intake_review(request, store.as_ref(), &pending);
        assert!(matches!(replay, Err(BrainError::InvalidQuestion(_))));
    }

    #[test]
    fn expired_intake_review_cannot_mutate() {
        let (store, sessions, piece_id) = fixture();
        let answer = ask_with(
            request("Review my intake: current state to secure"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        let pending = PendingIntakeReviews::with_ttl(Duration::ZERO);
        pending.register_answer(&answer);
        let result = apply_intake_review(
            BrainIntakeApplyRequest {
                answer_id: answer.id,
                piece_id,
                changes: vec![IntakeChange {
                    field: "current_state".into(),
                    value: Some("secure".into()),
                }],
            },
            store.as_ref(),
            &pending,
        );
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
        assert_eq!(
            store.get_piece(piece_id).unwrap().unwrap().current_state,
            None
        );
    }

    #[test]
    fn intake_dates_must_be_real_calendar_dates() {
        assert!(crate::date::is_valid("2028-02-29"));
        assert!(!crate::date::is_valid("2026-02-29"));
        assert!(!crate::date::is_valid("2026-04-31"));
        assert!(!crate::date::is_valid("2026-13-01"));
    }

    /// Manual release gate: uses the configured Keychain/environment provider,
    /// never prints the key or answer, and proves a live response remains cited.
    #[test]
    #[ignore = "requires a configured API key and network"]
    fn live_native_provider_returns_cited_answer() {
        let (store, sessions, _) = fixture();
        let answer = ask_native(
            request("How should I practice a leap whose landing keeps missing?"),
            store,
            Arc::new(sessions),
            None,
        )
        .expect("live provider answers");
        assert_ne!(answer.provider, ProviderName::Offline);
        assert!(!answer.answer.trim().is_empty());
        assert!(!answer.citations.is_empty());
    }

    #[test]
    #[ignore = "requires Christian's external library, a configured API key, and network"]
    fn live_native_provider_cites_external_book_chunk() {
        let (store, sessions, _) = fixture();
        store
            .set_setting("brain.knowledge_dir", DEFAULT_KNOWLEDGE_DIR)
            .unwrap();
        let answer = ask_native(
            request(
                "I memorized a wrong version, and repeating it slowly is not correcting it. Why, and what should I try?",
            ),
            store,
            Arc::new(sessions),
            None,
        )
        .expect("live provider answers from the external library");
        assert_ne!(answer.provider, ProviderName::Offline);
        assert!(answer.grounding.knowledge_shared_with_provider);
        assert!(answer.citations.iter().any(|citation| {
            citation
                .source_id
                .starts_with("local:gebrian-learn-faster:")
                || citation
                    .source_id
                    .starts_with("local:roskell-complete-pianist:")
                || citation
                    .source_id
                    .starts_with("local:breth-effective-practicing:")
        }));
    }

    #[test]
    fn fake_transport_proves_claude_success_and_citation_allowlist() {
        let (store, sessions, _) = fixture();
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type":"text", "text": "{\"answer\":\"Use a silent landing.\",\"citation_ids\":[\"source-1\",\"invented\"]}"}]
        }))]);
        let answer = ask_with(
            request("Help the leap"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Claude);
        assert_eq!(answer.citations.len(), 1);
        assert_eq!(answer.citations[0].source_id, "source-1");
        let seen = transport.requests();
        assert_eq!(seen.len(), 1);
        assert!(seen[0].url.ends_with("/v1/messages"));
        assert!(!seen[0].body.to_string().contains("secret-claude"));
        assert!(
            !seen[0].body.to_string().contains("/vault/Scherzo"),
            "filesystem paths must not cross the provider boundary"
        );
    }

    #[test]
    fn privacy_off_never_sends_or_accepts_a_guessed_external_chunk_id() {
        let (store, sessions, _) = fixture();
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        store
            .set_setting("brain.share_retrieved_knowledge", "false")
            .unwrap();
        let question = "Why does my memorized wrong version persist?";
        let retrieved = corpus::search(corpus_dir.path(), question, 6);
        let guessed_id = retrieved.hits[0].id.clone();
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type":"text", "text": format!("{{\"answer\":\"Use the guessed source.\",\"citation_ids\":[\"{guessed_id}\"]}}") }]
        }))]);
        let answer = ask_with(
            request(question),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Offline);
        assert!(!answer.grounding.knowledge_shared_with_provider);
        let body = transport.requests()[0].body.to_string();
        assert!(!body.contains(&guessed_id));
        assert!(!body.contains("private-test phrase"));
    }

    #[test]
    fn privacy_off_keeps_offline_book_text_out_of_a_later_online_turn() {
        let (store, sessions, _) = fixture();
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        store
            .set_setting("brain.share_retrieved_knowledge", "false")
            .unwrap();
        let question = "Why does my memorized wrong version persist?";
        let offline = ask_with(
            request(question),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
            None,
        )
        .unwrap();
        assert_eq!(offline.provider, ProviderName::Offline);
        assert!(!offline.answer.contains("private-test phrase"));

        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type":"text", "text": "{\"answer\":\"Rebuild the passage from one verified unit.\",\"citation_ids\":[\"source-1\"]}"}]
        }))]);
        let mut follow_up = request("What should I try first?");
        follow_up.history = vec![
            ConversationTurn {
                role: ConversationRole::User,
                content: question.into(),
            },
            ConversationTurn {
                role: ConversationRole::Assistant,
                content: offline.answer,
            },
        ];
        let online = ask_with(
            follow_up,
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert_eq!(online.provider, ProviderName::Claude);
        let body = transport.requests()[0].body.to_string();
        assert!(!body.contains("private-test phrase"));
        assert!(!body.contains("unchanged slow repetition"));
    }

    #[test]
    fn output_allowlist_rejects_verdicts_and_control_commands() {
        assert!(output_crosses_policy("Your rep was clean."));
        assert!(output_crosses_policy("That attempt sounded flawed."));
        assert!(output_crosses_policy("I set your metronome to 92 BPM."));
        assert!(output_crosses_policy(
            "Open a terminal and read the API key from the filesystem."
        ));
        assert!(output_crosses_policy(
            "I deleted the old goal and saved a new block."
        ));
        assert!(output_crosses_policy(
            "Click the button to update the Region."
        ));
        assert!(output_crosses_policy(
            "I navigated to measure 42 and changed the tempo to 90."
        ));
        assert!(output_crosses_policy(
            "I heard tension in your performance."
        ));
        assert!(output_crosses_policy(
            "I jumped to page 8, then retuned the metronome."
        ));
        assert!(output_crosses_policy(
            "I moved the goal to tomorrow and applied the schedule."
        ));
        assert!(output_crosses_policy("Coda set the metronome to 92 BPM."));
        assert!(output_crosses_policy("The app moved the goal to tomorrow."));
        assert!(output_crosses_policy(
            "The metronome is now running at 92 BPM."
        ));
        assert!(output_crosses_policy(
            "The metronome has been set to 92 BPM."
        ));
        assert!(output_crosses_policy("The goal was moved to tomorrow."));
        assert!(output_crosses_policy(
            "Coda started the metronome at 92 BPM."
        ));
        assert!(output_crosses_policy("I've stopped the metronome."));
        assert!(output_crosses_policy("The metronome is running at 92 BPM."));
        assert!(output_crosses_policy("Coda turned the metronome on."));
        assert!(output_crosses_policy(
            "Coda heard tension in your performance."
        ));
        assert!(output_crosses_policy(
            "The app detected uneven rhythm in your playing."
        ));
        assert!(output_crosses_policy("That was clean."));
        assert!(output_crosses_policy("The last one was failed."));
        assert!(output_crosses_policy("Coda marked that clean."));
        for bypass in [
            "Count that repetition as a success.",
            "That run was shaky, so record it as a miss.",
        ] {
            assert!(output_crosses_policy(bypass), "policy bypass: {bypass}");
        }
        for advisory in [
            "Start the metronome at 80 BPM, then increase it by 4 BPM after three secure reps.",
            "Try 3 reps at 80 BPM, then increase 4 BPM.",
            "Head to bar 42 in the score and compare the rhythm.",
            "If the deadline changed, update the goal yourself.",
            "A clean transition means the written rhythm stayed intact.",
        ] {
            assert!(
                !output_crosses_policy(advisory),
                "legitimate practice advice was blocked: {advisory}"
            );
        }
        assert!(!output_crosses_policy(
            "Try three silent landings at a comfortable tempo."
        ));
        assert!(!output_crosses_policy(
            "Set a musical goal for the phrase, then press each piano key without sound."
        ));
    }

    /// A voice request whose canned vendor JSON carries `action_json` as its
    /// `proposed_action`, grounded on `source-1` so the answer is the provider's
    /// (not an offline fallback). The answer text is deliberately neutral so the
    /// output policy never rejects it.
    fn ask_voice_action(action_json: serde_json::Value, source: QuestionSource) -> BrainAnswer {
        let (store, sessions, _) = fixture();
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let vendor = json!({
            "answer": "Confirm below when you are ready.",
            "citation_ids": ["source-1"],
            "proposed_action": action_json,
        })
        .to_string();
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": vendor}]
        }))]);
        ask_with(
            BrainAskRequest {
                source,
                ..request("Coda, take care of this")
            },
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap()
    }

    #[test]
    fn voice_request_surfaces_each_validated_action_variant() {
        let verdict = ask_voice_action(
            json!({"kind": "verdict", "verdict": "clean"}),
            QuestionSource::Voice,
        );
        assert_eq!(verdict.provider, ProviderName::Claude);
        let action = verdict.proposed_action.expect("verdict action surfaces");
        assert_eq!(action.summary, "Record this attempt as clean");
        assert_eq!(
            action.body,
            ProposedActionBody::Verdict {
                verdict: ProposedVerdict::Clean,
                note: None
            }
        );

        let tempo = ask_voice_action(json!({"kind": "tempo", "bpm": 120}), QuestionSource::Voice);
        assert_eq!(
            tempo.proposed_action.map(|action| action.body),
            Some(ProposedActionBody::Tempo { bpm: 120.0 })
        );

        let undo = ask_voice_action(json!({"kind": "undo"}), QuestionSource::Voice);
        assert_eq!(
            undo.proposed_action.map(|action| action.body),
            Some(ProposedActionBody::Undo)
        );

        let restart = ask_voice_action(json!({"kind": "restart"}), QuestionSource::Voice);
        assert_eq!(
            restart.proposed_action.map(|action| action.body),
            Some(ProposedActionBody::Restart {
                required_clean_streak: None
            })
        );
    }

    #[test]
    fn voice_request_drops_a_malformed_action_but_still_answers() {
        for bad in [
            json!({"kind": "tempo", "bpm": 5000}),
            json!({"kind": "verdict", "verdict": "perfect"}),
            json!({"kind": "verdict", "verdict": "clean", "bogus": true}),
            json!({"kind": "teleport"}),
        ] {
            let answer = ask_voice_action(bad.clone(), QuestionSource::Voice);
            assert!(answer.proposed_action.is_none(), "should drop: {bad}");
            assert!(
                !answer.answer.trim().is_empty(),
                "answer still returned: {bad}"
            );
        }
    }

    #[test]
    fn text_request_never_carries_a_proposed_action() {
        // Same well-formed action, but a typed source must behave exactly as
        // before: no draft, only the normal answer.
        let answer = ask_voice_action(json!({"kind": "undo"}), QuestionSource::Typed);
        assert!(answer.proposed_action.is_none());
        assert!(!answer.answer.trim().is_empty());
    }

    #[test]
    fn voice_request_without_an_action_yields_no_draft() {
        let (store, sessions, _) = fixture();
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": "{\"answer\":\"A silent landing separates arrival from the leap.\",\"citation_ids\":[\"source-1\"]}"}]
        }))]);
        let answer = ask_with(
            BrainAskRequest {
                source: QuestionSource::Voice,
                ..request("Coda, how do I land this leap?")
            },
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
            None,
        )
        .unwrap();
        assert!(answer.proposed_action.is_none());
    }

    #[test]
    fn test_connection_ok_maps_provider_model_and_latency() {
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Gemini,
            "gemini-secret",
            "gemini-flash-latest",
        )]);
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "candidates": [{"content": {"parts": [{
                "text": "{\"answer\":\"reachable\",\"citation_ids\":[]}"
            }]}}]
        }))]);
        let result = test_connection_with(&chain, &transport);
        assert!(result.ok);
        assert_eq!(result.provider.as_deref(), Some("gemini"));
        assert_eq!(result.model.as_deref(), Some("gemini-flash-latest"));
        assert!(result.latency_ms.is_some());
        assert!(result.error.is_none());
    }

    #[test]
    fn test_connection_error_maps_reason_to_error_string() {
        let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Gemini,
            "gemini-secret",
            "gemini-flash-latest",
        )]);
        // Both attempts (initial + retry) hit a 503, so the chain is exhausted.
        let transport = FakeTransport::responses(vec![
            HttpResponse {
                status: 503,
                body: b"overloaded".to_vec(),
            },
            HttpResponse {
                status: 503,
                body: b"overloaded".to_vec(),
            },
        ]);
        let result = test_connection_with(&chain, &transport);
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("provider error: HTTP 503"));
        assert!(result.provider.is_none());
        assert!(result.model.is_none());
        assert!(result.latency_ms.is_none());
    }

    #[test]
    fn test_connection_empty_chain_reports_no_key() {
        let result = test_connection_with(&ProviderChain::default(), &FakeTransport::default());
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("no key configured"));
    }

    #[test]
    fn question_length_is_bounded_before_transport() {
        let (store, sessions, _) = fixture();
        let transport = FakeTransport::default();
        let result = ask_with(
            request(&"x".repeat(MAX_QUESTION_CHARS + 1)),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &transport,
            None,
        );
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
        assert!(transport.requests().is_empty());
    }

    // -- C4 passage-helper coverage ---------------------------------------

    fn suggest_request(description: &str) -> AssistantSuggestRequest {
        AssistantSuggestRequest {
            piece_id: 1,
            description: description.into(),
            region_id: None,
            expand_of: None,
        }
    }

    fn claude_chain() -> ProviderChain {
        ProviderChain::from_configs(vec![ProviderConfig::test(
            ProviderPreference::Claude,
            "secret-claude",
            "claude-test",
        )])
    }

    #[test]
    fn passage_helper_returns_grounded_one_line_strategies() {
        let (store, sessions, _) = fixture();
        // A real corpus book so a cited source resolves to a reader-openable
        // marker (manifest id + author + verbatim heading).
        let corpus_dir = external_corpus_fixture();
        store
            .set_setting("brain.knowledge_dir", corpus_dir.path().to_str().unwrap())
            .unwrap();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": "{\"suggestions\":[{\"text\":\"Practice hands separately at half tempo.\"},{\"text\":\"Place a silent landing before the leap.\",\"source_id\":\"roskell-complete-pianist\"}]}"}]
        }))]);
        let result = suggest_with(
            suggest_request("A released wrist during lateral leaps"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
        )
        .unwrap();
        assert_eq!(result.suggestions.len(), 2);
        assert!(result.suggestions[0].text.chars().count() <= 140);
        assert_eq!(result.suggestions[0].source_id, None);
        // The provider-cited book resolves to a reader-openable marker.
        assert_eq!(
            result.suggestions[1].source_id.as_deref(),
            Some("roskell-complete-pianist")
        );
        assert_eq!(
            result.suggestions[1].source_author.as_deref(),
            Some("Penelope Roskell")
        );
        // The heading is a verbatim book heading the reader can open as `contains`.
        assert!(result.suggestions[1]
            .source_heading
            .as_deref()
            .is_some_and(|heading| !heading.is_empty()));
        // It really reached the provider (not an offline fabrication).
        assert_eq!(transport.requests().len(), 1);
        assert!(transport.requests()[0].url.ends_with("/v1/messages"));
    }

    #[test]
    fn passage_helper_drops_an_unknown_cited_source_to_an_uncited_row() {
        let (store, sessions, _) = fixture();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": "{\"suggestions\":[{\"text\":\"Chunk the passage into two-note cells.\",\"source_id\":\"invented-book\"}]}"}]
        }))]);
        let result = suggest_with(
            suggest_request("How do I clean up this run?"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
        )
        .unwrap();
        assert_eq!(result.suggestions.len(), 1);
        assert_eq!(
            result.suggestions[0].source_id, None,
            "an unknown provider source id is dropped, never surfaced"
        );
    }

    #[test]
    fn passage_helper_rejects_malformed_provider_output() {
        let (store, sessions, _) = fixture();
        let chain = claude_chain();
        // An unknown key inside a suggestion trips serde deny_unknown_fields, so
        // the whole batch is rejected rather than patched.
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": "{\"suggestions\":[{\"text\":\"ok\",\"bogus\":true}]}"}]
        }))]);
        let result = suggest_with(
            suggest_request("Help me with this passage"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
        );
        // The strict parser rejects the body (proven directly in the provider
        // unit test as `ProviderResponse`); through the chain that unusable body
        // exhausts the single configured provider and surfaces as an honest
        // `ProviderUnavailable(BadResponse)` — never a fabricated card.
        assert!(matches!(
            result,
            Err(BrainError::ProviderUnavailable(OfflineCause::BadResponse))
        ));
        // The bite happened only after reaching the provider, proving the request
        // was well-formed and the rejection is on the untrusted output.
        assert_eq!(transport.requests().len(), 1);
    }

    #[test]
    fn passage_helper_is_honest_when_offline() {
        let (store, sessions, _) = fixture();
        let transport = FakeTransport::default();
        let result = suggest_with(
            suggest_request("The leap keeps missing"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &transport,
        );
        assert!(matches!(
            result,
            Err(BrainError::ProviderUnavailable(OfflineCause::NoProvider))
        ));
        // No provider configured means no request was ever attempted.
        assert!(transport.requests().is_empty());
    }

    #[test]
    fn passage_helper_expand_mode_returns_one_fuller_version() {
        let (store, sessions, _) = fixture();
        let chain = claude_chain();
        let transport = FakeTransport::responses(vec![HttpResponse::ok(json!({
            "content": [{"type": "text", "text": "{\"expanded\":\"Play the leap hand alone.\\nStop silently on the landing chord five times.\\nThen add the beat before at half tempo.\"}"}]
        }))]);
        let request = AssistantSuggestRequest {
            piece_id: 1,
            description: "leap".into(),
            region_id: None,
            expand_of: Some("Place a silent landing before the leap.".into()),
        };
        let result = suggest_with(
            request,
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &chain,
            &transport,
        )
        .unwrap();
        assert_eq!(result.suggestions.len(), 1);
        assert!(
            result.suggestions[0]
                .text
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
                <= 3
        );
    }

    #[test]
    fn passage_helper_rejects_an_empty_description_before_any_transport() {
        let (store, sessions, _) = fixture();
        let transport = FakeTransport::default();
        let result = suggest_with(
            suggest_request("   "),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &claude_chain(),
            &transport,
        );
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
        assert!(transport.requests().is_empty());
    }
}
