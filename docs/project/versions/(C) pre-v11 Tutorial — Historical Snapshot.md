# Pre-v11 tutorial — historical snapshot

Archived on 2026-09-07 because this living tutorial had contradictory installed-version sections. This text is historical evidence, not current instructions. Use `(C) How To Use.md` for the installed app.

# 🎹 Praelude — How To Use It

**Saved variants and routines (v10.1.0):** Open **Variants → Manage variants**. Enter a **New saved variant** and click **Save to library**; use each **Show** checkbox to control its picker shortcut. The library is shared across pieces and survives app restarts. Select variants, arrange the sequence and adjust each stage’s clean count, then **Save sequence as routine**, enter a name and **Save routine**. Click a saved routine to replace the current draft sequence with a copy. To update it, enter its desired name and use **Replace … with current sequence**. Delete asks for inline confirmation. Hiding/deleting a shortcut preserves saved routines and existing sets. **+ Custom** remains a one-off stage. Variants are available for Clean streak; Total plays keeps its fixed-volume contract.
>
> **v10.0.5 practice bar:** passage identity is deliberately small; hover a shortened name for the full text. Use **Goal** directly to choose Tempo, Notes & accuracy, Phrasing, Dynamics, Memory, Hands / coordination or Other. Toggle **Metronome** and edit **Starting tempo** / **Target tempo** in the bar, then **Start set**. Target tempo appears for Tempo/Clean-streak sets; Total plays stays fixed-tempo. Choosing a non-tempo goal turns the click off; turn it back on if wanted. **Variants** opens the chain; **Settings** holds Clean streak / Total plays counts and advanced tuning. **Passage tools** remains beside the passage identity. Smaller windows rearrange the controls into distinct rows.
> If the freshly updated app asks for Desktop-folder access, click **Allow** so Score can read your existing scores; until then it may show “Finding score editions…”. Renew Speech Recognition permission if you want voice commands.


> The 5-minute tutorial. Everything here matches the app **exactly as built** (kept current by
> [[CLAUDE]]'s update protocol — any change to commands, vocabulary, or UI flow MUST refresh
> this doc). **Matches installed app: v10.1.0 / schema 21 · Last updated: 2026-09-07.** Open
> `/Applications/Praelude.app`. Praelude starts in dark mode and uses one compact left rail;
> headings and controls use modern system sans type. Score is page-first. Select a passage to open
> Practice set, then use **Variants** or **Settings** for centered secondary dialogs. In a wide
> Score window, the selected-passage controls stay as one orderly strip; narrow screens reflow
> them into distinct rows instead of stacking controls on top of one another. Settings
> categories start collapsed so you only open the section you need. New installs use `praelude` as
> the default wake word; existing users keep their saved wake word and all practice history.
> Score opens at a true 100% minimum and centers the page; **Tricky Sections** stays open while
> the top arrow collapses the main navigation rail. Committed interactive reps receive a short
> local sound and Clean gets a tiny bloom; set/chain/mastery completions earn progressively larger
> local flourishes. Pausing or closing an unfinished set remains quiet.
> When you select a passage, its horizontal Practice set strip replaces Score’s normal toolbar;
> close it to restore the edition, page, zoom and Score-tools controls. It never covers the music
> or **Tricky Sections**. The sections rail is only for finding, searching and adding passages.
> Use **Passage tools** in the top strip for **Edit**, **Score marks**, or **Tutorial**; those open
> in a focused centered surface rather than expanding the rail. When adding score marks, the
> surface closes so the score is directly drawable, and the mark controls stay in the top strip.
>
> The hidden bundle/data identifier remains `com.christian.codakiller` to preserve permissions and
> the existing database; it is not the visible product name. The rest of this guide includes
> clearly labeled historical release details. v8.1 completed the
> Aug 8 practice train: faster and counted voice commands, movements, honest mapping entry,
> visual Warmups, Listen Back, Rotation, reversible piece archive, Sound targets, live hotkey
> remaps, per-set demotion, quick subdivision, replay-safe spot creation, and a progress-first
> Universe. v8.2 adds compact practice UI and Total plays; v9.1.3 returns Score to page-first,
> passage-first reading. Installed schema is
> 21. The Assistant remains switched OFF.

> **Historical v8.1 installed boundary (superseded by v8.2 below):** v8.1.0 was installed at `/Applications/CodaKiller.app` with bundle
> ID `com.christian.codakiller` and plist short/build version `8.1.0`. Strict code-signature
> verification passed; this is an **ad-hoc local seal**, not Developer ID and not notarized
> (CDHash `8655e9a45d83b7bb56e83a9d14bb477da7da39a9`). The verified DMG is
> `/Users/c3/codakiller/releases/v8.1.0/CodaKiller-8.1.0.dmg` (10,892,054 bytes; SHA-256
> `e828b861b31d771fde66cd66d48987eb66110f0fd455306a6a12c2f80eb0a271`). Fresh installed
> launch passed. The live database migrated 16→19 with integrity clean and 0 foreign-key
> violations: pieces 10→11 only because hidden piece
> `id=0` is the Warm-ups system row; blocks 230, reps 2,034, sessions 46, events 7,873 and one open
> session were preserved. `measure_map` still has 0 rows. Release tag `v8.1.0` points to
> `0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed. The first pushed post-tag docs
> baseline was `da71efb5509afa36beb073050719ac1094751b98`; pushed cold-start handoff
> `d03a3d7b9820494b878336f7d18e5da94b821f68` had reached `origin/main` at that historical boundary. These docs-only commits
> do not change the tag/runtime payload. Installed runtime source is commit
> `1a1e38bb7a3757cf90ee6ea814e93d5971c595d6`. Native Universe and Warmups at 720×520 are
> accepted. The release delivers 22 asks; **Aug 8 list item B5 (real-provider mapping)** is the
> one external-only acceptance item and none are
> absent. Release gates were frontend **2,650 passed / 1 skipped / 0 failed** and native
> **1,100 passed / 19 ignored / 0 failed**, with all eight release gates passing. Native
> microphone/Listen Back and Steinway acceptance remain owed.
>
> **v8.2 verified boundary:** source `afe65f3b176a1c5da81eca6d2f65bd721726ee40`; frontend
> 2,678/1 skipped, native 1,109/19 ignored, zero failures; TypeScript/build/format/strict Clippy,
> five narrated corpora and all eight release gates pass. Fresh launch migrated live 19→20 while
> preserving 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283 events with integrity OK/FK0.
> Installed identity/signature, one-copy rule, DMG/checksum, backup and rollback passed. The fresh
> app showed a Desktop-folder access prompt; it was not granted, so the five browser frames are the
> accepted Score/composer visuals and packaged-native Score interaction is still owed. Pushed
> lightweight tag `v8.2.0` points to
> `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
> documentation-only corrections, and its exact current tip must be read from Git. The tag and
> runtime source `afe65f3…` remain unchanged.
> Installed bundle id is `com.christian.codakiller`, plist short/build 8.2.0, strict signature PASS,
> CDHash `4f4a8e3947efc00e4845ee085564f2724ff378a6`. DMG
> `releases/v8.2.0/CodaKiller-8.2.0.dmg` is 10,903,545 bytes, SHA-256
> `1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`.
>
> **v8.2.1 installed boundary:** core composer fields are paired, **Start set** is pinned and custom
> entry sits behind **+ Custom**. Plain **End session** is camera-free. Only confirmed **End my
> day** offers the optional photo card; showing it requests nothing and **Use camera** is explicit,
> with file fallback. Camera is therefore conditional, not a first-launch requirement. Installed
> short/build is 8.2.1, bundle `com.christian.codakiller`, strict signature PASS; exact Camera/
> Microphone/Speech strings, DMG/checksum, data preservation and fresh launch pass. Release tag/
> Pushed lightweight tag `v8.2.1` points to
> `971a0d2dc7cf8f093527239e2394391dbbfec0a4`.

> **Important package/install split:** **v9.0.0/schema 21 is a packaged shareable candidate, not
> installed, and clean-recipient acceptance is pending.** Source/build, isolated-store, migration,
> cleanliness, browser visual and final package gates pass. Installation intentionally stopped
> because the live v8.2.1 database has one open session and block. Until that is safely closed and
> the install/native checks pass, the rest of this tutorial continues to describe the app you can
> actually open: v8.2.1. Do not look for the v9 Library controls in the installed app yet.

> **Separate packaged Windows preview:** **v9.1.0/schema 21 is now an exact sendable x64 Setup
> EXE, but it has not been installed or accepted on a real Windows 10/11 system.** The preview
> below is not part of the installed v8.2.1 tutorial. It is keyboard/mouse-first: voice, Listen
> Back, system TTS and volume boost are unavailable, and the Assistant remains off.

**Quick nav:** [Windows v9.1 packaged preview](#-windows-v91-packaged-preview--not-native-accepted) · [Mac v9 packaged preview](#-v9-packaged-preview--not-installed-yet) · [What v8.2 changes](#-what-v82-changes) · [What v8.1 adds](#-what-v81-adds) ·
[First launch](#-first-launch-one-time) · [The screen](#-the-screen-30-seconds) ·
[Main menu](#-the-main-menu) · [Today's Practice](#-todays-practice-the-day-sheet) ·
[The Practice Dock](#-the-practice-dock) ·
[Score](#-use-the-real-score) · [Draw on the score](#-draw-on-the-score-pencil) ·
[Map a score](#-map-a-new-score) · [Sub-sections](#-sub-sections-micro-targets) ·
[Assistant](#-use-the-assistant) · [History, Calendar & Pieces](#-history-calendar--pieces) ·
[Add a score from IMSLP](#-add-a-score-from-imslp) · [Universe](#-read-your-practice-universe) ·
[Settings](#-set-your-defaults) · [A real session](#-a-real-practice-session-the-golden-path) ·
[Voice cheat sheet](#-voice-cheat-sheet) · [The ladder](#-how-the-tempo-ladder-works) ·
[Your data](#-where-your-data-goes) · [Fixes](#-when-somethings-off)

---

## 🟢 Score: page-first, passage-first

> **Installed focused-practice refinement:** v9.1.3 makes the selected-passage Practice set a short launchpad. Tap **Variants** or **Settings** to open the corresponding centered dialog over a blurred score; close it with **Done**, **×**, or Escape. The variant dialog includes **Left hand only** and **Right hand only**.

The installed Mac app is page-first: use the page arrows, Left/Right or Page Up/Down to turn pages; the
two-page view stays an explicit option. Tricky Sections start closed. Select a passage and its
Practice set opens as a closeable floating window above the score; on a short or narrow screen it
rests as a contained bottom sheet. Close it with **×** to return to an uncluttered score. The
passage, history and practice data are unchanged.

---

## 🟠 Windows v9.1 packaged preview — not native-accepted

The sendable candidate is
`/Users/c3/codakiller/releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe` (7,654,002
bytes; SHA-256 `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`). It is unsigned and
has not yet been run on a real Windows 10/11 PC. The installed Mac app described through the rest
of this guide remains v8.2.1. Package implementation is
`2d33004888a97c3ebcb4b7799bf54029efd15626`; release/docs commit
`f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed lightweight tag
`v9.1.0`, and private `origin/main` plus the tag currently resolve to `f296f3c`.

### First Windows launch candidate path

1. Run **CodaKiller-9.1.0-Windows-x64-Setup.exe** as the current user; the NSIS package is
   configured for a per-user install. If WebView2 is absent, setup downloads it; otherwise it uses
   the existing runtime.
2. If Microsoft Defender SmartScreen appears, verify the filename and SHA-256 above before
   choosing **More info → Run anyway**. No code-signing certificate exists, so the installer is
   unsigned. The exact Authenticode/SmartScreen flow has not yet been accepted on Windows 10/11.
3. Open **Pieces → Library → Add Piece**, enter a title, optionally add composer/folder, choose or
   drop a PDF, and add it. A new user should see a blank Library and their own files only.
4. Create a set and use the on-screen **Clean / Sloppy / Again** controls or configured keyboard
   hotkeys. Score, metronome/chimes, History, Calendar and local persistence are the intended core.

### Deliberate Windows limits

- **Mic and hands-free commands are unavailable.** The bundled `hear` recognizer is a macOS
  executable and is not shipped inside the Windows installer.
- **Listen Back is unavailable.** Its microphone-ownership path has not been ported to Windows.
- System TTS and automatic system-volume boost are unavailable. The Assistant stays off.
- The installer is x64 only. Windows on Arm, automatic updates, signed/warning-free distribution
  and voice parity are not claims for this first port.

Package evidence passes: frontend **205 files with 1 skipped / 2,540 tests with 1 skipped**,
TypeScript/build, Mac native **1,111 passed / 19 ignored**, Mac strict Clippy/format, Windows
cross-target check/strict Clippy, recursive blank/share-clean inspection and embedded PE32+ x64.
The package contains no personal files/DB/scores/library/history, personal or unremapped host
paths, or copyrighted pedagogy payload; intentional `/build-user` remapped build paths remain.
Inert migration metadata/identifiers and the bundle id remain to support compatible upgrades, but
Windows upgrade/data preservation has not been exercised. Windows-native cargo tests and real
Windows install/relaunch, picker/PDF/Score/audio, persistence,
Authenticode/SmartScreen and uninstall/reinstall remain **PENDING**.

---

## 🟠 v9 packaged preview — not installed yet

When v9 is released and installed, **Pieces** replaces History as the obvious repertoire tab. The
workspace switch is **Library | History | Calendar**, and Library opens first.

### Add your own piece

1. Open **Pieces → Library → Add Piece**.
2. Enter the piece **Title**. Composer and logical Folder are optional.
3. Choose a local PDF, or drag a PDF onto the app window.
4. Press **Add Piece**. CodaKiller validates and copies the score into the configured Pieces root;
   it does not move or delete your original PDF.

If you want a public-domain score from IMSLP, use **Find a public-domain score on IMSLP ↗**,
download in the browser, return to CodaKiller and choose that PDF. IMSLP is an optional source,
not a required in-app search/edition workflow.

### Organize and manage the Library

- Leave pieces **Unfiled**, or make folders and subfolders with **+**. Folder actions allow New
  subfolder, Rename, Move and Delete. These are logical labels; they never relocate PDFs.
- Choose **Active**, **Completed** or **Archived** above the list.
- Right-click a piece, or press its **⋯**, to Open, Move, Mark complete/Return to active,
  Archive/Restore or Remove.
- Archive is reversible metadata. Remove moves an eligible app-owned piece folder into the
  Pieces `.trash`; the piece disappears from the active Library but practice history stays in
  History. It is not a hard delete.

### First install, upgrade and sharing

A first-ever v9 install starts blank in an app-owned Pieces directory: no user pieces, scores,
practice history, books, quotes, recordings or photos are preloaded. An upgrade preserves the
existing configured Pieces path and database; if an old install never saved the path, v9 infers
the common parent of its existing piece folders rather than abandoning them.

The one normal build is the shareable build—there is no separate friend fork. It removes the
embedded copyrighted pedagogy payload and the Quotes/Reader/Books/passage-helper UI. It does not
delete Christian's external Knowledge and Resources folder or historical Assistant database text.

This v9.0 package candidate supports **Apple-silicon Macs (M1 or newer) on macOS 13+**. It is ad-hoc signed and
not Apple-notarized, so a recipient will need to drag it to Applications, Control-click
**CodaKiller → Open**, and possibly use **System Settings → Privacy & Security → Open Anyway**.
Intel, automatic updates and a no-warning public install are not promised by this Mac package.
The separate packaged v9.1 Windows candidate above does not change these Mac artifact facts.

The final package is `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg` (10,736,628
bytes; SHA-256 `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`).
Its mounted app/share-clean/signature/architecture/notices checks pass. The 720×520 walkthrough is
browser/devMock evidence and does not prove the native file picker, drop, persistence or packaged
launch. The app is not installed because the current live v8.2.1 database has one open session
and one open block; no backup/rollback or installed before/after is claimed. Clean-recipient
Gatekeeper/first-piece acceptance is also PENDING. Never replace the installed app while a
practice set/session is live.

---

## 🆕 What v8.2 changes

Everything below is in the installed v8.2 app.

### Turn score pages

Open **Score** and use the **Previous/Next** arrows, a typed page number, or **PageUp/PageDown**
and **Left/Right** to move through one sheet at a time. Open **Score tools** for **Fit width**,
**Fit page** or the deliberate **2-page view**, plus Draw target, Pencil and mapping.

The PDF and **Tricky sections** rail scroll separately. Scroll the right rail without moving the
score. When you click a section, its Practice composer is brought into view in that rail. Use the
small edge arrow to collapse/restore the rail.

### Choose Clean streak or Total plays

In any Set Composer, find **Set target**:

- **Clean streak** — choose 3, 5, 7, 10 or Custom. This is the existing mastery contract: clean
  attempts must be consecutive; variants/tempo ladder/demotion may apply.
- **Total plays** — choose **5, 10, 15, 25 or Custom**. This is a fixed-tempo volume drill. Target
  BPM, variants, ladder, demotion and review-boundary fields disappear because they do not apply.
  Every Clean, Sloppy and Again counts one; **Undo** removes one.

At N/N the Rep Counter says **Play target complete** and can run the same six-second Set complete
countdown. It is **not mastery**: mixed or sloppy volume work does not earn a mastery badge, enter a
mastered-set count or trigger the mastery celebration. Switching briefly to Total plays does not
erase variant rows you drafted; switch back to Clean streak to restore them.

### Use the smaller controls

Variant presets stay on one sideways-scrollable chip line. Each added variant is a single compact
row with name, consecutive-clean number, arrows and ×. At the bottom of the app, **Paused Sets**
and **Rep Counter** remain direct; open **Tools** for Clock, Dynamics and Rotation.

**Installed in v8.2.1:** From/To and Start/Target BPM share paired rows;
Practice focus sits beside the compact Metronome toggle; target mode sits beside its count; and
**Start set** stays pinned at the top while you scroll optional controls. Press **+ Custom** only
when you need to type a new variant; the editor opens, receives focus, and closes after Add. The
Tricky Sections rail stays the only vertical scrollbar.

## 🆕 What v8.1 adds

Everything in this historical additions section remains available in the installed v8.2 app.

### See progress and motivation

Open **Universe**. Entering it tucks the floating Rep Counter into **Tools** so it cannot cover the
progress overview; the active set stays safe, and **Restore Rep Counter** brings it back.

- **Practice level:** 1 XP = 1 fully completed focused minute. The ring/bar shows exact progress
  to the next deterministic level. Clean/Sloppy/Again quality never changes XP.
- **Badge cabinet:** earned badges come from active days, best streak, focused hours, targets
  revisited on 2+ dates, verified mastery and honest recovery. **Next badges** shows the exact next
  threshold and remaining evidence for each track.
- **28-day cadence:** every date appears, including quiet zero days; shade reflects recorded focus.
- **Progress rails / repertoire:** current focus, days, mastery/revisit/recovery evidence and every
  active/archived piece stay visible. Deleted-file history still counts in lifetime totals.
- **Technique:** Warmups are separate from repertoire but their honest time/sessions appear here.

The old galaxy has been removed. There are no coins, social comparisons, guessed quality scores or
click-to-award progress. A same-session threshold crossing may announce; initial loading does not
pretend that old history was just earned. The installed native Universe passed its 720×520
acceptance check.

### Use faster voice and change rep counts aloud

While an exact set is live, these four two-word forms may act on a partial without the normal
settle wait: **“mark done” / “rep done”**, **“mark sloppy”**, **“mark again”**. Bare **“done”**
and longer natural forms still work through the settled path. The Rep Counter keeps the last three
final transcripts—including ignored speech—so a miss does not disappear.

Counted adjustment examples:

- **“count that”**, **“add a clean”**, **“add two cleans”**, **“add twenty one reps”**
- **“take one back”**, **“take three away”**, **“remove the last rep”**, **“undo four reps”**

Adds record Clean evidence. Undo remains append-only and refuses an excessive count without
partially changing the set. Settings → **Voice & wake-word** exposes **Voice settle delay (ms)**
from 300–2000; Save applies it to the next quiet gap. The short acknowledgement chime remains; spoken
confirmations stay opt-in. These improvements still need voice-over-Steinway acceptance.

### Keep Settings focused while Assistant is off

The default-open **Settings → How to use CodaKiller** guide teaches one hands-free practice loop
and the exact offline command lane. It does not show Assistant confirmation/draft instructions
while Assistant is off. The **Assistant** disclosure still contains its discoverable enable
switch, but provider controls and **Books** stay hidden; **Voice settle delay** lives under
**Voice & wake-word**. Enabling Assistant restores its separate two-lane/provider/Books UI.

### Remap verdict keys live and tune each set

In **Settings → Verdict hotkeys**, enable/disable the set and press a new Clean, Sloppy or Again
key in each capture field. Save. The already-open Rep Counter uses the new mapping immediately;
there is no relaunch. Duplicate/unsafe mappings are rejected. Defaults remain Space / Right Shift /
Return, and keys never fire in text fields or dialogs.

In **Set Composer → Advanced → Tempo demotion**, choose:

- **Use global setting**
- **Off for this set**
- **On for this set**, then set first and later Sloppy thresholds

While practising, use the compact **sub N** −/+ in the Rep Counter to change the live subdivision
from 1–16. This changes the running click pattern; beat unit still labels the entered BPM and never
multiplies/divides it.

### Split one PDF into movements

Open **Score → choose a piece → Piece details → PDF movements**. Enter only a movement title and
its first PDF page, then **Add movement**. The next movement start derives the previous end. Use
the Score toolbar's **Movement** menu to select **Whole score** or one movement; page navigation
and the visible anchored section list follow that scope. No PDF is cut, and sections/history are
not rewritten. To split Beethoven op. 90, enter the actual page-7 start in this UI—nothing is
hardcoded.

### Build and run Warmups

Choose **Warmups** from Today or the rail. Search the visual catalog or filter by demand; use
**Show more** for later cards. Each card has a keyboard figure and concise how-to text. Add items
to today's routine, reorder them, set BPM and consecutive cleans, name it, then **Save routine**.
Choose **Start routine** with no other active set. Warmups use the same Rep Counter, hotkeys,
voice, ladder and verified mastery as repertoire. The runner advances only after the exact expected
warmup set is authoritatively mastered; a full routine celebrates once and contributes real focus.
The installed native Warmups view passed at 720×520 with no overlay or clipping. Entering Warmups
at that compact floor tucks an expanded **Rep Counter** into Tools without pausing or changing its
active set; **Restore Rep Counter** brings it back. Leaving Warmups or growing the window restores
only a tuck Warmups owns, so a manual restore/close wins.

### Review each rep by listening back

In a live Rep Counter, switch on **Review each rep by listening back**. Native voice capture must
fully release before recording begins; while ownership is pending or failed, verdicts are disabled
for safety. The button reads **Start next take** / **Opening mic…** / **Finish take**.

1. Play the take. Space or any verdict button can finish recording, but it does not silently file
   the verdict before review.
2. Listen once, or explicitly choose **Judge anyway**.
3. Optionally tick **Keep after verdict**; otherwise the temporary bytes are discarded.
4. Choose Clean / Sloppy / Again. The next take starts automatically while Review remains on.

Kept takes appear under **N kept takes** with **Listen** and a two-step Delete; playback has an
output-only gain slider. Turning Review off, switching blocks, or closing it releases capture and
restores a user mute that existed beforehand. This records no quality signal—the human still gives
the verdict. Packaged-native permissions and usefulness at the Steinway remain unaccepted.

### Rotate through sections without being yanked mid-rep

From score section actions, add at least two exact targets to **Rotation**. In its Tools panel,
choose station minutes and keep order or shuffle, then Start. At zero the app chimes and prompts;
it never switches a live set automatically. Choose **Next station** when ready. Rotation pauses
only the exact set it opened and verifies that the retrieved next set matches the requested
piece/section. A failed switch stays retryable; completing every station celebrates once.
At 720×520 an unsafe old/collision panel position is pulled to `y=164`, leaving the 56px Tools
band reachable; this does not promise every dock panel can remain expanded simultaneously.

### Archive pieces and write the desired sound

Active pieces are ordered by most recently practised. From Piece Detail choose **Archive** to move
a piece into the collapsed **Archived (N)** group; use **Restore** there to bring it back. This is
reversible and keeps files/history. **Delete files…** is separate, requires the exact name and
moves files to the vault trash while practice history stays. Folders are intentionally not part of
this release—archive + recent-first is the chosen decluttering flow.

In the live Rep Counter, edit the calm **Sound target** line (examples: _sotto voce · grand · like
bells_). It is the old free-text note promoted beside the verdict work, not a piano-audio grade.

### Mapping's honest boundary

**Map measures** now opens after a score is ready and explains whether Anthropic or Gemini is
configured. With neither key, **Start scan** is disabled and tells you to add one in Settings. The
provider-key controls are hidden while Assistant is off, so deliberately enable its Settings
switch long enough to add the key, Save, then switch the Assistant back off if you do not want it.
The intro states that the whole edition is sent; nothing writes until review + Apply. This release
makes the flow reachable and honest; it does not prove mapping on Christian's live scores. No
Anthropic key exists and the post-install live database still has zero map rows.

---

## 🚀 First launch (one-time)

1. Open **CodaKiller** (Applications).
2. **Allow Microphone + Speech Recognition** for voice. If you open an external score or tutorial
   stored in **Desktop**, macOS may separately ask for that folder. Allow it only if you want
   CodaKiller to read files there; declining is valid, but that file will not render/play until
   you choose a permitted location or later allow access.
   No prompts and voice is dead? → [Fixes](#-when-somethings-off).
3. macOS **Dictation must be ON** (System Settings ▸ Keyboard ▸ Dictation).

> ⚠️ The mic/speech prompts can come back after **every rebuild/update** — macOS forgets those
> grants and the denial is silent (the app looks fine, `hear` runs, but no speech ever
> arrives). Just Allow again on first use after any update. The app is ad-hoc signed, not
> notarized — that's expected, not a bug.

## 🗺️ The screen (30 seconds)

**New in v5.0.0: the whole app is a warm paper design system** — this replaces the earlier
pure black-and-white dark theme by Christian's explicit choice. Score marks/Region colors and the
green/red save receipts still carry their own color on top of the paper background.

| Thing                    | Where                                           | What it does                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left rail**            | left edge, 148px, always visible in a workspace | Five visible tabs by default: **Today · Score · Warmups · History · Universe**. **Assistant** appears only if you deliberately enable it. Click to switch; the current tab is the only one highlighted. |
| **Metronome / Settings** | bottom of the left rail                         | Two quiet footer buttons — **Metronome** opens the popover without leaving your tab; **Settings** opens the full preferences panel.                                                                                                                                          |
| **Mic button**           | left rail                                       | **New in v7.0.1.** An always-visible labelled control: reads **"Mic"** while listening, **"Muted"** when you've muted it, and is disabled with a short explanation when voice isn't running at all. The mute backend has existed since v6 — this is the first button for it. |
| **Practice Dock**        | floating, shell level                           | **New in v6.0.0.** The old docked HUD strip is gone — the live set, paused sets, and clock/timer now live in small draggable floating panels. See [The Practice Dock](#-the-practice-dock) below.                                                                            |
| **Save receipts**        | floats at shell level                           | Routine saved/undone/duplicate receipts disappear after **1.5 seconds**. Errors and confirmations stay until dismissed.                                                                                                                                                      |
| **Voice surfaces**       | floats at shell level                           | Mic/STT toast, the wake-cue confirm card, and a **new heard-text pill** near the Rep panel that flashes exactly what the app heard (even when it ignored it) — shell-level, so they never vanish when you switch tabs mid-session.                                           |

**Window awkward?** Settings → **Interface scale** 75–125% (90% is the shipped default). The app
resizes down to 720×520; normal macOS minimize/full-screen still work.

## 🏠 The main menu

**Today is now the app's main menu** — a quiet home screen, not a busy dashboard. It shows the
CodaKiller mark, today's date, a **rotating quote**, and a short list of entries:

- **Today's Practice** → opens the day-sheet window (below). This is where practice actually starts.
- **Score**, **Warmups**, **History**, **Universe**, **Settings** → jump straight to that workspace.
  **Assistant** appears here only if you deliberately enable it.

**The quote line is a doorway.** One hand-picked quote cycles each time you open the app, drawn
from a **curated set of 134 verbatim-verified quotes from 4 pedagogues** (v5.0.0 — trimmed and
re-curated from the earlier, noisier 182-quote set so each quote actually makes a point). **Click
it** and a **scholarly reader** window opens to that exact book section — attribution header, the
quote anchored in place, a few paragraphs of real context around it, Esc/×/scrim to close. Every
quote is machine-verified verbatim against the source; huge or heading-less books are windowed to
the paragraphs around the quote.

## 📝 Today's Practice (the day sheet)

Open **Today's Practice** from the main menu. It's a **window** (Esc or × to close) with the date,
the title, and the metronome quick bar in its header, and — the heart of v4 — a **paper-like day
sheet** you write like a plain-text document. A blank day reads **"Write your practice for the
day…"**.

**New in v6.0.0 — the sheet respects time.** A small **date navigator** (previous / next day +
date picker) sits at the top; past sheets are **read-only**. On any unchecked line, **Carry
forward** copies it to today with a quiet provenance note ("· from Aug 4") — nothing carries
automatically, it's your call each day. A **plan total time** line sums every minute-labeled
block on the sheet live; lines without minutes are counted but listed separately as
unestimated, so the total never pretends to know what it doesn't. When you build a set from
the sheet, its composer can carry an optional **time estimate** ("one pass at this tempo ≈ N
seconds") — CodaKiller turns that into a range like "≈ 12–18 min" across the whole ladder and
feeds it straight into the day sheet's Block-line minutes.

**Just type.** Every line is editable text. The chips are shortcuts that **insert editable text
into the focused line** — they never create a locked widget:

| Chip       | Inserts                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| **mm.**    | a measures / section marker (e.g. `mm. 65–96`)                             |
| **learn:** | a "something to learn" note                                                |
| **♩**      | a tempo                                                                    |
| **25 min** | a timed block (the minutes are editable)                                   |
| **goal** ⚑ | promotes the line to a real **Goal** with a **deadline picker** — one step |

Below the sheet, quiet **+ piece · + lesson notes · + lesson prep** buttons add structure:

- **+ piece** opens **Choose a piece** (search box **"Find a piece…"**) and drops a piece heading;
  under it you type items and add blocks. A passage-helper appears there only if you deliberately
  enable the Assistant.
- **+ lesson notes** adds a one-click **Lesson notes** fold (open/close; text is preserved).
- **+ lesson prep** adds a **Bring to lesson** piece list and a **"What I want from the lesson"**
  box.

**A blank sheet every day.** Past days keep their own sheet (open any date from
[Calendar](#-history-calendar--pieces)). On an empty day a quiet **Copy yesterday** affordance
carries yesterday's sheet forward if you want it.

**One quiet suggested row.** Instead of the old composer/retention boxes, a single **suggested
from retention** row can insert due checks/repairs as lines — it only ever _inserts text_ you can
then edit or delete. Quiet **Open the Calendar / Open Score** entries sit alongside it.

Nothing here fabricates practice: typing a line, checking a box, or promoting a goal is planning
metadata. Only starting a rep set (voice or the block form) writes practice truth.

## 🪟 The Practice Dock

**New in v6.0.0, compacted in v8.2.** The old docked HUD strip at the foot of Today's Practice is gone — tracking
now lives in a small floating panel system so it doesn't take over the screen while you're
reading the score. Two high-frequency panels stay direct:

- **Rep Counter** — the live set: verdict buttons, streak, BPM, ladder. Drag it anywhere, or
  **minimize to a pill** when you're not looking at it (you're at the score, not the HUD, while
  playing). When an ordinary or variant-chain set is mastered, it shows a **six-second closing
  countdown**. Press **Stay open**, make another attempt, pause, or close manually to cancel it;
  otherwise the set closes. A transient close error is retried once, never forever.
- **Paused Sets tray** — every paused set across every piece, one click to resume. Paused sets
  never show up on other pieces' surfaces — only in this tray.
- Open **Tools** for **Clock / Timer** (clock, stopwatch and break timers), **Dynamics** and, once
  targets are added, **Rotation**. Timers keep running while minimized and chime when done. These
  use the same draggable/minimizable panel system. Universe and Warmups at the 720×520 floor
automatically tuck an expanded Rep Counter into Tools so the view stays readable without stopping
the set.

Panel positions and open/minimized state are remembered. Fully keyboard-accessible, and usable
at the 720×520 minimum window.

**Pause across days.** Pause an active set (a button on the set) and it moves to the Paused Sets
tray — durably. Quit the app, come back tomorrow, and it's still there waiting, exactly where
you left it.

**Sessions end per day.** A practice session now auto-closes at local midnight — the next thing
you do after midnight opens a fresh session, and the old one closes retroactively at its last
real event (no phantom overnight "focused time"). Any set still active at rollover auto-pauses
into the tray. **End session** closes only the session and never opens a photo or camera path.
**End my day** asks for inline confirmation, then closes the session and offers the optional photo
card. The voice command “end the session” follows the plain camera-free session-close path.
Pausing/resuming within a single day is unchanged.

## 🎼 Use the real score

Pick a piece (from [Pieces](#-history-calendar--pieces) or a day-sheet heading), then open the
**Score** tab. The top of the workspace has:

- The piece title and two tabs: **Score** and **Plan**.
- A **metronome quick bar**: the metronome icon (opens the full popover), **play ▶ / stop**, the
  **BPM** readout (drag or scroll it to change tempo), and **Tap** for tap-tempo.
- A **piece picker** (top right) to switch pieces.
- **New in v6.0.0 — a goals banner.** One editable line of large text can be pinned above the
  score, per piece (≤140 characters — a cue card like "don't stop until it sings," not a metrics
  panel). Set it in place, or promote a ⚑ goal line straight from the day sheet; edit or delete
  it in place, or dismiss it for just this session (it hides, it doesn't delete).

**Score tab** — the real PDF:

1. It opens one sheet at a time. Navigate with **‹ / ›**, by typing a page number, or with
   **PageUp/PageDown/←/→**. Choose **2-page view** only when you want the spread.
2. Zoom with **− / % / +**. Open **Score tools** for **Fit width**, **Fit page**, or the explicit
   **2-page view**. **Trackpad
   pinch-zoom** works, as does **⌘/Ctrl + scroll** — zoom now scales like an image (no flash, no
   blanking). A zoomed page scrolls within its own pane.
3. The tricky-sections rail is a measure-sorted accordion with its **own scroll**. Click a row and
   its **Practice / Edit / Score marks / Tutorial** tools open; Practice auto-scrolls into view
   without moving the PDF. Use **Edit** for title, notes, measures and color; **Practice** starts
   without re-typing the range.
4. In **Score marks**, choose Box / Highlight / Text note and drag on the actual page. Saved marks
   are clickable and reopen their section. Marks belong to one PDF edition's fingerprint — switch
   editions and the app says **remap** rather than misplacing an old mark. **New in v6.0.0 — snap
   selection:** on a piece with an applied measure map, a drawn box snaps to the nearest bars and
   the measure range fills in for you automatically.
5. **Draw freehand with Pencil.** See [Draw on the score](#-draw-on-the-score-pencil) below.
6. **New in v6.0.0 — map real measure numbers.** See [Map a new score](#-map-a-new-score) below.

**Plan tab** — today's checklist for this piece:

- Header **"Today's plan"**; each item is a checkbox. Checking it here reflects live on the day
  sheet and vice-versa — **checking never counts as a rep**, it's plan metadata.
- Empty piece: **"Nothing planned for this piece today. Add a line, or type it on the day sheet."**
- **"Add a plan item for today…"** adds a line inline. If you deliberately enable the Assistant,
  **"Stuck? Describe the passage."** hands off to its [passage-helper](#-use-the-assistant) here.

## ✏️ Draw on the score (Pencil)

**New in v5.0.0** — the biggest new feature this round, straight from Christian's request "you
need to be able to draw on the score." In the Score toolbar, press **Pencil** to start drawing
freehand directly on the page; the button becomes **Put pencil down** while active.

- **Draw:** click-drag anywhere on the page while pencil mode is on.
- **Undo:** **Cmd/Ctrl+Z** removes your last stroke.
- **Clear this page:** wipes every pencil mark on the current page — asks for confirmation first.
- **Escape** puts the pencil down (same as pressing the toolbar button again).
- Marks are saved **per piece, per edition, per page**, and tied to the exact source file's
  fingerprint. If you re-scan or replace that file, its old marks stop matching the new file (you
  may see a **stale marks** notice while pencil mode is on) — but they are **never deleted**, and
  if you point the piece back at the original file, they come back.
- **Not built this round (declined by Christian):** a highlighter tool, sticky notes, and a
  per-stroke eraser. Pencil is freehand-only for now.

## 🧭 Map a new score

There are now **two** ways a score gets numbered:

**New in v6.0.0 — Map measures (automatic, opt-in).** A **Map measures** button lives in the
Score toolbar and on the piece's Plan surface. This is the one to reach for first:

> **New in v7.0.1: the disabled state now explains itself.** "Map measures" / "Map this score"
> used to just sit greyed out with no reason given. It now says why it's disabled whenever it is
> (e.g. no PDF found yet for this piece) instead of leaving you guessing.

> [!warning] Honest status of this feature (rechecked after v8.1 install, 2026-08-27)
> **You have never actually run this.** The live database's `measure_map` table still holds **zero
> rows** — measure mapping has produced no mapping on any of your real scores. Everything below
> is how it is built to work and how it behaved in testing, not something proven on your vault
> ([[(C) Flaws]] B75).
>
> Two things to know before you try it:
>
> - **No Anthropic key is in this Mac's Keychain**, so the Claude vision path — the intended
>   primary provider — has never run once. Gemini works and is what the acceptance testing used
>   ([[(C) Flaws]] B67). Add a key under service `codakiller`, account `claude` in Settings if
>   you want the Claude path.
> - **Printed-number reading was near-flawless in testing; barline _counting_ was not** — it is
>   least reliable on multi-staff systems. This is exactly why step 3's review gate exists.
>   Check the flagged bars before you press Apply rather than trusting the pass
>   ([[(C) Flaws]] B66).

1. Press **Map measures** — CodaKiller sends the real page images to a cloud vision model
   (needs network, one-time per edition) and gets back systems, barlines, and any printed
   measure numbers it can see.
2. A deterministic pass reconciles that against your score's MusicXML total-bar count where one
   exists, honoring printed numbers as anchors and flagging anything that disagrees (a pickup bar
   shifting the count, a low-confidence read, a continuity break).
3. **Review overlay:** the proposed numbers render right on the score; anything flagged is
   highlighted. Drag or edit any barline or number — its neighbors re-interpolate around your
   edit. Nothing is stored until you press **Apply**; **Cancel** discards the whole pass.
4. After **Apply**, tiny grey measure numbers render at every barline (a **Show measures** toggle
   turns them off/on), and drawn selection boxes snap to bars automatically.
5. If you re-scan or replace the file (its fingerprint changes), the map goes **stale** and the
   app says so plainly — it never silently keeps showing wrong numbers. Partial maps are fine:
   an unmapped page just keeps behaving like it always did.

**The older manual wizard still exists** for any score that isn't (or can't be) auto-mapped —
it offers itself the moment you draw a box on an unmapped page. **The wizard shows the REAL
engraved page** with a **measure strip** running parallel to it.

1. The wizard header reads **"Mark where each system starts."**
2. For each system (line), click its start on the real page and confirm with **Add line**; the
   **Measures** strip tracks it. Wrong entry? **Remove** that anchor.
3. Measure numbers are **pre-filled** where CodaKiller can work them out — a calibration **anchor**
   (exact, on your six pre-mapped pieces), the PDF's **text layer** (tagged "from score"), or a
   **prediction** from your prior lines (tagged "estimated"). Real MusicXML landmarks (key, time,
   tempo, rehearsal marks, pickup-aware) come from the score's own `.musicxml` when present. Every
   value stays editable.
4. Move through pages with **‹ Previous page** / **Skip / next page ›**; **Save mapping** when done
   (or leave it partial — that's fine), **Close** to stop.

**Honest limit:** the automatic pass is much better at reading printed numbers than at counting
barlines exactly, especially on multi-staff (chamber/full-score) systems — that's why Apply is a
human review gate, not a silent auto-commit. The manual wizard's scanned-edition text-layer limit
carries forward unchanged.

## 🔀 Sub-sections (micro-targets)

Use a **spot** for the tiny trouble inside a larger section. It is one level deep and requires no
name, measure typing, dialog, or second drawing pass.

1. Click an **anchored top-level section** to select it.
2. Click **Isolate a spot** on that section.
3. Drag one box fully inside one of the selected section's boxes.
4. Release the pointer. The box is already saved as `Spot N` with its parent, calm colour,
   inferred measures and current score-edition anchor. **Undo** is available for eight seconds.

Measure-map data is used when present. Without it, the app estimates the range from the spot's
position inside the parent's own measures and score box—so the flow still has no typing. If the
box is not fully inside exactly one selected parent, creation does not commit. Each drag now owns
one durable command identity and payload fingerprint: a lost reply gets one retry with that exact
identity, the store returns the already-committed Region, and the same identity with different
geometry is rejected. The same-moment guard still prevents an accidental double release.

- A spot box appears only while its parent or the spot itself is selected. Use the parent's
  persisted **Hide spots** control when you want the score completely clear.
- **Practice this** first refreshes the block list, then resumes the newest paused set with that
  exact spot `region_id`. Two sibling spots with the same measures cannot resume each other's
  set. If none exists, it immediately starts a contextual **three consecutive-clean** set. If a
  different set is active, the app gives a generic conflict explanation and changes nothing.
  Click the spot's list row when you want the full composer instead.
- The **Practice this** chip disappears while target drawing, measure mapping, Pencil, spot
  drawing, or the spot-save itself owns the score pointer. Finish/cancel that mode to bring it
  back; this prevents overlapping canvas actions.
- Old unlinked boxes are shown as children only when their contained measures, matching score
  edition/fingerprint and geometry identify exactly one parent. Explicit links always win;
  ambiguous boxes stay top-level. This compatibility view does not silently rewrite old data.
- All score boxes—parent sections, spots, mapping/create state and temporary atlas targeting—now
  share one interaction layer, so old and new pieces use the same pointer behavior and styling.

## 🤖 Use the Assistant (off by default)

> **CodaKiller ships the Assistant SWITCHED OFF.** Christian asked for it: it was getting in the way,
> and the AI side is really a separate project. With it off, the **Assistant tab is hidden**, the
> passage-helper card disappears from the day sheet and the Score **Plan** tab, and a spoken
> question is simply treated like any unrecognised phrase — **no AI call is made at all** (the
> refusal is enforced in the app's core, not just hidden in the interface). Everything that makes
> CodaKiller work — voice commands, the metronome, rep and set tracking, the ladder, the score,
> Universe progress, streaks and dynamics — is **completely independent of it** and never touched an AI
> model in the first place.
>
> **To turn it on:** Settings → **Assistant** → tick the checkbox. Everything below then applies.

**Assistant** is the renamed practice Brain — same cited Q&A, new name. Its status line says
`● configured — gemini` when a provider is set, or `○ offline — <reason>`; **Test connection** in
Settings does a real probe.

- It's a single-column chat transcript: typed questions, one-glance answers, citation chips. Open it
  from the Score context you're viewing so it sees the exact piece, section, measures, edition/page,
  active set, goals, and recent reps.
- **Per-piece memory persists** across relaunch; **Clear** starts a fresh thread without deleting the
  old one. **Next work** (a disclosure) is deterministic, not AI-generated.
- No-wake voice still works: **"Can you tell me what happened last session?"** routes here after the
  instant-command router declines it. With a section selected, **"I want to do dotted rhythms five
  times on the right hand at 80"** produces an editable set draft — say **confirm** or **cancel**.
- **New in v6.0.0 — honest grounding copy.** If nothing in your books matched a question, the
  Assistant now says plainly **"No book excerpts matched this question"** — never anything that
  reads like your content is being hidden from it. If book-sharing is off in Settings, it says
  **"Book excerpts are kept on this Mac (sharing is off in Settings)"**; if you haven't added any
  books yet, **"No knowledge books are indexed yet."** Answers are also **answer-first now** — no
  "as an AI…" preambles — with citations as a compact tag at the end rather than read aloud;
  citation IDs are never spoken.

**The passage-helper** (in the day sheet under a piece, and in the Score **Plan** tab):

1. Type into **"Stuck? Describe the passage."** and press **Ask**.
2. You get **2–4 one-line grounded strategies**, each with a citation where relevant (e.g. a named
   pedagogue).
3. Each strategy has **Accept · No · More**. **Accept is the only thing that writes** — it appends
   **one checkbox item** to your day sheet and nothing else. **No** dismisses; **More** expands that
   row. A citation opens the [scholarly reader](#-the-main-menu) at the real book section.

## 📒 History, Calendar & Pieces

> **Installed v8.2.1 behavior below.** The v9 candidate reverses this hierarchy to
> **Pieces → Library | History | Calendar** and adds the editable Library described above.

One rail tab (**History**, the renamed Ledger), three switchable workspaces
(**History | Calendar | Pieces**):

**History** — **new in v6.0.0: opens on a Days timeline by default.** One collapsed card per
practice day, newest first ("Tue Aug 4 · 42 min · Scherzo · 3 sets · 2 mastered"), expand for
that day's sets → attempts. The old piece → block → attempts view is still there behind a
**Pieces** toggle. Block set titles are editable inline; attempts are **append-only and
immutable** (a correction keeps the original visible). The read-only anomaly panel is preserved.

**Calendar** — the seven-day week: Goal work, capacity, missed-day recovery, and **open any date's
day sheet**. **New in v6.0.0:** each day cell now shows **planned vs. done** side by side — what
the day sheet had planned for that date next to what actually happened (sessions, focused
minutes, sets touched) — so today's cell doesn't just sit empty anymore. A dated Big Goal shows
as a milestone; recovery never fabricates practice and stays inside deadlines/capacity.

**Pieces** — the piece browser (auto-found from the vault), the intake form for a new piece, the
Goals editor, reference search (Spotify/YouTube), and **[Add a score from IMSLP](#-add-a-score-from-imslp)**.
Active pieces sort by most recent practice. **Archive** is reversible and moves a piece into the
collapsed **Archived (N)** group without touching files or history; **Restore** brings it back.
**Delete files…** is a separate typed-name confirmation that moves files to the vault `.trash`
while the practice history remains.

## 🎻 Add a score from IMSLP

> **Installed v8.2.1 behavior below.** In v9, direct local-PDF import is the normal route and
> IMSLP is only an optional browser link.

**Fixed in v5.0.0** — IMSLP search now actually works from the UI (it was silently broken before).
In **Pieces**, use **Add a score** to pull a public-domain edition from IMSLP without leaving the
app for the search — the actual download still goes through your browser, because **IMSLP
CAPTCHA-gates its files** (this is by design, not a bug, and not bypassed):

1. Search: **"Search IMSLP by title or composer."** Editions load (**"Loading editions…"**; or
   **"No scores found for this work."**).
2. Pick an edition and press **Download in your browser** — CodaKiller opens the real IMSLP page in
   your system browser and shows **"Your browser is finishing the download — clear IMSLP's check
   there."** Clear the one-time bot check / CAPTCHA in the browser and let the file download.
3. Back in the app, set the **Piece folder**, then **Import "{filename}"** — CodaKiller auto-matches
   the just-downloaded file. If it can't, use **Choose the file…**, **…or paste the file's full
   path**, then **Import**. You'll see **"Imported into "{folder}"."**
4. Alternative: under **Have a direct link? Paste it**, drop an `https://imslp.org/…` URL and press
   **Open in browser**. Press **Done** to close.

## ✨ Read your Practice Universe

**Rebuilt in v8.1.0.** The galaxy is gone. Universe is now a compact, evidence-only progress view
that shows what changed and what to do next without inventing rewards:

- **Practice level:** 1 XP = 1 fully completed focused minute. The ring and progress bar show the
  exact next deterministic level; Clean/Sloppy/Again quality never changes XP.
- **Badge cabinet:** badges come only from active days, best streak, focused hours, targets
  revisited on 2+ dates, verified mastery and honest recovery. **Next badges** names the exact
  threshold and remaining evidence for every track.
- **28-day cadence:** every date is present, including quiet zero days; shade reflects recorded
  focus rather than a fabricated score.
- **Progress rails and repertoire:** current focus, days, mastery/revisit/recovery evidence and
  every active or archived piece stay visible. Deleted-file history still counts in lifetime
  totals.
- **Technique:** Warmups stay separate from repertoire while their real time and sessions appear
  here.

Opening Universe tucks an expanded Rep Counter into **Tools** so it cannot cover the overview;
the active set remains safe, and **Restore Rep Counter** restores it. There are no coins, social
comparisons, guessed quality scores or click-to-award progress. A threshold crossed during this
session may announce; loading old history never pretends the reward was just earned.

## 🔥 Day streaks

A day joins your streak once you've logged **10 focused minutes** in it (change the bar in
Settings). Focused time is derived from what you actually did — a 24-second launch poke never
counts. You'll see **"N day streak · best M"** at the top of **Today** and **Calendar** once you
have one.

**Before you have one (fixed in v7.0.1):** the streak line used to render nothing at all — a
blank space with no explanation. It now teaches itself: **"Day 1 starts at 10 focused minutes"**
— 10 is the default threshold and it is configurable in Settings, so the line always shows your
own number, not a hardcoded one. A brand-new install now tells you exactly what earns day 1
instead of looking broken. _(Honest note: there is no screenshot of this zero-state
in the docs — its behaviour is pinned by unit tests only.)_

Yesterday still counts as the anchor while today is young, so the streak isn't declared dead at
midnight before you've had a chance to practise. There is no streak table and no way to edit one —
it's simply a reading of your practice log.

## 📸 Close the day (the photo ritual)

After you confirm **End my day**, CodaKiller offers an optional **photo** of the moment. The card
does not request camera access merely by appearing: choose **Use camera** to request it, or drop/
choose a file without camera permission. A denied, unavailable or failed camera falls back to the
file path. It's a ritual, not a toll: **Esc** or **Skip** dismisses it
instantly and writes nothing. If a day closed itself at midnight, you'll be offered that day's
photo the next time you launch, and if you skip it, it won't nag you again.

Photographed days show their picture in **Calendar**, Liftoff-style — **and keep** their
planned-vs-done numbers. A photo never replaces your practice record.

Photos are ordinary JPEGs in the app's data folder (not in the database); the calendar stores only
a path and a checksum, and a photo whose file has gone missing simply falls back to the bars.

## ✨ Completion animations

Three moments now get a brief flourish: **finishing a set**, **landing mastery**, and **closing
the day**. They're under 1.5 seconds, never block a click, add no new sound, and honour **Reduce
Motion** (you get a still flourish instead).

## 🔊 Dynamics — a loudness meter (v7.0.0)

A new **Dynamics** panel joins the Practice Dock family (open it from the pill bar, drag it
anywhere, minimise it back to a pill).

**What it is, precisely:** it measures **loudness only, forever.** It does not listen for notes,
pitch, rhythm or correctness, and it never grades you or writes anything to your practice record.
This is the one and only feature that lets the mic judge anything, and all it judges is decibels.

1. **Calibrate once per instrument/room.** The wizard walks you through playing **pp, p, mf, f, ff**
   and stores the curve as a named profile ("Steinway, living room, lid half"). Captures must get
   louder each step or it'll tell you which one didn't. Recalibrate whenever you like — a new save
   never overwrites the old curve.
2. **Read the live meter** against your own calibrated pp→ff band.
3. **Target mode** (optional): pick a dynamic, or a crescendo range, and the panel shows the zone
   and where your playing actually landed. It reports; you judge.

The mic is only open while the panel is open — closing or minimising it releases the mic
immediately, and it coexists with speech recognition without either one stealing the input.

## ⚙️ Set your defaults

Open **Settings** (bottom of the left rail), change values, then **Save**:

All sections start closed. Open only the category you need; this keeps the page short and does not
hide or discard any saved setting.

- **How to use Praelude** is an on-demand disclosure with the installed golden flow, offline command lane
  and current limits. Assistant confirmation/draft instructions stay out of this guide while the
  Assistant is off.
- **Interface scale** (75–125%); wake-word requirement/word, coach voice, speech provider, custom
  verdict aliases, Pieces folder, click sound/volume boost, default clean streak, BPM step, and
  Calendar capacity.
- **Voice settle delay (ms)** under **Voice & wake-word** accepts 300–2000. Save applies it at the
  next quiet gap.
- **Verdict hotkeys** lets you enable/disable and recapture Clean, Sloppy and Again. Save updates
  an already-open Rep Counter immediately; duplicate or unsafe mappings are refused. Defaults are
  Space / Right Shift / Return.
- **Assistant** — a single checkbox that turns the separate AI workspace on or off. **Off by
  default.** While off, provider controls, API keys, Test connection and **Books** are hidden;
  practice settings remain visible. Deliberately enabling it restores those controls. Keys then
  live in the macOS Keychain, never the page or SQLite; Books removal moves `.md` files to
  `.trash`, never hard-deletes them.
  **v9 candidate note:** Books/Reader/quote/passage-helper furniture and the embedded pedagogy
  payload are removed rather than merely hidden; this remains installed-v8.2.1 behavior until
  v9 is released.
- **Streak threshold** (new in v7.0.0) — how many focused minutes a day needs to join your streak.
  Default **10**, range 1–240.
- **Tempo demotion** — globally enable/disable the punishment and choose when it fires. Default:
  enabled; first pullback after **3 Sloppy reps** (range 2–10), then every **2 Sloppy reps**
  (range 1–10). Only Sloppy counts. Each set can inherit this global rule, turn demotion off, or
  supply its own first/later thresholds in Composer → Advanced.
- **Speak confirmations aloud** — default **off**. Off keeps the short acknowledgement chime but
  suppresses spoken routine command replies; on restores speech. It applies immediately and does
  not change what the microphone hears. The Assistant's off switch is separate.
- **Appearance → "Reset panel layout"** (new in v6.0.1) — clears the persisted position/size of
  every floating dock panel (including Rep Counter, Paused Sets, Clock/Timers and newer tools) and
  restores each one's default position AND its open/minimized state in one click. Use it if a panel is ever dragged
  somewhere awkward or off-screen.

Interface scale applies after Save. Verdict hotkeys, spoken-confirmation choice and settle timing
update live; speech provider and wake-word changes apply after relaunch.
**Search Spotify / Search YouTube** in a piece opens an explicit encoded search — no autoplay,
scrape, or download.

**Per-set click shape lives in the Set Composer, not global Settings.** Open **Advanced** to pick
a beat-unit label, beats per bar and subdivision (beats/bar and subdivision accept 1–16). The beat
unit is only the printed note-value label for the BPM you entered; it never multiplies or converts
the click rate. Reopening a set restores these values, and starting/resuming retunes a running
same-BPM metronome when its meter or subdivision differs. While the set is running, use the compact
**sub N** −/+ in the Rep Counter to change subdivision from 1–16 immediately. Tempo demotion's
inherit/off/set-local choice is in the same Advanced panel.

**Set target:** choose **Clean streak** (3/5/7/10/Custom) for quality-governed mastery, or **Total
plays** (5/10/15/25/Custom) for fixed-tempo volume. Total plays hides controls that do not apply,
counts Clean/Sloppy/Again equally and lets Undo remove one. It completes the set but never counts
as mastery.

**Variant chains:** add the stages in the order you want to practise them. Presets stay in one
horizontally scrolling line and every added stage stays one compact inline row. Each stage asks for
**Consecutive cleans**, not a loose rep count. Old saved variants that used `reps` still reopen
with the same requirement. When one stage is cleared, the HUD moves to the next stage instead of
mastering the whole set.

**Installed in v8.2.1:** Start is available in
the pinned composer header; core values are paired into compact rows; custom variant typing stays
hidden until **+ Custom**. Scroll the Tricky Sections rail itself—there is no second form scrollbar.

**First launch after the v6.0.1 upgrade:** if a dock panel was left sitting over the score
toolbar before you upgraded, it now comes to the **front** on the next launch — that's a fix
(panels used to render invisibly behind the page), not a bug. A muscle-memory click in that spot
could land on a now-visible rep verdict button instead of a score control; rep has **Undo** if
that happens.

## 🎬 A real practice session (the golden path)

1. **Main menu → Today's Practice.** Write today's plan on the day sheet: **+ piece**, drop items,
   add a **25 min** block or two, flag a **⚑ goal** if there's a deadline.
2. **Pick the piece and sit at the piano. Say:**
   > _"open a rep tracker, measures 40 to 56, start at 80, target 120"_
   > The block opens, the metronome starts, and the Practice Dock's Rep Counter panel shows the
   > clean-streak target.
3. **Play the passage. Then say one word:** **"done"** (clean ✅), **"sloppy"** (rough 🟡), or
   **"nope, missed the LH jump"** (Again/failed ❌ — your note is saved). Routine confirmations
   are a short chime by default; turn on **Speak confirmations aloud** only if you want words.
4. **Lost track?** _"where are we."_ When the set is mastered, a six-second countdown appears;
   use **Stay open** to keep playing, otherwise it closes itself. You can still say _"close the
   block"_ at any time.
5. **Stuck on one tiny place?** Select its parent section in Score → **Isolate a spot** → drag one
   contained box → **Practice this**. No naming or measure typing.
6. **Done practicing?** Close any live block, then say _"end the session"_ — the session's full
   story exports into the piece's vault folder. Closing the window does the close-before-export for
   you.

## 🗣️ Voice cheat sheet

Same **"Coda"** wake word for Assistant questions and command grammar as before, but **the
metronome half got a real overhaul in v6.0.0** — this is the fix for "metronome commands are
terrible" and "delayed by 5 seconds."

**New in v6.0.0 — fast, natural, and honest about what it heard:**

- **Fast path.** "metronome on", "metronome off", "metronome stop" now act on the **partial**
  transcript the instant they're recognized — target under a second from when you stop talking
  to when the metronome changes state, instead of the old ~5-second wait.
- **New in v8.1.0 — fast live-set verdicts.** **"mark done" / "rep done"**, **"mark sloppy"**
  and **"mark again"** can act on a partial without the normal settle wait. Bare **"done"** and
  longer natural forms still wait for a final transcript. The Rep Counter keeps the last three
  final transcripts, including ignored speech.
- **Speech is opt-in.** **Speak confirmations aloud** is off by default, so routine recognised
  commands—including Sloppy/Again, restart and set actions—answer with the short acknowledgement
  **chime**, not words. Turn it on in Settings if you want spoken confirmations. Input and command
  recognition do not change; errors still remain visible, and the Assistant stays separately off.
- **Looser, more natural phrasing.** "turn the metronome on," "can you stop the metronome,"
  "please turn off the metronome" all work now, and so do ASR mangles like "metranome,"
  "metrodome," or "metro gnome." Bare courtesy words alone — "okay stop," "hey faster" — are
  **deliberately** still ignored; a command needs the actual metronome word or an unambiguous
  verdict word to fire, so casual conversation near the mic stays safe.
- **Combined tempo + on/off now works.** "metronome on ninety six" sets the tempo AND starts the
  click in one breath. Previously the fast-path tail guard swallowed the tempo when it arrived in
  the same breath as "on"/"off," so this needed the workaround "metronome 96" said on its own —
  that workaround is no longer needed (fixed in v6.0.1, [[(C) Flaws]] B70, RESOLVED).
- **A heard-text pill** near the Rep panel flashes **everything** the app heard, including
  speech it decided to ignore — so a miss is visible the moment it happens instead of a silent
  mystery. Honest limit, stated in-app: quiet-speech pickup is the macOS speech engine's job,
  not CodaKiller's — the app can show you what it heard, it can't hear better than the OS does.
- **New in v7.0.1 — a small "app" latency figure on the heard pill.** It measures the app-side
  time from the first words macOS gave the app to the action actually being done (metronome
  toggled, rep logged, etc.). **What it explicitly does NOT include:** how long the Mac itself
  took to hear you in the first place — the "hear" pipe carries no timestamps, so that part is
  invisible to the app and has to be hand-timed at the piano if you want it. The label says
  "app" and the tooltip states the exclusion, on purpose — this is not a full round-trip number.
- **A warmer, steadier coach voice.** The default cloud voice is now **Aoede**. If the cloud
  voice fails, it now **retries after a cooldown** instead of locking to the robot `say` voice
  for the rest of the session; a quiet **"Voice degraded — using system voice"** pill shows in
  Settings and the shell while it's down, and clears the moment the cloud voice recovers.

**Anytime:**

| Say                                                                     | Happens                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| "metronome 96" / "turn on the metronome at one twenty"                  | starts at that bpm                                           |
| "metronome on" / "metronome off" / "metronome stop"                     | resume / stop — fast path + chime                            |
| "turn the metronome on" / "can you stop the metronome"                  | same as above, natural phrasing                              |
| "tempo 140" · "bump it up 4" · "take it down two" · "faster" · "slower" | set / nudge tempo                                            |
| "accent every 3"                                                        | accent pattern                                               |
| "go to page 12"                                                         | jumps the open score, silently                               |
| "go to measure 117"                                                     | jumps to the smallest mapped section containing that measure |
| "open a rep tracker, measures 40 to 56, start at 80, target 120"        | opens a block on the selected piece                          |
| "end the session"                                                       | saves + exports after the live block is closed               |

**Only if you deliberately enable the Assistant:** ask a clearly assistant-directed question, or
with a Score section selected request a bounded set (_"dotted rhythms five times, right hand, at
80"_) → a **confirm card** with spoken readback. Say **confirm / go ahead / start the set** or
**cancel**. Edits on the card are what confirm applies. Bare **yes/no never confirm** (those belong
to the verdict lane). Ambient speech that is neither a command nor clearly assistant-directed stays
inert.

**Only while a block is open:**

| Verdict   | Words that count                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| ✅ clean  | "done", "clean", "got it", "nailed it", "perfect", "good", "yes", "yep" — chime by default                       |
| 🟡 flawed | "sloppy", "rough", "shaky", "almost" — chime by default                                                            |
| ❌ failed | "again", "nope", "no", "missed", "messed up", "failed" — add anything after it and it is saved as a note; chime by default |
| ℹ️ status | "where are we", "how many left", "status" — chime by default; the visible HUD carries the answer                    |
| 🚪 close  | "close the block", "end the tracker"                                                                                |

Counted correction is also voice-controlled: **"count that"**, **"add a clean"**, **"add two
cleans"**, or **"add twenty one reps"** append Clean evidence; **"take one back"**, **"take
three away"**, **"remove the last rep"**, or **"undo four reps"** append the matching reversal.
An excessive undo is refused as a whole instead of partially changing the set.

Close the tracker or mute the mic before unrelated conversation; Dock buttons (Clean / Sloppy /
Again) use the same path.

## 📊 How the tempo ladder works

- **Total plays does not use the ladder.** It holds the entered start tempo and counts every
  effective verdict to its chosen total. Use Clean streak when you want tempo advancement or
  verified mastery.
- **Only a consecutive clean streak climbs the ladder.** The required streak shows in the HUD
  (default five); completing it advances by the configured BPM step, capped at the target.
- **On a Tempo set climbing to a higher target:** while **below** target, the big HUD number is the
  **rung** streak (the cleans-in-a-row to step up), and it moves on **every** clean, with a
  "Climbing to ♩{target} — then {N} clean in a row" caption. At the **target** it switches to the
  **N-in-a-row at target** mastery proof. (Fixed in the 2026-07-22 hotfix — it used to sit frozen at
  "0/N" while climbing; B39.)
- **Tempo can also move down.** Sloppy resets the clean streak and counts toward demotion: by
  default the first run of 3 Sloppy reps pulls the click back one rung; each later run of 2 does
  it again, never below the set's start. Change the global default in Settings, or make one set
  inherit it, turn it off, or use its own thresholds in Composer → Advanced. Again does not count.
- **A variant chain is the mastery contract when present.** Each stage shows its own consecutive-
  clean requirement. Clearing it advances to the next named stage. Sloppy/Flawed resets only the
  current stage; Again/Failed neither advances nor resets it. Earlier stages stay cleared, and
  the whole set masters only after the final stage. No-chain sets keep the ordinary clean-streak
  contract.
- No target → the metronome just holds the start tempo. Pick a non-Tempo **focus** (Notes,
  Phrasing, Dynamics, Memory, Hands/coordination, Other) to practise without chasing BPM.
- At final mastery, the six-second **Closing… / Stay open** countdown begins. A new attempt,
  pause, manual close or Stay open cancels it; otherwise the set closes. One transient failure is
  retried once and a second failure stops—there is no retry loop. Choosing recovery cancels the
  countdown before the recovery write starts, and the timer checks the live set again before it
  closes.
- The short **stage chime** plays only when a newly recorded Clean genuinely advances to another
  intermediate variant—including a first stage that requires one Clean. Undo, final mastery and
  extra Cleans never replay it.

## 📁 Where your data goes

- **Session summaries** → `Pieces/<piece>/(C) codakiller-sessions.md` — append-only. Your own notes
  in the piece folder are **never touched**.
- Pieces, archive state, movements, Regions, goals, Calendar work, blocks, reps, edition choice,
  marks, pencil marks, mapping anchors, Warmup routines, Sound targets, day sheets and per-piece
  plans live in the installed app's private **schema-20** database, which distinguishes Total
  plays from mastery. Score geometry stays tied to piece +
  edition + page + file fingerprint. Assistant threads also live there only if you enable the
  Assistant.
- **Listen Back:** unkept take bytes are discarded. Kept audio stays inside app-owned replay
  storage and is listed from its rep; deleting it uses the app's two-step confirmation.
- Books you add are copied into your **Knowledge and Resources** folder as `.md`; removal moves the
  file to `.trash`, never deletes. Source PDF/video/book files are never modified or stored in the
  database; knowledge indexing is read-only. The separate **Delete files…** piece action can move
  piece files to vault trash only after you type the exact name; it preserves practice history.
  **This is installed-v8.2.1 behavior.** The v9 candidate removes Books/knowledge indexing and
  bundled quotes/methods from the app, but deliberately does not delete the external folder or
  historical Assistant turns.

## 🔧 When something's off

| Symptom                                                    | Fix                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice does nothing, no error                               | Mic permission died silently (happens after every rebuild). Terminal: `tccutil reset Microphone com.christian.codakiller` and same with `SpeechRecognition` → relaunch → Allow ×2. |
| Banner: "Dictation" / Code 201                             | Turn ON System Settings ▸ Keyboard ▸ Dictation.                                                                                                                                    |
| It misses commands while clicking loudly                   | Speak up / closer to the Mac, or pause playing for the command.                                                                                                                    |
| "Pick a piece first."                                      | Click a piece in Pieces before voice-opening a block.                                                                                                                              |
| Score says **No PDF score found**                          | Add a PDF inside that piece's `score/` folder (or use **Add a score** from IMSLP), then **↻ Scan**.                                                                                |
| Score shows a PDF loading error                            | Press **Try again** once; if it repeats, switch editions and record the failing filename.                                                                                          |
| A Region says **remap**                                    | The selected PDF changed. Map that Region again for this edition.                                                                                                                  |
| IMSLP download won't start                                 | Clear the one-time bot check **in your browser** — CodaKiller can't bypass it. Then Import the downloaded file (auto-match, picker, or paste path).                                |
| Enabled Assistant says `○ offline — <reason>`              | Settings → **Assistant** → **Test connection** for the exact model/latency or error; verify the API key.                                                                          |
| Enabled Assistant says knowledge unavailable / 0 sections  | Settings → **Assistant** → **Books**: confirm your books are listed as regular `.md` files.                                                                                        |
| Coach voice sounds robotic / a "Voice degraded" pill shows | Cloud TTS failed → fell back to the system voice. It now retries after a cooldown on its own — practice on; the pill clears when the cloud voice recovers.                         |
| Session didn't export                                      | Only sessions that touched a piece export; an abrupt quit defers it to next end-session.                                                                                           |

## 🧭 The one rule underneath everything

**You are always the judge.** Listen Back can record a take so _you_ can replay it, and Dynamics can
measure loudness only; CodaKiller never interprets the piano as notes, rhythm, correctness or a
quality grade. It counts, times, remembers, structures, and runs the metronome.

---

_Next action: open **Warmups**, build a short routine, practise one set, then open **Universe** to
see the focused-minute progress it actually earned. Try **Review each rep by listening back** only
after granting the fresh microphone prompt. · Full project map: [[(C) Praelude Command Center]] ·
Problems → [[(C) Flaws]]_


## Next steps

Use the current tutorial; do not follow superseded UI/package instructions here.
