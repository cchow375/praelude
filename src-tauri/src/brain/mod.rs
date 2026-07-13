//! Grounded, bounded practice Q&A.
//!
//! The brain is deliberately outside CodaKiller's deterministic hot loop. It
//! can explain retrieved practice methods, but it cannot hear playing, assign a
//! rep verdict, change tempo, navigate the score, or mutate the practice graph.

mod context;
mod library;
mod provider;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::sessions::SessionService;
use crate::store::Store;

pub use library::{Citation, MethodCard};
use library::{EmbeddedLibrary, PracticeLibrary};
use provider::{NativeTransport, ProviderChain, ProviderName, ProviderOutput, Transport};

const MAX_QUESTION_CHARS: usize = 2_000;
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

    let methods = library.retrieve(question, 3);
    if methods.is_empty() {
        return Ok(offline_answer(methods));
    }
    let context = context::build(store, sessions, request.piece_id, &methods)?;

    if chain.is_empty() {
        return Ok(offline_answer(methods));
    }

    let ProviderOutput {
        provider,
        answer,
        citation_ids,
    } = match chain.ask(question, request.source, &context, transport) {
        Ok(output) => output,
        Err(BrainError::ProviderUnavailable) => return Ok(offline_answer(methods)),
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
        return Ok(offline_answer(methods));
    }

    Ok(BrainAnswer {
        id: next_answer_id(),
        answer,
        provider,
        citations,
        methods,
        intake_review: None,
    })
}

fn offline_answer(methods: Vec<MethodCard>) -> BrainAnswer {
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
        || "No online brain provider is configured, and the local library has no grounded match for this question.".to_string(),
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
        intake_review: None,
    }
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
    let fixed_phrases = [
        "your rep was clean",
        "your rep was flawed",
        "your rep failed",
        "mark the rep clean",
        "mark the rep flawed",
        "mark the rep failed",
        "start the metronome",
        "stop the metronome",
        "set the tempo",
        "set bpm",
        "increase the bpm",
        "decrease the bpm",
        "raise the bpm",
        "lower the bpm",
        "go to page",
        "go to measure",
        "update your intake",
        "save this change",
        "reschedule",
    ];
    if fixed_phrases
        .iter()
        .any(|phrase| normalized.contains(phrase))
    {
        return true;
    }
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
    let mutation_verbs = ["delete", "edit", "save", "update", "create", "remove"];
    let graph_objects = ["goal", "block", "rep", "region"];
    if normalized.split(['.', '!', '?', '\n']).any(|sentence| {
        mutation_verbs.iter().any(|word| sentence.contains(word))
            && graph_objects.iter().any(|word| sentence.contains(word))
    }) {
        return true;
    }
    let verdicts = ["clean", "flawed", "failed"];
    let attempt_terms = ["rep", "attempt", "playing", "performance", "sounded"];
    normalized.split(['.', '!', '?', '\n']).any(|sentence| {
        verdicts.iter().any(|word| sentence.contains(word))
            && attempt_terms.iter().any(|word| sentence.contains(word))
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
