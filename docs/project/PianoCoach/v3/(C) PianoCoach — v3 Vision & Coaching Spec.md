---
type: operational
tags: [piano, coach, app, vision, v3, spec]
doc_updated: 2026-07-06
source: Christian's expanded v2 issues + 4 narrated practice recordings
---

# 🔭 PianoCoach v3 — Vision & Coaching Spec

> **What the coach should actually BE** — the target, and the behavior contract
> distilled from Christian's own words (his expanded [[v2 issues]] + ~3 hours of
> narrated practice recordings). The current state + bug list is
> [[(C) PianoCoach — State & Roadmap]]; how today's code works is
> [[(C) Coach App — How It Works]]; the map is [[(C) Coach App]].

## 🧭 Quick nav
- [The one-line reframe](#reframe) · [v2 → v3: the shift](#shift)
- [📜 The coaching contract (your own rules)](#contract) · [🎚️ Rules with numbers](#numbers)
- [🆕 New features you asked for](#new) · [🎙️ The training recordings + validation mandate](#recordings)
- [🗣️ Voice & model direction](#voice) · [🧩 Relationship to Cadencify](#cadencify) · [🧭 What this means for the build](#build)

---

## <a name="reframe"></a>🎯 The one-line reframe

> **The coach's real job is far simpler than v2 assumed: it's a *verbal, interactive,
> lenient rep-tracker that knows exactly what you're playing and where* — and pushes
> repetition. Rhythm, dynamics, and deep diagnosis come later.**

In your words: *"the job as the practice coach is very, very much simpler than you
would think. It's honestly just pushing repetition… this first version should be like
a very efficient rep tracker, but it knows exactly what you're doing and where."*

v2 tried to be a diagnostician. **v3 should be a great practice partner first** —
one that listens, waits, counts reps, talks with you, remembers, and only judges when
it's sure and you want it to.

---

## <a name="shift"></a>🔄 v2 → v3: the shift

| v2 does this | v3 should do this |
|---|---|
| **Dictates** a drill and counts a fixed structure | **Negotiates**: suggests a drill, you can override ("no, I'll do this instead"), it adapts |
| Judges immediately on Listen | **Waits** — confirms where you are + tempo over 2–3 bars before grading anything |
| Calls things wrong eagerly | **Lenient by default**; verifies first; asks "was that right?" instead of asserting |
| Long text reports (chatbot feel) | **Minimal reading**, maximally **verbal**; greets you, talks back and forth |
| Forgets between sessions | **Remembers everything** — a living per-piece coach memory doc; resumes where you left off |
| Diagnoses rhythm/dynamics constantly | **Repetition-first**; treats under-tempo as "notes not secure → slow practice + metronome" |
| Score is a static viewer | **Interactive, annotated score** you can both point at and draw on |
| "It's doing too much" | Does less, better; earns the right to interrupt |

---

## <a name="contract"></a>📜 The coaching contract (your own rules, from the recordings)

These are extracted from your narrated sessions — the `*-log.md` / `*-map.md` files in
`/Users/c3/Desktop/piano narration train samples/`. **This is the real Strategy Engine
v3.** You literally say "that's one of your rules" throughout.

> ✅ **Now encoded in [[(C) Strategy Engine (AI)]] §7 + §8** — the file the app parses
> live. Each rule is tagged ✅ (active now: `core_belief` + routing already reach the
> app — notes-not-secure now prescribes `slow_meta` by default) or 🔜 (needs listener/
> rep-loop code). The Engine is the operational source of truth; this doc is the narrative.

### 🕰️ Wait & patience
- After "start drill," **silence is silence — wait.** Scattered notes = you hunting for the passage — **keep waiting.** Don't grade anything until you're actually into the passage.
- **Confirm you know where the passage is before starting.**

### 🔁 Don't grade the practice process
- **Never grade restarts / loops / aborted attempts** — grade only the *latest completed* pass. Restarts are the method, not errors. Notes after a restart are not "extra notes."
- **Never grade pauses** — page turns (m.523, m.492), note-hunting, thinking, writing measure numbers, a walk to reset.
- **Recognize practice modes even when unannounced**: one-hand practice, a technical jump/flip drilled in isolation, fooling-around on a fragment. Don't grade these as the set measure. If unsure, **ask** ("are you just playing left hand, or fooling around?"); otherwise trust you and let you say when you're done.

### ✋ Verify before judging — leniency first
- **Don't assert a mistake — verify.** If accuracy looks suspiciously low, **ask out loud, briefly**: "I heard a lot of mistakes — am I looking at the wrong measure?" and let you answer yes/no.
- **Only correct what you don't catch yourself.** Otherwise just ask "was that right?" and explain only if you say no.
- **Believe you.** If you say you didn't make a mistake, believe you and re-check its own read.
- **You're the boss of your practice.** Accept overrides it can't see (fingering changes, "I'm doing this instead"), track them, never mark intentional choices wrong.
- **Be lenient, especially where you don't know the music well.**

### 🗣️ Interactive & verbal is THE priority
- **Ask your goal** for the session; it can propose one from last time but must ask; if you have none, insist on one; if you're short on time, propose a *smaller* goal.
- **Talk back and forth.** If it's going to enforce any strict rule, **tell you first.** Point out patterns and likely causes *conversationally*, never as a list-dump.
- **Ask how you felt** after a pass (were you focused?).
- **Say rep counts out loud** ("one more time," "five more times"); accept your pushback and change the plan.

### 🐢 Diagnosis: repetition-first
- **Under-tempo clean playing ≠ solid.** Playing slowly with right notes means you *don't know them yet* — that's why it's slow. → push **slow repetition + metronome** (the #1 go-to).
- **While learning notes, let dynamics/uneven volume slide** unless it's a harmful habit.
- **Identify the TYPE of mistake** (left hand entered early, a hand-flip, a crossover, a jump) — not just "wrong note."
- **Slow + loud** to cement notes before moving on.

### 🎯 Be proactive, not reactive
- Prescribe the drill **early** (e.g. the RH dotted-rhythm) — *before* the passage, not after you've failed it ten times.
- **Anticipatory cue**: if it knows a spot you always miss, remind you **~a measure ahead, very briefly** ("the C-sharp is coming up"). Talking while you play must be brief.
- Tell you to **mark the score** when you keep missing something; offer conversationally ("want to mark that?").

### 🧰 Methods matched to what's hard
- Isolate a **hard jump/leap** and drill it alone · **block the LH** when the notes are one chord (visible in the XML) · go **hands-separate sooner** · isolate a single problem note · **drill transitions** (they're the under-practiced failure points).

### 🖐️ Fingering
- Reason about fingering from the **XML using hand shape + minimal movement / fewest reshifts**; point out fingering facts; **accept your overrides** and track them.

### 📚 Memory & session flow
- **Recall last session, re-solidify at a slower tempo first, tell you where you left off.**
- Notice **zone-out / focus loss** and supply structure; breaks are fine; end with a **retention run**.

### 🚨 Safety
- Catch **pain** ("hand's gonna hurt now") and **fatigue** ("immensely draining") cues → ease off, rest. (Pain rule already in the Engine.)

---

## <a name="numbers"></a>🎚️ The concrete rules with numbers (build these in)

| Rule | The number you stated |
|---|---|
| **Wrong-measure trigger** | Normal accuracy ~**95–100%**. Below ~**80–85%** → ask "am I on the right measure?" A *wildly* low number → re-evaluate position entirely. |
| **Notes-not-secure** | Below ~**80%** accuracy → assume you don't know the notes; push slow reps. |
| **Warm-up before judging** | Listen to at least **2–3 measures** and confirm position/tempo before analysis. |
| **Catastrophic mismatch** | ~36 wrong notes / 20+ measures of terrible accuracy → suspect wrong measure, re-locate. |
| **Rep structure** | When you think you know it but don't → a set count (**5×, 10×**). |
| **Under-tempo = slow practice** | If played tempo is *consistently far under* the piece's full-speed target → prescribe slow-metronome practice, not subdivisions. |

---

## <a name="new"></a>🆕 The new features you asked for

### 1. 🧠 A living per-piece coach-memory document
*"It should create its own MD document, clearly labeled as a coach app document, and update it with only the important context… constantly updated."* It should track, per piece:
- Hard measures / what you struggle with technically
- What you've learned · what still needs work · your goals
- **Where you left off last session** (resume point)

*(Note: v2 already writes `(C) coach-session` notes + practice-log rows, but those are
per-session dumps — this is a single **living, curated** per-piece brain the coach owns
and rewrites. This is Cadencify's "Memory" layer, seeded here.)*

### 2. 🤝 Negotiated drills (not fixed prescriptions)
It **suggests** ("play m.X–Y right hand only, 10× slowly at ♩=60, metronome on"), but
you can **push back** ("no, I'll do this instead, because…") and it accepts and updates
— and you can keep changing it mid-drill. The drill loop must be a *conversation*, not
a locked counter.

### 3. 🎼 Interactive, annotated score (the differentiator → Cadencify's moat)
- When the coach references something ("left hand, m.510"), it **annotates the actual
  sheet music** in the score pane — points at the exact notes.
- **You can draw / whiteboard on the score**: circle a note, confirm "you mean this
  one?", show how one note connects to another, mark that a stretch is hard, write your
  fingering. The voice model has access to the same score you're looking at — the
  annotation layer bridges "what I'm playing / looping / struggling with" to a shared canvas.

### 4. 🎬 Start-and-go, minimal reading
Start lesson → it **greets you, acknowledges what's going on, and just listens.** It
knows silence vs. playing, what you're playing and how, knows to push slow, recognizes
weird practice patterns (fast looping). **You shouldn't have to type anything.** Very
little text to read; very verbal.

### 5. 📉 Reset the progress window to be lenient
You like the Progress tab but the clean-rep gate is far too strict (see the "dormant
scheduler" finding in the Roadmap). Loosen it so progress actually registers.

### 6. 🎨 Full UI overhaul
The UI needs a complete rehaul around the above — **use the installed Claude Code skills
(e.g. `artifact-design`, `dataviz`) for the design work.**

---

## <a name="recordings"></a>🎙️ The training recordings + the validation mandate

**Location:** `/Users/c3/Desktop/piano narration train samples/` (~219 MB, 4 `.m4a`):
`scherzo sesh 1`, `scherzo sesh 2`, `scherzo sesh 3`, `griffes`. Each has a
`*-log.md` (and sesh 1 a `*-map.md`) summarizing what to look for — **but the MDs do
NOT capture what it sounds like.** ~3+ hours total of real, messy practice with Christian
narrating what he's doing and what he wants.

**The mandate (his words, staged as "after you confirm the app works"):**
1. **Listen to every minute** using the same transcription the app uses — hear the
   *notes* — **and** take in the *narration* (what he says he wants + how a real session
   actually flows: pauses, looping, restarts, note-hunting, technique drills).
2. **Pull out every key point** he states — they're the Engine v3 rules (the contract above).
3. **Validate the app against this real audio** — feed these recordings (and the lesson
   recordings) through the pipeline and check the output is *good* = interactive,
   back-and-forth, confirming, verbal, lenient. Test as many minutes as possible.

> ⚠️ This is why v2's "39/39 self-test" was misleading — it ran on *synthetic* audio.
> Real validation = these narrated recordings. Do this before trusting any fix.

---

## <a name="voice"></a>🗣️ Voice & model direction

From your note (*"consider gemini 3.1 flash… whatever is faster"*) and the hard-won
lessons in your **Cadencify prototype** ([[(C) Model Numbers]], Field Report):

- **The 8-second voice delay is not a network/VAD problem — it's `thinking` + a bad
  model choice.** Fix: **`thinkingConfig.thinkingBudget = 0`** + move to the
  **`gemini-3.1-flash-live-preview` half-cascade** (~0.8–1.5 s target). PianoCoach v2
  is on the slower `gemini-2.5…native-audio-preview` — same trap Cadencify already hit.
- **Tradeoff:** 3.1 half-cascade **points *then* talks** (sequential tools); 2.5
  native-audio can point *while* talking but is currently unstable (9 s + `1011`
  crashes). For a coach that *works*, prefer 3.1 for now.
- **Simplify the stack.** You're wary of using Claude **and** Gemini if it adds friction
  ("not loving that it uses claude and gemini if it makes it harder"). Consider whether
  the deep text-brain (Claude) is even needed in a rep-tracker-first v3, or whether one
  fast voice model + templates covers most of it. Fewer moving parts = fewer failure modes.

---

## <a name="cadencify"></a>🧩 Relationship to Cadencify

**PianoCoach / CodaKiller is the *grounding seed* for [[(C) Cadencify Command Center|Cadencify]]** (your general artifact-grounded AI tutor). The v3 asks map almost 1:1 onto Cadencify's 7 layers:

| v3 ask | Cadencify layer |
|---|---|
| Interactive annotated score / whiteboard | **Layer 2 — Shared Canvas (THE MOAT)** |
| Living per-piece coach-memory doc | **Layer 4 — Memory** |
| Verbal, ask-first, negotiated coaching | **Layer 3 + 5 — Tutor Brain + Voice / turn-taking** |
| Repetition-first, lenient, blunt-when-sure | **Layer 6 — the Enforcer (pressure via data, not scorn)** |
| Route cheap vs. hard, stay fast | **Layer 7 — the Conductor** |

Building v3 well = proving the Cadencify architecture on the piano case first. Keep that
in mind: **decisions here should generalize.**

---

## <a name="build"></a>🧭 What this means for the build (staged)

This reorders the [[(C) PianoCoach — State & Roadmap]] backlog around the reframe:

1. **Foundation (still P0):** git is done ✅. Next: reset the range on piece switch.
2. **Make it a trustworthy rep-tracker:** warm-up window, wrong-measure re-locate at
   <80%, don't-grade-restarts/hunting, adaptive silence detection, loosen the `clean` gate.
3. **Make it verbal & interactive:** greet-on-start, ask-the-goal, negotiated drills,
   minimal text, brief anticipatory cues. Switch voice to `gemini-3.1-flash-live` + `thinkingBudget:0`.
4. **Give it memory:** the living per-piece coach-memory doc; resume-point tracking.
5. **Ground it (the moat):** annotated score + draw/whiteboard layer.
6. **Validate for real:** listen to + test against the narration recordings.
7. **Rehaul the UI** (use the design skills).

*Everything above is direction, not code — nothing has been built yet. This doc is the
target to build toward.*
