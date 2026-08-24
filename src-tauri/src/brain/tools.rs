//! Fixed, read-only tool registry for the two-round Assistant tool loop
//! (Plan C1). Follows the exact closed-schema validation idiom as
//! `ProposedActionInput` in `provider.rs`: the model's raw JSON deserializes
//! into a flat, `deny_unknown_fields` input struct, then `validate()` either
//! returns a known-safe, typed `ToolRequest` or `None`. Nothing here executes
//! anything — execution lives in `tool_exec.rs` (Task 3) and only ever reads.

use serde::Deserialize;

/// The complete set of tools the Assistant may request. Adding a tool means
/// adding a variant here, a case in `ToolRequestInput::validate`, and a case
/// in `tool_exec::execute` (Task 3) — there is no dynamic registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ToolRequest {
    HistoryDays { from: String, to: String },
    HistoryDayDetail { date: String },
    PieceBlocks { piece_id: i64 },
    ProgressSummary { piece_id: i64 },
    StreakSummary,
}

impl ToolRequest {
    /// The tool name as it appears on the wire and in provenance records.
    pub(crate) fn name(&self) -> &'static str {
        match self {
            ToolRequest::HistoryDays { .. } => "history_days",
            ToolRequest::HistoryDayDetail { .. } => "history_day_detail",
            ToolRequest::PieceBlocks { .. } => "piece_blocks",
            ToolRequest::ProgressSummary { .. } => "progress_summary",
            ToolRequest::StreakSummary => "streak_summary",
        }
    }

    /// Human-readable argument summary for the provenance chip
    /// (`tool_provenance[].args_human`). Deterministic, never provider text.
    pub(crate) fn args_human(&self) -> String {
        match self {
            ToolRequest::HistoryDays { from, to } => format!("{from} to {to}"),
            ToolRequest::HistoryDayDetail { date } => date.clone(),
            ToolRequest::PieceBlocks { piece_id } => format!("piece #{piece_id}"),
            ToolRequest::ProgressSummary { piece_id } => format!("piece #{piece_id}"),
            ToolRequest::StreakSummary => String::new(),
        }
    }
}

/// The model's raw round-1 tool request, before validation. Every field is
/// optional at the wire level (different tools need different args); a stray
/// field the chosen tool does not use is a REJECT, not a silent ignore —
/// that is what stops a provider from smuggling extra intent through an
/// unused slot.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ToolRequestInput {
    pub(crate) tool: String,
    #[serde(default)]
    pub(crate) from: Option<String>,
    #[serde(default)]
    pub(crate) to: Option<String>,
    #[serde(default)]
    pub(crate) date: Option<String>,
    #[serde(default)]
    pub(crate) piece_id: Option<i64>,
}

/// Bound on tool_requests honored in a single round (cost + latency control;
/// the model may ask for more, extras are dropped, not erroring the answer).
pub(crate) const MAX_TOOL_REQUESTS_PER_ROUND: usize = 3;

impl ToolRequestInput {
    pub(crate) fn validate(self) -> Option<ToolRequest> {
        match self.tool.as_str() {
            "history_days" => {
                if self.date.is_some() || self.piece_id.is_some() {
                    return None;
                }
                let from = non_empty(self.from)?;
                let to = non_empty(self.to)?;
                Some(ToolRequest::HistoryDays { from, to })
            }
            "history_day_detail" => {
                if self.from.is_some() || self.to.is_some() || self.piece_id.is_some() {
                    return None;
                }
                let date = non_empty(self.date)?;
                Some(ToolRequest::HistoryDayDetail { date })
            }
            "piece_blocks" => {
                if self.from.is_some() || self.to.is_some() || self.date.is_some() {
                    return None;
                }
                Some(ToolRequest::PieceBlocks {
                    piece_id: self.piece_id?,
                })
            }
            "progress_summary" => {
                if self.from.is_some() || self.to.is_some() || self.date.is_some() {
                    return None;
                }
                Some(ToolRequest::ProgressSummary {
                    piece_id: self.piece_id?,
                })
            }
            "streak_summary" => {
                if self.from.is_some()
                    || self.to.is_some()
                    || self.date.is_some()
                    || self.piece_id.is_some()
                {
                    return None;
                }
                Some(ToolRequest::StreakSummary)
            }
            _ => None,
        }
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    (!value.is_empty() && value.chars().count() <= 32).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(tool: &str) -> ToolRequestInput {
        ToolRequestInput {
            tool: tool.to_string(),
            from: None,
            to: None,
            date: None,
            piece_id: None,
        }
    }

    #[test]
    fn history_days_requires_from_and_to() {
        let mut req = input("history_days");
        assert!(req.clone().validate().is_none()); // missing from/to
        req.from = Some("2026-08-01".to_string());
        assert!(req.clone().validate().is_none()); // missing to
        req.to = Some("2026-08-20".to_string());
        assert_eq!(
            req.validate(),
            Some(ToolRequest::HistoryDays {
                from: "2026-08-01".to_string(),
                to: "2026-08-20".to_string(),
            })
        );
    }

    #[test]
    fn history_day_detail_requires_date_only() {
        let mut req = input("history_day_detail");
        assert!(req.clone().validate().is_none());
        req.date = Some("2026-08-20".to_string());
        assert_eq!(
            req.clone().validate(),
            Some(ToolRequest::HistoryDayDetail {
                date: "2026-08-20".to_string()
            })
        );
        // Cross-field pollution rejected: a date field on a piece-scoped tool.
        req.tool = "piece_blocks".to_string();
        req.piece_id = Some(7);
        assert!(req.validate().is_none()); // still has `date` set — reject
    }

    #[test]
    fn piece_blocks_and_progress_summary_require_piece_id() {
        let mut req = input("piece_blocks");
        assert!(req.clone().validate().is_none());
        req.piece_id = Some(7);
        assert_eq!(
            req.clone().validate(),
            Some(ToolRequest::PieceBlocks { piece_id: 7 })
        );

        req.tool = "progress_summary".to_string();
        assert_eq!(
            req.validate(),
            Some(ToolRequest::ProgressSummary { piece_id: 7 })
        );
    }

    #[test]
    fn streak_summary_takes_no_args() {
        let req = input("streak_summary");
        assert_eq!(req.clone().validate(), Some(ToolRequest::StreakSummary));

        let mut with_stray = input("streak_summary");
        with_stray.piece_id = Some(1);
        assert!(with_stray.validate().is_none()); // stray arg rejected
    }

    #[test]
    fn unknown_tool_name_is_rejected() {
        assert!(input("delete_everything").validate().is_none());
    }
}
