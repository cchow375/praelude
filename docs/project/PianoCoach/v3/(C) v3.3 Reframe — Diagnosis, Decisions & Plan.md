---
type: reference
tags: [piano, coach, app, v3.3, reframe, bugs, audit, plan, mic-only]
doc_updated: 2026-07-07
status: DIAGNOSIS COMPLETE + DECISION LOCKED — reframe design being generated (Part 2 appends below)
---

# 🎹 CodaKiller v3.3 — The Reframe: Diagnosis, Decisions & Plan

> **Why this doc exists:** On 2026-07-07 you used v3.2 for real and it spammed
> *"take your time, find the notes"* on a loop and cut itself off while you played.
> You asked for a full-scope audit of what's actually broken (not missing features —
> things it *does wrong*), plus a plan. This is the complete, self-contained record so
> you can close the terminal and pick the whole thing back up here in Obsidian.
>
> Related: [[(C) Coach App]] · [[(C) Coach App — How It Works]] ·
> [[(C) PianoCoach — State & Roadmap]] · [[(C) v3.2 Listening Rebuild Log (2026-07-07)]] ·
> [[(C) PianoCoach — Version History]] · your wishlist [[v3. ideas for next and issues(v4 ideas)]].

---

## 🧭 Quick nav
- [§0 · TL;DR — the one thing to know](#tldr)
- [§1 · The root cause (one conceptual error)](#root)
- [§2 · The bug you reported, decomposed](#reported)
- [§3 · The silent damage (bugs you couldn't see)](#silent)
- [§4 · Things you haven't raised yet](#future)
- [§5 · Checked & cleared (refuted)](#refuted)
- [§6 · 🎯 THE DECISION (v3.3 direction)](#decision)
- [§7 · The reframe design](#design)  *(Part 2 — appended when the design pass returns)*
- [§8 · The phased plan + bug→fix map](#plan)  *(Part 2)*
- [§9 · Open questions](#open)
- [Appendix · All confirmed findings with file:line](#appendix)

---

## <a name="tldr"></a>§0 · TL;DR

- **You play a Steinway acoustic baby grand on a room mic. There is no MIDI, and
  (barring hardware) never will be.** That single fact is the key to everything.
- The app has two brains: a **precise brain** (exact note grading, clean-rep drills)
  that *only works on MIDI*, and a **follow-along brain** for mic. **You can only ever
  reach the follow-along brain** — yet drills run on the precise brain.
- On the mic, a **clean take reads only 35–52% accuracy** with timing error of 1–2
  *seconds*. So the precise brain sees your perfect playing as a 40%-wrong disaster.
- **v3.2 fixed this for lessons but left it live in drills.** Every symptom you hit is
  that one gap. The drill was *mathematically unwinnable* — not malfunctioning, just
  doing exactly what it was built to do, on a signal it should never have trusted.
- **The fix is a reframe, not a patch:** on mic, stop grading notes. Become a **verbal
  practice tracker + organizer** (you talk, it tracks) with lenient follow-along
  listening. Keep the precise brain intact behind a **MIDI toggle** for when you plug
  in an e-piano. Decision locked — see [§6](#decision).

---

## <a name="root"></a>§1 · The root cause — one conceptual error

v3.2 treated **"drill"** as a *trust tier* — its own doc says *"precise judging is
reserved for MIDI (exact) and drills (a window he committed to)."* **That premise is
false. Trust comes from the INPUT (mic vs MIDI), not from your intent.** Committing to
a drill window does nothing about ByteDance's 35–52% mic ceiling.

So the exact behavior that made you furious in v2 wasn't removed in v3.2 — it was
**relocated** out of lessons and into the drill loop. The hole in the fix is precisely
the size of the drill system, and your 19:33 session fell straight through it.

> **The audit:** 8 subsystems read in parallel by independent agents, every finding
> then handed to a fresh agent told to *refute* it. **27 findings → 19 CONFIRMED, 3
> plausible, 5 correctly refuted.** 3 criticals. Full list in the [Appendix](#appendix).

---

## <a name="reported"></a>§2 · The bug you reported, decomposed (✅ all confirmed)

Seven mechanisms stack to produce *"spam + cuts itself off."* Every one traced through
the code and matched against your corpus log (`data/corpus/20260707-1933-75c6.jsonl`).

| # | Mechanism | Where | What it does to you |
|---|-----------|-------|---------------------|
| 1 | Clean mic = 35–52%; the "still searching" gate needs **≥50%** | `reploop.py:101` | Every rep → *"Take your time, find the notes."* **Unwinnable.** |
| 2 | "Clean" requires **zero** missed notes; mic drops ~half | `engine.py:145` | A rep that sneaks past #1 still can't count. Counter stuck at 0. |
| 3 | 12-second graded window < an 8-bar cell (15–24 s) | `stream.py:359` | `matched/expected < 0.5` **by construction** — breaks even a flawless MIDI rep. |
| 4 | **1.5 s of silence = a new "rep"** | `stream.py:344` | Slow, careful practice gets chopped into fragments — punishing the exact thing the drill *told* you to do. |
| 5 | Every fragment speaks — **no throttle, no dedup** | `server.py:1082` | The spam: ~15 identical nags in 3 minutes. |
| 6 | Your **next note interrupts the coach** (barge-in) | `server.py:983` | *"It cuts itself off."* In a drill you're always playing → it never finishes a sentence. |
| 7 | No turn serialization → prescription + verdict **fuse** | `server.py:941` | The run-on "slow metronome work… take your time find the notes." |

Plus two cosmetic ones: the UI renders each line **twice** (`app.js:740`), and
`start_drill` fires **twice** so the prescription is spoken twice (`server.py:716`).

---

## <a name="silent"></a>§3 · The silent damage — bugs you'd *never* catch yourself

These are the ones you asked for: features it *has* that it does **completely wrong**,
quietly corrupting data while you think it's fine.

| ⚠️ Bug | Where | Why it's serious |
|--------|-------|------------------|
| **Scheduler doom-loop** — a 0-clean mic drill demotes that spot's spaced-repetition tier, so the *unplayable* passage self-promotes to **#1 priority every session, forever** | `server.py:1111` | Your Progress tab + tomorrow's plan actively corrupted. Today's poison is already in `schedule.json` (m.691–698, 0/1). |
| **Memory can be silently WIPED** — fixed `.tmp` path + concurrent writes → resume point, hard spots, fingerings, drawn marks erased with **no error** | `memory.py:59` | Drag a "hard" mark while the voice model saves → the "living memory" (the whole v3 point) is **gone**. Real data loss. |
| **Fabricated wrong notes** — invents *"you played A4 instead of G3"* by zipping unrelated pitches | `align.py:336` | States things you never played as fact (would be spoken aloud on MIDI). |
| **False pulse accusation** — mic timing jitter reads as *"you're not counting the rhythm"* | `analyze.py:117` | Gaslights you on your teacher's stated **#1 real problem**. |
| **Metronome click counted as a wrong note** | `app.js:774` | The coach's own click inflates your error count. |
| **A goal with a "pain" word breaks the session** — say *"the run that makes my wrist sore"* → coach refuses to start, tells you to stop, never logs the goal | `server.py:637` | You can't even state what you want to work on. |
| **False "too fast, slow down"** off a phantom 374/548-bpm reading while you play slowly | `methods.py:144` | Contradictory and untrustworthy. |

---

## <a name="future"></a>§4 · Things you haven't raised yet (but will hit)

- **The "feels like a real teacher" layer is dead on mic.** Auto-backup / slow-down /
  escalation (`reploop.py:171`) only runs *after* a rep is graded — which never happens
  on mic. The single most human feature never fires.
- **The strategic mismatch.** The app is built as a **note-checker**. On your Steinway
  via mic it *can't* check notes — and as an NEC-Prep player, **you don't need it to;
  you already know your wrong notes.** What the mic hears well (rhythm/pulse, dynamics,
  phrasing, rough location) is exactly what you actually need. It's optimized for the
  one thing it can't do for you. → this is what the v3.3 reframe fixes.
- **Your wishlist is the right instinct.** Reference recordings, *"here's how a real
  pianist plays this phrase,"* demonstrating musicality — the correct direction for an
  advanced mic-only player (coaches *interpretation* instead of faking note-detection).
  Logged as a next track. [[v3. ideas for next and issues(v4 ideas)]]
- **Mic hardware.** If this is the laptop's built-in mic at 16 kHz, a ~$100 external
  condenser placed well would raise the transcription floor (won't beat the model's
  ceiling, but cleaner in = better everywhere downstream). Cheap experiment worth doing.
- **Two MIDI bugs lie in wait** *if* you ever plug in: a MIDI lesson gives **no verdict
  at all** when you just play (`server.py:1407`), and it localizes to the **wrong recap**
  and records that as green-trust truth (`midi_in.py:315`).

---

## <a name="refuted"></a>§5 · Checked and cleared (honesty)

5 candidate bugs were **refuted** under adversarial verification — e.g. "repetitive
material collapses the tempo estimate and drills the wrong bars" and "the trust chip
contradicts the grading" did **not** hold up when an agent traced the actual code. Not
padding the list.

---

## <a name="decision"></a>§6 · 🎯 THE DECISION — v3.3 direction (locked 2026-07-07)

Your call, in structured form:

**1. Two modes, mic is default, MIDI is a toggle.**
- **🎙️ Mic mode (default):** the app becomes a **verbal practice tracker + organizer**,
  NOT a note-grader. You *tell* it what you're doing ("100 reps of m.492", "metronome
  on", "this spot is hard — note it", "I got the LH jump wrong") and it tracks/organizes
  everything verbally so you never touch paper. It can also **suggest** drills. Real-time
  listening still runs but is **lenient follow-along** — it may guess notes softly but
  **never asserts you were wrong and never blocks progress.** *You own note-correctness;
  the app owns structure.*
- **🎹 MIDI mode (toggle):** plug an e-piano into the computer and the **precise system**
  (exact grading, clean-rep gate, tempo ladder) switches ON. The precise path stays
  fully intact — it's honest *there* because the input is exact.

**2. Because listening is weaker, everything else gets 10× better.** A rich set of
verbal tools, score annotation (the existing draw-back moat), recall of past sessions,
ask-anything Q&A, per-piece practice organization.

**3. The design must make the 19 confirmed bugs structurally impossible** — not just
patch them. (Bug→fix map in [§8](#plan).)

> **Guiding principle:** a great teacher without a MIDI cable *watches, keeps the book,
> runs the metronome, and takes the student's word on the notes.* That's the product.

---

## <a name="design"></a>§7 · The reframe design

> ⏳ **Being generated now** by a parallel design pass (verbal-tool inventory ×2,
> interaction model, lenient-listening reframe, MIDI dual-mode architecture, data model,
> phasing + bug-map, then an adversarial completeness critic). **This section fills in
> automatically when it returns — reload the file.**

---

## <a name="plan"></a>§8 · The phased plan + bug→fix map

> ⏳ **Being generated now** (Part 2). Will include: an emergency "stop the bleeding"
> patch (kills the spam/cutoff, stops the scheduler poison, fixes the memory-wipe),
> then the full reframe in shippable slices, then a table mapping every confirmed bug
> to the slice that resolves it.

---

## <a name="open"></a>§9 · Open questions for you

1. **Mic hardware:** what mic are you actually using — the MacBook's built-in, or
   something external? (Determines whether a cheap mic upgrade is worth it.)
2. **e-piano:** do you actually own/have access to a MIDI e-piano you'd plug in
   sometimes, or is MIDI mode purely "just in case"? (Determines how much to invest in
   the MIDI polish vs. mic-first.)
3. **Musicality track:** fold reference-recording comparison into v3.3, or keep it as
   the next version after the tracker is solid? (Current plan: next track.)

---

## <a name="appendix"></a>Appendix · All confirmed findings (file:line)

> 19 CONFIRMED + 3 PLAUSIBLE. `sev` = severity after verification. Each is a *thing the
> app does wrong*, with the fix direction. This is the working checklist for the build.

### 🔴 Critical
- [ ] **`reploop.py:101`** — Drill partial-gate: clean mic (35–52%) < 0.5 match → every
  rep is "partial: take your time." Drill unwinnable. → *make the searching-gate
  source-aware; on mic don't gate on note-match at all.*
- [ ] **`engine.py:145`** — `is_clean()` needs ZERO missed notes; only σ is relaxed for
  mic, not note count. A clean mic rep can never be "clean." → *mic drills must not gate
  cleanliness on note count (self-report / coverage instead).*
- [ ] **`analyze.py:76`** — `analyze_take` reports 30–55% miss on perfect mic playing and
  feeds it to the zero-miss gate. → *stop asserting missed/wrong on mic; report only
  coverage/pulse/dynamics.*

### 🟠 Major
- [ ] **`stream.py:359`** — 12 s rep-window cap < an 8-bar cell (15–24 s) → `matched/expected
  < 0.5` by construction; breaks even flawless MIDI drills. → *derive the window from the
  silence-bounded span, or scale to range × tempo.*
- [ ] **`stream.py:344`** — 1.5 s silence starts a new "rep," chopping slow deliberate
  practice into fragments. → *don't segment mic drills into graded reps at all; segment
  on self-report / longer boundaries.*
- [ ] **`server.py:1082`** — every segmented rep speaks; no throttle/dedup = the spam. →
  *suppress identical consecutive lines; speak only on state transitions.*
- [ ] **`server.py:983`** — barge-in-by-playing cuts the coach's own drill verdict the
  instant you play the next rep. → *suppress onset barge-in while a drill verdict speaks
  (set `_cue_until`), or disable it when `self.drill` is set.*
- [ ] **`server.py:941`** — `_voice_say` has no turn serialization; prescription + verdict
  fuse into one run-on utterance. → *don't inject a new line until the prior coach turn
  completes (or explicitly replace it).*
- [ ] **`server.py:1111`** — mic drill summaries poison the scheduler (0-clean demotes the
  spot; it self-promotes to #1 forever). → *gate `update_from_drill` on `source()=='midi'`
  or on real/self-reported clean reps; mic → session doc only, never `schedule.json`.*
- [ ] **`memory.py:59`** — fixed `.tmp` path + concurrent writes corrupt the JSON; `load()`
  then silently wipes ALL per-piece memory. → *unique temp name (`tempfile.mkstemp`) +
  per-piece write lock + back up a corrupt file instead of overwriting.*
- [ ] **`align.py:336`** — `classify()` fabricates wrong-note substitutions by zipping
  unrelated pitches in MIDI order. → *only call a substitution when leftover pitches are
  close (few semitones) and same-hand; else separate missed + extra.*
- [ ] **`analyze.py:117`** — mic timing jitter → false "rhythm isn't being counted" and
  false pulse-lost diagnoses. → *suppress `timing_sd`/`rhythm_distortion` diagnoses on
  mic, or widen bands by the measured mic noise floor.*
- [ ] **`methods.py:144`** — phantom mic tempo (374/548 bpm) → false "too fast, slow down"
  manner scold. → *don't run tempo-based manner checks on mic; MIDI only, or bound
  implausible readings.*
- [ ] **`server.py:637`** — a practice goal containing a pain/fatigue word (sore/tired) is
  dropped AND fires a false session-ending safety stop. → *capture the goal even when a
  cue is present; require first-person present-tense pain phrasing before stopping.*
- [ ] **`reploop.py:171`** — the adaptive auto-backup/rung-down/escalation layer is dead
  code on mic (only reachable after a graded miss, which never happens). → *reachable once
  reps are counted differently; or trigger backup on repeated un-gradeable attempts.*
- [ ] **`web/app.js:740`** — every drill rep verdict is rendered twice (drill event +
  voice transcript share one buffer, no separator). → *let only the coach_spoken/coach_done
  stream drive the buffer; drop the drill-event append.*
- [ ] **`server.py:716`** — `start_drill` has no idempotency guard; a re-emitted call speaks
  the prescription twice and orphans the first session. → *debounce / treat a duplicate as
  a no-op or respec.*
- [ ] **`server.py:1407` + `midi_in.py:315`** *(MIDI-only, for when you plug in)* — a MIDI
  lesson gives no verdict when you just play; MIDI localizes to the wrong recap and records
  it as green-truth. → *give MidiTake a trailing-silence auto_stop + re-arm; port the mic
  finalize's candidate-grading/`not_found` logic to MIDI.*

### 🟡 Plausible (worth confirming during the build)
- [ ] **`web/app.js:774`** — metronome click timestamps are on a lesson-cumulative clock but
  the take resets per phrase → clicks never filtered during drills → each click transcribes
  as a wrong note. → *send click times relative to the take's sample origin.*
- [ ] **`midi_in.py:315`** — MIDI lesson localizes to the wrong occurrence in repetitive
  material (Scherzo recap). → *port mic finalize's grade-every-candidate + earliest pick.*

---

> *Part 2 (design + plan) appends below when the design pass returns. Diagnosis by an
> 8-subsystem adversarial audit + independent code-trace verification, 2026-07-07.*

**agents were completely cut off, none of the design and plan things were return. the above is all the ifnormation given, so when picked back up, it needs to restart that and begin to redesign and rethink because session got cut off.** This next version should be v4

> ✅ **DONE (2026-07-08): the design + plan were regenerated from scratch as v4 and
> approved.** §7/§8 above stay empty on purpose — the complete, approved replacement is
> **[[(C) v4 — Design, Plan & Build Prompt]]** (design, phases, all-21-bug checklist,
> and the master build prompt).