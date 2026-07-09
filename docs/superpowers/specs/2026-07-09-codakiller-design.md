# CodaKiller — Design Spec
**Date:** 2026-07-09 · **Status:** Approved by Christian (framework, voice, listening mode, go-ahead all confirmed 2026-07-09)

## 1. What this is

CodaKiller is a voice-first **practice tracker and rep tracker** for a serious pianist, built as a native, publishable macOS app (Tauri v2). It replaces PianoCoach.app, whose fatal flaw was being built around listening to the piano on hardware that cannot do it (MacBook mic ⇒ 35–52% accuracy on clean takes, timing σ in whole seconds).

**Core principle: the user is the sensor; the app is the memory.**
The app NEVER interprets audio as music. Audio input means speech only. The user gives every verdict about their playing. The app counts, times, remembers, structures, and knows things — the things computers are actually good at.

This kills the old app's bleed/cutoff/infinite-loop family of bugs *by design*: because the app never needs to hear piano, it simply does not listen while it speaks (half-duplex), and unmatched speech is ignored rather than misinterpreted.

### Explicit non-goals (v1)
- NO transcription of playing, NO grading, NO position tracking, NO pitch detection, NO "what went wrong" analysis from audio. (A future listening mode may return behind a hard input-mode gate — not now.)
- NO local LLM (8 GB machine; the old app already learned this).
- NO LLM in the hot loop. Rep check-offs and metronome control are deterministic and instant.
- NO auto-imposed drills or plans. Suggest, never dictate. (v4 lesson.)
- NO always-on web server / cache-busting / stale-server deploys. Tauri bundles everything.

## 2. Decisions locked with the user

| Decision | Choice |
|---|---|
| Framework | **Tauri v2** (Rust core + web frontend, native window). Publishable .app/DMG. |
| Coach voice | **API TTS from day one** — Gemini TTS using the existing `GEMINI_API_KEY`; provider abstraction with system `say`/AVSpeech fallback when offline; ElevenLabs/OpenAI addable in Settings later. |
| Listening | **Open mic, mode-scoped.** During a rep block, bare check-off vocabulary counts ("done", "again", "nope, LH jump"). Outside one, command patterns work anytime. Speech matching nothing is ignored. Mute toggle + optional wake word in Settings. |
| Brain | Claude (via Anthropic API key if present, else a node sidecar using `@anthropic-ai/claude-agent-sdk` over the existing Claude Code login) with **Gemini API as the always-available fallback**. Swappable in Settings. Used ONLY for open-ended questions, intake conversations, and plan narration. |
| Repo | `~/codakiller`, git from commit zero. Old app (`~/piano-coach`, PianoCoach.app) untouched. |
| Name | CodaKiller. Vault docs for this app live in a NEW vault folder `Piano Practice/CodaKiller 2/` so the old app's `CodaKiller/` docs are never clobbered. |

## 3. Architecture

```
┌────────────────────────── Tauri v2 app ──────────────────────────┐
│  Rust core (small, testable crates/modules)                      │
│  ├── audio/      cpal output engine: metronome mixer + TTS play  │
│  ├── stt/        `hear` child-process supervisor + half-duplex   │
│  │               gate (STT muted from TTS start → end + 300 ms)  │
│  ├── intent/     deterministic command grammar (regex/nom); mode-│
│  │               scoped vocab; falls through to brain/ or ignore │
│  ├── rep/        rep blocks, ladders, variants, verdict log      │
│  ├── planner/    deterministic suggestions: deadlines + spaced   │
│  │               revisit of hard spots + resume points           │
│  ├── brain/      LLM adapter (Claude / Gemini), grounded prompts │
│  ├── tts/        Gemini TTS client → PCM → audio/; `say` fallback│
│  ├── store/      rusqlite (pieces, blocks, reps, sessions,       │
│  │               settings) + markdown export to vault            │
│  ├── vault/      read piece folders + MusicXML; write session    │
│  │               logs (only under `CodaKiller 2/` + per-piece    │
│  │               `(C) codakiller-*.md` files)                    │
│  └── refs/       Spotify (AppleScript) + YouTube (browser open)  │
│                                                                  │
│  WebView frontend (Vite + React + TS)                            │
│  ├── Score view (OSMD, vendored) — the hero surface              │
│  ├── Rep HUD overlay · Metronome popup · Library popup           │
│  ├── Intake/chat drawer · Session timeline · Settings            │
│  └── Design system: apple.com-grade interaction, dark + light    │
└──────────────────────────────────────────────────────────────────┘
```

**Voice pipeline (the part the old app got wrong):**
1. `hear` (signed CLI wrapping Apple's on-device SFSpeechRecognizer; GitHub release v0.8) runs continuously, streaming transcript lines to the Rust supervisor. Piano/noise never becomes input: the recognizer only emits speech, and anything not matching the active grammar is dropped.
2. Half-duplex gate: while TTS audio plays (Rust owns playback, so it knows exactly when), STT lines are discarded; gate releases 300 ms after playback ends. No echo cancellation needed; no barge-in in v1 (coach utterances are intentionally short; Esc/click stops TTS).
3. Intent router: rep-mode vocabulary and global commands are deterministic (0 ms, offline). Questions (interrogative forms or wake-word-prefixed) go to the brain. Everything else is ignored silently.
4. First launch triggers macOS Microphone + Speech Recognition permission prompts (one-time, by design).

**Metronome (Rust, not WebView — immune to WebView timer throttling; keeps clicking with the window minimized):**
- cpal output stream; clicks mixed at exact sample offsets; tempo/pattern changes are atomic.
- Multiple click sounds (limiter-maximized samples), accent every N beats, subdivisions, tap-less verbal + full manual popup control.
- Honest loudness: cannot exceed hardware max. Provides its own gain independent of app volume + optional **boost mode**: raises system output volume while running, restores it after.
- Ladder sync: when a rep block steps tempo, the metronome follows automatically.

## 4. Product behavior

**Pieces.** Piece list is seeded from the vault (`Piano Practice/Pieces/*/score/*.musicxml` where present; PDF-only pieces still get tracking, just no score render). First open of any piece = **intake interview** (verbal or typed): goals, deadline, target tempo, known hard spots, current state. Stored per piece; drives suggestions.

**Rep tracker (the heart).** "Open a rep tracker, measures 40 to 56, start at 80, target 120" →
- Ladder auto-computed (app proposes rep count + bpm increments) or fully manual ("30 reps, +4 each 3 clean").
- Variant schemes: e.g. 10 dotted, 10 staccato, 10 legato — arbitrary, named, reorderable.
- Verbal check-off: "done" / "clean" / "again" / "nope, missed the LH jump" → rep logged with tempo, variant, verdict, note. The app speaks back minimally ("12 of 30").
- HUD overlay shows block progress next to the score; block ranges highlight on the score.
- All blocks persist per piece; reopening a piece offers to resume.

**Practice sessions.** Every action lands on a session timeline. Session end (or on demand): summary markdown appended to the vault per piece — same "Today's Session / History" spirit the user already liked, fresh implementation.

**Planner.** "What should I practice today?" → deterministic engine ranks: deadline pressure, hard spots due for revisit (simple spaced-repetition intervals), yesterday's resume point, goal progress. Brain narrates and adjusts conversationally, but the data and ranking are engine-owned.

**Q&A (brain).** "How do I practice m. 83? The LH stretch is hard" → prompt is grounded with: the MusicXML slice for those measures, the piece's own vault docs (overview/score-map — human-authored gold), and the knowledge library. Suggestions cite which method they're using. Verdicts are never generated — the brain never judges playing it cannot hear.

**Knowledge library.** Markdown docs, browsable in a popup, searchable, and used to ground the brain: (a) the old Drill Library + Strategy Engine's ~24 methods, ported and rewritten clean (symptom → method routing retained); (b) a new practice-psychology layer authored from Bulletproof Musician-style evidence (interleaved/random practice, spacing, mental practice, slow-practice discipline, performance preparation, self-talk) — none exists in the vault today (verified).

**References.** "Play me Ohlsson's recording" → Spotify search/play via AppleScript (proven pattern), or YouTube in the browser. Mic listening is irrelevant during playback (we never interpret audio), but TTS defers while a reference plays.

**Settings (deep, as requested).** Voice provider + voice choice, wake word on/off + word, mute toggle hotkey, metronome sounds/boost/accent defaults, rep-vocab customization, ladder defaults, vault paths, brain provider + API keys (Keychain-stored), theme (dark/light/auto), TTS speed, session export rules.

## 5. Data model (rusqlite)

- `piece` (id, title, composer, xml_path, pdf_path, goals JSON, deadline, target_tempo, hard_spots JSON, intake_done, notes)
- `rep_block` (id, piece_id, m_start, m_end, label, start_bpm, target_bpm, increment_rule JSON, planned_reps, variants JSON, status, created_at)
- `rep` (id, block_id, ts, bpm, variant, verdict ENUM clean/flawed/failed, note)
- `session` (id, started_at, ended_at, summary_md) + `session_event` (ts, kind, payload JSON)
- `spot_review` (piece_id, spot, last_seen, interval_days, ease) — planner spacing
- `setting` (key, value)

Vault writes are additive and namespaced (`CodaKiller 2/` + `(C) codakiller-session {piece}.md`); the app never edits human-authored piece docs.

## 6. What NOT to repeat (verified against the old codebase)

1. God object (server.py, 2,406 lines) → small modules, one purpose each, unit-tested Rust core.
2. Perception-first design → user-as-sensor (this spec's core principle).
3. TTS bleed/barge-in chaos → half-duplex gate owned by the process that plays the audio.
4. LLM latency in the interaction loop → deterministic intent router; brain only for open questions.
5. Torch/ML runtime on an 8 GB machine → zero ML processes; `hear` uses the OS's own engine.
6. Stale-server deploys + cache-bust versioning → bundled app; quit/relaunch fully swaps code.
7. Hardcoded Homebrew paths → capability detection + graceful degrade.
8. Imposed drills, scheduler poisoning, coach-knows-best verdicts → suggest-only planner; user verdicts are the only verdicts.

## 7. Build phases (each ends usable + verified)

- **P0 — Skeleton:** Tauri scaffold builds + launches; window, dark/light shell, settings scaffold; toolchain installs (rust via brew, `hear` v0.8, npm deps); git hygiene; .app produced.
- **P1 — Metronome:** full engine + popup UI + sounds + accents/subdivisions + boost mode. Daily-usable immediately.
- **P2 — Voice loop:** `hear` supervisor, half-duplex gate, intent router, Gemini TTS; voice-controls the metronome. **Live acceptance test: zero self-bleed, piano/noise never triggers input.** (Riskiest phase — spike first, fallbacks documented: if `hear` misbehaves → whisper.cpp small; if Gemini TTS latency annoys → prefetch + system-voice fallback.)
- **P3 — Pieces + rep engine:** vault piece ingest, intake interview, rep blocks/ladders/variants, verbal check-off, sessions + vault export.
- **P4 — Score viewer:** OSMD render of vault MusicXML, verbal/click measure navigation, block highlighting.
- **P5 — Brain + library:** Claude/Gemini adapter, grounded Q&A, planner narration, knowledge library content (ported + authored).
- **P6 — References + polish:** Spotify/YouTube, settings breadth, full design pass (apple.com-grade interaction), app icon, DMG packaging.

**Verification bar per phase:** executor implements → fresh-context verifier adversarially tests (live app, not just unit tests) → live smoke on the user's Mac. Security-executor reviews anything touching keys (Keychain, secrets.env migration).

## 8. Risks & honest limits

- `hear` continuous-mode robustness is assumed from docs, not yet proven on this machine → P2 spike is the first task of that phase.
- API TTS needs network; offline practice falls back to system voice automatically.
- Metronome "louder than max" is physically impossible; boost mode + maximized samples is the ceiling.
- WKWebView OSMD rendering of the big Scherzo XML must be performance-checked on 8 GB (old app proved OSMD works in WKWebView; size is the open question).
- TCC permission prompts (mic + speech) require one interactive Allow on first run.
