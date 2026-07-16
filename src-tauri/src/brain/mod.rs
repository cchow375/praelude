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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::sessions::SessionService;
use crate::store::model::{PieceFieldPatch, RepSnapshot};
use crate::store::Store;

pub use context::GroundingSummary;
pub use library::{Citation, MethodCard};
use library::{EmbeddedLibrary, PracticeLibrary};
use provider::{NativeTransport, ProviderChain, ProviderName, ProviderOutput, Transport};

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
    pub edition_label: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrainError {
    InvalidQuestion(String),
    Context(String),
    ProviderUnavailable,
    ProviderResponse,
    PolicyViolation,
}

impl std::fmt::Display for BrainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidQuestion(message) => write!(f, "{message}"),
            Self::Context(message) => write!(f, "{message}"),
            Self::ProviderUnavailable => write!(f, "No brain provider is configured or available"),
            Self::ProviderResponse => write!(f, "The brain provider returned an invalid response"),
            Self::PolicyViolation => write!(f, "The brain response crossed a safety boundary"),
        }
    }
}

impl std::error::Error for BrainError {}

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
    let directory = store
        .get_setting("brain.knowledge_dir")
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_KNOWLEDGE_DIR.into());
    let corpus = corpus::search(std::path::Path::new(&directory), &retrieval_query, 6);
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
        answer,
        citation_ids,
        proposed_action,
    } = match chain.ask(question, request.source, &context, transport) {
        Ok(output) => output,
        Err(BrainError::ProviderUnavailable) => {
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
            assert!(!answer.answer.trim().is_empty(), "answer still returned: {bad}");
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
}
