# v7.2.0 QA record — 720×520 browser evidence + release checks

These screenshots were captured against `npm run dev:mock` at exactly **720×520**, the configured
minimum window size, from the source candidate that shipped and was installed as v7.2.0 on
2026-08-27. They are evidence for layout, discoverability and the browser interaction model. They
do not exercise SQLite, native speech/TTS, native audio, Christian's live library or an at-piano
session; the release checks below are separate evidence and do not change that boundary.

The release source gates are green: **2,499 frontend tests passed / 1 skipped / 0 failed**;
**1,049 native tests passed / 19 ignored / 0 failed** with `filtered out: 0` on every target;
TypeScript and strict clippy are clean; all five narrated voice corpora produced zero false
mutations. Those automated results complement these images; they do not turn browser-mock QA into
native or at-piano acceptance.

## Release verification

Tag `v7.2.0` points to release commit `7a5061d57fc6197b53e2601ca788f186d1fc7c83`.
All eight release-script gates passed. The installed plist reports 7.2.0 with the expected app
identifier, codesign verifies, the DMG checksum verifies and a fresh installed process launched.
The DMG is `releases/v7.2.0/CodaKiller-7.2.0.dmg` (10,739,055 bytes), SHA-256
`532868f089241e64d134b2fb3b645f2ddf7db8df838d8706d3a39d7d5b7dc77f`.

v7.2.0 keeps schema 16, so no migration or rehearsal ran. The live database was checked read-only
before and after install: integrity OK, 10 pieces / 228 blocks / 2,026 reps / 44 sessions / 0 open,
with no count change. The pre-install backup is
`(C) pre-v7.2.0-install-2026-08-27-014755.db` (21,663,744 bytes), SHA-256
`dfafa80a6e58dd917b7a27e8692a8e55e3b81d1599399dcaada507c1e0a81820`; the outgoing v7.1.0
rollback tar is `CodaKiller-v7.1.0-rollback.app.tar.gz` (9,872,086 bytes), SHA-256
`a63bbf1ef3f1a48e5e1c683bb0b0540fe98bc5a77fca05a96041d08a3c522f85`.

## Primary evidence

| Screenshot | What it proves at the browser-mock boundary |
| --- | --- |
| `spot-created-practice-this-clean-720x520.png` | A newly created dashed spot stays visible on the score and exposes the direct **Practice this** affordance without a naming or measure-entry form. |
| `spot-parent-child-hierarchy-720x520.png` | The section list keeps the parent first and visibly indents its contextual spot, including the same-start-measure case. The dashed child box is visible only in that parent context. |
| `spots-hidden-show-control-720x520.png` | **Hide spots** removes the contextual child box and leaves an explicit **Show spots** recovery control. |
| `spot-resumed-from-score-720x520.png` | **Practice this** follows the resume path for the same paused spot and restores its contextual active set in the mock. |
| `set-complete-compact-countdown-720x520.png` | An ordinary mastered set remains visibly complete, shows the six-second auto-close countdown and **Stay open**, and keeps the completion affordance visible in the compact HUD at the minimum size. |
| `variant-consecutive-cleans-720x520.png` | Variant rows keep both the variant name and editable consecutive-clean target readable at 720×520 after the narrow-layout correction. |
| `tuning-controls-720x520.png` | The composer's Advanced section exposes beat value, beats per bar and subdivision; beat value labels the entered click rate and does not imply a BPM conversion. |
| `settings-demotion-controls-720x520.png` | Settings exposes the global tempo-demotion switch plus first/repeat sloppy thresholds. This does **not** show a per-set demotion override, which remains absent. |
| `settings-speech-off-chime-720x520.png` | Spoken confirmations are visibly opt-in/off by default, while the copy preserves the short acknowledgement chime. The image cannot prove native TTS silence or audio output. |
| `universe-low-data-guide-720x520.png` | The low-data Universe explains the earned-only rule in normal flow rather than presenting sparse hollow systems as unexplained absence. |

`spot-armed-720x520.png` is useful supporting evidence for the armed-state instruction and
cancel affordance: it names the selected parent and tells the user to drag inside it.

## Earlier exploratory shots

The following images were captured during the same browser pass but are weaker evidence than the
primary frames above. They are retained so the QA trail is honest, not silently curated:

- `app-root-720x520.png` is a mount/smoke frame only; it does not show a v7.2 affordance.
- `spot-button-visible-720x520.png` proves the button was reachable but not that creation worked.
- `spot-box-on-score-720x520.png` and `spot-created-with-box-720x520.png` show intermediate spot
  states but do not prove the final parent-first hierarchy or direct practice path as clearly as
  the primary frames.
- `set-complete-banner-720x520.png` shows an earlier completion state; the compact-countdown frame
  is the accepted minimum-size evidence because it includes both the timer and **Stay open**.

## Final verifier addendum

The final automated verifier added four guarantees that the static frames cannot prove:

- paused micro-target resume keys on exact `region_id`, so siblings with the same estimated
  measure range cannot resume one another;
- recovery synchronously cancels a pending auto-close, and the timer rechecks the live completion
  boundary immediately before firing;
- each intermediate variant-stage transition emits its chime exactly once; and
- **Practice this** is suppressed while any score pointer mode owns the page, so it cannot
  intercept drawing, mapping or target selection.

One narrow residual remains: `score_micro_target_create` is transactional but has no independent
request-replay/idempotency key. Its synchronous UI pending guard prevents duplicate same-tick
pointer completion, but a retry after a committed write whose success response was lost could
create a second spot. No such case was observed. This record does not conflate atomicity with
retry idempotency.

## What remains unverified

- No screenshot or browser action can verify the native `score_micro_target_create` SQLite
  transaction, rollback behavior or conservative inference against Christian's live score data;
  those are covered by native/unit tests but were not interactively exercised in the installed app.
- The browser mock drove direct start, pause and same-spot resume, but it is seeded state rather
  than Christian's durable database. Tomorrow-relaunch persistence remains an installed-app
  acceptance item even though the freshly installed process launched successfully.
- The final-chain recovery-debt rules, exact intermediate-stage chime, recovery/close boundary,
  bounded close retry and no-resurrection guarantees are automated-test evidence, not visual
  evidence in this folder.
- Native spoken-ack silence, the acknowledgement chime, metronome tuning and voice-over-Steinway
  behavior require native/at-piano acceptance. No such verdict is recorded here.
- The composer still has no per-set demotion override, and the running RepHud still has no
  quick-subdivision control; the global Settings and composer-tuning screenshots do not imply
  either residual was delivered.
- The broader Universe design verdict remains open; this folder verifies only the E3 low-data
  teaching pass.
