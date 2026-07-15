# CodaKiller v2 — Practice-Truth Cutover Gate

> **State:** PASS in source · **not installed**  
> **Date:** 2026-07-15 · **Schema:** 9 · **Release target:** v2.0.0 / P7  
> **Boundary:** `/Applications/CodaKiller.app` remains v1.3.0 and Christian's live database remains
> schema 7. Every migration run used a disposable copy of the preserved backup.

## What this gate proves

One Rust-owned projection now defines a PracticeSet from immutable attempts, the captured
PracticeContract, provenance, and append-only adjustments. RepEngine, store/IPC, React HUD/history,
metrics, planner, export, Brain context, and the current voice verdict adapter consume that same
projection.

- A planned attempt count is a review boundary, never mastery.
- Configurable consecutive-clean mastery defaults to five; flawed/failed reset as captured.
- Tempo proof requires clean evidence at or above the target. Metronome-on non-tempo work may keep
  factual BPM but cannot ladder/master tempo.
- Undo, correction, reversal, and restart preserve original attempt rows and exact terminal lineage.
- Relaunch restores one live set; malformed multiple-live state is a visible recovery failure.
- Voided attempts stay inspectable but leave effective metrics, plans, exports, and Brain context.
- Historical set metadata is immutable. Historical attempt “delete” appends a void adjustment.

## Real-backup rehearsal

Source backup SHA-256:
`4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`.

An independent verifier copied that schema-7 database, ran the production 7→9 migration twice,
and queried the result directly:

| Evidence | Result |
|---|---:|
| piece / region / rep_block / rep | 6 / 27 / 48 / 481 |
| session / session_event / event | 8 / 628 / 670 |
| goal / daily_work | 21 / 11 |
| target_meta / set_contract / attempt_provenance / reconciled ledger | 27 / 48 / 481 / 628 |
| review-only anomalies | 792 |
| integrity / foreign-key violations | `ok` / 0 |

All nine legacy source-table row counts and SHA3 content hashes remained exact. The 792 findings
remain disclosures: 670 incomplete provenance, 43 same-second bursts, 30 duplicate candidates, 23
abandoned sets, 13 empty sets, 11 overruns, Region 24 at `0–0`, and set 45 at `452–449`.

All 127 physical `bpm=0.0` rows remained exact. They project as `None` only because each belongs to
a metronome-free non-tempo legacy set. Negative/missing/nonfinite BPM, tempo-zero BPM, and
metronome-on zero BPM reject without rewriting the source row. The schema-9 unique index directly
rejected a second native live set; a deliberately malformed disposable fixture made both
`RepEngine::state()` and `open()` return the recovery error and create no row.

## Exact automated gates

- Frontend: **39 files / 283 tests**, production build, diff check.
- Rust library: **406 passed / 10 intentionally ignored**.
- Focused Rust: RepEngine **47/47**, metrics **11/11**, planner **6/6**, export **4/4**.
- `cargo check --tests` and strict `cargo clippy --all-targets -- -D warnings`.
- Earlier unchanged integration gates remain green: four-book corpus, narrated firewall, STT/TTS,
  Scherzo MusicXML, and Griffes MusicXML.

Two independent fresh-context reviewers found no remaining P0–P2 issue in the scoped Rust/React
cutover. They drove fixes for note tri-state, tempo reversal/relaunch, terminal lineage, sentinel
decoding, void filtering, delayed state resurrection, manual-metronome ownership/readiness,
concurrent verdicts, closed-HUD fallback, snap-null recovery, stale/partial history, missing-region
evidence, internal-ID leakage, failed note drafts, and keyboard/focus lifecycles.

## Explicitly not proved here

- Durable outer `MutationReceipt` IDs, idempotent caller command identity, and all-write undo.
- Pause-aware active time, focus context, pain/safety stop, explicit recovery actions, and cold
  retention checks.
- Complete deterministic voice correction/restart/pause delivery, 1,309-segment replay, or live
  recognition over Christian's Steinway.
- Score Atlas, scalable Ledger/Composer, durable concise Brain/tools, the new shell, or Universe.
- Packaged-native behavior, installed migration, v2.0.0 tag, or human acceptance.

## Next gate

Add command identity/receipts, pause/resume active-time checkpoints, safety stop, accepted recovery,
cold retention, and their deterministic voice commands through the same transaction boundary.
Repeat this real-copy gate after the additive migration and again immediately before packaging.
