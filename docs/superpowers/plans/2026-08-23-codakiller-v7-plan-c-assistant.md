# CodaKiller v7.0.0 Plan C — Assistant Usefulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Assistant "worth asking" by grounding its answers in the app's own
deterministic data: read-only practice-data tools (C1), book-cited coaching (C2), a
draft-only day-plan composer (C3), and full piece-metadata grounding (C4) — all inside the
existing confirm-gated, LLM-never-in-the-hot-loop architecture.

**Architecture:** Extend the existing closed-schema `StructuredOutput`/`deny_unknown_fields`
discipline (`brain/provider.rs`) into a bounded **two-round** tool loop: round 1 lets the
model request tools from a fixed registry instead of answering; the backend validates,
executes read-only, and embeds results as grounded JSON for round 2, which must be a final
answer. Every tool-grounded figure in the answer must trace to a tool result (numbers
policy). Book coaching reuses the existing BM25 corpus retrieval with a new
situation-derived query. Day-plan composing produces plain retypeable draft lines that the
user accepts through the _already-existing_ `day_sheet_save` write path — no new write
command. Piece-knowledge grounding extends the existing `GroundedContext` builder with the
full `PieceDetail`.

**Tech Stack:** Rust (Tauri v2 backend, `src-tauri/src/brain/`), TypeScript/React frontend
(`src/features/brain/`), rusqlite read models (`src-tauri/src/store/`), vitest, cargo test.

**Spec:**
`docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md` (Part 2
Plan C, Constraints, Non-goals).

## Global Constraints

- The LLM is never in the hot loop (rep/metronome path) — unchanged; Assistant tools are
  read-only and confirm-gated.
- Tools are READ-ONLY. The only write path anywhere in this plan is the existing
  confirm-gated proposed-action/Accept idiom (`PendingIntakeReviews`/`apply_intake_review`
  for intake fields; `useDaySheet` `setBody`+`flush` → `day_sheet_save` for day-plan
  Accept). No new write command is introduced by this plan.
- Suggest, never dictate — coaching and planning answers are advisory; nothing auto-applies.
- No figure without a tool row behind it (numbers policy): once an answer carries
  `tool_provenance`, every integer/decimal in the answer text must appear in, or be a
  documented rounding/unit-conversion of, a value returned by one of the consulted tools.
- **B67 reality:** no Anthropic key on this machine. Every task in this plan must be fully
  testable with the provider **mocked** (`FakeTransport`/devMock). The one live-provider
  step in the final task runs on **Gemini**, never Claude.
- 45s timeout per provider round; two rounds max = 90s worst case. `max_tokens` stays 900
  for text responses.
- All 85+ legacy CSS token names preserved; paper design language throughout (binding on
  any new UI in this plan — provenance chips, consent card, draft card).
- Every command the frontend calls must be covered in `src/devMock/tauriDevMock.ts` with a
  sibling `tauriDevMock.<name>.test.ts` (binding rule, NOTES.md:32).

## Flags for Christian (read before executing)

1. **Consent-gate interpretation.** The spec says tools are "confirm-gated" but does not
   specify the UI. This plan implements: the Assistant composer shows an inline consent
   card ("Assistant may read practice data this session? [Allow] [Just answer without it]")
   before the **first question of the app session**, gated on a session-scoped flag — not
   on a per-question "would this need tools?" prediction (which the frontend cannot make
   before asking). The choice is sent as `tools_consent: bool` on every `BrainAskRequest`
   for the rest of the session. If Christian wants per-question gating instead, that is a
   larger UX change and should be scoped separately.
2. **`streak_summary` does not exist yet.** The spec assumes "v7/foundations + Plan A
   merged (streak_summary command exists)." Verified against the current tree
   (`v6.0.0`): no `streak_summary` command exists on either the Rust or TS side, and no
   global (cross-piece) day-level streak read model exists — only
   `metrics::streak()` (piece-scoped, consumed by `progress_summary`). **Task 1 below adds
   a minimal, standalone `streak_summary` command** so this plan is self-contained and does
   not block on Plan A landing first. If Plan A ships first with its own
   `streak_summary`, Task 1 becomes a no-op merge conflict to resolve in favor of whichever
   lands first (same name, same shape is the goal — flagged for the merge orchestrator).
   **ORCHESTRATOR RESOLUTION (2026-08-23): build order is Foundations → A → B → C, so Plan A
   owns `streak_summary`. Before starting Task 1, check whether `streak_summary` already
   exists in the tree; if it does, SKIP Task 1 entirely and consume Plan A's command
   (verify its shape matches this plan's `StreakSummary` interface; reconcile in favor of
   the landed shape).**
3. **Coaching-question classification is new.** The recon note asked to "verify" an
   "existing intent classification precedent" for coaching questions in `brain/mod.rs`; none
   was found — `QuestionSource` (Typed/Voice) is the only existing classification. Task 8
   adds a new lightweight keyword classifier (`is_coaching_question`). This is a judgment
   call, not a discovered precedent — flagged for review.

---

### Task 1: Global day streak read model + `streak_summary` command

**Files:**

- Create: `src-tauri/src/metrics/streak_summary.rs`
- Modify: `src-tauri/src/metrics/mod.rs` (add `pub mod streak_summary;` and re-export)
- Modify: `src-tauri/src/lib.rs` (new `#[tauri::command] fn streak_summary`, register in
  `generate_handler!`)
- Modify: `src/devMock/tauriDevMock.ts` (new `case "streak_summary":`)
- Test: `src-tauri/src/metrics/streak_summary.rs` (inline `#[cfg(test)] mod tests`)
- Test: `src/devMock/tauriDevMock.streakSummary.test.ts`

**Interfaces:**

- Produces: `pub fn global_streak(active_days: &[String], min_focused_minutes: i64) -> StreakSummary`
  (pure), `pub struct StreakSummary { pub current_streak: u32, pub best_streak: u32, pub qualifying_day_count: u32 }`,
  tauri command `streak_summary(store: State<'_, Arc<Store>>) -> Result<StreakSummary, String>`.
- Consumes: `store.history_days(from, to)` (`src-tauri/src/store/history_days.rs:300`,
  returns `Vec<HistoryDaySummary>` with `date: String`, `focused_seconds: i64`).

- [ ] **Step 1: Write the failing test for the pure streak function**

```rust
// src-tauri/src/metrics/streak_summary.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gap_breaks_the_current_streak_but_not_the_best() {
        // Three consecutive qualifying days, a gap, then one more day.
        let days = vec![
            ("2026-08-10".to_string(), 15_i64 * 60),
            ("2026-08-11".to_string(), 12 * 60),
            ("2026-08-12".to_string(), 30 * 60),
            // 2026-08-13 missing (gap)
            ("2026-08-14".to_string(), 11 * 60),
        ];
        let summary = global_streak(&days, 10);
        assert_eq!(summary.best_streak, 3);
        assert_eq!(summary.current_streak, 1);
        assert_eq!(summary.qualifying_day_count, 4);
    }

    #[test]
    fn a_day_under_the_minimum_does_not_count() {
        let days = vec![
            ("2026-08-10".to_string(), 9 * 60), // 9 min, under the 10-min floor
            ("2026-08-11".to_string(), 20 * 60),
        ];
        let summary = global_streak(&days, 10);
        assert_eq!(summary.qualifying_day_count, 1);
        assert_eq!(summary.current_streak, 1);
        assert_eq!(summary.best_streak, 1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib metrics::streak_summary -- --nocapture`
Expected: FAIL — `global_streak` not found, module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/metrics/streak_summary.rs
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StreakSummary {
    pub current_streak: u32,
    pub best_streak: u32,
    pub qualifying_day_count: u32,
}

/// Pure, event-history-derived global streak (spec A2 / Plan C's `streak_summary`
/// tool). `days` are `(date, focused_seconds)` pairs already ordered ascending by
/// date (as `Store::history_days` returns them); a day "qualifies" at
/// `focused_seconds >= min_focused_minutes * 60`. The current streak is the run of
/// consecutive qualifying calendar days ending at the LAST day present in `days`
/// (the caller passes a range ending today); a gap of one or more non-qualifying
/// days breaks it. No day can be granted, backfilled, or faked — this only reads
/// what `history_days` already computed from recorded practice events.
pub fn global_streak(days: &[(String, i64)], min_focused_minutes: i64) -> StreakSummary {
    let floor_seconds = min_focused_minutes.max(0) * 60;
    let qualifying: Vec<&str> = days
        .iter()
        .filter(|(_, seconds)| *seconds >= floor_seconds)
        .map(|(date, _)| date.as_str())
        .collect();

    let mut best_streak = 0u32;
    let mut run = 0u32;
    let mut previous: Option<chrono::NaiveDate> = None;
    for date_str in &qualifying {
        let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        let consecutive = previous.is_some_and(|prev| date == prev + chrono::Duration::days(1));
        run = if consecutive { run + 1 } else { 1 };
        best_streak = best_streak.max(run);
        previous = Some(date);
    }

    // Current streak: walk the qualifying dates backward from the last one,
    // requiring each step back to be exactly one calendar day.
    let mut current_streak = 0u32;
    let mut cursor: Option<chrono::NaiveDate> = None;
    for date_str in qualifying.iter().rev() {
        let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        match cursor {
            None => {
                current_streak = 1;
                cursor = Some(date);
            }
            Some(prev) if prev == date + chrono::Duration::days(1) => {
                current_streak += 1;
                cursor = Some(date);
            }
            Some(_) => break,
        }
    }

    StreakSummary {
        current_streak,
        best_streak,
        qualifying_day_count: qualifying.len() as u32,
    }
}
```

Add to `src-tauri/src/metrics/mod.rs`:

```rust
pub mod streak_summary;
pub use streak_summary::{global_streak, StreakSummary};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib metrics::streak_summary -- --nocapture`
Expected: PASS (2/2).

- [ ] **Step 5: Wire the tauri command**

```rust
// src-tauri/src/lib.rs, near the other history_days-adjacent commands
const STREAK_MIN_FOCUSED_MINUTES: i64 = 10; // spec A2 default; Settings override is Plan A scope, not this plan

#[tauri::command]
fn streak_summary(store: State<'_, Arc<Store>>) -> Result<metrics::StreakSummary, String> {
    let today = store.today_local().map_err(|e| e.to_string())?;
    let from = "2000-01-01".to_string(); // history_days is already bounded by real data present
    let days = store
        .history_days(&from, &today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|d| (d.date, d.focused_seconds))
        .collect::<Vec<_>>();
    Ok(metrics::global_streak(&days, STREAK_MIN_FOCUSED_MINUTES))
}
```

Register in `generate_handler!` next to `history_days` (`src-tauri/src/lib.rs:2314` area):
`streak_summary,`

- [ ] **Step 6: devMock handler + test**

```typescript
// src/devMock/tauriDevMock.ts — new case, alongside other read-model cases
case "streak_summary":
  return {
    current_streak: 3,
    best_streak: 7,
    qualifying_day_count: 12,
  };
```

```typescript
// src/devMock/tauriDevMock.streakSummary.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

describe("dev-mock streak_summary handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a current/best/qualifying-day triple", async () => {
    const summary = await seamInvoke<{
      current_streak: number;
      best_streak: number;
      qualifying_day_count: number;
    }>("streak_summary");
    expect(summary.best_streak).toBeGreaterThanOrEqual(summary.current_streak);
    expect(summary.qualifying_day_count).toBeGreaterThanOrEqual(
      summary.best_streak,
    );
  });
});
```

Run: `npm test -- streakSummary`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/metrics/streak_summary.rs src-tauri/src/metrics/mod.rs src-tauri/src/lib.rs src/devMock/tauriDevMock.ts src/devMock/tauriDevMock.streakSummary.test.ts
git commit -m "feat: add global day streak read model + streak_summary command"
```

---

### Task 2: Tool registry types (`brain/tools.rs`)

**Files:**

- Create: `src-tauri/src/brain/tools.rs`
- Modify: `src-tauri/src/brain/mod.rs` (add `mod tools;` and re-exports)
- Test: `src-tauri/src/brain/tools.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**

- Produces: `pub(crate) struct ToolRequestInput { tool: String, from: Option<String>,
to: Option<String>, date: Option<String>, piece_id: Option<i64> }` (deny_unknown_fields,
  Deserialize), `pub(crate) fn ToolRequestInput::validate(self) -> Option<ToolRequest>`,
  `pub(crate) enum ToolRequest { HistoryDays{from,to}, HistoryDayDetail{date},
PieceBlocks{piece_id}, ProgressSummary{piece_id}, StreakSummary }`,
  `pub(crate) const MAX_TOOL_REQUESTS_PER_ROUND: usize = 3`.
- Consumes: nothing outside the standard library — this task is pure parsing/validation,
  same idiom as `ProposedActionInput::validate` (`brain/provider.rs:701-783`).

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/tools.rs
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
        assert_eq!(req.clone().validate(), Some(ToolRequest::PieceBlocks { piece_id: 7 }));

        req.tool = "progress_summary".to_string();
        assert_eq!(req.validate(), Some(ToolRequest::ProgressSummary { piece_id: 7 }));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::tools -- --nocapture`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/tools.rs
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::tools -- --nocapture`
Expected: PASS (5/5).

- [ ] **Step 5: Wire the module**

In `src-tauri/src/brain/mod.rs`, alongside the existing `mod context; mod corpus; mod
library; mod provider; mod score_context;`:

```rust
mod tools;
```

(`tools` items stay `pub(crate)`/private to `brain`; Task 4 uses them directly since it
lives in the same module tree.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/brain/tools.rs src-tauri/src/brain/mod.rs
git commit -m "feat: add closed-schema tool registry for Assistant tool loop"
```

---

### Task 3: Tool execution + provenance (`brain/tool_exec.rs`)

**Files:**

- Create: `src-tauri/src/brain/tool_exec.rs`
- Modify: `src-tauri/src/brain/mod.rs` (add `mod tool_exec;`)
- Test: `src-tauri/src/brain/tool_exec.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**

- Consumes: `ToolRequest` (Task 2); `Store::history_days(&self, from: &str, to: &str) ->
rusqlite::Result<Vec<HistoryDaySummary>>` (`store/history_days.rs:300`);
  `Store::history_day_detail(&self, date: &str) -> rusqlite::Result<HistoryDayDetail>`
  (`store/history_days.rs:351`); `Store::block_history(&self, piece_id: i64) ->
rusqlite::Result<Vec<BlockHistory>>` (backs the `rep_blocks_for_piece` command,
  `lib.rs:915`); `metrics::progress_summary(store: &Store, piece_id: i64) ->
rusqlite::Result<ProgressSummary>` (`metrics/mod.rs:168`); `metrics::global_streak` (Task
  1).
- Produces: `pub(crate) struct ToolExecution { pub provenance: ToolProvenance, pub payload:
serde_json::Value }`, `pub struct ToolProvenance { pub tool: String, pub args_human:
String, pub summary: String }` (re-exported from `brain::mod` as `pub use
tool_exec::ToolProvenance;` since Task 6 puts it on `BrainAnswer`), `pub(crate) fn
execute(store: &Store, request: &ToolRequest) -> Result<ToolExecution, BrainError>`.

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/tool_exec.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn fixture() -> Store {
        let store = Store::open(":memory:").unwrap();
        store
            .day_sheet_save("2026-08-20", "[]") // ensures the date exists in history range logic
            .ok();
        store
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
        assert!(execution.payload.get("current_streak").is_some());
    }

    #[test]
    fn piece_blocks_on_missing_piece_returns_empty_not_error() {
        let store = fixture();
        let execution = execute(&store, &ToolRequest::PieceBlocks { piece_id: 999_999 }).unwrap();
        assert_eq!(execution.provenance.tool, "piece_blocks");
        assert_eq!(execution.payload.as_array().map(|a| a.len()), Some(0));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::tool_exec -- --nocapture`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/tool_exec.rs
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
            let summary = format!("{} day(s), {} min total focused time", days.len(), total_minutes);
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
            let today = store
                .today_local()
                .map_err(|_| BrainError::Context("Could not resolve today's date".into()))?;
            let days = store
                .history_days("2000-01-01", &today)
                .map_err(|_| BrainError::Context("Could not read practice history".into()))?
                .into_iter()
                .map(|d| (d.date, d.focused_seconds))
                .collect::<Vec<_>>();
            let streak = crate::metrics::global_streak(&days, 10);
            let summary = format!(
                "current streak {} day(s), best {}",
                streak.current_streak, streak.best_streak
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::tool_exec -- --nocapture`
Expected: PASS (3/3).

- [ ] **Step 5: Wire the module + re-export**

`brain/mod.rs`: add `mod tool_exec;` and `pub use tool_exec::ToolProvenance;` alongside the
existing `pub use context::{GroundingSummary, KnowledgeShareCause};`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/brain/tool_exec.rs src-tauri/src/brain/mod.rs
git commit -m "feat: add read-only tool execution + deterministic provenance records"
```

---

### Task 4: Two-round tool loop wiring (provider.rs request/response schema)

**Files:**

- Modify: `src-tauri/src/brain/provider.rs` (`RawAnswer`, `ProviderOutput`, `claude_request`,
  `gemini_request`, `ProviderChain::ask`)
- Test: `src-tauri/src/brain/provider.rs` (inline tests near existing `FakeTransport` tests)

**Interfaces:**

- Consumes: `ToolRequestInput` (Task 2, same module tree — `provider.rs` is a sibling of
  `tools.rs` under `brain/`).
- Produces: `pub(crate) enum ToolRound { First, Final }`; `ProviderChain::ask` gains a
  `round: ToolRound` parameter; `ProviderOutput` gains `pub tool_requests: Vec<ToolRequest>`
  (empty on `ToolRound::Final`, always — round 2 responses never honor further tool
  requests per the spec's "round 2 must be a final answer" rule).

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/brain/provider.rs, in the existing #[cfg(test)] mod tests block
#[test]
fn round_one_tool_requests_are_parsed_and_validated() {
    let (chain, transport) = claude_chain_returning(
        json!({
            "answer": "",
            "tool_requests": [
                {"tool": "streak_summary"},
                {"tool": "piece_blocks", "piece_id": 7},
                {"tool": "not_a_real_tool"} // dropped, not an error
            ]
        })
        .to_string(),
    );
    let context = GroundedContext::for_test("{}");
    let output = chain
        .ask("what's stalling?", QuestionSource::Typed, &context, &transport, ToolRound::First)
        .unwrap();
    assert_eq!(output.tool_requests.len(), 2);
    assert_eq!(output.tool_requests[0].name(), "streak_summary");
    assert_eq!(output.tool_requests[1].name(), "piece_blocks");
}

#[test]
fn final_round_never_returns_tool_requests_even_if_the_model_sent_them() {
    let (chain, transport) = claude_chain_returning(
        json!({
            "answer": "You've stalled on the Chopin.",
            "tool_requests": [{"tool": "streak_summary"}]
        })
        .to_string(),
    );
    let context = GroundedContext::for_test("{}");
    let output = chain
        .ask("what's stalling?", QuestionSource::Typed, &context, &transport, ToolRound::Final)
        .unwrap();
    assert!(output.tool_requests.is_empty());
}
```

(`GroundedContext::for_test` is a new tiny `#[cfg(test)]` constructor — add it next to the
existing `pub(super) struct GroundedContext { pub(super) json: String }` in `context.rs`:
`#[cfg(test)] pub(super) fn for_test(json: impl Into<String>) -> Self { Self { json:
json.into() } }`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::provider -- --nocapture`
Expected: FAIL — `ask` takes 4 args not 5, `ToolRound` doesn't exist, `tool_requests` field
missing.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/provider.rs — add near the top, with the other small pub(crate) enums
/// Which round of the two-round tool loop this request is. Round 1 tells the
/// model it MAY return `tool_requests` instead of an answer; round 2 tells it
/// tool requests are ignored and a final answer is required. Never more than
/// two rounds — this is not an agent loop, it's one bounded detour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ToolRound {
    First,
    Final,
}

const TOOL_REGISTRY_PROMPT: &str = r#"You may answer directly, OR — only if the question needs practice-history numbers you don't already have — return `"tool_requests"` instead of `"answer"`: up to 3 objects from {tool:"history_days",from,to}, {tool:"history_day_detail",date}, {tool:"piece_blocks",piece_id}, {tool:"progress_summary",piece_id}, {tool:"streak_summary"}. Dates are YYYY-MM-DD. If you request tools, leave "answer" empty; you will be asked again with the results."#;

const TOOL_RESULTS_PROMPT: &str = r#"Tool results are attached below as grounded JSON. Answer now — do not request further tools; any "tool_requests" in this reply are ignored. Every number in your answer must come from these tool results."#;
```

Extend `RawAnswer` (around line 654):

```rust
#[derive(Deserialize)]
struct RawAnswer {
    answer: String,
    #[serde(default)]
    citation_ids: Vec<String>,
    #[serde(default)]
    proposed_action: Option<Value>,
    #[serde(default)]
    tool_requests: Vec<super::tools::ToolRequestInput>,
}
```

Extend `ProviderOutput` (wherever it's defined near `ask`'s return type):

```rust
pub(crate) struct ProviderOutput {
    pub provider: ProviderName,
    pub model: String,
    pub answer: String,
    pub citation_ids: Vec<String>,
    pub proposed_action: Option<ProposedAction>,
    pub tool_requests: Vec<super::tools::ToolRequest>,
}
```

Update `claude_request`/`gemini_request` to append the right prompt for the round, and
`ask` to thread `round` through and cap/validate `tool_requests`:

```rust
fn claude_request(
    config: &ProviderConfig,
    question: &str,
    source: QuestionSource,
    context: &GroundedContext,
    system: &str,
    round: ToolRound,
) -> HttpRequest {
    let system = format!("{system}\n\n{}", round_prompt(round));
    HttpRequest {
        url: ANTHROPIC_URL.into(),
        headers: vec![
            ("x-api-key".into(), config.api_key.expose().into()),
            ("anthropic-version".into(), "2023-06-01".into()),
        ],
        body: json!({
            "model": config.model,
            "max_tokens": 900,
            "system": system,
            "messages": [{"role": "user", "content": user_prompt(question, source, context)}],
        }),
    }
}

fn gemini_request(
    config: &ProviderConfig,
    question: &str,
    source: QuestionSource,
    context: &GroundedContext,
    system: &str,
    round: ToolRound,
) -> HttpRequest {
    let system = format!("{system}\n\n{}", round_prompt(round));
    HttpRequest {
        url: format!("{GEMINI_BASE_URL}/{}:generateContent", config.model),
        headers: vec![("x-goog-api-key".into(), config.api_key.expose().into())],
        body: json!({
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt(question, source, context)}]}],
            "generationConfig": {
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingLevel": "minimal"}
            }
        }),
    }
}

fn round_prompt(round: ToolRound) -> &'static str {
    match round {
        ToolRound::First => TOOL_REGISTRY_PROMPT,
        ToolRound::Final => TOOL_RESULTS_PROMPT,
    }
}
```

`ProviderChain::ask` gains the `round` parameter and parses `tool_requests`:

```rust
pub(crate) fn ask(
    &self,
    question: &str,
    source: QuestionSource,
    context: &GroundedContext,
    transport: &dyn Transport,
    round: ToolRound,
) -> Result<ProviderOutput, BrainError> {
    let run = self.run(
        transport,
        |config| match config.provider {
            ProviderName::Claude => {
                claude_request(config, question, source, context, SYSTEM_POLICY, round)
            }
            ProviderName::Gemini => {
                gemini_request(config, question, source, context, SYSTEM_POLICY, round)
            }
            ProviderName::Offline => unreachable!(),
        },
        |provider, body| match provider {
            ProviderName::Claude => parse_claude(body),
            ProviderName::Gemini => parse_gemini(body),
            ProviderName::Offline => unreachable!(),
        },
    )?;
    let ProviderRun { provider, model, value: raw } = run;
    let proposed_action = parse_proposed_action(raw.proposed_action);
    let tool_requests = if round == ToolRound::Final {
        Vec::new() // final round NEVER honors further requests, even if returned
    } else {
        raw.tool_requests
            .into_iter()
            .filter_map(|input| input.validate())
            .take(super::tools::MAX_TOOL_REQUESTS_PER_ROUND)
            .collect()
    };
    Ok(ProviderOutput {
        provider,
        model,
        answer: raw.answer,
        citation_ids: raw.citation_ids,
        proposed_action,
        tool_requests,
    })
}
```

Every other existing call site of `chain.ask(...)` (in `brain/mod.rs`'s `ask_native`)
updates to pass `ToolRound::First` for now — Task 6 adds the actual round-2 call.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::provider -- --nocapture`
Expected: PASS. Then run the full brain test module to confirm no existing test broke from
the new `ask` parameter: `cargo test --lib brain::`.
Expected: all green (fix any other `chain.ask(...)` call sites flagged by the compiler by
passing `ToolRound::First`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/brain/provider.rs src-tauri/src/brain/context.rs
git commit -m "feat: extend provider request/response schema for two-round tool loop"
```

---

### Task 5: Numbers policy — no figure without a tool row behind it

**Files:**

- Modify: `src-tauri/src/brain/mod.rs` (near `output_policy_violation_reason`,
  lines 1312-1586)
- Test: `src-tauri/src/brain/mod.rs` (inline, near existing policy tests)

**Interfaces:**

- Produces: `fn numbers_policy_violation(answer: &str, tool_payloads: &[serde_json::Value])
-> Option<&'static str>`, called from `ask_native` only when `tool_provenance` is
  non-empty (wired in Task 6), returning `Some("unsupported_figure")` on violation —
  feeding into the SAME `BrainError::PolicyViolation` → offline-substitute path the existing
  seven categories already use.
- Consumes: nothing new; reuses `serde_json::Value`.

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/mod.rs, in the existing #[cfg(test)] mod tests block
#[test]
fn numbers_policy_allows_a_figure_present_verbatim_in_a_tool_payload() {
    let payloads = vec![serde_json::json!({"current_streak": 3, "best_streak": 7})];
    assert_eq!(
        numbers_policy_violation("Your current streak is 3 days; your best is 7.", &payloads),
        None
    );
}

#[test]
fn numbers_policy_allows_seconds_reported_as_rounded_minutes() {
    let payloads = vec![serde_json::json!([{"date": "2026-08-20", "focused_seconds": 1_660}])];
    // 1660 seconds = 27.67 min, rounds to 27 or 28 — either is an honest rounding.
    assert_eq!(
        numbers_policy_violation("You focused 27 min on 2026-08-20.", &payloads),
        None
    );
    assert_eq!(
        numbers_policy_violation("You focused 28 min on 2026-08-20.", &payloads),
        None
    );
}

#[test]
fn numbers_policy_allows_comma_formatted_variants() {
    let payloads = vec![serde_json::json!({"total_seconds": 5000})];
    assert_eq!(
        numbers_policy_violation("That's 5,000 seconds on record.", &payloads),
        None
    );
}

#[test]
fn numbers_policy_rejects_a_figure_with_no_backing_tool_row() {
    let payloads = vec![serde_json::json!({"current_streak": 3})];
    assert_eq!(
        numbers_policy_violation("You've practiced this passage 12 times.", &payloads),
        Some("unsupported_figure")
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::tests::numbers_policy -- --nocapture`
Expected: FAIL — function doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/mod.rs — near output_policy_violation_reason
/// Collects every numeric leaf value reachable from a tool result payload,
/// as f64. Walks arrays/objects recursively; also pulls embedded numbers out
/// of string leaves (e.g. a formatted date component is harmless noise, but
/// a string like "27 min" in a future tool's summary field still counts).
fn collect_tool_numbers(payloads: &[serde_json::Value]) -> Vec<f64> {
    fn walk(value: &serde_json::Value, out: &mut Vec<f64>) {
        match value {
            serde_json::Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    out.push(f);
                }
            }
            serde_json::Value::String(s) => {
                for token in NUMBER_RE.find_iter(s) {
                    if let Ok(f) = token.as_str().replace(',', "").parse::<f64>() {
                        out.push(f);
                    }
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            serde_json::Value::Object(map) => map.values().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    payloads.iter().for_each(|v| walk(v, &mut out));
    out
}

static NUMBER_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"\d[\d,]*(?:\.\d+)?").unwrap());

/// The numbers policy: once an answer is tool-grounded (`tool_provenance` is
/// non-empty), every figure the answer states must trace to a tool result —
/// exactly, as a formatted variant (comma grouping), or as an honest
/// minutes<->seconds rounding (tools mostly return seconds; answers mostly
/// say minutes). This is deliberately narrower than "any number anywhere
/// near a plausible value" — an unbacked figure is a `PolicyViolation`, same
/// as a claimed rep verdict.
fn numbers_policy_violation(answer: &str, tool_payloads: &[serde_json::Value]) -> Option<&'static str> {
    let tool_numbers = collect_tool_numbers(tool_payloads);
    if tool_numbers.is_empty() {
        // No tool actually returned numeric data — nothing to check against,
        // and nothing in the answer can claim tool backing either. Any
        // digit in the answer text in this state is unsupported.
        if NUMBER_RE.is_match(answer) {
            return Some("unsupported_figure");
        }
        return None;
    }

    for token in NUMBER_RE.find_iter(answer) {
        let Ok(claimed) = token.as_str().replace(',', "").parse::<f64>() else {
            continue;
        };
        let backed = tool_numbers.iter().any(|&tool_value| {
            (claimed - tool_value).abs() < 0.5 // verbatim or a rounding
                || (claimed - (tool_value / 60.0).round()).abs() < 0.5 // seconds -> minutes
                || (claimed - (tool_value * 60.0).round()).abs() < 0.5 // minutes -> seconds
        });
        if !backed {
            return Some("unsupported_figure");
        }
    }
    None
}
```

Add `once_cell` and `regex` to `src-tauri/Cargo.toml` dependencies if not already present
— check first: `grep -E '^(once_cell|regex) =' src-tauri/Cargo.toml`; both are already
crate dependencies elsewhere in this codebase (corpus.rs uses regex-adjacent tokenizing) —
if either is genuinely absent, add `once_cell = "1"` / `regex = "1"` under `[dependencies]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::tests::numbers_policy -- --nocapture`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/brain/mod.rs src-tauri/Cargo.toml
git commit -m "feat: add numbers policy — every tool-grounded figure must trace to a tool row"
```

---

### Task 6: Wire the two-round loop into `ask_native` + `tool_provenance` on `BrainAnswer`

**Files:**

- Modify: `src-tauri/src/brain/mod.rs` (`BrainAnswer`, `ask_native`, `BrainAskRequest`)
- Test: `src-tauri/src/brain/mod.rs` (inline)

**Interfaces:**

- Produces: `BrainAnswer.tool_provenance: Vec<ToolProvenance>` (new field, placed after
  `grounding` and before `proposed_action` per the existing struct layout);
  `BrainAskRequest.tools_consent: bool` (new field, `#[serde(default)]`, wired from the
  frontend in Task 7).
- Consumes: `tool_exec::execute` (Task 3), `numbers_policy_violation` (Task 5),
  `ProviderChain::ask(..., round: ToolRound)` (Task 4).

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/mod.rs, in the existing #[cfg(test)] mod tests block
#[test]
fn round_one_tool_requests_execute_and_round_two_grounds_the_final_answer() {
    let (store, sessions, _piece_id) = fixture();
    let (chain, transport) = two_round_chain(
        // round 1: model asks for streak_summary
        json!({"answer": "", "tool_requests": [{"tool": "streak_summary"}]}).to_string(),
        // round 2: model answers using the tool result
        json!({"answer": "Your current streak is 3 days."}).to_string(),
    );
    let mut request = request("what's my streak?");
    request.tools_consent = true;
    let answer = ask_with(
        request,
        store.as_ref(),
        &sessions,
        &TestLibrary,
        &chain,
        &transport,
        None,
    )
    .unwrap();
    assert_eq!(answer.tool_provenance.len(), 1);
    assert_eq!(answer.tool_provenance[0].tool, "streak_summary");
    assert_eq!(answer.answer, "Your current streak is 3 days.");
}

#[test]
fn without_consent_no_tool_requests_are_ever_honored() {
    let (store, sessions, _piece_id) = fixture();
    let (chain, transport) = claude_chain_returning(
        json!({"answer": "", "tool_requests": [{"tool": "streak_summary"}]}).to_string(),
    );
    let mut request = request("what's my streak?");
    request.tools_consent = false;
    let answer = ask_with(request, store.as_ref(), &sessions, &TestLibrary, &chain, &transport, None)
        .unwrap();
    assert!(answer.tool_provenance.is_empty());
}

#[test]
fn an_unsupported_figure_in_a_tool_grounded_answer_falls_back_offline() {
    let (store, sessions, _piece_id) = fixture();
    let (chain, transport) = two_round_chain(
        json!({"answer": "", "tool_requests": [{"tool": "streak_summary"}]}).to_string(),
        // round 2 hallucinates a number (12) not present in the streak payload
        json!({"answer": "You've practiced this passage 12 times this week."}).to_string(),
    );
    let mut request = request("what's my streak?");
    request.tools_consent = true;
    let answer = ask_with(request, store.as_ref(), &sessions, &TestLibrary, &chain, &transport, None)
        .unwrap();
    assert_eq!(answer.provider, ProviderName::Offline); // policy violation -> offline substitute
    assert!(answer.tool_provenance.is_empty()); // offline substitute carries no tool receipts
}
```

Add the `two_round_chain` test helper next to the existing `claude_chain_returning`:

```rust
fn two_round_chain(round1_json: String, round2_json: String) -> (ProviderChain, FakeTransport) {
    let chain = ProviderChain::from_configs(vec![ProviderConfig::test(
        ProviderPreference::Claude,
        "secret-claude",
        "claude-test",
    )]);
    let transport = FakeTransport::responses(vec![
        HttpResponse::ok(json!({"content": [{"type": "text", "text": round1_json}]})),
        HttpResponse::ok(json!({"content": [{"type": "text", "text": round2_json}]})),
    ]);
    (chain, transport)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::tests::round -- --nocapture`
Expected: FAIL — `BrainAnswer` has no `tool_provenance` field, `BrainAskRequest` has no
`tools_consent` field, `ask_native`/`ask_with` doesn't run a second round.

- [ ] **Step 3: Write minimal implementation**

Add fields:

```rust
// BrainAskRequest, alongside the other #[serde(default)] fields
#[serde(default)]
pub tools_consent: bool,
```

```rust
// BrainAnswer, inserted after `grounding` and before `proposed_action`
pub tool_provenance: Vec<tool_exec::ToolProvenance>,
```

Update every `BrainAnswer { ... }` construction site (the two identified in Task-research:
the normal-path constructor and the offline-fallback constructor) to include
`tool_provenance` — normal path carries the real Vec, offline fallback always passes
`Vec::new()`.

In the body of `ask_native`/`ask_with` (the shared implementation both call into), after the
existing round-1 `chain.ask(..., ToolRound::First)` call and BEFORE the existing
`output_policy_violation_reason` check on `raw.answer`, insert:

```rust
let mut tool_provenance: Vec<tool_exec::ToolProvenance> = Vec::new();
let mut tool_payloads: Vec<serde_json::Value> = Vec::new();

let raw = if request.tools_consent && !raw.tool_requests.is_empty() {
    // Execute round 1's requested tools, read-only, then ask again with
    // results grounded in — this is the ONLY place tools ever run.
    for tool_request in &raw.tool_requests {
        let execution = tool_exec::execute(store, tool_request)
            .map_err(|_| BrainError::Context("A practice-data tool failed".into()))?;
        tool_payloads.push(execution.payload.clone());
        tool_provenance.push(execution.provenance);
    }
    let tool_results_json = serde_json::to_string(&tool_payloads)
        .unwrap_or_else(|_| "[]".to_string());
    let round2_context = context::GroundedContext::with_tool_results(&context, &tool_results_json);
    chain
        .ask(&request.question, request.source, &round2_context, transport, provider::ToolRound::Final)
        .map_err(|error| /* existing offline-mapping error handling, unchanged */ error)?
} else {
    raw
};
```

(`context::GroundedContext::with_tool_results` is a small new method on `GroundedContext` in
`context.rs`: `pub(super) fn with_tool_results(base: &GroundedContext, tool_results_json:
&str) -> GroundedContext { GroundedContext { json: format!("{{\"grounded\":{},\"tool_results\":{}}}", base.json, tool_results_json) } }` — capped: if `tool_results_json.len() >
4_000`, truncate to `4_000` chars before formatting, matching the existing `MAX_TEXT_CHARS`
budget discipline in `context.rs`.)

Then, right where `output_policy_violation_reason(&raw.answer)` is currently checked
(mod.rs:~1312 call site, not the function definition), add the numbers check immediately
after it, short-circuiting the same way:

```rust
if let Some(reason) = output_policy_violation_reason(&raw.answer) {
    return offline_substitute(/* existing args */, reason);
}
if !tool_provenance.is_empty() {
    if let Some(reason) = numbers_policy_violation(&raw.answer, &tool_payloads) {
        return offline_substitute(/* existing args */, reason); // tool_provenance NOT carried into the offline substitute
    }
}
```

Finally, include `tool_provenance` in the successful `BrainAnswer { ... }` construction.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain:: -- --nocapture`
Expected: all brain tests pass, including the 3 new ones and every pre-existing test
(fixing any other `BrainAnswer { ... }` construction site the compiler flags for the new
field).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/brain/mod.rs src-tauri/src/brain/context.rs
git commit -m "feat: wire two-round tool loop into ask_native with consent gate + numbers policy"
```

---

### Task 7: Frontend — consent card + provenance chips

**Files:**

- Modify: `src/features/brain/types.ts` (add `tools_consent` to the request shape,
  `tool_provenance` to `BrainAnswer`)
- Modify: `src/features/brain/api.ts` (thread `tools_consent` through `brainApi.ask`)
- Modify: `src/features/brain/BrainWorkspace.tsx` (consent card + provenance chip row)
- Modify: `src/features/brain/BrainWorkspace.css` (chip styling — reuse `.brain-chip`
  pattern, paper design tokens only)
- Modify: `src/devMock/tauriDevMock.ts` (`brain_ask` case gains `tool_provenance` in its
  mock response)
- Test: `src/features/brain/BrainWorkspace.test.tsx`

**Interfaces:**

- Produces: `interface ToolProvenance { tool: string; args_human: string; summary: string }`
  in `types.ts`; component-local `assistantToolsConsent` module state
  (`type ToolsConsent = "unset" | "allowed" | "declined"`) persisted for the app session
  (module-scope variable, reset on reload — matches "persists for the session" from the
  spec, and needs no backend round-trip).
- Consumes: `BrainAnswer.tool_provenance` (Task 6, wire format), existing `brainApi.ask`
  call shape.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/brain/BrainWorkspace.test.tsx — add to the existing test file
it("shows the consent card before the first question of the session, not after", async () => {
  const { getByText, queryByText, getByRole } = renderBrainWorkspace(); // existing test harness
  expect(
    getByText(/Assistant may read practice data this session/i),
  ).toBeInTheDocument();

  fireEvent.click(getByText("Allow"));
  expect(
    queryByText(/Assistant may read practice data this session/i),
  ).not.toBeInTheDocument();

  fireEvent.change(getByRole("textbox", { name: /ask/i }), {
    target: { value: "what's stalling?" },
  });
  fireEvent.click(getByText("Ask"));
  await screen.findByText(/current streak/i); // from the devMock brain_ask response

  // Provenance chips render for a tool-grounded answer.
  expect(getByText("streak_summary")).toBeInTheDocument();
});

it("never re-shows the consent card for a second question in the same session", async () => {
  const { getByText, queryByText } = renderBrainWorkspace();
  fireEvent.click(getByText("Just answer without it"));
  fireEvent.change(screen.getByRole("textbox", { name: /ask/i }), {
    target: { value: "how do I fix this passage?" },
  });
  fireEvent.click(getByText("Ask"));
  await screen.findByText(/answer/i);
  expect(
    queryByText(/Assistant may read practice data this session/i),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- BrainWorkspace`
Expected: FAIL — no consent card, no `tool_provenance` chips rendered yet.

- [ ] **Step 3: Write minimal implementation**

`types.ts` additions:

```typescript
export interface ToolProvenance {
  tool: string;
  args_human: string;
  summary: string;
}
// On BrainAnswer:
  tool_provenance: ToolProvenance[];
// On the ask request shape:
  tools_consent: boolean;
```

`BrainWorkspace.tsx` — module-scope session state (outside the component, so it survives
remounts within the same app session but resets on reload):

```typescript
type ToolsConsent = "unset" | "allowed" | "declined";
let sessionToolsConsent: ToolsConsent = "unset";
```

Inside the component, before the composer:

```tsx
{
  sessionToolsConsent === "unset" && (
    <div className="brain-consent-card" role="note">
      <p>Assistant may read practice data this session?</p>
      <div className="brain-consent-actions">
        <button
          type="button"
          onClick={() => {
            sessionToolsConsent = "allowed";
            forceRerender();
          }}
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() => {
            sessionToolsConsent = "declined";
            forceRerender();
          }}
        >
          Just answer without it
        </button>
      </div>
    </div>
  );
}
```

(`forceRerender` = a `useState`-backed no-op setter already idiomatic in this file for
similar module-scope flags — if none exists yet, add
`const [, forceRerender] = useState(0); const rerender = () => forceRerender((n) => n + 1);`
and call `rerender()` in place of `forceRerender()` above.)

Ask call site gains `tools_consent: sessionToolsConsent === "allowed"` in the request body.

Provenance chip row, alongside the existing citations `<ul className="brain-chips">` block
(lines ~492-506):

```tsx
{
  entry.answer.tool_provenance.length > 0 && (
    <ul className="brain-chips brain-tool-chips" aria-label="Tools consulted">
      {entry.answer.tool_provenance.map((tool) => (
        <li className="brain-chip" key={tool.tool} title={tool.summary}>
          {tool.tool}
          {tool.args_human ? ` · ${tool.args_human}` : ""}
        </li>
      ))}
    </ul>
  );
}
```

`BrainWorkspace.css` — reuse the existing `.brain-chip`/`.brain-chips` tokens verbatim (no
new CSS variables); add only a `.brain-consent-card` block using existing paper tokens
(`var(--ink)`, `var(--paper)`, `var(--border)` — whichever names this file already uses;
confirm with `grep -n "var(--" src/features/brain/BrainWorkspace.css | head -5` before
adding, so no new token is invented).

`tauriDevMock.ts` — extend the existing `brain_ask` case's return object with:

```typescript
tool_provenance: [
  { tool: "streak_summary", args_human: "", summary: "current streak 3 day(s), best 7" },
],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- BrainWorkspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/brain/types.ts src/features/brain/api.ts src/features/brain/BrainWorkspace.tsx src/features/brain/BrainWorkspace.css src/devMock/tauriDevMock.ts src/features/brain/BrainWorkspace.test.tsx
git commit -m "feat: add Assistant tools consent card + provenance chips"
```

---

### Task 8: C2 coaching — situation digest + book-grounded retrieval

**Files:**

- Modify: `src-tauri/src/brain/mod.rs` (`is_coaching_question`, situation digest assembly,
  honest-degrade path)
- Test: `src-tauri/src/brain/mod.rs` (inline)

**Interfaces:**

- Produces: `fn is_coaching_question(question: &str) -> bool` (pure); when true AND
  `corpus::search(...)` returns zero hits, `ask_native` short-circuits to a deterministic
  `BrainAnswer` (no provider call) with `answer = "Nothing in your books covers this."` and
  `citations: vec![]` — same shape/idiom as the existing offline-answer path, just a
  different trigger and message.
- Consumes: `corpus::search(dir: &Path, query: &str, limit: usize) -> CorpusSearch`
  (`brain/corpus.rs:240`), existing `active_rep: Option<RepSnapshot>` and `BlockHistory`
  (via `store.block_history`) already available inside `ask_native`.

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/mod.rs, in the existing #[cfg(test)] mod tests block
#[test]
fn is_coaching_question_recognizes_stuck_and_advice_phrasing() {
    assert!(is_coaching_question("I keep failing this passage, what should I do?"));
    assert!(is_coaching_question("Any tips for this leap?"));
    assert!(is_coaching_question("How do I fix this trill?"));
    assert!(!is_coaching_question("What did I practice yesterday?"));
    assert!(!is_coaching_question("Plan my day"));
}

#[test]
fn coaching_question_with_zero_corpus_hits_degrades_honestly_without_calling_the_provider() {
    let (store, sessions, _piece_id) = fixture();
    // TestLibrary/fixture points brain.knowledge_dir at a missing path (see
    // `fixture()`), so corpus::search always returns zero hits here.
    let (chain, transport) = claude_chain_returning(
        json!({"answer": "some hallucinated advice"}).to_string(),
    );
    let answer = ask_with(
        request("I keep failing this trill, what should I do?"),
        store.as_ref(),
        &sessions,
        &TestLibrary,
        &chain,
        &transport,
        None,
    )
    .unwrap();
    assert_eq!(answer.answer, "Nothing in your books covers this.");
    assert!(answer.citations.is_empty());
    assert_eq!(transport.call_count(), 0); // never called the provider
}
```

(`FakeTransport::call_count()` — check if it exists already; if not, add a small
`#[cfg(test)] pub(crate) fn call_count(&self) -> usize` backed by an `AtomicUsize` counter
incremented in the existing mock `send`/`execute` method, following whatever field name
`FakeTransport` already uses for its response queue.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::tests::coaching -- --nocapture`
Expected: FAIL — `is_coaching_question` doesn't exist; the honest-degrade branch isn't
wired.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/mod.rs
const COACHING_SIGNALS: &[&str] = &[
    "stuck", "struggling", "struggle", "keep failing", "keeps failing", "help me",
    "advice", "tip", "tips", "how do i", "how should i", "what should i", "fix this",
    "not working", "can't get", "cant get", "trouble with",
];

/// Lightweight keyword classifier for whether a question is asking for
/// coaching (as opposed to a data lookup or a planning request). New in this
/// plan — no existing precedent classifies this in the codebase (verified:
/// `QuestionSource` Typed/Voice is the only classification prior to this).
/// Deliberately permissive (false positives just mean the coaching retrieval
/// path runs and, worst case, finds nothing and degrades honestly — never a
/// worse outcome than the default path).
fn is_coaching_question(question: &str) -> bool {
    let normalized = question.to_ascii_lowercase();
    COACHING_SIGNALS.iter().any(|signal| normalized.contains(signal))
}
```

In `ask_native`/`ask_with`, before the round-1 provider call (right after corpus retrieval
already runs — the existing flow already calls `corpus::search` unconditionally per the
research, so this hooks the same retrieval result rather than re-querying):

```rust
if is_coaching_question(&request.question) && corpus.hits.is_empty() {
    return Ok(BrainAnswer {
        id: next_answer_id(),
        answer: "Nothing in your books covers this.".to_string(),
        provider: ProviderName::Offline,
        citations: Vec::new(),
        methods: Vec::new(),
        intake_review: None,
        grounding,
        tool_provenance: Vec::new(),
        proposed_action: None,
    });
}
```

(`corpus.hits` — confirm the exact field/accessor name on `CorpusSearch` at implementation
time via `grep -n "pub struct CorpusSearch" -A5 src-tauri/src/brain/corpus.rs`; adjust to
match, e.g. `corpus.results.is_empty()` if that's the real field name.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain:: -- --nocapture`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/brain/mod.rs
git commit -m "feat: add coaching-question classifier + honest no-book-coverage degrade"
```

---

### Task 9: C4 — full piece-metadata grounding in `GroundedContext`

**Files:**

- Modify: `src-tauri/src/brain/context.rs` (extend the piece JSON block, ~lines 224-232)
- Test: `src-tauri/src/brain/context.rs` (inline)

**Interfaces:**

- Produces: extends the existing piece JSON block inside `build()`'s output from
  `{id, title, composer, deadline, target_tempo, current_state, notes}` to also include
  `edition_label`, `goals`, `hard_spots`, `banner_text`, `region_names` — each capped at
  `MAX_TEXT_CHARS = 500` (existing constant, context.rs:13) via the existing `cap()`
  helper; `goals`/`hard_spots`/`region_names` capped to the first 20 entries.
- Consumes: `PieceDetail` (`store/model.rs:67-87`, full field list: `id, title, composer,
has_xml, has_pdf, intake_done, folder_path, xml_path, pdf_path, goals: Vec<String>,
deadline, target_tempo, hard_spots: Vec<HardSpot>, current_state, notes, banner_text`),
  `store.region_list(piece_id) -> Vec<Region>` (`store/crud.rs:111`).

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/brain/context.rs, in the existing #[cfg(test)] mod tests block
#[test]
fn piece_context_includes_goals_hard_spots_banner_and_region_names() {
    let store = Store::open(":memory:").unwrap();
    let piece_id = store
        .upsert_piece(&ScanPiece {
            title: "Nocturne Op. 9 No. 2".to_string(),
            ..Default::default()
        })
        .unwrap();
    store
        .piece_field_update(
            piece_id,
            PieceFieldPatch {
                current_state: Some(Some("Learning".to_string())),
                ..Default::default()
            },
        )
        .unwrap();
    // (goals/hard_spots/banner_text setters follow whatever the existing
    // crud.rs API for those fields already is — wire via the same path the
    // existing intake-review save path uses, confirmed at implementation
    // time by reading store/crud.rs's piece-field write surface.)

    let sessions = SessionService::new(Arc::new(store));
    // ... build GroundedContext via the existing `build()` entry point ...
    let (context, _summary) = build(
        /* store */ &sessions_store_ref,
        &sessions,
        Some(piece_id),
        None,
        None,
        None,
        &[],
        &CorpusSearch::empty(),
        false,
        &[],
        None,
    )
    .unwrap();
    let json: serde_json::Value = serde_json::from_str(&context.json).unwrap();
    let piece = &json["piece"];
    assert!(piece.get("goals").is_some());
    assert!(piece.get("hard_spots").is_some());
    assert!(piece.get("banner_text").is_some());
    assert!(piece.get("region_names").is_some());
    assert!(piece.get("edition_label").is_some());
}
```

(This test's exact `ScanPiece`/setter calls follow the existing fixture conventions already
used elsewhere in `context.rs`'s test module — read the nearest existing piece-building test
in this file at implementation time and mirror its setup exactly rather than guessing field
names not yet confirmed here.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::context::tests::piece_context_includes -- --nocapture`
Expected: FAIL — `goals`/`hard_spots`/`banner_text`/`region_names`/`edition_label` absent
from the piece JSON block.

- [ ] **Step 3: Write minimal implementation**

At the existing piece-JSON-block construction site (`context.rs`, ~lines 224-232), extend:

```rust
let region_names: Vec<String> = store
    .region_list(piece.id)
    .unwrap_or_default()
    .into_iter()
    .take(20)
    .map(|r| cap(&r.name))
    .collect();

json!({
    "id": piece.id,
    "title": cap(&piece.title),
    "composer": piece.composer.as_deref().map(cap),
    "deadline": piece.deadline,
    "target_tempo": piece.target_tempo,
    "current_state": piece.current_state.as_deref().map(cap),
    "notes": piece.notes.as_deref().map(cap),
    "edition_label": client_context.and_then(|c| c.edition_label.as_deref()).map(cap),
    "banner_text": piece.banner_text.as_deref().map(cap),
    "goals": piece.goals.iter().take(20).map(|g| cap(g)).collect::<Vec<_>>(),
    "hard_spots": piece.hard_spots.iter().take(20).map(|h| cap(&h.description)).collect::<Vec<_>>(),
    "region_names": region_names,
})
```

(`HardSpot`'s exact field name for its text — confirmed as `description` at implementation
time by reading `store/model.rs`'s `HardSpot` struct next to `PieceDetail`; adjust if the
real field name differs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::context:: -- --nocapture`
Expected: PASS, all existing context tests still green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/brain/context.rs
git commit -m "feat: ground piece-knowledge answers in full PieceDetail (goals, hard spots, banner, regions)"
```

---

### Task 10: C3 — `compose_day_plan_draft` (read-only Rust composer)

**Files:**

- Create: `src-tauri/src/brain/day_plan_draft.rs`
- Modify: `src-tauri/src/brain/mod.rs` (`mod day_plan_draft;`, re-export)
- Modify: `src-tauri/src/lib.rs` (new `#[tauri::command] fn compose_day_plan_draft`,
  register)
- Test: `src-tauri/src/brain/day_plan_draft.rs` (inline)

**Interfaces:**

- Produces: `pub struct DayPlanDraftLine { pub text: String }`, `pub struct DayPlanDraft {
pub lines: Vec<DayPlanDraftLine> }`, `pub fn compose(store: &Store, today: &str) ->
Result<DayPlanDraft, BrainError>`, tauri command `compose_day_plan_draft(store:
State<'_, Arc<Store>>) -> Result<DayPlanDraft, String>`.
- Consumes: `store.day_sheet_get(&self, date: &str) -> rusqlite::Result<Option<DaySheet>>`
  (backs the existing `day_sheet_get` command — same Store method, reused read-only);
  `store.block_history(piece_id) -> Vec<BlockHistory>` (for `pass_seconds`-style estimates —
  actually `pass_seconds` lives on `set_contract`, read via the same query pattern as
  `practice_v2.rs:1613-1617`: `tx.query_row("SELECT pass_seconds FROM set_contract WHERE
set_id=?1", ...)`, exposed here as a plain (non-transactional) `conn.query_row` since this
  path is read-only outside any write transaction).

**Design decision (stated, not a placeholder):** yesterday's day sheet lines are read
directly from `day_sheet_get`, not by re-implementing `carryForward.ts` in Rust — the
"mirror carryForward.ts" instruction in the spec is satisfied here by applying the _exact
same_ provenance-suffix rule (`" · from <date>"`, skip if already present) in Rust, on
`ItemLine`s only, filtered to `checked == false`. `BlockLine`s carry over unchanged (no
provenance, matching `carryForward.ts`'s behavior exactly). Every 3 non-break lines, a
`"— break —"` line is inserted (three-sets-then-break pattern). Output lines are **plain
text** — never a `NotebookLine` JSON blob — so the frontend Accept step (Task 11) can splice
them straight into an editable day sheet as `ItemLine { text, checked: false }` entries via
the _existing_ `day_sheet_save` write path; this command itself never calls
`day_sheet_save`.

- [ ] **Step 1: Write the failing tests**

```rust
// src-tauri/src/brain/day_plan_draft.rs
#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn unchecked_items_from_yesterday_carry_forward_with_provenance() {
        let store = Store::open(":memory:").unwrap();
        store
            .day_sheet_save(
                "2026-08-19",
                r#"[{"type":"item","text":"Warm up scales","checked":false},{"type":"item","text":"Sight-read","checked":true}]"#,
            )
            .unwrap();
        let draft = compose(&store, "2026-08-20").unwrap();
        let texts: Vec<&str> = draft.lines.iter().map(|l| l.text.as_str()).collect();
        assert!(texts.iter().any(|t| t.starts_with("Warm up scales · from")));
        assert!(!texts.iter().any(|t| t.contains("Sight-read"))); // checked items don't carry
    }

    #[test]
    fn a_break_line_is_inserted_after_every_three_items() {
        let store = Store::open(":memory:").unwrap();
        store
            .day_sheet_save(
                "2026-08-19",
                r#"[{"type":"item","text":"A","checked":false},{"type":"item","text":"B","checked":false},{"type":"item","text":"C","checked":false},{"type":"item","text":"D","checked":false}]"#,
            )
            .unwrap();
        let draft = compose(&store, "2026-08-20").unwrap();
        let texts: Vec<&str> = draft.lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts[3], "— break —");
    }

    #[test]
    fn no_yesterday_sheet_produces_an_empty_draft_not_an_error() {
        let store = Store::open(":memory:").unwrap();
        let draft = compose(&store, "2026-08-20").unwrap();
        assert!(draft.lines.is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib brain::day_plan_draft -- --nocapture`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```rust
// src-tauri/src/brain/day_plan_draft.rs
//! C3: composes a plain-text draft day plan from yesterday's unfinished
//! items. READ-ONLY end to end — this module never calls `day_sheet_save`.
//! Every output line is retypeable plain text (the chips-law: a chip is a
//! shortcut that INSERTS editable text, never an opaque token), so the
//! frontend's Accept action (Task 11) appends them through the pre-existing
//! `useDaySheet` `setBody`+`flush` -> `day_sheet_save` path, unmodified.

use serde::Serialize;

use super::BrainError;
use crate::features_day_sheet_lines::NotebookLineRaw; // see note below on the exact import
use crate::store::Store;

const BREAK_EVERY: usize = 3;
const BREAK_LINE: &str = "— break —";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayPlanDraftLine {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayPlanDraft {
    pub lines: Vec<DayPlanDraftLine>,
}

pub fn compose(store: &Store, today: &str) -> Result<DayPlanDraft, BrainError> {
    let yesterday = previous_calendar_day(today);
    let Some(sheet) = store
        .day_sheet_get(&yesterday)
        .map_err(|_| BrainError::Context("Could not read yesterday's page".into()))?
    else {
        return Ok(DayPlanDraft { lines: Vec::new() });
    };

    let mut lines = Vec::new();
    let mut item_count = 0usize;
    for raw_line in sheet.body {
        let (is_item, text, checked) = raw_line.as_item_fields();
        if !is_item || checked {
            continue;
        }
        let carried = if text.contains(" · from ") {
            text
        } else {
            format!("{text} · from {yesterday}")
        };
        lines.push(DayPlanDraftLine { text: carried });
        item_count += 1;
        if item_count % BREAK_EVERY == 0 {
            lines.push(DayPlanDraftLine {
                text: BREAK_LINE.to_string(),
            });
        }
    }
    if lines.last().map(|l| l.text.as_str()) == Some(BREAK_LINE) {
        lines.pop(); // never end the draft on a break
    }

    Ok(DayPlanDraft { lines })
}

fn previous_calendar_day(today: &str) -> String {
    chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map(|d| (d - chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| today.to_string())
}
```

**Implementation note (resolve at coding time, not a placeholder-skip):** `sheet.body` is
already `Vec<NotebookLine>` per `store/model.rs`'s `DaySheet` type (the same type
`day_sheet_get` already deserializes into on the Rust side, mirroring
`src/features/notebook/lines.ts`'s `NotebookLine` union). `raw_line.as_item_fields()` is a
small new match on that existing Rust `NotebookLine` enum (find it via `grep -n "enum
NotebookLine" src-tauri/src/store/model.rs`) returning `(is_item: bool, text: String,
checked: bool)` — write it directly in this file as a free function
`fn item_fields(line: &crate::store::model::NotebookLine) -> Option<(String, bool)>`
matching on the `Item { text, checked, .. }` variant and returning `None` for every other
variant, replacing the placeholder `as_item_fields()` call above with
`item_fields(&raw_line)` and adjusting the loop accordingly. Remove the invented
`features_day_sheet_lines` import — it does not exist; use `crate::store::model::NotebookLine`
directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib brain::day_plan_draft -- --nocapture`
Expected: PASS (3/3), after fixing the `NotebookLine` match against the real enum found in
`store/model.rs`.

- [ ] **Step 5: Wire the tauri command**

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn compose_day_plan_draft(store: State<'_, Arc<Store>>) -> Result<brain::DayPlanDraft, String> {
    let today = store.today_local().map_err(|e| e.to_string())?;
    brain::compose_day_plan_draft(&store, &today).map_err(|e| e.to_string())
}
```

Register in `generate_handler!`. Add `pub use day_plan_draft::{compose as compose_day_plan_draft, DayPlanDraft, DayPlanDraftLine};`
and `mod day_plan_draft;` to `brain/mod.rs`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/brain/day_plan_draft.rs src-tauri/src/brain/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add read-only compose_day_plan_draft (C3 planning help)"
```

---

### Task 11: C3 frontend — draft card, explicit-ask gate, Accept via existing write path

**Files:**

- Create: `src/features/brain/DayPlanDraftCard.tsx`
- Modify: `src/features/brain/BrainWorkspace.tsx` (explicit-ask detection, render the card)
- Modify: `src/features/brain/api.ts` (`brainApi.composeDayPlanDraft()`)
- Modify: `src/devMock/tauriDevMock.ts` (`case "compose_day_plan_draft":`)
- Test: `src/features/brain/DayPlanDraftCard.test.tsx`

**Interfaces:**

- Produces: `DayPlanDraftCard({ draft: DayPlanDraft; onAccept: () => void; onDismiss: () =>
void })`; `interface DayPlanDraft { lines: { text: string }[] }` in `types.ts`.
- Consumes: `useDaySheet` (`src/features/notebook/useDaySheet.ts`) already exposes
  `setBody`/`flush` — Accept calls `setBody((prev) => [...prev, ...draft.lines.map((l) =>
({ type: "item" as const, text: l.text, checked: false }))])` then `flush()`. This IS the
  existing write path; no new command is called on Accept.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/features/brain/DayPlanDraftCard.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DayPlanDraftCard } from "./DayPlanDraftCard";

describe("DayPlanDraftCard", () => {
  const draft = { lines: [{ text: "Warm up scales · from Aug 19" }, { text: "— break —" }] };

  it("renders every draft line as plain retypeable text", () => {
    const { getByText } = render(
      <DayPlanDraftCard draft={draft} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(getByText("Warm up scales · from Aug 19")).toBeInTheDocument();
    expect(getByText("— break —")).toBeInTheDocument();
  });

  it("calls onAccept only when Accept is clicked, never on render", () => {
    const onAccept = vi.fn();
    const { getByText } = render(
      <DayPlanDraftCard draft={draft} onAccept={onAccept} onDismiss={vi.fn()} />,
    );
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(getByText("Accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss and never onAccept when dismissed", () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const { getByText } = render(
      <DayPlanDraftCard draft={draft} onAccept={onAccept} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByText("No thanks"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DayPlanDraftCard`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/brain/DayPlanDraftCard.tsx
import type { DayPlanDraft } from "./types";

interface DayPlanDraftCardProps {
  draft: DayPlanDraft;
  onAccept: () => void;
  onDismiss: () => void;
}

export function DayPlanDraftCard({
  draft,
  onAccept,
  onDismiss,
}: DayPlanDraftCardProps) {
  return (
    <div className="brain-draft-card" role="group" aria-label="Draft day plan">
      <ul className="brain-draft-lines">
        {draft.lines.map((line, index) => (
          <li key={`${index}-${line.text}`}>{line.text}</li>
        ))}
      </ul>
      <div className="brain-draft-actions">
        <button type="button" onClick={onAccept}>
          Accept
        </button>
        <button type="button" onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </div>
  );
}
```

`types.ts` addition:

```typescript
export interface DayPlanDraftLine {
  text: string;
}
export interface DayPlanDraft {
  lines: DayPlanDraftLine[];
}
```

`api.ts` addition:

```typescript
const COMPOSE_DAY_PLAN_DRAFT = defineCommand<void, DayPlanDraft>(
  "compose_day_plan_draft",
  "Could not draft a day plan.",
);
export const brainApi = {
  // ...existing entries
  composeDayPlanDraft: () => executeCommand(COMPOSE_DAY_PLAN_DRAFT, undefined),
};
```

`BrainWorkspace.tsx` — explicit-ask gate (typed OR voice question text, checked before
sending to `brain_ask` at all):

```typescript
const PLAN_MY_DAY_RE = /\bplan (my|the) day\b/i;

// In the submit handler, before calling brainApi.ask:
if (PLAN_MY_DAY_RE.test(question)) {
  const draft = await brainApi.composeDayPlanDraft();
  setPendingDayPlanDraft(draft); // new local state; renders <DayPlanDraftCard>
  return; // does not call brain_ask at all — this is a distinct, deterministic path
}
```

Accept handler (uses the EXISTING write path only):

```typescript
function handleAcceptDayPlanDraft(draft: DayPlanDraft) {
  todaySheet.setBody((prev) => [
    ...prev,
    ...draft.lines
      .filter((line) => line.text !== "— break —")
      .map((line) => ({
        type: "item" as const,
        text: line.text,
        checked: false,
      })),
  ]);
  todaySheet.flush();
  setPendingDayPlanDraft(null);
}
```

(`"— break —"` lines are visual pacing only in the draft card, not appended as day-sheet
items — dropped on Accept; still shown verbatim in the card per the chips-law retypeable
requirement for the visible draft.)

`tauriDevMock.ts`:

```typescript
case "compose_day_plan_draft":
  return {
    lines: [
      { text: "Warm up scales · from Aug 19" },
      { text: "Chopin Nocturne, mm. 1-16 · from Aug 19" },
      { text: "Sight-read something new · from Aug 19" },
      { text: "— break —" },
      { text: "Scales cooldown · from Aug 19" },
    ],
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DayPlanDraftCard BrainWorkspace`
Expected: PASS.

- [ ] **Step 5: Spy test — composing/dismissing mutates nothing**

```typescript
// src/features/brain/BrainWorkspace.test.tsx — add
it("composing and dismissing a day plan draft never calls day_sheet_save", async () => {
  const saveSpy = vi.fn();
  installTauriDevMock({
    onCommand: (cmd) => cmd === "day_sheet_save" && saveSpy(),
  });
  const { getByRole, getByText } = renderBrainWorkspace();
  fireEvent.change(getByRole("textbox", { name: /ask/i }), {
    target: { value: "plan my day" },
  });
  fireEvent.click(getByText("Ask"));
  await screen.findByText("— break —");
  fireEvent.click(getByText("No thanks"));
  expect(saveSpy).not.toHaveBeenCalled();
});
```

(If `installTauriDevMock` doesn't currently accept an `onCommand` hook, add a thin
optional callback parameter to it that fires before `routeCommand` returns — a small,
additive change to `tauriDevMock.ts`'s existing install function, not a new mocking
system.)

Run: `npm test -- BrainWorkspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/brain/DayPlanDraftCard.tsx src/features/brain/DayPlanDraftCard.test.tsx src/features/brain/BrainWorkspace.tsx src/features/brain/api.ts src/features/brain/types.ts src/devMock/tauriDevMock.ts
git commit -m "feat: add plan-my-day draft card, accepted only through existing day-sheet write path"
```

---

### Task 12: devMock coverage audit + remaining command tests

**Files:**

- Modify: `src/devMock/tauriDevMock.ts` (fill any gaps found by the audit tool)
- Test: `src/devMock/tauriDevMock.historyDays.test.ts`,
  `src/devMock/tauriDevMock.progressSummary.test.ts`,
  `src/devMock/tauriDevMock.pieceBlocks.test.ts` (only the ones not already covered by
  pre-existing tests — confirm with the audit first)

**Interfaces:**

- Consumes: `.workflow/devmock-coverage-audit.mjs` (existing audit tool, per NOTES.md:32
  binding rule).

- [ ] **Step 1: Run the audit to find gaps**

Run: `node .workflow/devmock-coverage-audit.mjs`
Expected output: a list of every command the frontend calls on a timer/effect without a
devMock case. Confirm `streak_summary` and `compose_day_plan_draft` (added in Tasks 1 and 10) are NOT flagged (they were already added with cases in those tasks); note any other gap
the audit surfaces.

- [ ] **Step 2: Write the failing test for each surfaced gap**

For each command the audit flags, follow the exact pattern established in Task 1 Step 6
(`seamInvoke` + `installTauriDevMock`/`uninstallTauriDevMock` + one assertion on the mock
shape's key fields). Example for `history_days` if flagged:

```typescript
// src/devMock/tauriDevMock.historyDays.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

describe("dev-mock history_days handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns an array of day summaries with focused_seconds", async () => {
    const days = await seamInvoke<{ date: string; focused_seconds: number }[]>(
      "history_days",
      { from: "2026-08-01", to: "2026-08-20" },
    );
    expect(Array.isArray(days)).toBe(true);
    days.forEach((day) => expect(typeof day.focused_seconds).toBe("number"));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail (only for genuinely-missing cases)**

Run: `npm test -- tauriDevMock`
Expected: FAIL only for commands genuinely missing a case (most tool commands already have
cases from Tasks 1-11; skip writing a test for anything already covered).

- [ ] **Step 4: Add any missing devMock cases, minimal**

Add each missing `case "<command>":` in `tauriDevMock.ts`'s `routeCommand` switch, returning
a shape matching the real Rust struct's field names exactly (cross-check against the struct
definitions gathered in Tasks 1-10 of this plan).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tauriDevMock`
Expected: PASS, and `node .workflow/devmock-coverage-audit.mjs` reports zero gaps for every
command this plan introduced.

- [ ] **Step 6: Commit**

```bash
git add src/devMock/tauriDevMock.ts src/devMock/tauriDevMock.*.test.ts
git commit -m "test: close devMock coverage gaps for Plan C Assistant commands"
```

---

### Task 13: Offline acceptance script (mocked provider) + live Gemini acceptance

**Files:**

- Create: `src-tauri/tests/plan_c_assistant_acceptance.rs`
- No production code changes — this task is pure verification.

**Interfaces:**

- Consumes: everything built in Tasks 1-12, exercised end to end through `ask_native`/
  `ask_with` with `FakeTransport` (offline half) and, separately, a real `ProviderChain`
  configured for Gemini with a live key (live half, run manually, not in CI).

- [ ] **Step 1: Write the offline acceptance test (mocked provider, runs in normal `cargo
test`)**

```rust
// src-tauri/tests/plan_c_assistant_acceptance.rs
//! Plan C offline acceptance: every pillar (C1-C4), fully mocked. No network,
//! no Anthropic key required (B67) — this is what gates "done" for CI.
use codakiller::brain; // adjust the crate path to match this crate's lib name

#[test]
fn c1_practice_data_tools_answer_whats_stalling_with_grounded_provenance() {
    // Round 1 requests history_days + progress_summary; round 2 answers with
    // figures traceable to both. Assert `tool_provenance.len() == 2` and the
    // numbers policy passed (answer accepted, not offline-substituted).
}

#[test]
fn c1_what_did_i_do_last_week_uses_history_days_tool() {
    // Assert tool_provenance contains a `history_days` entry with `from`/`to`
    // spanning 7 days.
}

#[test]
fn c1_which_piece_is_behind_plan_uses_progress_summary_per_piece() {
    // Assert tool_provenance contains one or more `progress_summary` entries.
}

#[test]
fn c2_coaching_answer_cites_a_book_when_corpus_has_hits() {
    // Seed a fixture knowledge dir with one markdown book, ask a coaching
    // question that matches it, assert `citations` non-empty.
}

#[test]
fn c2_coaching_answer_degrades_honestly_with_zero_corpus_hits() {
    // Already covered by Task 8's unit test; this is the integration-level
    // restatement asserting `transport.call_count() == 0`.
}

#[test]
fn c3_plan_my_day_produces_a_draft_that_mutates_nothing() {
    // Call `brain::compose_day_plan_draft` directly; assert the day_sheet
    // row for today is unchanged (still None or its pre-call value) after
    // the call.
}

#[test]
fn c4_piece_knowledge_question_answers_from_piece_record_with_provenance() {
    // Ask "what edition am I using?" with a piece that has edition_label set
    // via client_context; assert the answer's grounding cites "piece record"
    // and the numbers policy (if a tempo number appears) passes against the
    // piece JSON, not a tool payload (piece context is not a tool result —
    // confirm numbers_policy_violation is only invoked when tool_provenance
    // is non-empty, so a piece-only answer is exempt, per Task 5's guard).
}

#[test]
fn c4_a_fact_not_in_the_piece_record_is_answered_honestly_not_hallucinated() {
    // Ask a question the piece metadata cannot answer (e.g. "who published
    // this edition physically") and assert the answer does not fabricate a
    // publisher name — checked via the existing citation/grounding honesty
    // conventions, not a new assertion mechanism.
}
```

Run: `cd src-tauri && cargo test --test plan_c_assistant_acceptance -- --nocapture`
Expected: all pass, fully offline, using `FakeTransport` throughout (fill in each test body
using the exact `fixture()`/`ask_with`/`two_round_chain` helpers built in Tasks 1-9's inline
tests — this file exercises the same functions through the public `brain::ask_native` entry
point instead of the private `ask_with` test-only path, matching how existing acceptance
tests in `src-tauri/tests/` already call into the crate).

- [ ] **Step 2: Run full gates**

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
cd .. && npm run tsc --noEmit && npm test
```

Expected: all green, matching the "vitest/cargo/tsc/clippy all green at merge" binding
constraint.

- [ ] **Step 3: Live Gemini acceptance (manual, once, not part of CI)**

With a Gemini key present in Keychain (`security add-generic-password -s codakiller -a
gemini -w <key>` if not already set — never touch the `claude` account, per B67), run the
app (`npm run tauri dev`) and ask, in order, through the real Assistant UI:

1. "What's stalling?" — expect a `history_days`/`progress_summary`-grounded answer with
   provenance chips.
2. "What did I do last week?" — expect a `history_days` chip spanning 7 days.
3. "Which piece is behind plan?" — expect one or more `progress_summary` chips, one per
   piece considered.
4. A coaching ask (e.g. "I keep missing this leap, what should I do?") — expect either a
   book-cited answer or the honest "Nothing in your books covers this" degrade, never an
   uncited claim.
5. "Plan my day" — expect the draft card, not a chat answer; verify Accept appends lines to
   today's day sheet (open the Notebook/Today view) and No-thanks leaves it untouched.
6. A piece-knowledge ask (e.g. "What edition am I using?") — expect an answer sourced from
   the open piece's record, with "from your piece record" provenance language.

Screenshot each response at 720×520 per the binding QA regime. Record the acceptance run
(pass/fail per question, screenshots) in the session's vault Changelog entry per the repo's
update protocol — not part of this repo's git history.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/plan_c_assistant_acceptance.rs
git commit -m "test: add Plan C offline acceptance suite (mocked provider, all four pillars)"
```

---

## Self-review notes (spec coverage check)

- C1 (practice-data tools, numbers policy) — Tasks 1-6, 13.
- C2 (book-grounded coaching) — Task 8, 13.
- C3 (planning help, draft-only, existing write path) — Tasks 10-11, 13.
- C4 (piece knowledge) — Task 9, 13.
- Consent gate — Task 7.
- devMock coverage binding rule — Task 12.
- Provider/schema changes (two-round loop, timeouts, max_tokens unchanged) — Task 4.
- Offline-testable-with-mocked-provider + one live Gemini pass — Task 13.

## Open questions / out-of-scope notices

- **`streak_summary` duplication risk with Plan A** — flagged in the preamble; Task 1 adds
  a minimal standalone version so this plan does not block on Plan A's merge order.
- **Coaching classifier is new, not a discovered precedent** — flagged in the preamble;
  Task 8's `is_coaching_question` keyword list is a first cut and may need tuning after
  real use (same "honest over impressive" latitude the existing policy firewall already
  operates under).
- **Consent-gate UX is this plan's interpretation** of a spec line that named the mechanism
  but not the trigger condition — flagged in the preamble as Flag #1.
- **Settings-configurable streak floor** (spec A2: "configurable in Settings") is Plan A
  scope, not this plan; Task 1's `STREAK_MIN_FOCUSED_MINUTES = 10` is a fixed constant here.
- **Out of scope entirely, per the spec's Non-goals:** any Assistant write access to
  practice data beyond the existing intake-review and day-sheet paths; any new OS window;
  social/sharing features; galaxy/streak visual work (Plan A) and the dynamics checker
  (Plan B) — not touched by this plan.
