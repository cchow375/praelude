# CodaKiller — The Whole Project in One Document

> **Purpose of this file:** a complete, self-contained summary of CodaKiller. Paste it
> into any AI (or hand it to any person) and they should understand what the app is, how
> it works, why it's built this way, what's planned, and what's honestly still weak —
> enough to give useful suggestions or answer questions about it.
> Maintained by Claude; updated after every change. **Last updated: 2026-07-10 (v0.1.0).**

---

## What it is

**CodaKiller** is a voice-first **practice & rep tracker** for a serious pianist, built
as a native, publishable macOS app (Tauri v2 — Rust core + web frontend). You talk while
you practice ("open a rep tracker, measures 40 to 56, start at 80, target 120"; "done";
"bump it up four"; "metronome ninety-six"; "stop") and it counts reps, runs the
metronome, times you, remembers your pieces and hard spots, and answers open questions —
hands-free, so you never stop playing to poke at a UI.

**The core principle — the thing everything else follows from:**
**the user is the sensor; the app is the memory.** CodaKiller *never* interprets audio as
music. Audio input means **speech only**. The human gives every verdict about their
playing. The app does what computers are actually good at: counting, timing, remembering,
structuring, and knowing things.

## Why it's built this way (the honest origin)

CodaKiller is the ground-up replacement for **PianoCoach**, an earlier app (its full
1→4 version history lives in its own repo/vault) that was built around *listening to the
piano and grading it*. That was the fatal flaw: the user plays a **Steinway acoustic baby
grand** into a **MacBook Air built-in mic**, where even a clean take transcribes at
**35–52% note accuracy with timing error in whole seconds**. Every "judgment" the old app
made ran off that lossy signal, producing a family of bugs — false verdicts, mid-phrase
cutoffs, the coach's own TTS bleeding into the mic, unwinnable drills, a poisoned
scheduler. Four versions of patching taught the lesson the expensive way: *stop grading
what the mic can't hear.*

CodaKiller is that lesson built clean. Because it never needs to hear piano, it simply
doesn't listen while it speaks (a half-duplex gate), and speech that matches no command
is ignored rather than misinterpreted. It **inherits the old app's lessons, not its code
or its UI** — new stack, apple-grade design, small testable modules instead of a
2,406-line server file.

## How it works (architecture)

Tauri v2: a small, testable **Rust core** + a **React/TS WebView** frontend, bundled into
one native `.app` (no web server, no cache-busting, no stale-deploy problems).

**Rust core (`src-tauri/src/`), one purpose per module:**
- **audio/** — a sample-accurate cpal output engine (a fractional-sample clock + mixer)
  that plays the metronome and TTS. Lock-free: no mutex/alloc/free on the real-time audio
  thread; cross-thread input goes through lock-free queues. Runs in Rust, not the WebView,
  so it never stutters from browser timer throttling and keeps clicking when minimized.
- **stt/** — a supervisor around `hear` (a signed CLI wrapping Apple's on-device
  `SFSpeechRecognizer`; offline, private, ~27 MB RAM, 0.2–0.7% CPU). Auto-restart with a
  storm cap; SIGTERM-the-process-group teardown (no orphaned mic-holding processes); a
  **half-duplex gate** that drops transcript lines while TTS plays and for 300 ms after,
  so the app can never hear itself.
- **intent/** — a deterministic regex/number-grammar command router (0 ms, offline).
  Mode-scoped vocabulary. Anything not matching an active command is silently ignored —
  this is the firewall that lets it listen through real playing.
- **tts/** — Gemini TTS (the `v1beta/interactions` endpoint, model
  `gemini-3.1-flash-tts-preview`, audio decoded from `steps[].content[].data`) with the
  system `say` command as an automatic offline fallback. One owning thread serializes
  speech and drives the half-duplex gate.
- **metronome.rs** — full engine: multiple click sounds, accents, subdivisions, gain, and
  a **boost mode** that raises system output volume while running and restores it after
  (crash-safe on stop/close/quit/Drop). Voice- or popover-controlled.
- **store/** — rusqlite (settings today; the pieces/blocks/reps/sessions schema is
  designed but P3 builds it). **sysvol/keys/voice_loop** — system volume, Keychain access
  (Gemini key, never logged), and the end-to-end voice loop wiring.

**Frontend (`src/`, React + TS + Vite):** a dark/light shell, a metronome popover, and
voice status/toast UI today. The score view (OSMD), rep HUD, library, intake, and settings
breadth are P3–P6.

**The voice pipeline** (what the old app got wrong, done right): `hear` streams transcript
lines → the half-duplex gate drops anything heard while/just-after TTS plays → the intent
router matches deterministic commands (or ignores) → the metronome/rep engine acts
instantly and the coach speaks a short confirmation. The LLM "brain" is reserved for
open-ended questions only; it is never in the command loop.

## Current state (v0.1.0 — honest)

**Built and shipped (P0–P2):**
- ✅ Tauri shell, dark/light theme, settings store, sqlite schema v1.
- ✅ Sample-accurate audio engine; 6 synthesized click sounds; drift-verified over a
  simulated 10-minute run at a non-integer tempo.
- ✅ Full metronome (tempo/beats/subdivision/accent/gain/sound) + boost mode, popover UI.
- ✅ Voice loop: `hear` supervisor + half-duplex gate + deterministic intent router +
  Gemini TTS (with `say` fallback). Spoken commands drive the metronome; it never hears
  itself; a 60 s real-piano-plus-narration test produced **zero** false intents.
- ✅ Gates at ship: cargo 105 lib + 12 integration tests, clippy clean, npm 36/36, release
  `.app` bundles `hear` + click assets with both usage strings. Installed to
  `/Applications/CodaKiller.app`.

**NOT built yet (this is most of the actual product):**
- ❌ The rep tracker itself (blocks, ladders, variants, verbal check-off) — **P3**.
- ❌ Pieces + intake interview + practice sessions + vault export — **P3**.
- ❌ Score viewer (OSMD render of MusicXML, measure navigation) — **P4**.
- ❌ Brain (grounded Q&A / planner narration) + knowledge library — **P5**.
- ❌ References (Spotify/YouTube), full settings, design polish, DMG packaging — **P6**.

**So today CodaKiller is, honestly, a voice-controlled metronome with an excellent
foundation — not yet the practice tracker it's meant to be.**

## Honest flaws & risks (short list — full register in the project's FLAWS doc)

1. **The thesis is unproven with the real user.** Everything is verified by automated
   tests and `say`-through-speakers; Christian has **not** used it at his actual Steinway.
   The −34 dB speaker→mic loopback makes unattended acoustic testing impossible, so
   real-room robustness (does his playing + speech trigger false intents? does his voice
   get heard reliably over a grand? does the metronome cut through?) is **unverified**.
   The human at-piano acceptance checklist is written but **pending**.
2. **~2/3 of the vision is unbuilt** (P3–P6). The reframe ("track, don't grade") is sound
   in theory but the tracking product doesn't exist yet.
3. **No off-disk backup** — the repo is local-only; a disk failure loses everything.
4. **Preview-API fragility** — the Gemini TTS endpoint/model are preview and undocumented
   in places (the response shape had to be reverse-engineered against the live API); they
   can change. Runtime Gemini→`say` fallback-after-N-failures is deferred to P3.
5. **Small latent couplings** documented in NOTES: the 2.5 s ASR re-send dedup is only
   safe because every ack closes the STT gate; a progressive-revision artifact can make
   the metronome briefly start at 90 then correct to 96; `kill -9` can orphan `hear` or
   strand boost volume (Drop can't run). None are shipped-blocking, all are written down.
6. **8 GB M2 Air** caps everything — no local ML runtimes ever; that constraint is load-
   bearing on the whole design.

## Roadmap (next steps)

- **Now:** Christian's real at-piano acceptance run of v0.1.0 (the first real-world signal).
- **P3 → v0.2.0 (the real product begins):** vault piece ingest, intake interview, rep
  blocks/ladders/variants, verbal check-off, sessions + markdown export. Plus the two P3
  debts: runtime TTS fallback, mic-permission-denied guidance.
- **P4 → v0.3.0:** OSMD score viewer + verbal/click measure navigation + block highlight.
- **P5 → v0.4.0:** Claude/Gemini brain (grounded Q&A, planner narration) + knowledge
  library (port the old Drill Library + Strategy Engine; author a practice-psychology layer).
- **P6 → v1.0.0:** Spotify/YouTube references, full settings, apple-grade design pass, icon,
  DMG packaging.

## Family context

CodaKiller is one of three related things in Christian's world: **PianoCoach** (the dead-end
predecessor whose lessons live on), **CodaKiller** (this — the focused, correct piano
practice tool), and **Cadencify** (a generalized real-time AI tutor; the old coach is its
"grounding seed"). CodaKiller and Cadencify are cousins built on the same lessons; they
share no code.

---
*Repo: `~/codakiller` · stack: Tauri v2 (Rust + React/TS) · user: Christian (NEC-prep
pianist, Steinway acoustic, 8 GB M2 MacBook Air).*
