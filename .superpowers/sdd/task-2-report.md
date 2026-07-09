# Task 2 Report: Tauri v2 scaffold

## Commands run (in order)

1. `npm create tauri-app@latest -- --help` (in scratchpad) — checked real flags before scaffolding.
2. Scaffold (scratchpad, empty target dir required by create-tauri-app):
   ```
   npm create tauri-app@latest codakiller-scaffold -- --template react-ts --manager npm --identifier com.christian.codakiller --yes
   ```
   Output: "Template created!" — succeeded first try.
3. Merge into repo, non-destructive:
   ```
   rsync -a --ignore-existing --exclude .git "$SCRATCHPAD/codakiller-scaffold/" /Users/c3/codakiller/
   ```
   `git status --short` afterward showed only new/untracked scaffold files (`.vscode/`, `README.md`, `index.html`, `package.json`, `public/`, `src-tauri/`, `src/`, `tsconfig*.json`, `vite.config.ts`) — `.gitignore`, `NOTES.md`, `docs/`, `vendor/`, `.superpowers/` were untouched (all pre-existing, so `--ignore-existing` skipped them).
4. `npm install` — 72 packages, 0 vulnerabilities.
5. Edited `src-tauri/tauri.conf.json`:
   - `productName`: `"codakiller-scaffold"` → `"CodaKiller"`
   - `identifier`: already `"com.christian.codakiller"` (set at scaffold time via `--identifier`, no edit needed)
   - `app.windows[0]`: `title: "CodaKiller"`, `width: 1280`, `height: 820`, `minWidth: 980` (was `title: "codakiller-scaffold"`, `800x600`, no minWidth)
6. Created `src-tauri/Info.plist` with `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`, verbatim strings from the brief. Verified via context7 (Tauri v2 docs, `v2.tauri.app/distribute/macos-application-bundle`) that Tauri v2 has **no** `bundle.macOS.infoPlist` config key (the brief's guess for step 3 was wrong) — the actual mechanism is: a file literally named `Info.plist` dropped in `src-tauri/` is auto-detected and merged by Tauri at build time. No `tauri.conf.json` reference needed.
7. Verification:
   - `cargo build --manifest-path src-tauri/Cargo.toml` → `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 36.01s` — SUCCESS.
   - `npm run build` → `tsc && vite build` → `✓ built in 363ms` — SUCCESS.
   - `npm run tauri build` (default, all bundle targets) → app bundle built successfully (`Bundling CodaKiller.app` succeeded), but the subsequent DMG step (`bundle_dmg.sh` / hdiutil) failed intermittently on the first attempt (transient — see Gotchas). A retry of the full build (`npm run tauri build -- --bundles dmg`) succeeded and produced both `.app` and `.dmg`, **but** the DMG bundler's packaging step deletes the `.app` dir after embedding it in the DMG. Since the task's required deliverable is the persistent `.app`, final verification used:
     ```
     npm run tauri build -- --bundles app
     ```
     Output: `Bundling CodaKiller.app ... Finished 1 bundle at: /Users/c3/codakiller/src-tauri/target/release/bundle/macos/CodaKiller.app` — SUCCESS.
   - Confirmed on disk: `ls -la src-tauri/target/release/bundle/macos/CodaKiller.app/Contents/MacOS/codakiller-scaffold` — Mach-O 64-bit arm64 executable present.
   - Confirmed Info.plist merge: `plutil -p .../CodaKiller.app/Contents/Info.plist` shows:
     - `CFBundleIdentifier => "com.christian.codakiller"`
     - `CFBundleName => "CodaKiller"`
     - `NSMicrophoneUsageDescription => "CodaKiller listens for your spoken commands and rep check-offs."`
     - `NSSpeechRecognitionUsageDescription => "CodaKiller transcribes your voice on-device to track reps and control practice tools."`

## Files changed

- Modified: `/Users/c3/codakiller/.gitignore` (merged scaffold's entries: logs, `dist-ssr`, `.vscode/*`/`!.vscode/extensions.json`, `.idea`, misc IDE files — kept all pre-existing entries)
- Modified: `/Users/c3/codakiller/NOTES.md` (added Task 2 Gotchas section)
- New (scaffold): `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `README.md`, `.vscode/extensions.json`, `public/*`, `src/*`, `src-tauri/*` (Cargo.toml, Cargo.lock, build.rs, src/{main,lib}.rs, capabilities/default.json, icons/*, tauri.conf.json, .gitignore)
- New: `src-tauri/Info.plist`

## Commit

`94ffcd9` — "feat: tauri v2 scaffold, CodaKiller identity, mic+speech usage strings" (42 files changed, 7473 insertions)

## Self-review

- `tauri.conf.json` values checked against brief verbatim: productName `CodaKiller`, identifier `com.christian.codakiller`, window title `CodaKiller`, width 1280, height 820, minWidth 980 — all match.
- Info.plist usage strings checked byte-for-byte against brief text — match.
- No UI work done beyond scaffold defaults (App.tsx/App.css untouched from create-tauri-app template), per instructions deferring to Task 3.
- `.gitignore` merge preserved every pre-existing entry (`node_modules/`, `target/`, `dist/`, `.DS_Store`, `*.local`, `.superpowers/`) and none of `docs/`, `vendor/`, `.superpowers/`, `NOTES.md` were overwritten by rsync (confirmed via `git status --short` before staging — only new scaffold paths + the two intentionally modified files appeared).
- `git status --short` before commit confirmed `src-tauri/target/` correctly ignored (attempting `git add` on it errors as ignored, as expected) and `node_modules/` not staged.
- Package name inside `src-tauri/Cargo.toml` / `package.json` remains `codakiller-scaffold` (only `productName` in tauri.conf.json controls the visible/bundled app name and `.app` filename, which is what the brief and the build output both confirm — `CodaKiller.app`). Not renaming the internal package name was a judgment call since the brief only specified `productName`/`identifier`/window/Info.plist, not the Cargo/npm package name; flagging as a minor concern in case Task 3+ expects a fully renamed package.

## Concerns

1. **DMG bundling is flaky on first run** (transient hdiutil/AppleScript-related failure), and even when it succeeds it deletes the `.app` afterward as part of its normal packaging behavior. This is expected Tauri/create-dmg behavior, not a CLT-only quirk — documented in NOTES.md. Not blocking since the task's actual required artifact (`CodaKiller.app`) builds successfully and reproducibly via `npm run tauri build -- --bundles app`.
2. Internal package name (`codakiller-scaffold` in `Cargo.toml`/`package.json`) was left as-is since the brief didn't ask for it to change — only the Tauri bundle identity fields. Worth confirming with the plan owner before Task 3 if a full rename is desired.

## Fix round 1

### Changed

- `/Users/c3/codakiller/src-tauri/tauri.conf.json`: `bundle.targets` changed from `"all"` to `["app"]` to scope bundling to the macOS app only.
- `/Users/c3/codakiller/src-tauri/Cargo.toml`: package `name` changed from `codakiller-scaffold` to `codakiller`; `[lib]` `name` changed from `codakiller_scaffold_lib` to `codakiller_lib`.
- `/Users/c3/codakiller/src-tauri/src/main.rs`: updated call site from `codakiller_scaffold_lib::run()` to `codakiller_lib::run()`.
- `/Users/c3/codakiller/package.json`: `name` changed from `codakiller-scaffold` to `codakiller`.
- `/Users/c3/codakiller/index.html`: `<title>` changed from `Tauri + React + Typescript` to `CodaKiller`.
- `/Users/c3/codakiller/NOTES.md`: corrected the Gotchas claim about Tauri v2's Info.plist config — Tauri v2 **does** have a `bundle > macOS > infoPlist` key; this project uses the equally-documented same-directory `Info.plist` auto-merge approach instead.
- `/Users/c3/codakiller/src-tauri/Cargo.lock`: regenerated automatically by `cargo build` (package name/version bump for the renamed `codakiller`/`codakiller_lib` entries); not hand-edited.

### Verification

- `cargo build --manifest-path src-tauri/Cargo.toml` → `Compiling codakiller v0.1.0 ... Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 6.37s` — PASS.
- `npm run build` → `tsc && vite build` → `✓ built in 366ms` — PASS.
- `npm run tauri build` (plain) → compiled release profile, bundled `CodaKiller.app`, output: `Finished 1 bundle at: /Users/c3/codakiller/src-tauri/target/release/bundle/macos/CodaKiller.app` (only the `app` target ran, no DMG step, confirming the `targets: ["app"]` scoping took effect) — PASS.
- `ls -la src-tauri/target/release/bundle/macos/CodaKiller.app/Contents/MacOS/codakiller` → executable present (`-rwxr-xr-x ... 8585104 ... codakiller`) — PASS.
- `plutil -p .../CodaKiller.app/Contents/Info.plist | grep -E "Microphone|SpeechRec"` →
  ```
  "NSMicrophoneUsageDescription" => "CodaKiller listens for your spoken commands and rep check-offs."
  "NSSpeechRecognitionUsageDescription" => "CodaKiller transcribes your voice on-device to track reps and control practice tools."
  ```
  Both usage strings present — PASS.
