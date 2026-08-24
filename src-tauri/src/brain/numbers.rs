//! Structured, attributed numbers policy (Plan C1, Task 5 — REDESIGNED).
//!
//! The original design scanned the answer's free text for digit runs and
//! checked each against a flat pool of every number reachable anywhere in
//! every consulted tool's payload (including inside STRING leaves, and with
//! a bidirectional x60/÷60 conversion applied to every field regardless of
//! unit). A fresh-context adversarial verifier proved that design broken in
//! seven distinct ways, including a fully fabricated answer ("you've
//! practiced this passage twelve times and your streak is nineteen days")
//! that shipped `Ok` with a `streak_summary` provenance chip attached —
//! laundering invention with a credibility badge, the exact failure mode
//! this whole project exists to prevent.
//!
//! This module replaces it with a closed, attributed contract: round 2 must
//! return `figures: [{shown, tool, field}]` naming EXACTLY which tool and
//! which dotted JSON field backs each rendered number. Validation is
//! two-directional:
//!   (a) every claimed figure must RESOLVE — the dotted path must exist in
//!       THAT NAMED TOOL's real executed payload, land on a NUMERIC JSON
//!       leaf (never a string), and `shown` must be one of a closed list of
//!       permitted renderings of that exact value;
//!   (b) every number-like token in the answer text — digit runs AND
//!       spelled-out English words — must be covered by a validated figure's
//!       `shown` substring, or a narrow, explicit exemption (ISO dates, bare
//!       calendar years, a number immediately before "bpm", or a number
//!       quoted verbatim from a cited book excerpt).
//! Nothing here trusts the provider's own account of a number. Every check
//! re-derives the value from the tool payload this backend itself executed.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use super::provider::FigureInput;
use super::tool_exec::ToolProvenance;

/// Digit-shaped token detector — thousands separators and a decimal tail,
/// same shape as before. Used ONLY to find leftover, unexplained tokens
/// after every valid figure and exemption has been masked out of the answer
/// text. Never used to harvest numbers to check against (that would be the
/// exact flat-pool mistake this redesign removes).
static DIGIT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d[\d,]*(?:\.\d+)?").unwrap());

/// ISO calendar date ("2026-08-20") — exempt as a date, not a practice
/// figure. Narrow: the full YYYY-MM-DD shape only, not a bare fragment.
static ISO_DATE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{4}-\d{2}-\d{2}\b").unwrap());

/// A bare 4-digit calendar year, 1600-2100 — exempt as a date component
/// ("since 2026") rather than a practice figure. Deliberately narrow: this
/// is a plausible-year range, not "any 4-digit number".
static YEAR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(1[6-9]\d{2}|20\d{2}|2100)\b").unwrap());

/// A number immediately preceding "bpm" — a tempo marking read off the score
/// or quoted from a book's guidance, not a practice-data figure this backend
/// can (or should) verify against a tool payload.
static BPM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b\d+(?:\.\d+)?\s*bpm\b").unwrap());

/// Single-word spelled-out numbers this policy recognizes as a PERMITTED
/// rendering at all: 0..=20, plus round tens up to "hundred". Used both to
/// validate a figure's spelled-out `shown` text and as the closed set a
/// spelled-out claim may legitimately draw from. Anything outside this list
/// (compound numbers like "twenty-three", or magnitude words) can never be a
/// valid rendering of any figure.
const SPELLED_NUMBERS: &[(&str, f64)] = &[
    ("zero", 0.0),
    ("one", 1.0),
    ("two", 2.0),
    ("three", 3.0),
    ("four", 4.0),
    ("five", 5.0),
    ("six", 6.0),
    ("seven", 7.0),
    ("eight", 8.0),
    ("nine", 9.0),
    ("ten", 10.0),
    ("eleven", 11.0),
    ("twelve", 12.0),
    ("thirteen", 13.0),
    ("fourteen", 14.0),
    ("fifteen", 15.0),
    ("sixteen", 16.0),
    ("seventeen", 17.0),
    ("eighteen", 18.0),
    ("nineteen", 19.0),
    ("twenty", 20.0),
    ("thirty", 30.0),
    ("forty", 40.0),
    ("fifty", 50.0),
    ("sixty", 60.0),
    ("seventy", 70.0),
    ("eighty", 80.0),
    ("ninety", 90.0),
    ("hundred", 100.0),
];

/// Broader spelled-out-number DETECTOR for the leftover scan (rule b): every
/// word in `SPELLED_NUMBERS`, plus magnitude words that are never themselves
/// a permitted rendering but must still be caught as an unexplained figure
/// (e.g. "thousand" inside a fabricated "a thousand reps").
static SPELLED_NUMBER_RE: Lazy<Regex> = Lazy::new(|| {
    let mut words: Vec<&str> = SPELLED_NUMBERS.iter().map(|(word, _)| *word).collect();
    words.extend(["thousand", "million", "billion"]);
    let pattern = format!(r"(?i)\b(?:{})\b", words.join("|"));
    Regex::new(&pattern).unwrap()
});

/// Resolve a dotted/bracketed path into a JSON value.
///
/// Grammar, per '.'-separated segment:
///   - a bare digit run ("3") — array index into the current value
///   - "field" — object-key access
///   - "field[3]" — object-key access, then array index
///
/// Never falls back or guesses: any segment that doesn't resolve exactly
/// (wrong type, missing key, out-of-bounds index) fails the WHOLE path,
/// returning `None`. There is no partial credit — a figure whose path
/// doesn't resolve is invalid, full stop (see `figure_is_valid`).
fn resolve_json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.') {
        if segment.is_empty() {
            return None;
        }
        if segment.bytes().all(|byte| byte.is_ascii_digit()) {
            let index: usize = segment.parse().ok()?;
            current = current.as_array()?.get(index)?;
            continue;
        }
        if let Some(bracket) = segment.find('[') {
            if !segment.ends_with(']') {
                return None;
            }
            let field = &segment[..bracket];
            let index_str = &segment[bracket + 1..segment.len() - 1];
            let index: usize = index_str.parse().ok()?;
            current = current.as_object()?.get(field)?;
            current = current.as_array()?.get(index)?;
        } else {
            current = current.as_object()?.get(segment)?;
        }
    }
    Some(current)
}

/// The object-key portion of a dotted path's LAST segment — the JSON field
/// name the resolved value actually lives under — used only to gate
/// seconds<->minutes eligibility (`_seconds`-suffixed field names). A path
/// whose last segment is a bare array index has no field name to check, so
/// it is conservatively never eligible for the minutes conversion.
fn last_field_name(path: &str) -> Option<&str> {
    let last = path.rsplit('.').next()?;
    if last.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(last.find('[').map_or(last, |bracket| &last[..bracket]))
}

/// Strip a trailing minutes unit word (case-insensitively) and return the
/// leading numeric text, if any unit was present at all.
fn strip_minutes_suffix(text: &str) -> Option<String> {
    let lowered = text.to_ascii_lowercase();
    for suffix in ["minutes", "minute", "min"] {
        if let Some(prefix_len) = lowered.strip_suffix(suffix).map(str::len) {
            return Some(text[..prefix_len].trim().to_string());
        }
    }
    None
}

/// Whether `shown` is a PERMITTED rendering of the numeric value resolved at
/// `field_path`. A closed list, on purpose — every entry here is a rule
/// signed off on explicitly; nothing is added by pattern-matching "looks
/// plausible". No ceiling rounding, no free unit invention.
fn is_permitted_rendering(shown: &str, value: f64, field_path: &str) -> bool {
    const EPSILON: f64 = 1e-9;
    let trimmed = shown.trim();

    // Exact decimal.
    if let Ok(parsed) = trimmed.parse::<f64>() {
        if (parsed - value).abs() < EPSILON {
            return true;
        }
    }

    // Thousands-separated ("1,660").
    if let Ok(parsed) = trimmed.replace(',', "").parse::<f64>() {
        if (parsed - value).abs() < EPSILON {
            return true;
        }
    }

    // Seconds -> minutes, ONLY for a field whose name ends in "_seconds" —
    // never applied blind to every field the way the original design did
    // (which is exactly what let a current_days:3 back a claimed "180
    // minutes"). Floor or round only; never ceil.
    if last_field_name(field_path).is_some_and(|name| name.ends_with("_seconds")) {
        if let Some(minutes_text) = strip_minutes_suffix(trimmed) {
            if let Ok(parsed) = minutes_text.parse::<f64>() {
                let floor_minutes = (value / 60.0).floor();
                let round_minutes = (value / 60.0).round();
                if (parsed - floor_minutes).abs() < EPSILON
                    || (parsed - round_minutes).abs() < EPSILON
                {
                    return true;
                }
            }
        }
    }

    // Spelled-out English, 0..=20 plus round tens to 100 — a single word,
    // matched case-insensitively.
    let lowered = trimmed.to_ascii_lowercase();
    if SPELLED_NUMBERS
        .iter()
        .any(|(word, number)| *word == lowered && (*number - value).abs() < EPSILON)
    {
        return true;
    }

    false
}

/// Whether a claimed figure resolves against a REAL payload from a tool
/// actually consulted this turn. Attribution is per-tool: a figure claiming
/// `tool: "streak_summary"` may only be checked against payloads whose
/// provenance names `streak_summary` — never against some OTHER tool's
/// payload that happens to contain a matching number (the cross-tool
/// "borrowing" attack the flat-pool design allowed).
fn figure_is_valid(
    figure: &FigureInput,
    tool_provenance: &[ToolProvenance],
    tool_payloads: &[Value],
) -> bool {
    tool_provenance
        .iter()
        .zip(tool_payloads.iter())
        .filter(|(provenance, _)| provenance.tool == figure.tool)
        .any(|(_, payload)| {
            resolve_json_path(payload, &figure.field)
                // NUMERIC leaves only — a string leaf (e.g. a date field)
                // never resolves here, closing the "point a figure at a
                // date string" attack outright, independent of the leftover
                // text scan below.
                .and_then(Value::as_f64)
                .is_some_and(|value| is_permitted_rendering(&figure.shown, value, &figure.field))
        })
}

/// The numbers policy: once an answer is tool-grounded, EVERY figure it
/// claims must resolve (rule a), and EVERY number-like token in the answer
/// text — digit or spelled out — must be covered by a validated figure or a
/// narrow exemption (rule b). `cited_excerpts` is the exact text of every
/// book excerpt actually cited in this answer, for the "quoted verbatim from
/// a cited source" exemption; ordinals are deliberately NOT exempted here —
/// "your 3rd day" is a practice claim like any other and still needs a
/// figure, which naturally falls out of the digit-run detector matching the
/// "3" inside "3rd".
pub(crate) fn numbers_policy_violation(
    answer: &str,
    figures: &[FigureInput],
    tool_provenance: &[ToolProvenance],
    tool_payloads: &[Value],
    cited_excerpts: &[&str],
) -> Option<&'static str> {
    // (a) Every claimed figure must resolve. An unresolvable or mis-rendered
    // figure is ITSELF the violation — the model claimed grounding for
    // something that plainly isn't there, independent of whether the number
    // even appears in the answer text.
    for figure in figures {
        if !figure_is_valid(figure, tool_provenance, tool_payloads) {
            return Some("unsupported_figure");
        }
    }

    // (b) Mask every validated figure's exact rendered substring, then every
    // narrow exemption, then check whether anything number-shaped is left.
    let mut remaining = answer.to_string();
    for figure in figures {
        remaining = remaining.replacen(figure.shown.as_str(), " ", 1);
    }
    for exemption in [&*ISO_DATE_RE, &*YEAR_RE, &*BPM_RE] {
        remaining = exemption.replace_all(&remaining, " ").into_owned();
    }
    for excerpt in cited_excerpts {
        // Exact digit-RUN membership, not naive substring containment: a
        // claimed "0" must not be waved through just because some UNRELATED
        // larger number in the excerpt (e.g. "60") happens to contain the
        // character "0". Only a token that appears in the excerpt as its
        // OWN complete digit run is a verbatim quote.
        let excerpt_tokens: std::collections::HashSet<&str> =
            DIGIT_RE.find_iter(excerpt).map(|m| m.as_str()).collect();
        for token in DIGIT_RE.find_iter(answer) {
            if excerpt_tokens.contains(token.as_str()) {
                remaining = remaining.replacen(token.as_str(), " ", 1);
            }
        }
    }

    if DIGIT_RE.is_match(&remaining) || SPELLED_NUMBER_RE.is_match(&remaining) {
        return Some("unsupported_figure");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn streak_provenance() -> ToolProvenance {
        ToolProvenance {
            tool: "streak_summary".to_string(),
            args_human: String::new(),
            summary: "current streak 0 day(s)".to_string(),
        }
    }

    fn history_days_provenance() -> ToolProvenance {
        ToolProvenance {
            tool: "history_days".to_string(),
            args_human: "2026-08-01 to 2026-08-20".to_string(),
            summary: "1 day(s), 27 min total focused time".to_string(),
        }
    }

    fn figure(shown: &str, tool: &str, field: &str) -> FigureInput {
        FigureInput {
            shown: shown.to_string(),
            tool: tool.to_string(),
            field: field.to_string(),
        }
    }

    // --- resolve_json_path -------------------------------------------------

    #[test]
    fn resolve_json_path_reads_object_field_and_array_index_forms() {
        let payload = json!({"current_days": 3});
        assert_eq!(
            resolve_json_path(&payload, "current_days"),
            Some(&json!(3))
        );

        let array_payload = json!([{"date": "2026-08-20", "focused_seconds": 1_660}]);
        assert_eq!(
            resolve_json_path(&array_payload, "0.focused_seconds"),
            Some(&json!(1_660))
        );
        assert_eq!(
            resolve_json_path(&array_payload, "[0].focused_seconds"),
            None, // "[0]" with an empty field name before the bracket is not
                  // a supported form — only a bare digit segment or
                  // "field[N]" are. Being strict here is intentional: no
                  // partial credit, no guessing.
        );
    }

    #[test]
    fn resolve_json_path_fails_closed_on_a_missing_or_wrong_shaped_segment() {
        let payload = json!({"current_days": 3});
        assert_eq!(resolve_json_path(&payload, "best_days"), None);
        assert_eq!(resolve_json_path(&payload, "current_days.0"), None);
    }

    // --- is_permitted_rendering / seconds<->minutes gating ------------------

    #[test]
    fn seconds_to_minutes_conversion_is_only_permitted_for_seconds_suffixed_fields() {
        // Legit: a `_seconds`-suffixed field honestly floors or rounds.
        assert!(is_permitted_rendering("27 min", 1_660.0, "0.focused_seconds"));
        assert!(is_permitted_rendering("28 min", 1_660.0, "0.focused_seconds"));
        // Adversarial (defect #3, the x60 abuse): a field that is NOT
        // seconds-denominated (current_days) must never be minutes-converted,
        // no matter how tempting the arithmetic looks.
        assert!(!is_permitted_rendering("180 minutes", 3.0, "current_days"));
        assert!(!is_permitted_rendering("0", 3.0, "current_days")); // not even the reverse direction
    }

    #[test]
    fn spelled_out_fabrications_outside_a_real_value_are_never_a_permitted_rendering() {
        assert!(is_permitted_rendering("twelve", 12.0, "current_days"));
        assert!(!is_permitted_rendering("twelve", 0.0, "current_days"));
        assert!(!is_permitted_rendering("nineteen", 0.0, "current_days"));
    }

    // --- figure_is_valid / per-tool attribution -----------------------------

    #[test]
    fn a_figure_cannot_borrow_a_number_from_a_different_tools_payload() {
        // Defect #4 (cross-tool pooling): 1660 is real, but it lives in
        // history_days' focused_seconds, not streak_summary's current_days.
        // Attributing the figure to the wrong tool must fail even though the
        // number is genuinely present SOMEWHERE in this turn's tool results.
        let provenance = [streak_provenance(), history_days_provenance()];
        let payloads = [
            json!({"current_days": 0, "best_days": 0}),
            json!([{"date": "2026-08-20", "focused_seconds": 1_660}]),
        ];
        let bad = figure("1660", "streak_summary", "current_days");
        assert!(!figure_is_valid(&bad, &provenance, &payloads));

        let good = figure("1660", "history_days", "0.focused_seconds");
        assert!(figure_is_valid(&good, &provenance, &payloads));
    }

    #[test]
    fn a_figure_pointed_at_a_string_leaf_never_resolves() {
        // Defect #2 (date-component pollution): even if a figure explicitly
        // targets the date string field, it must fail — string leaves are
        // never numeric, full stop, independent of what substrings a regex
        // might have found inside them.
        let provenance = [history_days_provenance()];
        let payloads = [json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        let bad = figure("20", "history_days", "0.date");
        assert!(!figure_is_valid(&bad, &provenance, &payloads));
    }

    // --- numbers_policy_violation: the required end-to-end scenarios -------

    #[test]
    fn spelled_out_fabrication_is_rejected() {
        let provenance = [streak_provenance()];
        let payloads = [json!({"current_days": 0, "best_days": 0})];
        let violation = numbers_policy_violation(
            "You have practiced this passage twelve times and your streak is nineteen days.",
            &[],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn date_component_pollution_is_rejected_even_with_no_backing_figure() {
        // "20" exists only inside the payload's date STRING, never as a
        // numeric leaf anywhere — the claim has nothing legitimate to trace
        // to.
        let provenance = [history_days_provenance()];
        let payloads = [json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        let violation = numbers_policy_violation(
            "You touched 20 pieces this week.",
            &[],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn date_component_pollution_is_rejected_even_when_a_figure_points_at_the_date_field() {
        let provenance = [history_days_provenance()];
        let payloads = [json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        let cheating_figure = figure("20", "history_days", "0.date");
        let violation = numbers_policy_violation(
            "You touched 20 pieces this week.",
            &[cheating_figure],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn cross_tool_number_borrowing_is_rejected() {
        let provenance = [streak_provenance(), history_days_provenance()];
        let payloads = [
            json!({"current_days": 0, "best_days": 0}),
            json!([{"date": "2026-08-20", "focused_seconds": 1_660}]),
        ];
        let mislabeled = figure("1660", "streak_summary", "current_days");
        let violation = numbers_policy_violation(
            "Your streak is 1660 days.",
            &[mislabeled],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn x60_abuse_is_rejected() {
        let provenance = [streak_provenance()];
        let payloads = [json!({"current_days": 3, "best_days": 3})];
        let abusive = figure("180 minutes", "streak_summary", "current_days");
        let violation = numbers_policy_violation(
            "You've focused 180 minutes today.",
            &[abusive],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn legitimate_seconds_to_minutes_rendering_is_accepted() {
        let provenance = [history_days_provenance()];
        let payloads = [json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
        let good = figure("27 min", "history_days", "0.focused_seconds");
        let violation = numbers_policy_violation(
            "You focused 27 min on 2026-08-20.",
            &[good],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, None);
    }

    #[test]
    fn a_mixed_answer_with_a_real_figure_and_a_cited_book_percentage_is_accepted() {
        let provenance = [streak_provenance()];
        let payloads = [json!({"current_days": 0, "best_days": 0})];
        let good = figure("0", "streak_summary", "current_days");
        let excerpt = "Practice slow passages at 60% tempo before returning to speed.";
        let violation = numbers_policy_violation(
            "Your current streak is 0 days; Breth suggests slow practice at 60% tempo.",
            &[good],
            &provenance,
            &payloads,
            &[excerpt],
        );
        assert_eq!(violation, None);
    }

    #[test]
    fn a_tempo_marking_immediately_before_bpm_is_exempt() {
        let provenance: [ToolProvenance; 0] = [];
        let payloads: [Value; 0] = [];
        let violation = numbers_policy_violation(
            "Try landing the leap cleanly at 96 bpm before pushing faster.",
            &[],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, None);
    }

    #[test]
    fn an_ordinal_is_not_exempt_and_still_needs_a_figure() {
        let provenance: [ToolProvenance; 0] = [];
        let payloads: [Value; 0] = [];
        let violation = numbers_policy_violation(
            "This is your 3rd day in a row.",
            &[],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, Some("unsupported_figure"));
    }

    #[test]
    fn no_tool_numbers_and_no_digits_in_the_answer_is_fine() {
        let provenance = [streak_provenance()];
        let payloads = [json!({"current_days": 0})];
        let violation = numbers_policy_violation(
            "Keep going, you're building a nice habit.",
            &[],
            &provenance,
            &payloads,
            &[],
        );
        assert_eq!(violation, None);
    }
}
