# CodaKiller P0–P2 Implementation Plan (Skeleton · Metronome · Voice Loop)

> **Status:** Historical/as built; shipped in the initial release train. Do not treat unchecked
> boxes or old `NEXT` lines as current. Installed truth is v8.1.0/schema 19.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A launchable, publishable Tauri v2 macOS app with a production-grade metronome and a voice loop (on-device STT + API TTS) that provably never hears itself and never mistakes piano for speech.

**Architecture:** Rust core owns all audio (one cpal output stream with a sample-accurate mixer for clicks + TTS PCM), a `hear` child-process supervisor for on-device Apple STT, a half-duplex gate, and a deterministic intent router. React/TS WebView renders UI only. Spec: `docs/superpowers/specs/2026-07-09-codakiller-design.md`.

**Tech Stack:** Tauri v2, Rust (stable via Homebrew), Vite + React + TS, cpal, rusqlite (bundled), `hear` v0.8 (github.com/sveinbjornt/hear), Gemini TTS API, `say` fallback.

## Global Constraints

- macOS 15.0, Apple Silicon M2, **8 GB RAM** — no ML runtimes, no local LLMs, keep resident memory of the app under ~400 MB.
- The app NEVER interprets audio as music. Audio input = speech only. (Spec §1.)
- No LLM in the hot loop: metronome + rep vocab must respond in <100 ms offline. (Spec §1.)
- Repo: `/Users/c3/codakiller`, branch `main`, commit after every task minimum.
- Old app (`~/piano-coach`, `/Applications/PianoCoach.app`) must never be modified.
- Vault writes (later phases) only under `Piano Practice/CodaKiller 2/` or `(C) codakiller-*` files.
- Bundle id `com.christian.codakiller`, product name `CodaKiller`.
- `GEMINI_API_KEY` is read from macOS Keychain (service `codakiller`) with env-var fallback; NEVER committed. Migration from `~/piano-coach/data/secrets.env` happens in Task 12 (security-executor).
- Swift toolchain on this Mac is BROKEN (no Xcode) — nothing may depend on `swiftc`. clang/CLT linking works.
- All temp/experiment files → `/private/tmp/claude-501/-Users-c3/b16ee4c0-ea48-4523-994f-6de8b31f1c9e/scratchpad`.

---

## Phase P0 — Skeleton

### Task 1: Toolchain install + `hear` vendored

**Files:**
- Create: `vendor/bin/hear` (binary), `NOTES.md`

**Interfaces:**
- Produces: working `cargo`, vendored `hear` binary at `vendor/bin/hear`, `NOTES.md` decisions log (every later task appends gotchas here).

- [ ] **Step 1:** `brew install rust` → verify `cargo --version` prints ≥1.77.
- [ ] **Step 2:** Download + vendor hear:
```bash
cd /Users/c3/codakiller && mkdir -p vendor/bin
curl -L -o /tmp/hear.zip https://github.com/sveinbjornt/hear/releases/download/0.8/hear-0.8.zip
unzip -o /tmp/hear.zip -d /tmp/hear-extract && find /tmp/hear-extract -name hear -type f -perm +111 -exec cp {} vendor/bin/hear \;
xattr -d com.apple.quarantine vendor/bin/hear 2>/dev/null; chmod +x vendor/bin/hear
./vendor/bin/hear --help 2>&1 | head -20   # record actual flags in NOTES.md — do NOT trust assumptions
```
Expected: help text listing supported flags (mic/on-device/punctuation modes). If the zip layout differs, adapt and record in NOTES.md.
- [ ] **Step 3:** Create `NOTES.md` with sections `## Decisions`, `## Gotchas`, `## hear CLI facts` (paste the real --help output).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "chore: toolchain + vendored hear 0.8"`.

### Task 2: Tauri scaffold builds and launches

**Files:**
- Create: `src-tauri/**` (generated), `src/**` (generated), `package.json`, `vite.config.ts`, `index.html`

**Interfaces:**
- Produces: `npm run tauri dev` launches a window; `npm run tauri build` produces `src-tauri/target/release/bundle/macos/CodaKiller.app`.

- [ ] **Step 1:** Scaffold into a scratch dir (create-tauri-app requires empty target), then merge:
```bash
cd "$SCRATCHPAD" && npm create tauri-app@latest codakiller-scaffold -- --template react-ts --manager npm --yes
rsync -a --exclude .git codakiller-scaffold/ /Users/c3/codakiller/
cd /Users/c3/codakiller && npm install
```
- [ ] **Step 2:** In `src-tauri/tauri.conf.json` set `productName: "CodaKiller"`, `identifier: "com.christian.codakiller"`, window `title: "CodaKiller"`, `width: 1280, height: 820, minWidth: 980`.
- [ ] **Step 3:** Add Info.plist keys (create `src-tauri/Info.plist` and reference it via `bundle.macOS.infoPlist` per Tauri v2 docs — verify exact key with context7 docs at execution time):
`NSMicrophoneUsageDescription` = "CodaKiller listens for your spoken commands and rep check-offs." · `NSSpeechRecognitionUsageDescription` = "CodaKiller transcribes your voice on-device to track reps and control practice tools."
- [ ] **Step 4:** Verify: `cargo build --manifest-path src-tauri/Cargo.toml` succeeds AND `npm run build` succeeds. Then `npm run tauri build` → `.app` exists. Record any CLT-only quirks in NOTES.md.
- [ ] **Step 5:** Commit: `feat: tauri v2 scaffold, CodaKiller identity, mic+speech usage strings`.

### Task 3: App shell — dark/light design system + settings scaffold

**Files:**
- Create: `src/design/tokens.css`, `src/design/theme.ts`, `src/App.tsx` (replace), `src/components/Shell.tsx`, `src/components/Popover.tsx`, `src/state/settings.ts`
- Test: `src/design/theme.test.ts` (vitest)

**Interfaces:**
- Produces: `<Shell>` layout (hero content area + slim top bar + popover layer); `useSettings()` React hook backed by Tauri `get_setting`/`set_setting` commands (Task 4); CSS custom-property token system with `data-theme="dark|light"` on `<html>`, `auto` follows `prefers-color-scheme`.

- [ ] **Step 1:** Add vitest (`npm i -D vitest @testing-library/react jsdom`) with `npm test` script. Write failing test: `theme.test.ts` asserts `resolveTheme('auto', 'dark') === 'dark'`, `resolveTheme('light', 'dark') === 'light'`.
- [ ] **Step 2:** Run `npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement `theme.ts` (`export function resolveTheme(pref: 'auto'|'dark'|'light', system: 'dark'|'light')`), `tokens.css` (type scale, spacing, radii, surface/ink color tokens for both themes — restrained, SF Pro system stack, apple.com-like generous whitespace), `Shell.tsx`, `Popover.tsx` (spring-animated, dismiss-on-outside-click; ALL secondary UI lives in popovers per spec — nothing pinned on screen).
- [ ] **Step 4:** `npm test` → PASS. `npm run tauri dev` → visually confirm dark + light + auto.
- [ ] **Step 5:** Commit: `feat: shell, theme system, popover layer`.

### Task 4: Store — rusqlite schema v1 + settings commands

**Files:**
- Create: `src-tauri/src/store/mod.rs`, `src-tauri/src/store/migrations.rs`
- Modify: `src-tauri/src/lib.rs` (register commands + managed state)
- Test: inline `#[cfg(test)]` in `store/mod.rs`

**Interfaces:**
- Produces: `Store::open(path) -> Result<Store>`; `Store::get_setting(key) -> Option<String>`; `Store::set_setting(key, value)`; Tauri commands `get_setting`, `set_setting`. Schema tables verbatim from spec §5: `piece`, `rep_block`, `rep`, `session`, `session_event`, `spot_review`, `setting`. DB at `~/Library/Application Support/CodaKiller/codakiller.db`.

- [ ] **Step 1:** `cargo add rusqlite --features bundled` (in src-tauri). Write failing tests: open in-memory store → `schema_version()==1`; set/get setting roundtrip; all 7 tables exist.
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/Cargo.toml` → FAIL.
- [ ] **Step 3:** Implement migrations (single `PRAGMA user_version` gate, `CREATE TABLE` statements matching spec §5 exactly; JSON columns as TEXT).
- [ ] **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** Commit: `feat: sqlite store, schema v1, settings commands`.

---

## Phase P1 — Metronome

### Task 5: audio::Engine — mixer + click scheduling math

**Files:**
- Create: `src-tauri/src/audio/mod.rs`, `src-tauri/src/audio/mixer.rs`, `src-tauri/src/audio/clock.rs`
- Test: inline `#[cfg(test)]` in `mixer.rs` + `clock.rs` (pure math — NO audio device in tests)

**Interfaces:**
- Produces:
  - `ClickPattern { bpm: f64, beats_per_bar: u8, accent_first: bool, subdivision: u8 }`
  - `ClickClock::new(sample_rate: u32)`; `ClickClock::set_pattern(ClickPattern)` (atomic, takes effect next beat); `ClickClock::next_events(frames: usize) -> Vec<ClickEvent>` where `ClickEvent { offset_in_buffer: usize, kind: ClickKind }`, `ClickKind = Accent | Beat | Sub`.
  - `Mixer::render(&mut self, out: &mut [f32])` — sums click samples (from loaded WAVs) + drains a `pcm_queue: VecDeque<f32>` (TTS audio, 24 kHz → resampled at enqueue) with independent gains `click_gain`, `voice_gain`.
  - `Engine::start() -> EngineHandle` — owns the cpal output stream; handle is `Send + Sync` (atomics + lock-free where the callback touches it).
  - `EngineHandle::pcm_done() -> bool` — true when the TTS queue is fully drained (Task 11's gate needs this exact signal).
- Consumes: click WAV assets from Task 6 (until then, unit tests use synthetic 8-sample clicks).

- [ ] **Step 1:** Failing tests: (a) at 120 bpm / 44100 Hz, beat spacing = exactly 22050 frames across buffer boundaries (accumulate over 10 x 512-frame buffers, assert offsets); (b) bpm change mid-stream applies at the next beat, never mid-interval; (c) subdivision=2 emits `Sub` exactly halfway; (d) accent lands on beat 1 of each bar for beats_per_bar=4; (e) mixer clamps output to [-1,1] and applies gains.
- [ ] **Step 2:** `cargo test` → FAIL.
- [ ] **Step 3:** Implement `clock.rs` with a **fractional sample accumulator** (`samples_per_beat = sample_rate * 60.0 / bpm`, carry the remainder — never round per-beat, or 8 hours of practice drifts). Implement `mixer.rs` voicing: on `ClickEvent`, start playback of the click sample at `offset_in_buffer`; support overlapping tails.
- [ ] **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** `cargo add cpal`; implement `Engine::start` (default output device, f32 stream, callback calls `clock.next_events` + `mixer.render`). Smoke: a `#[ignore]`d test `cargo test click_audible -- --ignored --nocapture` plays 4 beats audibly.
- [ ] **Step 6:** Commit: `feat: sample-accurate audio engine (clock + mixer + cpal stream)`.

### Task 6: Click sound assets (limiter-maximized)

**Files:**
- Create: `src-tauri/assets/clicks/{woodblock,rim,beep,clave,cowbell,tick}.wav`, `scripts/gen_clicks.py`
- Test: `scripts/gen_clicks.py --verify`

**Interfaces:**
- Produces: six 44.1 kHz mono 16-bit WAVs, each ≤120 ms, peak ≥ −0.5 dBFS; `Mixer::load_clicks(dir)` maps sound name → (accent, beat, sub) sample triple (accent = same sample +3 dB pre-gain or brighter variant).

- [ ] **Step 1:** Write `scripts/gen_clicks.py` (stdlib only — `wave` + `math`): synthesize each sound (woodblock = damped 1.6 kHz sine burst w/ noise transient; beep = 1 kHz sine 30 ms; rim = filtered noise click; clave = 2.5 kHz damped sine; cowbell = 800 Hz + 1.35 kHz inharmonic pair; tick = 5 ms white-noise impulse), normalize peak to −0.3 dBFS. `--verify` mode asserts peak/duration/format for every file and exits non-zero on failure.
- [ ] **Step 2:** Run generator + verify. Listen once via `afplay` (subjective sanity).
- [ ] **Step 3:** `Mixer::load_clicks` + test that all six load and accent variant is louder.
- [ ] **Step 4:** Commit: `feat: six synthesized limiter-maximized click sounds`.

### Task 7: Metronome Tauri commands + boost mode

**Files:**
- Create: `src-tauri/src/metronome.rs`, `src-tauri/src/sysvol.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: inline tests in `sysvol.rs` (parser only) + `metronome.rs` (state machine)

**Interfaces:**
- Produces: Tauri commands — `metro_start(bpm)`, `metro_stop()`, `metro_set(bpm?, beats_per_bar?, subdivision?, accent?, sound?, gain?)`, `metro_state() -> MetroState` (serde struct: running, bpm, pattern, sound, gain, boost); event `metro://state` emitted on every change (frontend subscribes).
  - `sysvol::current() -> u8` (parses `osascript -e 'output volume of (get volume settings)'`), `sysvol::set(v: u8)`, `BoostGuard::engage(target: u8)` — saves current volume, raises to target, `Drop` restores. Boost engages on `metro_start` when setting `metronome.boost=true`, releases on `metro_stop` AND on app exit (register in Tauri `on_window_event` close handler — a crashed restore must never leave his Mac blasting).
- Consumes: `EngineHandle` (Task 5), click assets (Task 6), `Store` settings (Task 4) for persisted defaults.

- [ ] **Step 1:** Failing tests: state machine transitions (start→set bpm→stop), `sysvol` parser on fixture strings (`"output volume:64, ..."` → 64), BoostGuard restore-on-drop (mock the setter with a closure).
- [ ] **Step 2:** `cargo test` → FAIL. **Step 3:** Implement. **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** Commit: `feat: metronome commands, state events, boost mode with crash-safe restore`.

### Task 8: Metronome popup UI

**Files:**
- Create: `src/features/metronome/MetronomePopover.tsx`, `src/features/metronome/useMetronome.ts`
- Modify: `src/components/Shell.tsx` (top-bar metronome button)
- Test: `src/features/metronome/useMetronome.test.ts` (mock Tauri invoke/listen)

**Interfaces:**
- Consumes: commands + `metro://state` event from Task 7.
- Produces: `useMetronome()` hook (state + actions, exact command names above). UI: large tempo readout (tap +/− 1, drag wheel ±, direct type), Italian tempo name subtitle (Largo…Prestissimo), beats-per-bar & subdivision steppers, 6-sound picker with instant preview, gain slider, boost toggle, start/stop. Popover only — nothing persistent on screen. Keyboard: space toggles while open.

- [ ] **Step 1:** Failing hook test (mocked invoke): start → invoke called with bpm; state event updates hook state.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Live QA in `tauri dev`: 40→240 bpm sweep, accent/sub audibility, boost raises + restores system volume. Screenshot both themes into `docs/qa/p1-metronome-{dark,light}.png`.
- [ ] **Step 4:** Commit: `feat: metronome popover UI`.

---

## Phase P2 — Voice loop

### Task 9: SPIKE — empirical `hear` behavior (timeboxed 45 min)

**Files:**
- Modify: `NOTES.md` (`## hear CLI facts` section)

**Interfaces:**
- Produces: recorded facts every later task trusts: exact flags for continuous mic transcription; on-device flag; partial vs final line semantics on stdout; behavior on silence; restart cost; CPU%. Plus a GO/NO-GO decision line.

- [ ] **Step 1:** Run `./vendor/bin/hear --help`; then live: `./vendor/bin/hear -d 2>/dev/null` (or per real flags) while speaking; observe stdout framing. (First run triggers mic + speech TCC prompts — expected; if running headless/unattended, coordinate with Christian or defer the interactive check to Task 13's live QA.)
- [ ] **Step 2:** Measure: `ps -o rss,pcpu -p <pid>` during 60 s continuous listening. Record.
- [ ] **Step 3:** Write GO/NO-GO in NOTES.md. **Fallback if NO-GO** (hear can't stream continuously or eats CPU): whisper.cpp `base.en` via `whisper-rs`, mic capture via cpal input stream + simple energy VAD — document choice, do not build both.

### Task 10: stt::Supervisor — child process + transcript stream

**Files:**
- Create: `src-tauri/src/stt/mod.rs`, `src-tauri/src/stt/supervisor.rs`
- Test: `src-tauri/tests/stt_supervisor.rs` using a fake `hear` (a shell script fixture `tests/fixtures/fake_hear.sh` that emits scripted lines with sleeps)

**Interfaces:**
- Produces: `SttSupervisor::spawn(binary: PathBuf, on_event: impl Fn(Transcript)) -> SttHandle`; `Transcript { text: String, is_final: bool, at: Instant }`; `SttHandle::set_gate(open: bool)` (closed ⇒ lines dropped at the supervisor, not buffered); `SttHandle::shutdown()`. Auto-restart with 1 s backoff if the child exits; max 5 restarts/min then event `stt://down`.
- Consumes: hear facts from Task 9 (adjust line-parsing to reality).

- [ ] **Step 1:** Failing tests against `fake_hear.sh`: (a) lines arrive as Transcripts; (b) `set_gate(false)` drops lines (assert none delivered during closed window); (c) killing the fake child triggers respawn (fixture writes a spawn-count file); (d) shutdown terminates the process group.
- [ ] **Step 2:** FAIL → implement (std::process, BufReader thread, atomic gate) → PASS.
- [ ] **Step 3:** Commit: `feat: STT supervisor with gate + auto-restart`.

### Task 11: tts:: — Gemini TTS + `say` fallback + half-duplex gate wiring

**Files:**
- Create: `src-tauri/src/tts/mod.rs`, `src-tauri/src/tts/gemini.rs`, `src-tauri/src/tts/say.rs`, `src-tauri/src/keys.rs`
- Test: `src-tauri/tests/tts_gate.rs` (mock provider + fake clock), gemini request-builder unit tests (no network)

**Interfaces:**
- Produces: `trait TtsProvider { fn synth(&self, text: &str) -> Result<Pcm>; }` (`Pcm { rate: u32, mono_f32: Vec<f32> }`); `GeminiTts` (model + voice from settings; REST via `reqwest` blocking on a worker thread; **verify current TTS model id + request shape via context7/web at execution time**; 10 s timeout); `SayTts` fallback (`say -o /tmp/x.aiff` → decode via `hound`/afconvert → Pcm). `Speaker::speak(text)` — enqueues to `EngineHandle` pcm queue, closes STT gate immediately, polls `pcm_done()`, reopens gate **300 ms after** drain. `keys.rs`: `gemini_key() -> Option<String>` — Keychain (`security find-generic-password -s codakiller -a gemini -w`) then env fallback. Provider selection: gemini if key + network, else say; setting `tts.provider` overrides.
- Consumes: `EngineHandle::pcm_done` (Task 5), `SttHandle::set_gate` (Task 10).

- [ ] **Step 1:** Failing gate test: mock provider returns 500 ms of PCM; assert gate closes before first sample is enqueued, stays closed during drain, opens 300±50 ms after `pcm_done`. Request-builder test: correct URL, header `x-goog-api-key`, `responseModalities: ["AUDIO"]`, voice name passthrough.
- [ ] **Step 2:** FAIL → implement → PASS. Live one-shot: `cargo test gemini_live -- --ignored` speaks "CodaKiller online" audibly (requires key; skip cleanly if absent).
- [ ] **Step 3:** Commit: `feat: TTS providers + half-duplex gate (never hears itself)`.

### Task 12: Key migration (security-executor)

**Files:**
- Create: `scripts/migrate_keys.sh`
- Modify: `NOTES.md`

**Interfaces:**
- Produces: `GEMINI_API_KEY` from `~/piano-coach/data/secrets.env` stored into Keychain service `codakiller` account `gemini`. Source file untouched. Script is idempotent, prints nothing secret, refuses to run if key already present unless `--force`.

- [ ] **Step 1:** Write script (`security add-generic-password -U ...` reading via `grep -o` + `security` only — key never echoed, never in argv where avoidable: use `-w` prompt-less stdin form). ShellCheck clean.
- [ ] **Step 2:** Run; verify `keys::gemini_key()` finds it (Task 11's live test now passes).
- [ ] **Step 3:** Commit script only: `chore: keychain key migration script`.

### Task 13: intent::Router + end-to-end voice-controlled metronome

**Files:**
- Create: `src-tauri/src/intent/mod.rs`, `src-tauri/src/intent/numbers.rs`, `src-tauri/src/voice_loop.rs`
- Modify: `src-tauri/src/lib.rs` (wire: supervisor → router → metronome/speaker; commands `voice_mute(bool)`, `voice_state()`; events `voice://transcript`, `voice://intent`)
- Test: exhaustive inline tests in `intent/` (this is the ignore-ambient-speech firewall — test it like one)

**Interfaces:**
- Produces: `enum Intent { MetroStart(Option<f64>), MetroStop, MetroSet(MetroSetArgs), RepCheck(Verdict, Option<String>) /* behind mode flag, used P3 */, Question(String), Ignored }`; `Router::route(text: &str, mode: Mode) -> Intent`; `Mode { rep_block_active: bool, wake_word: Option<String> }`. `numbers.rs`: `parse_number("ninety six") -> Some(96.0)` (words + digits + "one twenty").
- Consumes: Transcripts (Task 10), `Speaker` (Task 11), metronome (Task 7).

- [ ] **Step 1:** Failing tests, minimum set: "metronome 96"→MetroStart(96); "turn on the metronome at one twenty"→MetroStart(120); "metronome on"→MetroStart(None→last bpm); "stop"/"metronome off"→MetroStop (bare "stop" ONLY while metronome running); "bump it up 4"/"take it down two"→MetroSet(delta); "accent every 3"→MetroSet; **rejections:** "let's see what happens"→Ignored; "I stopped by the store yesterday"→Ignored (word-boundary + running-state guard on "stop"); random lyrics→Ignored; wake-word mode: "coda metronome 90" routes, "metronome 90" ignored; final-only routing (partials never trigger).
- [ ] **Step 2:** FAIL → implement (regex grammar, no LLM) → PASS.
- [ ] **Step 3:** Wire `voice_loop.rs`: only `is_final` transcripts route; every actioned intent gets a ≤5-word TTS confirmation ("Ninety-six.") through `Speaker` (gate proves itself continuously). Emit `voice://transcript` + `voice://intent` events for the UI.
- [ ] **Step 4:** Minimal voice status UI: mic glyph in top bar (live/muted/down states from events), transcript toast on action. Live dev-run sanity: say "metronome ninety six" → clicks at 96 → app says "Ninety-six." and does NOT react to its own voice.
- [ ] **Step 5:** Commit: `feat: intent router + end-to-end voice loop`.

### Task 14: P0–P2 acceptance — live bleed/noise test + verifier gate

**Files:**
- Create: `docs/qa/p2-acceptance.md`

**Interfaces:**
- Produces: recorded acceptance evidence; verifier verdict.

- [ ] **Step 1:** Scripted live test (run at his Mac, speakers at practice volume, doc results): (1) 10 voice commands → ≥9 correctly actioned; (2) while the app speaks a long confirmation, its own voice triggers ZERO intents (check `voice://transcript` log — gate window must show no self-transcripts); (3) play 60 s of loud piano audio from YouTube through the room → ZERO intents fired; (4) casual conversation near the mic → ZERO intents (only grammar hits route); (5) metronome runs 10 min → no drift vs a reference timer (start-aligned, compare final beat), no audio glitches while UI animates.
- [ ] **Step 2:** Dispatch fresh-context **verifier** agent: claim = "P0–P2 complete per plan"; it re-runs `cargo test`, `npm test`, `npm run tauri build`, probes the gate logic adversarially (e.g., TTS enqueue race: speak twice fast; gate must not reopen between), and checks NOTES.md facts against code. Fix anything CONFIRMED-broken before proceeding.
- [ ] **Step 3:** Commit: `docs: P2 acceptance evidence` + tag `p2-done`.

---

## Self-review notes

- Spec coverage (P0–P2 scope): framework/identity ✓(T2), dark/light shell ✓(T3), store schema §5 ✓(T4), metronome incl. boost + sounds + accents/subdivisions §3 ✓(T5–8), voice pipeline §3 steps 1–4 ✓(T9–13), half-duplex ✓(T11), mode-scoped etiquette + wake word ✓(T13), key handling ✓(T12), acceptance ✓(T14). Rep vocab enum lands here but activates in P3 (spec §4) — intentional.
- P3–P6 (pieces/rep engine, score viewer, brain/library, references/polish) get their own plan after `p2-done`, informed by NOTES.md facts. This is the scope-check split, not an omission.
- Type consistency pass done: `EngineHandle::pcm_done` (T5→T11), `SttHandle::set_gate` (T10→T11), command names (T7→T8), `Intent::RepCheck(Verdict, …)` uses store's verdict enum (T4).
