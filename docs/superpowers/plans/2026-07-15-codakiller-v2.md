# CodaKiller v2 — Practice OS Execution Plan

> **Status:** implementation in progress — **not shipped**  
> **Date:** 2026-07-15 · **Target:** v2.0.0 / P7  
> **Design:** `docs/superpowers/specs/2026-07-15-codakiller-v2-transformation-design.md`  
> **Product gates:** vault `(C) v2 Acceptance Matrix.md`  
> **Rule:** one implementation slice → its focused tests → full relevant suite → fresh-context
> adversarial review → fix round → progress/docs entry. A checked task means evidence exists, not
> merely that code was written.

## Dependency spine

```text
V2.0 baseline/contracts
  └─ V2.1 receipt + typed command boundary
      └─ V2.2 schema-v8 sidecars/anomalies/provenance
          └─ V2.3 protocol + effective ledger
              ├─ V2.4 correction/restart/focus/safety/retention
              ├─ V2.5 real-backup migration gate
              └─ V2.6 Score Atlas
                   └─ V2.7 scalable Ledger + Composer
                        ├─ V2.8 voice replay + ActionDrafts
                        └─ V2.9 concise durable Brain/tools
                             └─ V2.10 shell/interface transformation
                                  └─ V2.11 earned Universe
                                       └─ V2.12 packaged release
```

No lane may invent a second mastery calculation, target identity, or mutation path. Rust owns
semantic truth; React renders typed projections and committed receipts.

## 2026-07-15 foundation checkpoint

**Exact-tree gate passed; release remains open.** Frontend: 39 files / 236 tests and production
build. Rust: 376 library tests passed / 9 ignored; knowledge 9, narrated firewall 2, STT 9, and TTS
gate 4 passed; 2 live-TTS tests remained intentionally ignored; strict clippy passed. The ignored
real four-book corpus and Scherzo/Griffes MusicXML gates passed explicitly. A disposable copy of
the preserved real backup migrated 7→8, reopened idempotently, preserved every source row, passed
integrity/FKs, and produced the expected review-only anomalies. Christian's live database was not
opened and `/Applications/CodaKiller.app` remains v1.3.0.

This checkpoint completes the typed frontend receipt/error adapter, the schema/backfill core, the
pure contract/effective-ledger derivation, the fourth-book manifest, and a first deterministic
voice-firewall fixture. It does **not** complete backend receipt IDs/undo, sidecar repositories,
RepEngine/store/IPC integration, the full narrated replay, or any user-facing v2 release behavior.
The dependency spine therefore remains at V2.3 integration.

## 2026-07-15 authoritative practice-truth checkpoint

**Exact-tree gate passed; release remains open.** Schema 9 plus the PracticeContract RepEngine /
store/IPC/HUD/history cutover, append-only undo/correct/reverse/restart, relaunch recovery, exact
downstream projections, and async/metronome ownership guards are verified. Frontend: 39 files /
283 tests and build. Rust: 406 library passed / 10 ignored; focused RepEngine 47, metrics 11,
planner 6, export 4; check and strict clippy. Independent Rust and React reviewers found no
remaining P0–P2 defect in the scoped cutover.

A disposable preserved-backup copy migrated 7→9 with exact source row counts and SHA3 hashes,
integrity `ok`, FK 0, idempotent reopen, 27/48/481/628 expected sidecars, 792 anomalies, and all 127
physical non-tempo sentinels unchanged. Christian's live schema-7 database and installed v1.3.0 app
were not opened or changed.

The dependency spine now sits in the remaining half of V2.4: durable backend receipt/idempotency,
pause/focus/safety/recovery/retention, and full deterministic voice/replay. Score Atlas and visual
work still wait behind that gate.

## V2.0 — Evidence, backup, and contracts

**State: complete.**

- Preserve the July 15 live database with SQLite's backup API; record checksum, schema, counts,
  integrity, and foreign keys.
- Lock the vault brief, acceptance matrix, four-book evidence catalogue, this design/plan, narrated
  replay contract, live anomalies, UI references, and honest PDF/XML boundary.
- Run the unchanged v1.3.0 baseline suites and record exact results.

**Evidence:** schema 7 backup `(C) pre-v2.0.0-feedback-2026-07-15-163528.db`; 6 pieces / 27 Regions /
48 blocks / 481 reps / 8 sessions / 670 events / 21 Goals / 11 work; integrity `ok`, FK 0; frontend
217 passed; Rust 380 normal passed + three safe real-data gates; strict clippy/build passed.

**Failure boundary:** no production code or live schema mutation in this task.

## V2.1 — Global mutation receipts and typed frontend service

**State: verified frontend foundation; full v2 receipt contract remains open.**

**Purpose:** fix invisible failure before adding new writes.

**Files/modules:** add `src/services/`, `src/features/receipts/`, application receipt provider in
`src/components/Shell.tsx` (later moved to `src/app/`); adapt `useRep.ts`, `useSession.ts`, Settings,
and their tests. Add a shared Rust `MutationReceipt<T>` model without changing existing command
semantics yet.

**Work:**

- [ ] Add the complete cross-process committed/rejected/confirmation-required receipt model with
  backend operation IDs, entity refs, durable detail, and undo descriptors. The frontend now has
  process-local committed/undone/error receipts and normalized error codes; practice attempts have
  real append-only undo, but the shared Rust outer receipt model and generic operation-backed undo
  remain open.
- [x] Add one typed `invoke` wrapper that normalizes thrown IPC failures and legacy success values.
- [x] Add application-level polite/assertive live regions and a compact dismissible receipt stack.
- [x] Make rep open, session end, and settings save preserve prior state and surface failures;
  failed writes no longer advance the affected revision or claim saved state.
- [x] Preserve current styling while proving the boundary; the redesign remains V2.10.

**Tests/evidence:** injected first-open failure is visible with no block; session-end failure leaves
the session active and visible; failed setting persistence restores the prior value; keyboard /
screen-reader receipt behavior; no unhandled rejection. Full frontend suite/build.

**Failure/rollback:** adapters are allowed, dual writes are not. If a legacy caller cannot consume
a receipt yet, normalize only at the service boundary and keep its backend command unchanged.

**Review gate:** fresh reviewer traces every caught mutation error and finds no disappearing owner.

**Checkpoint evidence:** fresh review fixed settings snapshot races, delayed rep-open/check state
resurrection, and a late closed-set metronome retune. Successful rep logging emits
`Attempt N saved — verdict.` exactly; open success followed by metronome failure preserves the
committed block and exposes both results. Focused and full frontend gates pass. Backend receipt
identity and command-backed undo are intentionally deferred.

## V2.2 — Schema-v8 sidecars, provenance, and anomalies

**State: migration/backfill plus practice repositories/runtime wiring verified; later domain
repositories remain open.**

**Files/modules:** `src-tauri/src/store/migrations.rs`, store model/repositories/tests; add domain
repositories rather than expanding `store/mod.rs` business logic.

**Work:** additive tables from the design spec: `score_section`, `target_meta`,
`score_edition_calibration`, `protocol_template`, `set_contract`, `attempt_provenance`,
`attempt_adjustment`, `retention_check`, `data_anomaly`, `action_draft`, `brain_thread`, and
`brain_turn`; structured event links as needed.

- Preserve v1 physical tables/IDs and `region.pdf_anchor` bytes.
- Backfill each historical block with a `legacy_attempt_count` contract and every historical rep
  with `migration_legacy` provenance. Never assert consecutive mastery.
- Scan reversed ranges, overruns, empty/duplicate-looking blocks, same-second bursts, and incomplete
  provenance into reviewable anomalies without rewriting originals.
- Reject newer-than-supported databases safely; migration is one immediate transaction and
  idempotent.

**Checkpoint evidence:** the tables, constraints, transactional v7→v8 step, legacy contracts,
attempt provenance, and review-only anomaly projection are implemented and adversarially tested.
Fresh review added cross-piece/self-link rejection, calibration uniqueness, signed legacy sorting,
nonpositive/negative input facts, deterministic burst IDs, and exact incomplete-provenance facts.
PracticeContract/attempt/adjustment repositories, IPC, and new-write integration are now
implemented through RepEngine. Score Atlas, retention, ActionDraft, and Brain-thread repositories
remain later tasks.

**Tests/evidence:** v7→v8 fixture preserving every table/ID/value; injected DDL/backfill failures
roll back version and tables; second open is idempotent; v8 fresh schema constraints/indexes/FKs;
anomaly fixtures match facts; `pdf_anchor` round-trips byte-for-byte.

**Failure/rollback:** migration failure leaves a usable v7 copy. No test opens the live DB.

**Review gate:** adversarial migration reviewer + strict clippy/Rust suite.

## V2.3 — PracticeContract and effective Practice Ledger

**State: authoritative RepEngine/store/IPC/React integration verified in source.**

**Files/modules:** add `src-tauri/src/protocol/` and `src-tauri/src/ledger/`; refactor
`src-tauri/src/rep/` into coordinator; expose derived fields in `store/model.rs` and thin commands.

**Work:**

- Pure contract evaluator for consecutive-clean, total-clean, exploratory, and bounded exposure.
- Initial new-set default: five consecutive clean; Settings may choose 3/5/7/10/custom.
- Flawed/failed reset behavior captured per immutable set contract.
- Derive tries, clean/flawed/failed, current/best streak, resets, accuracy, effective verdicts,
  source mix, contract satisfaction, recovery/debt, and tempo path from canonical rows.
- Planned attempt/time ceilings prompt review; they never auto-master.
- Ladder profiles support fixed streak then up, up-on-clean/down-on-error, and hold; caps and tension /
  pain prevent advancement. Variants advance by their success contract, not raw tries.
- New set state: draft/active/paused/mastered/closed_unresolved/abandoned/restarted.

**Tests/evidence:** property tests plus explicit `C,C,F → current 0/best 2`; five following cleans
master only on fifth; 10 failures never master; 15 tries/0 clean remains unresolved; 10/20 clean is
50%, not complete; tempo never crosses ceiling; legacy done remains mastery-unverified.

**Failure/rollback:** state row + attempt + event + session event + emitted snapshot must share a
transactional outcome; no in-memory advance on rollback.

**Review gate:** fresh practice-semantics reviewer checks implementation against all four books and
the acceptance matrix P1–P2.

**Foundation evidence:** pure Rust modules evaluate consecutive-clean, total-clean,
timed-exposure, exploratory, and legacy contracts and fold immutable attempts plus append-only
void/restore/correction/reversal records. Tests prove deterministic SQLite-ID order,
`C,C,F → current 0 / best 2`, fifth-following-clean mastery, 10 failures never mastering, 50%
accuracy staying 50%, adaptive recovery only after error, and legacy completion remaining
unverified.

**Integrated checkpoint evidence:** schema 9 enforces one active/paused native set; RepEngine
restores durable state and owns open/check/close/undo/correct/reverse/restart; every set/attempt /
provenance/event/snapshot write commits transactionally; Settings owns the 3/5/7/10/custom default;
and React renders only the typed Rust projection. Exact tests cover 0%/50% non-mastery, target
overshoot, resets/recovery debt, nullable BPM, malformed recovery, rollback/relaunch, terminal
lineage, review boundaries, and void filtering. Tempo regression as an explicit accepted recovery
action remains V2.4.

## V2.4 — Corrections, restart, focus, safety, recovery, and retention

**State: append-only correction/reverse/restart and their HUD/history are verified; focus/pause /
safety/recovery/retention remain open.**

**Files/modules:** ledger adjustment repository, protocol transitions, rep/voice thin adapters,
retention repository/commands; frontend Rep HUD/Set Desk tests.

**Work:**

- Undo last verdict appends void; correction appends replacement; reversing a correction restores
  the previous effective state. Original reps are immutable.
- Restart closes the current set as restarted and atomically creates/link a new set with selected
  changes; restarting a streak without voiding history is a distinct action.
- Capture intention, judging axis, hands, method, planned interval, pause/break, reflection, and
  explicit safety state. Pain/numbness/weakness stops set + metronome and is not a failure.
- Recovery profiles: streak reset, clean debt, tempo backoff, narrow/change hands/method, break,
  retention schedule. Consequences apply only if visible in the accepted contract.
- Cold retention checks capture result before warm-up: confirm/lower/reopen; snooze is neutral and
  preserves original due evidence.

**Delivered checkpoint:** original attempts and historical set rows are immutable; undo appends
void, correction preserves omitted notes versus explicit clear, reversal restores the preceding
effective state, and restart atomically closes/links a fresh contract. Relauch, rollback, paused and
terminal lineage, tempo replay, metronome ownership, history provenance, and accessible correction
controls pass. Voice phrases for these operations and the remaining focus/safety/recovery/retention
bullets are not yet complete.

**Tests/evidence:** adjustment chains/relaunch/rollback; restart lineage; active timer excludes
pause; safety stop; clock-controlled next-day checks; no shame/failure semantics on snooze or pain.

**Failure/rollback:** a partial restart/correction is forbidden. Voice and buttons call the same
transaction.

**Review gate:** safety + data-integrity reviewer; P3–P6 acceptance rows receive test links.

## V2.5 — Real-backup migration rehearsal and anomaly report

**State: foundation and post-RepEngine schema-9 rehearsals passed; rerun on the final release tree
remains mandatory.**

**Files/modules:** add a read-only/rehearsal QA harness under `src-tauri/tests/` and a record under
`docs/qa/`; never commit Christian's DB.

**Work:** copy the preserved backup to a disposable path; hash representative rows; run production
migration twice; compare all v1 row counts/IDs/content; assert schema-v8 sidecars/provenance/
legacy contracts/anomalies; quick/integrity/FK check; prove injected failure rollback on a clone.

**Tests/evidence:** exact gate output and anomaly counts, including the 452–449 range, overruns, and
same-second bursts. Any difference requires explanation and a new backup—not a relaxed assertion.

**Failure/rollback:** delete disposable copies only; leave backup/live DB untouched.

**Review gate:** independent verifier queries the migrated copy directly.

**Checkpoint evidence:** an independent verifier migrated a disposable copy of the preserved
schema-v7 backup and queried it directly. Exact source counts remained 6 pieces / 27 Regions / 48
blocks / 481 reps / 8 sessions / 628 session events / 670 events / 21 Goals / 11 Daily Work rows;
27 target metadata, 48 legacy contracts, 481 legacy provenance, and 628 backfill-ledger rows were
created. Exactly 792 anomaly rows were projected: 670 incomplete legacy event provenance, 43
same-second bursts, 30 duplicate candidates, 23 abandoned sets, 13 empty sets, 11 overruns, one
Region 24 range at 0–0, and one set 45 range at 452–449. Integrity/FKs and second-open idempotency
passed. A post-integration independent run then migrated v7→v9, preserved all nine source-table
counts plus SHA3 row hashes, retained all 127 physical non-tempo sentinels, created the expected
sidecars/index, directly rejected a second live set, and passed integrity/FKs/idempotence. The live
database stayed untouched. This gate must run again immediately before packaging.

## V2.6 — Score Atlas and selection-first targets

**Files/modules:** Rust `score_atlas/` + target repository; frontend `features/score-atlas/`; split
`ScoreView.tsx` behind a controller while preserving PDF security/render cleanup/generation guards.

**Work:**

- Drag creates a local target draft before asking for text/range.
- Exact compatible XML lane; edition-bound calibration/candidate lane; unknown lane. Confidence,
  source, fingerprint, and verifier remain visible.
- Low-confidence candidates cannot save as authoritative without correction/confirmation.
- Nested/overlapping targets, archive, title/note/color/marks, one canonical record, Resume primary
  action, latest result/retention in the inspector.
- Existing v1 marks and edition fingerprints remain valid; changed editions still require remap.

**Tests/evidence:** real Scherzo/Griffes XML exact fixtures; scanned-PDF low-confidence fixtures;
packaged drag/save/resume; split/merge/archive rollback; stale request/edition guards; actual PDF
pixels at 720×520 and large scores.

**Failure/rollback:** selection remains a draft until one transaction commits target + geometry +
mapping evidence. No OCR/perfect-alignment claim.

**Review gate:** fresh score/data/security/native-visual review; S1–S4.

## V2.7 — Scalable Ledger, Session Desk, and 20-minute Composer

**Files/modules:** Rust ledger queries/composer; frontend `features/ledger/`, `features/composer/`,
shared resource cache; remove year-0001-to-9999 fetches and 88rem primary Calendar dependency.

**Work:**

- Stable cursor/page queries by piece/target/date/session/contract/focus/hands/method/verdict/source/
  anomaly/retention.
- Disclosure summaries with tries, clean, streak, accuracy, tempo path, contract, corrections,
  active time, recovery/retention; virtualize/page details and preserve focus.
- Deterministic composer preview from due retention, unresolved targets, Goals, and available
  minutes. Reorder/remove/resize/replace; no writes before Start; accepted plan snapshots once.
- Markdown remains a regenerable projection with provenance.

**Tests/evidence:** thousands-of-sets dense fixture; bounded DOM/query timings; exact aggregates;
keyboard and 720×520 navigation; composer no-write preview, edit, and atomic start.

**Failure/rollback:** cursor/revision mismatch rejects stale updates. React never computes mastery.

**Review gate:** performance/accessibility/data reviewer; H1–H3 and C1.

## V2.8 — Voice identity, corrections, ActionDrafts, and narrated replay

**Files/modules:** intent/voice loop thin commands, action-draft service/repository, replay fixtures
under tests; contract `docs/qa/(C) v2-narrated-replay-contract.md`.

**Work:**

- Lane A: verdict/status/undo-correct/restart/pause-resume/close/tempo/metronome/safety remain local,
  terse, and receipt-first.
- Replace normalized-text-only dedup with delivery identity/pending-duplicate recovery; “did that
  count?”, “count that”, and “undo that” expose/recover exact state.
- Harden `no thanks`, leading conversational `again`, number times/colons, lost hundreds, and
  progressive revisions. Ambiguous numeric state changes require confirmation.
- Lane B parses natural range/hands/method/tempo/target/reps/state requests into typed drafts with
  IDs/confidence/ambiguities/revision/risk; revalidate + confirm + atomic apply + audit/undo.
- Build raw firewall, curated moments, corruption matrix, four stateful sessions, mastery/property,
  and separate installed-STT audio lanes. Audio lane never grades piano.

**Tests/evidence:** all 1,309 raw transcript segments are mutation-negative except reviewed explicit
self-reports; ~48 semantic fixtures; ≥25 ASR corruptions; four complete state replays; hot-loop
latency; packaged short-clip STT report.

**Failure/rollback:** provider unavailable still leaves Lane A complete. Unknown draft operation /
field rejects the whole draft. User correction wins.

**Review gate:** fresh firewall/authorization reviewer; V1–V4, with human Steinway row left open.

## V2.9 — Concise durable Brain and typed tools

**Files/modules:** `brain/thread.rs`, `brain/tools.rs`, context/corpus/provider/policy; frontend Brain
drawer; schema-v8 thread rows; add Gieseking/Leimer to the exact manifest and update every
three-book claim/test.

**Work:** one-glance answer shape (hypothesis / action / dose / stop / sources), disclosures for
detail; selected mapping/XML + reported symptom + effective ledger/retention + Goals + four-book
retrieval; bounded per-piece durable threads with explicit clear; tools may produce only Lane-B
ActionDrafts and can never record verdicts/write directly/control live tempo.

**Tests/evidence:** real four-book retrieval, real score context, concise snapshot/length policy,
relaunch/clear/privacy, stale/wrong-ID/unknown-field/cross-piece tool rejection, confirmation/
rollback/audit/undo, provider-off offline librarian behavior.

**Failure/rollback:** unsafe/uncited output falls back; tool parsing is all-or-nothing; secrets stay
Keychain-only; clear deletes conversation but not applied-action audit or practice history.

**Review gate:** security/privacy/music-grounding reviewer; B1–B4.

## V2.10 — Handcrafted shell and complete interface transformation

**Files/modules:** `src/app/`, shell/workspace navigation, all feature CSS, font assets/tokens,
Receipt Center, Atlas/Ledger/Calendar/Brain responsive composition.

**Work:** Today/Atlas/Ledger/Calendar/Universe navigation; explicit global piece/target/set context;
Cloud Dancer/ink/deep-terracotta operational palette; editorial serif + structured utility face;
asymmetrical negative space, matte filled controls, tactile hover/press/focus; one staggered reveal;
no ambient loop/purple/glass/generic cards. Color mainly in marks/Universe. Active set survives
workspace switches; heavy hidden routes suspend.

**Tests/evidence:** token audit rejects banned fonts/purple gradients; before/after packaged native
screenshots; 720×520 and wide, 75/90/100/125%, light/dark, keyboard, screen reader, contrast,
reduced motion, focus restoration, failure/empty/loading/dense states; interaction video or timed
capture for micro-motion.

**Failure/rollback:** no design dependency without approval; preserve deterministic audio/STT/PDF
boundaries. Visual completion cannot hide a red semantic acceptance row.

**Review gate:** independent visual/accessibility reviewer compares against Christian's exact laws;
X1–X3.

## V2.11 — Earned zoomable Practice Universe

**Files/modules:** Rust effective-ledger Universe metrics/trace; frontend bounded graph viewport +
text-equivalent list.

**Work:** stable-ID layout; pan/zoom/focus/reset; piece systems with session stars and target bodies;
direct entity navigation; growth traces focused time, active days, coverage, satisfied non-legacy
contracts, recovery, retention. Raw clean clicks/same-second bursts/Calendar/legacy done cannot buy
mastery beauty. Errors stay honest and gain positive meaning only through later recovery/retention.

**Tests/evidence:** anti-gaming invariants; stable layout; dense long-term fixture/performance;
keyboard/screen-reader/text parity/reduced motion; direct Atlas/Ledger navigation; packaged visual QA.

**Failure/rollback:** read-only projection only; no Universe action mutates practice state.

**Review gate:** metrics honesty + visual/accessibility reviewer; U1–U2.

## V2.12 — Complete release, install, and handoff

**Work:**

1. Close every non-human acceptance row with named evidence; fresh verifier tests the exact tree.
2. Run frontend, Rust, integration/property/replay/real-corpus/real-score/migration, strict clippy,
   build, packaged-native visual/accessibility/performance/security gates.
3. Bump package/Cargo/Tauri to 2.0.0; update tutorial to the installed behavior; create immutable
   v2 version record/release gate; complete every vault living doc and repo status.
4. Create a fresh live backup; run rollback-safe release script; install/seal/DMG/checksum/one-copy
   audit; launch/relaunch; verify schema/counts/integrity/FKs and representative history.
5. Commit descriptive release state and tag `v2.0.0`. Never move a published tag.

**Failure/rollback:** a failed migration/install restores the paired v1.3 app + pre-v2 database;
never run v1.3 against schema v8. No “shipped” wording while a release-blocking matrix row is open.

**Human boundary:** Christian's complete Steinway run follows the packaged build. If not yet done,
release docs state that voice-over-piano proof remains pending.

### Next action

Continue **V2.4** through the existing authoritative path: durable command/receipt identity →
pause/resume and active-time checkpoints → safety stop → accepted recovery actions → cold
retention → exact deterministic voice commands/replay. Re-run semantic/rollback and real-copy gates
after the additive migration. Do not begin the visual shell or Universe before this practice-loop
gate is green.
