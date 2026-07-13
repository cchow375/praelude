# NOTES

## Decisions

- **Foundation T8/T9/T18 (2026-07-12, Opus 4.8 takeover):**
  - **Export reads the canonical graph, not frozen event payloads (T8).**
    `sessions/export.rs::write_session_md` now enumerates a session's blocks from the
    durable `event` log's `rep_open` events (the ONLY session→piece→block linkage —
    blocks carry no `session_id`), taking piece_id/block_id from each event's payload,
    then renders every block from `block_history` + `reps_for_block` (current label /
    measures / tempo / verdict tallies). Rep COUNT and top-tempo are also derived
    canonically (a block belongs to exactly one open, so `reps_for_block` == that
    session's reps). Result: a block edited after its reps were logged exports with the
    edited values, and export survives a relaunch. Added a trailing **Label** column to
    the table (the old renderer emitted no label at all) — appended at the end so the
    existing `| 40–56 | 80→84 |` substring assertions still hold. Metro tally + time
    window still come from the live `session_event` feed (the durable log carries no
    `metro` rows) — a pragmatic mix, not worth a schema change.
  - **Metrics are pure functions over (events, graph); zero IO inside them (T9).**
    `metrics/mod.rs` — `focused_seconds`, `streak`, `best_tempo_reached`,
    `per_region_mastery`, `time_by_focus` take already-loaded slices. `progress_summary(
    &Store, piece_id)` is the one impure assembler (loads via Store readers `blocks_meta`
    / `reps_for_piece`, then calls the pure fns). **`focused_seconds` gotcha:** the
    brief's "locked reference impl" (`.clamp(0, IDLE)` then `if g <= IDLE {g} else {0}`)
    is self-contradicting — the clamp makes a 600 s idle gap count as 120, but the brief's
    own test expects it to count as **0**. The TEST is authoritative, so the gap heuristic
    is `if (0..=120).contains(&g) { g } else { 0 }` (idle gaps contribute 0). No date crate
    (chrono absent, 8 GB ethos): timestamps parse via a hand-rolled Hinnant `days_from_civil`;
    `parse_ts_secs` also accepts a bare integer string so tests can pass epoch seconds directly.
  - **Tempo ladder decoupled from the metronome + gated on focus (T18).** `RepSnapshot`
    and `RepOpenArgs` gained `focus: String` / `use_metronome: bool` with **serde
    defaults** (`"tempo"` / `true`, via `default_focus`/`default_use_metronome` fns) so
    every existing caller and JS payload is unchanged. `insert_rep_block` persists both
    (so `resync_active_if` can reload them via the new `block_focus_metronome` reader —
    chose a dedicated reader over widening `BlockHistory`, to avoid touching that frontend
    contract). `check()` gates the ladder on `snap.focus == "tempo"` (a non-tempo block
    counts verdicts, never advances BPM) and, when it steps, ALWAYS updates `snap.bpm` and
    appends a durable `tempo_change` event regardless of the metronome. **The rep engine
    holds no metronome handle** — the actual retune lives in `voice_loop::act_rep`, now
    gated on `outcome.snap.use_metronome && running` (was `running` only). Test-helper
    note: the briefs' test snippets reference `out.snapshot` but `CheckOutcome`'s field is
    `.snap` — used `.snap` so it compiles.

- **Task 17/18 (rep engine + sessions + voice wiring):**
  - **Ladder math (`rep/ladder.rs`, pure).** `resolve_auto(start, target, planned,
    variants)`: planned = Σ variant reps if variants present, else planned, else 30.
    `bpm_step` always 4. Rungs `K = ceil((target-start)/4)` (≥1); `clean_needed =
    clamp(round(planned/K), 1, 5)`, EXCEPT no-target → fixed 3 (a ladder needs a
    ceiling to climb). `step()` returns `Some(new_bpm)` capped at target only when
    `cleans_at_step ≥ clean_needed` AND `bpm < target`; no target ⇒ always `None`.
  - **`check()` ordering is load-bearing:** the rep is recorded at the block's
    CURRENT (pre-step) bpm and the current variant lane (lane of rep `reps_done+1`);
    THEN reps_done increments; only a `clean` advances `cleans_at_step` and can step;
    a step sets bpm and resets `cleans_at_step`. `snapshot.variant` tracks the
    UPCOMING rep's lane. `say` composed once in the engine (single source for voice +
    UI): block-done wins over step wins over plain; variant change appends "{Name}
    next." Block-done = `reps_done ≥ planned_reps`.
  - **`open` rejects a double-open** (`Err("close the current block first")`) rather
    than auto-abandoning — voice safety (a mis-heard open must not nuke a live block).
  - **Session ↔ block linkage lives ONLY in the event log** (rep_block has no
    session_id in the schema), so `export::write_session_md` reconstructs everything
    from `rep_open`/`rep`/`rep_close`/`metro` events. `rep_open` logs the whole
    RepSnapshot as its payload so export has piece_id/title/measures/start_bpm without
    extra queries; the piece folder is resolved via `get_piece(piece_id).folder_path`.
    Append-only: create with a one-line header, never edit. Tempdir-only in tests.
  - **RFC3339 at the boundary, native in SQLite.** `sqlite_ts_to_rfc3339` (space→T,
    append Z, idempotent) is applied in `SessionService::current()` and the
    `session://event` emit; the store keeps `datetime('now')` native. `BlockHistory`
    was reshaped to the frozen wire contract (`block_id` not `id`, drop `piece_id`,
    add `bpm` = latest rep bpm via correlated subquery, else `start_bpm`).
  - **Voice note capture is intentionally eager in rep mode:** a leading
    fail/flawed token (`no`/`nope`/`again`/`sloppy`/…) + a ≤12-word trailing clause
    becomes `RepCheck(Fail|Flawed, Some(note))`. So while a block is open, "no thanks"
    to someone in the room WOULD log a failed rep with note "thanks". This is the
    brief's designed behavior (you're actively practicing); the firewall battery for
    rep mode therefore only covers utterances that do NOT lead with a verdict word.
    A >12-word trailing clause reject the whole utterance (ambient ramble).
  - **RepOpen firewall (hardened after adversarial review):** beyond the brief's
    "measures + range", RepOpen requires (a) a rep-open cue (`tracker`/`rep`/`block`)
    AND (b) a command-SHAPE gate — every word must be rep-open vocabulary or a number
    (mirrors `is_explicit_metro_stop`). This matters because the app is ALL about
    measures: "the block measures 40 to 56 are hard" / "that rep in measures 12 to 16
    was rough" carry a cue + a range but the stray words ("are"/"hard"/"in"/"was")
    fall out of vocab, so ambient measure-talk never opens a block. Number parsing
    keeps a bare digit literal (`120`) as its own run so adjacent `target 120 twenty
    reps` splits cleanly (a literal is never merged with a following number-word into
    an unparseable `"120 twenty"`).
  - **Every new spoken ack goes through `self.speaker.say` (gate-closing)** — reps,
    open/status/close, session-end, "Pick a piece first." — preserving the 2.5 s
    `t.at`-keyed dedup safety invariant (no silent acks). The metronome follows a
    ladder step via `set_bpm_only` ONLY when running; when stopped, the engine has
    already persisted the new block bpm and the step is still spoken.
  - **App-exit export hook** on `RunEvent::ExitRequested` calls `end_and_export`
    (best-effort: only reads the event log + appends a small markdown file; a second
    call after `session_end` is a no-op because `current_id()` is then `None`).

- **Task 11 (tts:: — Gemini TTS + `say` fallback + half-duplex gate):**
  - **VERIFIED Gemini TTS API (2026-07, docs win over brief's generateContent guess).**
    Sources: WebFetch of https://ai.google.dev/gemini-api/docs/speech-generation AND
    context7 `/websites/ai_google_dev_gemini-api` (independent) — both agree. The current
    API is the NEW `interactions` endpoint, NOT the older `generateContent`+`inlineData`
    shape the brief guessed:
    - **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/interactions`
    - **Auth header:** `x-goog-api-key: <key>` (never logged)
    - **Model:** `gemini-3.1-flash-tts-preview` (single-speaker TTS; overridable via
      `tts.model` setting)
    - **Request body:** `{ "model": <m>, "input": <text>, "response_format": {"type":
      "audio"}, "generation_config": {"speech_config": [{"voice": <voice>}]} }`
    - **Voice:** default `Kore` (overridable via `tts.voice`). 30 prebuilt voices
      (Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, ...).
    - **Response (VERIFIED against the LIVE API — the docs' summarized
      `output_audio.data` field is WRONG / hallucinated):** audio lives at
      `steps[].content[].{mime_type,data}`, `mime_type = "audio/l16"`, `data =
      base64 s16le`. We concatenate every audio chunk across all steps, decode, and
      read `rate=NNNN` from the mime_type if present (else default 24 kHz). The live
      probe returned `{"id":..,"status":"completed","steps":[{"content":[{"mime_type":
      "audio/l16","data":"<b64>"}]}],...}`. (The classic `generateContent` endpoint
      also works and returns `candidates[0].content.parts[0].inlineData.data` with
      `mimeType: audio/L16;codec=pcm;rate=24000` — kept `interactions` as the current
      documented endpoint but fixed the parser to the real shape.)
    - **Audio format:** raw headerless PCM, mono, **24000 Hz, s16le** (channels=1,
      rate=24000, sample_width=2 — the Python sample writes the base64-decoded bytes
      straight into a wave file via `writeframes`). Decode: base64 → i16 LE → f32
      (`/32768`) → `Pcm{rate:24000, mono_f32}`; `EngineHandle::enqueue_pcm` resamples
      24k→stream rate off the audio thread.
  - **`say` fallback (verified on THIS Mac):** `say -o x.wav --data-format=LEI16@22050
    <text>` writes a standard 16-bit PCM mono WAVE (fmt tag 1, 1 ch, 22050 Hz, with a
    leading JUNK chunk hound skips fine). hound reads it as i16 → f32. AIFF path rejected
    (hound cannot read AIFF-C). Tempfile in the OS temp dir, removed after decode.
  - **Deps (zero-new-compilation on 8GB):** `reqwest` 0.13, `base64` 0.22 are BOTH already
    in `Cargo.lock` transitively via tauri. `reqwest` was pulled with `default-features=
    false` (no TLS backend), so we add it directly with `default-features=false, features=
    ["blocking","json","native-tls"]` — native-tls on macOS = Security.framework (already
    linked), NO openssl/ring, the lean choice per brief. Pinned to `0.13` to reuse the
    exact locked 0.13.4 (no second reqwest copy). `base64 = "0.22"` reuses 0.22.1.
  - **Speaker = single owning TTS thread (enforces `enqueue_pcm` single-producer).**
    `Speaker::speak(text)` sends the text over an mpsc channel to ONE dedicated worker
    thread which is the sole caller of `enqueue_pcm` — the audio engine's single-producer
    contract is thus structurally guaranteed (metronome never enqueues PCM; it only sets
    pattern/gain and reads `pcm_done`). Requests are processed strictly serially, so two
    concurrent `speak()` calls never overlap (double-speak serialization) and never
    interleave gate cycles.
  - **Half-duplex gate ordering (the safety invariant — app NEVER hears itself):** per
    utterance the worker does, in order: (1) `synth(text)` with the gate still OPEN — a
    synth failure/timeout returns early and NEVER closes the gate (mic stays live while we
    "think"); (2) `gate.set_gate(false)` — close BEFORE any sample is enqueued; (3) chunk
    the PCM and `enqueue_pcm` each chunk with backpressure retry (QueueFull/CapExceeded →
    short sleep + retry the SAME chunk, never drop); (4) poll `pcm_done()` until true
    (drain — reserve-first semantics from Task 5 guarantee it stays false until every
    sample has passed the render callback); (5) sleep `reopen_delay` (300 ms); (6)
    `gate.set_gate(true)`. Steps 4–6 run in an ` always-reopen` guard so any error after
    step 2 still drains+reopens (the gate can never get stuck closed).
  - **Why 300 ms reopen margin:** `pcm_done()==true` means all samples left the cpal
    render callback, but the physical tail is still in flight — CoreAudio output buffer +
    DAC + speaker→air→mic acoustic path + the STT engine's own input buffering. 300 ms
    comfortably covers device output latency (~tens of ms) plus a short room-acoustic
    tail, so `hear` never captures the fading end of our own TTS. Configurable via
    `SpeakerConfig.reopen_delay` for tests.
  - **Provider selection:** `tts.provider` setting overrides ("gemini" | "say"). Else:
    Gemini if a key is present (`keys::gemini_key`) AND a network probe succeeds, else
    `say`. Key resolution: Keychain `security find-generic-password -s codakiller -a
    gemini -w` first, then `GEMINI_API_KEY` env. Key is never logged.
  - **do_set Busy-arm fix (carried from Task 7 review):** metronome `do_set`'s
    `StartFailure::Busy` arm mutated `inner.state.sound` before the refused restart but
    did not roll it back (unlike `do_start`'s Busy arm), so the emitted state lied
    (claimed the new sound while the engine/store kept the old). Fixed by capturing the
    prior sound and reverting it in that arm; a new seam test asserts `state.sound`
    unchanged after a concurrent-producer Busy refusal.


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
  - **stdbuf decision (Task 10 fix round 1): stdbuf is OPTIONAL, not a hard dep.**
    Production config still *requests* `stdbuf -oL <hear>` as insurance against
    block-buffered stdout when piped (Task 9 flagged this UNCONFIRMED), but `stdbuf` is a
    Homebrew (coreutils) binary absent from stock macOS and the spec bans hardcoded Homebrew
    deps. So the supervisor probes ONCE at manager start (`stdbuf --version` succeeds) and,
    if absent, degrades to a direct `hear` spawn and logs it; an ENOENT at spawn time also
    falls back. **A missing `stdbuf` never trips RestartStorm.** When used, `stdbuf` execs
    the target so the child pid *is* `hear` and SIGTERM/pgid semantics are unaffected.
    Real-binary smoke (silent, 3s): 0 bytes stdout/stderr (no Code=201 → Dictation still
    enabled; no garbage on silence), SIGTERM-to-group killed it fast. Escalation path if
    Task 13's live test shows block-buffering WITHOUT stdbuf: a pty via stock
    `/usr/bin/script` (documented, NOT built now).
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

### Task 13 fix round 2 — LIVE mic framing VERIFIED (corrects the Task 9 `-m` guidance)

The Task 9 spike deferred live streaming framing; Task 13 obtained it with a human/`say`
voice at the mic. **Ground-truth findings on this Mac (macOS 15, M2):**

- **DO NOT pass `-m`.** `-m` ("single-line output mode") streams progressive hypotheses
  separated by `\r` + ANSI `ESC[2K` with **ZERO newlines**, so a line-based reader never
  completes a line and **no transcript is ever delivered** — the voice loop is DEAD with
  `-m`. Task 9's recommendation to use `-m` was wrong for a piped line reader; it is
  removed from `SttConfig::hear` (now just `-d -l en-US`). Raw capture:
  `scratchpad/hear-noline.txt` (without -m) vs the `-m` single-line stream.
- **Without `-m`: clean `\n`-framed lines, one progressive hypothesis per line.** e.g.
  `Natural\nMetronome\nMetronome 90\nMetronome 96\n`. Spoken numbers come back as digits
  ("ninety six" → `Metronome 96`). The settler collapses the prefix-growth chain and
  finalizes the last hypothesis on the 600 ms settle gap.
- **stdout line-buffers PROMPTLY even on a plain pipe (no `stdbuf`).** Empirically probed
  `hear -d -l en-US | while read` (NO stdbuf, NO `-m`): lines arrived in real time DURING
  the session (timestamps ~200 ms apart as the hypothesis grew), NOT withheld until exit.
  So `stdbuf` is **not required**. `use_stdbuf` is left `true` as harmless insurance
  (stdbuf is present here at `/opt/homebrew/bin/stdbuf` and execs `hear`, so pid/SIGTERM
  semantics are unchanged); the probe-and-degrade path already covers its absence.
- **The engine RE-SENDS the final hypothesis 0.5–2.3 s later** (measured: `Metronome 96`
  at t=370.942 and again 372.741 = 1.8 s; `Stop` at 375.342 and 376.943 = 1.6 s;
  `scratchpad/hear-timed.txt` shows `Done` re-sent at 5.441/5.939/7.838). Byte-identical to
  the original, indistinguishable from a fast human repeat → handled by the unified 2.5 s
  dedup in `voice_loop` (keyed on `Transcript::at`, sliding). See `voice_loop.rs` module docs.
- **ASR-isms:** "bump it up four" → `Bumped it up for` (past-tense verb + number homophone);
  handled by verb folding (`bumped`→`bump`) + number-slot homophone mapping (`for`→4,
  `to`/`too`→2) in `intent::route_delta`, gated on a confirmed command shape so the firewall
  is unweakened.
- **Zombie-`hear`-on-signal fix (found by Task 13 step 8).** A raw POSIX SIGTERM to the
  app (e.g. `kill <pid>`, a service manager stopping it, terminal SIGINT) terminates the
  Tauri process WITHOUT firing `CloseRequested`/`ExitRequested`, so `VoiceLoop::shutdown`
  never runs and the `hear` child — deliberately in its OWN process group — is orphaned to
  `launchd`, leaking a process that holds the mic (verified: after `kill <app>`, `hear`
  survived with PPID 1). Fixed with `stt::install_termination_handler()`: an
  async-signal-safe handler for SIGTERM/SIGINT/SIGHUP that reads a lock-free global mirror
  of the live `hear` pgid (`CURRENT_HEAR_PGID`, written by the manager on spawn/reap),
  `killpg`s it, then restores SIG_DFL and re-raises so the app dies normally. `kill -9`
  (uncatchable) is the one remaining path that can orphan `hear` — same limitation class as
  the boost-volume `Drop` caveat.
- **Observed minor framing artifact (documented, not fixed):** a non-prefix revision in the
  progressive chain (`Metronome 90` → `Metronome 96`, 213 ms apart, faster than the 600 ms
  settle) makes the settler finalize the intermediate `Metronome 90` as its own final before
  `Metronome 96`. The metronome briefly starts at 90 then corrects to 96 (final tempo is
  correct). This is the progressive-revision case, DISTINCT from re-sends (different text, so
  dedup does not and should not collapse it). Settle policy left as-is per the Task 13 brief
  ("prefer leaving equal-repeat two-finals since voice_loop now suppresses"); collapsing
  fast revisions safely would risk merging genuine back-to-back distinct commands, so it was
  judged out of scope for this fix.

- **Ship-smoke discoveries (v0.2.0, 2026-07-10, controller live-tested):**
  - **AppleEvent quit (`osascript 'quit app'`) does NOT deliver `RunEvent::ExitRequested`**
    (nor any POSIX signal) on this Tauri v2 / macOS 15 setup — the run-loop cleanup arm
    never fires on that path. Verified by direct stderr capture: no panic, no output, hear
    orphaned (held the mic until an eventual SIGPIPE), boosted volume stranded at 85, open
    session left unended. Fix: `libc::atexit` backstop (runs on every normal exit incl.
    NSApp terminate) that kills the hear process group (shared fn with the signal handler,
    async-signal-safe) + restores the pre-boost volume via a lock-free mirrored global
    (`sysvol::STRANDED_SAVED`). Sessions are deliberately left open on that path — the
    next launch adopts them (`latest_open_session`) and exports on the next graceful end.
    Window-close (`CloseRequested`) now also runs `end_and_export` (it was shutdown-only).
  - **Rebuild/reinstall invalidates TCC** (ad-hoc signing → new cdhash): after a ditto
    reinstall, `open -a` launches got silent mic denial (hear alive, zero transcripts, no
    error), while terminal-launched instances inherited the terminal's grant and worked —
    diagnose exactly this way before blaming the pipeline. Resolution: `tccutil reset
    Microphone com.christian.codakiller` + `tccutil reset SpeechRecognition …` → the app
    freshly prompts on next launch (user clicks Allow twice). Expect this after EVERY
    rebuild that gets installed.
  - **`say`-through-speakers recognition is volume-marginal** (the −34 dB loopback): at
    output volume 50 commands land intermittently; the earlier P2-era harness runs
    coincidentally benefited from a stranded boost volume of 85. For future self-tests,
    set output volume ≥75 before driving the app with `say`, and expect flakiness — a
    human voice at the piano is a far stronger signal than this harness.

## Foundation / schema v3 (v0.3.0, 2026-07-12)

- **The `rep_block` v3 rebuild is deliberate and crash-atomic.** SQLite cannot relax a
  `NOT NULL` column or add the new FK shape in place, so migration disables FK enforcement,
  begins one transaction, creates `rep_block_v3`, copies every id/column, swaps the table,
  back-fills, stamps `user_version=3`, and commits before re-enabling FKs. The version stamp
  belongs inside the transaction; otherwise a crash can wedge a half-migrated real DB.
- **Nullable patches use `Option<Option<T>>`.** Outer `None` = field absent/leave unchanged;
  `Some(None)` = write SQL NULL; `Some(Some(value))` = replace. JS omits a key to leave it and
  sends `null` to clear it. Do not flatten this convention in block/region/goal/piece patches.
- **Canonical `event` is not `session_event`.** `event` is the durable append-only graph log
  used by metrics/rewards/replay; `session_event` remains the capped live UI timeline. Exports
  enumerate block ids from canonical events, then render the CURRENT block/rep graph, so edits
  after logging and relaunch are reflected.
- **Focused time is an idle-gap heuristic, not a timer.** Sort canonical event timestamps; gaps
  of 0–120 s count, gaps >120 s count as zero. It intentionally rewards focused presence without
  pretending an open app equals practice.
- **Region migration is geometric, not musical intelligence.** Overlapping/touching block ranges
  cluster into a Region; users clean the guess with rename/merge/split/reassign. `pdf_anchor` is
  reserved opaque JSON for P4's real-PDF light mapping.
- **Non-tempo block tempo contract.** Frontend sends `start_bpm: null`; serde maps that to an
  internal 0 sentinel for the live rep engine, while SQLite stores NULL and exports “—”. If the
  independent metronome toggle is on, a real click BPM is stored even though focus still gates
  ladder advancement.
- **Panel z-order gotcha.** Drag begins with `raise()`, but the floating component's transient
  geometry still has its old z. `usePanels.update` must preserve `max(incoming.z,current.z)` or
  the final drag commit silently undoes focus-to-front.
- **Visual QA finding:** movable overlays are not enough if defaults still cover content. While
  an active Rep window exists, the main Practice view reserves a right gutter; Session defaults
  collapsed inside the top bar. This fixed title/history overlap and clipped HUD context.

## v0.3.1 release identity / duplicate-app hygiene (2026-07-12)

- `tauri build --bundles app` necessarily creates a runnable bundle under
  `src-tauri/target/release/bundle/macos/`. Spotlight indexes that bundle as well as the installed
  `/Applications` copy, so leaving it behind creates two CodaKiller search results even when the
  executables are identical. After `ditto` install: unregister the generated bundle with
  `lsregister -u`, delete that generated directory, then `lsregister -f` the Applications copy.
- A correct invisible update is still a release failure. The top bar now derives its version from
  `package.json`, and the Practice landing surface names the Foundation features. This gives a
  first-screen, user-verifiable signal that the expected build is running.

## P4 real-PDF workspace (v0.4.0, 2026-07-12)

- **The PDF is the visual authority; Regions are the musical authority.** PDF.js renders the
  user's actual edition. Region measure ranges remain canonical in SQLite; normalized page
  rectangles are navigation metadata only. Do not infer printed geometry from MusicXML.
- **PDF bytes cross Tauri IPC as raw binary.** Rust rediscovers and canonicalizes an edition under
  the selected piece on every request, rejects traversal/symlinks/cross-piece ids, and returns
  `tauri::ipc::Response`. Never expose a broad asset-protocol filesystem scope or JSON/base64 the
  file. The frontend bundles the PDF.js worker locally.
- **Large scores require persistent placeholders but disposable canvases.** All pages keep their
  layout boxes for continuous scrolling; only visible pages plus one neighbor own a rendered
  HiDPI canvas. Eviction cancels the render task, calls page cleanup, and sets both canvas backing
  dimensions to zero. The real fixtures are a 20.3 MB / 28-page Scherzo edition and an 85-page
  Cortot volume on the 8 GB M2 Air.
- **Anchors are edition-specific and fingerprinted.** Contract: `{v:1, editions:{id:{fingerprint,
  rects:[{page,x,y,w,h}]}}}` with 0..1 coordinates. A changed fingerprint is shown as `remap`,
  never at stale coordinates. Region merge deduplicates compatible rectangles and drops a
  conflicting edition; split clears the old geometry because both new ranges must be remapped.
- **Do not use `scrollIntoView` inside the score workspace.** It can scroll outer ancestors and
  hide the toolbar. Navigate by setting the score pane's own `scrollTop`/`scrollTo` target.
- **Voice score navigation is intentionally silent.** `go to/show page N` and `go to/show measure
  N` emit `score://navigate` without TTS over the pianist. This is a deliberate exception to the
  older assumption that every command acknowledgment closes the STT gate; the 2.5 s duplicate
  window can therefore suppress an immediate identical repeat.
- **Tauri's P4 `.app` emerged linker-signed, not bundle-sealed.** `codesign --verify --deep
  --strict` reported “code has no resources but signature indicates they must be present” and
  `codesign -d` showed the hash-like linker identifier with `Info.plist=not bound`. After `ditto`,
  run `codesign --force --deep --sign - --identifier com.christian.codakiller
  /Applications/CodaKiller.app`, then strict-verify. v0.4.0's installed bundle is sealed and uses
  the correct identifier; P6 packaging must automate this instead of relying on release memory.

## P5 grounded brain provider boundary (2026-07-12)

- **The API boundary is native keys, never a Claude Code login.** Brain secrets resolve from the
  macOS Keychain (`codakiller` service, `claude` / `gemini` accounts), then the
  `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` environment fallbacks. The provider, model, fixed URL,
  and headers are assembled in Rust; no secret enters IPC, SQLite, prompts, errors, or logs.
- **Provider order is Claude → Gemini → cited offline library.** `CODAKILLER_BRAIN_PROVIDER`
  supports `auto`, `claude`, or `gemini`; model overrides are explicit env vars. Defaults were
  verified 2026-07-12 against Anthropic's official
  [model IDs](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) and
  [Messages API](https://platform.claude.com/docs/en/api/messages/create), plus Google's official
  [Gemini 3.5 model guide](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5)
  and [generateContent reference](https://ai.google.dev/api/generate-content):
  `claude-sonnet-4-6` and `gemini-3.5-flash`.
- **Grounding is an allowlist join, not a prompt promise.** Only a bounded selected-piece/session
  projection and deterministic method cards cross the provider boundary. Provider citation ids
  are joined back to the validated local library; unknown ids never become frontend citations.
  When providers fail, the same retrieved method cards remain useful as a cited offline answer.
- **The brain has no hot-loop authority.** Output is rejected if it assigns a rep verdict, claims
  app control, proposes graph mutations, or requests secrets/filesystem/terminal access. It has no
  tools and cannot start a metronome, navigate a score, save intake, or schedule work.
- **Gemini 3.5 thinking tokens count against `maxOutputTokens`.** The first real-key smoke used
  900 tokens and ended `MAX_TOKENS` with only a thought part—no structured answer. For this short
  grounded JSON task, use `generationConfig.thinkingConfig.thinkingLevel = minimal`, remove the
  no-longer-recommended temperature override, allow 4096 output tokens, and parse the first text
  part that satisfies the strict JSON schema (thought parts may precede it). Official reference:
  [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking). The corrected
  real Keychain Gemini smoke passed without printing the key or answer.
- **Voice brain answers reuse the owning TTS path.** Network work stays on Tauri's blocking pool;
  after a voice-sourced answer returns, only the bounded policy-checked text is queued to the
  VoiceLoop action owner. Its existing `Speaker` closes/reopens the STT gate around playback. Do
  not add Web Speech synthesis or a second ungated TTS path.
- **The deterministic planner is read-only and traceable.** It ranks unfinished/due goals, open
  blocks, and spaced Region revisits; every score component appears in `reasons`, output is capped,
  and the local date comes from SQLite `date('now','localtime')` instead of slicing UTC timestamps.
  The brain receives this plan as context but cannot mutate or reorder it.
- **P5 review hardened the write and prose boundaries.** Intake drafts are registered in a
  process-local 15-minute ledger and can be applied once only, against the exact answer, piece,
  and fields that were proposed. Piece deadlines update only canonical root Goals that still
  match the previous inherited default; custom per-Goal dates survive. Provider prose is rejected
  across verb/object families for verdicts, piano-hearing claims, score/tempo control, graph
  mutation, tools, and secrets. This remains deliberately conservative: a blocked provider answer
  is safer than text that appears to control the deterministic app.
- **P5 planning uses both history and recency.** Region ranking combines whole-history clean ratio,
  flawed/failed count across the latest five persisted reps, and spaced age. The same reason trace
  is visible directly in Brain, independent of provider availability; it is not hidden inside the
  prompt or owned by the model.

## P5.5 Goals, Calendar, and recovery (v0.6.0, 2026-07-12)

- **Calendar work is planning metadata, never practice evidence.** `daily_work_change` and
  `recovery_apply` are administrative events. They do not create focused time, active practice
  days, reps, verdicts, or Goal completion. Marking “Done—I did it” means only that the planned
  card was handled.
- **Recovery preview and Apply are separate trust boundaries.** Preview is pure/read-only and
  ranks by earliest applicable deadline, oldest missed date, Goal order, then work id. Apply
  re-reads every row and validates optimistic tokens, strict dates, the seven-day horizon, the
  earliest parent/subgoal deadline, total capacity, and the exact half-capacity recovery ceiling
  in one SQLite transaction. One stale or invalid decision rolls back the whole batch.
- **Origin is provenance.** `origin_date` is protected by a database trigger and never changes;
  each recovery Move increments `reschedule_count`. The UI never moves missed cards until the
  user explicitly chooses Move/Done/Dismiss/Leave and presses Apply.
- **Schema v5 was rehearsed on a SQLite backup of the installed v4 database.** The real-copy gate
  preserved 5 pieces, 24 Regions, 20 blocks, 165 reps, 4 Goals, 3 canonical events, and 249
  session events; `integrity_check` returned `ok` and `foreign_key_check` returned zero rows.
- **Deterministic suggestions can schedule only canonical Goals.** The explicit Brain “Schedule”
  form writes a `source=planner` card only when a suggestion already has Goal ownership. Block
  and Region suggestions remain read-only instead of silently inventing a Goal relationship.
