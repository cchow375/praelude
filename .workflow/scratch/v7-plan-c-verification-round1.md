# Plan C (tasks 2-7) — fresh-context adversarial verification, round 1 (2026-08-24)

Verified at `v7/plan-c` @ `be1d31d`. Gates independently reproduced: vitest 2239 passed/1
skipped, cargo 927 passed/0 failed, clippy --all-targets clean, tsc clean. Deltas fully
accounted for (+4 vitest, +23 cargo), zero tests deleted or skipped (grep for added
.skip/.todo/#[ignore]: no matches).

## CONFIRMED
- **Two-round bound is structurally sound.** Proven by HTTP call COUNT with a third response
  queued so a third call would be observable. Round 2 re-requesting tools → 2 calls. Round 1
  requesting MAX+1 → 2 calls (take(3) holds). Round 2 requesting an unknown tool `rm_rf` → 2
  calls. Defense in depth: provider.rs:328 forces tool_requests empty on Final, AND mod.rs:963
  discards the field with no loop — a single `if`, structurally incapable of a third round.
- **Tools are strictly read-only.** tool_exec::execute is the only execution site; all five
  reachable store functions scanned for INSERT|UPDATE|DELETE|CREATE|DROP|execute|transaction —
  all NONE. Range capped at MAX_RANGE_DAYS=400, so no unbounded scan.
- **Consent gate holds.** Rust && short-circuits on consent before the only execute() call.
  Empirically with consent false: http=1, prov=0 — the queued round-2 response never drained.
- **All six claimed plan-code bug fixes are REAL** (3 spot-checked): the plan did invent a
  nonexistent `metrics::StreakSummary{current_streak,best_streak,qualifying_day_count}` shape
  (real type is store::streaks::StreakSummary{current_days,best_days,...}); validate_raw did
  unconditionally reject empty answers, which would have broken every round-1 tool reply the
  plan's own prompt instructs the model to send; and removing the tool_provenance exemption
  from the citation gate empirically replaces tool-grounded answers with an offline substitute.

## REFUTED — the numbers policy (redesign dispatched)
Seven defects. The guarantee "no figure without a tool row behind it" does not hold.

1. **SEVERE — spelled-out numbers bypass entirely.** `NUMBER_RE = \d[\d,]*(?:\.\d+)?` sees only
   digits. End-to-end through ask_with: real current_days=0, answer "You have practiced this
   passage twelve times and your streak is nineteen days" → **Ok, http=2, prov=1**. A fabricated
   answer ships WITH a streak_summary provenance chip. The committed test uses "12"; "twelve"
   sails through. A chip on a fabricated answer launders invention with a credibility badge.
2. **SEVERE — date strings pollute the backing pool.** collect_tool_numbers walks STRING leaves,
   so "2026-08-20" donates 2026, 8, 20. One history_days row makes "You touched 20 pieces and
   had 8 sessions" ACCEPT. Any integer 1-31 is backed by some date in range.
3. **HIGH — bidirectional x60/÷60 expansion.** current_days:3 backs "180 minutes"; any tool
   value under 30 backs both "0" and "1".
4. **HIGH — cross-tool pooling.** tool_payloads flattens to one Vec<f64> with no attribution:
   "Your streak is 1660 days" ACCEPTS because 1660 is a *different* tool's focused_seconds.
5. **HIGH — scope causes false-rejects.** Once any tool runs, every number must trace to a tool
   payload, so a book quote's "60% tempo", "96 bpm", today's date and "3rd" all hard-fail with
   PolicyViolation. A mixed question (streak + what the book says) is a guaranteed failure.
   Also "Days 3,7" merges to 37 via the regex.
6. **MEDIUM — validate_raw is not round-aware** (provider.rs:869-877): it tests the RAW wire
   tool_requests field, populated on round 2 too, so {"answer":"", "tool_requests":[...]} on
   Final yields Ok(answer="") with a provenance chip. That reply was rejected before this work.
7. **MEDIUM — round-prompt wiring is untested** (provider.rs:44-70). Flipping the round_prompt
   match or deleting the _for_round append leaves all 927 tests green. Under the flip, round 1
   is told NOT to request tools, so the tool loop silently never fires in production.

## Mutation results
| mutant | result |
|---|---|
| numbers_policy_violation → always None | KILLED (5 tests) |
| epsilon 1e-9 → 0.5 | KILLED |
| remove tool_provenance citation exemption | KILLED (2 tests) |
| remove consent check | KILLED |
| remove round-2 discard | KILLED |
| **flip round_prompt match (First↔Final)** | **SURVIVED** |
| **delete the per-round prompt append** | **SURVIVED** |

## Ruling (orchestrator, 2026-08-24)
Redesign, not patch. Scanning free text against a flat number pool is simultaneously too weak
(spelled-out, pooled, date-polluted, x60-expanded) and too strong (book quotes, bpm, dates).
Replaced by STRUCTURED ATTRIBUTED FIGURES: round 2 returns figures[]{shown,tool,field}; each
must resolve to a real numeric leaf of that named tool's payload under a closed list of
permitted renderings; every number-like token in the answer (digits AND words) must be covered
by a figure or match a narrow exemption (ISO date, bare year, N-before-"bpm", a number verbatim
inside a cited book chunk). Ordinals are NOT exempt. Failure stays PolicyViolation — an
unverifiable practice figure must not ship. Accepted fallback if the model cannot reliably emit
figures[]: forbid numerals in tool-grounded answers entirely and answer qualitatively with the
chip. **A qualitative true answer beats a quantitative invented one.**
