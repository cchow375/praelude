# CodaKiller v7.1.0 — Version Record

**Shipped:** 2026-08-26  
**Tag / release commit:** `v7.1.0` / `bfd32e31142e2b317682c18faba4f9d4fb197e53`  
**Installed:** `/Applications/CodaKiller.app`  
**Rollback preserved:** `~/Library/CodaKiller-rollbacks/CodaKiller-v7.0.1-rollback.app.tar.gz`
(9.4 MB) — SHA-256 `2f3a1f47d18a37d42e68029b68459fa83ba9e63ac4acc8f8a76f03b10a124406`  
**Pre-install backup:** `(C) pre-v7.1.0-install-2026-08-26-165708.db` (20 MB) — SHA-256
`aba07f4d6f0d71d0920a2c4277160758ffcecce9012178a08160016975c44fbc`  
**DMG:** `releases/v7.1.0/CodaKiller-7.1.0.dmg` (10.7 MB) — SHA-256
`f5c2c9365e51c6d6d3af26fc698ae973576b852cfde94244c0cfe9e6e87852eb`  
**Database schema:** 15 → 16 (`rep_block.tuning_json`)

## What this release is

v7.1.0, "Practice Set Core," is P1 of the approved Aug 8 overhaul train. It rebuilt the
practice set around what matters at the piano: a tempo ladder that can move down as well as up,
ordered variant stages, an uncluttered composer, verdict hotkeys and immediate rep adjustment.
It also finally closed B56, the long-running session-end race, at the API boundary instead of
merely narrowing one interleaving.

It is also the release whose first real use immediately proved that green gates and screenshots
had not covered the actual interaction. Christian rejected the sub-section workflow, found the
variant-chain completion contract wrong, and asked for spoken acknowledgements to be shut off.
Those defects are B85–B87. This record keeps both truths: the core work genuinely shipped, and a
meaningful part of the user-facing result was not acceptable.

## What shipped

**A1 — tempo demotion.** A run of three consecutive sloppy verdicts pulls an automatic tempo
ladder back one rung; after the first demotion, each subsequent run of two sloppy verdicts pulls
it back again. Only sloppy counts — `Again` does not — and the set can re-climb through the
normal clean-streak rule. The engine resolves this from durable attempt history, so pause,
resume and relaunch do not launder a failed run. The HUD renders the resulting "Tempo pulled
back" state instead of leaving the backend event invisible.

**A2 — variant-chain engine.** A practice set can store an ordered sequence such as dotted,
reverse dotted and staccato. Each stage has its own consecutive-clean target; a flawed attempt
resets the current stage without erasing completed stages. Stage state is replayed from the
durable verdict ledger rather than held in fragile frontend memory.

**A3 — composer hierarchy.** Practice focus, variant chain and clean-streak target are visible
without opening a disclosure. Tempo-ladder mechanics, attempt-review boundary and one-pass
estimate move into one bottom **Advanced** section. Preset variants, custom variants, reordering
and per-variant rep targets are available in the composer. This directly follows Christian's
feedback that variants were important while the ladder controls were taking far too much room.

**A6 — verdict hotkeys.** Space records clean, Right-Shift records sloppy and Return records
again. Ownership guards keep them out of text inputs, dialogs and surfaces that do not own the
active set.

**A7 — lower-friction rep adjustment.** `+ clean` and `undo last` sit beside the count in the
running set, with the same receipt/ledger path as the existing verdict actions. The associated
devMock handlers added during this task closed the last then-known B80 violation, but did **not**
close the broader B84 mock-coverage problem described below.

**B56 — session-end race closed.** All 14 rep mutation paths and both retention mutation paths
now resolve their session while holding the lifecycle lock. The unsafe store entry point is
`#[cfg(test)]`, so production code cannot accidentally bypass the lock later. This closes the
smaller opener-side window deliberately left open in v7.0.1.

**Schema v16 and A5's data foundation.** `rep_block.tuning_json TEXT NOT NULL DEFAULT '{}'`
stores per-set metronome tuning without widening the table again. The Rust/wire model supports
beat unit, subdivision and beats per bar. Beat unit is deliberately a **label, never a BPM
conversion**: the entered BPM remains the click rate.

## Important shipped-scope correction

Two configuration surfaces were **backend-only in the installed v7.1.0 app**:

- A1's global `rep.demote_enabled`, `rep.demote_first` and `rep.demote_repeat` settings, plus
  per-set override fields, existed in Rust and the wire model. The defaults powered the shipped
  behavior, but Settings and the set composer exposed no controls for them.
- A5's tuning object and schema shipped, but the composer exposed no beat-unit, subdivision or
  beats-per-bar controls and did not send a tuning payload. The user therefore remained on the
  default quarter-note label in normal use.

Calling either one a finished user-facing control in v7.1.0 would overstate what was installed.
The later v7.2 corrective work may surface them, but this record does **not** claim that release
has shipped.

## Verification

Gates at ship: **vitest 2,383 passed / 1 skipped / 0 failed**; **cargo 994 passed / 0 failed**
with `filtered out: 0` on every target; clippy `--all-targets --all-features -D warnings` clean;
`tsc --noEmit` clean; production build clean; all five narrated corpus suites produced **zero
false mutations**; all eight release-script gates passed.

The v15→v16 migration was rehearsed through `CODAKILLER_MIGRATION_COPY` on a copy of the live
database before installation. The copy reached schema 16 with integrity OK; all 208 existing
blocks received `{}` exactly as designed. The installed database was checked again after
installation. Counts were identical before and after: **10 pieces / 208 rep_blocks / 1,915 reps
/ 43 sessions**.

The installed bundle reported 7.1.0, `codesign --verify --deep --strict` passed, and the DMG
matched the checksum above. The five retained 720×520 screenshots covered the demotion context,
the composer with variants visible and Advanced expanded, the hotkey hint, and the rep-adjustment
controls.

## Christian's immediate verdict — B85, B86 and B87

**B85 — the micro-target/sub-section workflow was unusable.** Creating the intended tiny box
inside an existing section took six steps and, on an unmapped score, two typed measure fields:
select a parent, drag, type a name, type the range, create, then drag **again** to make the box.
The first drag merely opened the legacy region form; `region_create` persisted a child with no
`pdf_anchor`, then deliberately entered a second mapping mode. The result did not match the
requested gesture of selecting a parent and drawing one small persistent box with no naming or
measure-entry ceremony. The exact at-piano verdict was: _"the sub section selecgtion box is
terrible. you didnt listen to what i wanted."_

**B86 — variant chains mastered too early and finished sets stayed open.** With the target-tempo
flow Christian actually uses, the chain-aware mastery rule was bypassed, so completing the first
variant could mark the whole set mastered. The HUD could then sit at 5/5 instead of progressing
through every variant. Separately, neither chained nor ordinary completed sets had the requested
short completion pause followed by automatic close; he had to close them manually.

**B87 — spoken acknowledgements had no practical off switch.** `Again`, restart and similar
deterministic practice actions could speak a phrase when Christian wanted the app quiet. The
desired interim behavior was a restrained chime with spoken acknowledgements off.

These are not minor polish notes. B85 breaks the defining P2 gesture, B86 breaks the mastery
contract that makes A2 trustworthy, and B87 adds friction directly in the hands-free loop. They
became the corrective target immediately after v7.1.0; they were **not fixed in this release**.

## Honest gaps

- **B84 remained broad.** At ship, 15 frontend commands still had no faithful devMock handler:
  `rep_close`, `rep_correct`, `rep_update`, `rep_delete`, `rep_restart`, `rep_reflect`,
  `rep_recovery`, `rep_safety_stop`, `rep_adjustment_reverse`, `session_end`,
  `session_plan_start`, `retention_confirm`, `retention_lower`, `retention_reopen` and
  `retention_snooze`. Follow-up on B85 also found `region_update` missing; that made the browser
  mock fail to retain a score anchor and concealed the same visible symptom. Adding that one
  handler does not close B84. No enforced frontend-command ↔ devMock registry gate existed.
- **The retained screenshots did not test Christian's actual failures.** None proved that one
  parent-scoped drag created and retained a visible child box; none drove a target-tempo set
  through every variant and the final delayed close; none assessed spoken acknowledgements at
  the piano.
- **No considered at-piano acceptance verdict preceded shipment.** The first real-use verdict
  arrived immediately afterwards and rejected B85–B87.
- **A1 settings and A5 beat-unit controls were not in the UI**, despite their backend models
  shipping.
- **B75 stayed open:** live `measure_map` still contained zero rows. That is why B85's fallback
  asked for typed measures in the first place.
- **B67 stayed open:** no Anthropic key was present, so the Claude vision path remained untested
  on real data.
- The broader Universe layout/overlap complaint, legacy score-overlay consistency and remaining
  dock residuals were not addressed by Practice Set Core.

## Next steps

1. Correct B85 with the requested direct gesture: select an anchored parent, draw one contained
   box, persist parent + geometry atomically, show it only in the parent's context, and start
   practice from it without a second mapping pass.
2. Correct B86 so **every** variant must clear before mastery, variant attribution follows the
   current chain stage after sloppy/again attempts, and final completion remains visible briefly
   before closing automatically.
3. Correct B87 by making spoken deterministic acknowledgements opt-in/off by default while
   preserving the short nonverbal cue.
4. Expose the already-shipped A1 settings and A5 tuning fields through honest, compact composer
   and Settings controls; do not call the backend plumbing a finished UI.
5. Reduce B84 with faithful stateful handlers and add an enforced capability/coverage gate rather
   than another prose promise.
6. Re-run 720×520 browser QA on the exact workflows above, then obtain Christian's at-piano
   acceptance before treating the corrective v7.2 work as shipped.
