# CodaKiller repository entry point

The binding project context and operating manual live in the Obsidian vault:

`/Users/c3/Desktop/christian's universe/Piano Practice/CodaKiller/AGENTS.md`

Read that file completely, then open `(C) CodaKiller Command Center.md`. Code and engineering docs
stay in this repository; product truth, Roadmap, Flaws, Changelog, tutorial, and version records
stay in the vault. After **every** code/doc/decision change, obey the vault UPDATE PROTOCOL before
reporting completion.

Current source boundary: **v9.1.0 / schema 21 PACKAGED WINDOWS x64 CANDIDATE; NATIVE WINDOWS/
RECIPIENT ACCEPTANCE PENDING 2026-08-31.** Package source commit
`2d33004888a97c3ebcb4b7799bf54029efd15626` produced the final unsigned current-user NSIS
installer `releases/v9.1.0/windows/CodaKiller-9.1.0-Windows-x64-Setup.exe`, **7,654,002 bytes**,
SHA-256 `e2e2f3ae8846ef7aca6a6c04b2e1a2f346e97640f5d9089e6e49012365dc5dd4`, built
`2026-08-31T19:31:59Z`. The official Tauri local macOS cross-build, recursive blank/share-clean
scan and embedded PE32+ x86-64 identity pass. Frontend passes 205 files with 1 skipped / 2,540
tests with 1 skipped plus TypeScript/build; Mac native passes 1,111/19 ignored with format/strict
Clippy clean; Windows-target `cargo-xwin check` and strict all-target Clippy pass. Native Windows
`cargo test` was not run. Real Windows 10/11 install/relaunch, picker/PDF, audio,
Authenticode/SmartScreen and uninstall acceptance remain PENDING. The package is unsigned, so a
SmartScreen warning is expected. This port excludes `hear`; Mic/voice/Listen Back, system TTS and
automatic system-volume boost are unavailable.

The Windows package contains no personal files, database, scores, Pieces Library, practice
history or copyrighted pedagogy payload. It contains no personal or unremapped host paths;
remapped `/build-user` paths intentionally remain. Inert historical schema/migration metadata and
`com.christian.codakiller` remain to support compatible upgrades, but Windows upgrade and data
preservation have **not** been exercised. The removed GitHub workflow could not be pushed because
the OAuth token lacked workflow scope; do not bypass that permission.
`scripts/package-windows-cross.sh` is canonical. Its successful package run used `C.UTF-8` after
`LC_ALL=C` caused a misleading `makensis` `std::bad_alloc` failure.

Its base is the unchanged **v9.0.0 / schema 21 PACKAGED MAC SHAREABLE CANDIDATE; NOT INSTALLED;
CLEAN-RECIPIENT ACCEPTANCE PENDING 2026-08-30.**
Installed/published remains **v8.2.1 / schema 20**. v9 is the one generic Pieces Library/share-
clean build: blank app-owned first install; preserved configured/inferred Pieces root and DB on
upgrade; **Library | History | Calendar**; nested logical folders; Active/Completed/Archived;
right-click/ellipsis actions; direct local-PDF intake; IMSLP optional/external; embedded
copyrighted pedagogy/quote payload and Quotes/Reader/Books/passage-helper UI removed. The external
source folder and historical DB turns are not destructively deleted. Recorded test/build gates,
two isolated fresh profiles, exact-copy schema-20→21 rehearsal, share-clean source/app/mounted-DMG
audits and package identity pass. Exact candidate DMG
`releases/v9.0.0/CodaKiller-9.0.0.dmg` is 10,736,628 bytes, SHA-256
`e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`; identity is v9.0.0 /
`com.christian.codakiller` / arm64 / macOS 13.0, mounted strict ad-hoc CDHash
`33ffc5fade7ecb090c5fd7b08818ae82164cbc21`, not notarized. Full hear BSD, React/Tauri MIT and
PDF.js Apache notices are present top-level and byte-identical inside the app. `npm run package:mac` invokes the
non-installing `scripts/package-macos.sh`; it packages/scans an already-built app without touching
`/Applications` or the live database. Implementation commit
`709542023b3e3bf0c9e72189d145e5fd524eaacd`, lightweight tag `v9.0.0`, and private `main`/tag
push record the package boundary. Install, backup/rollback, one-copy/installed-launch audit and
clean-recipient proof are PENDING. The last installed runtime is v8.2.1, source
`496033e677919757ef1f2a78cee32d3abedb4805` atop B94 commit
`d1e7ac6d09528f22d8becb378f26c66d751ac297`. Pushed lightweight tag `v8.2.1` points to
`971a0d2dc7cf8f093527239e2394391dbbfec0a4`. It retains
v8.2's visual-cleanse correction: continuous
virtualized Score scrolling; independent PDF/Tricky Sections scrolling with composer auto-reveal;
a compact Score toolbar, one-line dock, and 32px variant rows; plus a clear **Clean streak / Total
plays** contract. Total plays offers 5/10/15/25/Custom, stays fixed-tempo, counts every effective
verdict and completes without generating mastery evidence. Clean-streak and variant-chain behavior
is unchanged. Gates stand at frontend 2,678 passed / 1 skipped and native 1,109 passed /
19 ignored, zero failures; TypeScript/build/format/strict Clippy are clean. A disposable schema
19→20 rehearsal preserved 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283 events with
integrity OK/FK0. Browser QA passed at 720×520 and 1462×919. All eight release gates, installed
identity/signature, DMG/checksum, backup/rollback, fresh launch and live schema-20 graph passed.
The packaged app was seen launch, but macOS's Desktop-folder access prompt was not granted; do not
claim a packaged-native Score frame behind that permission. Release tag `v8.2.0` is a pushed
lightweight tag at `5de8bf9e1e9bced09c3d5091acd4b42241edae28`. Private `origin/main` advanced
after the tag through documentation-only corrections; verify the exact current ref from Git. The
immutable tag and runtime source `afe65f3…` remain the release identities.

**v8.2.1 correction: B94 and B95 RESOLVED; schema unchanged at 20.** Installed v8.2.0 closed
session 48 and preserved its
data, then crashed in under one second because the automatically mounted day-photo card requested
camera access while the packaged Info.plist lacked `NSCameraUsageDescription`; macOS TCC aborted
the process. Six retained reports from v7.0–v8.2 have that signature. Source now keeps plain
**End session** camera-free; only confirmed **End my day** offers a photo, the card requests no
device merely by appearing, and **Use camera** is explicit with file fallback for synchronous or
rejected requests. The source plist declares camera use truthfully and the release script gates
camera, microphone and speech descriptions. The orphan `hear` PID was cleaned. Final gates are
frontend 2,684/1 skipped, native 1,109/19 ignored, strict Clippy, TypeScript, production + native
builds, five zero-false-mutation corpora and all eight release gates. Installed 8.2.1 identity,
strict signature, exact privacy strings, DMG/checksum, backup/rollback, exact before/after DB and
fresh launch all pass; the app stayed live as PID 46013 with its owned `hear` child and no new
crash report. Private `origin/main` was pushed through the tagged release-doc commit; verify its
moving current tip from Git.
Assistant work remains out of scope: it stays switched off and gated as Christian's accepted
cleanup, with a practice-only off-state Settings guide and Books/provider furniture hidden. See:

- `docs/superpowers/specs/2026-08-24-aug8-practice-overhaul-design.md`
- `docs/superpowers/plans/2026-08-27-v8.1.0-p3-p6-completion.md`
- `docs/superpowers/plans/2026-08-27-v8.2.0-ui-cleanse-and-total-plays.md`
- `docs/superpowers/plans/2026-08-30-v9.0.0-portable-pieces-library.md`
- `docs/superpowers/plans/2026-08-31-v9.1.0-windows-x64.md`
- `docs/superpowers/plans/2026-08-26-p2-micro-targets-v2-and-set-completion.md`
- `docs/qa/v8.1.0/README.md` (browser/devMock plus scoped installed-native evidence; native audio explicitly pending)
- `docs/qa/v8.2.0/README.md` (browser UI + release/data evidence; native Score frame pending Desktop access)
- `docs/qa/v8.2.1/README.md` (compact-composer + B95 crash-fix release/install evidence; native Score feel separate)
- `docs/qa/v9.0.0/README.md` (v9 package/source evidence; install and recipient gates remain PENDING)
- `docs/qa/v9.1.0/README.md` (exact Windows package/cross-target evidence; native Windows and
  recipient acceptance remain PENDING)
- `docs/qa/v7.2.0/README.md`
- `NOTES.md` (newest decision block first)

**Cold-start guard:** the v9.1 Windows source/package boundary is complete; do not rebuild it or
infer native Windows acceptance from cross-compilation. Run the exact hashed installer on real
Windows 10 and 11 and record install/relaunch, picker/PDF, audio, Authenticode/SmartScreen,
persistence and uninstall. Never put Mac-only `hear` into the Windows bundle. Work only from this
main worktree unless Christian explicitly assigns a
historical lane. `.claude/worktrees/`, `~/.ck-lanes/`, `.superpowers/sdd/task-*`, the old
Foundation context, and `.workflow/LEDGER.md` are retained phase evidence, not the current
roadmap. Do not restart P3–P6, the v7 galaxy, or the source-complete v8.2 work from those files.
The Windows package gates are complete; native Windows cargo tests were not run. The 2026-08-30
19:25 EDT live read-only audit is schema 20,
integrity OK/FK0 with 11 pieces, 255 blocks, 2,327 reps, 51 sessions and 9,241 events, but it has
**one open session and one open block**. Do not run the installing release path. Christian must
first close or deliberately preserve that work in installed v8.2.1; then quit the app, take/hash
a fresh current-DB backup and v8.2.1 rollback, rerun preflight, install/audit, and prove the exact
DMG's clean-recipient Gatekeeper/first-piece path. The v9 source/tag/private backup are complete.
After that, resume deliberate Desktop-folder
handling plus native Score acceptance. The verified
pre-install backup is `(C) pre-v8.2.1-install-2026-08-28-132046.db` (23,449,600 bytes;
SHA-256 `2c99dec1c3bc14f595e69c92a9415076299752d46930eea0fa3c9f5a793379c7`), schema 20,
integrity OK/FK0, with 11 pieces, 246 blocks/contracts, 2,207 reps, 48 sessions, 8,391 events and
zero open sessions/blocks. Then continue with real WKWebView Listen Back and voice-over-Steinway use, one explicitly authorized
real-provider measure map, and a sustained-use verdict on the motivation dashboard.
Assistant Plan C remains on hold unless Christian explicitly reopens it.

Preserve the user-as-sensor boundary: speech may describe practice; the app never interprets piano
audio as musical evidence. Preserve Christian's live history and rehearse schema changes only on
verified disposable copies before touching the installed database. v7.2.0 kept schema 16, so no
migration rehearsal was required for that historical release. The shipped schema-16→19 release
required its recorded safeguards. The schema-19→20 candidate has passed a disposable-copy
rehearsal and the installed release passed the pre-install backup, rollback, live before/after
graph checks and fresh launch required by the vault release protocol. Real-provider mapping and
packaged-native microphone/Steinway behavior remain acceptance boundaries even after source gates.
