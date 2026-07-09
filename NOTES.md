# NOTES

## Decisions

- **Task 7 (metronome commands + boost):** Commands `metro_start/metro_stop/metro_set/
  metro_state` on a managed `Metronome { sounds, boost_level, Mutex<Inner{state,handle,
  guard}> }`. The mutex guards ONLY the control path (command handlers), never the audio
  callback — the engine's lock-free discipline is intact. Change-flow into a running
  engine: **bpm/beats/subdivision/accent** → `EngineHandle::set_pattern` (existing
  lock-free pattern queue, adopted at next beat); **gain** → new `EngineHandle::
  set_click_gain`, a single `AtomicU32` (f32 bits, Relaxed) the callback reads each
  buffer — this *extends* the existing atomics design (no Mutex bolted onto the callback,
  no restart, smooth for slider drags); **sound** → engine RESTART, because the click
  samples are `Arc<Vec<f32>>` owned by the callback and swapping them cross-thread would
  force a *free* on the audio thread (forbidden by the RT contract). Sound changes are
  rare + user-initiated; the restart gap is one buffer. `EngineConfig` gained a
  `click_gain` field (manual `Default`=1.0) so a fresh engine starts at the right level
  with no unity-gain blip.
- **Boost / crash-safe volume restore:** `sysvol::{parse_output_volume,current,set}` via
  `osascript` (`get volume settings` / `set volume output volume N`); every osascript
  call is best-effort (log, never panic — a broken osascript must not strand the Mac at
  boost volume). `BoostGuard::engage(target)` saves current vol, raises to target,
  restores on `Drop` AND explicit `release` (idempotent — restore runs exactly once).
  Restore fires on FOUR in-process paths: `metro_stop`, window `CloseRequested`
  (`on_window_event` → `Metronome::shutdown`), app quit `RunEvent::ExitRequested`
  (macOS Cmd-Q — which does NOT fire a per-window close, and whose `process::exit`
  would skip `Drop`; caught via `.build(...).run(|_, event| ...)`), and `Drop`
  (backstop). Honest limitation:
  a hard `kill -9` cannot run `Drop`, so a SIGKILL'd process is the one path we cannot
  cover — documented in `sysvol.rs`. `BoostGuard` is unit-tested with injected
  getter/setter closures (no real system volume touched).
- **Click-assets dual path (dev + bundled) — VERIFIED BOTH WAYS.** `resolve_clicks_dir`
  tries `app.path().resolve("assets/clicks", BaseDirectory::Resource)` first (bundled
  `.app`), falling back to `CARGO_MANIFEST_DIR/assets/clicks` (dev, where Tauri does NOT
  stage resources). Added `bundle.resources: ["assets/clicks/*.wav"]` to tauri.conf.json.
  Verified: `npm run tauri build -- --bundles app` stages the six WAVs at
  `CodaKiller.app/Contents/Resources/assets/clicks/*.wav` — exactly where the Resource
  base dir resolves. Dev path is exercised by the `load_clicks` unit test (reads from the
  manifest `assets/clicks`). A clicks-load failure is non-fatal (metronome runs silent).
- **Persisted settings:** `metronome.{bpm,sound,gain,boost,beats_per_bar,subdivision}`
  (+ optional `metronome.boost_level`, default 85). Loaded on startup via
  `metronome::load_state`, written through on every `metro_set`.
- **Deferred to Task 8:** interactive command invocation from the running app
  (`metro://state` event round-trip, live audio through the commands). Static coverage
  is strong (state-machine + parser + guard unit tests, clean build, bundle staging
  verified), but driving the JS console needs the frontend glue that Task 8 builds.

- **Task 5 fix round 1 — `crossbeam-queue` dependency APPROVED by controller.** The
  lock-free `ArrayQueue` is the mechanism the real-time callback uses to receive
  pattern changes, TTS PCM chunks, and (new this round) recycled empty `Vec`s
  without ever locking, allocating, or freeing on the audio thread. A hand-rolled
  SPSC ring would duplicate a small, well-audited, widely-used primitive; the
  controller approved keeping `crossbeam-queue 0.3` rather than reinventing it.

- **Task 5 (audio engine):** cpal callback owns `ClickClock`+`Mixer`; cross-thread
  input is lock-free via `crossbeam_queue::ArrayQueue` (pattern changes + resampled
  PCM chunks) — no mutex in the callback. TTS is resampled at enqueue time
  (linear interp), never in the callback. `pcm_done()` uses an `AtomicUsize` counted
  at enqueue / decremented at output, so it is never false-done while samples are
  buffered anywhere (Task 11 half-duplex gate depends on this). Drift uses an f64
  fractional accumulator (`samples_per_beat`, remainder carried; floored only for the
  in-buffer offset) — verified 0-frame error over a 1-hour sim. `bpm` is clamped to a
  finite `[1,1000]` before use so a garbage tempo can't stall the RT loop (a fresh-
  context verifier found `+inf`/negative bpm would infinite-loop the callback; fixed +
  regression-tested). Device negotiated 48 kHz f32 on this Mac (engine is sample-rate-
  agnostic). Deps added: `cpal 0.18`, `hound 3.5`, `crossbeam-queue 0.3`.

- Installed Rust via `brew install rust` (not rustup) per the brief. This installed
  rust 1.96.1 as a Homebrew-managed toolchain (not rustup-managed). `cargo` and `rustc`
  are on PATH via Homebrew's shim (`/opt/homebrew/bin`). No `rustup` toolchain link was
  set up since the brief only required `cargo --version` to work and satisfy the
  ≥1.77 requirement — it does (1.96.1).
- No deviation needed for the `hear` archive layout — the brief's `find ... -exec cp`
  command worked verbatim. Actual archive layout (documented below) matched closely
  enough that the `find -name hear -type f -perm +111` pattern located the binary
  without modification.

## Gotchas

- **Task 2 (Tauri v2 scaffold):** `npm create tauri-app@latest` does not accept
  `--yes`/`--template`/`--manager` flags the way the brief guessed in isolation, but
  it did accept them combined: the real invocation used was
  `npm create tauri-app@latest codakiller-scaffold -- --template react-ts --manager npm --identifier com.christian.codakiller --yes`.
  The CLI also exposes `--identifier` directly, so the correct `com.christian.codakiller`
  identifier was set at scaffold time (no post-hoc edit needed for that field).
- create-tauri-app requires an empty target dir, so it was scaffolded into
  `$SCRATCHPAD/codakiller-scaffold` then merged in with
  `rsync -a --ignore-existing --exclude .git`. This left `.gitignore` and `NOTES.md`
  untouched (already existed) — new files only (`git status` showed only new,
  untracked scaffold paths). The scaffold's `.gitignore` entries (logs, `.vscode/*`,
  `.idea`, etc.) were hand-merged into ours; ours already had `node_modules/`,
  `target/`, `dist/`, `.DS_Store`, `*.local`, `.superpowers/` covered.
- Tauri v2 **does** have a `bundle > macOS > infoPlist` config key (a path that merges
  with the default Info.plist) per official docs; this project instead uses the equally-
  documented same-directory `Info.plist` auto-merge approach. Verified by inspecting
  the built `.app`'s `Contents/Info.plist` with `plutil -p`: both
  `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` were
  present with the exact strings from `src-tauri/Info.plist`.
- `npm run tauri build` (all default bundle targets, which include `dmg`) intermittently
  failed on the DMG step (`bundle_dmg.sh` / `hdiutil` — likely a transient Finder/AppleScript
  race, common on first-run `create-dmg` invocations) but always produced the app bundle
  first (`Bundling CodaKiller.app` succeeds before `Bundling ...dmg` runs). One retry of
  the full build succeeded end-to-end and produced both the `.app` and the `.dmg`.
  However, the DMG bundler step **deletes/cleans the `.app` output dir** after packaging
  it into the DMG (`Cleaning .../CodaKiller.app`), so if you need `CodaKiller.app` to
  persist on disk, run `npm run tauri build -- --bundles app` to build only the macOS
  `.app` target and skip the DMG step entirely — this is what verification used.
- This is a CLT-only Mac (no full Xcode install) — `cargo build`, `npm run build`, and
  `npm run tauri build -- --bundles app` all succeeded without any Xcode-only tool
  being required; no CLT-specific build quirks were hit for the app bundle itself.

- The `hear-0.8.zip` release archive extracts to a subdirectory `hear-0.8/` containing
  three files: `hear` (the universal Mach-O binary), `hear.1` (man page), and
  `install.sh` (installer script). The brief's brief `find`/`cp` one-liner handled this
  fine since it searches recursively for a file literally named `hear`.
- `vendor/bin/hear` is a universal Mach-O binary (x86_64 + arm64), so it runs natively
  on this M2 Mac without translation.
- `./vendor/bin/hear --help` exits with code 0 and prints full usage text (not a
  non-zero "crash" exit as the task brief warned might happen) — no adaptation needed.
- No Tauri v2 / cargo-tauri CLI setup step was actually present in this brief's
  checklist (Steps 1-4 only cover rust install + hear vendoring); only `cargo`/`rustc`
  verification was required and completed.

## hear CLI facts

```
hear version 0.8 by Sveinbjorn Thordarson <sveinbjorn@sveinbjorn.org>

hear [-vhmsdpa] [-l lang] [-i file] [-x word] [-t seconds] [-n device_id]

Options:

    -s --supported           Print list of supported locales

    -l --locale              Specify speech recognition locale
    -i --input [file_path]   Specify audio file to process
    -d --device              Only use on-device speech recognition
    -m --mode                Enable single-line output mode (mic only)
    -p --punctuation         Add punctuation to speech recognition results (macOS 13+)
    -x --exit-word           Set exit word that causes program to quit
    -t --timeout             Set silence timeout (in seconds)
    -T --timestamps          Write timestamps as transcription occurs (file input only)
    -S --subtitle            Enable subtitle mode, producing .srt output (file input only)
    -a --audio-input-devices List available audio input devices
    -n --input-device-id     Specify ID of audio input device

    -h --help                Prints help
    -v --version              Prints program name and version

For further details, see 'man hear'.
```

(Captured via `./vendor/bin/hear --help 2>&1`, exit code 0. No live microphone test was
performed — deferred to a later task per instructions, to avoid triggering a macOS TCC
permission prompt.)
