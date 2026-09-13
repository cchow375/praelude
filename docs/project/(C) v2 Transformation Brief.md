# CodaKiller v2 — Practice OS Transformation Brief

> [!warning] HISTORICAL — superseded by the v3.0.0 rework (banner added 2026-08-20)
> "Implementation in progress" below refers to **July 2026**. This brief described v2.0.0, which
> never installed: its backend landed inside the **v3.0.0** frontend transformation shipped
> 2026-07-16, and the v2.0.0 version number was retired. **Installed current truth: v8.2.0 /
> schema 20 (2026-08-27).** P3–P6 of the Aug 8 train, the evidence-based Universe and the v8.2
> UI-cleanse correction are shipped; current evidence work is packaged microphone/Steinway and
> native Score acceptance, one real provider mapping and sustained
> motivation. Kept because it is the clearest statement of the Practice-OS direction
> that everything since has followed. For what is actually built, see [[(C) Roadmap]]; for what
> is honestly still missing, [[(C) Flaws]].

> **Status:** approved working boundary, implementation in progress · **2026-07-15**  
> **Driven by:** Christian's July 15 real-use notes, the live schema-v7 database, the four-book
> practice corpus, narrated PianoCoach sessions, the installed v1.3.0 app, and a full repository /
> vault audit.  
> **Release target:** **v2.0.0 / P7**. This document is a contract, not a shipped-feature claim.

## The product after this transformation

CodaKiller becomes a **score-centered, voice-operated practice operating system**. Christian
selects the music, states what happened, and remains the judge. The app turns those verdicts into
rigorous practice protocols, an exact and reversible ledger, durable memory, fast grounded help,
and a universe whose growth is earned by real practice.

The experience should feel like one instrument rather than a dashboard of features:

1. Open a piece and land in its **Score Atlas**.
2. Drag over the music—or speak a range—to create or resume a precise practice target.
3. Choose a protocol, or accept an editable suggestion grounded in the practice books.
4. Practice through a focused set. Every verdict receives immediate visual and spoken proof.
5. A miss resets the clean streak or creates an explicit recovery requirement; it never vanishes
   behind a total-attempt counter.
6. Undo, correct, restart, change hands, narrow the target, add a note, or ask the Brain without
   leaving the piano flow.
7. Close the set and see exactly what was attempted, achieved, retained, and still owed.
8. Return tomorrow to a deliberate retention check, not a false claim that yesterday's tempo is
   permanent.

## Five connected systems

### 1. Score Atlas — location is the spine

The hierarchy is **Piece → score section → user target → practice session → set → attempt/event**.
The PDF is the main working surface; location, history, protocols, Brain context, notes, and
Universe objects all resolve through the same target.

- Dragging on the score creates a visible target draft immediately. The note is optional.
- A compatible MusicXML score provides exact structured measure identity. For scanned or
  differently numbered PDFs, the app uses a one-time edition calibration and clearly labels
  confidence; Christian can correct the range before saving.
- The app must never silently invent a “perfect” PDF/XML mapping. **Exact where the source permits;
  calibrated and correctable where it does not.**
- Targets can nest, overlap, be retitled, recolored, annotated, resumed, split, merged, archived,
  and filtered without duplicating practice truth.
- Selecting an existing target exposes **Resume** as the primary action and its last result /
  retention state without opening an endless history page.

### 2. Practice Protocol Engine — quality before volume

The engine separates **attempts** from **successful evidence**.

- Default mastery is a configurable number of consecutive clean attempts (Christian asked for
  five “or whatever times”). A flawed or failed attempt resets the streak under the selected
  contract.
- Every attempt remains in the immutable ledger. A reset does not erase the error; undo/correct
  records a compensating event and provenance instead of rewriting history invisibly.
- “Punishment” means a meaningful musical consequence: reset the streak, step back, narrow the
  passage, reduce tempo, add recovery cleans, or schedule retention. It never means shame,
  arbitrary point loss, or an incentive to lie about a verdict.
- Protocols carry a visible source/rationale from the books and stay editable. Suggested does not
  mean imposed.
- Focus is an explicit loop: intention → short timed set → self-report → break / change strategy.
  The app never infers concentration or technique from microphone audio.
- Retention is first-class: tomorrow's check can confirm, lower, or reopen a target. A tempo
  reached once is a historical peak, not permanent mastery.

### 3. Practice Ledger + Session Desk — exact, compact memory

- Every set shows tries, clean count, current/best streak, accuracy, tempo path, focus, hands /
  method, notes, source (voice/click/edit/import), and retention result.
- A global save receipt makes success and failure impossible to miss. Opening/ending errors cannot
  be swallowed.
- History scales by piece, target, date, session, protocol, focus, verdict, and retention state.
  Summary rows disclose detail on demand; long lists virtualize instead of forcing page-length
  scrolling.
- A **20-minute Session Composer** proposes a small editable sequence from due retention,
  unresolved targets, goals, and available time. Christian owns every change and final start.
- Text or voice can update a piece/section state; durable Markdown exports are projections of the
  canonical ledger, never a competing database.

### 4. Two-lane Voice + Practice Brain — fast action, bounded reasoning

**Lane A: deterministic hot loop.** Clean/flawed/failed, undo, restart set, status, tempo,
metronome, pause/resume, and close remain local, terse, and immediate. Ambient speech and piano
audio must do nothing.

**Lane B: natural-language action draft.** Complex requests such as “restart mm. 492–512 with
left hand at 50 and aim around 64 for 15 reps” become a typed, validated preview. Risky or
ambiguous mutations require a one-tap/one-word confirmation and every applied action is undoable
and audited.

The Brain becomes a concise practice librarian:

- Default answer: diagnosis hypothesis, one action, dose, stop condition, and sources—visible
  without a long scroll.
- It joins the selected score range / MusicXML, reported symptom, live ledger, retention history,
  and the complete supported practice corpus.
- Conversation memory survives relaunch and can be cleared per piece.
- App actions use a narrow typed tool allowlist with preview, validation, confirmation, audit, and
  undo. The model never directly writes SQLite or controls the deterministic rep loop.
- The offline baseline is retrieval, structured memory, protocol routing, and concise templates.
  On this 8 GB Mac there is no always-resident local LLM; a small external model may handle narrow
  language parsing, while deeper questions route only when needed.

### 5. Earned Practice Universe — motivation made legible

The Universe becomes a zoomable, pannable practice graph, not a static purple illustration.

- Piece systems contain session stars and target bodies; relationships mirror the real practice
  graph and open the underlying ledger item.
- Growth uses several visible signals: focused time, repeated active days, coverage, completed
  mastery contracts, honest recovery after errors, and retained work. Raw self-reported “clean”
  count alone cannot buy beauty.
- Dense, colorful systems are earned over time. Low-quality sessions are recorded honestly but
  are never rendered as punishment or ugliness that incentivizes false verdicts.
- Every visual encoding has a text equivalent and reduced-motion behavior.

## Interface language

The operational app is mostly **Cloud Dancer off-white, ink black, and one deep terracotta
accent**. Color belongs mainly to the score marks and Universe.

- Editorial serif display type + structured mono/sans utility type; never Inter/Roboto/Arial/
  Space Grotesk.
- Asymmetrical editorial composition, strong negative space, matte filled surfaces, and tactile
  controls; no generic three-card dashboard, violet glow, glassmorphism, or component-library
  collage.
- One staggered entrance per workspace. Everything interactive responds quickly with a physical
  micro-motion; nothing loops merely to look “alive.”
- Primary at-piano actions remain large, high-contrast, keyboard accessible, screen-reader named,
  and usable at the 720×520 minimum.

Named references are ingredients, not templates: Manus contributes editorial calm and whitespace;
Motion Primitives / Uiverse contribute restrained micro-responses; Haikei contributes procedural
SVG language; Realtime Colors contributes palette discipline. CodaKiller remains visually its own.

## Evidence that changed the plan

The July 15 snapshot proves Christian has already used v1.3.0 materially: **6 pieces, 27 targets,
48 blocks, 481 attempts, 8 sessions, 670 events, 21 goals, and 11 Calendar cards**. That real use
found issues no automated release gate had established:

- one impossible reversed range (`452–449`), eleven overrun blocks, duplicate/abandoned blocks,
  and same-second attempt bursts;
- a 30-rep block that is exactly 50% clean but is represented by a completion model based on total
  tries;
- ambient phrases saved as failed-rep notes, proving the voice firewall is not yet safe enough;
- missing “done” over the piano, silent click logging, weak recovery mechanics, cumbersome score
  setup/history, a verbose/session-only Brain, and a Universe that does not motivate its user.

The preserved baseline is:
`/Users/c3/Library/Application Support/com.christian.codakiller/backups/(C)
pre-v2.0.0-feedback-2026-07-15-163528.db`  
Schema 7 · integrity `ok` · zero foreign-key violations · SHA-256
`4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`.

## Release gates

v2.0.0 is not shipped until all of these are true:

1. The real schema-7 backup migrates with every piece, target, block, rep, session, event, goal,
   and Calendar row preserved; anomalies are surfaced or normalized without invented history.
2. Practice contracts, streak reset, undo/correct, restart, recovery, retention, and input-source
   provenance pass unit, migration, and integration tests.
3. Narrated PianoCoach recordings replay as speech/state-machine regression fixtures: intended
   commands act; piano, page turns, phone speech, and conversational negatives stay inert.
4. Score Atlas passes compatible XML exactness plus scanned-PDF calibration/correction tests; low
   confidence can never silently save an asserted exact range.
5. Brain answers are concise, grounded, durable, and tool actions are previewed/confirmed/audited/
   undoable. It still cannot claim to hear or diagnose physical execution as fact.
6. Dense-history, 720×520, keyboard, screen-reader, light/dark/reduced-motion, and large-real-PDF
   gates pass.
7. A fresh-context verifier adversarially tests the packaged app and finds no open release-blocking
   defect.
8. The installed `/Applications/CodaKiller.app` preserves Christian's live database and survives
   quit/relaunch. Human at-piano proof remains explicitly separate from automated proof.

## Execution sequence

1. Lock this contract, acceptance matrix, corpus evidence, and baseline backup.
2. Repair global feedback/error visibility and introduce the v2 ledger/protocol schema. **Source
   checkpoint delivered:** schema 9 plus authoritative RepEngine/store/IPC/HUD/history semantics,
   append-only correction/restart, and race-safe React receipts; the full backend receipt contract
   and pause/recovery/retention remain.
3. Ship the Score Atlas location model and scalable ledger/history surfaces.
4. Add voice drafts, corrections, replay gates, and concise durable Brain/tools.
5. Replace the shell/workspaces with the new handcrafted system and rebuild the Universe.
6. Run full migration, automated, native visual, accessibility, performance, and fresh adversarial
   release gates; then document, build, install, commit, and tag.

### Next steps

Finish the authoritative practice loop with command receipts/idempotency, pause/focus/safety,
accepted recovery, retention, and complete deterministic voice replay. Then build Score Atlas,
scalable Ledger/Composer, Brain, shell, and Universe on the now-correct practice semantics; no later
surface may invent a second mastery calculation.
