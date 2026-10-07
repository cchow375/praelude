# Using Praelude Mobile

## Build7 controls (installed October7)

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

Pen, highlighter, eraser, lasso, stamps and notes use a shallow icon strip with accessible names. Fingers navigate unless Draw with finger is on. Long tool trays scroll inside a bounded footer. Changing layers saves the original layer first; a failed save keeps that layer open. Ordinary drawing saves after a brief idle interval; leaving the score, turning pages or backgrounding also checkpoints ink. Keep my drawing retains the newest canvas after a conflict. Today reorder actions are in each item’s options menu. Sharing an annotated score prepares pages asynchronously before opening the share sheet.

In short landscape drawing windows, notation initially fits the score width. Pinch to adjust; an automatic fit restores your earlier portrait zoom. Scroll the tool tray to reveal Done when space is short. The phone resume strip stays above the tabs, and lists scroll above it. Warmup Close, transport and verdicts stay anchored; the center readout and error messages scroll.

Build7 is installed on the personal iPad with exact complete-file preservation; Praelude is running and schema5 readback passes. Earlier build6 instructions below are historical. Physical sustained drawing and higher-refresh-rate acceptance remain open.


**Matches: installed2.0.0/build7/schema5 (October7); running-process/readback confirmed, physical feature quality remains open.**

## October2 build5 — score workflow and shared data

**Historical October3 mobile source: 2.0.0/build6, schema5, DEVELOPMENT CANDIDATE.** Christian's physical build4 feedback drives this round: Pencil did not draw without finger mode, black marks/stamps were invisible, annotation could freeze during a set, passage navigation was slow and ambiguous, and score chrome took too much space. Build5 implements fixes and new controls and is personally installed on the iPad. Complete pre-launch file preservation and actual schema5 upgrade pass; physical Pencil/freeze acceptance remains open.

**Build6 compact practice correction:** Christian found build5’s dock still too tall, especially Start without grading, Techniques and More options. The fixed width cap is removed. Wide setup uses two columns; those secondary actions share a shallow44-point row. Grading/verdict buttons use horizontal icon/text and52-point targets; running status, direct tempo, transport and verdicts share a row when the available width fits. Narrow windows reflow and accessibility text retains wrapping/scrolling. Six scoped iPad cases pass, including actual grading/Undo, portrait/landscape geometry and largest-text reachability. Setup is143pt and running100pt; secondary controls44pt, verdicts52pt. Two scoped phone cases also pass portrait/landscape geometry and actual grading/Undo. Independent final visual review passes. Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Score workflow:** a visible Library exit and compact bottom Practice / Select / Draw controls; passage Done at the bottom or score double-tap; distinct editable passage colors and an account-synced hide-boxes setting. Entering annotation retains the active set and its saved progress. PencilKit uses paper-light traits and deferred responder setup; finger navigation and optional finger drawing remain separate. Stamps have movable sized previews and a magnifier before Place. Yellow note chips expand locally with Edit/Close; failed saves retain the note text or stamp preview.

**Organization:** reviewed movement/book page ranges keep source PDFs, marks and history anchored while labels restart at section page1. PDF contents/bookmarks suggest sections; local Vision offers printed-number hints for review. Users confirm a measure or system region and its first/last numbers; newly drawn boxes inherit confirmed ranges, and older unlabeled passage/history displays derive fully covered confirmed ranges without rewriting snapshots. This is assisted mapping, not automatic optical music recognition. Passage lists group by page, sort measure numbers, and use bounded background thumbnail caches; history shows meaningful locations.

**Practice:** per-piece default tempo, visible pre-start metronome On/Off, stable Techniques with explicit Left hand/Right hand, less dock padding, a compact initial practice readout and width-fit Focus. Notebook New note opens directly. Rank progress leads Rewards; Studio stays secondary.

**Sync and preservation:** native profiles/privacy, instruments, practice records, score marks, goals/routines with deletion tombstones, movement/measure metadata, default tempo, account preferences and private score/recording/cover files have shared Supabase contracts. First sign-in reads the account before publishing defaults. Name/photo/privacy edits stage durably before local save and remain recoverable through failed saves, concurrent hydration, reverted retries and same-account sign-out. Local edits request debounced sync; unchanged remote adoption does not rewrite the ledger. Canonical lowercase owner-folder UUIDs fix a file-policy mismatch. Absent SQL columns and unknown preference keys survive older clients; other nested schemas remain versioned. Nullable clears remain explicit. Schema5 preserves the exact old ledger; backups require version4. Hardware permissions/audio state stay device-local.

**Mac boundary:** the additive read-only snapshot transfer still preserves all46 original Mac tables and history/contracts, without replaying them under mobile rules or granting rewards. The original Mac archive stays local and in native backups. Continuous Mac↔native synchronization still needs a desktop adapter; the installed Tauri product is unchanged. Future clients must follow the shared ownership, source-page, LWW and append-only contracts.

**Installed-device boundary:** Build6 is now installed on the physical iPad after the October3 guarded update. Renewed provisioning is valid until October10 at17:55:53UTC (1:55PM EDT); actual Release signature/profile/team/device checks pass. Independent review confirms all11 owned files/6,212,619bytes exactly preserved, including practice history and account ownership/privacy. Pre-launch schema5/revision883 has5pieces/30passages/24historical sets/15sessions/114attempts and no active set. Automatic launch was declined; Christian confirms Praelude opened, and a direct ledger read confirms schema5/revision883. Native Pencil/freeze/piano and actual two-device acceptance remain open. Earlier signing attempts and renewal recovery are retained in `docs/qa/ios/2.0.0/build6/device-update-attempt.json`; installed evidence is `docs/qa/ios/2.0.0/build6/personal-ipad-install.json`. Layout evidence: `docs/qa/ios/2.0.0/compact-practice.md`.

**Build5 verification:** 385 core tests, 2,211 service assertions and 54 Python tests pass; the final native app-hosted run executes 193 tests with one live-account test skipped and zero failures. Seven distinct iPad and five phone UI cases pass across scoped runs. Final arm64 device Release compiles with fixture flags/test plug-ins absent; a later guarded physical update is recorded below. Exact evidence and remaining acceptance are in `docs/qa/ios/2.0.0/score-workflow.md`.

**Next steps:** use the installed build6 to verify Pencil, black ink, sustained annotation during practice, reviewed movement/measure mapping and actual second-device continuity. Continuous desktop sync needs its separate adapter; Assistant remains on hold.

## Build5 candidate controls

- **Read or practice:** new devices start with a compact practice readout; tap its up/down chevron to expand/collapse, and your existing device choice is retained. The bottom rail has Practice, Select and Draw. Library at the top returns
  to your library while preserving a running set; Resume returns to that set. Focus uses a wider
  score fit. Score options lets you choose compact controls and hide passage boxes.
- **Make a passage:** tap Select, draw one or more boxes, then tap bottom Done or double-tap the
  score. Cancel keeps unsaved work open until you choose discard. Edit a passage to choose its
  color/name/measure range; saved shortcuts group by source page and show confirmed measures.
- **Write:** tap Draw. Apple Pencil is intended to draw with Draw with finger off; turn that
  switch on for finger ink. Choose color, line width and layer. Bottom Done returns to practice.
  Hardware Pencil behavior still needs acceptance on the candidate.
- **Place a stamp:** choose Stamp and a symbol, tap/drag its preview over the score, adjust Size
  while the magnifier helps placement, then Place. Cancel saves nothing. A failed save retains
  the preview. **Sticky note** creates a small yellow reminder; tap its chip to read the full text
  in a small panel, Edit to change/delete, or Close to return to the score.
- **Organize a sonata or book:** Score options → Movements & pieces. Add a title and original PDF
  start/end page, or review suggested PDF bookmark ranges. Open a section directly. The page
  indicator and passage/history labels use movement-relative numbering; ink stays attached to
  the original PDF pages. This does not duplicate or physically split your PDF.
- **Add meaningful measure labels:** Score options → Measure map. Scan printed numbers for
  optional hints, outline a measure or system, enter/review its first and last measure, and
  Confirm measure region. New boxes and older unlabeled passage/history displays use a range
  only when their full geometry is covered by confirmed regions in one movement. Printed-number
  hints can include fingerings/page numbers, so they require review. Exact automatic OMR remains
  a separate capability.
- **Set practice conditions:** the click On/Off choice sits beside tempo before the first attempt.
  Tap the sliders button, then **Use X BPM as piece default** to save the current tempo for
  this piece. Techniques opens a stable full sheet with Left hand and Right hand alongside editable stages. Rewards shows rank progress
  first, with Studio and badges below. Notebook's New note opens an editor immediately.
- **Use another device:** sign in with the same account. Supported native records and private
  score/recording/cover files retry after local edits or connectivity changes. Check Sync status
  for pending work. Each device grants its own microphone permissions. Future platform clients
  must implement the [shared account contract](../../docs/PLATFORM_DATA_CONTRACT.md); the installed
  Mac app remains separate. The repository exporter reads Mac data for a reviewed snapshot
  import into the native app; continuous Mac account sync needs a desktop adapter.

## Historical October2 build4/schema4 — practice polish before installation

At this historical boundary, source was **2.0.0/build4/schema4**, a development candidate. Search saved passages by name;
passages on the current source page appear first. Switching away from a running set requires an
explicit Finish and switch; Cancel keeps the current target. Setup and optional Techniques are
available before the first-attempt grade. Editable choices include rhythm pairs, hands separately
then together, passage joins, slow connected playing, touch contrast and memory checkpoints.
They suggest actions and never grade piano audio or change tempo without your choice.

More options carries the entire current draft; Use settings returns to the arm screen. Another set
and voice Next retain your chosen target count, hands, stages, tempo and metronome choices. Start
without grading records no invented attempt. Cold grading and visual passage joins now commit
atomically, retaining the original state on failed saves. Active tempo edits retain earlier attempt
BPM, stage/streak and Undo history instead of replaying from a rewritten starting tempo.

Metronome exposes Count-in Off/1–4 bars and Keep playing when locked, custom beat accents, sound,
subdivision and grouped compound pulse. In 6/8, 9/8 and 12/8 the optional dotted-quarter pulse is
labeled explicitly; triplet subdivisions supply the written eighths. Muted patterns still have audible
main-beat count-in. Count-in changes apply on next Start. Ordinary click edits retain bar phase;
route/session interruptions remain a physical-device acceptance gate.

Practice controls use native SF text and one system Liquid Glass layer on iOS26+, system material
on older iOS and an opaque accessibility fallback. Music stays opaque. Schema4 preserves the exact
older ledger before migrating; tempo histories require backup version3. Older apps refuse newer
local formats; participating sync clients must be current. See the [follow-up QA](../../docs/qa/ios/2.0.0/practice-polish.md)
for verification and remaining hardware/backend limits.

**Next steps at that build4 boundary:** finish native/Release checks and the guarded update, then
the musician-controlled Mac import and actual piano-session/two-device acceptance. The later
installation and first-open records below supersede the build4 installation/launch gates.

**Guide boundary:** the build4 polish above is historical evidence. The controls below describe
installed build7/schema5, including compact drawing controls and the existing shallow full-width practice dock. Older build-specific notes are dated evidence.
[Current QA](../../docs/qa/ios/2.0.0/README.md) separates simulator evidence from hardware/two-device acceptance.

## Import your Mac library — installed build6 scope

Finish practice on both devices. Export with `ios/scripts/export_desktop.py` on the Mac, review its
warnings, and transfer the private JSON through Files/AirDrop. In Settings choose **Import from Mac**,
then **Choose Mac transfer**, review counts and **Import library**. Mobile scores/practice/settings
are preserved. Compatible scores, passage boxes, matching pencil marks and goals become native data;
original Mac history and every table remain under **Progress → Mac practice record**. Re-importing the
same snapshot does not duplicate targets or overwrite edits. This is a snapshot, not continuous Mac sync.
Original archives stay local and travel with backups. Build5 source syncs compatible native
goals/routines and private covers; the installed build4 retains its older sync scope until updated.

## Navigate and practice

Phone tabs: Today, Pieces, Warmups, Progress, More. More lists Friends, History, Calendar, Notebook,
Data and Rewards; iPad uses the sidebar. Today → Start session begins the first warmup if one is planned.
Feedback after verdicts keeps the score size fixed. In Score options, **Turn passage page after each
verdict** is off initially; enable it deliberately for a multi-page passage. First hands-free enable
opens Voice check and starts requested listening when dismissed after setup. In Performance mode,
touch and hold the score to exit; a brief entry hint explains this.

## Open your score

In **Pieces**, choose **Add piece** and import a PDF from Files. The app keeps a copy and leaves
the source file unchanged. You can start with a title and add the PDF later. Open a piece to read
its score. Use the page arrows or page picker to move, and pinch to zoom.

**Score options (…) → Focus on score** hides idle setup and enlarges the score fit. During a
running set, the active practice HUD remains available; collapse it for more score space.
**Exit focus** restores the ordinary controls. On wider iPad layouts, Score options also offers **Two pages** and, where supported,
**Open score in new window**. These windows share one practice record and active set.

## Mark a passage visually

1. In build5, tap **Select** on the bottom rail, or **Score options → Draw a passage**.
   The installed build4 uses its **Draw passage** control.
2. Drag over the music to add a lightly highlighted box. Add more boxes when the passage continues
   on another system or page; use the visible page controls while selecting.
3. Drag a box to move it or drag its corners to resize it. Select a box and use the trash control
   to remove it. The selection's Undo and Redo change boxes, not recorded repetitions.
4. In build5, tap bottom **Done** or double-tap the score to save the passage.
   **Cancel** offers to discard the unsaved passage edits; build4 uses its existing Done control.

Open **Passages** to see saved targets with previews. Tap a passage to select it and, when no set
is already running/paused, open practice setup. Long-press or swipe a passage for **Edit boxes**,
**Edit details**, or **Delete**. **Passage details** holds its name, focus and optional **Measure
numbers**. Boxes identify the target without requiring you to type measure numbers.

Leaving a selection unfinished offers **Discard passage edits** or **Keep selecting**. Use Done
before leaving when you want to keep the boxes. Deleting a saved shortcut retains the original
target in recorded practice; an active set must be finished before its passage can be deleted.

## Write on the score — controls and hardware boundary

Tap the pencil control, **Annotate score**, to open **Write on score** and the native drawing tools.
PencilKit is intended to let Apple Pencil write while fingers navigate. Christian reported
that this failed in installed build4; build5 implements a fix, with physical Pencil acceptance
still required.
Without a Pencil, enable **Draw with finger** in the writing controls. Use the page arrows when
finger drawing is enabled. **Undo ink** and **Redo ink** affect the current drawing rather than
your practice record. Tap **Done** to finish writing.

The app saves editable ink separately from its original PDF. If saving fails, keep the editor
open and resolve the error before leaving. When two windows edit the same page, **Ink changed in
another window** offers **Keep my drawing**, **Use the saved drawing**, or **Keep editing**;
it does not silently choose between conflicting drawings.

A score with ink or visual passage targets cannot be replaced by a different PDF. Import the
replacement as a separate piece so existing marks and recorded targets still refer to the correct music.

## Practice and review the original target

Choose a saved passage or **Practice whole piece**. The compact idle dock keeps passage, tempo and
Start visible; tap the sliders button to expand **Practice set** configuration. Set the focus,
target count and tempo. **Set rules** holds Clean streak/Total plays and hands. Optional tempo
ladders, ordered variants and routines are available for Clean streak; Total plays stays at one tempo.

After playing, record **Clean**, **Sloppy**, or **Again**. All verdicts are your judgment. Sloppy
restarts a clean streak; Again is neutral and preserves progress in both plain and variant
clean-streak sets. All three count toward Total plays. Practice Undo corrects the latest verdict.
Pause when stepping away and resume from Today. Saved repetitions do not depend on reward playback.

Open **Progress → a session → What you practiced**. For a set recorded with visual boxes, tap the
target to see **Target recorded with this set** on the score. This view is read-only; its arrows
move among the target's pages. Editing or deleting the current saved passage does not rewrite that
recorded target. Older sets without visual-target snapshots remain listed without invented boxes.

## Share or print an annotated PDF

Choose **Score options → Share annotated score**. The app first saves pending ink, then creates
a separate PDF for the system share sheet. Choose **Save to Files**, an available sharing
destination, or **Print**. Available destinations and printers depend on the device setup.

The exported copy includes the score and flattened ink. **Passage boxes are practice targets and
are excluded.** The original score and editable PencilKit drawing stay in Praelude. Changes to the
shared PDF do not flow back into the library, and the exported flattened ink is not a substitute
for the editable library backup. Score export is bounded at 200 MB. The three native iPad hosted export tests now cover render alignment and original preservation.
Share/Print presentation and physical output still need their own acceptance.

## Set the metronome and feedback

Open **Metronome** from the score toolbar. Start/Stop and Tap tempo are at the top. During an active
set, tempo follows that set's rules. **Meter & accents** sets beats per bar and beat value; tap an
individual beat to cycle regular beat, accent, and silence. **Clicks per beat** adds even subdivisions.
Choose **Wood**, **Click**, or **Bell**, set metronome volume, and optionally enable **Beat haptics**.

The separate **Practice feedback** section controls **Reward sounds**, **Reward haptics**, and
reward volume. The master **Practice feedback** setting must also be enabled in Settings. Hardware
haptics vary by device; sound, vibration, and visible feedback do not determine whether a rep saved.
Long-session timing, acoustic quality and speech overlap require physical-device testing.

## Back up and keep the app installed

**Settings → Export backup** saves the native library with owned PDFs, covers, editable ink,
recording bytes and preserved original Mac archives. The combined owned payload is bounded to210 MB,
and encoded JSON to280 MB. Missing originals or incomplete recording/archival backups fail safely.
Restore is a reviewed replacement of the current library and requires ending the active set; it stages
new files before committing the ledger. Mac import is a separate additive action. Neither action
implements continuous Mac↔iOS synchronization. Historical Phone3 backup UI evidence belongs to1.1;
current scoped backup/transfer regressions are in the2.0 QA ledger. Physical-device acceptance remains open.

For cable installation and free Personal Team renewal every seven days, follow
[INSTALL_ON_IPAD.md](INSTALL_ON_IPAD.md). Keep the same app/account/team, pause practice, and use
the checked refresh command. Do not delete the installed app to renew it.

### Build4 technique and lock details (candidate)

A technique chain shows its actual clean count per stage; use Edit stage targets to change each one.
The general target count applies only when there is no chain. If a playing metronome differs from the
armed tempo, reporting the first attempt corrects the click and asks you to repeat the passage before
saving a grade. Keep playing when locked preserves an already-running click while practice pauses;
resume the set when you return. A foreground pause or finished set stops its click.

## Historical October2 19:14 EDT — build4 installed, before first open

At 19:14 EDT, 2.0.0/build4 was installed over the existing iPad app. All seven original library files matched complete
pre/post-install copies exactly. The pre-launch ledger was schema3; current-data migration rehearsal
preserved all3,447 scalar values and the exact original file. iOS denied automatic launch. At that pre-launch boundary, the next step was to unlock and tap
Praelude, completing Developer App trust only if prompted; launch/schema4 migration and physical
piano acceptance were unverified. The first-open follow-up below supersedes the launch/migration gate. Mac import had not run. Further phone acceptance was deferred at
Christian's explicit request to get build4 onto the iPad then. Signed Release excludes test fixtures;
Core356, service2211, Python53, native runtime12 and largest-text300BPM checks pass.

**Next steps at that pre-launch boundary:** open build4 and practice, then import the reviewed Mac
transfer. The first-open follow-up below establishes launch/schema4; Mac import and hardware
acceptance remain separate.

## October2 build4/schema4 — verified first-open follow-up

Christian opened the installed app without a trust prompt. Read-only verification confirmed 2.0.0/build4/schema4 with three existing mobile pieces and ten historical sets. Mac import remains pending; piano/audio/two-device acceptance remains separate.

**Next steps:** complete build5 verification and a guarded update, then physical Pencil/piano and
real-account/two-device acceptance. Import the reviewed Mac transfer when Christian is ready.

Build7 candidate: in short landscape annotation windows, the score begins at stave width. Pinch to choose a zoom; finger navigation remains available with Pencil drawing. Automatic landscape fitting restores the previous portrait zoom. The phone resume strip remains above the tabs and available on secondary screens. Installed build6 does not include these repairs yet.
