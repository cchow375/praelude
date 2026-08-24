//! Executes a validated `ToolRequest` against the `Store` — READ ONLY, no
//! transaction, no writes, nothing else reachable. Every execution is
//! wrapped with a `ToolProvenance` record so the frontend can render exactly
//! which tools were consulted, and so the numbers-policy check (Task 5) has
//! ground truth to check the answer text against.

use serde::Serialize;
use serde_json::json;

use super::tools::ToolRequest;
use super::BrainError;
use crate::store::Store;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolProvenance {
    pub tool: String,
    pub args_human: String,
    /// Deterministic one-line summary of what the tool returned, generated
    /// here — never provider text — so the provenance chip is trustworthy
    /// even if the model never mentions the tool result at all.
    pub summary: String,
}

pub(crate) struct ToolExecution {
    pub provenance: ToolProvenance,
    pub payload: serde_json::Value,
}

pub(crate) fn execute(store: &Store, request: &ToolRequest) -> Result<ToolExecution, BrainError> {
    let (payload, summary) = match request {
        ToolRequest::HistoryDays { from, to } => {
            let days = store
                .history_days(from, to)
                .map_err(|_| BrainError::Context("Could not read practice history".into()))?;
            let total_minutes: i64 = days.iter().map(|d| d.focused_seconds / 60).sum();
            let summary = format!(
                "{} day(s), {} min total focused time",
                days.len(),
                total_minutes
            );
            (json!(days), summary)
        }
        ToolRequest::HistoryDayDetail { date } => {
            let detail = store
                .history_day_detail(date)
                .map_err(|_| BrainError::Context("Could not read that day's history".into()))?;
            let summary = format!(
                "{}: {} session(s), {} set(s) touched",
                detail.date,
                detail.sessions.len(),
                detail.sets.len()
            );
            (json!(detail), summary)
        }
        ToolRequest::PieceBlocks { piece_id } => {
            let blocks = store
                .block_history(*piece_id)
                .map_err(|_| BrainError::Context("Could not read this piece's blocks".into()))?;
            let summary = format!("{} block(s) on record", blocks.len());
            (json!(blocks), summary)
        }
        ToolRequest::ProgressSummary { piece_id } => {
            let progress = crate::metrics::progress_summary(store, *piece_id)
                .map_err(|_| BrainError::Context("Could not read progress summary".into()))?;
            let summary = format!(
                "{} min focused, streak {}",
                progress.focused_seconds / 60,
                progress.streak
            );
            (json!(progress), summary)
        }
        ToolRequest::StreakSummary => {
            let threshold = i64::from(crate::settings::snapshot(store).streak_threshold_minutes);
            let streak = store
                .streak_summary(threshold)
                .map_err(|_| BrainError::Context("Could not read streak summary".into()))?;
            let summary = format!(
                "current streak {} day(s), best {}",
                streak.current_days, streak.best_days
            );
            (json!(streak), summary)
        }
    };

    Ok(ToolExecution {
        provenance: ToolProvenance {
            tool: request.name().to_string(),
            args_human: request.args_human(),
            summary,
        },
        payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn fixture() -> Store {
        Store::open(":memory:").unwrap()
    }

    #[test]
    fn history_days_executes_read_only_and_carries_provenance() {
        let store = fixture();
        let request = ToolRequest::HistoryDays {
            from: "2026-08-01".to_string(),
            to: "2026-08-20".to_string(),
        };
        let execution = execute(&store, &request).unwrap();
        assert_eq!(execution.provenance.tool, "history_days");
        assert_eq!(execution.provenance.args_human, "2026-08-01 to 2026-08-20");
        assert!(execution.payload.is_array());
    }

    #[test]
    fn streak_summary_executes_and_returns_object_payload() {
        let store = fixture();
        let execution = execute(&store, &ToolRequest::StreakSummary).unwrap();
        assert_eq!(execution.provenance.tool, "streak_summary");
        assert!(execution.payload.get("current_days").is_some());
    }

    #[test]
    fn piece_blocks_on_missing_piece_returns_empty_not_error() {
        let store = fixture();
        let execution = execute(&store, &ToolRequest::PieceBlocks { piece_id: 999_999 }).unwrap();
        assert_eq!(execution.provenance.tool, "piece_blocks");
        assert_eq!(execution.payload.as_array().map(|a| a.len()), Some(0));
    }
}
