# NOTES

## Decisions

- **Task 10 (STT supervisor `stt::SttSupervisor`):** New module `src-tauri/src/stt/`
  (`mod.rs` docs + `supervisor.rs`). `SttSupervisor::spawn(binary, on_event)` launches
  `hear` and returns an `SttHandle{set_gate(open), shutdown()}`. Design:
  - **`on_event` takes `SttEvent`, not just `Transcript`** — a small, necessary widening
    of the brief's `Fn(Transcript)` signature: the brief *itself* requires a `stt://down`
    lifecycle event that a Transcript-only sink literally cannot carry. `SttEvent` =
    `Transcript(Transcript)` | `Down(DownReason::{DictationDisabled,RestartStorm})`. One
    sink, both streams. Task 13 filters `is_final` transcripts and reacts to `Down`.
  - **SIGTERM the process GROUP, never SIGINT** (Task 9: `hear` ignores SIGINT, exits
    clean on SIGTERM ~22ms). Child is placed in its own process group via
    `libc::setpgid(0,0)` in `Command::pre_exec` (pgid == child pid); `shutdown()` calls
    `libc::killpg(pgid, SIGTERM)`. Group-kill catches any grandchildren (verified by the
    `shutdown_terminates_process_group` test forking a `sleep` grandchild). Reaping is
    `Child::wait()` on the manager thread → no zombies. **New dep `libc` 0.2** — justified
    in Cargo.toml: `std::process` can only SIGKILL a single child, not SIGTERM a group;
    `libc` is already transitive (cpal/rusqlite) so zero new compilation.
  - **stdbuf decision: production spawn wraps `stdbuf -oL <hear>`** as insurance against
    block-buffered stdout when piped (Task 9 flagged this UNCONFIRMED). `stdbuf` execs the
    target, so the child pid *is* `hear` and SIGTERM/pgid semantics are unaffected.
    Real-binary smoke (silent, 3s): 0 bytes stdout/stderr (no Code=201 → Dictation still
    enabled; no garbage on silence), SIGTERM-to-group killed it in ~0.010s. Live buffering
    of actual transcript lines stays unobservable without speech → still DEFERRED to Task
    13, but `stdbuf` makes the outcome moot (guaranteed line-buffered either way).
  - **is_final framing policy (defensive, correct for both plausible framings):** every
    non-empty line → immediate partial (`is_final=false`); the *previous* pending utterance
    is finalized (`is_final=true`) the moment a line arrives that is NOT a prefix-extension
    of it (a distinct new utterance — what `-m` single-line mode is expected to emit, so
    back-to-back commands never merge/drop); a prefix-growth supersedes silently
    (progressive partials, as non-`-m` might stream); and a `settle` gap (default 600ms of
    quiet) finalizes whatever is pending. This *guarantees a final always eventually fires*
    (Task 13 routes only finals) for either framing, with no command loss. TASK 13 TODO:
    once live framing is known, if `-m` lines are already final you may drop the settle
    latency by treating each line as final directly.
  - **Gate = `AtomicBool`, checked with no lock in the reader hot path** (Acquire load per
    line; closed ⇒ line DROPPED at the reader, not buffered). Re-checked at emit time in
    the settler too, so a 600ms settle-timer final can't leak into a closed-gate window
    (half-duplex contract Task 11 depends on). Set via `set_gate(open)` (Release store).
  - **Auto-restart:** on child death, respawn after `backoff` (1s). Restart timestamps are
    kept in a sliding `restart_window` (60s); the (max+1)-th death within the window
    (`max_restarts`=5) emits `Down(RestartStorm)` and stops instead of hot-looping. A
    spawn *failure* (bad binary) counts as a death so it too trips the cap. A
    `kLSRErrorDomain Code=201` on stderr is classified as `Down(DictationDisabled)` and
    stops immediately (no restart — it needs a System Settings change, not a respawn).
  - **Threads & teardown:** one manager thread (spawn/restart loop, owns `Child`), a
    per-child stdout reader thread and stderr-buffer thread (both end on EOF when the child
    dies, joined before the next iteration), and one long-lived settler thread (framing
    state survives respawns; disconnects & drains when the manager drops its `line_tx`).
    `shutdown()` sets a flag (so no respawn), SIGTERMs the current group, wakes the manager
    if mid-backoff via a stop channel, and joins the manager (which joins the rest).
    Idempotent (guarded by an `active` flag) and also runs on `Drop` as a backstop
    (mirrors `BoostGuard`). A publish-then-recheck of the shutdown flag after setting the
    child pgid closes the spawn/shutdown race (no wait()-forever hang).
  - **Testability seams:** `SttConfig{binary,args,env,use_stdbuf,settle,backoff,
    max_restarts,restart_window}` (`SttConfig::hear()` = production). Tests use
    `spawn_with_config` against `tests/fixtures/fake_hear.sh` (POSIX-sh, env-driven:
    scripted lines/sleeps, spawn-count file, emit-exit for respawn, config-error for 201,
    grandchild fork for group-kill) with compressed timings. Coverage: 8 integration tests
    (a–f from the brief + gate-reopen + idempotent shutdown) & 5 lib unit tests (201
    classification, storm cap + window pruning, framing policy, emit-gate). RED verified by
    mutation (removing BOTH gate checks makes the closed-gate test fail with leaked lines).

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

- **Task 7 fix round 1 — async commands, restart rollback, TTS-drop guard, layer tests:**
  - **Blocking work off the main thread.** `metro_start/stop/set` are now `async fn` that
    do all blocking work (boost `osascript` spawns, audio-thread join + device reopen on
    engine (re)start, the 6-key persist) inside `tauri::async_runtime::spawn_blocking`.
    `Metronome` and `Store` are managed behind `Arc` so a `'static` clone can move into
    the closure. The control mutex is taken **only inside** the blocking closure, never
    across an `.await` (clippy `await_holding_lock` clean). `metro_state` stays sync (a
    brief mutex read). Command logic lives in pure `Metronome::do_start/do_stop/do_set`
    methods (no `AppHandle`/emit), which is what the new tests drive directly.
  - **TTS-drop contract, enforced not documented.** A sound change restarts the engine,
    which allocates fresh PCM queues and would silently discard buffered-but-unplayed TTS
    even though `enqueue_pcm` returned `Ok`. So `start_engine` now refuses with
    `StartFailure::Busy("audio busy: speech playing — retry after")` when an existing
    handle reports `!pcm_done()`, **without touching the running engine or state**. The
    TTS producer lands in Task 11; this makes the contract mechanical now. `metro_set`
    also pre-checks the guard before mutating anything so a busy refusal is a clean no-op.
  - **Restart-failure rollback.** `start_engine` returns a typed `StartFailure`: `Busy`
    (engine untouched, still running → keep `running=true`) vs `Dead` (old engine stopped,
    new one failed → force `running=false`). `do_start` restores the pre-call state and
    releases only the boost *this call* engaged; `do_set`'s sound-change `Dead` path forces
    `running=false` and persists the rolled-back state so store + emit stay consistent.
    State can never claim `running` with a dead engine.
  - **Injectable engine-start seam** (mirrors sysvol's `engage_with`): `Metronome` holds
    `engine_start: Box<dyn Fn(EngineConfig)->Result<EngineHandle,String>>` and
    `boost_engage: Box<dyn Fn(u8)->BoostGuard>` (real `Engine::start`/`BoostGuard::engage`
    in `new`; mock closures via `with_seams` in tests). A `#[cfg(test)]`
    `EngineHandle::test_handle(sample_rate, pcm_pending)` builds a device-free handle whose
    `pcm_done()` reflects `pcm_pending`. Tests: (a) start failure → running false + boost
    released; (b) sound change refused while a fake handle reports PCM not done; (c) clean
    restart transitions correctly + persists; plus unknown-sound rejection + start success.
  - **Minors:** `metro_set` rejects unknown sound names (`unknown metronome sound '…'`)
    validated against the loaded click set (skipped when no clicks loaded → silent mode);
    `MAX_SUBDIVISION`/`MIN_BPM`/`MAX_BPM` are now `pub` in `audio::clock` and re-exported —
    `metronome.rs` uses those instead of duplicating the literals; `persist` writes all six
    keys in one `Store::set_settings` transaction; `load_state` logs (not swallows) parse
    failures.

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

(Captured via `./vendor/bin/hear --help 2>&1`, exit code 0.)

### Task 9 empirical spike — VERIFIED behavior (macOS 15.0, MacBook Air M2, 8GB)

Full command log + raw outputs: `.superpowers/sdd/task-9-report.md`.

**GO/NO-GO RECOMMENDATION: GO.** On-device recognition is accurate on clean audio,
CPU/RAM are trivial, control (SIGTERM) is clean, and non-speech audio is rejected (no
garbage). The remaining unknowns (real acoustic ambient-piano robustness; live
partial-vs-final streaming framing) could not be reproduced unattended because the
speaker→built-in-mic acoustic path is too attenuated (peak −34 dB at 100% volume) to
drive the recognizer — they are deferred to Task 13 live QA with a human speaking, NOT
hear defects. Nothing found triggers the whisper.cpp fallback.

**CRITICAL PREREQUISITE — Dictation must be enabled.** On a fresh machine Dictation was
OFF and *every* recognition (even file input) failed instantly with
`Error Domain=kLSRErrorDomain Code=201 "Siri and Dictation are disabled"`. Enabling it
via `defaults write com.apple.assistant.support "Dictation Enabled" -bool true` made
recognition work immediately (this spike set it). **No model download** was needed for
en-US on-device — it worked with zero latency after the flag flipped. Tasks 10-13 must
treat Code 201 as an actionable "enable Dictation" setup error (document as a setup step
and/or detect the string and instruct the user); do not confuse it with a mic-permission
error.

**1. Continuous mic invocation.** `./vendor/bin/hear -d -l en-US -m` (add `-p` only if
you want punctuation — for command parsing you probably want it OFF so words aren't
returned as e.g. `stop.`). Flags: `-d` = on-device only (REQUIRED — offline + private),
`-l en-US` = locale, `-m` = single-line output mode (mic only). Omitting `-m` = default
multi-line mode. Framing detail (does non-`-m` stream evolving partials line-by-line vs
`-m` collapsing to one final line per utterance, and how utterance boundaries/newlines
are marked) needs live speech — **DEFERRED to Task 13**. Data point from FILE mode: the
whole file's transcript is emitted as ONE line, finals concatenated, no per-sentence
newline even across periods (`"metronome ninety six. done. stop. tempo one hundred
twenty."` → single line `Metronome 96 done stop tempo 120`).

**2. Silence behavior / max-duration.** With no `-t`, hear ran a full **67 s continuous
mic session through silence without exiting** — it keeps listening indefinitely. It did
NOT die at the ~60 s mark (Apple's historical 1-minute recognizer limit is handled
internally / not hit on the on-device path). `-t seconds` sets a silence timeout that
quits; leave it unset (or high) for always-on. (>5 min soak still worth a live check,
but the 60 s barrier is cleared.) In FILE mode, pure silence / non-speech instead errors
with `kAFAssistantErrorDomain Code=1110 "No speech detected"`.

**3. stdout buffering when piped.** File-mode output reaches a pipe fine (flushed on
exit). Live streaming line-buffering when piped is **UNCONFIRMED** (no live transcript
was produced to observe). If Tasks 10-13 find it block-buffers when piped, the workaround
is `stdbuf -oL ./vendor/bin/hear ...` (`stdbuf` is present) or a pty via `script`. FLAG
for Task 13.

**4. Signals.** `SIGTERM` → clean, instant exit (measured 0.022 s), process gone.
`SIGINT` (Ctrl-C) → **IGNORED, hear survives it** (verified twice). The supervisor MUST
kill/restart with SIGTERM, never SIGINT. SIGTERM flushes no pending transcript (fine).

**5. CPU / RSS (60 s continuous listening).** CPU held **0.2–0.7%** throughout; RSS
**~27 MB, stable** (grew 26.9 → 27.5 MB over 65 s, no leak). Negligible on 8 GB. Sampled
`ps -o rss,pcpu` every 3 s.

**6. Recognition quality — product-critical.**
  - *Clean speech (file input, on-device):* EXCELLENT. `"metronome ninety six. done.
    stop. tempo one hundred twenty."` → `Metronome 96 done stop tempo 120`. Command words
    recognized; spoken numbers returned as digits (`ninety six`→`96`).
  - *Non-speech / harmonic "music" (synthetic C-major arpeggio chords, 15 s file):* →
    `kAFAssistantErrorDomain Code=1110 "No speech detected"` — **NO garbage transcript**
    (same result as a silence file). Encouraging that the on-device VAD/recognizer gates
    out instrumental content. CAVEAT: this was synthetic sine-chord audio, not a real
    recorded piano timbre with room noise — the real ambient-piano test still needs a
    live YouTube-clip run at the mic in **Task 13**.
  - *Live mic recognition (human phrases + real ambient piano):* NOT obtained. Verified
    the built-in mic captures real audio (ffmpeg avfoundation got a genuine −60 dB noise
    floor, not digital silence → mic + speech-recognition TCC effectively granted for the
    terminal session, no prompt hang), but speaker→mic loopback peaks only −34 dB even at
    100% volume — too faint to trigger ASR, and CPU stayed flat during playback confirming
    no speech was detected. This is an unattended-environment limit. **DEFERRED to Task 13**
    (the Tauri app also carries a different bundle id, so it will trigger its OWN mic +
    speech-recognition TCC prompts on first launch regardless).

**7. Locale / model.** `-s` lists 13 en locales incl `en-US`. en-US on-device required NO
model download (worked instantly once Dictation was enabled).

**Error-code catalogue for Tasks 10-13 to handle:**
  - `kLSRErrorDomain Code=201 "Siri and Dictation are disabled"` → Dictation OFF; enable it.
  - `kAFAssistantErrorDomain Code=1110 "No speech detected"` → silence/non-speech (file
    mode; mic mode keeps listening instead of erroring).

**Available audio input:** `1. MacBook Air Microphone (ID: BuiltInMicrophoneDevice)`
(via `-a`; pass to `-n` if selecting a specific device).
