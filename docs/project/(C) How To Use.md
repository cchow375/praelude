# Praelude — How To Use

**Matches: v11.1.0 / schema 21 (installed). Last updated: 2026-09-13.** Open `/Applications/Praelude.app`. This guide describes current actions; old UI and release history are retained in Changelog/version records.

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
