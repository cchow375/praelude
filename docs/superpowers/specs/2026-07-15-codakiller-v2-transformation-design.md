# CodaKiller v2 — Practice OS Transformation Design

> **Status:** Historical/superseded boundary. The standalone `v2.0.0` target was not tagged;
> its P7 implementation lineage shipped through the v3.0.0 transformation and later releases.
> Do not resume this document's old `NEXT` work as the current roadmap. Installed truth is
> v8.2.0/schema 20; use `docs/superpowers/plans/2026-08-27-v8.2.0-ui-cleanse-and-total-plays.md`
> and the Aug 8 rev-3 spec for current handoff truth.
> **Date:** 2026-07-15  
> **Release target:** v2.0.0 / P7  
> **Source contracts:** (C) v2 Transformation Brief · (C) v2 Acceptance Matrix  
> **Baseline:** installed v1.3.0, schema 7, and the preserved pre-v2 feedback backup

This specification turns Christian's July 15 feedback into an implementation boundary. Its
practice-truth slice now exists and is verified in source, but nothing here claims an installed v2
until the release gates pass. When this document conflicts with an older phase plan, this
document controls v2; the user-as-sensor thesis and deterministic hot-loop rules still control the
whole product.

## 1. Outcome and invariant

CodaKiller v2 is a **score-centered, voice-operated practice operating system**. The score is the
location spine, the ledger is the source of truth, protocols define what success means, and every
other surface is a projection over those same facts.

The invariant remains:

> Christian reports what happened. CodaKiller records, structures, retrieves, and proves it.
> It never interprets microphone audio as musical performance and never turns model prose into
> an unreviewed mutation.

The operational loop is:

1. Select a piece and target in the Score Atlas.
2. Select or edit a practice contract.
3. Start a short set with an explicit intention, method, hands, tempo, and stop condition.
4. Record each self-reported attempt through voice or controls.
5. See and hear an immediate committed receipt.
6. Correct, undo, restart, narrow, slow down, change strategy, or ask the Brain without losing the
   score context.
7. Close the set with exact evidence and an explicit unresolved, mastered, or retention-due state.
8. Revisit the target later through a retention check rather than treating one peak as permanent.

## 2. Locked product rules

1. **Attempts are not mastery.** A set completes only when its selected contract is satisfied or
   Christian explicitly closes it. Reaching a planned attempt count cannot silently imply mastery.
2. **Corrections are additive.** Undo, correction, restart, and recovery append compensating facts.
   They never erase an attempt or silently rewrite historical meaning.
3. **One canonical graph.** Piece, target, set, attempt, session, goal, retention, Brain, Calendar,
   and Universe surfaces resolve to the same stable entity IDs.
4. **Every mutation proves itself.** A write returns a typed committed, rejected, or
   confirmation-required receipt. No surface may show success before the transaction commits.
5. **Deterministic actions stay local.** Verdicts, undo, restart, status, tempo, pause/resume,
   metronome, and close never depend on a network or language model.
6. **Suggestions remain editable.** Protocols, recovery, retention, and Session Composer output are
   proposals with rationale, never imposed plans.
7. **Mapping confidence is visible.** Exact MusicXML identity, user-confirmed mapping, calibrated
   inference, and unknown location are distinct states. The app never upgrades confidence silently.
8. **Motivation cannot reward dishonesty.** Raw clean clicks alone cannot produce mastery or buy a
   more beautiful Universe.
9. **The v1.3 ledger is evidence.** Migration preserves every original row and ID, including
   anomalies. Repair happens only through an explicit reviewed action.
10. **Human proof stays human.** Narrated replay and native automation are strong regression gates;
    neither claims that voice-over-Steinway reliability is proven.

## 3. Canonical vocabulary and identity

The v2 UI and Rust domain use the following semantic names. Physical v1 table names remain in place
where retaining them is safer than a destructive rename.

| v2 entity | Canonical meaning | v1 storage compatibility |
|---|---|---|
| Piece | One repertoire work and its vault folder | piece |
| Score edition | A fingerprinted PDF/XML source for a Piece | existing scan/preference data |
| Score section | A named structural span inside a Piece | new schema-v8 record |
| Practice target | A reusable, markable musical location | existing region ID and row |
| Practice session | A bounded real practice sitting | existing session |
| Practice set | One protocol run against one target | existing rep_block ID and row |
| Attempt | One user-reported clean, flawed, or failed result | existing rep ID and row |
| Ledger event | Append-only provenance for practice and mutation facts | existing event |
| Practice contract | The immutable success/reset/recovery rules captured for a set | new v8 sidecar |
| Retention check | A dated re-test that can confirm, lower, or reopen a target | new v8 record |
| Action draft | A typed preview created from natural voice or Brain output | new v8 record |
| Mutation receipt | User-visible proof of a command result | returned from every mutating IPC |
| Data anomaly | A preserved fact that needs review, not an automatic rewrite | new v8 record |

Stable IDs are never recycled. A PracticeTarget is the v2 domain view of an existing region; a
PracticeSet is the v2 domain view of an existing rep_block. The implementation must not create a
second target or set table that competes with those rows.

## 4. Practice semantics

### 4.1 Effective attempts and exact summaries

The original attempt row is immutable once v2 records it. Corrections are folded over it in
chronological order to produce an effective attempt.

For a set:

- **tries** = effective, non-void attempts;
- **clean count** = tries whose effective verdict is clean;
- **current streak** = consecutive clean tries after the most recent flawed or failed try;
- **best streak** = the maximum clean run in the set;
- **accuracy** = clean count divided by tries, with an explicit no-attempt state instead of 0/0;
- **tempo path** = ordered committed attempt tempos, never a guessed start/end interpolation;
- **source mix** = counts by voice, click, edit, import, or legacy source;
- **retention result** = none, due, confirmed, lowered, or reopened.

Voided attempts remain visible in drill-in history and are excluded from effective aggregates.
Corrections show the original value, effective value, time, reason, and source.

### 4.2 Practice contract

Each new set captures an immutable PracticeContract snapshot. Editing a reusable template changes
future sets only.

A contract contains:

- contract version and stable template ID when applicable;
- name and short rationale;
- mastery basis: consecutive clean, total clean, timed exposure, or explicitly exploratory;
- required success value;
- whether flawed and failed attempts reset the streak;
- optional clean debt after a miss;
- tempo step/backoff policy;
- optional narrowing or hands/method recovery suggestion;
- planned time or attempt ceiling, which is a review/stop boundary rather than automatic mastery;
- retention delay and check shape;
- source references from the supported corpus or user-authored label.

The default new contract is configurable consecutive-clean mastery. Its initial product default is
five consecutive clean attempts, but Settings owns the value and every set displays the captured
number. A flawed or failed attempt resets exactly as the contract preview says.

Historical v1 blocks receive a **legacy attempt-count** contract marker. Their original status is
preserved, but v2 must label their mastery as unverified; a historical done status may not be
reinterpreted as consecutive-clean mastery.

### 4.3 Set state machine

The semantic state machine is:

    draft -> active <-> paused
    active|paused -> mastered | closed_unresolved | abandoned | restarted

- Only one set is active in the deterministic rep engine at a time.
- Mastered is reachable only when the captured contract evaluates true.
- Hitting a time or attempt ceiling produces a review prompt, not mastered.
- Restart closes the old run as restarted and creates a new set linked by restart_of_set_id.
- Abandon and close preserve all attempts and require no invented result.
- Relaunch restores an active or paused set with the same contract and counters.
- Set state, ledger event, session event, and emitted snapshot commit atomically.

### 4.4 Undo, correction, and restart

Undo last verdict appends a void adjustment. Correct verdict appends a replacement verdict/note.
Undoing a correction appends a reversal that restores the preceding effective state. No command
deletes or updates an original attempt row.

Every adjustment records:

- target attempt ID;
- kind: void, restore, replace_verdict, replace_note, or combined correction;
- before and after effective values;
- source and command ID;
- timestamp and optional reason;
- the adjustment it reverses, when applicable.

The UI must render the effective state immediately while retaining a disclosure path to the full
chain. The same semantics apply whether the request came from voice, a button, a typed draft, or an
import review.

### 4.5 Recovery and retention

Recovery is a musical action, never a penalty score. Supported actions are:

- reset the clean streak;
- add explicit clean debt;
- step back in tempo;
- narrow the target;
- change hands or method;
- mark a strategy break;
- schedule a retention check.

The chosen action and rationale are captured in the set ledger. Automatic protocol consequences may
apply only when they were visible in the accepted contract.

A completed contract can create a dated RetentionCheck. On its due date Christian may:

- **confirm** at the checked condition;
- **lower** the retained tempo or confidence;
- **reopen** the target as unresolved.

A one-time peak remains historical peak evidence. It never becomes permanent mastery without the
retention state.

### 4.6 Focus loop

A focused set optionally captures:

- intention;
- planned duration;
- focus category;
- hands and method;
- tempo and target;
- break or strategy-switch events;
- end self-report.

The timer measures app state only. It does not infer concentration from audio, cursor activity, or
camera data. Pause and relaunch behavior must be deterministic and clock-tested.

## 5. Schema-v8 and ledger contract

### 5.1 Migration stance

Schema v8 is additive around the schema-v7 truth. Physical renames of piece, region, rep_block, rep,
session, session_event, or event are forbidden in this release. Existing primary keys and foreign
keys remain stable.

The v8 storage boundary adds:

- score_section — named structural spans per Piece;
- target_meta — one-to-one v2 metadata for region: parent target, section, color, archive state,
  display order, and mapping-evidence version;
- score_edition_calibration — fingerprint-bound calibration points, method, confidence, and user
  verification;
- protocol_template — editable reusable definitions and citations;
- set_contract — one-to-one immutable contract snapshot and v2 set state for rep_block;
- attempt_provenance — one-to-one source/command provenance for rep;
- attempt_adjustment — append-only correction and reversal chain;
- retention_check — due condition and explicit outcome;
- data_anomaly — migration/runtime findings and their reviewed resolution;
- action_draft — typed preview, revision, confirmation, application, audit, and undo state;
- brain_thread and brain_turn — bounded durable per-piece conversation;
- nullable structured entity/source/command links on event where a v2 fact has them.

Current region.pdf_anchor remains the canonical edition-specific mark geometry. Its JSON schema may
gain versioned mapping evidence, but existing version-1 payloads must still round-trip byte-for-byte
until Christian explicitly changes a mark.

Schema v9 is a deliberately narrow additive follow-up: a partial unique index permits only one
native `active`/`paused` set while excluding preserved legacy states. A malformed database that
somehow contains multiple native live sets is a visible recovery error; the runtime may not choose
one silently or report an empty engine. Later additive schemas may implement focus intervals,
receipts, recovery, and retention, but may not rebuild the v1 evidence tables.

### 5.2 Provenance

Every v2 mutation receives a command ID at the IPC boundary and writes one or more LedgerEvents in
the same SQLite transaction as its source rows. Source is a closed enum:

- user_click;
- voice_hot_loop;
- voice_draft;
- brain_draft;
- import_review;
- migration_legacy;
- system_schedule.

The model cannot be the source of a committed action. Brain output produces brain_draft; a later
validated confirmation records the applying user source and retains the draft ID.

### 5.3 Mutation receipt

Every mutating Tauri command returns the same outer contract:

    MutationReceipt<T> {
      receipt_id,
      status: committed | rejected | confirmation_required,
      summary,
      value: T?,
      entity_refs[],
      event_ids[],
      undo_action?,
      error_code?,
      error_detail?
    }

Rejected commands write no practice-state rows. Confirmation-required commands write only a draft.
Committed means the transaction is durable. UI components may not catch and suppress a rejected
receipt; the application-level receipt surface owns it.

### 5.4 Anomaly preservation

The v7-to-v8 migration scans but does not rewrite:

- reversed or impossible ranges;
- attempts beyond the old planned count;
- abandoned or duplicate-looking blocks;
- same-second attempt bursts;
- cross-surface title/note inconsistencies;
- incomplete event provenance.

Each finding becomes a DataAnomaly with entity type, entity ID, kind, observed facts, severity,
review state, and optional resolving event. Candidate duplicates remain separate until Christian
merges or dismisses them. A reviewed correction appends normal v2 compensation; migration never
invents the intended range, verdict, timing, or identity.

### 5.5 Real-backup migration procedure

The release migration gate must:

1. Copy the preserved pre-v2 feedback database; never rehearse against the live original.
2. Record schema version, table counts, integrity, foreign keys, and representative row hashes.
3. Begin one immediate transaction.
4. Create v8 structures and populate only mechanically knowable compatibility rows.
5. Mark legacy provenance and legacy attempt-count completion without asserting mastery.
6. Generate anomaly records from the unchanged source rows.
7. Stamp user_version 8 inside the transaction and commit.
8. Re-run integrity, foreign keys, counts, row hashes, event/backfill idempotence, and semantic spot
   checks.
9. Roll back everything on any failure.

The expected baseline is the documented backup with 6 pieces, 27 targets, 48 blocks, 481 attempts,
8 sessions, 670 total events, 21 goals, and 11 Calendar cards. The gate compares the backup itself,
not merely these prose numbers.

Opening a database newer than the supported schema must fail safely with recovery guidance. A v1
binary must not be used on a v8 database; rollback means restoring the pre-v2 backup and v1 app
together.

## 6. Score Atlas contract

### 6.1 Workspace behavior

Opening a Piece lands in its Score Atlas when a PDF exists. The Atlas consists of:

- a compact edition/location bar;
- the large PDF working surface;
- score marks and drag-selection layer;
- a collapsible target rail;
- one contextual inspector for Resume, contract, recent evidence, notes, and mapping;
- a focused-set layer that removes nonessential editing controls during practice.

Selecting an existing target makes **Resume** the primary action and shows the latest result,
current retention state, and captured default contract without navigating to an endless history
page.

### 6.2 Selection draft

Dragging on the PDF immediately creates a local TargetDraft containing edition fingerprint, page
geometry, selected rectangles, and a mapping state. Typing a measure range or note is not required
to create the draft.

The draft may resolve as:

| Mapping kind | Meaning | Save behavior |
|---|---|---|
| exact_xml | Edition calibration and compatible MusicXML identify exact measures | May prefill exact range with evidence |
| user_confirmed | Christian explicitly confirmed or corrected the range | May save as authoritative |
| calibrated | Calibration suggests a bounded range with visible confidence | Must be reviewed before authoritative save |
| unknown | Geometry exists but a musical range is not defensible | Cannot masquerade as exact; request calibration/correction |

Confidence, source edition, calibration ID, and last verifier are visible. Changing PDF editions
never displays another fingerprint's coordinates as current.

### 6.3 Calibration

Calibration is explicit and edition-bound. Christian identifies a small set of visible printed
measure anchors or confirms a proposed correspondence. Interpolation may create a candidate range,
but only exact compatible structure or user confirmation earns authoritative status.

The app does not promise OCR, computer vision, automatic page-number understanding, or perfect
PDF/MusicXML alignment. Low confidence remains visible and correctable.

### 6.4 Target graph

Targets may overlap. A target may have one parent target from the same Piece; parentage describes
musical organization and does not merge their ledger histories. A child must not silently move when
its parent range is edited.

Targets can be retitled, recolored, annotated, archived, resumed, split, and merged. Split and merge
are transactional and present an exact preview of block, tutorial, Calendar, and mark consequences.
Archive hides by default but preserves all links.

One canonical title and note feed every surface. Score, inspector, ledger, Brain, Calendar, and
Universe must invalidate together after a committed edit.

## 7. Practice Ledger and Session Desk

### 7.1 Scalable history

The Ledger is queryable by Piece, target, date range, session, contract, focus, hands/method,
verdict, source, anomaly, and retention state. Summary rows disclose details on demand.

Hundreds or thousands of sets must not create one unbounded DOM page. The implementation uses
windowing or pagination with stable sort keys and preserves keyboard position when details open.
No query uses artificial year-0001-to-9999 ranges to obtain a local summary.

### 7.2 Required summaries

Target, set, and session projections expose:

- tries and clean count;
- current and best streak;
- accuracy with numerator/denominator;
- tempo path and historical peak;
- contract and whether it was satisfied;
- focus, hands, method, and notes;
- source mix and correction count;
- time active versus paused;
- unresolved recovery and retention state;
- anomaly badge where applicable.

All aggregates are computed from the effective ledger through one Rust query/service. React does
not reproduce mastery math.

### 7.3 Session Composer

Composer preview is deterministic and read-only. Given date, available minutes, due retention,
unresolved targets, active goals, and capacity, it proposes a small ordered sequence with rationale
and estimated duration.

Christian may reorder, remove, resize, replace, or add items. Nothing is written until Start.
Starting snapshots the accepted plan into the session ledger; later edits are explicit session
events. The initial 20-minute preset is a convenience, not a required duration.

Markdown exports remain derived projections. They can be regenerated from SQLite and never become a
second writable source of truth.

## 8. Voice contract

### 8.1 Lane A — deterministic hot loop

Lane A remains offline, regex/state-machine routed, and independent of Brain/provider availability.
It owns:

- clean, flawed, and failed verdicts;
- undo/correct last attempt;
- restart set;
- status;
- pause/resume;
- tempo and metronome controls;
- close/abandon;
- explicit recovery confirmation.

The committed SQLite receipt and UI snapshot are emitted before optional spoken confirmation.
Speech never delays persistence. Acknowledgements are terse and include the new streak or reset when
that fact changed.

Ambient speech, piano, page turns, phone audio, and conversational negatives must route to no
mutation. Verdict aliases remain active only while a set is active and are hardened against phrases
found in the narrated corpus.

### 8.2 Delivery identity and missed verdict recovery

Idempotency is keyed by a voice-delivery command ID propagated into the mutation transaction. A
normalized-text time window alone may not decide that two genuine verdicts are the same attempt.

When STT produces an indistinguishable suspected resend:

- the engine does not silently create a second attempt;
- it exposes a brief possible-duplicate receipt;
- an explicit local phrase such as “count that” confirms the pending attempt;
- “did that count?” reports the last committed attempt number, verdict, and streak;
- “undo that” compensates the last committed attempt.

The exact resend classifier is implementation evidence, not a guessed design constant. Narrated
replay and at-piano evidence determine it. A missed done always has a visible and spoken recovery
path.

### 8.3 Lane B — natural-language action draft

Complex requests produce an ActionDraft, never a direct mutation. The typed operation allowlist is:

- create or resume a target/set;
- restart with changed range, hands, method, tempo, contract, or planned boundary;
- update Piece or target state;
- create a recovery or retention proposal;
- edit the current Session Composer preview.

Recording a verdict, deleting history, applying a merge/split, or controlling the live metronome is
not a model tool.

Every draft includes parsed operations, original text, entity IDs, ambiguities, confidence, risk,
expected changes, and revision hash. Ambiguous or multi-entity mutations require a one-tap or
one-word confirmation. Apply revalidates IDs and current revisions, commits once, audits the draft,
and returns an undoable receipt. Stale drafts are rejected rather than partially applied.

## 9. Practice Brain contract

### 9.1 Default answer shape

The default rendered response must fit one glance at 720×520:

1. **Hypothesis** — clearly framed as a possibility based on Christian's report;
2. **Do this** — one concrete action;
3. **Dose** — duration or repetitions;
4. **Stop when** — observable self-judged stop/change condition;
5. **Sources** — concise grounding receipts.

Additional explanation, alternatives, score facts, and conversation history are disclosures, not a
mandatory scroll before the action.

### 9.2 Context envelope

Brain context is assembled natively from authoritative IDs and bounded before transport:

- selected Piece, target, score edition, and mapping evidence;
- selected MusicXML measure facts when supported;
- Christian's reported symptom;
- current set/contract and recent effective attempts;
- target/session history and retention;
- relevant goals and Calendar context;
- retrieved chunks from the complete supported four-book corpus;
- bounded per-piece conversation turns.

The receipt says which of these were present, missing, unsupported, or withheld. Client-supplied
display text never substitutes for native entity lookup.

### 9.3 Corpus and provider policy

The supported practice corpus is a versioned exact manifest of four approved books. Files remain
canonical-path checked, non-symlink, read-only, size bounded, and cited without exposing local paths.
Offline lexical retrieval and structured protocol routing are always available.

There is no always-resident local LLM on the 8 GB Mac. A small external model may parse a narrow
draft; deeper provider calls occur only when needed. Privacy settings control whether retrieved
excerpts and conversation turns leave the machine.

### 9.4 Durable conversation

Brain threads are per Piece, optionally target-scoped, bounded, and persisted locally. Relaunch
restores them. Christian can clear a Piece's conversation explicitly; conversation content is not
the immutable practice ledger and may be hard-deleted for privacy after confirmation.

Clearing conversation does not delete practice facts, action audits, or citations attached to
applied actions. API keys remain Keychain-only and never enter thread rows.

### 9.5 Typed tools

Brain may create only the same ActionDraft operations allowed to Voice Lane B. It cannot:

- write SQLite directly;
- record a verdict;
- claim it heard or measured performance;
- navigate or change live tempo without a reviewed local action;
- invent an entity ID, range, citation, or retained result;
- bypass preview, confirmation, audit, or undo.

Provider output is parsed into an allowlisted schema and rejected whole on an unknown field or
operation. Partial tool execution is forbidden.

## 10. Interface system

### 10.1 Information architecture

The v2 shell is organized around current work, not feature cards:

- **Today** — Session Composer, due retention, and resume;
- **Atlas** — score-centered Piece/target workspace;
- **Ledger** — scalable history and Session Desk;
- **Calendar** — deliberate work and retention placement;
- **Universe** — earned graph over the same ledger;
- **Brain** — contextual drawer available without losing Atlas or set state.

Piece and target context are global and explicit. A workspace switch never discards an active set or
quietly changes Brain grounding.

### 10.2 Global feedback

One application-level Receipt Center renders committed, rejected, confirmation-required, and
possible-duplicate outcomes. It includes an assertive accessible live region for failures and a
polite one for saves.

Rep open, attempt, session end, setting save, target edit, draft apply, and export errors may not be
owned solely by a component that disappears when the operation fails. Receipts remain reviewable
long enough to understand what happened and expose Undo when valid.

### 10.3 Visual language

The operational palette is Cloud Dancer off-white, ink black, and one deep terracotta accent.
Semantic danger/success colors remain restrained and accessible. Score marks and Universe objects
own the broader color range.

- Editorial serif for display hierarchy.
- Structured mono or humanist sans for data and controls.
- No Inter, Roboto, Arial, or Space Grotesk.
- Matte filled surfaces, asymmetry, deliberate negative space, and tactile controls.
- No violet-glow inheritance, glassmorphism, generic three-card dashboard, or component-library
  collage.
- One staggered workspace entrance; fast physical hover/press/focus responses.
- No decorative ambient loop.
- Reduced motion removes spatial transitions without removing state proof.

### 10.4 Responsive and accessible behavior

Primary practice actions remain large and high contrast at the 720×520 minimum and 75–125% scale.
The Calendar may not require an 88rem-wide strip to perform its primary flow.

Every interaction has:

- keyboard reachability and visible focus;
- screen-reader name, role, state, and error association;
- light/dark contrast;
- non-color state equivalent;
- reduced-motion equivalent;
- stable focus after drawer, disclosure, mutation, and error transitions.

Large PDF, dense ledger, and Universe routes load lazily. PDF.js, Brain, and Universe heavy work
must not all remain active when hidden.

## 11. Earned Practice Universe

Universe is a deterministic, read-only projection of the effective ledger.

- Piece systems contain Session stars and PracticeTarget bodies.
- Selecting an object opens the exact underlying entity in Atlas or Ledger.
- Layout is stable for the same IDs and supports pan, zoom, focus, and reset.
- Dense systems use bounded rendering and do not create one DOM node per attempt.
- A structured text view exposes the same entities, metrics, and navigation.

Growth inputs are independently visible and traced:

- focused time;
- distinct active days;
- target coverage;
- satisfied non-legacy mastery contracts;
- honest recovery after misses;
- confirmed retention.

Raw clean count, rapid same-second bursts, Calendar administration, imported display rows, and
unverified legacy done status cannot independently create mastery growth. Low-quality work remains
visible evidence but never makes a Piece ugly, shrinks it, or creates a shame state. Errors can
contribute positively only through later recovery and retention.

Universe aggregation lives in Rust, uses effective corrected attempts, and returns definitions and
trace inputs with every snapshot. React performs layout/rendering, not metric truth.

## 12. Module boundaries

### 12.1 Rust

Preserve the tested audio, metronome, STT supervisor, intent grammar, score security, vault scanner,
and TTS gate. Refactor only through behavior-preserving seams.

Create or extract:

- protocol/ — pure contract evaluation, streak, recovery, and retention transitions;
- ledger/ — effective attempts, adjustments, aggregates, provenance, and receipts;
- targets/ — PracticeTarget domain over region plus split/merge/archive validation;
- score_atlas/ — selection draft, mapping evidence, and calibration;
- action_drafts/ — typed preview, confirmation, stale revision, apply, and undo;
- composer/ — deterministic Session Composer preview/start;
- brain/thread.rs and brain/tools.rs — durable threads and draft-only tool boundary;
- store repositories by domain instead of adding more behavior to store/mod.rs or store/crud.rs.

The existing rep engine becomes the coordinator over protocol and ledger rather than owning all
semantics. voice_loop delegates typed actions instead of growing another command branch. Tauri
commands remain thin validation/state adapters.

### 12.2 Frontend

Introduce:

- app/ — shell, workspace routing, global Piece/target context;
- services/ — one typed IPC boundary and receipt normalization;
- state/resources/ — shared entity cache, revision invalidation, and loading/error state;
- features/score-atlas/ — document controller, score canvas, mark layer, target rail, inspector,
  calibration, and focused-set layer;
- features/ledger/ — filters, virtualized summaries, drill-in, and Session Desk;
- features/receipts/ — global feedback and undo;
- features/composer/ — preview/edit/start;
- features/universe/ — graph viewport plus text-equivalent view.

ScoreView.tsx is split behind a controller while preserving its generation guards, timeouts,
fingerprint checks, lazy pages, and document cleanup. Shell.tsx stops owning every domain hook.
Views do not call invoke directly; they use the typed service/resource boundary.

No state library is mandated by this spec. A new dependency is accepted only if it measurably
reduces complexity and is approved before introduction.

### 12.3 Compatibility adapters

Existing commands may remain as temporary adapters while one caller at a time migrates. Adapters
must call the new canonical service and return the same committed facts; dual business logic and
independent dual writes are forbidden.

Before release:

- direct rep_update and rep_delete behavior is removed from user flows in favor of adjustments;
- all mutating v2 UI paths consume MutationReceipt;
- mastery math exists only in Rust protocol/ledger services;
- old Region/block names may remain at storage boundaries but not leak inconsistent semantics into
  the UI.

## 13. Non-goals

v2.0.0 does not include:

- microphone-based pitch, rhythm, dynamics, technique, or correctness grading;
- automatic protocol imposition or punitive gamification;
- an always-running local LLM;
- universal semantic search beyond the approved corpus;
- automatic OCR or a promise of perfect PDF/MusicXML alignment;
- score engraving, notation editing, DAW features, or automatic page following;
- social feeds, leaderboards, XP, streak punishment, or comparison with other pianists;
- cloud sync, collaborative accounts, Spotify playback automation, or YouTube downloading;
- an unrestricted model tool layer;
- silent cleanup, deletion, or deduplication of Christian's historical data;
- a claim of Developer ID signing/notarization unless those credentials and gates actually exist;
- a claim of at-piano success before Christian performs the human acceptance session.

## 14. Principal risks and mitigations

| Risk | Consequence | Required mitigation |
|---|---|---|
| Semantic migration over anomalous real history | Lost or falsely repaired evidence | Additive v8 sidecars, immutable backup rehearsal, anomaly records, row-hash gates |
| Replacing attempt-count completion | Old done blocks appear newly mastered | Explicit legacy basis and mastery-unverified label |
| Score mapping overconfidence | Practice attaches to the wrong music | Fingerprint binding, mapping-kind state, visible confidence, required review |
| Voice resend versus genuine rapid repeat | Duplicate or missing attempts | Delivery IDs, idempotent commits, possible-duplicate state, explicit recovery, narrated replay |
| Natural-language mutation | Wrong range, hands, tempo, or target changes | Typed allowlist, preview, revision hash, confirmation, one transaction, undo |
| Scope explosion | A visually new shell on unstable semantics | Land ledger/protocol first; phase gates; preserve proven subsystems |
| Large PDF + Brain + Universe on 8 GB Mac | Memory pressure and unresponsive practice | Lazy routes, bounded context, virtualized history, bounded graph, profiling gate |
| Universe rewards self-reported cleans | Incentive to lie | Multi-signal traced metrics; clean count alone cannot drive mastery/growth |
| Persistent Brain memory | Privacy or stale context | Per-piece bounds, clear control, context receipt, provider privacy setting |
| Fragmented frontend state | Stale title/history/context across surfaces | Typed resource cache, canonical revisions, cross-surface regression tests |
| Hidden write failures | False confidence that work saved | Global receipts, failure injection, no swallowed mutation result |

## 15. Acceptance and release gates

Every row in (C) v2 Acceptance Matrix remains open until its required evidence is attached. Suite
success alone does not close a native or human requirement.

### Gate A — data and ledger

- D1–D3: real-backup migration, counts/hashes/integrity/FKs, anomaly report, provenance, receipts.
- P1–P3: contract completion, exact reset, correction, undo, restart, rollback, relaunch.
- Zero-percent and 50-percent-clean histories must prove that attempt count is not mastery.

### Gate B — recovery, focus, retention, and composer

- P4–P6: recovery fixtures, focus timer/state, cross-day retention outcomes.
- C1: deterministic 20-minute preview, full editability, and no write before Start.

### Gate C — Score Atlas and history

- S1–S4: packaged drag selection, exact real XML, low-confidence calibration, nesting/overlap,
  marks, notes, and one-action Resume.
- H1–H3: dense history, exact aggregates, virtualization/disclosure, canonical cross-surface edits.

### Gate D — voice

- V1–V4: deterministic intent/state/latency, typed drafts, confirmation/undo, ambient negatives,
  narrated PianoCoach replay, resend/missed-done recovery, and at-piano checklist.
- Piano and narration fixtures are mutation-negative tests, never performance graders.

### Gate E — Brain

- B1–B4: one-glance response snapshots, full context receipt, real four-book retrieval, durable
  clearable threads, and adversarial typed-tool authorization/failure injection.
- Output still cannot claim hearing or physical diagnosis as fact.

### Gate F — interface and Universe

- U1–U2: pan/zoom/navigation, dense performance, text parity, traced anti-gaming metrics.
- X1–X3: before/after native evidence, locked token audit, motion/reduced-motion parity, 720×520,
  scale, keyboard, screen reader, and light/dark contrast.

### Gate G — release

- R1: frontend, Rust, build, strict clippy, real-data, packaged-native, performance, accessibility,
  and fresh-context verifier all pass.
- R2: backup, migration, release build, seal, install, checksum, one-copy audit, quit/relaunch,
  preserved live data, matching version/tag/docs.
- The installed app is not called shipped while any release-blocking matrix row is open.
- Christian's Steinway session is recorded separately; if it remains undone, that limitation is
  stated prominently even if automated gates pass.

## 16. Implementation order

1. Add schema-v8 migration rehearsal, anomaly projection, provenance, and global receipt contract.
2. Implement the pure PracticeContract engine, effective ledger, correction/undo/restart, recovery,
   focus, and retention.
3. Add Score Atlas target/mapping/calibration services and scalable Ledger projections.
4. Add voice delivery identity, deterministic corrections, natural-language ActionDrafts, and
   narrated replay gates.
5. Add durable concise Brain threads/tools and deterministic Session Composer.
6. Replace the shell and workspaces with the locked editorial interface; rebuild Universe over the
   v2 ledger.
7. Run the full matrix against the real backup and installed app, then update living docs, build,
   install, commit, and tag.

### Next steps

Schema 9 plus the PracticeContract/effective-ledger RepEngine boundary and P1/P3 evidence are now
green in source. Finish D3 and P2/P4–P6 next: durable command receipts/idempotency, pause/focus /
safety/recovery/retention, and the complete deterministic voice/replay path. Then build Score Atlas,
Brain actions, Composer, and Universe on the single authoritative projection.
