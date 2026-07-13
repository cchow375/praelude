//! Validated, cited practice knowledge for the P5 brain.
//!
//! The library is deliberately data-first. It can be embedded in a release with
//! `include_str!`, queried without a model, and passed to an LLM only after the
//! model has been given the relevant route. Nothing here grades piano audio.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fmt;

pub const PRACTICE_METHODS_JSON: &str =
    include_str!("../../assets/knowledge/practice_methods.json");

#[derive(Debug, Deserialize)]
pub struct PracticeLibrary {
    pub schema_version: u32,
    pub library_id: String,
    pub title: String,
    pub editorial_policy: EditorialPolicy,
    pub routes: Vec<SymptomRoute>,
    pub methods: Vec<PracticeMethod>,
    pub psychology_principles: Vec<PsychologyPrinciple>,
    pub sources: Vec<Source>,
}

#[derive(Debug, Deserialize)]
pub struct EditorialPolicy {
    pub sensor_rule: String,
    pub advice_rule: String,
    pub dose_rule: String,
    pub safety_rule: String,
}

#[derive(Debug, Deserialize)]
pub struct SymptomRoute {
    pub id: String,
    pub label: String,
    pub aliases: Vec<String>,
    pub primary_method_ids: Vec<String>,
    pub alternate_method_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PracticeMethod {
    pub id: String,
    pub name: String,
    pub tier: MethodTier,
    pub symptom_ids: Vec<String>,
    pub passage_types: Vec<String>,
    pub method: String,
    pub dose: String,
    pub watch_for: String,
    pub citation_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MethodTier {
    Primary,
    Alternate,
    Targeted,
    Safety,
}

#[derive(Debug, Deserialize)]
pub struct PsychologyPrinciple {
    pub id: String,
    pub title: String,
    pub triggers: Vec<String>,
    pub practice: String,
    pub dose: String,
    pub watch_for: String,
    pub evidence_note: String,
    pub citation_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct Source {
    pub id: String,
    pub kind: SourceKind,
    pub title: String,
    pub authors: Vec<String>,
    pub year: u16,
    pub venue: String,
    pub identifier: String,
    pub url: String,
    pub claim_scope: String,
    pub limitations: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    AuthoritativeBook,
    PrimaryStudy,
    AuthoritativeGuidance,
}

#[derive(Debug, Eq, PartialEq)]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

impl ValidationIssue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug)]
pub enum LibraryError {
    Parse(serde_json::Error),
    Invalid(Vec<ValidationIssue>),
}

impl fmt::Display for LibraryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse(error) => write!(f, "practice library JSON is invalid: {error}"),
            Self::Invalid(issues) => {
                write!(
                    f,
                    "practice library has {} validation issue(s)",
                    issues.len()
                )
            }
        }
    }
}

impl std::error::Error for LibraryError {}

impl PracticeLibrary {
    /// Parse and validate the release-embedded library.
    pub fn from_embedded() -> Result<Self, LibraryError> {
        let library: Self =
            serde_json::from_str(PRACTICE_METHODS_JSON).map_err(LibraryError::Parse)?;
        let issues = library.validation_issues();
        if issues.is_empty() {
            Ok(library)
        } else {
            Err(LibraryError::Invalid(issues))
        }
    }

    /// Resolve a route by stable id, label, or exact human alias.
    pub fn route_for_query(&self, query: &str) -> Option<&SymptomRoute> {
        let query = normalize(query);
        self.routes.iter().find(|route| {
            normalize(&route.id) == query
                || normalize(&route.label) == query
                || route.aliases.iter().any(|alias| normalize(alias) == query)
        })
    }

    /// Return primary methods followed by alternates, preserving curated order.
    pub fn methods_for_route<'a>(&'a self, route: &SymptomRoute) -> Vec<&'a PracticeMethod> {
        let methods: HashMap<&str, &PracticeMethod> = self
            .methods
            .iter()
            .map(|method| (method.id.as_str(), method))
            .collect();
        route
            .primary_method_ids
            .iter()
            .chain(&route.alternate_method_ids)
            .filter_map(|id| methods.get(id.as_str()).copied())
            .collect()
    }

    pub fn source(&self, id: &str) -> Option<&Source> {
        self.sources.iter().find(|source| source.id == id)
    }

    /// Validate all stable ids and cross-links before the library reaches a model.
    pub fn validation_issues(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();

        if self.schema_version != 1 {
            issues.push(ValidationIssue::new(
                "schema_version",
                format!("expected 1, got {}", self.schema_version),
            ));
        }
        if self.library_id != "codakiller.practice_methods" {
            issues.push(ValidationIssue::new(
                "library_id",
                "must equal codakiller.practice_methods",
            ));
        }
        require_text(&mut issues, "title", &self.title);
        require_text(
            &mut issues,
            "editorial_policy.sensor_rule",
            &self.editorial_policy.sensor_rule,
        );
        require_text(
            &mut issues,
            "editorial_policy.advice_rule",
            &self.editorial_policy.advice_rule,
        );
        require_text(
            &mut issues,
            "editorial_policy.dose_rule",
            &self.editorial_policy.dose_rule,
        );
        require_text(
            &mut issues,
            "editorial_policy.safety_rule",
            &self.editorial_policy.safety_rule,
        );

        let route_ids = unique_ids(
            &mut issues,
            "routes",
            self.routes.iter().map(|route| route.id.as_str()),
        );
        let method_ids = unique_ids(
            &mut issues,
            "methods",
            self.methods.iter().map(|method| method.id.as_str()),
        );
        let principle_ids = unique_ids(
            &mut issues,
            "psychology_principles",
            self.psychology_principles
                .iter()
                .map(|principle| principle.id.as_str()),
        );
        let source_ids = unique_ids(
            &mut issues,
            "sources",
            self.sources.iter().map(|source| source.id.as_str()),
        );

        if method_ids.len() != 28 {
            issues.push(ValidationIssue::new(
                "methods",
                format!("expected the curated 28 methods, got {}", method_ids.len()),
            ));
        }

        for (index, route) in self.routes.iter().enumerate() {
            let path = format!("routes[{index}]");
            require_text(&mut issues, &format!("{path}.label"), &route.label);
            require_nonempty(
                &mut issues,
                &format!("{path}.primary_method_ids"),
                &route.primary_method_ids,
            );
            let mut route_methods = HashSet::new();
            for method_id in route
                .primary_method_ids
                .iter()
                .chain(&route.alternate_method_ids)
            {
                if !method_ids.contains(method_id.as_str()) {
                    issues.push(ValidationIssue::new(
                        format!("{path}.method_ids"),
                        format!("unknown method id {method_id}"),
                    ));
                }
                if !route_methods.insert(method_id) {
                    issues.push(ValidationIssue::new(
                        format!("{path}.method_ids"),
                        format!("duplicate method id {method_id}"),
                    ));
                }
            }
        }

        let routed_method_ids: HashSet<&str> = self
            .routes
            .iter()
            .flat_map(|route| {
                route
                    .primary_method_ids
                    .iter()
                    .chain(&route.alternate_method_ids)
            })
            .map(String::as_str)
            .collect();

        for (index, method) in self.methods.iter().enumerate() {
            let path = format!("methods[{index}]");
            require_text(&mut issues, &format!("{path}.name"), &method.name);
            require_text(&mut issues, &format!("{path}.method"), &method.method);
            require_text(&mut issues, &format!("{path}.dose"), &method.dose);
            require_text(&mut issues, &format!("{path}.watch_for"), &method.watch_for);
            require_nonempty(
                &mut issues,
                &format!("{path}.symptom_ids"),
                &method.symptom_ids,
            );
            require_nonempty(
                &mut issues,
                &format!("{path}.passage_types"),
                &method.passage_types,
            );
            require_nonempty(
                &mut issues,
                &format!("{path}.citation_ids"),
                &method.citation_ids,
            );
            for symptom_id in &method.symptom_ids {
                if !route_ids.contains(symptom_id.as_str()) {
                    issues.push(ValidationIssue::new(
                        format!("{path}.symptom_ids"),
                        format!("unknown route id {symptom_id}"),
                    ));
                }
            }
            check_citations(
                &mut issues,
                &format!("{path}.citation_ids"),
                &method.citation_ids,
                &source_ids,
            );
            if !routed_method_ids.contains(method.id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("{path}.id"),
                    "method is unreachable from every symptom route",
                ));
            }
        }

        for (index, principle) in self.psychology_principles.iter().enumerate() {
            let path = format!("psychology_principles[{index}]");
            require_text(&mut issues, &format!("{path}.title"), &principle.title);
            require_text(
                &mut issues,
                &format!("{path}.practice"),
                &principle.practice,
            );
            require_text(&mut issues, &format!("{path}.dose"), &principle.dose);
            require_text(
                &mut issues,
                &format!("{path}.watch_for"),
                &principle.watch_for,
            );
            require_text(
                &mut issues,
                &format!("{path}.evidence_note"),
                &principle.evidence_note,
            );
            require_nonempty(
                &mut issues,
                &format!("{path}.triggers"),
                &principle.triggers,
            );
            require_nonempty(
                &mut issues,
                &format!("{path}.citation_ids"),
                &principle.citation_ids,
            );
            check_citations(
                &mut issues,
                &format!("{path}.citation_ids"),
                &principle.citation_ids,
                &source_ids,
            );
            for citation_id in &principle.citation_ids {
                if let Some(source) = self.source(citation_id) {
                    if !matches!(
                        source.kind,
                        SourceKind::PrimaryStudy | SourceKind::AuthoritativeGuidance
                    ) {
                        issues.push(ValidationIssue::new(
                            format!("{path}.citation_ids"),
                            format!(
                                "psychology source {citation_id} must be primary research or authoritative guidance"
                            ),
                        ));
                    }
                }
            }
        }

        for (index, source) in self.sources.iter().enumerate() {
            let path = format!("sources[{index}]");
            require_text(&mut issues, &format!("{path}.title"), &source.title);
            require_nonempty(&mut issues, &format!("{path}.authors"), &source.authors);
            require_text(&mut issues, &format!("{path}.venue"), &source.venue);
            require_text(
                &mut issues,
                &format!("{path}.identifier"),
                &source.identifier,
            );
            require_text(
                &mut issues,
                &format!("{path}.claim_scope"),
                &source.claim_scope,
            );
            require_text(
                &mut issues,
                &format!("{path}.limitations"),
                &source.limitations,
            );
            if !source.url.starts_with("https://") {
                issues.push(ValidationIssue::new(
                    format!("{path}.url"),
                    "must use a stable https URL",
                ));
            }
            if !(1900..=2100).contains(&source.year) {
                issues.push(ValidationIssue::new(
                    format!("{path}.year"),
                    "year is outside the supported range",
                ));
            }
        }

        if principle_ids.len() != self.psychology_principles.len() {
            // `unique_ids` already reports the individual collision. This keeps
            // the collection result used and explicit in release validation.
        }

        issues
    }
}

fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

fn unique_ids<'a>(
    issues: &mut Vec<ValidationIssue>,
    path: &str,
    ids: impl Iterator<Item = &'a str>,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    for id in ids {
        if id.trim().is_empty() {
            issues.push(ValidationIssue::new(path, "id must not be blank"));
        } else if !seen.insert(id) {
            issues.push(ValidationIssue::new(path, format!("duplicate id {id}")));
        }
    }
    seen
}

fn require_text(issues: &mut Vec<ValidationIssue>, path: &str, value: &str) {
    if value.trim().is_empty() {
        issues.push(ValidationIssue::new(path, "must not be blank"));
    }
}

fn require_nonempty<T>(issues: &mut Vec<ValidationIssue>, path: &str, values: &[T]) {
    if values.is_empty() {
        issues.push(ValidationIssue::new(path, "must not be empty"));
    }
}

fn check_citations(
    issues: &mut Vec<ValidationIssue>,
    path: &str,
    citation_ids: &[String],
    source_ids: &HashSet<&str>,
) {
    let mut seen = HashSet::new();
    for citation_id in citation_ids {
        if !source_ids.contains(citation_id.as_str()) {
            issues.push(ValidationIssue::new(
                path,
                format!("unknown source id {citation_id}"),
            ));
        }
        if !seen.insert(citation_id) {
            issues.push(ValidationIssue::new(
                path,
                format!("duplicate source id {citation_id}"),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_library_is_valid_and_complete() {
        let library = PracticeLibrary::from_embedded().expect("valid embedded library");
        assert_eq!(library.routes.len(), 13);
        assert_eq!(library.methods.len(), 28);
        assert_eq!(library.psychology_principles.len(), 10);
        assert_eq!(library.sources.len(), 18);
    }

    #[test]
    fn alias_lookup_preserves_curated_order() {
        let library = PracticeLibrary::from_embedded().expect("valid embedded library");
        let route = library
            .route_for_query("Hand slips")
            .expect("human alias resolves");
        let ids: Vec<_> = library
            .methods_for_route(route)
            .into_iter()
            .map(|method| method.id.as_str())
            .collect();
        assert_eq!(ids, ["blocking", "ghosting", "eyes_lead", "slow_meta"]);
    }

    #[test]
    fn safety_route_never_prescribes_repetitions() {
        let library = PracticeLibrary::from_embedded().expect("valid embedded library");
        let route = library
            .route_for_query("pain_or_numbness")
            .expect("safety route");
        let methods = library.methods_for_route(route);
        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].tier, MethodTier::Safety);
        assert!(methods[0].dose.starts_with("No repetition dose"));
    }

    #[test]
    fn library_contains_no_legacy_audio_grading_contract() {
        for forbidden in [
            "acoustic_check",
            "grade the rep",
            "analyzer measures",
            "detectable click",
            "wrong-measure",
        ] {
            assert!(
                !PRACTICE_METHODS_JSON.to_lowercase().contains(forbidden),
                "legacy audio-grading phrase leaked into runtime library: {forbidden}"
            );
        }
    }
}
