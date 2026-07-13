# CodaKiller P5.5 — Goals, Calendar + Missed-Day Recovery

> **Status:** active · **Target:** v0.6.0 · **Branch:** `p55-calendar`
> **Goal:** turn big goals into explicit daily work and recover missed days without punishment,
> silent rescheduling, fake practice credit, or AI scheduling authority.

## 🧭 Quick nav

[Locked rules](#-locked-recovery-rules) · [Schema](#-schema-v5) ·
[Checklist](#-execution-checklist) · [Contracts](#-runtime-contracts) ·
[Gate](#-release-gate) · [Non-goals](#-non-goals)

## 🔒 Locked recovery rules

1. “Missed” means only an unfinished daily-work row scheduled before the backend's local today.
2. Calendar opening may show a recovery **preview**; preview writes nothing.
3. Only missed daily work moves. Goal deadlines, future work, planner order, and goal completion do not.
4. Stable priority: effective deadline → oldest missed date → goal order → work id.
5. Recovery searches today + six days and respects a visible daily capacity (default 60 minutes).
6. Recovered work can use at most half of one day's capacity; total work never exceeds capacity.
7. Oversized/deadline-conflicted work remains unresolved with a reason—never silently overloaded.
8. Per item Christian chooses **Move**, **Done—I did it**, **Dismiss**, or **Leave unresolved**;
   proposed dates remain editable.
9. One explicit **Apply** is atomic and optimistic; stale data rejects the whole batch.
10. `origin_date` never changes; a move increments `reschedule_count`.
11. Completion/recovery never fabricates practice time, practice days, rep verdicts, or goal completion.
12. No broken-streak state, shame copy, penalty multiplier, red failure animation, or leaderboard.

## 🗃️ Schema v5

Add `daily_work`:

```text
id · goal_id FK RESTRICT · region_id? · block_id? · title · planned_minutes 1..240
origin_date immutable · scheduled_date · status planned|done|dismissed
source manual|planner|recovery · reschedule_count · sort_order
completed_ts? · created_ts · updated_ts
```

Piece ownership is derived through Goal. Optional Region/block ownership is validated in Rust.
Add append-only `daily_work_change` and `recovery_apply` events; previews never become events.

## ✅ Execution checklist

- [ ] **P5.5.1 — Shared strict dates.** One Gregorian date utility; remove planner/metrics/Brain
  parser duplication; leap/month/year/local-midnight tests.
- [ ] **P5.5.2 — Schema v5.** Crash-atomic migration, preservation/idempotence tests, indexes,
  constraints, real-DB backup rehearsal.
- [ ] **P5.5.3 — Harden Goal tree.** Big/sub invariants, strict dates, safe delete, exact sibling
  reorder, no orphan/cycle/cross-piece parent.
- [ ] **P5.5.4 — Daily-work CRUD.** Ownership, minutes/status/source validation, optimistic
  timestamps, immutable origin, events, exact list ranges.
- [ ] **P5.5.5 — Pure recovery engine.** Capacity/deadline bounded stable proposals, explicit
  reasons, unresolved cases, zero writes.
- [ ] **P5.5.6 — Atomic recovery Apply.** Move/Done/Dismiss/Leave decisions, stale all-or-nothing,
  origin/reschedule audit, no practice-metric or Goal side effects.
- [ ] **P5.5.7 — Nested Goals UI.** Two-level tree, dates, Add subgoal, completion and daily-work
  summaries, keyboard/dark/light/narrow gates.
- [ ] **P5.5.8 — Calendar workspace.** Seven-day strip, piece + goal path + minutes, create/edit/
  move/complete/dismiss/delete, capacity display, previous/next week.
- [ ] **P5.5.9 — Recovery review UI.** Neutral grouped misses, visible proposal/reason, editable
  action/date, Cancel=zero writes, one Apply.
- [ ] **P5.5.10 — Planner bridge.** Explicit Schedule action from deterministic suggestions;
  non-punitive active-day copy; no provider-authored schedule.
- [ ] **P5.5.11 — Adversarial + live gate.** Fresh review, full suites/build/clippy, migration on
  copied real DB, installed create/miss/cancel/apply/relaunch flow.
- [ ] **P5.5.12 — Ship v0.6.0.** Docs/tutorial/flaws/version record, one sealed app, schema 5
  integrity, exact-one-app check, tag, fast-forward `main`.

## 🔌 Runtime contracts

```text
daily_work_list({from,to,piece_id?}) -> DailyWork[]
daily_work_create({goal_id,region_id?,block_id?,title,minutes,date,source}) -> DailyWork
daily_work_update({id,expected_updated_ts,patch}) -> DailyWork
daily_work_delete({id,expected_updated_ts}) -> ()
recovery_preview() -> {today,capacity_minutes,items[],days[]}
recovery_apply({decisions:[{id,expected_updated_ts,action,date?}]}) -> {applied_at,items[]}
```

## 🧪 Release gate

- v4→v5 preserves every piece/Goal/Region/block/rep/event/PDF preference; integrity/FKs pass.
- Yesterday's item appears; Cancel changes zero rows; edited Move, Done, Dismiss, and Leave survive
  relaunch; stale Apply writes nothing.
- No automatic deadline, Goal completion, practice time/day, or verdict mutation.
- Dark/light + keyboard + narrow Calendar pass; full Rust/frontend/clippy/build green.
- `/Applications/CodaKiller.app` is sealed v0.6.0 and the only bundle on disk/Spotlight.

## 🚫 Non-goals

No OS Calendar sync, month grid, drag-and-drop scheduler, recurring rules, notifications, AI-authored
schedules, automatic recovery writes, punishment streaks, or `spot_review` reuse.

## Next action

Land the strict shared date seam and schema v5 preservation gate before any Calendar UI.
