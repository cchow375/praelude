use serde::{Deserialize, Serialize};

/// A source that the frontend can show and the user can follow independently.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Citation {
    pub source_id: String,
    pub label: String,
    pub excerpt: String,
    pub url: String,
}

/// A deterministic practice-method card. `citations` is backend-only source
/// metadata; the wire contract uses `source_ids`, while the answer has the
/// de-duplicated citation records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MethodCard {
    pub id: String,
    pub name: String,
    pub why: String,
    pub dose: String,
    pub watch_for: String,
    #[serde(default, skip_serializing)]
    pub citations: Vec<Citation>,
}

/// Retrieval and provider transport are separate boundaries. The embedded
/// graph implements this trait in production; tests use tiny in-memory cards.
pub trait PracticeLibrary: Send + Sync {
    fn retrieve(&self, question: &str, limit: usize) -> Vec<MethodCard>;
}

/// Loaded once per request for now. The loader intentionally fails closed to an
/// empty library: malformed bundled knowledge must never become uncited prose.
pub struct EmbeddedLibrary {
    cards: Vec<IndexedMethod>,
}

#[derive(Debug, Clone)]
struct IndexedMethod {
    card: MethodCard,
    search_terms: Vec<String>,
}

impl EmbeddedLibrary {
    pub fn load() -> Self {
        // v9 deliberately ships as a blank practice template. Practice methods
        // may be entered by a user later, but no authored library is compiled
        // into the application binary.
        Self { cards: Vec::new() }
    }
}

impl PracticeLibrary for EmbeddedLibrary {
    fn retrieve(&self, question: &str, limit: usize) -> Vec<MethodCard> {
        let tokens = tokens(question);
        let mut scored = self
            .cards
            .iter()
            .filter_map(|indexed| {
                let score = indexed
                    .search_terms
                    .iter()
                    .map(|term| tokens.iter().filter(|token| *token == term).count())
                    .sum::<usize>();
                (score > 0).then_some((score, &indexed.card))
            })
            .collect::<Vec<_>>();
        scored.sort_by(|(score_a, card_a), (score_b, card_b)| {
            score_b.cmp(score_a).then_with(|| card_a.id.cmp(&card_b.id))
        });
        scored
            .into_iter()
            .take(limit)
            .map(|(_, card)| card.clone())
            .collect()
    }
}

fn tokens(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.len() >= 3)
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retrieval_tie_break_is_stable_by_id() {
        let card = |id: &str| IndexedMethod {
            card: MethodCard {
                id: id.into(),
                name: id.into(),
                why: String::new(),
                dose: String::new(),
                watch_for: String::new(),
                citations: Vec::new(),
            },
            search_terms: vec!["leap".into()],
        };
        let library = EmbeddedLibrary {
            cards: vec![card("z-method"), card("a-method")],
        };
        let ids = library
            .retrieve("leap", 3)
            .into_iter()
            .map(|method| method.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["a-method", "z-method"]);
    }

    #[test]
    fn production_library_is_intentionally_blank() {
        let library = EmbeddedLibrary::load();
        assert!(library.cards.is_empty());
        assert!(library
            .retrieve("My leap keeps missing its landing", 3)
            .is_empty());
    }
}
