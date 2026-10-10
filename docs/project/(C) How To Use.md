# Praelude — How To Use

## Build10 controls — installed October 10; physical selection comparison pending

**Matches: installed native2.0.0/build10/schema5 and Macv11.1.0/schema21. Last updated:2026-10-10.** Build10 is installed from `b22d4bf`. Independent pre/post/post-launch review verifies all13 owned files/13,350,814 bytes unchanged, including schema5/revision2198 and all history/marks. The October10 14:58:32 UTC snapshot has no active set or added persisted activity. A read-only process inspection confirms build10 running after automatic launch was denied. The user has not yet confirmed the actual Prokofiev/Beethoven selection and Cancel result; that specific physical verdict remains pending.

Build10 keeps selection handles and borders visible across ordinary and oversized page coordinates and limits overlay raster work. Explicit selection Cancel immediately discards the draft and returns to the score; existing saved passages stay unchanged. Navigating away retains a separate confirmation guard. These flows pass scoped native and actual iPad/phone UI checks; real-score responsiveness remains to be confirmed. Earlier build9 user acceptance and the later score-specific failure remain in QA.

- **Tempo:** compact numbers show BPM and the Start/Goal controls have distinct spoken labels. Tap the BPM number to replace it with an exact value, use ±1/±5 or Tap tempo, then Apply. Cancel leaves the current value unchanged. Dragging the number previews the change and applies it on release. The supported range is 20–300 BPM.
- **Tempo goal and hands:** before starting, open the visible Tempo goal action in its large sheet, choose Start and Goal, a BPM/percent increase and the clean target, then Use goal. A passage can also retain that goal for future practice; the compact running controls show the full goal value. Choose L, Both or R directly. Techniques shows an ordered sequence with per-stage clean counts; changes describe the next set and do not invent attempts. Explore remains the ungraded start action.
- **Passage selection:** draw a box in Select, drag a corner to resize or the box to move, then choose Done. Cancel discards only the current draft, including an added box while editing an existing passage. The original saved passage remains intact. The oversized Prokofiev/ordinary Beethoven comparison is still awaiting the user verdict.
- **Marking while practicing:** Draw keeps practice controls available. In Select, Done stays above scrolling practice controls; narrow large-text layouts reflow. All six drawing tools have44-point targets. Drag or collapse the palette to uncover notation. Pinch and pan move the score and ink together. Two-finger tap undoes a drawing edit; visible Undo/Redo is available, including while zoomed. The pinch recognizer has priority over two-finger Undo. Fine/medium/broad widths and lighter highlighting support small marks. Pencil marks → Done and two-finger Undo were user-accepted on build9; Undo specifically while zoomed is not separately confirmed.
- **Names and notes:** double-tap a selected passage to rename, or triple-tap to dictate a draft. The passage list also offers a pencil button and Rename swipe action. Double-tap a sticky note to edit, triple-tap to dictate, or hold and drag to move it. VoiceOver identifies visible notes and opens their panel. Review text and Save; microphone errors leave keyboard entry available. Score gestures lists the shortcuts.
- **Movements:** use Movements & pieces in the score or the library's movement entries. Name the movement and set its first/last PDF pages with the large number fields or adjacent steppers. Typing replaces the selected page number; empty, zero or out-of-range pages keep Save disabled until corrected. An entry opens that source-page range and shows its own practice target. The PDF and annotations remain shared; saved practice retains the movement name and source range even if the label later changes. Actual saved passages keep their own identity and history.
- **Warmups:** adjust tempo or metronome without leaving the exercise. Pause & close preserves unfinished practice; Finish ends the session. Failed saves stay visible so work is not silently discarded.

**Next steps:** compare Prokofiev and Beethoven selection/resize/Cancel in the installed build10. Installation, observed running state and exact post-launch data retention pass; keep the physical verdict and longer-term reliability separate.

## Historical build8 installation and failure

**Installed build8 — physical Undo crash remains open:** native2.0.0/build8/schema5 from `a23cdec4f4f9acf42e8e5c724b6a386430dddca5` is installed. Independent review verifies all13 owned files/12,788,247 bytes unchanged by filename, size and SHA-256 before launch. Automatic launch was declined; the user opened the app. The23:59:40 UTC readback retains schema5/revision2086 (from2079),6 pieces/51 passages/50 sets/31 sessions/304 attempts/255 ink records (199 active)/2 stamps/2 notes. Original records remain exact except one piece page bookmark; profile/privacy/account/score data are exact. This readback precedes the23:59:53 UTC crash and is not post-crash retention proof. The user reported failure at19:59:56 EDT. Matching build8 dSYM identifies main-thread `EXC_BAD_ACCESS` at0x10 in `PKTiledView.performUndo` tile update, reached through the two-finger Undo action; this is distinct from the build7 PDF watchdog. Exact user sequence remains pending and the crash is unclosed. Signed Release checks pass, with profile valid through October16 at23:56:11 UTC (7:56 PM EDT). Sanitized evidence: `docs/qa/ios/2.0.0/build8/personal-ipad-install.json`. Mac v11.1.0/schema21 is unchanged.

**Next steps:** obtain the exact user sequence and reproduce the confirmed native two-finger Undo crash before accepting its repair. Keep the23:59:40 UTC readback separate from post-crash retention. Keep physical Pencil, microphone, large-score and sustained-use acceptance open; do not treat installation as task completion.

## October7 — build7 installed on the personal iPad

**October 7 user confirmation:** Christian confirms the update reached the iPad. This confirms installation; sustained Pencil, audio, freeze recovery, refresh rate and real two-device behavior still require physical acceptance. The complete implementation, verification and deployment handoff is `docs/qa/ios/2.0.0/build7/session-handoff.md` (source `3e03330`, installation record `2227817`).

Guarded same-bundle refresh installs2.0.0/build7/schema5 from source `3e03330`. Independent full pre/post inventory review proves all11 owned files/7,981,365bytes identical by filename,size andSHA256, including scores, annotations, history, account ownership/privacy/preferences. Pre-launch schema5/revision1647 has5pieces/44passages/43historical sets/30sessions/255unique attempts; retained active set is completed, with no running set. No schema migration, import, restore, uninstall or Mac change occurred.

Actual signed device Release passes strict signature, app/profile/team agreement, signer-certificate membership/trust and helper device inclusion; fixture arguments/debug diagnostics/test plug-ins are absent. Profile expiresOctober10 at17:55:53UTC (1:55PM EDT). Automatic launch failed; subsequent read-only device inspection confirms Praelude running and schema5/revision1660. Independent post-launch review retains all255 attempts,44set IDs,30sessions and every original45ink record, plus exact profile/privacy/preferences. A completed set is archived and newer ink/reward/page activity is observed; no author or automatic-startup attribution is inferred. User screen-quality confirmation remains separate. Source/native simulator verification remains distinct from physical Pencil/audio/freeze/long-session/real-account two-device acceptance. Exact sanitized evidence: `docs/qa/ios/2.0.0/build7/personal-ipad-install.json`; private complete backups stay outside Git.

**Next steps:** use the installed build7 for real practice to verify sustained Pencil/eraser/Undo/layer/page transitions and responsiveness. Renew with the same app/team before the actual profile expiry.


Build7 source candidate also keeps the phone’s resume strip above the tabs. In short landscape annotation windows, the score opens at stave width; pinch to choose another zoom and use finger navigation with Pencil drawing. Automatic width fitting returns to the previous portrait zoom. Scroll the bounded tool tray to reveal Done in short windows. Warmup Close and verdicts stay anchored while the central readout and error messages scroll. These build7 controls are installed now; Praelude is running and schema5 readback passes.

## October6 source repair boundary

At this historical October6 boundary, the iPad remained on2.0.0/build6/schema5. Build7 was a source candidate for freezing, disappearing ink, slow previews and crowded annotation controls; it was not installed then. The October7 installed boundary above now supersedes that source-only status.

**Next steps:** requested guarded update after the completed source/native/Release gates, then sustained physical drawing/practice acceptance.


## Historical installed mobile build6 (October3)

At the October3 historical boundary, the physical iPad ran2.0.0/build6/schema5. The guarded update preserves all11 owned files exactly. Christian confirms it opens; direct schema5/revision883 read passes. Personal Team provisioning expiresOctober10 at1:55PM EDT; renew with the same app/team using `npm run ios:refresh`.

The score controls now use the available width. Start without grading, Techniques and More options share44-point secondary actions; first-attempt and running verdicts use52-point horizontal labels. Setup/transport share rows when they fit; narrow and accessibility layouts reflow. Bottom Practice/Select/Draw, Done/double-tap, Library exit, colored hideable passages, stamp previews and expandable yellow notes remain available. Mobile usage: `/Users/c3/praelude/ios/docs/USING_MOBILE.md`.

**Next steps:** judge compact controls and Pencil/black ink/in-set annotation on the actual iPad, then verify real-account second-device continuity. These physical checks remain open.

**Matches: installed Mac v11.1.0/schema21 and native iPad2.0.0/build10/schema5. Build10 is observed running with exact post-launch preservation; physical selection comparison remains pending. Last updated:2026-10-10.** Open `/Applications/Praelude.app`. This guide describes current actions; old UI and release history are retained in Changelog/version records.

## Separate installed iPhone/iPad build7

The Mac instructions below describe installed v11.1.0/schema21. The physical iPad runs **2.0.0/build7/schema5**, confirmed October 9. Build8 source is the separate development preview above. Its workflow is documented in `ios/docs/USING_MOBILE.md`; historical September14 device evidence is in `docs/qa/ios/1.1.0/`.

Phone tabs are Today, Pieces, Warmups, Progress and More. On iPad, the sidebar exposes every section. Settings → Import from Mac opens a reviewed transfer from Files and adds compatible scores, passage boxes, pencil marks and goals without replacing mobile data. Progress → Mac practice record retains original Mac history and all table records. Build5 extends Supabase sync to goals/routines, preferences, score metadata and private covers alongside supported native records/PDFs/recordings. The original Mac archive stays local and backed up; continuous desktop sync still requires an adapter.

In a score, Clean/Sloppy/Again record the pianist's verdict. Compact controls preserve large targets; acknowledgements no longer resize the music. Automatic passage-page turning is opt-in in Score options. Today → Start session follows warmup-first plans. First hands-free enable runs a voice check before starting requested listening. Performance mode explains that touching and holding exits it. Backup includes PDFs, editable ink, recordings and original Mac archives, within the bounded size limit.

**Next steps:** physical score/ink/voice acceptance and real-account/two-device checks; reviewed Mac import remains musician-controlled. The guarded build5 update and schema5 upgrade now pass; installed Mac remains unchanged.

## Start a useful practice session

1. Open **Pieces → Library → Add Piece**. Enter a title, optionally composer/folder, and choose a local score PDF. The app copies the PDF; your original stays where it is. You may also drag a PDF onto the app. A new installation starts blank.
2. Open the piece in **Score**. Use **Tricky Sections** to select an existing passage or add the measures you want to work on.
3. In the top practice bar choose **Goal**, toggle **Metronome**, and set **Starting tempo** / **Target tempo** where applicable. Press **Start set**.
4. After each attempt, choose **Clean**, **Sloppy** or **Again** in the Rep Counter, use your configured verdict keys, or speak a verdict with voice enabled. You supply the judgment.
5. Pause unfinished work to resume later, or finish the set. Use **End session** when done; your history remains local. **End my day** is a separate confirmed action with an optional photo.

IMSLP is only an optional external source: use its link, download a suitable public-domain PDF in your browser, then add that local file. There is no required IMSLP lookup or bundled score/teaching library.

## Navigation and setup

The main rail opens **Today, Score, Warmups, Pieces and Studio**. Its top arrow collapses labels into icons to return width to the score. **Settings** and **Metronome** are in the rail; the **Mic / Muted** control toggles speech input when the native voice service is available. The Assistant remains off.

Today makes **Open Score** and **Today's Practice** the main launch actions. **Today's Practice** opens your day sheet, plans and notes. Piece headings can return to that piece's Score/Plan. **Pieces** contains **Library | History | Calendar**. Settings sections start closed; open the section you need, make changes and choose **Save**. **Appearance** offers **Dark**, **Light** or **System**, with glass following system reduced-transparency/motion preferences. Interface scale and **Reset panel layout** help when controls or panels feel awkward. The minimum window is 720×520.

Microphone and Speech Recognition permissions are needed only for hands-free use. macOS Dictation must be enabled for that path. A fresh ad-hoc update may renew those prompts and separately ask to read Desktop-folder scores. Until Desktop access is allowed, Score can wait at **Finding score editions…**. Keyboard/mouse practice does not require a microphone. The app is ad-hoc signed, not notarized; native folder permission is separate from opening the app.

## Organize your repertoire

Use **All Pieces**, **Unfiled**, or a folder. The **+** creates a folder/subfolder; folder actions support New subfolder, Rename, Move and Delete. These are logical folders; organizing them does not relocate your score PDFs.

The Library uses **Active**, **Completed** and **Resting**. A piece's right-click or **⋯** menu opens it, moves it to a folder, changes completion state, puts it to rest/restores it or removes it. **Put to rest** declutters the active shelf while retaining files/history; **Restore** brings it back. **Remove…** asks for confirmation and moves an eligible app-owned piece folder to the Library's `.trash`; practice history remains in History. A separate detail-level file-removal action requires the exact piece name. Read its confirmation before proceeding.

Use the **Cover grid / Compact list** switch, title/composer search and **Recently practiced / Title / Composer** sorting. **⋯ → Choose cover… / Change cover…** accepts local JPEG, PNG or WebP files under 15 MB. A centered square thumbnail is stored without changing your original. **Reset cover** restores generated artwork. The folder control collapses in compact windows.

## Score and passage tools

Score opens one PDF page at a time, centered at a minimum 100% initial scale. Use **‹ / ›**, the page field or **Page Up / Page Down / Left / Right** to turn pages. **Score tools** contains fit and explicit two-page options. Zoom with **− / % / +**, trackpad pinch or Command/Control + scroll. Zoomed music scrolls inside its pane.

**Tricky Sections** is a finder: search, add and select passages. It stays available while you select or draw. Selecting a passage replaces the ordinary Score toolbar with an in-flow practice bar above the music. It never floats over the PDF. Long names truncate; hover to read the full name. Closing the selection restores the ordinary Score controls.

Use **Passage tools** beside the passage identity for **Edit**, **Score marks** or **Tutorial**. This is a centered surface, not an expanding sidebar. Starting a score mark closes the surface and exposes the tool, Review, Undo, Save and Cancel controls above the score, leaving the actual page drawable. **Review** returns to the editor. Marks retain their PDF edition/page/fingerprint identity; replacing the source can require remapping.

For freehand annotations choose **Pencil**, drag on the page, and use Command/Control + Z for the last stroke. **Escape** puts the pencil down. Clearing a page asks first. Pencil marks are stored per piece, edition, page and fingerprint; they do not modify the original PDF.

The **Plan** tab is today's checklist for the selected piece. Checking a plan item changes plan metadata; it does not log a rep. Sound targets and the editable piece goal cue remain descriptions of the sound you want, not grades from the microphone.

## Choose the set contract

The bar's **Goal** selects Tempo, Notes & accuracy, Phrasing, Dynamics, Memory, Hands / coordination or Other. Choosing a non-tempo goal turns the click off; turn it on again if useful. **Settings** holds completion basis/count and advanced tuning. **Variants** holds the ordered practice chain.

| Contract | What completes it |
| --- | --- |
| **Clean streak** | The required consecutive Clean evidence at the relevant tempo or through the chosen variant stages. Supports tempo ladders and mastery evidence. |
| **Total plays** | The chosen 5/10/15/25/Custom total of effective attempts, at a fixed starting tempo. Every verdict counts; completion does not claim mastery. |

A Clean-streak tempo ladder advances by the configured step after the required consecutive cleans, capped at target. Below target, the HUD shows the current rung streak; at target it shows the final proof requirement. Sloppy resets the streak and may lower tempo under the configured demotion policy; Again does not count toward Sloppy demotion. Global defaults live in Settings; a set may inherit, disable or override them.

With a variant chain, each stage has its own consecutive-clean target. Clearing it advances to the next stage. Sloppy resets the current stage; Again neither advances nor resets it. Earlier stages remain cleared. Only the final stage completes the chain.

## Save variants and routines

Open **Variants → Manage variants**. Enter a **New saved variant** and choose **Save to library**. Each **Show** checkbox controls that shortcut's visibility in the picker. This library is shared across pieces and persists after restart. **+ Custom** remains available for a one-off stage.

Select variants, arrange the sequence and set each stage's clean count. Choose **Save sequence as routine**, enter a name and **Save routine**. A saved routine replaces the current draft with a copy; later edits to the draft do not silently rewrite the stored routine. To replace a saved routine, enter its name and choose **Replace … with current sequence**. Delete requires inline confirmation. Hiding/deleting a shortcut preserves saved routine snapshots and existing sets. Variants are available for Clean streak; Total plays retains its fixed-volume contract.

## Rep Counter, pauses and corrections

The Rep Counter can move or minimize to a pill. **Paused Sets** holds unfinished sets across pieces and restarts; resume the desired set there. Other panels live under **Tools**, including Clock / Timer, Dynamics and configured Rotation. Minimized timers continue running. **Reset panel layout** in Settings restores a usable arrangement.

Use the correction controls or counted voice commands to add missed Clean evidence or reverse recent reps. Corrections append evidence instead of erasing the original record. Excessive undo requests are refused as a whole. A truthful Sloppy or Again is always better than an invented Clean.

The luminous core beside your count fills with the current goal: a clean streak, tempo rung, variant stage or Total plays target. Each saved Clean adds a brighter, wider spark burst and richer rising musical phrase. Sloppy/Again collapse a wave and drop fragments; consecutive setbacks deepen amber to coral, capped at three. A Clean clears that setback sequence. The ring always keeps the actual rule's progress: Again still preserves variant-stage progress and Total plays still counts every verdict.

Completing a set releases a larger radial celebration and resolving chord; completing an intermediate variation gets a shorter flourish; the entire chain earns the largest gold finale and musical cascade. Start-set, mic and verdict clicks/keys unlock local sound for later spoken verdicts; device/autoplay limits can keep it silent, and the native voice acknowledgement remains. Effects follow saved attempts, never block buttons or delay writes, and do not replay on corrections/undo/reopen. Reduced motion keeps static charge and a simple fade. Pausing or closing unfinished work stays quiet. A mastered set may show the six-second **Closing… / Stay open** countdown; another attempt, Stay open, pause or manual close cancels it.

A session rolls over at local midnight using its last real event; the app does not invent overnight practice. Active work pauses for later. **End session** is camera-free. Confirmed **End my day** offers an optional photo: choose a file or explicitly **Use camera**, or **Skip**. Showing the card alone never requests camera permission.

## Warmups, History and Calendar

**Warmups** offers visual exercises and saved ordered routines. Choose exercises and settings deliberately; the app does not impose a drill plan. Warmup evidence stays distinct from repertoire while contributing to retained practice.

**Pieces → History** opens a Days timeline, with expandable sessions/sets/attempts and the alternative piece view. The original evidence remains visible after corrections. **Calendar** shows plans alongside completed practice and can open a dated day sheet. Optional day photos supplement that record.

Day streaks derive from focused practice; the default threshold is ten focused minutes, configurable in Settings. A new profile explains what earns day one. Focused time estimates activity from practice events and excludes idle gaps; it is not a claim to hear how long you played.

## Voice essentials

Voice works on Mac when native permissions/service are available. New installations use `praelude` as the default wake word; upgrades preserve the saved word. Routine spoken confirmations are off by default; the short acknowledgement chime remains. Enable **Speak confirmations aloud** only if you want words too. The heard-text feed shows what the system recognized, including ignored speech.

| Say | Result |
| --- | --- |
| “metronome 96” / “metronome on ninety six” | Set tempo and start click. |
| “metronome on” / “metronome off” | Resume / stop click. |
| “tempo 140” / “faster” / “slower” | Set or nudge tempo. |
| “go to page 12” | Jump in the open score. |
| “open a rep tracker, measures 40 to 56, start at 80, target 120” | Open a block for the selected piece. |
| “clean”, “done”, “got it” | Record Clean while a block is open. |
| “sloppy”, “rough”, “shaky” | Record Sloppy while a block is open. |
| “again”, “nope”, “missed” | Record Again while a block is open. |
| “add two cleans” / “count that” | Add missed Clean evidence. |
| “take one back” / “undo four reps” | Append a correction; excessive undo is refused. |
| “close the block” / “end the tracker” | Close the current block. |
| “end the session” | End/export after the live block is safely closed. |

Mute voice or close the tracker before unrelated conversation. Native voice/Listen Back use over Christian's Steinway still needs its current hardware verdict. **Listen Back** optionally records takes for your own replay; unkept takes are discarded, kept audio remains local. It does not grade playing.

## Your data and honest limits

Pieces, scores, settings and practice evidence remain on this Mac. The database is schema 21. Session exports append to the piece's `(C) codakiller-sessions.md`; hidden legacy names preserve compatibility and do not change the visible Praelude product. An upgrade preserves the existing library; a new user's first install is blank. No books, quotes, copyrighted teaching library, personal scores or Christian's history are bundled.

Real-provider measure mapping remains unproven on live data. The Assistant is off/on hold; there is no current Books/Resources workflow. Accounts, friend presence and cloud sync are not connected. The existing Windows v9.1.0 unsigned installer is a separate candidate without native Windows 10/11 acceptance; it lacks voice, Listen Back, system TTS and volume boost.

If Score waits at **Finding score editions…** on a new install or after a code-signature change, answer the app's macOS score-folder prompt when it appears. That prompt was cleared and real Score/Variants passed for installed v11.1; it is troubleshooting, not a current release blocker. If voice reports Dictation/Code 201, enable macOS Dictation. For a PDF loading failure use **Try again**, then check the selected file/edition. If a saved mark says remap, verify the PDF edition. Report a persistent problem with the exact action and visible error; avoid deleting practice data to troubleshoot.

## Studio: your room and earned progress

**Studio:** your room begins with a digital piano and cardboard seat. The rank card shows total XP, progress to the next division and coins. **Furnish** offers Pianos, Seating, Shelves, Objects, Rooms and Palettes. An item's card shows price or rank lock. **Get** opens a price/balance confirmation; **Get for … coins** purchases and immediately equips it. Owned items use **Use in room** and switch freely, one per slot. There are 25 initial catalog items, including a side table; no real money is used.

**Rank path** lists Prelude, Etude, Arabesque, Nocturne, Scherzo, Sonata, Rhapsody, Concerto, Cadenza and Opus. Each has ten divisions, then Encore ranks continue. Division cost begins at 100 XP, rising 50 per rank; every division earns 25 coins. Open **How progress is earned** for the formula: 1 XP/600 focused seconds plus per-session completed-set milestone totals of 1/2/4/6 XP at 3/5/7/10 sets. Ten sets earn 6 bonus XP total. Refreshing does not pay again. Unfinished/paused sets do not count as complete; only sets whose saved record proves completion qualify for the bonus.

**Practice record** shows focus time, completed sets, focus XP, milestone XP, 28-day cadence and pieces with **Open score / History** links. Existing retained practice and resting pieces count. Corrections may revise XP/coins; possessions stay owned and new spending waits until earnings cover past spending.

Choose the profile button, enter a **Display name**, and **Save profile**. This is private device-local personalization. Email accounts, sync and friends are unbuilt, so no password or email is requested. **Back to practice** returns to music. When browsing Today, Pieces, Studio or Settings, an expanded Rep Counter automatically tucks into the bottom practice-tools pill without closing the set. Return to Score or Warmups to restore it if the app tucked it. Manual closed/minimized choices stay respected; you can also restore the panel yourself while browsing.

## Next steps

Practise a real passage using honest verdicts and keep unfinished work paused. Real installed Score/Variants already pass; actual cover selection/save/restart still needs acceptance. Only Christian can judge whether the new room and interface make sustained practice better. A Git clone on another Mac is a development checkout, not a transfer of this Mac's practice history or scores; follow the repository's `docs/NEW_MAC_SETUP.md` and do not copy the live database without a separately verified migration plan.

## Historical mobile build4 controls (separate from installed Mac)

The historical build4 candidate introduced passage search/current-page groups, explicit finish-and-switch, retained set settings and optional editable Techniques. Metronome exposes count-in, compound dotted pulse and lock playback; in-set tempo changes retain earned progress. Schema4 migration preserves originals; tempo-history backups require version3. These are source controls pending physical installation; the installed Mac Matches line above remains unchanged.

### Historical build4 technique and lock details

A technique chain shows its actual clean count per stage; use Edit stage targets to change each one.
The general target count applies only when there is no chain. If a playing metronome differs from the
armed tempo, reporting the first attempt corrects the click and asks you to repeat the passage before
saving a grade. Keep playing when locked preserves an already-running click while practice pauses;
resume the set when you return. A foreground pause or finished set stops its click.

**Installed mobile update October2:** 2.0.0/build4 is on the iPad with all seven original library files preserved. Automatic launch was denied; unlock and tap Praelude, trusting your developer only if iOS prompts. Physical schema4 migration is not yet observed. Mac import remains for after practice.

**First open now verified:** Christian opened build4 without a trust prompt; the device library is schema4 with the three existing pieces and ten historical sets present. Mac import remains pending.
