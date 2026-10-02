# Build4 pianist workflow follow-up — October 2, 2026

**2.0.0/build4 · schema4 · DEVELOPMENT CANDIDATE.** Base: `25fa176`. Implementation: `aeda81b`.
Christian requested further hidden-error and practice-convenience work before importing his Mac library.
No Mac DB rewrite, physical import or live-account operation has occurred in this round. The physical iPad has build4 installed, exact seven-file preservation verified; automatic launch was denied.

## Functional changes and review findings

| Finding | Resulting behavior |
| --- | --- |
| Active tempo adjustment replayed reps from a new startBPM | Durable boundary-anchored tempo events keep the initial contract, prior attempt BPM, earned stage/streak and Undo/reopen semantics |
| Edited tempos yielded invalid next sets after relaunch | Fixed-total target stays at current tempo; clean ladder retains an effective ceiling; new set clears old tempo-event boundaries |
| Join reused visual box IDs, ignored save failure and archived originals | One atomic merge creates fresh box identities; failed writes retain both targets and exact saved bytes |
| Cold start used several independent writes and could accept a verdict against a mismatched audible click | Set, grade, schedule, rule events and first rep commit together; failure retains idle/arm; mismatched click is corrected and requires a deliberate new attempt before saving |
| Settings were inaccessible before first-attempt grade; More options/repeat reset choices; chain target UI did not match stage counts | Techniques/setup available before grading; chosen goal/count/hands/stages/tempo/click carry forward; ungraded Start remains explicit; chain setup edits and summarizes the actual stage targets |
| Active passage taps could change the visible target without changing the ledger | Finish-and-switch is explicit; Cancel retains current score/target |
| Many passages were hard to locate | Search and current-source-page grouping make nearby sections easy to select, including reordered scores |
| Compound meter required hidden BPM arithmetic | Explicit dotted-quarter pulse in 6/8, 9/8 and 12/8; presets retain clear pulse labeling |
| Count-in/lock playback lacked controls; practice pause could override lock playback; muted accents silenced count-in | Count-in Off/1–4 bars and lock playback exposed; count-in uses audible main beats and applies on next Start |
| Click edits restarted the clock at beat1; tap history survived manual BPM edits | Ordinary PCM changes retain current phase, manual tempo clears stale tap estimates; output/session reconfiguration is a separate hardware boundary |
| Decorative interactive numeral face; custom materials lacked accessibility policy | Native SF text/tabular rounded numerals; one system Liquid Glass layer on iOS26+, older-system regular material, opaque accessibility fallback; score stays opaque |

## Storage compatibility

Schema4 preserves exact schema1/2/3 original files before migration; schema3 data retains its original
values while the marker/revision advance. Older builds reject the marker instead of silently discarding
tempo-event history. Backup decoding/restoring never downgrades it. New tempo histories require backup
version3; archives/audio use version2; ordinary payloads retain version1 encoding. The device helper
accepts supported schema4 and continues refusing running sets, incomplete copies and unknown formats.
All devices participating in new tempo-event sync must run a current build; direct edits now queue sync in both app roots; old cloud clients can
ignore optional tempo JSON, so mixed-version convergence is not accepted.

## Practice choices and evidence

The six optional editable choices are Rhythm pair, Hands then together, Work on the join, Slow and
connected, Touch contrast and Memory checkpoint. Each explains the player action and returns to the
written phrase/rhythm where appropriate. Applying a choice never judges audio, changes tempo
unasked, forces a technique or invents practice/rewards. Target counts remain editable.

These are practice tools, not universal prescriptions. [Duke, Simmons and Cash (2009)](https://journals.sagepub.com/doi/10.1177/0022429408328851)
observed advanced pianists and associated retention with practice accuracy, rather than mere time or
trial volume; its correlational result does not establish a universal clean-rep number.
The [pianist variability pilot](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2014.00598/full)
examines a narrow motor task, not proof every technique helps every passage. User/teacher judgment
remains central. [Interleaving research in advanced clarinetists](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.01251/full)
is informative but is not direct piano evidence or an imposed app schedule.

Glass follows [Apple's native-material guidance](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass):
standard system navigation/presentations, a restrained separate control layer, readable score content.
The known paired physical iPad runs18.7.8; it receives the native-material fallback, not iOS26 Glass.

## Verification ledger

- Independent adversarial Core probes pass for visual join/write failure, exact64→65 tempo, Undo,
  reopen, sync roundtrip, cleared repeat boundaries, relaunch defaults and atomic cold grading.
- Schema migration/preservation focused suite46/46 passes; Python helper/exporter53/53 passes.
- Final full Core356/356 passes and service harness2211 assertions passes. The initial full Core run
  had one legacy default expectation inconsistent with retained choices/fixed-total tempo; the
  explicit contract expectation was corrected before the full rerun. An initial nested Swift
  sandbox execution was unavailable; authorized full execution passed.
- Initial root schema tests used an incorrect Date encoder, then corrected to native deferred-Date
  encoding; retained failed logs are not counted as passes.
- Actual current-iPad schema3 dry-run migration preserves the exact85,079-byte original and all3,447 semantic scalar values (only marker/revision differ); schema4 reopen matches. Original backup source is unchanged.
- Final technique focused Core6/6 and owner metronome Core53/53 pass after the source review.
- Phone6 current-source clean native build links successfully; RuntimeFeedback hosted12/12 passes.
  Two metronome UI cases failed navigation/query assumptions (one actual presented form is in the
  failure attachment); test-only corrected rerun and final iPad review are pending.
- Signed device Release and exact-source/fixture checks pass. Native runtime12 and phone7 largest-text300BPM/dark/injected-opaque case pass; normal toolbar-opening automation remains unaccepted. Additional iPad/phone UI cases were deferred at the user's explicit urgent installation request. Dark-mode and forced opaque
  design-surface inspection use strict DEBUG-only, disposable test-root overrides; actual system
  Increase Contrast/Reduce Transparency toggles are read-only and remain a hardware gate. The
  initial audit helper incorrectly attempted those read-only keys and was corrected before native reruns.
- Concurrent stale builds produced mixed-object linker failures after source changes; affected builds
  are canceled and retained as failed evidence. Final native/Release builds are serialized with two
  compiler jobs from stable inputs. Their prior partial outputs are not accepted artifacts.
- Superseded unsigned builds were stopped after source edits/resource contention. Final acceptance
  uses the signed device Release artifact, checked for exact version, inputs, normal launch behavior
  and exclusion of test fixtures. No device installation ran before backup/verification.

## Device and remaining acceptance

Initial USB/Xcode availability preceded CoreDevice development-service readiness. Opening Xcode
and allowing device preparation resolved the disconnected tunnel without weakening the helper's
readiness checks. Read-only app inventory confirms the iPad runs18.7.8, Developer Mode enabled,
with Praelude2.0.0/build3 installed. Complete private backup verified seven owned files; schema3,
three pieces, ten historical sets and no active set. A diagnostic print attempted `.get` on the
returned raw ledger bytes after backup succeeded; the backup itself was retained and independently
inspected. No installation ran before the backup. Read-only live Mac critical counts still match the transfer:11 piece rows,31 goals,3,313 reps,370 sets,67 sessions; no open sessions or sets. A stale local candidate's signature failed read-only
status inspection; it is not used for this update. Final signed Release verification passes (2.0.0/build4, minimum iOS17, 174 frozen inputs unchanged, no test/audit/private-transfer flags).
Import remains under the musician's control. Existing backup account-ownership metadata is present;
that does not prove authentication or remote convergence. Before importing, confirm the intended
account because supported native imported records/PDFs can catch up automatically; the original
Mac archive remains private/local.

Actual audio-output latency, route/session reconfiguration gaps, locked-screen playback, voice over
the Steinway, Pencil, narrow hardware windows, VoiceOver and sustained musical use remain physical
acceptance gates. Media-service reset may require reopening. Normal presets are validated; no
universal claim that every hardware path is perfect. Live Supabase two-device/backend clocks and
continuous desktop sync remain separate open work from the earlier snapshot review.

**Next steps:** finish current-source scoped native/Release checks, perform a guarded same-bundle
update when device readiness is established, then musician-controlled Mac import and piano-session review.

## User-prioritized iPad deployment

At19:12 EDT Christian explicitly asked to stop spending time on phone support and get the app onto
his iPad because he needs to practice now. Remaining optional native UI acceptance is deferred at
his direction; existing durable-state, actual-device migration, native runtime12/12 and largest-text
phone300BPM checks passed. Phone7's normal toolbar sheet-opening automation remains unaccepted;
no product defect or workaround is claimed from it. Guarded refresh has made another full private
seven-file backup and is building/signing the frozen source with two compiler jobs. No Mac import.
The same-bundle/data-preservation checks remain required and automatic before launch.

### Installation result

Guarded refresh completed installation at19:14 EDT. Complete before/after inventories match all
seven file names, sizes and SHA-256 hashes exactly, before first launch. New signed profile expires
October9 at22:26:44 UTC. Automatic launch was denied; no security cause is assumed. User unlock,
trust if prompted and direct opening remain necessary. Physical migration is not claimed from
installation; the pre-launch ledger remains schema3. No Mac import, reset or restored replacement.
Exact sanitized artifact/check results: [verification manifest](practice-polish-verification.json).
