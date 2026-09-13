---
type: tool
tags: [piano, coach, app]
built: 2026-07-02
---

# 🎹 PianoCoach — the live-listening coach aka CodaKiller

> **Start it:** open **PianoCoach.app** (in /Applications — it's a real native app now,
> dock icon and all). First mic use asks permission once. Fallback: `~/piano-coach/run.sh`
> still works in a browser.
>
> 📖 **Full reference** (how it works, every file, what it does & doesn't have): [[(C) Coach App — How It Works]] I am wondering if I can actually scale this to my [[(C) Cadencify Command Center]]

The vault coach, with ears. Hit **● Listen**, play a passage, and it:
1. **hears you WHILE you play** — a streaming listener charts onsets/tempo/evenness live and the ByteDance model transcribes in the background as you go (per-note velocity too),
2. finds where you are in the score (or you set the bars) — the score cursor follows you,
3. measures: tempo, missed/wrong notes per bar, timing σ (ms), rushing/dragging, uneven runs, flat chord voicing — **on a live per-bar chart, not a wall of text** — plus dynamic-arc / tempo-curve / climax-placement proxies,
4. **speaks a verdict ~1s after you stop** (template reflex, zero tokens), matches ONE Strategy-Engine method, and offers **Start drill**; Claude's deeper why streams into the text pane behind it,
5. tracks the **tempo gate** — 3 clean in a row before the metronome moves up 4,
6. **Drill mode** runs the full rep loop hands-free: it checks you're *actually doing the method* (a straight rep of a dotted task doesn't count), counts out loud ("clean — two more"), resets on a miss, drops a rung when misses wander, escalates when the same spot breaks twice, and bumps +4 when you gate. Built-in metronome (its clicks are ignored by the listener).

## What's where
- **Coach tab** — listen + chat (typed or 🎙 voice; it talks back).
- **Session tab** — [[(C) Daily Practice]] rendered live, checkboxes clickable, log form that appends to the piece's practice-log.
- **Data tab** — take history, clean streaks, chronic trouble zones across days.

## Trust levels (same spirit as [[Piano Practice/Lessons/(C) README|Lessons]])
- 🟢 tempo, dropped/wrong-note **clusters**, rushing/dragging, clean/not-clean
- 🟡 single-note verdicts in fast ff passages on the laptop mic; velocity absolute values
- 🔴 pedaling detail, anything the mic clipped

## Voice (local, hands-free)
Hit **Voice** and just talk — local Silero VAD hears you, whisper transcribes,
the coach answers out loud (Kokoro TTS, all on-device, nothing billed). **Interrupt
it any time by speaking or playing** — its audio cuts instantly and it listens.

## Adding a piece (works for ANY piece)
1. Piece folder in `Pieces/` (copy `_piece-template`).
2. Drop a **MusicXML** (`.musicxml`/`.mxl`/`.xml`) into its `score/` → hit **↻** in the app. That's it.
3. Optional but recommended: a `(C) coach-profile.md` (phase: securing|polish + sourced
   tempo targets) — controls what the coach headlines. Prokofiev Op.1 is the model example.

> 🗄️ **ARCHIVED v1 SNAPSHOT** — this is the v1 hub, frozen 2026-07-04. The live
> app is v2; see [[(C) Coach App]] and [[(C) Coach App — How It Works]].

## Claude's Notes (updated 2026-07-03 — the big rebuild)
- Pieces live now: Scherzo ✅ (securing) · Op.90 ✅ (polish) · **Griffes ✅ (securing — your
  MusicXML installed + coach-profile written)** · Prokofiev Op.1 ⏳ (still needs its MusicXML).
- **Two brains:** Claude (deep why, interpretation — CLI login or API key) + a **local
  gemma3:1b via Ollama** for quick turns and drill lookups (zero tokens). Header has an
  Auto/Local/Claude toggle; Auto routes short conversational turns local. All rep-loop
  callouts and the instant verdict are **templates — no LLM, no tokens, no latency.**
- **Voice ≠ text now:** the voice speaks only the SPOKEN line (≤2 sentences, the one method
  + measure + why, numbers said like a musician: "four ninety-two"); the text pane gets
  everything; per-bar data lives on the chart. They are never identical.
- Clickable measures: any "m.NNN" in the coach's replies or the Data tab pans the score there.
- Code + take history live in `~/piano-coach/` (outside vault, like the lesson tools).
- **Every practice decision traces to [[Piano Practice/(C) Strategy Engine (AI).md]]** — the
  app parses it live (28 methods + routing + the §5 rep protocol). Edit the Engine in the
  vault and the app's coaching changes with it. No practice logic is hardcoded.
- ⚠️ 8 GB Mac reality: the app staggers its model loads at launch (UI first, models over
  ~30s). Don't run it alongside heavy stuff on day one; if voice feels sluggish right after
  launch, give it half a minute.

==**MY NOTES**==
- My biggest problem with it right now is that it still feels like a chat bot rather than actually speaking to a coach. There is still awkward delay between talking and playing and waiting for feedback
- A potential solution is making it work like how a human does. A human teacher doesn't mentally record what you are playing and then listen back after; they listen real time and take note of things in real time as you are playing. They will hear a wrong note immediately. They will notice if something is uneven the moment the sound comes. I wonder if the AI could actually do this.
- It also needs more context on how to practice. There needs to be local like strategies or some big library or context window that it knows is good. With chunking I believe a Local LLM could actually do this quick, or maybe just a search script as well to recognize that it is a fast passage
	- an example is if it knows it is dealing with a long run, it looks at a library of how to practice long fast runs in the right hand and an example is like dotted rhythem or stacatto and it has to understand what the issue is(unevenness, missed notes) and assign it to the user based on that
	- This takes a lot of context research and looking up what good piansts say helps them practice
- another problem is that after passages are played, it still just gives a big chunk of text. Look at how piano lessons usually go in my like piano lesson history. The Piano teachers say the measure(like yuki or jeanie) and either play the passage to see what it sounds like.
- The voice model is reading exactly what the text model is saying. They should be different. The voice model should  say the most important things and measure numbers and how to practice it. what it shouldn't do is talk for ten minutes and give a gigantic instruction oral exam. The nitty gritty details and graphs of exactly what notes are missing should all be demonstrated on like a chart for each thing that shows all the problems and measure numbers specifically, and the voice model should actually explain why. In other words, the text model should say everything the voice model says PLUS the additional details that aren't as important. The distinction is making sure the voice and text models are not saying the same thing.
- Biggest issue though is still the large pause. I would suggest the listening software actively chart down the mistakes and missed notes as the person is playing so the moment they are done, the voice model can respond almost immediately, and the chart is quickly revised and broken down and stuff. Although this is not always the case I want because it needs to still recognize things like bigger picture phrasing and overall musicality. Like did the whole passage tell a story and convey it in the right way for things like interpretation. Did it feel stormy enough and did it build up to things. These are the real challenges that i would like it to overcome.
- remember the main goal. Using this should feel like you are in a lesson with a conservatory teacher who is actually taking the time to tell you exactly how to practice passages(this is very rare)
- I also don't want this to be a web app. I want it to be a local app. The voice model thing needs to be fixed. The local LLM thing should also be fixed as well. This app should be close to a deliverable but does not need to be yet. Still heavily for me only right now.

---

# 🏗️ Build Brief — Handoff to the Coder (Fable 5)

> **Purpose:** the framework, not the code. This synthesizes MY NOTES above + the
> strategy work into an actionable spec. Fable 5 does the implementation in
> `~/piano-coach/`. Source of truth for practice logic = [[Piano Practice/(C) Strategy Engine (AI).md]].

## 🎯 The one-line goal
Make CodaKiller feel like **a conservatory teacher listening in real time** — not a
chatbot you play *at* and then wait on. A real teacher hears the wrong note the
instant it sounds, reacts immediately, and tells you *exactly how to practice* the
fix. That's the bar.

## 🩺 Root problem (from MY NOTES)
The app **records → then analyzes → then talks.** A human **listens while you play.**
That single architectural gap causes ALL of these at once:
- ⏳ the awkward pause between playing and feedback
- 🤖 the "chatbot, not a coach" feel
- 🧱 the wall-of-text debrief
- 🗣️ the voice reading text verbatim (robotic, wrong number pronunciation)

Fix the listening model and most of this collapses into one fix.

## 📋 What I want, ranked by build order

| # | Feature | Status | Effort | File(s) |
|---|---|---|---|---|
| 0 | **Native local app, NOT a web app** — leave the browser/localhost model; ship a real desktop app | ✅ **built 7/3** — PianoCoach.app in /Applications (WKWebView shell, mic patched) | high | `app.py`, `build_app.py` |
| 1 | **Voice/text split** — voice says the ONE method + number + why (≤2 sentences); all per-bar detail → a **chart**, not the mouth | ✅ **built 7/3** — SPOKEN/DETAIL contract, chart is local | low | `prompts.py`, `llm.py`, UI |
| 2 | **Human number speech** — `m.492–499` → "measure four ninety-two to four ninety-nine", never "em dot four hundred ninety-two dash" | ✅ **built 7/3** — full Engine §6 table | low | `voice.py` |
| 3 | **Local strategy library** — grounded methods, acoustic signatures, adaptive rep-loop | ✅ **built** — and the app now parses it live | — | [[Piano Practice/(C) Strategy Engine (AI).md]] + `engine.py` |
| 4 | **Acoustic method-check** — confirm the student is *actually* doing the drill (dotted sounds dotted, staccato sounds detached) before counting a rep | ✅ **built 7/3** — 9 signatures, corrections in the Engine's own words | med | `methods.py` |
| 5 | **Real-time streaming listener** — detect wrong notes / timing / evenness AS you play, chart them live, so voice fires ~instantly on stop | ✅ **built 7/3** — verdict ~1s after stop (verified on synthetic takes) | high | `stream.py`, `/ws/listen` |
| 6 | **Live-charting → instant reply** — chart accumulates during the passage; on stop, data's already there | ✅ **built 7/3** — per-bar cells fill while playing | high | `stream.py`, UI |
| 7 | **Fix the voice model** — snappier, more natural, reliable; local, hands-free, no verbatim reading | ✅ **built 7/3** — small.en STT (~6× faster), tighter VAD, speaks only SPOKEN | med | `voice.py` |
| 8 | **Local-LLM routing** — small local model for terse spoken feedback + drill lookup (zero tokens); Claude only for deep "why"/interpretation | ✅ **built 7/3** — gemma3:1b via Ollama + Auto/Local/Claude toggle; callouts are token-free templates | med | `llm.py` |
| 9 | **Musicality proxies** — dynamic arc / rubato curve / climax placement vs a reference recording; label interpretive verdicts as approximate | ✅ **built 7/3** — arc/tempo-curve/climax vs the score's markings, labeled approximate (reference-recording compare = future) | high | `analyze.py` |

**Order:** 1 → 2 → 7 → 4 → 5 → 6 → 8 → 9, with **#0 (native app) as the container** the
rest ships inside. Ship #1/#2/#7 first (fast, kills the wall-of-text + robotic voice).
#5 is the real project (the pause). #9 is the frontier — do last, frame as
*evidence, not verdict*.

> **On #0:** the backend (`coach/`: score, transcribe, align, analyze, history, vault,
> prompts, llm, voice) is UI-agnostic and worth keeping. What changes is the shell —
> replace the browser/`localhost:8765` front with a native desktop app (Tauri or a
> Swift/Electron shell wrapping the same Python backend). Don't rewrite the brains to
> change the window.

## 🧠 Non-negotiable practice principles (all encoded in the Engine)
- **Default = slow, perfect, metronomic repetition** until it's muscle memory. Speed
  is a *result* of security, never the method.
- **Metronome is mandatory** (except rubato work). **Always name a target tempo.**
- **Gate:** 3 clean in a row → +4 bpm. A wrong/hunted rep **resets the count** (it
  rehearses the error).
- **Verify the *manner* before grading the rep** — a straight rep of a "dotted" task
  is the WRONG exercise, not a clean rep. (This is the acoustic-check, #4.)
- **Escalate to granular on repeat failure** — don't say "again," change the tool
  (smaller cell, slower, different method). See Engine §5 protocol.
- **Recognition over reps** — match the PROBLEM TYPE, not "practice more."

## 🔊 The voice/text split (exact contract)
Claude returns **structured output**, not one blob:
```
{ "spoken":  "short: the ONE method + tempo + measure(s) + the why",   → TTS (normalize numbers)
  "chart":   { per-bar missed/wrong notes, timing σ, evenness, voicing },  → visual table in UI
  "detail":  "the longer text explanation (everything spoken + the nitty-gritty)" }  → text pane
```
Rule: **text says everything the voice says PLUS the details; voice and text must not
be identical.** Voice = the important stuff, said like a human. Text/chart = the
graphs, exact missing notes, measure-by-measure breakdown.

## ⏱️ The real-time listener (the hard one — how a human does it)
- Cheap **streaming** onset + wrong-note + timing/evenness detection runs *while*
  playing → fills the chart live → the moment you stop, the reaction is already computed.
- Keep the **ByteDance full-clip pass** as a fast *post-pass* for accurate
  velocity/voicing and dense-ff verdicts.
- **Accept the tradeoff:** note-level reaction is instant; **big-picture phrasing /
  musicality lands a beat later** (needs the whole passage) — exactly like a real
  teacher. Don't try to make musicality real-time.

## ✅ Definition of done (per feature) — ALL MET 2026-07-03
- [x] Runs as a **native local app**, not a browser tab. *(PianoCoach.app)*
- [x] Voice never reads a raw `m.NNN`/`♩=N`/`RH` token aloud — always normalized.
- [x] Voice turn ≤ ~2 sentences; the rest is on the chart. *(SPOKEN/DETAIL contract)*
- [x] App reads the Strategy Engine as its source of truth (no practice logic hardcoded). *(engine.py parses it live)*
- [x] Before counting a rep clean, app confirms the drill's acoustic signature. *(methods.py)*
- [x] Rep-loop counts out loud ("clean — two more"), resets on a miss, escalates on repeat failure. *(reploop.py)*
- [x] Feedback fires ≤ ~1–2s after you stop playing (streaming path). *(measured 0.13–3.3s on synthetic takes; typical ~1s)*

> **Prime directive for the coder:** every practice decision the app makes should be
> traceable to [[Piano Practice/(C) Strategy Engine (AI).md]]. The app is the ears,
> mouth, and stopwatch; the Engine is the brain.
