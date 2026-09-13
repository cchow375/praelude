---
type: reference
tags: [piano, coach, app, history, archive]
doc_updated: 2026-07-09
---

# 🕰️ PianoCoach — Version History & What Went Wrong

> The timeline of the coach app, so you (or any AI) can see **where it's been,
> what broke, and why each rebuild happened**. The one-page map is
> [[(C) Coach App]]; how it works now is [[(C) Coach App — How It Works]]; the
> honest current state is [[(C) PianoCoach — State & Roadmap]].

## 🧭 Quick nav
- [The name](#name) · [Timeline at a glance](#timeline)
- [v1 — the local everything build](#v1) · [Why v1 was scrapped](#v1-fail)
- [v2 — the cloud-voice rebuild](#v2) · [What v2 fixed](#v2-fixed) · [What v2 quietly did NOT fix](#v2-gap)
- [The claim-vs-reality gap](#gap) · [Lessons carried forward](#lessons)

---

## <a name="name"></a>🏷️ The name
**"CodaKiller"** is the personal codename; **"PianoCoach"** is the shipped app
(`com.christian.pianocoach`). The name comes from the original goal: kill the
hardest passages — the *codas* (the Scherzo coda was the first boss). The two
names are used interchangeably across the docs and code.

---

## <a name="timeline"></a>📅 Timeline at a glance

| Date | Version | One-line story |
|---|---|---|
| **2026-07-02** | **v1** | Built. Everything local: two LLM brains, local voice relay, mic-only. "Genuinely unusable." |
| **2026-07-03** | v1 → spec | v1 docs frozen into `Archive v1/`; the [[(C) Fable 5 Rebuild Prompt]] written. |
| **2026-07-04** | **v2** | Rebuilt in place by "Fable 5" (agentic coder). Cloud voice, one brain, MIDI, rep loop. Self-test 39/39. |
| **2026-07-05** | v2 issues | First real-use session → [[v2 issues]]: silence recognition, wrong-measure glitches, too rigid. |
| **2026-07-06** | v2 (docs) | This documentation pass — code fully re-analyzed; docs corrected to match reality. |
| **2026-07-07** | **v3** | Rebuilt around the **reframe** (verbal, interactive, lenient rep-tracker + interactive annotated score). Every v2 issue fixed at the root; validated against the real narrated recordings. |
| **2026-07-07** | **v3.1** | First-real-use feedback pass: **whole score scrolls freely** (no more chunk-lock), **real PDF toggle**, connect + fingering annotation tools, roomier palette, **Today's Session + History as live editable vault docs**, the coach **knows the whole screen**, and the "AI font" killed. |
| **2026-07-07** | **v3.2** | The listening rebuild. Real-use blew up (locked to a stale range, judged him at 16%, cut him off mid-phrase). Now: **never interrupt mid-phrase**, **localize don't lock**, **mic follows along instead of grading** (a clean mic take reads 35–52% — the mic can't judge), and **continuous listening, no Listen/loop/clear buttons**. |

---

## <a name="v1"></a>🔴 v1 — "the local everything" build (2026-07-02)

The first attempt. Everything ran on-device to avoid cloud cost:

- **Two brains:** a local `gemma3:1b` / `llama3.2:1b` (Ollama) for quick turns **and** Claude for depth.
- **Voice = a local relay:** whisper.cpp (STT) → LLM → **Kokoro-82M** (TTS). No cloud audio.
- **Brain call was blocking:** a one-shot `claude -p` subprocess → **~10-second delay** per answer.
- **Input:** microphone only.
- **Flow:** record → analyze → talk (a wall of text, read aloud verbatim).

### <a name="v1-fail"></a>💥 Why v1 was scrapped
Christian described it as *"genuinely unusable."* The specific failures (all in [[v1 issues|v1 issues]]):

1. **Two brains disagreed** — the engine said X, Claude said Y. The #1 fragmentation bug.
2. **It felt like a chatbot you play *at* and wait on** — the 10-second blocking delay killed the "lesson" feeling.
3. **The 0/36 pause disaster** — stopping to find notes was graded as 36 wrong notes.
4. **Hands-separate reps marked wrong** — told to play LH alone, the missing RH counted as errors.
5. **Wall of text, read aloud** — the voice recited the whole essay, robotically.
6. **Prescribed things it couldn't hear** — "say the subdivision out loud" (unverifiable).

> ⚠️ **v1's source code is gone.** `~/piano-coach/` was **not** under version
> control, so the v2 rebuild **overwrote** `server.py`, `llm.py`, `reploop.py`,
> the web UI, etc. **in place.** The only surviving record of v1 is the frozen
> docs in `Archive v1 (2026-07-03)/`. **This is why "put the repo under git" is
> the #1 item on the roadmap — the exact same thing can happen to v2.**

---

## <a name="v2"></a>🟢 v2 — the cloud-voice rebuild (2026-07-04)

Rebuilt by pasting the [[(C) Fable 5 Rebuild Prompt]] into an agentic coder
("Fable 5") working inside `~/piano-coach/`. Three architecture decisions were
locked up front and are still the shape of the app:

1. **Voice = cloud realtime speech-to-speech**, provider-swappable (OpenAI Realtime *or* Gemini Live).
2. **Brain = one coach**, cloud now but architected to go local later; every session logged to a training corpus.
3. **Input = MIDI when connected (exact), mic fallback (honest-but-approximate).**

### <a name="v2-fixed"></a>✅ What v2 genuinely fixed
| v1 problem | v2 fix (and it really works) |
|---|---|
| Two brains disagreeing | **One `Verdict` object** per moment; voice + text only *render* it (`coach/verdict.py`). |
| 10-second blocking delay | Verdicts are **instant templates** (~0.05s); the deep brain **streams** into the text pane. |
| Local robotic voice relay | **Cloud realtime voice** you interrupt by talking or playing. |
| Mic only | **MIDI-exact** when a keyboard is plugged in; mic labeled approximate. |
| 0/36 pause bug | Pauses are **never graded** — enforced in 4 places in the code. |
| Hands-separate marked wrong | Reduced drills graded against the **reduced task**. |
| Unhearable drills | `NON_AUDIBLE` filter blocks "clap/ghost/say-it" from being prescribed as drills. |

Plus new systems: a rep-loop drill state machine, spaced-repetition scheduler,
"errors you didn't hear," anticipatory cues, mental-practice + Sherlock modes,
and a session training corpus. Self-test reported **39/39** (`test_assets/CYCLE_LOG.md`).

### <a name="v2-gap"></a>⚠️ What v2 quietly did NOT fix (the honest part)
The self-test passed on **synthetic takes and 4 lesson recordings** — not on a
live practice session. When Christian actually used it (2026-07-05, [[v2 issues]]),
the real problems surfaced, and they're **still open**:

- **Silence/noise recognition is bad** — "any perceived sound is terrible." (Root cause: absolute gain-dependent audio thresholds.)
- **It locks onto the wrong measure** — famously showed *measure 500* while he played a different piece. (Root cause: forward-only position tracking, no re-locate fallback, range not reset on piece switch.)
- **It's too rigid** — assumes you start at the exact tempo/beat, calls things wrong too fast, "it's doing too much."
- **It doesn't prescribe the obvious** — consistently-slow playing should trigger slow-metronome practice, not subdivisions.

And a layer of features that are **coded but dormant** in real data (clean-rep
gate so strict almost nothing counts as clean → spaced-repetition never advances,
sleep-anchoring never triggers). Full breakdown + root causes:
[[(C) PianoCoach — State & Roadmap]].

---

## <a name="gap"></a>🔍 The claim-vs-reality gap (the reason for this doc pass)
The previous docs were written **at build time** from the spec, so they describe
the app as *designed*, not as it *behaves*:

| The old docs claimed | What the code/data actually shows |
|---|---|
| "Deep brain: Claude Sonnet 5" | Live setting is **`claude-sonnet-4-6`**; `config.py` says `claude-opus-4-8`; three files disagree. |
| "Spaced repetition 24/48/72/120/168h advancing" | Every spot is stuck at the 24h tier — **nothing scores clean**, so intervals never advance. |
| "Sleep-anchored: hardest retested first tomorrow" | `retest_first` is **always null** — the code that sets it is never called. |
| "Decay radar" | It's a flat **3-day** staleness cutoff, not a forgetting curve. |
| "Fully local voice (Silero + whisper + Kokoro)" (v1 text still in README) | v2 voice is **cloud**; that local stack (`coach/voice.py`) is **orphaned code**. |
| "Never grades a pause / wrong-measure handled" | True in the aligner, but **live silence + wrong-measure lock-on still break** (see v2 issues). |

---

## <a name="lessons"></a>🎓 Lessons carried forward
1. **Put it under version control.** Losing v1's source was avoidable. ✅ Done — repo on `main`, checkpoint commits per slice.
2. **Self-tests on synthetic audio ≠ real-use validation.** The 39/39 didn't catch the live-mic silence/wrong-measure failures. Test against *live* playing. ✅ v3 validates on the real narrated recordings + lesson audio.
3. **Docs written from a spec drift immediately.** Document what the code *does*, re-check against real `data/`.
4. **"Coded" isn't "working."** Several v2 features exist but never fire; a feature isn't done until real data shows it firing.

---

## <a name="v3"></a>🎼 v3 — the reframe rebuild (2026-07-07)

Rebuilt by pasting the [[(C) Fable 5 Rebuild Prompt v3]] into the agentic coder.
The reframe: v2 tried to be a **diagnostician** and failed by being rigid and
over-eager. v3's real job is *"a **verbal, interactive, lenient rep-tracker** that
knows exactly what I'm playing and where — with an **interactive annotated score**
we can both point at and draw on."* Built in 5 slices, each verified before the next.

### ✅ Every v2 issue, fixed at the root
| v2 issue | v3 root-cause fix (file) |
|---|---|
| Silence recognition "terrible" | **Adaptive noise floor** — rolling 20th-percentile RMS = the room; onset + quiet tests are RELATIVE to it, gain-normalized; metronome-click frames excluded (`stream.py`). |
| Locks onto the wrong measure ("measure 500") | **Piece-switch resets the range** (`server.set_piece`); **re-locate on catastrophic mismatch** — a rolling match rate asks "am I on the right measure?" and re-runs `align.locate` (`tracker.py` + `analyze.position_check`), mic AND MIDI. |
| Too rigid at the start | **Warm-up window** — tracks 2 bars, confirms position + tempo ("found you at m.X, ♩≈Y") before judging (`tracker.PositionGuard`). |
| Calls things wrong too fast | **Clusters not singletons** on mic — a lone flagged note becomes "uncertain" and the coach ASKS "was that right?" (`analyze._demote_singleton_wrongs`). |
| Doesn't prescribe the obvious slow practice | **Under-tempo rule** — far under the piece's target + weak notes → `slow_meta`, never subdivisions (`engine.diagnose`). |
| "It's doing too much" | **"Just play" quiet mode**; the deep brain is on-demand by default. |
| Progress window too strict (dormant scheduler) | **Loosened the `clean` gate** (σ<45 MIDI / <60 mic; σ=None+no-errors = clean) — the one over-strict boolean that froze the whole progress layer; non-clean now steps down a tier instead of resetting to 0. |

### 🆕 What v3 added
- **The moat: an interactive annotated score.** The coach points at the EXACT rendered notes it references (via OSMD's GraphicSheet — structured, not pixel-guessed) and Christian draws on the same score — circle a note (the coach confirms), mark a stretch hard, draw alignment lines for a polyrhythm. His marks are DATA, saved to the living memory (`web/annotate.js`, `coach/memory.py`).
- **Living per-piece coach-memory** (`(C) coach-memory {piece}.md`) — resume point, goals, hard spots, fingerings, drawn marks; recalled in the greeting.
- **One fast voice.** `gemini-3.1-flash-live-preview` + `thinkingConfig.thinkingBudget=0` — the v2 ~8-second delay was a hidden thinking pass, not the network. **Live-measured: the coach speaks first in ~2.3s including the full handshake** (vs 8s). Session resumption + context compression so a long lesson doesn't die; barge-in by talking OR playing.
- **Deterministic interaction floor** — greet + recall + ask-the-goal, pain/fatigue safety, and rep-count callouts all work even with voice off (they don't depend on the LLM).
- **Identify the mistake TYPE** — a hand entering early is diagnosed as a *sync* fault ("your left hand is coming in early"), not "wrong notes" (`analyze._hand_sync`).
- **One rules source** — the coaching numbers (accuracy ladder, clean gates, rep gate) live in a machine-readable `contract:` block in the Strategy Engine §8, parsed live; every judging module reads it, so `engine.diagnose` and `coachtalk` can't drift.

### 🔬 How v3 was validated (the honest bar this time)
- All 4 narrated practice recordings (~3.4 hrs) transcribed through the app's OWN ears (ByteDance notes + whisper narration) and mined for every stated rule; reconciled against the code.
- **`test_assets/validate_v3.py`: 17 cycles / 46 checks, all green** — pause-never-graded, warm-up, re-locate, leniency, don't-grade-restarts, under-tempo→slow, negotiated drills, hands-separate-reduced, pain+fatigue, one-verdict, musician-speech, a real 217-note recording segment, sync detection, believe-me-undoes-damage.
- **`test_assets/selftest.py`: 41/41** incl. live-server cycles reaching the real teachers' diagnoses (Yukiko "the pulse isn't counted", Jeanie wrong-clef LH).
- Two fresh-context adversarial reviews (code-correctness + a jaded-NEC-teacher UX pass); every real finding fixed (wrong-take-on-replay, a relocate race, rep-audio-offset, plus the "sounds like a counter" phrasing).
- Native `PianoCoach.app` rebuilt, launched, server up, 5 pieces, voice ready; UI 0 console errors in a real browser.

**Not done by design (the reframe defers it):** deep diagnosis — a fingering-suggestion engine, a musical-pattern detector, section-type classification, root-cause hypotheses. The spec is explicit: *"Rhythm, dynamics, and deep diagnosis come LATER."* v3 is the rep-tracker first.

---

## <a name="v31"></a>🎚️ v3.1 — the first-real-use pass (2026-07-07)

v3 shipped and Christian used it. His feedback wasn't about the coaching — that
landed — it was about **the interface getting in the way of playing**. The
meta-principle he stated: *"less time interacting with the interface, more time
playing, but when I do interact, make it highly easy."* Built in 6 slices, each
verified live before the next. Spec: [[2026-07-07-v3.1-interactive-score-and-live-docs-design]].
**Full blow-by-blow (every file, bug, and check): [[(C) v3.1 Build Log (2026-07-07)]].**

### 🎯 What he asked for → what changed
| His words | The fix (files) |
|---|---|
| *"it shouldn't lock me to the specific chunk… load the entire score so I can actually go where it's saying"* | The **whole piece renders once and scrolls freely.** Killed the bars-input box entirely. Click a bar to jump, drag to select a range, and the coach can navigate anywhere ("go to m.53"). No re-render on selection (`renderScore`, `bindScoreSelect`, `web/app.js`). |
| *"have it actually show the real score, not the XML you made… toggleable so I can reference both side by side… the model should read the PDF on demand"* | A **score ⇄ PDF toggle** with an edition picker; the PDF is a scrollable stack of page images (poppler-rendered, so it shows in the WKWebView where the plugin-based viewer is blank). The coach reads the SAME pages on demand via `show_pdf` → image to the model (`server.py` pdf endpoints, `gemini_live.send_image`). Full note-level pixel mapping deferred by his call ("not needed for now"). |
| *"individually link every note… and I can type my fingerings very easily or tell the model and it writes them on the XML and saves them"* | Two new one-gesture annotation tools: **link** (tap note A, tap note B → arrow + the coach acknowledges the connection) and **finger** (tap a note, press 1–5 → the number is written on the staff AND saved to the piece's coach-memory as his fingering). Saying it out loud still works. (`web/annotate.js`, `server.py` mark handler.) |
| *"the annotation UI is crammed"* | The cramped emoji strip became a **clean, labeled, floating palette** pinned to the score's top-right (draw · circle · link · finger · hard · align · erase · clear all). |
| *"the 'session' should be a history thing… 'today' should be 'today's session', more volatile, a document I can just fix and type… the model talks to me, asks my reflections, writes it up, and I can edit it… it should keep all the history"* | **Today's Session** is now ONE live, user-editable markdown doc per piece — the concise plan + goal seeded daily from yesterday's resume point, a Log the coach fills in real-time (opening-reflection goal, every take, drill, and mark). Edits save on blur. When the day turns over it rolls into **History**, the newest-first rolling archive. Both are real `(C)`-prefixed vault files (`coach/session.py`, `/api/session/*`). |
| *"the model should have full understanding of the whole interface and know exactly what I'm looking at"* | The client streams a **[SCREEN NOW]** note whenever what he sees changes — visible measures, score-vs-PDF, open panel, tool in hand, selection — handed silently to the live voice. *"What am I looking at?"* now answers with the exact visible measures. (`server.on_viewport`, `gemini_live.send_context`, persona rule.) |
| *"the 'press start lesson' font is an AI signature font I do not like"* | Status text switched from monospace to the normal sans face. |

### 🔬 How v3.1 was validated
- **`validate_v3.py` 48/48** and **`selftest.py` 41/41** stay green (no coaching regressions).
- Every slice verified live in a real browser (headless Chromium via `/browse`): full-score scroll (14k-px canvas, jump near + far), PDF toggle (page images render), the floating palette, the fingering mark round-trip (*"finger four on that E five in measure thirty-two"* + persisted to memory), Today's Session edit→save→persist + day-roll-to-History, and the screen-awareness loop end-to-end (*"You're looking at measures thirty-three to forty-one right now."*).
- Native `PianoCoach.app` rebuilt-in-place, launched, its own server up on :8765 serving the v3.1 interface (v=11, renamed tabs, no bars box), 0 console errors.

**Still open (needs Christian):** an **off-disk git remote** for backup — blocked on `gh` not being installed + his GitHub auth (`brew install gh && gh auth login`, then `gh repo create piano-coach --private --source=. --push`). The repo is safe on local `main` with a commit per slice until then.

---

## <a name="v32"></a>🎧 v3.2 — the listening rebuild (2026-07-07)

v3.1 shipped and he used it live — and it **blew up on the one thing that
matters**: the listening loop judged him wrong and cut him off. From his 18:08
session log: he played the opening on the mic; the app, still **locked to a stale
navigation range (m.469–505)**, graded him there → **16%** → *"I heard a lot of
mistakes — am I looking at the wrong measure?"* — spoken **mid-phrase**. It never
looked for him. Full write-up: [[(C) v3.2 Listening Rebuild Log (2026-07-07)]].

### 🔬 The root cause was deeper than a bug
Replaying his real recordings at the *correct* bars: a **clean** Scherzo take reads
**51.9%** accuracy, a Griffes sight-read **34.5%**, both with timing σ of **one to
two full seconds**. ByteDance transcription on 16 kHz mic audio is lossy — so the
app was delivering confident fault-verdicts (*"rough, rhythm's wrong, 12 dropped
notes"*, trust **green**) off numbers it had no business trusting. **The mic
genuinely cannot grade him**; the app pretended it could. That is the "ridiculously
stupid" feeling, explained.

### 🛠️ The four fixes
| His words | The fix |
|---|---|
| *"cut me off and said I was wrong"* | **Never interrupt mid-phrase.** The live `position_doubt` push is gone on BOTH the mic (`stream.py`) and MIDI (`midi_in.py`) paths; `_try_relocate` is a no-op. It listens, and only speaks after he stops. |
| *"it shouldn't lock me… find them"* | **Localize, don't lock.** A range he set is only where he's *looking* — a hint. On finalize a lesson take is placed by grading each `align.locate` candidate (+ the hint) by full alignment and keeping the best-covering spot. The 16%-at-wrong-bars is structurally gone. |
| *"assume I'm not playing at 50%… don't judge"* | **The mic follows along; it doesn't grade.** A mic lesson take now acknowledges + invites (*"I followed you through around m.X — want to zoom in, or keep going?"*), is trust **yellow**, and is **not recorded** to history/scheduler/memory. Below 25% even at the best spot → *"I lost the thread — what measure?"* once. Precise judging is MIDI-exact + drills only. |
| *"shouldn't have to click listen… no loop/clear buttons"* | **Continuous listening, no button.** Killed the Listen button + the loop/clear header controls. Start lesson auto-arms; each phrase ends on a real 2.2 s trailing silence (`_maybe_auto_stop`) and the server re-arms (`continuous` + `_rearm`). |

### 🧪 Validated (the honest bar)
- Replayed his real recordings against a deliberately-wrong locked range — no more 16%, no more cutoff, lenient response.
- **A fresh-context adversarial agent** was told to refute every claim; it confirmed the mic path holds AND **caught that the first pass missed the MIDI cut-off** (now fixed).
- **`selftest.py` 43/43** (new cycle 10b: a mic take must be a follow-along, never a fault-verdict) + **`validate_v3.py` 48/48** (MIDI/drill judging untouched).
- Fixed a self-cancellation hang: `auto_stop → stop_take()` cancelled the drain task from inside itself, aborting the finalize → now `_finish_phrase()` runs via `create_task`.

### ⚖️ Honest ceiling
The follow-along model **is** the honest ceiling for mic input — the mic can't support note-level judgment. **MIDI is exact and untouched**; if he plays through a keyboard, precise feedback is available and should be the default. Open question logged for him: mic-only, or MIDI in play? On the repetitive Scherzo the localizer can still land on a *recap* of the opening theme — harmless now (it's lenient and he corrects it in a word), improvable later with context bias.

---

## <a name="v4"></a>🎛️ v4 — the two-mode reframe (2026-07-08, in progress)

**Why:** 2026-07-07 real use proved the root truth — he plays a Steinway ACOUSTIC
through a mic (no MIDI, none coming), a clean mic take transcribes at 35–52%, and the
drill loop still graded him on it: *"take your time, find the notes"* on loop, cut off
mid-sentence, an unwinnable drill that poisoned the scheduler. Full diagnosis (19
confirmed bugs + 2 plausible, adversarially verified): [[(C) v3.3 Reframe — Diagnosis,
Decisions & Plan]]. The approved design + plan + build prompt: **[[(C) v4 — Design,
Plan & Build Prompt]]**. v4 = **mic mode (default) = verbal practice tracker +
organizer that NEVER grades notes; MIDI mode = the intact precise brain behind a toggle.**

### 🩹 Phase 0 — stop the bleeding (SHIPPED 2026-07-08)
Eight fixes + a detox, each TDD'd and committed separately (`v4 p0.1`–`p0.8`):
- **SpeechGovernor** (`coach/speechgov.py`) — every template line passes one gate:
  identical lines within 10 s are dropped (the ~15× nag spam), a new turn *waits* for
  the in-flight one (no more prescription+verdict run-ons), and the coach's own
  speech-window holds the play-barge-in guard (its TTS is in the room mic — no
  headphones on an acoustic). Onset barge-in is disabled entirely during drills;
  barge-in by *talking* stays.
- **Drill completion can't cancel itself** — the 'done' path scheduled via
  `_finish_phrase()` (same class as the v3.2 auto_stop hang; a completed drill used to
  silently lose its summary + scheduler write + spoken wrap-up). *Found during v4
  recon, beyond the audit's 21.*
- **Duplicate `start_drill` is a no-op** (model echo / UI button double-fire), and a
  *replaced* live drill lands its summary instead of vanishing.
- **Mic can no longer poison the scheduler** — `update_from_drill` and the believe-him
  rewrite are MIDI-gated.
- **Memory can no longer be silently wiped** — per-piece locks, `mkstemp` temp files,
  corrupt files backed up (never blanked over); hard-kind marks now land in `marks[]`
  too (v3 dropped them). *Also beyond the audit.*
- **A goal that mentions pain is a goal** — capture no longer vetoed; the pain stop
  needs a first-person present-tense report (the real corpus phrase *"my hand's gonna
  hurt now"* still stops it — validate cycle 11 held).
- **Drill lines render once** (the drill event no longer double-feeds the transcript
  buffer); the metronome stream clock resets per lesson; cache-bust v=13.
- **Scheduler detox** — all 18 mic-era spots (every one 0-clean; one cross-piece
  contaminated) archived to `data/archive/pre-v4/`, live schedule blanked. The Phase 1
  verbal re-intake rebuilds truth from *his* words.

- **p0.9 — the adversarial review earned its keep.** A three-lens fresh-context review
  (concurrency, behavior-regression, a replay of the real 07-07 session) refuted parts
  of the first pass: the speech governor could fuse queued turns and freeze on orphaned
  claims (rebuilt: atomic claim loop, post-wait dedup, reset on rollover); the drill
  dupe-guard raced across its own awaits (now behind an arm lock; a same-cfg re-fire
  *after a rep* is a deliberate restart, not an echo); and — the critical one —
  **Gemini streams his words as sub-word fragments**, so the pain scan and goal capture
  were near-blind on the live path (fragments now assemble raw and act once, safety
  before goal capture). Numbness/cramping/strain/sharp-pain coverage restored to the
  safety net. Take source is frozen at take start so plugging a cable mid-drill can't
  flip the scheduler gate.

Validated: `unit_v4.py` 15/15 (new plain-python unit harness) · `validate_v3.py`
48/48 · `selftest.py` 43/43 · three-lens fresh-context adversarial review of the full
phase diff, all confirmed findings fixed (p0.9).

### 🎚️ Phase 1 — the input-mode gate (SHIPPED 2026-07-08)
The reframe's spine: **one `input_mode` ("mic" | "midi") consulted at every judging,
recording, and diagnosis path** — so "mic never grades notes" is structural, not a pile
of scattered checks. Four commits (`v4 p1.1`–`p1.4`):
- **p1.1 — the gate.** `CoachSession.input_mode()` auto-detects (MIDI cable → midi, else
  mic) and takes a voice/UI override ("switch to the mic", the 🎙️/🎹 chip). `source()`
  now delegates to it, so `_final_verdict`, the drill scheduler gate, and `_rearm` all
  obey for free. A pinned 'midi' with no cable falls back to mic and says so. The take's
  source is **frozen at start** (`_take_src`) — plugging a cable in mid-take can't flip
  the judging gates.
- **p1.2 — mic drills stop grading.** On mic, a drill rep is no longer transcribed and
  graded (the unwinnable 35–52% loop). `_grade_rep` forks: mic → silently counts what it
  hears ("heard N passes") and the reps come from HIS voice (Phase 2 wires the counting
  tool). The drill state machine (count/gate/cooldown/escalation) was extracted into one
  `_apply_rep` that both the MIDI grade path and the coming verbal path feed — one
  machine, two inputs. The 12-second graded-window cap that chopped 8-bar cells is now
  derived from the drill span (both mic and MIDI).
- **p1.3 — the mic tells the truth.** `analyze_take` on mic sets `mic_approx` + a
  `coverage_pct` ("mic caught ~47%") and **suppresses note counts and wrong/missed lists
  entirely** — it never asserts a note error off a lossy transcription. Phantom tempo
  readings (>300 bpm) → none. `diagnose` on mic emits only a *widened-gate* rhythm read
  (still reaches Yukiko's real "pulse isn't counted") or an honest low-coverage "not
  enough signal to call the notes secure" — never a note-level accusation. `align.classify`
  only calls a substitution when the notes are same-hand and within 4 semitones (kills
  fabricated "you played A4 instead of G3", helps MIDI honesty too). MIDI judging: byte-identical.
- **p1.4 — memory reset + verbal re-intake.** Every hard-spot/goal/"needs work" in memory
  was inferred by a mic that misheard him (the poisoned "Hello. Hello." goal, the m.8/m.9
  "keeps breaking here"). `scripts/reset_memory_pre_v4.py` archived all of it to
  `data/archive/pre-v4/` and cleared the live memory **keeping only what his own hands
  made** (fingerings he chose, marks he drew). Each piece is now armed for a **fresh
  start**: the next session opens with the coach asking HIM what's actually hard — and
  captures his walkthrough as data (`intake_done` tool + INTAKE persona). Ran live across
  all 3 pieces.

Validated: `unit_v4.py` 33/33 · `validate_v3.py` 48/48 (Yukiko "pulse isn't counted" +
Jeanie wrong-clef fingerprint both still reached) · `selftest.py` 43/43 · three-lens
adversarial review of the Phase 1 diff (found 3 majors + the vacuous-cycle trap, all
fixed in p1.5).

### 🗣️ Phase 2 — the verbal toolset (SHIPPED 2026-07-08)
The layer he lives in during a long session — he talks, the app keeps the book. Five
commits (`v4 p2.1`–`p2.5`):
- **Rep counters + tempo ladders (`coach/counters.py`).** "100 reps of m.492, bump 4
  bpm every 10 toward ♩=96" → a named counter with a ladder. **HE counts** ("that's
  one", "that's five", "missed it", "I did about 20 without counting") — reps NEVER
  come from audio. When a drill is live on mic, his voice moves the SAME state machine
  (gate/ladder/backup/cooldown) an audio rep would; passive listening only corroborates
  and never corrects his count. Ladder crossings step the metronome and speak the rung;
  milestones ("34 of 100 — over a third in") land once.
- **Metronome on demand.** "metronome 72", "offbeat", "accent every third",
  "woodblock" — the click grew offbeat pulses, accents, subdivisions, and click/wood/
  beep voices, all voice-driven, changeable mid-run.
- **The organizer.** Goals now carry deadlines ("memorized by Aug 1" → the greeting
  says "by Aug 1, 24 days out"). `end_session` closes a session with a spoken wrap-up,
  logs it, and sets tomorrow's resume point from where he left off. `recall` answers
  "when did I last work the coda?" from memory + the session docs. This is the
  paper-replacing brain he asked for.
- **Knowledge-grounded advice.** "How do I practice m.517's right hand?" → the coach
  pulls the exact score bars, the Strategy Engine routing, and the classical-piano
  knowledge dump, then prescribes ONE drill (tempo + reps) — advanced techniques only
  when the problem type calls for them.

Validated: **`unit_v4.py` 64/64 · `validate_v3.py` 48/48 · `selftest.py` 45/45 · a new
`validate_v4.py` acceptance bar 17/17** (drives the headline promises end-to-end
through a real session — the lived 07-07 failure can't recur: a mic drill grades no
audio, nags zero times, writes nothing to the scheduler, and counts only from his
voice). Plus a fresh-context three-lens review of the Phase 2 diff (p2.6 fixed a
cross-piece resume-point leak + the nearest-deadline sort + a metronome-shape bleed).

### 🩹 p2.7 — real-use fixes from the 2026-07-09 session
He used the v4 app for real and hit three things the phases hadn't fully solved (the app
WAS on v4 — his `recall` tool fired — these were genuine gaps):
- **His SPEECH was being transcribed as PLAYING.** He said *"Hello. Hello."* and the app
  answered *"I followed you through around measure 325."* `feed_audio` fed the listening
  take before the speech gate, so his voice became notes. Now the silero gate runs FIRST
  and the take is fed ONLY while he is not speaking — his talking can never become a take.
- **The coach cut ITSELF off at startup.** No headphones on an acoustic → its own spoken
  greeting bled into the room mic and triggered the barge-in that flushed its own voice.
  Now the local playback-flush is suppressed while the coach's own line is still playing
  (for every line, not just drills); a real barge-in still lands via the model's server VAD.
- **The mic follow-along NARRATED his free playing** ("I followed you through m.X" after
  every phrase). The coach is a VERBAL tracker — it now follows free playing SILENTLY
  (score cursor + card) and speaks only when he talks to it or runs a drill. MIDI still
  gives its precise spoken verdict.
- **The coach over-assigned drills.** He said *"I'm gonna play the last page dotted rhythm,
  just keep track"* and it imposed its own dotted drill on m.708–719. Now a drill is
  something he OPTS INTO — when he narrates his own plan the coach starts a COUNTER and
  tracks his reps his way; it only prescribes a drill when he asks for one.

Validated: unit_v4 69/69 · validate_v3 48/48 · selftest 45/45 · validate_v4 17/17.

### 🎧 Phase 3 — musicality: reference recordings (SHIPPED 2026-07-09)
The wishlist he cared about — *"here's how a real pianist plays this phrase"* — is real.
- **Foundation (`coach/references.py`)**: a per-piece reference library (yt-dlp fetch,
  long-file chunked transcription that matches a single pass within 5%) and — the key
  piece — **measure→timestamp maps** so *"play how Rubinstein does m.492"* is an index
  lookup. The map walks the score against a time-local audio search band (beats the
  whole-piece histogram that false-matches the Scherzo recap) and enforces monotonicity
  (sparse where unsure, never fabricated). On the real Scherzo-opening demo: 12 of the
  first 16 bars mapped, m.1 at 2.39s.
- **Playback (p3.3)**: *"play how Rubinstein does m.492–516"* → the coach plays those
  exact bars from a real recording, measure-accurate, and **pauses the mic take first**
  so the room mic can't transcribe Rubinstein AS Christian (a per-clip token + a
  `_ref_playing` interlock — an adversarial review caught a race here and it was fixed).
- **Honest comparison (p3.4)**: *"compare my take to Rubinstein"* → two curve pairs on
  screen — tempo shape and dynamics arc ONLY, never note accuracy (test-enforced) — with
  a one-line read of the single biggest divergence.
- **Spotify tier (p3.5)**: *"put on the Argerich recording"* drives the Spotify app for
  full listens; the yt-dlp copies are the analyzable/clippable tier.

### 🎬 Phase 4 — technique media + click-clock (SHIPPED 2026-07-09)
- **Technique video (p4.1, `coach/media.py`)**: *"show me what rotation looks like here"*
  → a real demonstration is downloaded, clipped to the exact seconds (ffmpeg), and shown
  **inline** (autoplaying local video, not a YouTube link), logged to the session doc,
  cache-capped at 500 MB.
- **Metronome click-clock (p4.2)**: click times now align to each take's origin on the
  lesson clock so a click is never mistaken for a played onset.
- **MIDI polish (T27) consciously deferred**: arming MIDI takes for a bare-play verdict +
  the wrong-recap localization port have ~zero value for a mic-only Steinway player and
  no MIDI device exists — deferred rather than risk a green app on a path he'll never use.
  The MIDI precise path still works (selftest cycle 12).

**v4 is substantially complete.** Final battery: **unit_v4 97/97 · validate_v3 48/48 ·
selftest 45/45 · validate_v4 17/17**, four fresh-context adversarial-review passes across
the phases (every confirmed finding fixed), and a live `/ws/coach` smoke test on a fresh
boot. **⚠️ Quit + relaunch PianoCoach.app to run it — a running app holds the old
server.py in memory.**
