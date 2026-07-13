#[path = "../src/knowledge/mod.rs"]
mod knowledge;

use knowledge::{MethodTier, PracticeLibrary, SourceKind, PRACTICE_METHODS_JSON};
use std::collections::HashSet;

#[test]
fn release_asset_is_validated_before_use() {
    let library = PracticeLibrary::from_embedded().expect("release knowledge must validate");
    assert_eq!(library.schema_version, 1);
    assert_eq!(library.library_id, "codakiller.practice_methods");
    assert!(PRACTICE_METHODS_JSON.len() > 20_000);
}

#[test]
fn all_28_methods_are_unique_cited_and_routable() {
    let library = PracticeLibrary::from_embedded().expect("release knowledge must validate");
    let ids: HashSet<_> = library.methods.iter().map(|method| &method.id).collect();
    assert_eq!(ids.len(), 28);
    assert!(library
        .methods
        .iter()
        .all(|method| !method.citation_ids.is_empty()));
}

#[test]
fn psychology_layer_uses_only_primary_or_authoritative_sources() {
    let library = PracticeLibrary::from_embedded().expect("release knowledge must validate");
    for principle in &library.psychology_principles {
        for citation in &principle.citation_ids {
            let source = library.source(citation).expect("validated source link");
            assert!(matches!(
                source.kind,
                SourceKind::PrimaryStudy | SourceKind::AuthoritativeGuidance
            ));
        }
    }
}

#[test]
fn safety_advice_is_single_purpose_and_health_cited() {
    let library = PracticeLibrary::from_embedded().expect("release knowledge must validate");
    let safety: Vec<_> = library
        .methods
        .iter()
        .filter(|method| method.tier == MethodTier::Safety)
        .collect();
    assert_eq!(safety.len(), 1);
    assert_eq!(safety[0].id, "tension");
    assert!(safety[0]
        .citation_ids
        .iter()
        .all(|id| id.starts_with("bapam_")));
}

#[test]
fn route_alias_returns_primary_then_alternates() {
    let library = PracticeLibrary::from_embedded().expect("release knowledge must validate");
    let route = library
        .route_for_query("can't get it even")
        .expect("human alias resolves");
    let ids: Vec<_> = library
        .methods_for_route(route)
        .into_iter()
        .map(|method| method.id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "dotted",
            "rhythmic_groups",
            "slow_meta",
            "staccato",
            "chunk"
        ]
    );
}
