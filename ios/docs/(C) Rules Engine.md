# (C) Rules Engine — the practice rules façade

`PracticeRulesEngine` (`ios/Praelude/Core/Rules/`) is the pure, deterministic implementation of
§11's fifteen practice rules, §10a's default set configuration, §10b's set-goal vocabulary, §10c's
next-step line, and §4's passage learning-state machine. Every function is a plain transformation of
a `RuleContext` (and whatever specific subject — a passage, a piece, a set — it evaluates) into a
`Decision` or a small, caller-actionable value. Nothing here touches disk, the system clock, or
`PracticeStore` directly: a real caller reads `PracticeStore.state` into a `RuleContext` (or, in a
test, stages exactly the slice a rule needs), calls the rule it wants, and — if the player accepts or
overrides the result — logs it with `PracticeStore.recordRuleEvent(decision.asRuleEvent(overridden:))`.

No UI, wiring, or call-site work belongs to this track: whichever future track builds the practice
HUD calls these functions and displays their `reason`/`outcome`.

## Where things live

- `RuleTypes.swift` — `RuleContext` (every rule's input), `Decision`/`DecisionOutcome` (every rule's
  output), `ColdGradeApplication` (R3+R4's combined result), `PulseCheckPlan`/`SessionItem`/`SessionPlan`
  (R14/R15's payloads).
- `PracticeRulesEngine.swift` — the enum itself, `logEvent(for:overridden:)`, the shared
  `Calendar.startOfDay(afterAdding:)` and `pluralize(_:_:)` helpers, and `allSets(forPassage:context:)`.
- `PassageLearningRules.swift` — R3 cold grading, R4 spaced review, R10 performance-ready, R11
  performance date: the rules that move a passage through `LearningState`.
- `PracticeSetRules.swift` — R5 streak targets, R6 slow down, R7 speed up, R12 variants when stuck,
  R14 pulse check: the rules that read one practice set.
- `PassageStructureRules.swift` — R1 small chunks, R2 join the seams, R8 split weak spot, R13 parts
  separately: the rules that read a passage's shape and location history.
- `SessionRules.swift` — R9 stop grinding, R15 session builder, §10a default configuration, §10c
  next-step line: the rules and helpers that operate across a whole session.

`RuleSettings` (every rule's enabled flag and editable parameters) and `RuleEvent` (the append-only
override log) live in `Core/PracticeRules.swift`, alongside `SetGoal` — schema3's home for both. This
track only adds evaluation logic in `Core/Rules/`; it never edits `Models.swift` and never rewrote
either type's own shape. It did add `r8ClusterRadius`/`r15EstimatedMinutesPerItem` to `RuleSettings`
and `inFinalWeek` to `DecisionOutcome.performanceCaps` — both inherited from an interrupted earlier
run of this same track and reviewed/kept rather than redone (see git history on this branch).

## Input and output

`RuleContext` gathers everything any rule might read: the current moment (`now`) and an injected
`Calendar` (see "Why a calendar is injected" below), `RuleSettings`, and every schema3 collection a
rule touches (pieces, passages, instruments, cold grades, break-point taps, rule events, sessions,
history, the live active set, warmup exercises). Its memberwise initializer defaults every collection
to `[]`/`nil`, so a test stages only the slice the rule under test actually reads — this is what
"(C) Build Spec v2.md" §17a's "staged-data test" means in practice, and
`PraeludeCoreTests/PracticeRulesEngineTests.swift` uses exactly this pattern for every rule.
`RuleContext.init(state:now:calendar:)` is the convenience a real caller uses instead, reading every
field straight off `PracticeStore.state`.

Every rule that can fire returns an optional `Decision` (or, for R2/R15, `[Decision]`/one non-optional
plan): a stable `ruleID`, who it's about (`pieceID`/`passageID`), one dry human-readable `reason`, and
a typed `outcome` the caller can act on without re-deriving it (a new `PassageSchedule`, a tempo, a
region to split around, …). A `Decision` is never persisted directly; `Decision.asRuleEvent(overridden:)`
turns it into the `RuleEvent` schema3 already has a home for — `overridden: false` when the player
accepted the suggestion, `true` when they tapped it away. That single method is every rule's "one-tap
override, which is logged" (§11): there is no rule-specific override path, so
`PracticeRulesEngineTests` checks it once per rule rather than re-deriving a separate mechanism for each.

## Why a calendar is injected, never `.current`

Every day-bucketed rule (R3's "first attempt of the day", R4/R9/R11's day-based scheduling, R10's
"different calendar days") takes `context.calendar` rather than assuming `Calendar.current`. A
device's calendar and time zone are themselves player state that can change (travel, a manual
override), and are exactly the kind of ambient dependency that makes day-boundary logic flaky to
test. Two things fall out of always going through the injected calendar instead of raw `Date`
arithmetic:

- **Day-boundary correctness.** `calendar.isDate(_:inSameDayAs:)` and `calendar.startOfDay(for:)`
  compare calendar days in the calendar's own time zone, not UTC. Two timestamps 30 minutes apart
  either side of local midnight are different days; two timestamps 23 hours apart that both fall
  before local midnight are the same day — even when a UTC-based comparison would get both backwards.
  `PracticeRulesEngineTests.testDayBoundaryRespectsInjectedTimeZoneNotUTC` stages exactly that pair of
  cases against `America/New_York`.
- **DST correctness.** `Calendar.startOfDay(afterAdding:to:)` (the shared helper every "N days from
  now" computation uses — R4's ladder, R9's park-until-tomorrow, R11's day countdown) computes the
  _start of day_ for `date` and then adds whole _calendar_ days via `Calendar.date(byAdding:.day:)`,
  which accounts for the calendar's time zone. Naively adding `days * 86400` seconds would land at the
  wrong wall-clock time on a day either side of a spring-forward/fall-back transition (a 23- or
  25-hour day). `testStartOfDayAfterAddingCrossesDaylightSavingTime` crosses the actual 2026-03-08
  U.S. spring-forward and checks the result lands at local midnight the next calendar day, both
  directly and through R4's own Missed path.

## R1 small chunks

`evaluateR1SmallChunks(passageID:context:)`. Fires when the passage's tallest region exceeds
`r1MaxSystems` systems, or — when both measure bounds are set (§8: optional, never required) — when
it spans more than `r1MaxMeasures` measures.

**Judgment call — system-height fraction.** Core never reads a PDF's actual system count (it has no
music-notation layout engine). `assumedSystemHeightFraction = 0.15`: a page is assumed to hold
roughly six-to-seven systems across piano/orchestral/lead-sheet layouts, so `r1MaxSystems` (default 2)
is compared against `r1MaxSystems * 0.15` of a page's normalized height. A future track with real
layout information can replace this constant without changing the rule's signature.

When exactly one region exceeds the threshold, `outcome` names it (`suggestSplit(regionID:)`);
otherwise (a pure measure-count trigger, or several oversized regions) the suggestion is
passage-general (`regionID: nil`).

## R2 join the seams

`evaluateR2JoinSeams(pieceID:context:) -> [Decision]`. Offers to join every pair of adjacent,
non-archived, Review-state passages of one piece.

**Judgment call — adjacency definition.** "Neighboring" is defined purely by measure numbers:
`a.endMeasure + 1 == b.startMeasure`. Measure numbers are optional and never required (§8), so a
passage missing either bound can never match. There is deliberately no page/region-based adjacency
test instead — one would misfire across a page turn or for a multi-region passage, and would still
need measure-free passages to define "adjacent" some other way the spec does not pin down. A future
track with reliable measure numbers on every passage could tighten this; until then, a passage pair
without measure numbers simply is not offered a join.

Returns every adjacent pair once (oldest-measure-first), so a run of three or more Review passages
offers each seam independently rather than only the ends.

## R3 cold attempt

`isColdAttemptEligible(passageID:context:)` / `applyColdGrade(passageID:grade:tempo:context:)`. The
first attempt of the day, graded Clean/Shaky/Missed, drives R4 — both fire from one call to
`applyColdGrade`, returning a `ColdGradeApplication` with the record to persist and, in order, the R3
decision and (if R4 is enabled) the R4 decision. Returns `nil` when R3 is disabled or the passage
already has a cold grade today; "today" is `context.calendar`'s day, not `.current`'s.

## R4 spaced review

Implemented as `advanceSchedule` inside `applyColdGrade` (private — always reached through R3, since a
schedule only advances by grading a cold attempt). New→Learning→Review→PerformanceReady, kept in
`Passage.learningState`; ladder position is `PassageSchedule.reviewStep`.

- **Clean** climbs `r4CleanIntervalsDays` (default 1→3→7→14→30 days) one rung at a time, staying on
  the ladder's last rung once there.
- **Judgment call — the New/Learning→Review crossover rung.** The spec names the four states and the
  five-step ladder but not which rung graduates a passage out of Learning. This engine's choice: the
  ladder's _third_ rung (7 days by default) — `min(2, intervals.count - 1)`, guarded against a shorter
  custom ladder. `PracticeRulesEngineTests.testR4CleanClimbsLadderAndGraduatesToReviewAtThirdRung`
  replays a passage through all three rungs and checks the exact state at each.
- **Shaky** reschedules at `r4ShakyIntervalDays` (default 2) _without_ losing ladder position — a
  quick recheck, not a lapse, so `reviewStep` is untouched.
- **Missed** is a full lapse: back to Learning, due tomorrow, `reviewStep` reset to 0 (the ladder
  restarts from its first rung next time this passage graduates again).

Full cold-grade history survives in `context.coldGrades` (`ColdGradeRecord`, append-only); nothing
here ever discards it.

## R5 streak goal by state

`r5StreakTarget(for:settings:)` — 5 while Learning (also used for New, since a passage's first cold
grade is what moves it out of New), 3 once in Review (also used for PerformanceReady, since
maintaining an already-ready passage is the same steady state). `evaluateR5StreakTarget` wraps it as a
`Decision` for logging/override.

`r5StreakEffect(for:) -> StreakEffect` is the separate, explicit vocabulary (`.increments`/`.resets`/
`.neutral`) for "Sloppy resets; Again neutral": Clean increments, Sloppy and a manual Reset both
reset, Again is neutral. R6's own attempt replay follows exactly this vocabulary (clean increments a
local streak, sloppy/reset zero it and record the peak, again is a no-op), even though it does not
literally call `r5StreakEffect`.

**Known pre-existing mismatch, left alone.** `PracticeEngine.project` (the existing practice-loop
replay this track did not touch) currently zeroes the streak on `.again` too whenever a set has _no_
variant stages (`case .again: if configuration.stages.isEmpty { set.streak = 0 }`) — for the common
case (a plain streak set, no variant chain), the actually-running engine disagrees with
`r5StreakEffect` and with the spec's own "Again neutral". This track deliberately did not change
`PracticeEngine.swift`: it is existing, previously-shipped logic outside `Core/Rules/`, and
reconciling it is a real behavior change (it would change what every existing `PracticeEngine` test
asserts) that belongs to whichever track owns that wiring, not to a pure-logic addition. Anything
built against this track's rules — R6 included — follows `r5StreakEffect`'s spec-correct vocabulary,
not `PracticeEngine.project`'s.

## R6 slow down

`evaluateR6SlowDown(set:context:)`. Replays `set.attempts` (undone ones excluded), tracking the
in-progress streak toward _that attempt's own stage's_ goal. A Sloppy or manual Reset zeroes the
streak and records its peak, paired with the goal it was chasing; Again does nothing (neutral, per
R5); reaching a stage's goal clears the "in a row" list entirely, since only consecutive failures with
no intervening success count. Fires when the most recent `r6ResetsBeforeStepDown` (default 3) such
resets each peaked below half of _their own_ goal, stepping the tempo down by `r6StepDownPercent` (a
percent ladder) or one fixed step (a fixed-amount ladder).

**Design note — per-attempt stage attribution.** Each attempt's goal is looked up from its own
recorded `stageIndex` (`PracticeStore` stamps every `Attempt` with the live `stageIndex` at record
time), not assumed to be the set's _current_ `requiredCount`. A variant chain (§10b) gives every stage
its own `targetCount`, and a stage transition only ever happens by reaching that stage's own goal — so
replaying every historical attempt against one constant goal (whichever stage is current by the time
R6 is asked) can fail to recognize an earlier, smaller-goal stage's real graduation, or judge a peak
against the wrong half once the set has moved to a later, differently-sized stage.
`PracticeRulesEngineTests.testR6UsesEachAttemptsOwnStageGoal` stages exactly that (a 2-rep stage
followed by a 20-rep stage); temporarily restoring the single-goal version of this function long
enough to run just that one test against it confirmed it returns `nil` there instead of firing,
before the fix was restored.

## R7 speed up

`evaluateR7SpeedUp(passageID:context:)`. Once a set on this passage has completed today below
performance tempo, the next set is offered one tempo step closer to it, capped at
`r7MaxIncreasesPerDay` (default 2) _applied_ increases per passage per day — counted from
`context.ruleEvents` where `overridden == false`, since a declined suggestion never actually raised
the tempo and should not count against the cap.

## R8 split weak spot

`evaluateR8SplitWeakSpot(passageID:context:)`.

**Judgment call — tap-cluster definition.** Two break-point taps "cluster" when the straight-line
distance between their normalized-page centers (each tap's `NormalizedRect` collapsed to its own
center point) is within `r8ClusterRadius` (default 0.06, in the same 0–1 page-normalized units as
every other geometry in this codebase). The offered cluster is the single largest such neighborhood —
the tap with the most neighbors within radius, plus those neighbors, ties broken by recording order —
not a full hierarchical clustering, which this rule does not need for "3+ clustered taps" (§11 R8).
Fires once that neighborhood reaches `r8TapsToOfferSplit` (default 3), offering a sub-passage sized to
the neighborhood's bounding box plus a small margin.

`r8TapsToOfferSplit` is clamped to at least 1 before it is used as a count threshold: a misconfigured
0 or negative value must never let an empty tap list reach the bounding-box math's forced unwraps.
`PracticeRulesEngineTests.testR8NeverFiresOffZeroEvidenceWithAMisconfiguredThreshold` is the
regression test for that fix.

## R9 stop grinding

`evaluateR9StopGrinding(passageID:context:)`. Parks the passage until tomorrow after `r9Minutes`
(default 10) of total active time on it today, or after `r9Sets` (default 3) consecutive today's-sets
in a row without progress — counted from the most recent set backwards, stopping at the first one
that _did_ make progress. A set "made progress" if it completed, cleared a variant stage, or advanced
its tempo above where it started; anything short of that, for an already-ended set, is grinding in
place.

## R10 performance-ready

`evaluateR10PerformanceReady(passageID:context:)`. Clean cold attempts at (or above) performance
tempo on `r10DistinctDays` (default 3) different calendar days, including — when
`r10RequiresFirstInSession` — one where the qualifying cold grade was the first timestamped activity
of that whole day.

**Judgment call — "first thing in session".** Core has no separate "session opened" event, so this is
approximated from data: a qualifying cold grade counts as first if it precedes every _other_ cold
grade (on _any_ passage) and every attempt (on _any_ set) logged that same calendar day. This is
deliberately not scoped to the same passage or piece — "first thing in session" reads as "first thing
you did all day", not "first thing you did on this one passage".

## R11 performance date

`evaluateR11PerformanceDate(pieceID:context:)`. Within the final two weeks (`r11FinalTwoWeeksDays`,
default 14) before a piece's nearest upcoming performance date, caps review intervals and flags
run-throughs; within the final week (`r11FinalWeekDays`, default 7), treats every one of the piece's
non-archived passages as due and flags any not yet performance-ready.

**Judgment call — reusing R4's own ladder for the cap.** Rather than a separate tunable, the interval
cap is R4's own `r4CleanIntervalsDays` ladder: its first rung within the final week, its second rung
in the two weeks before that. `DecisionOutcome.performanceCaps` carries an explicit `inFinalWeek` flag
precisely because R15 needs to distinguish "cap review intervals and add run-throughs" (two weeks out)
from "every passage is due today" (final week) — `notReadyPassageIDs` alone is `[]` in both the
two-week and the nothing-flagged cases, so it cannot carry that distinction by itself.

## R12 variants when stuck

`evaluateR12VariantsWhenStuck(passageID:context:)`. `r12SlowDownsPerDay` (default 2) _applied_ R6
slow-downs today on this passage (same "not overridden" counting rule as R7) suggest building or
resuming a variant chain instead of continuing to grind at tempo.

## R13 parts separately

`evaluateR13PartsSeparately(passageID:context:)`. `r13ConsecutiveMissed` (default 2) consecutive
Missed cold grades suggest practicing a part alone.

**Judgment call — which part to suggest.** The suggestion is always
`InstrumentFamily.partsVocabulary[1]` — the first alternative to the family's "together" entry (e.g.
"Right hand" for keyboard, "Left hand only" for strings, "Articulation" for winds; see
`Instruments.swift`). That vocabulary deliberately mixes literal parts (hands, bow) and techniques
(articulation, vowel shape) under one umbrella, so index 1 is a defensible universal default rather
than a per-family special case; a future UI can offer the rest of the same list as alternatives. A
family with nothing beyond "Full" (only `.other` today) never fires this rule.

## R14 pulse check

`isPulseCheckEligible(set:context:)` / `evaluateR14PulseCheck(set:context:)`.

**Judgment calls — near-tempo threshold and bar counts.** "Near target tempo" is not pinned by the
spec: `pulseCheckNearTempoFraction = 0.9` (90% of performance tempo) is this engine's threshold.
Lead-in (`pulseCheckLeadInBars = 4`) and recovery (`pulseCheckRecoveryBars = 2`) bar counts are
likewise fixed by this engine, not the spec; only the dropout length itself (`r14DropoutBars`,
default 2) is an editable parameter, matching what §11 actually calls out as tunable. The plan itself
(`PulseCheckPlan`) is a plain value the metronome consumes — no randomness, matching "deterministic
rules" (§2) for the metronome's behavior too, not only for whether a rule fires.

## §10a default set configuration

`defaultConfiguration(for:context:) -> PracticeConfiguration?`. Carries goal, completion basis, tempo
step, and hands/parts wording forward from the player's last set on this passage (falling back to a
plain default when there is none), applies R5's streak target for the passage's current learning
state, and folds in R7's speed-up when it fires (bumping `startBPM`, raising `targetBPM` to match if
needed). "Goals without tempo default click off" (§10b) falls straight out of
`useMetronome: goal == .tempo`.

## §10c next-step line

`nextStepLine(afterSet:context:) -> Decision`. The single most relevant decision for what just
happened, in priority order (most decisive first): R9 stop-grinding, R10 performance-ready, R13 parts
separately, R12 variants when stuck, R6 slow down, R7 speed up, R8 split weak spot, R1 small chunks,
R2 join the seams, falling back to a plain acknowledgement. Every candidate rule still fires (and can
still be logged/overridden) independently through its own `evaluate…` function — this only picks
which one is worth surfacing as the session's single headline line. The fallback (and the
no-specific-passage case) logs under `.r15SessionBuilder`, since deciding what belongs in the flow of
a session — even "nothing in particular" — is that rule's domain; no other `RuleID` fits a plain
acknowledgement.

## R15 session builder

`buildSession(availableMinutes:context:) -> SessionPlan`. Fits warmups, then due reviews (nearest
performance date first), then learning passages, then up to `r15MaxNewPerSession` (default 3) new
passages, then run-throughs for pieces performing soon, into `availableMinutes` at
`r15EstimatedMinutesPerItem` (default 3) minutes per item. Items that do not fit are left off the plan
— nothing about their own schedule changes, so "skip keeps due" needs no extra bookkeeping:
`SessionPlan.items` is a plain, freely-reorderable array, and a passage left out (skipped, or never
offered because the budget ran out) stays exactly as due as it already was.

**Judgment calls.**

- **Run-through cost.** A run-through (the whole piece, not one passage) is estimated at
  `runThroughMinutesMultiplier` (3) times the per-item minutes — the spec gives no figure.
- **Warmup rotation.** `nextWarmupInRotation` — least-recently-used, never-used first — is a minimal
  stand-in for §12's own rotation (favorites, neglected keys, a key picker), enough to satisfy R15's
  "warmups at start"; §12's actual rotation is a future track's work, not this one's.
- **Tap into R11.** R15 calls `evaluateR11PerformanceDate` per piece to fold its verdict in: a piece
  in its final week contributes every one of its passages as "due today" (instead of only those with
  a due `PassageSchedule`), and any piece R11 flags for run-throughs gets one appended at the end,
  nearest-performance-date first.

## Testing

`PraeludeCoreTests/PracticeRulesEngineTests.swift` stages a `RuleContext` directly per test (per
`RuleContext`'s own documented intent) and, for every rule, asserts it fires, shows its exact reason
text, and supports `asRuleEvent(overridden:)`; most rules also get an explicit does-not-fire or
boundary case. Cross-cutting: R4's full three-rung ladder climb (also the singular-vs-plural copy
regression, since a passage's very first Clean grade lands on day 1 of the ladder at default
settings), day-boundary/time-zone correctness, a real DST transition, R6's Again-neutral-mid-run and
multi-stage-goal cases (the latter verified as an actual regression guard, not just a passing
assertion — see the R6 section above), and R8's zero-threshold regression. 37 pre-existing
`PraeludeCoreTests` (schema3/practice-engine) plus 33 new rules tests currently pass:
`swift test --package-path ios`.
