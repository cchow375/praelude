---
type: reference
tags: [piano, coach, app, buildlog, v3.2, listening, changelog]
doc_updated: 2026-07-07
---

# 🎧 PianoCoach v3.2 — The Listening Rebuild (2026-07-07)

> The record of the session that fixed the thing that made you furious: the app
> judging you wrong and cutting you off while you played. High-level story:
> [[(C) PianoCoach — Version History#🎧 v3.2 — the listening rebuild (2026-07-07)|Version History §v3.2]].
> Current state: [[(C) PianoCoach — State & Roadmap]]. How it works now:
> [[(C) Coach App — How It Works]]. Prior pass: [[(C) v3.1 Build Log (2026-07-07)]].

**One line:** you played the opening on the mic; the app — locked to a stale
navigation range (m.469–505) — said *"16%, wrong measure?"* and cut you off. The
root cause turned out to be deeper than a bug: **on the mic, a clean take reads
35–52% accuracy with timing error of one-to-two full seconds**, so *any* precise
judgment off the mic is noise. This rebuild makes the app **listen → find → and
only then, gently, speak** — and never grade you on numbers it can't stand behind.

---

## 🧭 Quick nav
- [§1 · What you reported](#reported) · [§2 · What I found (the evidence)](#found)
- [§3 · The four fixes](#fixes) · [§4 · Files changed](#files)
- [§5 · Bugs hit (incl. the hang)](#bugs) · [§6 · The adversarial review](#adversarial)
- [§7 · Validation](#validation) · [§8 · Honest caveats & what's next](#caveats)

---

## <a name="reported"></a>§1 · 🗣️ What you reported
- *"remove this listen button and just have it listen all the time"* — you played a whole run and nothing happened because you hadn't clicked Listen.
- *"it immediately… here's five notes… tracked it completely wrong… thought I was playing way faster… cut me off and said it was wrong."*
- *"it cuts itself off because it's taking so long to process… these two models are processing at a different time."*
- *"there's no way it should think I'm playing at 16%… assume I'm not going to play at 50% accuracy and just listen through."*
- *"there shouldn't be these loop and clear buttons… that shows it's just some computer program tracking it."*
- *"a real teacher doesn't set a metronome or counter… and judge anything different as wrong."*

## <a name="found"></a>§2 · 🔬 What I found (from your session log + the code)
1. **The set range was a locked judging window.** An earlier navigation set the range to **m.469–505**. You said "just play, find me" — but finalize graded you against 469–505 → **16%** + *"wrong measure?"* (`data/corpus/20260707-1808-fe79.jsonl`).
2. **The live tracker judged + interrupted mid-phrase.** `stream.py`/`midi_in.py` matched each note against the locked window; a low match rate fired a live `position_doubt` → the coach spoke *"I heard a lot of mistakes — am I looking at the wrong measure?"* **while you were still playing.** The real re-locate was deliberately disabled, so it never actually found you.
3. **The mic itself is the deep problem.** I replayed your real recordings at the *correct* bars:

   | Recording | Correct-spot accuracy | Timing σ |
   |---|---|---|
   | Scherzo opening | **51.9%** | 1396 ms |
   | Griffes sight-read | **34.5%** | 1292 ms |

   A σ of one-to-two **seconds** is broken; ByteDance transcription on 16 kHz mic audio is lossy. The app took those numbers and confidently said *"rough — rhythm's wrong, 12 dropped notes"* — marked trust **green**. That is the "ridiculously stupid" behavior: unwarranted confidence on an unreliable signal.

## <a name="fixes"></a>§3 · 🛠️ The four fixes

### 1 · Never cut you off mid-phrase
The live `position_doubt` push is removed on **both** paths (`stream.py` `_track_position`, `midi_in.py` `_track`); `_try_relocate` is a no-op on both. The live cursor still glides as a visual, but the coach never speaks a verdict or a "wrong measure?" while you play. All localization is deferred to finalize.

### 2 · Localize, don't lock
A range you set is now only where you were **looking** — a hint, never a judging window. On finalize a lesson take runs `align.locate` over the whole piece, **grades each candidate region (+ your set range) by full alignment**, and keeps the best-covering / earliest spot (`stream.py._finalize`). The 16%-at-the-wrong-bars is structurally impossible now.

### 3 · The mic follows along; it doesn't grade you
Because a clean mic take reads 35–52%, a mic **lesson** take now:
- **acknowledges + invites** — *"Okay, I followed you through around measures 1 to 16. Want me to zoom in on a spot, or keep going?"* — never a fault verdict;
- is flagged **trust yellow** ("mic is approximate — drill a spot or plug in MIDI for exact notes");
- is **not recorded** to history / scheduler / memory (an unreliable grade never poisons progress);
- if even the best placement grades under **25%** (`FOUND_ACC_FLOOR`), it says *"I lost the thread — what measure were you on?"* **once**, calmly.

Precise, note-by-note judging is reserved for where it's actually trustworthy: **MIDI (exact)** and **drills** (a window you committed to). *(`server.py._final_verdict`.)*

### 4 · Continuous listening — no button
The **Listen button** and the **loop/clear** header controls are gone. Start lesson auto-arms a free take (`server.py` hello → `start_take`); each phrase ends on a real 2.2 s trailing silence (`stream.py._maybe_auto_stop`) and the server re-arms (`CoachSession.continuous` + `_rearm`). Audio already streams the whole lesson, so you just play.

## <a name="files"></a>§4 · 📁 Files changed (257 insertions)

| File | Δ | What |
|---|---|---|
| `coach/stream.py` | **+144** | No live doubt; grade-based localize-first `_finalize`; `FOUND_ACC_FLOOR`/`not_found`; `_maybe_auto_stop` (continuous). |
| `server.py` | **+88** | Mic-leniency + `record` gating + `not_found` in `_final_verdict`; `continuous`/`_rearm`/`_finish_phrase`; auto-arm on lesson start; robust `_drain`. |
| `web/app.js` | **~52** | Removed Listen/loop/clear wiring + the listen/drill functions; continuous listening; server owns phrase boundaries. |
| `coach/midi_in.py` | **~22** | Same no-mid-phrase-cutoff fix on the MIDI path. |
| `test_assets/selftest.py` | **+33** | Pinned the wrong-clef cycle to isolate detection; **new cycle 10b** asserts a mic take is lenient. |
| `web/index.html` | **~9** | Removed the Listen button + loop/clear controls; cache-bust → **v=12**. |

## <a name="bugs"></a>§5 · 🐛 Bugs hit this session
- **The self-cancellation hang (cost a test timeout).** `auto_stop → stop_take()` cancels `self._drain_task` — but it was being awaited **inside** `_drain`, so the task cancelled itself mid-await and the finalize never sent its verdict (harness `TimeoutError`; would hang the real app too). Fix: `_take_event` schedules `_finish_phrase()` via `asyncio.create_task` so the finalize runs in a **separate** task; `_drain` snapshots `self.take` each loop.
- **Too-narrow localization.** Grade-based selection first favored a 2-bar sliver that graded high but ignored most of the take. Fixed with a coverage-aware key `(round(acc/8), span, -earliest)`.
- **A test with a substring bug.** My own leniency check flagged "th**rough**" as the harsh word "rough" → switched to whole-word matching.

## <a name="adversarial"></a>§6 · 🧪 The adversarial review
A fresh-context agent was told to **refute** each claim of the fix. It confirmed the mic path holds (no harsh verdict, no locked window, no recording of bad grades) — and **caught a real miss**: the first pass fixed only the mic live-doubt, leaving the **MIDI** path still able to speak *"wrong measure?"* mid-phrase (`midi_in.py`). That's now fixed too. It also flagged the (now-dead) `relocated` server branch.

## <a name="validation"></a>§7 · ✅ Validation
- Replayed your real recordings against a **deliberately wrong** locked range: it no longer grades there, no longer reports 16%, and responds leniently.
- **`selftest.py` 43/43** — including new **cycle 10b** ("a mic take is a follow-along, never asserts he's wrong") and the wrong-clef detection re-pinned to isolate the logic.
- **`validate_v3.py` 48/48** (unchanged — the MIDI/drill judging is untouched).
- UI smoke: Listen/loop/clear gone, only **Start lesson**, **0 console errors**, serving **v=12**. Native `PianoCoach.app` relaunched.

## <a name="caveats"></a>§8 · ⚖️ Honest caveats & what's next
- **Repetitive material.** On the Scherzo the opening theme recurs, so the localizer can land on a *recap* (e.g. "m.575" for the opening). Because it's now lenient, that's harmless — it says *"followed you through 575, want to zoom in?"* and you correct it in a word. Improving this needs context bias (resume point / where you were working) — a follow-up.
- **The mic ceiling is real.** The follow-along model is the honest ceiling for mic input. **If you play through a MIDI keyboard, exact feedback is available** — that path is untouched and precise. Open question logged for you: mic-only, or is MIDI in play? If MIDI, it should be the default.
- **MIDI localize-first** (placing a MIDI take by grading, like the mic path) is not done yet — MIDI still grades against its window, but MIDI grading is *accurate*, so it's correct-or-asks, and the mid-phrase cutoff is already gone. Follow-up.
