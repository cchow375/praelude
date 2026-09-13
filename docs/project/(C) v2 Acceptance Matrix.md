# CodaKiller v2 — Acceptance Matrix

> [!warning] HISTORICAL — the v2.0.0 gate, and v2.0.0 never shipped (banner added 2026-08-20)
> This matrix gated a release that **was never installed**: v2.0.0's backend work was absorbed
> into the v3.0.0 frontend rework (2026-07-16) and the version was retired. The matrix was never
> completed or formally closed out, and its evidence cells were never brought up to date.
> **Installed current truth: v8.2.0 / schema 20 (2026-08-27).** The 23-ask Aug 8 train and new
> evidence-based Universe are shipped; current evidence work is packaged microphone/Steinway,
> native Score acceptance, one real provider mapping and sustained motivation—not completion of this matrix. Kept as a
> record of what was being demanded of v2 and
> of the evidence-before-claims standard it set — not as a live gate. Current status lives in
> [[(C) Roadmap]] and [[(C) Flaws]].

> **Status:** implementation gate · **2026-07-15**  
> Nothing in this matrix counts as shipped until its evidence cell points to a passing automated,
> native, or human result. Source vision: [[(C) v2 Transformation Brief]].
> **State key:** ⬜ no row-level proof yet · 🟨 a named source-level slice passes but required
> integration/native/release evidence remains · 🟩 the evidence named by that row passes. A green
> source row does not mean the whole release is shipped.

| ID | User-visible contract | Required evidence | State |
|---|---|---|---|
| D1 | Existing v1.3 data survives v2 exactly | Real-backup migration counts + checksums/integrity/FKs + spot checks | 🟨 Disposable real-backup v7→v9 migration preserves all legacy counts/content hashes, integrity/FKs, and idempotent reopen; installed/live migration still pending |
| D2 | Invalid ranges, duplicates, abandoned blocks, and overruns are visible and never silently rewritten | Migration/anomaly report + fixtures from live snapshot | 🟨 Deterministic 792-row sidecar projection passes; no anomaly UI/correction workflow yet |
| D3 | Every write has source, timestamp, audit trail, and a visible success/failure receipt | Rust transaction tests + UI failure injection + packaged smoke | 🟨 Practice provenance/events plus expanded React failure/receipt paths pass; durable outer receipt IDs/idempotency, all backend writes, and packaged smoke remain |
| P1 | A set finishes by its mastery contract, not total attempts | Unit/property tests including 0%-clean and 50%-clean histories | 🟩 Contract evaluator and transactional RepEngine/store/IPC projection prove 0%-clean and 50%-clean cannot master; only the captured success contract can |
| P2 | Default consecutive-clean target is configurable; flawed/failed resets exactly as displayed | Engine/state/UI/voice tests | 🟨 Engine/store/IPC/Settings/form/HUD reset and configurable-default tests pass; exact deterministic voice reset/status fixture remains |
| P3 | Undo/correct last verdict and restart set preserve history through compensating events | Transaction rollback + relaunch + history drill-in | 🟩 Append-only void/correct/reverse/restart transactions, rollback/relaunch/terminal-lineage tests, immutable history, and UI drill-in pass |
| P4 | Recovery can step back/narrow/slow/add clean debt without shame or arbitrary point loss | Protocol fixtures + source rationale + UI copy review | 🟨 Pure adaptive-recovery activation-after-error passes; full recovery transaction and user copy remain |
| P5 | Focus loop records intention, short set, self-report, and break/strategy switch | Timer/state/relaunch/reduced-motion tests | ⬜ planned |
| P6 | Next-day retention can confirm, lower, or reopen a target | Clock-controlled cross-day tests + Calendar/composer integration | ⬜ planned |
| S1 | Dragging a score selection creates a target draft without typing measures | Packaged real-PDF native interaction | ⬜ planned |
| S2 | Compatible MusicXML selection resolves exact measures and score facts | Real Scherzo/Griffes fixture tests | ⬜ planned |
| S3 | Scanned/mismatched editions use calibration + visible confidence/correction, never fabricated precision | Low-confidence/adversarial edition fixtures | ⬜ planned |
| S4 | Targets nest/overlap, retain aesthetic marks/notes, and resume from the mark in one action | CRUD/geometry/history tests + native QA | ⬜ planned |
| H1 | Hundreds of sets remain navigable without an endless page | Dense generated fixture + filters/disclosure/virtualization + 720×520 QA | ⬜ planned |
| H2 | Session/target summaries expose tries, cleans, current/best streak, accuracy, tempo path, focus, and retention | Exact aggregate/property tests | 🟨 Authoritative set/HUD/history projections expose attempts, tries, verdicts, streaks, resets, accuracy, tempo/focus and corrections; session/target retention summaries remain |
| H3 | Titles and notes are editable everywhere through one canonical record | Cross-surface/stale-load regression tests | ⬜ planned |
| V1 | Clean/flawed/failed, status, undo, restart, pause/resume, close, tempo, and metronome are deterministic and terse | Intent matrix + latency/state tests | 🟨 Shared Rust verdict/status/close path and UI undo/correct/restart plus tempo/metronome race tests pass; voice undo/restart and pause/resume matrix remain |
| V2 | Natural range/hands/method/reps requests become validated previews and need confirmation when ambiguous | Parser/draft/confirmation/undo tests | ⬜ planned |
| V3 | Ambient speech, conversational negatives, piano, page turns, and phone audio cannot log a verdict/action | Narrated-recording replay corpus + adversarial transcripts | 🟨 First narrated fixture rejects colon timestamps, conversational negatives, and ambient “again…” while preserving explicit verdicts; complete replay/audio/native proof remains |
| V4 | Missed “done” has a clear recovery path without duplicate rapid-rep suppression | Real recording + dedup/ack tests + at-piano checklist | ⬜ planned |
| B1 | Default Brain response fits one glance: hypothesis, action, dose, stop condition, sources | Snapshot/policy tests + native narrow drawer QA | ⬜ planned |
| B2 | Brain joins selected measures/XML, reported symptom, complete supported corpus, ledger, and retention history | Context receipt + real-corpus integration | 🟨 Source corpus now validates all four available books and real-corpus retrieval passes; combined ledger/retention context and installed UI remain |
| B3 | Per-piece conversation memory survives relaunch and can be cleared | Schema/privacy/relaunch tests | ⬜ planned |
| B4 | Typed Brain actions are allowlisted, previewed, validated, confirmed, audited, and undoable | Authorization/property/failure-injection tests | ⬜ planned |
| C1 | A 20-minute routine is generated from due retention/goals/unresolved targets and remains fully editable | Deterministic composer fixtures + no-write-before-start test | ⬜ planned |
| U1 | Universe pans/zooms, opens real ledger objects, and scales to dense long-term data | Interaction/performance/keyboard/text-equivalent tests | ⬜ planned |
| U2 | Growth reflects time, days, coverage, mastery, recovery, and retention—not raw clean clicks alone | Metric invariants + anti-gaming fixtures | ⬜ planned |
| X1 | New shell is visibly unrelated to v1's purple symmetric dashboard and follows the locked design language | Before/after native screenshots + token audit | ⬜ planned |
| X2 | One restrained reveal, fast physical micro-responses, no ambient loops, and full reduced-motion parity | Motion audit + screenshots/video + automated preference test | ⬜ planned |
| X3 | Primary flows work at 720×520, keyboard-only, screen reader, 75–125% scale, and dark/light contrast | Accessibility/native matrix | ⬜ planned |
| R1 | Full frontend/Rust/build/clippy/real-data/native/fresh-verifier gates pass before install | Release gate record | 🟨 Semantic source gate passes (283 frontend; Rust 406/10 ignored plus focused suites; build/check/clippy; v7→v9 real-copy proof; earlier corpus/XML/replay gates; fresh review); complete v2/native/release gates remain |
| R2 | Installed v2 relaunches with one app copy and preserved live data; version/tag/docs agree | Release script + installed smoke + git audit | ⬜ planned |

## Evidence policy

- **Automated** proves deterministic behavior, migration safety, security boundaries, and dense
  fixtures.
- **Packaged-native** proves WKWebView rendering, actual PDF pixels, window geometry, interaction,
  and the installed Tauri boundary.
- **Narrated replay** proves speech/state-machine usefulness only; it never becomes a piano-grading
  benchmark.
- **Human at-piano** proves Christian can use it over his Steinway. Until he completes that pass,
  voice-over-piano reliability remains an honest open risk even if every automated gate passes.

## Foundation evidence recorded 2026-07-15

- **Migration rehearsal:** a disposable copy of `(C) pre-v2.0.0-feedback-2026-07-15-163528.db`
  migrated v7→v8 and reopened idempotently; quick/integrity checks passed; foreign-key violations
  stayed at zero; legacy-column content stayed exact. Preserved counts: piece 6, Region 27,
  rep_block 48, rep 481, session 8, session_event 628, event 670, Goal 21, daily_work 11. The live
  database was not opened or migrated.
- **Anomaly projection:** exactly 792 append-only rows—23 abandoned, 11 overruns, 30 duplicate-
  candidate pairs, 13 empty blocks, 670 incomplete legacy event-provenance facts, 43 same-second
  bursts, one nonpositive Region range (Region 24, `0–0`), and one reversed set range (set 45,
  `452–449`). These are disclosures, not automatic repairs.
- **Source suites:** frontend 39 files / 236 tests; Rust library 376 passed / 9 ignored plus
  knowledge 9, narrated firewall 2, STT 9, and TTS gate 4 (two live-TTS tests intentionally
  ignored); strict clippy and production build; real four-book corpus, Scherzo MusicXML, and
  Griffes XML gates. Fresh adversarial reviews found and fixed ordering, linking, recovery,
  async-state, receipt, and firewall defects before this evidence was recorded.
- **Boundary at that checkpoint:** source had schema-v8 sidecars, pure protocol/ledger semantics,
  initial global receipts/firewall, and four-book retrieval; RepEngine wiring was still open.

## Practice-truth cutover evidence recorded 2026-07-15

- **Final-source rehearsal:** disposable preserved-backup copies migrate v7→v9 and reopen
  idempotently with the same nine legacy table counts/content hashes, `integrity_check=ok`, zero
  foreign-key violations, 27 target metadata rows, 48 contracts, 481 provenance rows, 628
  reconciled session-ledger rows, and the same 792 review-only anomalies. The source backup SHA-256
  remains `4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`.
- **Practice semantics:** schema 9's partial unique index rejects a second active/paused native set;
  malformed two-live recovery makes both state and open fail visibly. RepEngine/store transaction
  tests cover 0%/50% non-mastery, fifth consecutive clean, reset/recovery, target overshoot,
  nullable non-tempo BPM, exact legacy sentinels, append-only adjustment chains, terminal lineage,
  restart, relaunch, rollback, and void filtering across projections.
- **Source suites:** frontend 39 files / 283 tests plus build; Rust library 406 passed / 10 ignored,
  RepEngine 47, metrics 11, planner 6, export 4, `cargo check --tests`, strict clippy, and diff
  checks. Multiple fresh-context reviews found and fixed integrity, race, metronome-ownership,
  stale-history, receipt, recovery, and accessibility defects.
- **Current release boundary:** practice truth is authoritative end-to-end in source. Durable outer
  receipts/idempotency, pause/focus/safety/recovery/retention, complete voice/replay, later product
  systems, native package proof, installed v2, live migration, and human Steinway acceptance remain.

### Next steps

Attach test names and evidence links to each row as implementation lands. A green suite does not
implicitly close a row whose required native or human proof is still missing.
