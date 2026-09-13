# CodaKiller v7.2.0 — Version Record

**Status:** SHIPPED + INSTALLED 2026-08-27  
**Release boundary:** one corrective release atop v7.1.0  
**Tag / release commit:** `v7.2.0` / `7a5061d57fc6197b53e2601ca788f186d1fc7c83`  
**Repository:** tag pushed; private-remote `main` through docs finalization `768a151752be54272a81962b4489c968ba48d559`  
**Installed:** `/Applications/CodaKiller.app`; plist version 7.2.0 and bundle identifier verified  
**DMG:** `releases/v7.2.0/CodaKiller-7.2.0.dmg` — 10,739,055 bytes — SHA-256 `532868f089241e64d134b2fb3b645f2ddf7db8df838d8706d3a39d7d5b7dc77f`  
**Database schema:** 16 → 16; no migration or migration rehearsal

> This record is now immutable except for factual corrections. Do not infer native interaction or at-piano acceptance
> from packaging, launch verification or browser/mock QA.

## What this release is

v7.2.0 is the single corrective release prompted by Christian's first real use of v7.1.0. It
does not open a new product direction. It makes three promised workflows true in the app:
isolating a tiny persistent score spot without typing, finishing a practice set without manual
cleanup, and keeping deterministic voice acknowledgements quiet by default. It also completes
two v7.1 user-facing surfaces that had shipped only as backend/wire capability, unifies the score
overlay path, and teaches the earned-only Universe when evidence is sparse.

The release is packaged and installed. Identity, signing, launch, checksum and database
preservation are verified. Christian's native interaction / at-piano acceptance remains pending.

## What shipped

### B85 — direct, atomic, persistent child spots

The actual flow is:

1. Select an **anchored top-level section**.
2. Click **Isolate a spot** in that section.
3. Drag one box fully inside one of the parent's boxes.
4. On pointer-up, the spot already exists. There is no form or dialog.

The dedicated `score_micro_target_create` command writes the child Region, explicit parent link,
calm colour, estimated measure range, and current edition/fingerprint anchor in **one SQLite
transaction**. Rust independently revalidates same-piece ownership, one-level nesting, contained
measures, matching edition/fingerprint and full geometry containment. Injected-failure tests prove
that an anchorless orphan cannot survive. A same-tick pending guard prevents duplicate `Spot 1`
rows.

Names are automatic (`Spot 1`, `Spot 2`, …, monotonically numbered per parent). Measures come
from the applied map when available; otherwise they are interpolated from the drag's position in
the parent's own measure range and anchor geometry. That fallback is essential because the live
database still has zero measure-map rows (B75). An eight-second Undo removes an accidental spot.

Spots render only when their parent or the spot itself is selected. Each parent has a persisted
**Hide spots** toggle. **Practice this** on the spot resumes its latest paused set when present;
otherwise it starts a contextual three-clean set immediately. If another set is active, the app
explains the conflict and performs no mutation. The list row still opens the prefilled composer
for customization. Before choosing a paused set, the direct action refreshes the block list and
matches the exact `region_id`; siblings with the same inferred measure range cannot cross-resume.
The already-running explanation remains generic. The **Practice this** chip is absent whenever
target drawing, measure mapping, Pencil, spot drawing or an in-flight save owns the score pointer.

Legacy recovery is conservative. An old unparented Region is inferred as a child only when its
measure range is strictly contained, both anchors match the current edition/fingerprint, every
child-rect centre lies in a candidate parent's geometry, and exactly one candidate qualifies.
Explicit parent linkage wins; ambiguity remains top-level; inferred children cannot become
inferred parents. This is read-model compatibility, not a silent live-database rewrite.

### B86 — variant chains and sets finish coherently

A non-empty variant chain is now the mastery contract for every focus, with or without target
tempo. Completing stage one cannot satisfy the whole set. The HUD promotes the current stage's
name and consecutive-clean counter so the intended `5/5 → 0/5, staccato` transition is visible.
Flawed resets only the current stage's clean streak; Failed/Again neither advances nor resets it.
Attempt attribution uses the same projected stage, so the durable ledger cannot label a Sloppy or
Again attempt as a later variant merely because total tries increased.

Recovery, correction, reversal and undo all replay the same durable chain projection. Legacy
variant payloads without `clean_streak` continue to use `reps` as their per-stage requirement.
No-chain sets preserve the ordinary consecutive-clean contract.

When either an ordinary or chained set becomes mastered, the HUD shows a six-second completion
countdown and **Stay open**. A new attempt, pause, manual close or Stay open cancels it. Otherwise
the existing close path runs once. If that auto-close rejects transiently, it retries exactly
once; a second failure is terminal for that sequence, so it cannot loop or re-arm forever.
Recovery synchronously cancels the pending auto-close before its IPC begins, and the timer
rechecks live eligibility before invoking close. The intermediate-stage chime fires only when a
new Clean produces a genuine forward transition—including a one-clean opening stage. Undo, final
mastery and extra Clean attempts do not replay it.

### B87 — speech is opt-in; the chime remains

Settings now exposes **Speak confirmations aloud**, default **off**. Deterministic practice
acknowledgements fall back to the existing short chime instead of speaking. The setting applies
immediately, and `voice_speak` respects the same switch. Voice input, command routing and the
half-duplex gate are unchanged. The Assistant remains switched off and gated independently.

### v7.1 surface correction

- Settings exposes global tempo-demotion enable/first/repeat controls using the native defaults
  and ranges: enabled; first demotion after 3 Sloppy reps (range 2–10); later demotions after 2
  (range 1–10). Save applies through the existing settings path.
- The set composer's **Advanced** section exposes beat-unit label, beats per bar and subdivision
  (both 1–16). Beat unit is a label for the entered click rate, never a BPM conversion. Opening a
  set sends and rehydrates its tuning, including a same-BPM retune when the running click differs.
- Each newly composed variant visibly asks for **Consecutive cleans** and submits explicit
  `clean_streak`, while retaining `reps` compatibility for older payloads.

This corrects v7.1's user-facing overclaim. It does **not** add a per-set demotion override or a
quick subdivision control to the running Rep HUD.

### B3 — one score-overlay path

Each page now mounts one memoized `ScoreOverlay` for persisted parent/spot Regions, measure-map /
create state and the atlas target draft. Old and new pieces use the same DOM, pointer behavior and
shared styling without a migration. Parity tests render parent/child Regions beside an atlas draft
through that exact path, and render-count tests guard unchanged-prop repaints.

### E3 — low-data Universe teaching

When zero, one or two star systems have earned evidence, a compact strip teaches what real focused
practice, mastered sections and active streaks will add. It disappears once three evidenced
systems exist. It grants no star, body, ring, glow, streak or progress and therefore preserves the
earned-only law.

## Verification at ship

- Frontend: **2,499 passed / 1 skipped / 0 failed**.
- Native: **1,049 passed / 19 ignored / 0 failed**.
- `tsc --noEmit` and the production build clean.
- `cargo clippy --all-targets --all-features -- -D warnings` clean.
- All five narrated voice corpora: **zero false mutations**.
- All eight release-script gates: **PASS**.
- 720×520 browser-devMock QA passed for isolate/persist/undo/direct-practice, chain progression /
  auto-close, speech-off, overlay parity and low-data Universe teaching.

The installed plist reports 7.2.0 with the correct bundle identifier, strict code-signature
verification passed, the DMG checksum verified, and a fresh installed-app process launched. The
live database was identical before and after install/launch: schema 16, integrity OK, **10 pieces /
228 blocks / 2,026 reps / 44 sessions / 0 open sessions**. There was no migration and therefore
no migration rehearsal.

Pre-install database backup: `(C) pre-v7.2.0-install-2026-08-27-014755.db`, **21,663,744 bytes**,
SHA-256 `dfafa80a6e58dd917b7a27e8692a8e55e3b81d1599399dcaada507c1e0a81820`. The preserved v7.1
rollback archive is **9,872,086 bytes**, SHA-256
`a63bbf1ef3f1a48e5e1c683bb0b0540fe98bc5a77fca05a96041d08a3c522f85`.

The 720×520 interaction evidence remains browser/mock evidence. Launching the signed installed
app proves the release opens; it does not prove the new interactions natively or at the piano.

## Honest gaps at the release boundary

- **Native interaction and at-piano acceptance are pending.** Christian has not yet judged these
  flows in the packaged app at the Steinway.
- **B88 — partial A1/A5 surfaces:** no per-set demotion override and no running-HUD quick
  subdivision control. Global demotion Settings and Composer ▸ Advanced are the available paths.
- **B89 — bounded replay edge:** `score_micro_target_create` is all-or-nothing within SQLite but
  has no durable replay identity. The same-tick UI guard stops normal duplicates; a commit followed
  by a lost IPC response and manual retry could create another spot. No occurrence was observed.
- **Assistant remains off**; its separate overhaul remains on hold.
- **B67:** no Anthropic key; Claude vision remains unexercised on real data.
- **B75:** live `measure_map` remains at zero rows. The B85 fallback now works without a map, but
  that does not prove or close mapping.
- **B78** and the other recorded dock/minor residuals remain open.
- The devMock is a bounded QA backend, not a full native substitute; live data, CoreAudio, macOS
  speech recognition and packaged WebKit still need their own checks.

## Next steps

1. Run the exact B85/B86/B87 workflow natively at 720×520, then obtain Christian's at-piano
   acceptance and record his verdict verbatim.
2. Keep B67/B75/B78/B88/B89 open until direct evidence closes them. B89 does not reopen B85's
   corrected ordinary flow.
