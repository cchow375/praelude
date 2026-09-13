---
type: archive
tags: [piano, coach, app, archive, v1]
archived: 2026-07-04
---

# 🗄️ CodaKiller v1 — archive (frozen 2026-07-03)

> This folder is the **frozen record of the v1 PianoCoach app**, kept because
> parts of it may still be worth pulling from. The live app is **v2** (rebuilt
> 2026-07-04 per [[(C) Fable 5 Rebuild Prompt]]). Current docs:
> [[(C) Coach App]] + [[(C) Coach App — How It Works]].

## What's here
- **`(C) Coach App — How It Works (v1).md`** — the **complete v1 deep reference**,
  untouched. This is the most valuable thing in the archive: it documents the
  entire v1 architecture file-by-file (the streaming listener, the two-brain
  routing, the local voice stack, every metric and trust tier).
- **`(C) Coach App (v1 hub).md`** — the v1 human quickstart hub as it stood at
  the moment of the rebuild.

## Why keep it
The v1 app **code itself is gone** — `~/piano-coach/` was not under version
control, so the rebuild overwrote `server.py`, `llm.py`, `reploop.py`, and the
web UI in place. These two docs are therefore the **only surviving record of how
v1 actually worked**. If we ever want to resurrect a v1 idea (the local
whisper.cpp + Kokoro voice stack, the gemma3:1b quick-turn routing, the exact
DSP-onset streaming design), the "How It Works (v1)" file is where the design
lives.

## What is NOT archived (and why)
- **App data — `~/piano-coach/data/history/` is LIVE, left in place on purpose.**
  v2 still reads your entire take history for trouble-zones, tempo gates, the
  scheduler, and progress graphs. Moving it would blind the new app to
  everything you've already played. The v2 session **corpus** (`data/corpus/`)
  is new and additive. Nothing in `data/` is "old" — it's shared.
- **The vault ground-truth files** ([[classicalpianodumpknowledge]],
  `(C) Strategy Engine (AI).md`, the `Lessons/` recordings) — all still live
  inputs to v2, unchanged.

## The one-line story of the change
v1 = record → analyze → talk, with two brains that disagreed and a mic-only,
local voice relay. **v2 = one verdict per moment, one deep brain (Claude,
streaming), a cloud realtime speech-to-speech voice you interrupt by talking or
playing, and MIDI-exact input** — every v1 issue in [[v1 issues]] fixed at the
root. Full before/after: [[(C) Coach App — How It Works]] § "What changed from v1".
