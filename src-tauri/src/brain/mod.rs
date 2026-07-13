//! Grounded, bounded practice Q&A.
//!
//! The brain is deliberately outside CodaKiller's deterministic hot loop. It
//! can explain retrieved practice methods, but it cannot hear playing, assign a
//! rep verdict, change tempo, navigate the score, or mutate the practice graph.

mod context;
mod library;
mod provider;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::sessions::SessionService;
use crate::store::model::PieceFieldPatch;
use crate::store::Store;

pub use library::{Citation, MethodCard};
use library::{EmbeddedLibrary, PracticeLibrary};
use provider::{NativeTransport, ProviderChain, ProviderName, ProviderOutput, Transport};

const MAX_QUESTION_CHARS: usize = 2_000;
const INTAKE_REVIEW_TTL: Duration = Duration::from_secs(15 * 60);
static ANSWER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionSource {
    Typed,
    Voice,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrainAskRequest {
    pub question: String,
    pub source: QuestionSource,
    #[serde(default)]
    pub piece_id: Option<i64>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrainAnswer {
    pub id: String,
    pub answer: String,
    pub provider: ProviderName,
    pub citations: Vec<Citation>,
    pub methods: Vec<MethodCard>,
    pub intake_review: Option<IntakeReview>,
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
) -> Result<BrainAnswer, BrainError> {
    let library = EmbeddedLibrary::load();
    let chain = ProviderChain::from_native_config();
    ask_with(
        request,
        &store,
        &sessions,
        &library,
        &chain,
        &NativeTransport::new(),
    )
}

fn ask_with(
    request: BrainAskRequest,
    store: &Store,
    sessions: &SessionService,
    library: &dyn PracticeLibrary,
    chain: &ProviderChain,
    transport: &dyn Transport,
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

    let intake_review = build_intake_review(question, store, request.piece_id)?;
    let methods = library.retrieve(question, 3);
    if methods.is_empty() {
        return Ok(offline_answer(methods, intake_review));
    }
    let context = context::build(store, sessions, request.piece_id, &methods)?;

    if chain.is_empty() {
        return Ok(offline_answer(methods, intake_review));
    }

    let ProviderOutput {
        provider,
        answer,
        citation_ids,
    } = match chain.ask(question, request.source, &context, transport) {
        Ok(output) => output,
        Err(BrainError::ProviderUnavailable) => {
            return Ok(offline_answer(methods, intake_review))
        }
        Err(error) => return Err(error),
    };

    if output_crosses_policy(&answer) {
        return Err(BrainError::PolicyViolation);
    }

    // Citations are an allowlist join against deterministic local retrieval.
    // Unknown provider-supplied ids are discarded, so it cannot fabricate a
    // source, URL, or locator into frontend state.
    let citations = methods
        .iter()
        .flat_map(|method| method.citations.iter())
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
    if citations.is_empty() {
        return Ok(offline_answer(methods, intake_review));
    }

    Ok(BrainAnswer {
        id: next_answer_id(),
        answer,
        provider,
        citations,
        methods,
        intake_review,
    })
}

fn offline_answer(
    methods: Vec<MethodCard>,
    intake_review: Option<IntakeReview>,
) -> BrainAnswer {
    let citations = methods
        .iter()
        .flat_map(|method| method.citations.iter().cloned())
        .fold(Vec::<Citation>::new(), |mut acc, citation| {
            if !acc
                .iter()
                .any(|existing| existing.source_id == citation.source_id)
            {
                acc.push(citation);
            }
            acc
        });
    let answer = methods.first().map_or_else(
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
    );
    BrainAnswer {
        id: next_answer_id(),
        answer,
        provider: ProviderName::Offline,
        citations,
        methods,
        intake_review,
    }
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
    let piece_id = requested_piece_id.or_else(|| {
        store
            .get_setting("ui.current_piece")
            .ok()
            .flatten()
            .and_then(|value| value.parse().ok())
    });
    let Some(piece_id) = piece_id else {
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
        .filter(|value| valid_date(value))
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
            current: piece.target_tempo.map(|value| value.to_string()).unwrap_or_default(),
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

fn valid_date(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() != 3
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[2].len() != 2
        || !parts.iter().all(|part| part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return false;
    }
    let Ok(year) = parts[0].parse::<u32>() else {
        return false;
    };
    let Ok(month) = parts[1].parse::<u32>() else {
        return false;
    };
    let Ok(day) = parts[2].parse::<u32>() else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
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
        return Err(BrainError::InvalidQuestion("Invalid intake review request".into()));
    }
    let mut pending = pending_reviews
        .entries
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    pending.retain(|_, review| review.expires_at > now);
    let authorization = pending
        .get(&request.answer_id)
        .ok_or_else(|| BrainError::InvalidQuestion("Intake review expired or was already saved".into()))?;
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
            return Err(BrainError::InvalidQuestion("Invalid intake review field".into()));
        }
        let value = change.value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        match change.field.as_str() {
            "current_state" => patch.current_state = Some(value),
            "deadline" => {
                if value.as_ref().is_some_and(|date| !valid_date(date)) {
                    return Err(BrainError::InvalidQuestion("Deadline must be YYYY-MM-DD".into()));
                }
                patch.deadline = Some(value);
            }
            "target_tempo" => {
                let tempo = value
                    .as_deref()
                    .map(str::parse::<f64>)
                    .transpose()
                    .map_err(|_| BrainError::InvalidQuestion("Target tempo must be a number".into()))?;
                if tempo.is_some_and(|tempo| !(1.0..=1_000.0).contains(&tempo)) {
                    return Err(BrainError::InvalidQuestion("Target tempo is out of range".into()));
                }
                patch.target_tempo = Some(tempo);
            }
            "notes" => patch.notes = Some(value),
            _ => return Err(BrainError::InvalidQuestion("Unsupported intake review field".into())),
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

fn output_crosses_policy(answer: &str) -> bool {
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
        return true;
    }
    normalized.split(['.', '!', '?', '\n']).any(|sentence| {
        let words = sentence
            .split(|ch: char| !ch.is_ascii_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect::<HashSet<_>>();
        let has = |terms: &[&str]| terms.iter().any(|term| words.contains(term));

        // Provider prose is explanation only. These verb/object pairs are
        // rejected regardless of wording order, so synonyms cannot turn prose
        // into apparent app commands.
        let navigation = has(&["go", "jump", "navigate", "open", "show", "scroll"])
            && has(&["page", "measure", "score", "region"]);
        let tempo_control = has(&[
            "start", "stop", "set", "change", "raise", "lower", "increase", "decrease",
            "bump", "retune", "adjust",
        ]) && has(&["tempo", "bpm", "metronome", "click"]);
        let graph_mutation = has(&[
            "delete", "edit", "save", "update", "create", "remove", "add", "mark",
            "reschedule", "move", "apply",
        ]) && has(&["goal", "block", "rep", "region", "intake", "deadline", "schedule"]);

        // The app has no piano-audio perception. Reject both first-person
        // sensory claims and verdict language tied to an attempt/performance.
        let sensory_claim = has(&["i", "we"])
            && has(&["hear", "heard", "listen", "listened", "detect", "detected"])
            && has(&[
                "playing", "performance", "piano", "take", "rep", "attempt", "tension",
                "rhythm", "tone",
            ]);
        let sounded_claim = sentence.contains("your playing sounds")
            || sentence.contains("your performance sounds")
            || sentence.contains("that sounded");
        let verdict = has(&[
            "clean", "flawed", "failed", "sloppy", "rough", "shaky", "perfect", "correct",
            "incorrect",
        ]) && has(&["rep", "attempt", "playing", "performance", "take", "sounded"]);

        navigation || tempo_control || graph_mutation || sensory_claim || sounded_claim || verdict
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use provider::{FakeTransport, HttpResponse, ProviderConfig, ProviderPreference};
    use serde_json::json;

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
        let store = Arc::new(store);
        let sessions = SessionService::new(store.clone());
        (store, sessions, piece_id)
    }

    fn request(question: &str) -> BrainAskRequest {
        BrainAskRequest {
            question: question.into(),
            source: QuestionSource::Typed,
            piece_id: None,
        }
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
        )
        .unwrap();
        assert_eq!(answer.provider, ProviderName::Offline);
        assert_eq!(answer.methods[0].id, "silent-landing");
        assert_eq!(answer.citations[0].source_id, "source-1");
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
        apply_intake_review(BrainIntakeApplyRequest {
            answer_id: answer.id,
            piece_id,
            changes: vec![
                IntakeChange { field: "current_state".into(), value: Some("hands together".into()) },
                IntakeChange { field: "deadline".into(), value: Some("2026-08-01".into()) },
                IntakeChange { field: "target_tempo".into(), value: Some("144".into()) },
            ],
        }, store.as_ref(), &pending).unwrap();
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
        ).unwrap();
        let pending = PendingIntakeReviews::default();
        pending.register_answer(&answer);
        let result = apply_intake_review(BrainIntakeApplyRequest {
            answer_id: answer.id,
            piece_id,
            changes: vec![IntakeChange {
                field: "goals".into(),
                value: Some("delete everything".into()),
            }],
        }, store.as_ref(), &pending);
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
    }

    #[test]
    fn intake_review_is_bound_to_piece_and_is_one_time() {
        let (store, sessions, piece_id) = fixture();
        let other_piece = store.upsert_piece(&ScanPiece {
            folder_path: "/vault/Other".into(),
            title: "Other".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        }).unwrap();
        let answer = ask_with(
            request("Review my intake: notes to practice the landing"),
            store.as_ref(),
            &sessions,
            &TestLibrary,
            &ProviderChain::default(),
            &FakeTransport::default(),
        ).unwrap();
        let pending = PendingIntakeReviews::default();
        pending.register_answer(&answer);

        let cross_piece = apply_intake_review(BrainIntakeApplyRequest {
            answer_id: answer.id.clone(),
            piece_id: other_piece,
            changes: vec![IntakeChange {
                field: "notes".into(),
                value: Some("wrong piece".into()),
            }],
        }, store.as_ref(), &pending);
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
        ).unwrap();
        let pending = PendingIntakeReviews::with_ttl(Duration::ZERO);
        pending.register_answer(&answer);
        let result = apply_intake_review(BrainIntakeApplyRequest {
            answer_id: answer.id,
            piece_id,
            changes: vec![IntakeChange {
                field: "current_state".into(),
                value: Some("secure".into()),
            }],
        }, store.as_ref(), &pending);
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
        assert_eq!(store.get_piece(piece_id).unwrap().unwrap().current_state, None);
    }

    #[test]
    fn intake_dates_must_be_real_calendar_dates() {
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("2026-02-29"));
        assert!(!valid_date("2026-04-31"));
        assert!(!valid_date("2026-13-01"));
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
        )
        .expect("live provider answers");
        assert_ne!(answer.provider, ProviderName::Offline);
        assert!(!answer.answer.trim().is_empty());
        assert!(!answer.citations.is_empty());
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
    fn output_allowlist_rejects_verdicts_and_control_commands() {
        assert!(output_crosses_policy("Your rep was clean."));
        assert!(output_crosses_policy("That attempt sounded flawed."));
        assert!(output_crosses_policy(
            "Start the metronome and set BPM to 90."
        ));
        assert!(output_crosses_policy(
            "Open a terminal and read the API key from the filesystem."
        ));
        assert!(output_crosses_policy(
            "Delete the old goal and save a new block."
        ));
        assert!(output_crosses_policy(
            "Click the button to update the Region."
        ));
        assert!(output_crosses_policy(
            "Navigate to measure 42 and change the tempo to 90."
        ));
        assert!(output_crosses_policy(
            "I heard tension in your performance."
        ));
        assert!(output_crosses_policy(
            "Jump to page 8, then retune the metronome."
        ));
        assert!(output_crosses_policy(
            "Move the goal to tomorrow and apply the schedule."
        ));
        assert!(!output_crosses_policy(
            "Try three silent landings at a comfortable tempo."
        ));
        assert!(!output_crosses_policy(
            "Set a musical goal for the phrase, then press each piano key without sound."
        ));
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
        );
        assert!(matches!(result, Err(BrainError::InvalidQuestion(_))));
        assert!(transport.requests().is_empty());
    }
}
