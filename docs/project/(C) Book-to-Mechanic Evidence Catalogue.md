# CodaKiller — Book-to-Mechanic Evidence Catalogue

> [!warning] STILL LARGELY UNBUILT — and the version references are stale (banner added 2026-08-20)
> The "NOT SHIPPED" status below is **still substantially accurate**, which is the honest and
> slightly uncomfortable point: most of this catalogue's book-to-mechanic contract has never been
> implemented. What is stale is the framing — it compares against "the installed v1.3.0 app."
> **Installed current truth is v8.2.0 / schema 20 (2026-08-27).** Some pieces here did land
> (the grounded, citation-bearing Assistant remains behind a deliberately OFF switch; the knowledge-book
> library and reader), but the deterministic book-derived mechanics this note specifies mostly
> did not. Treat it as a historical/on-hold design contract, not a current roadmap or description
> of the app. Do not resume Assistant/book-mechanic implementation without Christian reopening it.

> **Status: v2 evidence contract — approved source synthesis, NOT SHIPPED.** This note defines
> how the four-book piano library may become deterministic CodaKiller mechanics. It describes
> the intended v2 behavior, not the installed v1.3.0 app. Christian remains the sensor; the app
> records, times, structures, retrieves, and suggests. **Last updated: 2026-07-15.**

## Purpose

The books should not live only as Brain citations. Their compatible ideas can become visible,
testable practice protocols while their contextual advice remains optional. This catalogue is
the implementation and verification contract: every numeric dose is either configurable or
clearly labeled as a source example, every playing verdict comes from Christian, and every
derived state can be reconstructed from an append-only event history.

The governing practice arc is:

```text
Decode → Stabilize → Retrieve → Perform → Retain
          ↑ consecutive     ↑ spaced /
            clean reps        interleaved
```

- **Decode:** understand a small passage and identify the actual problem.
- **Stabilize:** establish the chosen solution with consecutive self-judged clean repetitions.
- **Retrieve:** recall it after interruption through serial, interval, random, or variable work.
- **Perform:** play through without stopping, then reflect.
- **Retain:** test it cold after time and sleep, then reschedule from the result.

Safety, one-focus-at-a-time work, and a short journal apply across the full arc. The app may
suggest a stage or protocol, but Christian or his teacher chooses it.

## Source inventory and authority

| Key | Source | Primary use here |
|---|---|---|
| **G** | Molly Gebrian, *Learn Faster, Perform Better* | Learning science, repetition, breaks, sleep, spacing, interleaving, variability, focus, tempo |
| **R** | Penelope Roskell, *The Complete Pianist* | Healthy technique, purposeful practice, speed, performance accuracy, motivation, injury boundaries |
| **GL** | Walter Gieseking and Karl Leimer, *Piano Technique* / *Technique Through Mental Work* | Concentration, mental/score preparation, small-unit work, careful repetition; historical pedagogy rather than modern experimental authority |
| **B** | Nancy O'Neill Breth, *The Piano Student's Guide to Effective Practicing* | Concrete drill menu, score diagnosis, tempo tracking, variation, visual counting |

Authority order remains: Christian's explicit report and teacher/clinician direction → the score
and exact session history → this catalogue → generic Brain advice. Pain and neurological symptoms
override every drill. A source example is not a universal prescription.

## Non-negotiable data contract

Every attempt is an immutable event. Corrections use an explicit undo/correction event; neither a
reset nor an edit silently deletes practice history. Derived state includes:

- total attempts and verdict totals;
- current and best consecutive-clean streak;
- reset count and recovery requirement;
- active stage, focus, passage, variant, tempo, and metronome mode;
- break state and active-practice duration;
- cold-check due date and cold-versus-warmed result;
- provenance for user notes, teacher notes, score facts, book guidance, and AI summaries.

`Clean`, `Sloppy`, and `Again/Failed` are self-reports, never audio classifications. Attempts are
not successes. A planned attempt count may end a time box, but cannot by itself mark a passage
stable or a block successful.

---

## M1 — Consecutive clean streaks and honest resets

**Evidence.** G Ch. 1, “Pathways and practicing” (raw lines 975–1135) requires correct
repetitions to be counted consecutively and restarted after a miss; it recommends at least five
when the first attempt is already correct while rejecting a magic universal number. B “Button
Up” (lines 94–95) gives a visible 6–12-token perfect-repetition game; “Rhythm Bridges” (line 663)
uses five perfect repetitions for that drill.

**App behavior.** Show attempts, current streak, best streak, resets, target, and verdict totals
separately. In the default strict profile, `Sloppy` and `Again` reset the current clean streak to
zero while preserving all events. Completion requires the configured consecutive-clean target,
not a raw attempt count.

**Boundaries/configuration.** Christian supplies every verdict. Five is a useful starting
profile, not biological law. Configure target (3/5/7/10/custom), which verdicts reset, and whether
a tempo or variant change starts a new streak. “100%” means the selected clean gate was met, not
that global playing accuracy is perfect.

**Tests.** `Clean, Clean, Failed` produces attempts 3, current streak 0, best streak 2. Five later
cleans complete only on the fifth. Ten failures cannot complete a ten-attempt block. Undoing a
verdict deterministically recomputes every derived value.

## M2 — Recovery dose after learning errors

**Evidence.** G Ch. 1, same section, recommends additional correct work after the first solution:
about 50% of the attempts needed to solve it as a minimum recovery dose, with 100% overlearning as
a stronger option. It explicitly denies a one-size-fits-all repetition count.

**App behavior.** Offer either a fixed clean-streak target or an adaptive recovery target based on
the logged attempts before first clean. Explain it neutrally: the passage took a certain number of
attempts to solve, so this protocol asks for a smaller or equal clean recovery dose.

**Boundaries/configuration.** Fixed, 50%, and 100% are selectable profiles, not automatic truths.
Configure minimum streak and whether a later breakdown recalculates recovery. Never erase earlier
errors to create a perfect percentage; recovery is repair, not punishment.

**Tests.** Eight pre-solution attempts at 50% yields four required clean recoveries. Switching to
100% changes the target without changing history. A later miss resets the streak while retaining
the attempts and recovery evidence.

## M3 — Diagnose before repeating

**Evidence.** G Chs. 1–3, especially “The role mistakes play” (line 1339) and “Use Errors to
Improve” (lines 1810–2250), uses a goal → monitor → reflect loop and asks the player to isolate the
cause. R “Practising: healthy, effective and inspired” (lines 904–1055) calls for the fundamental
difficulty to be isolated and one element changed at a time. B “At the Piano” (lines 935–969)
asks what failed—hand, measure, beat, note—why, and how to change it. B “Never Again” (line 599)
suggests a score note after the same-note error twice.

**App behavior.** After a configurable run of failures, pause blind repetition and ask: where was
it, what category was it, and what will change next? Categories may include notes, fingering,
rhythm/pulse, coordination, balance, articulation, dynamics, phrase, tension, memory, or unsure.
After the same marked location fails twice, offer a score mark or Tricky Section note.

**Boundaries/configuration.** Trigger after 2/3/custom failures and allow bypass. AI may structure
Christian's account but cannot infer a cause from audio, invent fingering, or fabricate teacher
instruction. MusicXML identifies selected score facts, not why the playing failed.

**Tests.** The prompt fires once at its threshold. A different score location creates a separate
thread. Dismissal does not create a diagnosis. User and teacher provenance survives summarization.

## M4 — One-focus deliberate-practice blocks

**Evidence.** G Ch. 2 uses specific goal, self-monitoring, and reflection; G conclusion “Focus”
(lines 8885 onward) suggests starting with 2–5-minute concentration periods and optionally stating
the goal, method, and reason aloud. B “The Pact” (lines 813–831) calls for one specific problem or
aspect at a time. GL Ch. I “Foundations” (lines 284–442) and Ch. IV “Making Study Count” (lines
1929–2075) favor concentrated work in small, mentally clear units.

**App behavior.** A block can begin with a short focus contract: what Christian is judging, the
method he will try, and what success means. Only one primary axis controls the clean verdict;
secondary observations remain notes.

**Boundaries/configuration.** Configure 2/3/5/10/custom-minute focus windows and spoken, typed, or
skipped setup. GL supplies historical pedagogy, not modern scientific dosage. AI may propose focus
candidates from explicit marks, history, or selected MusicXML, but Christian chooses.

**Tests.** Completed blocks retain their focus contracts. Changing the primary focus begins a new
comparable segment rather than mixing unlike statistics. A timer expiration never grades playing.

## M5 — Practice accuracy, freedom work, and performance mode

**Evidence.** R “Playing at speed” (lines 7849–7970) and “Accuracy and the myth of perfection”
(lines 20437 onward) balance thorough accuracy work against tension and perfection anxiety. R's
“accuracy last” belongs to specific freedom/leap exercises, not ordinary practice. G performance
guidance accepts errors in uninterrupted runs. GL warns against imprinting repeated mistakes.

**App behavior.** Keep three explicit modes: **Stabilize** stops, diagnoses, and resets;
**Performance** runs without interruption and debriefs afterward; **Freedom experiment** can judge
ease or movement before notes only when Christian deliberately chooses that technique protocol.

**Boundaries/configuration.** Never reduce artistry to an error percentage. Never apply “accuracy
last” globally. Configure the judging axis, but keep performance and stabilization statistics
separate.

**Tests.** A miss in Stabilize resets immediately. Performance mode queues observations until the
run ends. Freedom mode cannot activate itself and never overwrites note-accuracy history.

## M6 — Microbreaks, session breaks, and consolidation pauses

**Evidence.** G Ch. 4 “Taking Breaks” (lines 2268–2760) gives a worked pattern of three correct in
a row, a 10–15-second pause, then three more; it also discusses roughly 25–30-minute work periods
and five-minute breaks. R healthy practice (line 914 onward) reports a conservative hand-specialist
ceiling around 20 minutes and much shorter full-stretch work. GL Ch. IV (lines 2037–2058) describes
20–30 minutes of concentrated work followed by a pause and warns against long unfocused hours.

**App behavior.** Default to a conservative 20-minute reminder, with optional 10–15-second
microbreaks after clean clusters. High-load, stretched, or loud work can use shorter user-selected
windows. Pauses exclude time from active-practice totals without breaking the event trail.

**Boundaries/configuration.** These sources differ and none proves one universal duration. Fatigue,
loss of focus, or pain overrides the timer. Configure work interval, break interval, microbreak,
snooze, and user-declared load; do not infer physical load from the score alone.

**Tests.** A reminder never creates a failed verdict. Paused time is excluded from active time.
Pain stops the session regardless of timer state. Resuming does not silently credit a repetition.

## M7 — Sleep, spacing, and cold retention

**Evidence.** G Ch. 5 “Sleep” (lines 2767–3270) treats the first night after learning and later
rest as consolidation opportunities; G Ch. 6 “Spacing” (lines 3274–3600) rejects one universal
schedule and favors retrieval after partial forgetting. Its same-day, next-day, multi-day, week,
and multiweek sequence is an example, not a law. R practice guidance (lines 952–1055) calls for
consolidation across following days. B “Keep Track” (lines 181–191) records the final tempo and
restarts there the next day.

**App behavior.** A solved section may create a cold check later today, tomorrow, in several days,
a week, or two weeks. Capture the first cold attempt before displaying warmed results. Store cold
and warmed outcomes separately, then let Christian reschedule based on the result.

**Boundaries/configuration.** Configure fixed, expanding, or custom schedules, due windows, and
the cold metric: clean, tempo, confidence, or custom. Snooze and skip remain neutral. The books do
not justify a promise that sleep or spacing guarantees piano improvement; sleep is user-reported,
never inferred.

**Tests.** Cold outcome is captured before warm-up results. Snooze preserves the original due date
and records the decision. A missed date is not a playing failure. Warmed attempts cannot rewrite a
cold result.

## M8 — Blocked, serial, interval, and random retrieval

**Evidence.** G Ch. 7 (lines 3606–4300) places blocked work in initial decoding and then moves
toward serial, interval, and random retrieval. Its examples use 5–15 short spots for serial work,
3–4 separated returns for interval work, and 3–5 sections in 2–3-minute rotations. A failed cold
attempt removes the relevant success tick. Random performance is for prepared material and does
not stop mid-run.

**App behavior.** Map protocols to stage: one blocked section in Decode; consecutive cleans in
Stabilize; shuffled or interval queues in Retrieve; uninterrupted prepared sections in Perform;
scheduled cold checks in Retain. Christian marks readiness to advance.

**Boundaries/configuration.** Similar brand-new passages can interfere, so do not randomize the
entire practice list automatically. Configure section count, rotation duration, cold ticks, queue
order, and prepared-section eligibility. A clean streak satisfies a gate; it does not prove durable
mastery.

**Tests.** A retrieval miss resets only that spot's current tick. Decode remains available while
other spots are interleaved. Random mode never inserts an unselected or unprepared passage.

## M9 — Variable practice and drill selection

**Evidence.** G Ch. 8 (lines 4303–4770) recommends consistent initial work followed by variation
of a task-relevant parameter near the learner's challenge point. B's “Practice Tips” (lines
62–760) supplies selectable variants: accents, articulation, rhythm, dynamics, register, hands,
direction, starting point, and tempo.

**App behavior.** After explicit stabilization, offer variant cards for tempo, dynamics,
articulation, rhythm, register, hands, starting point, mental/physical work, or performance context.
Record the chosen variant on every attempt.

**Boundaries/configuration.** Variation is purposeful, not random novelty. Christian chooses the
relevant variable and when a section is ready. Study group sizes and Breth's per-drill repetition
counts are templates, not universal prescriptions. Configure variants, order, and repetitions per
variant.

**Tests.** Variation cannot silently change the judging axis. Every attempt identifies its exact
variant. Turning variation off restores the prior protocol without merging unlike data.

## M10 — Tempo ladders and speed development

**Evidence.** B “Keep Track” (line 181) raises one metronome notch after a perfect run and lowers
one after an error, records the day's final, and resumes there next day. G Ch. 16 (lines 8179–8630)
uses slow and fast work, sometimes half tempo, reductions of 10–20 BPM after errors, common steps
such as 3/5/10 BPM, short at-tempo chunks, and interleaved ladders. R “Playing at speed” (line 7849
onward) permits gradual increases and short fast bursts only with mental and physical ease. B
“Speed Trials” (line 716) compares regular, slower, and half-speed versions; “Over the Top” (lines
611–615) makes above-goal work an optional drill.

**App behavior.** Offer named profiles: up-on-clean/down-on-error, clean-streak then step,
half-speed build, short at-tempo chunks, interleaved ladder, and sparse-click ladder. Keep start,
current, target, prior-day final, and safe ceiling distinct.

**Boundaries/configuration.** No increment is universally best. Configure up/down step, clean
target per rung, reset-versus-regress policy, ceiling, and explicit overtempo permission. Tension
or pain blocks advancement. Teacher directions override defaults.

**Tests.** The configured clean gate causes exactly one upward step. Error behavior matches the
chosen reset/regress profile. Tempo never exceeds its ceiling. Prior-day final loads as a starting
point, not a cold success.

## M11 — Metronome use and independent pulse

**Evidence.** G Ch. 14 (lines 7443–8170) warns that constant beat clicks can become a crutch and
progresses toward fewer clicks: selected beats, downbeats, every second or third bar, offbeats, or
dropouts. B “Mental Metronome” (line 579) and “Tools” (lines 839–857) treat counting and the
metronome as flexible rhythm tools rather than only a speed gauge.

**App behavior.** Support every beat, selected beats, downbeat only, every 2/3/4 bars, offbeat,
seeded random mute, and count-in-then-silence. Christian reports held pulse, drifted, or unsure.

**Boundaries/configuration.** The app cannot hear whether Christian stayed synchronized. An
illustrative dropout percentage is not a standard. Configure pattern, mute percentage, count-in,
and measure cycle.

**Tests.** Sparse patterns remain measure-correct across supported time signatures. Random mute is
seedable. A click pattern never generates a playing verdict or changes a streak by itself.

## M12 — Practice journal and next-session memory

**Evidence.** G conclusion “Practice journal” (lines 8649–8755) records problems, exact solutions,
teacher notes, goals, priorities, and progress; its closeout is intended to take about 2–3 minutes.
R's practice chart (lines 904–1055) preplans task, goal, and method, then reflects and sets up the
next day. B “Troubleshooting” (line 744) ranks hard spots and tracks them across days.

**App behavior.** Close with what improved, what remains, which strategy worked, top next
priorities, optional teacher note, and optional cold-check schedule. AI can compress explicit
entries while preserving links and provenance.

**Boundaries/configuration.** Never fabricate a solution or teacher note. Configure full, three
prompt, one-line, voice, text, or skip; “no note” is valid and all attempt events still save.

**Tests.** Summaries link to original entries. Teacher notes remain distinguishable from AI and
user text. Closing without reflection loses no events. Ranking changes do not delete old priority
history.

## M13 — Motivation, rewards, and low-energy practice

**Evidence.** G conclusion “Motivation” (lines 8922–9095) separates long-term purpose from daily
mood and offers flexible scheduling, a two-minute start, priority tiers, habit bundling, social
support, and rest. R “Motivation” (lines 20487–20580) favors meaningful repertoire and goals,
small wins, optional chosen rewards, and manageable low-motivation work. B “Button Up” gives a
concrete visual progress loop.

**App behavior.** Celebrate evidence: a solved streak, an honest diagnosis, return after a break,
cold retention, or a safety stop. Offer a two-minute start and flexible green/yellow/red session
scope. Rewards are optional and user-chosen.

**Boundaries/configuration.** Failure may look consequential—a streak visibly resets—but not
shaming. Punishment, moralized missed days, or deliberately ugly failure states conflict with the
sources' learning model. Configure celebration intensity, rewards, low-energy scope, and quiet
mode.

**Tests.** A missed practice date changes schedule state, not an ability or character score. A
safety stop can receive positive acknowledgment. Low-energy work preserves honest progress and a
next step without pretending the full plan was completed.

## M14 — Physical safety and stop rules

**Evidence.** R “Preventing injury” (line 19245 onward) flags sudden load, repetitive stretch,
insufficient breaks, force, and fatigue. R “Recovering from injury” (line 20273 onward) treats pain,
swelling, weakness, numbness, restricted movement, lost control, or involuntary movement as reasons
to stop and seek appropriate professional help. Its graduated return schedule is clinician-guided,
not a generic app prescription.

**App behavior.** Keep tension, fatigue, pain, numbness/weakness, and stop-session controls always
available. Pain or neurological symptoms stop the timer, drill, and metronome immediately and show
concise professional-care guidance. A safety stop never counts as failure.

**Boundaries/configuration.** No diagnosis, automated rehabilitation plan, or encouragement to
play through symptoms. The score cannot prove physical risk. Configure reminders, but not the stop
rule for pain/neurological symptoms.

**Tests.** A pain event stops active systems and prevents automatic progression. It preserves all
prior events and does not reset mastery statistics. Resume requires explicit user action.

## M15 — Mental and score-first preparation

**Evidence.** GL Ch. I “Foundations” (lines 284–442) emphasizes concentrated score study, aural
imagination, and minimal strain before or alongside keyboard repetition. GL Ch. IV (lines
1929–2075) builds small fragments before combining them. B “X-Raying a New Piece” and “The Big
Picture” (lines 865–927) identifies form, repeated/different material, terms, patterns, harmony,
and rhythm before detailed work. B “First Steps” (lines 132–139) starts slowly in small sections,
one hand at a time, with rhythm/counting, notes, fingering, and dynamics considered explicitly.

**App behavior.** Decode mode can create a score-preview checklist and let Christian select a
small MusicXML/PDF region, label structure, state an aural goal, and choose one first-pass focus
before opening a rep counter.

**Boundaries/configuration.** AI may describe verified selected score facts, but cannot know the
intended fingering, sound, or interpretation unless supplied. GL's beginner and dosage claims are
historical context. Configure checklist depth and allow immediate skip.

**Tests.** Score facts cite the exact selected source range. A preview never creates a playing
verdict. User interpretation and teacher direction remain attributed and editable.

---

## Source conflicts and binding resolutions

1. **Avoiding errors versus learning from errors.** GL warns against imprinting mistakes; G uses
   errors diagnostically; R accepts imperfections in performance. Repeated unintended errors never
   earn progress, deliberate error-comparison work requires explicit selection, and Performance
   mode continues before debrief.
2. **Blocked repetition versus interleaving and variability.** Blocked work serves Decode and
   early Stabilize; serial, interval, random, and variable work serve later Retrieve/Perform.
3. **Competing repetition counts.** The books use 3, 4, 5, 6–12, 10, and adaptive recovery for
   different exercises. Counts remain named protocol defaults and are always configurable.
4. **Break duration.** R is most conservative around 20 minutes; G and GL discuss roughly 20–30.
   The default reminder is 20 minutes, with earlier fatigue or pain always decisive.
5. **Accuracy versus freedom.** Stabilize can demand exact self-judged cleans. “Accuracy last” is
   restricted to selected freedom exercises, and Perform never reduces artistry to wrong notes.
6. **Interpretation timing.** GL often separates exact technical learning from later
   interpretation; R encourages a musical image early. CodaKiller offers technical, musical, or
   combined focus and lets Christian/teacher decide.
7. **Tempo ascent versus regression.** Installed v1 only accumulates cleans and advances. The
   active source now resets consecutive proof, replays tempo from effective evidence, and can
   encode hold/backoff through its captured contract; the explicit user-facing recovery choice and
   tempo-regression controls remain to finish.
8. **Overtempo.** G, R, and B allow it selectively, while safety and ease constrain it. It is
   opt-in, capped, and never an automatic recommendation.
9. **Motivation versus punishment.** Honest visible resets are compatible with the evidence;
   shame, punitive framing, and moralized missed days are not.

## Installed-app gap this contract is meant to close

The v1.3.0 rep engine counts every verdict toward `reps_done`, does not reset accumulated cleans
after `Sloppy` or `Again`, and can complete a planned block without a clean repetition. Its ladder
only advances and the HUD centers attempts rather than consecutive clean state. Settings do not
yet expose clean target, reset/regression policy, recovery dose, focus/break protocols, or spacing.
The external Brain's explicit three-book allowlist also omits Gieseking/Leimer even though that
fourth source exists in the library. None of the v2 mechanics in this document should be described
as shipped until implementation, migration, automated verification, adversarial review, and
Christian's real at-piano acceptance pass are complete.

## v2 implementation and verification status / next steps

1. **Delivered in source:** approved brief/spec/plan, four-book corpus, schema-v9 append-only
   ledger, deterministic contract mastery/reset/recovery projection, separate tries/success,
   correction/reverse/restart, relaunch/rollback, authoritative HUD/history, and adversarial tests.
2. **Next:** durable command receipts/idempotency, pause-aware focus contracts, explicit safe break /
   pain stop, accepted recovery choices, and cold retention checks; add their exact voice commands.
3. Add Decode/Stabilize/Retrieve/Perform/Retain modes without letting AI or audio assign verdicts.
4. Complete migration, persistence, accessibility, narrated voice, offline, rollback, and packaged-
   native tests for every remaining transition.
5. Only after all automated/live-app gates, build/install the release candidate and run Christian's
   at-piano checklist. Log real friction rather than declaring the thesis proven from proxy tests.
