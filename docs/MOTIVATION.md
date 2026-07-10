# CodaKiller — Motivation (the honest origin story)

> Why this app exists, and why it's built the way it is. This is the "so an outsider
> understands the *why*, not just the *what*" doc. It changes only on a real pivot.
> **Last updated: 2026-07-10.**

## Who it's for

**Christian** — an NEC-prep pianist who practices on a **Steinway & Sons acoustic baby
grand** in his living room, on a **MacBook Air (8 GB M2, macOS 15)**. There is no MIDI and
(barring an optical retrofit) never will be. His teacher's diagnosis: **pulse is his #1
problem.** He practices hard repertoire (e.g. Chopin's Scherzo No. 2) and needs to track
reps, tempos, and hard spots without stopping to fiddle with a screen.

## The predecessor and its fatal flaw

CodaKiller replaces **PianoCoach** (`~/piano-coach`), which went through four major versions
trying to be an AI piano *coach* that **listened to the piano and graded it**. The founding
mistake was hardware-shaped: a Steinway played into a built-in laptop mic transcribes at
**35–52% note accuracy with timing error in whole seconds**. Every judgment the app made ran
off that lossy signal. The consequences were a whole family of bugs, each patched, each
spawning the next:

- Precise note-grading was **unreachable** on his instrument — clean reps read as failures,
  producing "take your time, find the notes" spam and unwinnable drills.
- No headphones are possible on an acoustic, so the coach's own **TTS bled into the room
  mic** (fake onsets, barge-in), and playing during a drill cut the coach off mid-sentence.
- Broken mic grades **poisoned the scheduler** and memory.

By v4 the old app had reframed toward "track, don't grade," but it carried the accumulated
weight of a perception-first architecture built on a false premise (a 2,406-line server
file, a local web server with cache-bust versioning, stale-server deploy traps). The lesson
was paid for in full, four times over.

## The idea CodaKiller is built on

> **The user is the sensor; the app is the memory.**

Stop asking the computer to hear music it demonstrably cannot. Let the human — who already
knows exactly what he played right and wrong — give every verdict by voice, and make the app
brilliant at the things computers *are* good at: **counting reps, keeping precise time,
remembering pieces and hard spots, structuring practice, and knowing pedagogy on demand.**

This one move dissolves the old bug family *by design*:
- The app never needs to hear piano, so it **doesn't listen while it speaks** (a half-duplex
  gate) — no self-bleed, no barge-in chaos.
- Speech that matches no command is **ignored**, not misinterpreted — playing and ambient
  talk can't trigger anything.
- No grading means no false verdicts, no poisoned scheduler, no unwinnable drills.

## Why this stack, why clean-slate

- **Tauri v2 (Rust + WebView), not native SwiftUI:** the Swift toolchain is broken on this
  Mac (no full Xcode). Tauri is publishable, bundles everything (no web-server/deploy traps),
  and puts the real-time metronome in **Rust** — immune to WebView timer throttling.
- **No shared code, no UI inspiration from the old app.** Small testable modules replace the
  god object; an apple-grade design language replaces the old "practice room" UI. The old
  app is inherited as **lessons**, not as a codebase to evolve.
- **Deterministic hot loop.** Rep check-offs and metronome control are instant regex-routed
  offline commands; the LLM is reserved for open questions. The old app put LLM latency in
  the interaction loop and paid for it.

## The bigger picture

CodaKiller is the focused, correct version of the piano-practice tool. The same lessons also
seed **Cadencify** — a generalized real-time, artifact-grounded AI tutor for any subject —
where the old piano coach is explicitly the "grounding seed." CodaKiller and Cadencify are
cousins: CodaKiller goes deep on one user's piano practice; Cadencify generalizes the
grounded-voice-tutor idea. They share lessons, not code.

## What success looks like

Christian opens CodaKiller, says what he's working on, and practices for an hour barely
touching the screen — reps counted, tempos laddered, hard spots remembered, the metronome
following him, a session log written to his vault, and honest answers when he asks how to
attack a passage. The measure of success is simple: **he stops using paper, and he doesn't
fight the tool.** That test hasn't been run yet — see `FLAWS.md` A1.
