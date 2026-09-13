# Pre-v11 roadmap handoff — historical snapshot

Archived during the 2026-09-07 living-doc correction. This is historical text, not current instructions or install status.

# Praelude — Roadmap

**Native launch limit:** v10.1.0 freshly launched and its database is unchanged, but Score is waiting at “Finding score editions…” for renewed macOS Desktop-folder permission. TCC logs at 22:43:01 explicitly show the old code requirement mismatch and Desktop prompt; Speech Recognition also re-prompted. Christian must click Allow on the Desktop prompt, then the native Variants surface check can finish. The computer-use tool cannot accept that OS permission window; browser QA is not native acceptance.

> **Last updated: 2026-09-07 — Praelude v10.1.0/schema 21 SHIPPED + INSTALLED.** Variants now has Manage variants for permanent custom shortcuts and show/hide controls, plus named ordered routines with saved stage clean counts. Selecting a routine copies it into the draft. Full frontend (2,554 passed / 1 skipped), native (1,088 passed / 17 ignored plus integrations), strict lint, builds, independent compact/desktop UI review, package/signature/one-copy and exact data-preservation checks pass. Next: grant the renewed Desktop prompt and finish native Variants verification, then Christian’s real-use verdict; Windows native acceptance and microphone/Steinway evidence remain separate.


> **Historical overview through v10.0.4 follows; current status and next steps are above.**
> The build plan and what's next. Phases end **usable + verified**. Each version maps to a
> phase span; every phase block ends with concrete next steps so the next session never has to
> guess where to pick up. Canonical phase definitions live in the design spec
> (`~/praelude/docs/superpowers/specs/2026-07-09-codakiller-design.md` §7); this doc tracks
> **status + next steps**. **Last updated: 2026-09-04 — Praelude v10.0.4/schema 21 is installed
> on Mac.** The visible rename and dark interface overhaul passed all release gates;
> `/Applications/Praelude.app` is running, the old app copy is gone, and the live database is
> byte-identical before/after install. The installed v10.0.4 correction repairs the short-wide
> Score strip: it only reflows at genuinely narrow widths, gives every passage/practice control a
> stable slot and gives the active-set notice its own row. The prior v10.0.3 correction makes Tricky Sections a
> clean finder only—no passage inspector can expand in that rail. **Passage tools** in the selected
> passage strip opens a focused centered Edit / Score marks / Tutorial surface; beginning a mark
> closes it and puts the drawing controls in a compact top bar over the score. It sits atop
> v10.0.2's in-flow horizontal Practice set strip and v10.0.1's
> tiered local rep/set/chain/mastery sound-and-animation hierarchy, a 100%-minimum centered Score,
> persistent Tricky Sections and collapsible global navigation; the full release gate and
> post-install data audit pass. The canonical local project is now `~/praelude`, its vault is `Piano Practice/Praelude`, and private remote is `cchow375/praelude`; legacy data identifiers deliberately remain compatibility-only. Next is Christian's real-use layout verdict, then native
> Windows acceptance and a Praelude-branded Windows build. Historical boundary: v9.1.0/schema 21 WINDOWS x64 PACKAGED
> SENDABLE CANDIDATE; WINDOWS-NATIVE/RECIPIENT ACCEPTANCE PENDING.** The exact unsigned
> current-user NSIS installer is 7,654,002 bytes with SHA-256
> `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`; recursive share-clean
> inspection and PE32+ x64 payload checks pass. Frontend 205 files/1 skipped and 2,540 tests/1
> skipped, TypeScript/build, Mac native 1,111/19 ignored, Mac strict Clippy/format, and Windows
> `cargo-xwin check`/strict Clippy pass. Windows-native cargo tests and Windows 10/11 install,
> relaunch, picker/PDF/audio, Authenticode/SmartScreen and persistence acceptance remain pending.
> Implementation `2d33004888a97c3ebcb4b7799bf54029efd15626` produced the package; release/docs commit
> `f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed lightweight tag
> `v9.1.0`, and private `origin/main` plus the tag currently resolve to `f296f3c`.
> The first Windows port deliberately disables voice, Listen Back, system TTS and volume boost.
> The published app remains v8.2.1/schema 20. The packaged Mac v9.0.0/schema-21 candidate and its
> evidence below are unchanged. v9 makes Pieces the
> Library-first workspace, adds direct PDF intake/nested logical folders/library states, and
> removes embedded copyrighted pedagogy plus Quotes/Reader/Books/method UI from the one generic
> distributable. Source/build, independent cleanliness, isolated fresh-store, exact-copy schema
> rehearsal, 720×520 devMock and final package gates pass. The 10,736,628-byte DMG verifies at
> SHA-256 `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`. Install is blocked by one live open session
> and block; clean-recipient proof and install evidence remain pending. Package implementation
> commit `709542023b3e3bf0c9e72189d145e5fd524eaacd` is packaged. Release/docs commit
> `6a560eeae328e7cb44019058c319f0617aa5372e` is the exact target of lightweight tag `v9.0.0`
> and private `origin/main`; both pushes succeeded. The last
> installed runtime `496033e677919757ef1f2a78cee32d3abedb4805` fixes B94's
> compact composer and resolves B95:
> installed session 48 closed with data preserved, then TCC aborted because an automatic camera
> request met a packaged plist without `NSCameraUsageDescription`. Plain End session is now
> camera-free; only confirmed End my day offers an inert photo card and explicit Use camera, with
> file fallback and truthful plist/release gates. Final frontend 2,684/1 skipped, native 1,109/19
> ignored, builds, release pipeline, installed identity/privacy/signature, artifact, data and fresh
> launch all pass. Pushed lightweight tag `v8.2.1` points to
> `971a0d2dc7cf8f093527239e2394391dbbfec0a4`.
> The v8.2 base source
> `afe65f3b176a1c5da81eca6d2f65bd721726ee40` delivers the v8.2 UI-friction
> correction: continuous virtualized Score, independent Tricky Sections scrolling/auto-reveal,
> compact Score/dock/variant surfaces, and honest Total plays presets 5/10/15/25/Custom. All release,
> artifact and live-migration gates pass. Pushed lightweight tag `v8.2.0` points to
> `5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
> documentation-only corrections, and its exact current tip must be read from Git. The immutable
> tag/runtime source remain unchanged. Real
> WKWebView microphone/Steinway and provider mapping acceptance remain open. Hub:
> [[(C) Praelude Command Center]].

**🟢 Aug 8 overhaul train — SHIPPED + INSTALLED in v8.1.0.** Christian approved spec rev 2
(`~/praelude/docs/superpowers/specs/2026-08-24-aug8-practice-overhaul-design.md`) and answered
its eight open questions the same day (see the v7.0.1 section below). The train is **P0
Stabilize & Reveal (SHIPPED as v7.0.1) → P1 Practice Set Core (SHIPPED as v7.1.0) → P2
Micro-Targets v2 + corrective work (SHIPPED as v7.2.0) → P3 Voice + P4 Score Map (v17) + P5
Warmups (v18) + P6 Review & Flow (v19), combined in the **installed v8.1.0 release**. The
denominator correction is 23 asks, not 21. Assistant OFF and archive+recent-first/no-folders were
accepted **for v8.1**. Christian explicitly reversed the no-folders/IMSLP-first product decisions
in his 2026-08-30 voice feedback; v9 adds logical folders and direct PDF intake without rewriting
that historical record. Christian's next UI verdict created a separate v8.2 corrective release; it
does not reopen or change the 23-ask denominator.

## Current handoff — real-use verdict, then native Windows proof

### Source correction awaiting a package boundary (2026-09-03)

The next source build has more rewarding but non-load-bearing feedback: every committed verdict
gets a local acknowledgement, Clean a small button bloom, completed sets a rising fanfare,
variant-chain stages a more prominent three-note/visual flourish and mastery the fullest landing.
All audio is offline and best-effort. Score opens at no less than 100%, centers its page, keeps
Tricky Sections visible and uses the global rail arrow to recover reading width.

**Next steps:** take a real-use verdict on the selected-passage strip at normal and short desktop
heights, the centered Passage tools flow, top score-mark bar, a Clean rep, set finish,
variant-stage advance, 100% Score and collapsed/expanded navigation. Do
not relabel the separately pending Windows candidate as accepted.

### Shipped product identity and interface overhaul (Praelude v10.0.0, 2026-09-03)

Praelude is installed at `/Applications/Praelude.app` with a dark-by-default, system-sans,
restrained interface across Today, Pieces, Score, History, Calendar, Universe and Settings.
Implementation `e67b3c2`; full automated, visual, package, signature, one-copy and data-preservation
gates pass. Hidden legacy identifiers remain for compatibility only.

**Next steps:** Christian uses the installed app and gives a visual/interaction verdict. Address
only concrete real-use friction, then build a Praelude-branded Windows candidate and run the
existing Windows 10/11 native acceptance boundary; do not relabel the older v9.1.0 EXE.

### Shipped Mac correction — Score clarity (v9.1.3, 2026-09-03)

The installed Mac app now uses a page-first Score reader and passage-selected floating Practice
set window; Tricky Sections are optional and closed initially. The full release gate, clean
package and post-install integrity audit pass. It has no schema/data change and does not alter the
exact Windows v9.1.0 package.

**Installed follow-up (v9.1.3, 2026-09-03):** Christian then rejected the visible variant chain and full form as a text-heavy wall. The installed Mac app makes the passage panel a short start surface; **Variants** and **Settings** open separately in centered blurred-background dialogs. Variant choice is quick multi-select and adds Left hand only / Right hand only. Full release and post-install data gates pass; real-use visual verdict remains the next step.

#### Next steps

Get Christian's real-use visual verdict on the installed Mac reader. Do not rebuild or relabel the
already-hashed Windows v9.1.0 installer; native Windows acceptance remains the independent lane.

**v9.1.0/schema 21 is now one generic, blank/share-clean, x64 current-user NSIS Setup EXE**, but
it is not installed or accepted on a real Windows 10/11 system. Exact package:
`/Users/c3/codakiller/releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe`, 7,654,002
bytes, SHA-256 `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`, UTC
`2026-08-31T19:31:59Z`, implementation commit
`2d33004888a97c3ebcb4b7799bf54029efd15626`. Release/docs commit
`f296f3cb38ae5d29c1ae813493f5c37ea07ed9a6` is the exact target of pushed lightweight tag
`v9.1.0`; private `origin/main` and the tag currently resolve to `f296f3c`. It includes direct local-PDF intake, nested logical
folders, Unfiled, Active/Completed/Archived, right-click/ellipsis actions, Score,
keyboard/mouse practice, metronome/chimes, History, Calendar and local persistence.

Platform-specific source work removes macOS-only assumptions from score URLs, browser/file
actions, picking, path separators, Windows-safe folder names, page-cache replacement and directory
sync. The Windows bundle must not contain the Mach-O `hear` binary. Because a real Windows speech
and audio-ownership implementation does not exist, **Mic, hands-free commands and Listen Back are
unavailable** in this first port; Settings and practice surfaces must say so plainly. macOS `say`
and the automatic system-volume boost also do not apply.

Evidence retained: frontend **205 files with 1 skipped / 2,540 tests with 1 skipped**, TypeScript
and production build; Mac native **1,111 passed / 19 ignored**, strict Clippy and format; Windows
cross-target check and strict Clippy; NSIS construction; PE32+ x64 payload; recursive blank/
share-clean artifact scan. The narrow privacy scan finds no personal files/DB/scores/library/
history, personal or unremapped host paths, or copyrighted pedagogy payload; intentional
`/build-user` remapped build paths remain. Inert historical migration metadata/identifiers and the
bundle id remain to support compatible upgrades, but Windows upgrade/data preservation has not
been exercised. Windows-native cargo tests were **not run**. No
certificate exists, so the exact candidate is unsigned and SmartScreen may intervene; native
Authenticode/SmartScreen behavior is still pending. WebView2 downloads only when absent. The
canonical package path is Tauri's documented macOS cross-build; the GitHub workflow was removed
because the available token lacks `workflow` scope. The ASCII `C` locale initially crashed
Unicode NSIS with misleading `bad_alloc`; `C.UTF-8` fixed the packaging environment.

### ⟶ Next steps

1. Install the exact hashed EXE on clean Windows 10 and Windows 11 systems. Verify
   Authenticode/SmartScreen, first
   launch, blank Library, Add Piece/PDF, Score, folder/state/context actions, practice/history
   persistence and uninstall/reinstall.
2. Run Windows-native cargo tests and record native picker, PDF/Score, metronome/audio, relaunch
   and local persistence evidence; do not infer any of these from the cross-build.
3. Keep the draft record mutable until the native recipient gates pass. Voice, Listen Back,
   system TTS and volume boost remain a separate future Windows-audio project.

## Parallel Mac handoff — safely install and recipient-test the packaged v9.0 candidate

The tracked tree is a **v9.0.0/schema-21 packaged shareable candidate**, not an installed release. It uses one
generic build rather than a friend fork. A fresh user begins with an empty app-owned Pieces root;
an upgrade keeps the saved Pieces path or conservatively infers it from existing piece rows. The
new top-level Pieces workspace opens **Library | History | Calendar** and offers nested logical
folders, Unfiled, Active/Completed/Archived views, right-click/ellipsis actions, direct title +
optional composer + PDF intake and optional external IMSLP handoff. Remove moves app-owned files
to `.trash` and preserves historical rows. Logical folder changes never move scores.

The distributable source no longer contains the embedded Books/method payload, quote set or the
Quotes/Reader/Books/passage-helper UI. The scope is deliberately non-destructive: Christian's
external `Knowledge and Resources` folder and historical `brain_turn` content are not deleted.
Independent review and the package scans prove no personal DB/SQLite/sidecars, scores, quote/book/
method payload, devMock or personal path/name enters the app bundle. Support is Apple
silicon/macOS 13+; the artifact is ad-hoc signed and
not notarized, so first open requires Control-click Open or Privacy & Security → Open Anyway.

Verified package-only evidence: frontend **204 files / 2,525 tests passed with 1 file / 1 test
skipped**; TypeScript/build pass; native **1,077 passed / 17 ignored / 0 failed** plus integration
suites; five corpora, format, strict Clippy and native build pass. The isolated on-disk fresh store
passes twice at schema 21/integrity OK/FK0 with blank Library/folders and zero user data. The exact
disposable schema-20 copy migrates to 21 with integrity/FK0 and **11 pieces / 255 blocks / 2,315
reps / 51 sessions / 9,173 events** preserved; new folders/assignments/completions are zero.
The 720×520 devMock Pieces walkthrough passes after one clipped folder menu was fixed/retested
4/4; it is not native picker/drop/persistence evidence. The final package passes strict ad-hoc
signing (CDHash `33ffc5fade7ecb090c5fd7b08818ae82164cbc21`), arm64/macOS-13 identity,
`hdiutil verify`, exact four-entry mounted layout and app/DMG cleanliness. The 10,736,628-byte
DMG's SHA-256 is `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`;
full hear BSD, React/Tauri MIT and PDF.js Apache notices are verified top-level and byte-identical
inside the app.

The installing release script can quit and replace the installed app. The **2026-08-30 19:25 EDT**
live read-only audit is schema 20, integrity OK/FK0, **11 pieces / 255 blocks / 2,327 reps / 51
sessions / 9,241 events**, with **one open session and one open block**. Installation was therefore
intentionally not run; no fresh backup/rollback, one-copy audit, installed before/after or native
launch is claimed. The package-only script never touches `/Applications`.

### ⟶ Next steps

1. Christian closes or deliberately preserves the open session/block in v8.2.1. Repeat the
   zero-open audit, then create a fresh database backup and v8.2.1 rollback archive.
2. Install only after that safety gate; record exact before/after data, one-copy and native launch,
   then exercise native picker/drop/persistence and Library interactions.
3. Prove the exact DMG's Control-click/Gatekeeper and first-piece path on a clean Apple-silicon
   macOS 13+ Mac; freeze the draft record only after install plus recipient acceptance. The
   package-boundary commit/tag/private push are already complete.

## Last proven installed handoff — published v8.2.1

v8.2.1 is installed from `496033e677919757ef1f2a78cee32d3abedb4805`. It fixes B94's compact
composer and B95's fatal camera/TCC close path. Session 48 is durably closed;
six retained v7.0–v8.2 reports share the missing-camera-description signature. Source separates
plain End session from confirmed End my day, starts the photo card inert, gates camera on explicit
Use camera, falls back to files, adds the truthful camera key and checks all three privacy strings
at release. Full frontend 2,684/1 skipped, native 1,109/19 ignored and all release/install/data/
fresh-launch gates pass. Pushed tag `v8.2.1` points to
`971a0d2dc7cf8f093527239e2394391dbbfec0a4`.
A cold session must not rebuild the continuous Score,
independent rail, compact toolbar/dock/variants or Total plays. Frontend is 2,678 passed / 1
skipped and native 1,109 passed / 19 ignored, with TypeScript/build/format/strict Clippy clean.
The exact schema-19→20 rehearsal preserved 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283
events with integrity OK/FK0. Package/install/live schema-20 checks passed. Native Score visual
acceptance remains open because the fresh app showed a Desktop-folder access prompt that was not
granted. Pushed lightweight tag `v8.2.0` points to
`5de8bf9e1e9bced09c3d5091acd4b42241edae28`; private `origin/main` contains later
documentation-only corrections, and its exact current tip must be read from Git. The tag and
runtime source remain immutable.

### ⟶ Next steps

1. Run packaged v8.2.1 with the real WKWebView at 720x520 after Christian deliberately handles Desktop access;
   judge continuous Score, rail reveal,
   compact variants and Total plays in native use.
2. Run the real WKWebView microphone: verify native STT actually releases,
   Listen Back can acquire/record/replay/restore mute correctly, and voice survives the Steinway.
3. With Christian's explicit approval for whole-edition cloud egress, configure a provider if
   needed and Apply one real current-edition measure map; keep B67/B75 open until rows exist.
4. Use XP, levels, badges and cadence across real sessions before judging the motivation redesign.


## Next steps

Use the current Roadmap and Command Center; do not execute these superseded handoffs.
