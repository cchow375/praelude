# Praelude — portable project summary

## November 15 — Daily passage practice and compact iOS interface

**Last updated: 2026-11-15. Source candidate native 2.0.0/build22/schema5; not installed.** Christian reports an overwhelming overdue pile, bulky main navigation and unclear practice priorities. Today now leads with one finite round of up to five passages: delayed recall of hard-won work first, rebuilding next, scheduled checks and new learning after that. Meaningful completed sets clear today's workload; slow work counts without earning mastery. Clean first attempts below the effective target retain the review step and return tomorrow. A Shaky report or a recovery check restarts the configured short confidence ladder; old successes cannot restore readiness after a newer effective Sloppy report. Piece/location/music identify each item; completed work, tomorrow's checks and the remaining library are secondary. Passages is compact and grouped by piece.

The sidebar exposes Today, Passages and Pieces with supporting destinations collapsed. A piece-wide target is editable from setup and practice; new unchosen practice starts at about 75% of it, with an explicit Play at target control for deliberate checks. Counter includes numbered beats, Flash, Bounce or Off, with a reduced-motion fallback. Saved histories and attempted active sets retain their recorded BPM. No schema/backend migration, score deletion or practice reset.

Verification passes within the candidate scope: full Core580 cases and native runtime380 cases (one optional skip each, zero failures),2,349 deterministic service assertions, selected native phone/iPad flows, and independent source/live/visual review. Exact scoped runs, retained failures and synthetic screenshots are in `docs/qa/ios/2.0.0/build22/README.md`; the product contract is `daily-practice-design.md` beside it. Installed phone remains last verifiedBuild21; personal iPad last recordedBuild20, friendBuild12, Mac11.1.0/schema21. This source work makes no new physical-device, piano/audio or real-account convergence claim.

**Next steps:** review the verified source/simulator candidate. Physical delivery remains a separate guarded same-bundle update to an authorized idle device with complete backup, exact preservation, package verification and launch/readback. Evaluate actual piano use and two-device behavior separately.


## November 13 — Personal iPhone refreshed; launch verified

**Last updated: 2026-11-13. Personal iPhone native 2.0.0/build21/schema5 refreshed and observed
running on this Mac.** The guarded same-bundle refresh preserves all 9 owned files/10,429,907 bytes
exactly by filename, size and SHA-256 before launch. Independent final package review passes46/46;
the full signed app+dSYM private copy and ZIP readback pass. Provisioning expires November20 at
22:37:27UTC /5:37:27PM EST. Automatic launch is denied, but subsequent read-only installed-version
and process inspection confirms Build21 running. No current real-account sync or hardware-feature
acceptance is inferred. Personal iPad remains last recordedBuild20/friend12; neither was operated.

One incorrect audit command safely stopped the initial attempt before installation. Corrected
public-certificate/trust verification passes, and the successful retry uses a fresh complete backup.
An interim dSYM comparison during rebuild fails; final static comparison reproduces no changed
path and the exact current dSYM matches the installed arm64 binary. Earlier failures stay in QA.
No app deletion, reset, restore-over, forced termination, synthetic practice, Mac app/data change,
new identity, certificate revocation, trust override or signing-account change occurs.

**Next steps:** use Praelude on the iPhone; renew the same-bundle Personal Team signing before
actual expiry. Real-account phone/iPad convergence, physical camera/audio/gestures/Pencil and
sustained piano use remain separate. Evidence: repo `docs/qa/ios/phone-install-2026-11-13.md`.


**This Mac, November 13, 2026:** the published source at `00cf2b0` is now received, including
`ios/`, `supabase/`, previously missing `124707d` and all 18 iOS checkpoint tags. Native
2.0.0/build21/schema5 is the current source. Christian confirms iPhone/iPad as the primary
product. The earlier missing-source blocker is resolved by publication (`708ef97`, `00cf2b0`).
Independent core/service/helper checks and unsigned simulator build pass on this Mac; independent selected native runtime verification also passes (2 tests, no failures). Device
installation and real-account/physical acceptance below remain historical, separate evidence.


## November 13 — iOS development handoff in the existing public repository

**Last updated: 2026-11-13.** Christian requests the complete iPhone/iPad source on GitHub to
continue development on another computer. The canonical repository remains
https://github.com/cchow375/praelude, with native source under `ios/` and backend contracts and
migrations under `supabase/`. All 303 Swift files, tests, assets, generated project, generator and
dependency locks are already committed locally; the initial remote check finds `main` 177 commits
behind. The GitHub repository is public, contrary to older private-repository wording. Christian
explicitly chooses to keep it public and publish there. No separate mobile repository is created.

The iOS-only handoff guide is `ios/docs/NEW_MAC_SETUP.md`: clone, open
`ios/Praelude.xcodeproj`, choose the Praelude scheme and a simulator, then run native checks.
Full Xcode, its iOS SDK/runtime, Git and Python 3 are required; desktop Node/Rust setup is optional
for mobile work. Signing/account sessions, personal practice files and backups stay outside Git.
This changes development setup and Xcode linkage only; application logic is unchanged. Native source remains 2.0.0/build21/schema5;
October device-install/readback records remain historical, and no device or installed Mac app is
operated by this handoff. No new physical-feature or real-account convergence acceptance is claimed.

The clean checkout exposed B174: an old explicit `Helpers.framework` flag fails without cached
artifacts, while linking the same package products into both app and hosted tests hides shared
symbols during test builds. Remove the stale flag and duplicate test-target product links; tests
load the app's package symbols through `TEST_HOST`/`BUNDLE_LOADER`. The app's four package products,
locked dependency versions, architecture settings and signing behavior remain unchanged.

**Verification:** clean-checkout simulator app/test build passes with standard settings and no
linker override, as does the ordinary generic simulator build. Serial core: 556 cases, one optional
skip, zero failures; deterministic services: 2,340 assertions; device helper: 57 cases. Independent
hosted PostgREST runtime tests pass 4/4 on a disposable iPhone simulator, then that simulator is
removed. Initial linker failures and one initial heartbeat timing failure remain recorded in
`docs/qa/ios/source-handoff-2026-11-13.md`.

**Published and read back:** source/linkage commit `708ef970bc624f90d46eb5db17542812bf4a2b07`
and all 18 existing iOS checkpoint tags are on GitHub. An anonymous fresh GitHub clone matches
local `main` exactly, contains 348 iOS files including all 303 Swift files, and regenerates the
committed Xcode project without changes. The final documentation follow-up records these results;
the source handoff is complete. Opening/building on the second computer remains the next user step.

**Next steps:** clone or pull `main` on the second Mac, run the simulator checks and continue
coding. Commit/push on the working computer and pull before switching computers. Existing device
refresh and actual feature/sync acceptance gates remain separate.

Last updated: 2026-10-18. Phone native2.0.0/build21 installed/preserved, manual opening and sync readback pending. Personal iPad Build20 refresh held for active practice. Friend Build12 held; Mac11.1.0/schema21 unchanged.

Build20 delivery checkpoint: iPad installation succeeds with a complete 13-file pre-backup; post-install folder copy and read-only retry fail with transport/permission errors, so no preservation or launch pass is claimed. Actual signed package37/37 and private archive pass. Phone update stops safely before installation during its pre-copy. Both devices were requested unlocked/connected for verification; no destructive workaround or queue edit occurs. Real account sync is not yet accepted.

October18 refresh: the phone Build20 update preserves all saved files and opens. Its new signature expires October25 at11:47:25 AM EDT. The iPad fresh backup is verified; a newly built package fails strict signature before install and is retained for clean rebuild. Actual account data now reaches the server, but phone download still fails on a newly created passage: stale practice-row rejection adopts the full remote graph before ordinary metadata pulls. Build21 prepares that graph's validated score/passage dependencies before atomic adoption/acknowledgment; source review and core/native tests pass. Phone21 is now installed with exact3-file/3,939,591-byte preservation and independent38/38 actual-package review; its profile expires October25 at11:49:49 AM EDT. iPad21 pre-backup stops before build/install while new practice is active; its unverified partial copy is retained and the user is asked to pause/leave idle.

Praelude is a piano practice and repertoire tracker. **The user is the sensor; the app is the memory.** The pianist supplies every verdict; the app counts repetitions, tracks focused time, remembers goals/passages, runs a deterministic offline metronome, and organizes scores. It never interprets piano audio to judge playing. Christian, an NEC-prep pianist using a Steinway acoustic baby grand, remains the design authority; a blank installation contains no personal repertoire. It succeeds the abandoned PianoCoach in mission and lessons, with no shared code or UI. The broad AI Practice Operator remains OFF and ON HOLD.

The installed Mac is a separate Tauri v2/Rust/React product, voice-first with keyboard/mouse support. Native iPhone/iPad uses SwiftUI, PDFKit and PencilKit with an independent Foundation core. Scores, page-based reading/zoom, annotation, passage boxes, goals, tempo ladders, variants, self-reported first-attempt review, history, warmups, calendar and rewards coexist. Clean-streak sets reward consecutive clean reports; Total plays counts chosen volume. A lower tempo or missed review date never becomes an invented musical judgment.

Build19 makes phone practice distinct: iPhone defaults to a large Counter with prominent rep count, generous Clean/Sloppy/Again buttons and a visible metronome. iPad retains Score by default and can switch to the same Counter. Digital reading and Pencil annotation remain available. The separate Passages tab/sidebar shows music images rather than anonymous passage numbers. Existing PDF selections use the first stored box as their cover; all boxes remain in the target/history. Camera or Photos input supports rectangular crop, retake, rotation, optional paper contrast and accessible fine adjustment. Only the crop is saved, as an immutable private PDF and normal passage; full-book digital music is optional. Bounded background decoding/rendering and prepared atomic ledger writes avoid doing the large preparation on the UI actor.

Review cards, Today and the queue show music, saved dates, first-attempt history and the current configured ladder. The first daily Clean/Shaky/Missed report advances the schedule; ordinary reps and ungraded exploration do not. Overdue is only a reminder. Additional Build19 tools are 50/75/100% reference tempos, return-to-last-clean tempo, paused hand-rest timers, opt-in running-counter screen wake, card shuffle, recall/reveal, unpracticed filtering, passage-image zoom, reversible hiding until tomorrow, and calendar session drill-down. Existing hands/focus/count-in/sound controls are surfaced. The calendar derives a recorded-day streak from saved work with DST-aware arithmetic, excludes empty sessions and undone/reset repetitions, and distinguishes reward freezes from actual recorded days.

Native Supabase supports accounts, private PDFs/photo crops/recordings/covers, passages/regions/review schedules, annotations, practice history/Undo, organization, instruments, goals/routines, rules/rewards and supported preferences. Build19 deploys additive nullable full-tempo, practice-balance and photo-origin fields, without backfill or privacy-policy changes. Older omitted keys preserve server values. Queue corruption fails closed; refreshed credentials must still match the queued owner; cloud downloads validate off the UI actor before publication and never overwrite a racing local asset. Random folder UUIDs avoid collisions between users. Display/camera permissions and calibration, temporary rests/shuffle/recall, and live audio remain local. A running set does not move devices. **At the earlier implementation checkpoint, neither device was signed in and hosted scores contained 0 rows. Later phone readback has matching local profile/sync ownership; this does not prove a live session or library convergence.** Verify the same account on both devices and complete real-device offline/reconnect acceptance.

Build20 addresses observed sync failures: the preferences query uses owner_id; an atomic prerequisite prefix retains all 8,036 old queue entries while creating their missing parents; new practice queues its own score/passage parents. Tags/folders download before scores, and related folder/passage rows merge atomically. Errors show their reason rather than generic error 0 or an invented offline state. Core552/1 skip/0 failures, native371/1 skip/0 failures, an intermediate iPad live practice flow and hosted rollback fixtures pass. First-login profile references, inserted pages and split/merge provenance are covered. Signed package/device and actual convergence checks remain. No practice/backend schema migration.

Mac SQLite/schema21 and the native JSON library are separate. The Mac importer is an additive snapshot retaining the original archive, not continuous Mac/native sync. Continuous Mac/Windows adapters remain unbuilt. Existing installed Mac storage names com.christian.codakiller and codakiller.db are compatibility contracts. All future installations require fresh complete backup, same-bundle update, exact owned-file preservation, and separate launch/schema/feature evidence; never uninstall/reset/restore-over or terminate active practice as a shortcut.

Verification: full Build19 core 537 cases/1 live-account skip/0 failures and 2,340 deterministic service assertions pass. Final hosted native passes 360 cases/1 live-account skip/0 failures in 16.159 seconds, including visible download-arrival recovery, capture/camera ownership and file-publication ordering. All six distinct flows pass on both phone and tablet simulators. A fresh independent same-card Score/Counter/Clean/Undo check preserves the ungraded review schedule; a stronger pixel test excludes navigation glass. Generic unsigned arm64 Release and eight scoped package checks pass. Exact results and retained failures are recorded in the Build19 QA ledger. Isolated rollback SQL tests verify the additive deployed columns, validation, legacy preservation and owner isolation; all 22 LWW plus 7 append tables retain RLS. These checks do not prove physical camera quality, audible click/haptics, sustained responsiveness, or real-account two-device convergence. B170 head-gesture reliability at upright 2.5–3 feet and B171 score page/rep pauses remain open. B172 tracks new phone/photo acceptance; B173 tracks personal sync acceptance. Failed intermediate builds/tests and their repairs remain in QA; no flawless or zero-lag claim.

The October 16 phone first install separately passes 35 signed-package checks, user opening and running-process/version readback; its initial schema5/revision189 backup has 3 files/109,341 bytes, rehashed exactly. Prior-library preservation/migration is not applicable because no app existed. Phone signing expires October 23 at 19:42:03 EDT; private app+dSYM archive inventory reads back exactly. No existing iPad/Mac library or credentials were transferred. Camera/audio/latency/account acceptance remains separate.

The last personal Build18 iPad delivery separately preserved all 13 owned files/23,655,615 bytes exactly; running process and full postlaunch readback were verified at schema5/revision4061 with 576 attempts. This historical install evidence is not a current device audit or Build19 delivery. Mac v11.1.0 remains installed from implementation c411e7b; its original 46-table/DB-byte preservation and native Score/Variants checks passed. Current Mac audio/microphone/Listen Back over Steinway, real-provider measure mapping and cover selection have separate acceptance gaps. Historical Windows v9.1 is packaged but not Windows 10/11-native accepted; voice/Listen Back/system TTS/volume boost are unavailable there.

Version digest: v6 Practice Core; v7/v8 contracts; v9 portable library/Windows candidate; v10 Praelude identity, page-first score and routines; v11 Studio/glass/library; v11.1 progressive practice resonance. Native2.0 is a separate version stream. Version records are immutable once shipped; patch history and detailed mobile build evidence remain in Changelog/QA.

Next steps: manual phone21 opening/readback and, after paused-idle readiness, guarded iPad21 refresh with exact preservation and open/version/schema readback, then real account metadata/history/private-score catch-up and later offline-edit convergence. Obtain actual phone/iPad camera/audio/latency acceptance separately. Keep the friend iPad held and the broad Assistant on hold.

Code lives at /Users/c3/praelude; editable docs at /Users/c3/Desktop/christian's universe/Piano Practice/Praelude. The public repository https://github.com/cchow375/praelude includes the Markdown manual at docs/project, version records, lockfiles and new-Mac setup. Start with AGENTS.md, ios/README.md, NOTES.md and docs/qa/ios/2.0.0/build19. Git excludes live libraries, scores/photos, credentials, device backups and release archives. Git clone restores development context, not the personal practice environment; transferring live data to another Mac/path needs its own verified procedure.
