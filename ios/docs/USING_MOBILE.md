# Using Praelude Mobile

## October 2 follow-up — build4 practice polish

Current source is **2.0.0/build4/schema4**, a development candidate. Search saved passages by name;
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

**Next steps:** finish current-source native/Release checks, guarded same-bundle update, then the
musician-controlled Mac import and actual piano-session/two-device acceptance.

**Matches: 2.0.0/build4/schema4 DEVELOPMENT CANDIDATE (2026-10-02).** This describes current source,
not a new physical installation. [Current QA](../../docs/qa/ios/2.0.0/README.md) separates native
simulator evidence from hardware/two-device acceptance. September14 install evidence is historical.

## Import your Mac library

Finish practice on both devices. Export with `ios/scripts/export_desktop.py` on the Mac, review its
warnings, and transfer the private JSON through Files/AirDrop. In Settings choose **Import from Mac**,
then **Choose Mac transfer**, review counts and **Import library**. Mobile scores/practice/settings
are preserved. Compatible scores, passage boxes, matching pencil marks and goals become native data;
original Mac history and every table remain under **Progress → Mac practice record**. Re-importing the
same snapshot does not duplicate targets or overwrite edits. This is a snapshot, not continuous Mac sync.
Original archives stay local and travel with backups; native goals/routines are not cloud-wired.

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

**Score options (…) → Focus on score** hides the practice controls; **Exit focus** brings them
back. On wider iPad layouts, Score options also offers **Two pages** and, where supported,
**Open score in new window**. These windows share one practice record and active set.

## Mark a passage visually

1. Choose **Draw passage** above the score, or **Score options → Draw a passage**.
2. Drag over the music to add a lightly highlighted box. Add more boxes when the passage continues
   on another system or page; use the visible page controls while selecting.
3. Drag a box to move it or drag its corners to resize it. Select a box and use the trash control
   to remove it. The selection's Undo and Redo change boxes, not recorded repetitions.
4. Tap **Done** to save the passage. **Cancel** offers to discard the unsaved passage edits.

Open **Passages** to see saved targets with previews. Tap a passage to select it and, when no set
is already running/paused, open practice setup. Long-press or swipe a passage for **Edit boxes**,
**Edit details**, or **Delete**. **Passage details** holds its name, focus and optional **Measure
numbers**. Boxes identify the target without requiring you to type measure numbers.

Leaving a selection unfinished offers **Discard passage edits** or **Keep selecting**. Use Done
before leaving when you want to keep the boxes. Deleting a saved shortcut retains the original
target in recorded practice; an active set must be finished before its passage can be deleted.

## Write on the score

Tap the pencil control, **Annotate score**, to open **Write on score** and the native drawing tools.
Apple Pencil can write directly on the score; finger navigation remains available by default.
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

## October2 physical update at19:14 EDT

2.0.0/build4 is installed over the existing iPad app. All seven original library files match complete
pre/post-install copies exactly. The pre-launch ledger is schema3; current-data migration rehearsal
preserved all3,447 scalar values and the exact original file. iOS denied automatic launch: unlock and
tap Praelude, completing Developer App trust only if prompted. Actual launch/schema4 migration and
physical piano acceptance remain pending. No Mac import. Further phone acceptance is deferred at
Christian's explicit request to get the app onto the iPad now. Signed Release excludes test fixtures;
Core356, service2211, Python53, native runtime12 and largest-text300BPM checks pass.

**Next steps:** open the installed app and practice; import the reviewed Mac transfer afterward.
