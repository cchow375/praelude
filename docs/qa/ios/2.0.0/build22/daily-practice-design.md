# Daily passage practice — design and acceptance

Date: 2026-11-15. Native 2.0.0/build22/schema5 development candidate.

## Problem

Christian reports a bulky main menu and a passage system that accumulates opaque overdue reminders. A passage finally recovered to target after a struggle should be the first fresh check tomorrow. A finished day must have an end. The supplied handwritten notes also request a piece-wide target, a 75% starting tempo, accessible target controls and a customizable visual metronome within Counter.

## Practice contract

- Today is one ordered round of up to five distinct passages, including work already completed elsewhere today. Completion consumes a slot; it never refills the round endlessly. The complete library remains accessible.
- Recall first: a passage built to target after practice returns on the following local calendar day, ahead of ordinary old review dates. Missing that day leaves the recall actionable on the next visit.
- Build again: a failed or below-target first check stays actionable until a meaningful set finishes. Finishing slow or total-plays work clears today, but earns no claim of mastery and returns for more work tomorrow.
- Check retention: a clean first attempt at or above the effective target earns the existing configurable longer interval. Clean below target holds ladder progress and returns tomorrow. A passage override wins over the piece target. Shaky and recovered checks restart short confidence evidence using the existing configured ladder values; old cold successes cannot override a later effective Sloppy report.
- Work is derived from saved human reports and effective, replay-valid completed sets. Opening a screen, stopping early, an undone final repetition or a stale completed flag cannot clear work. Final performance week does not reinsert completed work into today.
- The app never judges piano audio, invents a missed grade because of lateness, erases old practice, or blocks the musician from choosing other work.

## Interface

Today shows one short queue with recognizable piece/location/music, one Start next action and collapsed Worked today, Tomorrow and remaining-library context. Session planning and statistics are secondary. The sidebar exposes Today, Passages and Pieces; supporting features and score sections start collapsed. Passages uses compact rows grouped by piece, with an enlarged score on demand. Ordinary controls retain 44pt minimum touch targets and expand at accessibility sizes.

Every piece has an editable shared target tempo. New unchosen passage and whole-piece practice starts at about 75% of that target, respecting an explicitly saved slower start and deliberate choices made today. A saved start at/above target falls back to75%; an idle score refreshes on foreground/day changes, while a running set stays intact. A visible Play at target action lets the musician deliberately make a fresh target check. The current playing tempo and performance target remain distinct. Editing the target does not rewrite attempted sets or historical BPM.

Counter includes a beat display derived from the metronome audio playhead. Beats, Flash, Bounce and Off are selectable; Reduce Motion uses numbered beats. Meter, accent and count-in settings remain available. Sound, timing at a physical piano and subjective readability are separate hardware acceptance.

## Data and delivery

No schema or backend migration, practice reset, credential change or installed Mac change. Existing scores, passage IDs, schedules and history remain durable; the daily view is a projection over them. Build22 distinguishes this candidate from installed phone21 / last-recorded personal iPad20 / friend12. No physical installation is part of this coding pass.

## Acceptance

Deterministic tests must exercise bounded work, next-day priority, clean-at-target intervals, slow work, failures, Undo, final-week completion and calendar boundaries. Native tests must operate the actual iPhone/iPad queue, target75→100 setup, Counter grading/Undo and compact grouped library; screenshots must be inspected, including accessibility/landscape. A fresh-context verifier reviews the change and actual simulator behavior before completion. Results and retained failures belong in README.md beside this design.

## Next steps

Complete source and native verification, record evidence, then use the guarded same-bundle procedure for a separately authorized idle physical device. Validate real use and cross-device behavior separately.
