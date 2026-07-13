use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::knowledge::PracticeLibrary as KnowledgeLibrary;

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
        let Ok(asset) = KnowledgeLibrary::from_embedded() else {
            return Self { cards: Vec::new() };
        };

        let citations = asset
            .sources
            .iter()
            .map(|source| {
                (
                    source.id.clone(),
                    Citation {
                        source_id: source.id.clone(),
                        label: format!("{} ({})", source.title, source.year),
                        excerpt: source.claim_scope.clone(),
                        url: source.url.clone(),
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        let mut route_terms: HashMap<String, HashSet<String>> = HashMap::new();
        for route_id in asset.routes.iter().map(|route| route.id.as_str()) {
            let Some(route) = asset.route_for_query(route_id) else {
                continue;
            };
            let terms = tokens(&format!(
                "{} {} {}",
                route.id,
                route.label,
                route.aliases.join(" ")
            ))
            .into_iter()
            .collect::<HashSet<_>>();
            for method in asset.methods_for_route(route) {
                route_terms
                    .entry(method.id.clone())
                    .or_default()
                    .extend(terms.iter().cloned());
            }
        }

        let mut cards = asset
            .methods
            .iter()
            .map(|method| {
                let source_ids = &method.citation_ids;
                let method_citations = source_ids
                    .iter()
                    .filter_map(|id| citations.get(id).cloned())
                    .collect();
                let mut search_terms = tokens(&format!(
                    "{} {} {:?} {} {}",
                    method.id,
                    method.name,
                    method.tier,
                    method.symptom_ids.join(" "),
                    method.passage_types.join(" ")
                ));
                search_terms.extend(route_terms.remove(&method.id).unwrap_or_default());
                IndexedMethod {
                    card: MethodCard {
                        id: method.id.clone(),
                        name: method.name.clone(),
                        why: method.method.clone(),
                        dose: method.dose.clone(),
                        watch_for: method.watch_for.clone(),
                        citations: method_citations,
                    },
                    search_terms,
                }
            })
            .collect::<Vec<_>>();

        cards.extend(asset.psychology_principles.iter().map(|principle| {
            let source_ids = &principle.citation_ids;
            let principle_citations = source_ids
                .iter()
                .filter_map(|id| citations.get(id).cloned())
                .collect();
            IndexedMethod {
                search_terms: tokens(&format!(
                    "{} {} {}",
                    principle.id,
                    principle.title,
                    principle.triggers.join(" ")
                )),
                card: MethodCard {
                    id: format!("psychology:{}", principle.id),
                    name: principle.title.clone(),
                    why: principle.practice.clone(),
                    dose: principle.dose.clone(),
                    watch_for: principle.watch_for.clone(),
                    citations: principle_citations,
                },
            }
        }));

        Self { cards }
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
    fn embedded_graph_loads_and_retrieves_a_cited_leap_method() {
        let library = EmbeddedLibrary::load();
        assert_eq!(library.cards.len(), 38, "28 methods + 10 psychology cards");
        let methods = library.retrieve("My leap keeps missing its landing", 3);
        assert!(!methods.is_empty());
        assert!(methods.iter().any(|method| method.id == "blocking"));
        assert!(methods.iter().all(|method| !method.citations.is_empty()));
    }
}
