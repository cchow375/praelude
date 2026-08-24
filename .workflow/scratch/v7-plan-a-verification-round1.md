# Plan A (tasks 1-4) — fresh-context adversarial verification, round 1 (2026-08-23)

Verified at `v7/plan-a` @ `e0b5aa4`. Gates independently reproduced: vitest 2146 passed/1
skipped, cargo 871 passed/0 failed, clippy 0, tsc 0. Tokens: `src/design/tokens.css` byte-identical
to merge-base, no `var(--…)` dropped from universe.css, no raw hex introduced.

## CONFIRMED
- streak_summary BEHAVIOUR is correct — survived 13 independent probes written by the verifier
  (600s clears a 10-min bar, 599s does not; gap breaks current but not best; two 300s sessions on
  one day sum; non-practice kinds contribute 0; a >120s idle gap contributes 0; future-dated day
  cannot manufacture a streak; Feb 28 → Mar 1 2026 contiguous). The executor's three fixes to the
  plan's pasted code were all necessary: `set_session_started_at` and `Store::open_in_memory()` do
  not exist, and `insert_session_event_at` writes `session_event` while streak_summary reads the
  canonical `event` table — the plan's tests would have been vacuous.
- Determinism: layout deep-equal + byte-identical across runs; ZERO rAF/setInterval/setTimeout/
  Date.now/Math.random/performance.now/d3/force/simulation in universe+streak features (only the
  spy asserting rAF is never called).
- prefers-reduced-motion: all four animated selectors reset in the reduce block; no JS matchMedia.
- Settings key `streak.threshold_minutes` is consistent end to end (no serde renames).
- devMock reaches streak_summary through the real `window.__TAURI_INTERNALS__.invoke` seam.

## REFUTED (fix wave dispatched)
- **Earned-only law VIOLATED.** A never-practised piece renders a 6px star at 0.96 opacity,
  twinkling, WITH a glow, tagged `data-evidence="focused_seconds"` while focused_seconds is 0.
  Root cause: `universe.rs:149` snapshots all pieces with no practice filter; `universe.rs:739-743`
  gives a zero-practice piece `quality_brightness = 0.96` (neutral default); `galaxy.ts:104` floors
  radius at STAR_MIN_RADIUS=6. The glow is worse — it comes from the GLOBAL streak, so an
  unpractised piece glows because the *user* has a streak. Ruling: unearned pieces get an unlit
  hollow marker (r=4, no fill/twinkle/glow, `data-evidence="none"`); glow requires the piece itself
  to be earned; `data-evidence` may never name a zero-valued field.
- **720x520 dense floor NOT actually guarded for orbits.** `galaxy.ts:118` grows orbit radius
  unbounded and `.universe-orbit` sweeps a full 360°. Measured: a star of radius 23.83 at cell
  centre (66,66) with 4 mastered regions puts the outer body at r=67.83 → reaches x=y=-1.83, off
  the viewBox; at 8 regions it reaches -45.83 and sweeps to 177.83, crossing into the neighbouring
  cell (boundary 132). The committed dense-floor test never inspects `star.orbits` — proof:
  ORBIT_GAP=400 leaves the suite green. The disc clamp at `galaxy.ts:165-168` is DEAD CODE
  (deleting it leaves all 115 tests green).

## Surviving mutants (test holes, code correct)
| mutation | result |
|---|---|
| streaks.rs:126 anchor `0..=1` → `0..=0` (grace day) | SURVIVED |
| streaks.rs:132 `current_days: metrics::streak` → `longest_run` | SURVIVED — a dead 30-day run would display as current; the fake-progress case the law forbids |
| streaks.rs:136 `best_days: longest_run` → `metrics::streak` | SURVIVED |
| galaxy ORBIT_GAP = 400 | SURVIVED |
| galaxy ORBIT_BASE_PERIOD_SECONDS = 0 | SURVIVED |
| (killed: `>=`→`>`, `saturating_mul(60)`→`(1)`, anchor→true, anchor 0..=7, `.last()`→`.first()`, clamp bounds) | killed |

## Other defects
- S1: `streak_threshold_minutes` has zero test coverage end to end; deleting `SettingsPanel.tsx:163`
  again would reintroduce an unsavable field with all 2146 tests green. Also settings.rs bounds
  1..240 vs streaks.rs clamp 1..1440 — two bounds, no shared constant.
- U1: `universe.css:723` hover rule uses `~` but `.universe-star-hit` renders LAST, so the disc is a
  PRECEDING sibling — the rule never matches and hovering a star does nothing.
- Reduced-motion test only asserts the block CONTAINS the string; would pass if 3 of 4 selectors
  were dropped.
- M1 (low): devMock hardcodes STREAK_THRESHOLD_MINUTES=10; its fixture yields a 1-day streak so the
  assertions are near-tautological.

**Session pattern worth keeping:** this is the SECOND refutation round today (first: the B0
spike/rehearsal evidence). Plans were authored by agents without compiling anything, so pasted code
carries real bugs; and tests written alongside an implementation share its blind spots — only an
independent adversary with mutation testing finds the law violations.
