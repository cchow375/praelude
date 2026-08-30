# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

**v9.0.0 / schema 21 is a PACKAGED SHAREABLE CANDIDATE; it is NOT INSTALLED, and
CLEAN-RECIPIENT ACCEPTANCE is PENDING (2026-08-30).** The app in `/Applications` is still the
published **v8.2.1 / schema 20** release. The v9 implementation is committed at
`709542023b3e3bf0c9e72189d145e5fd524eaacd`; recorded test/build gates, disposable migration,
two isolated fresh-profile checks, share-clean scans and exact DMG audit pass. Lightweight tag
`v9.0.0` records the finalized package boundary and both `main` and the tag are backed up to the
private remote. Live backup/rollback, install and recipient acceptance remain **PENDING**;
packaging and source publication are not installation or acceptance.

Package-candidate boundary:

- `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg` is **10,736,628 bytes**, SHA-256
  `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`; its basename-only
  checksum sidecar is 87 bytes and `hdiutil verify` passes;
- bundle `com.christian.codakiller`, version 9.0.0, arm64, macOS 13.0 minimum; mounted strict
  verification passes with ad-hoc CDHash `33ffc5fade7ecb090c5fd7b08818ae82164cbc21` (not notarized);
- the mounted image contains exactly the Applications symlink, `CodaKiller.app`,
  `START HERE.txt`, and `Third-Party Notices.txt`; and
- the full hear BSD, React/Tauri MIT and PDF.js Apache notices are present at DMG top level and
  byte-identical inside the app. The final package rerun and mounted share-clean scan pass.

Verification: frontend **204 files / 2,525 tests passed** with one file/test skipped; TypeScript
and production build pass. The native library passed **1,077 / 17 ignored / 0 failed**, all
reported integration suites passed, and format, strict Clippy, native build and five narrated
corpora passed. Two isolated first-run profiles each produced schema 21/integrity OK/FK0, an empty
app-owned Pieces directory and blank user graph, with only hidden Warm-ups plus the generic
protocol (`source_refs=[]`) and no Knowledge setting/directory. A disposable exact database copy
migrated 20→21 with integrity OK/FK0 and exactly preserved 11 pieces, 255 blocks, 2,315 reps,
51 sessions and 9,173 events; it invented zero folders, assignments or completion states. The
720×520 devMock Pieces flow/screenshots pass after a 4/4 clipping correction; native picker/IPC/
persistence and a broader Today/Calendar timeout remain honestly separate.

v9 is one normal, share-clean build—there is no separate friend fork. A first-ever install creates
an empty app-owned Pieces directory. An upgrade keeps the user's configured Pieces root; for an
older database with no stored root, it conservatively infers the common parent of existing piece
folders. Existing database rows, PDFs and practice history stay in place.

The Pieces workspace is now primary and opens **Library | History | Calendar**. Library supports
nested logical folders (which never move score files), Unfiled, Active/Completed/Archived views,
and right-click/ellipsis actions to move, complete/return, archive/restore or remove. **Add Piece**
takes title, optional composer/folder and a chosen or dropped local PDF; the PDF is validated and
copied into the Pieces root while the source remains untouched. IMSLP is an optional external
public-domain link, not the required import workflow. Remove moves an eligible app-owned piece
folder to `.trash` and keeps practice history.

The distributable no longer contains the embedded copyrighted pedagogy/quote/method payload or
the Quotes/Reader/Books/passage-helper UI. This cleanup does **not** delete an external Knowledge
and Resources folder or historical Assistant rows in an upgraded database. `START_HERE.txt`
contains the recipient instructions and `scripts/check-share-clean.sh` is the bundle privacy
gate.

Distribution target: Apple-silicon Mac (M1+) on macOS 13+. The current project can ad-hoc sign
locally but has no paid Developer ID/notarization, so a recipient must Control-click the app and
choose **Open**, with **Privacy & Security → Open Anyway** as the fallback. Intel, Windows,
automatic updates and a warning-free public install are not supported claims.

**v8.2.1 / schema 20 SHIPPED + INSTALLED + PUBLISHED 2026-08-28.** Pushed lightweight tag
`v8.2.1` points to `971a0d2dc7cf8f093527239e2394391dbbfec0a4`. B94 source commit
`d1e7ac6d09528f22d8becb378f26c66d751ac297` and B95/runtime
commit `496033e677919757ef1f2a78cee32d3abedb4805` combine the composer-density correction with
the fatal end-session/camera fix.
On v8.2.0, session 48 closed and its data persisted, then the app aborted less than one second later:
the day-photo card requested camera access automatically while the packaged Info.plist lacked
`NSCameraUsageDescription`, so macOS TCC delivered `SIGABRT`. Six retained crash reports from
v7.0–v8.2 carry the same signature.

The installed fix makes plain **End session** camera-free. Only a confirmed **End my day** offers the
optional photo card; showing the card requests nothing, **Use camera** is explicit, and a
synchronous camera failure or rejected request falls back to file choice. The source plist now has
a truthful camera description, and the release script refuses a bundle missing camera,
microphone, or speech-recognition descriptions. The orphan `hear` process left by the abort was
cleaned up. Full gates pass: frontend **2,684 passed / 1 skipped / 0 failed** (212 files passed / 1
skipped), native **1,109 passed / 19 ignored / 0 failed**, strict Clippy, TypeScript, production +
native builds, five zero-false-mutation corpora and all eight release gates. Focused crash-path
tests are **67/67**.

Installed `/Applications/CodaKiller.app` reports short/build 8.2.1, bundle
`com.christian.codakiller`, strict ad-hoc signature PASS and CDHash
`f0460dcb3b62825ea29328a32489987364b19828`; its exact Camera/Microphone/Speech usage strings are
present. DMG `/Users/c3/codakiller/releases/v8.2.1/CodaKiller-8.2.1.dmg` is 10,907,287 bytes,
SHA-256 `6ce58b77b32642c644df1c0b42d2c89ea745a75e28c7891a484190ad111c61dd`. Fresh launch PID
46013 remained live with its owned `hear` child and no new crash report. Private `origin/main`
was pushed through the tagged release-doc commit and may advance through docs-only corrections;
read its current tip from Git. See `docs/qa/v8.2.1/README.md`.

**v8.2.0 / schema 20 shipped and was installed on 2026-08-27.** Christian's visual-cleanse round
is frozen at source commit `afe65f3b176a1c5da81eca6d2f65bd721726ee40`: Score is now a continuous,
virtualized reader instead of a one-page canvas with dead space; the PDF and Tricky Sections rail
scroll independently; opening a section reveals its composer; and the toolbar, bottom dock,
variant editor and composer have been compressed around the actions used during practice.

The composer also gains an explicit **Clean streak / Total plays** choice. Total plays offers
5 / 10 / 15 / 25 / Custom, stays at one fixed tempo, hides ladder/variant controls, counts every
effective Clean/Sloppy/Again and lets Undo remove one. Reaching the count completes the set but
does **not** become mastery evidence, a mastery badge, or a mastery completion animation. Existing
clean-streak and variant-chain semantics are unchanged. Schema 20 widens the saved contract basis
to represent `total_attempts`; a disposable copy of the pre-install schema-19 data migrated with 242
blocks/contracts, 2,184 reps, 47 sessions and 8,283 events preserved, integrity OK and zero
foreign-key violations.

The final corrective edges are installed too: verdict-hotkey remaps apply to the live HUD after
Save; every set can override tempo demotion; the running HUD has a quick subdivision control; and
`score_micro_target_create` uses a durable command identity plus one bounded same-identity retry,
so a lost reply replays the original spot instead of duplicating it. The Assistant remains
switched off and fully gated as the accepted cleanup; its off-state Settings guide now teaches
only the hands-free practice lane, hides Books/provider-only furniture, and leaves the settle
control under Voice plus the enable switch discoverable. **Historical v8.1 decision:** piece
folders were deferred in favor of archive + recent-first sort. Christian explicitly reversed
that decision for the v9 candidate on 2026-08-30.

At the supported 720×520 floor, the cleaned Score/composer/variant layouts passed browser QA; the
same Score reader also passed at 1462×919. Warmups still shrinks within the effective 480px stage and tucks only
the expanded Rep Counter into Tools without touching the active set; Rotation clamps an unsafe
restored/collision position to `y=164`, leaving a 56px Tools reserve. Browser/devMock evidence
and installed-native evidence remain labelled separately in `docs/qa/v8.1.0/README.md`. The final
installed-native pass accepted both Universe and Warmups: the Rep Counter tucks into Tools without
ending or changing the active set, and both views remain clear of overlay and clipping.

**v8.2 release evidence:** frontend **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1
skipped); native **1,109
passed / 19 ignored / 0 failed**; TypeScript, production build, format and strict Clippy are
clean; five narrated corpora produced zero false mutations; all eight release-script gates passed.
The installed app at `/Applications/CodaKiller.app` reports version/build 8.2.0, bundle id
`com.christian.codakiller`, strict ad-hoc signature PASS and CDHash
`4f4a8e3947efc00e4845ee085564f2724ff378a6`. DMG
`releases/v8.2.0/CodaKiller-8.2.0.dmg` is 10,903,545 bytes, SHA-256
`1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`; the one-copy rule passed.
Browser QA is recorded in `docs/qa/v8.2.0/README.md`. Fresh packaged launch succeeded, but macOS
presented a Desktop-folder access prompt and that sensitive permission was not granted, so a
packaged-native Score screenshot behind the file permission is honestly not claimed.

Fresh installed launch migrated schema 19→20 with integrity/FKs clean and preserved exactly 11
pieces (10 repertoire + hidden Warm-ups), 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283
events; zero sessions/contracts were open, and movement/routine/replay tables plus `measure_map`
remain empty. Pre-install backup: 23,146,496 bytes, SHA-256
`e2ba204263a9413b073ea5cab3b8fc2192ea7dcb42fda90012a0c0d08b660d0e`. The v8.1 rollback archive
is 10,041,913 bytes, SHA-256
`2960fd90cda9e24583a4661d7ad2672041e896f533d2b979c0cf3897291c751b`. Release tag `v8.2.0` is a
pushed lightweight tag at `5de8bf9e1e9bced09c3d5091acd4b42241edae28`. Private `origin/main` advanced
after the tag through documentation-only corrections; verify the exact current ref from Git. The
immutable tag and runtime source
`afe65f3b176a1c5da81eca6d2f65bd721726ee40` remain the release identities. Real-provider measure mapping is still
unproven on Christian's live scores (no Anthropic key and zero live `measure_map` rows at the last
audit), and Listen Back/voice still require packaged-native microphone and Steinway acceptance.
Those inherited external gaps are unchanged by this frontend-focused release.

The v8.2.1 pre-install backup is
`/Users/c3/Desktop/christian's universe/Piano Practice/CodaKiller/(C) pre-v8.2.1-install-2026-08-28-132046.db`
(23,449,600 bytes; SHA-256
`2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`). Its read-only audit is
schema 20, integrity OK/FK0: 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391
events, and zero open sessions/blocks.

The v8.2 rollback archive is
`/Users/c3/Library/CodaKiller-rollbacks/CodaKiller-v8.2.0-rollback.app.tar.gz` (10,057,883 bytes;
SHA-256 `da29be1e96c120f2c27994fc2d83c26a5c8bc9a40c08b2f87097b0e82a117b71`). Before/after install
audits preserve the exact backup counts with schema 20, integrity OK and FK0.

The 2026-08-30 19:25 EDT read-only live audit is schema 20, integrity OK/FK0 with 11 pieces,
255 blocks, 2,327 reps, 51 sessions and 9,241 events—but **one session and one block are open**.
That correctly blocks the installing release path. Christian must close or deliberately preserve
that work in installed v8.2.1; then the operator must quit the app, take and hash a fresh DB backup
and v8.2.1 rollback, install/audit v9, and test the exact DMG on a clean recipient Mac. The v9
source/tag/private backup are already complete. Then return to native Score, real WKWebView
microphone/Listen Back/Steinway, one explicitly authorized provider map, and sustained-use
motivation judgment.

The Assistant remains switched off and gated at Christian's request. Canonical product truth
lives in the Obsidian vault; start at
`~/Desktop/christian's universe/Piano Practice/CodaKiller/(C) CodaKiller Command Center.md`.

## Build / run

```
npm install
npm run tauri dev      # run the app in dev mode
npm test               # frontend suite
cd src-tauri && cargo test
cd .. && npm run build
npm run tauri build -- --bundles app  # build only the .app; see NOTES.md
npm run package:mac    # package/scan an already-built app; does NOT install it
```

`npm run package:mac` invokes `scripts/package-macos.sh`. This is deliberately non-installing: it
stages and ad-hoc seals the already-built app, runs the share-clean audit, creates and mounts the
DMG, checks its exact contents and writes the SHA-256. It does not quit or launch CodaKiller,
replace `/Applications/CodaKiller.app`, touch the live database, create backups, tag or push.

For a versioned install/DMG release, use `npm run release:mac` only after the release plan, vault
update protocol, complete gates and (when the schema changes) a real-data migration rehearsal are
ready. The script verifies version agreement, runs its test/build gates, signs and installs the
bundle, creates the DMG/checksum and audits app copies. It does **not** make the pre-install
database backup or outgoing-app rollback tarball, relaunch the installed app, tag the commit or
push the release; the release operator must perform and record those steps separately.

For v9 specifically, the safe `package:mac` path has completed without touching the installed
app. Before `release:mac` or any manual replacement, first confirm no practice set/session is
live; the current audit has one open session and one open block, so installation is blocked.
Share-clean, isolated blank-profile and disposable schema-20→21 evidence do not waive that gate.

## Send to another pianist (v9 candidate)

The candidate sendable artifact is the ordinary v9 DMG named above, not a custom copy. It has real
package/hash/share-clean evidence, but it is not yet installed, shipped or recipient-accepted; do
not present it as a finished release until those gates and the release identity are recorded.

After release, the recipient flow is:

1. Open the DMG and drag CodaKiller into Applications.
2. In Applications, Control-click CodaKiller and choose **Open**. If blocked, use System Settings
   → Privacy & Security → **Open Anyway**.
3. Open **Pieces → Library → Add Piece**, enter a title, choose a PDF and add it.
4. Grant Microphone/Speech Recognition and enable Dictation only if hands-free controls are wanted;
   the Library and manual practice flow do not require those permissions.

## Dev mock (browser design-review harness)

```
npm run dev:mock       # VITE_DEV_MOCK=1 vite — then open the printed localhost URL
```

`dev:mock` runs the frontend in a plain browser with a flag-gated, backend-free
Tauri mock (`src/devMock/tauriDevMock.ts`). It intercepts the single
`window.__TAURI_INTERNALS__` seam so the current workspaces mount and render with coherent sample
data (including Warmups, Rotation, Listen Back and the evidence-based Universe; the Assistant
surface remains hidden while its off switch is active). This is a
**DEV-ONLY visual/design-review harness, not native functional acceptance**: it simulates the
bounded reads/writes needed by checked-in UI scenarios, while real audio, speech recognition,
Keychain, SQLite, and native event behavior still require Tauri/native gates. The mock activates
**only** under `VITE_DEV_MOCK`; a normal
`npm run dev` and the real Tauri app never load it. Objective mount coverage
lives in `src/devMock/tauriDevMock.smoke.test.tsx` (part of `npm test`).

## First launch

On first launch macOS will prompt for two permissions — grant both:

- **Microphone** — required to hear you during practice.
- **Speech Recognition** — required to transcribe what you say.

v8.2.1 also declares camera use truthfully, but camera is not a blanket first-launch
permission. Only choosing **Use camera** on the optional post-**End my day** photo card may prompt
for it; plain **End session** and choosing/dropping a photo file never request the camera.

When you open an external score PDF stored in **Desktop**, macOS may separately ask whether
CodaKiller may access that folder. This is conditional, not a blanket first-launch requirement:
grant it only if you want the app to read scores from that location. Declining is valid and leaves
the rest of the app usable, but that score cannot render until you choose a permitted location or
allow access.

Voice input relies on macOS Dictation. If it's disabled, voice commands
will report `dictation-disabled`. Enable it under **System Settings →
Keyboard → Dictation**.

The labelled mic control in the left rail reflects live status:

- **live** — listening normally.
- **muted** — you've manually muted the mic.
- **down** — voice input isn't available (e.g. dictation disabled, or the
  STT process isn't running).
