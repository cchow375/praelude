---
type: operational
tags: [piano, coach, app, state, roadmap, bugs]
doc_updated: 2026-07-09
status: v4 SUBSTANTIALLY COMPLETE (phases 0-4; T27 MIDI deferred) — relaunch the app to run it
---

> 🎛️ **v4 UPDATE (2026-07-08): the two-mode reframe is real (Phases 0–1 shipped).** The
> 07-07 blowup was diagnosed (19 confirmed bugs — [[(C) v3.3 Reframe — Diagnosis,
> Decisions & Plan]]); the approved design + phased plan + bug→phase checklist live in
> **[[(C) v4 — Design, Plan & Build Prompt]]** (mic = verbal tracker/organizer that
> **never grades notes**; MIDI = a toggle to the intact precise brain).
> - **Phase 0 (stop-the-bleeding) SHIPPED**: no speech spam (SpeechGovernor dedup + turn
>   serialization), no self-cutoff during drills, drills can't cancel themselves, mic
>   can't poison the scheduler, memory can't be silently wiped, pain-mention goals work,
>   the poisoned scheduler archived + blanked. (The p0.9 adversarial pass also fixed a
>   **critical** live bug: Gemini streams his words as sub-word fragments, which had left
>   the pain-stop + goal capture near-blind — fragments now assemble before acting.)
> - **Phase 1 (the input-mode gate) SHIPPED**: `input_mode()` ("mic"|"midi") gates every
>   judging/recording/diagnosis path (auto-detect + voice/UI override + a mode chip);
>   the take source is frozen at start. **Mic drills stopped grading** — reps come from
>   his voice, listening only corroborates ("heard N passes"). **The mic tells the
>   truth** — `mic_approx`/`coverage_pct` instead of note counts, no fabricated wrong
>   notes, no phantom-tempo scolds; rhythm read widened but still reaches the teacher's
>   real "pulse isn't counted". **Memory reset + verbal re-intake** — the misheard
>   hard-spots/goals archived, each piece opens fresh by asking HIM what's hard.
> - **Phase 2 (the verbal toolset) SHIPPED**: voice rep counters + tempo ladders (HE
>   counts, never the audio), metronome on demand (offbeat/accents/subdivisions/
>   sounds), the organizer (goals with deadlines, `end_session` wrap-up + tomorrow's
>   resume point, `recall`), and knowledge-grounded practice advice (score + Engine +
>   the classical-piano knowledge dump → one drill).
> - **p2.7 — real-use fixes (2026-07-09 session)**: his SPEECH was being transcribed as
>   PLAYING ("Hello" → "I followed you through m.325") — now the take is silero-gated so
>   his voice never becomes notes; the coach no longer cuts itself off on its own TTS
>   bleed; the mic follow-along stopped narrating free playing (silent cursor-follow); and
>   the coach stopped over-assigning drills (a drill is opt-in; his own plan → a counter).
>   **⚠️ These require QUITTING + RELAUNCHING PianoCoach.app — a running app has the old
>   server.py in memory.** Smoke-tested on a fresh boot: greeting is the fresh-start intake.
> - **Musicality SHIPPED (Phases 3-4)**: reference recordings played measure-accurate
>   ("play how Rubinstein does m.492", pausing the mic so it isn't transcribed as him),
>   honest tempo/dynamics comparison, a Spotify tier, and inline technique-video clips.
>   MIDI polish (T27) deferred — mic-only user, no device. `coach/references.py` +
>   `coach/media.py`.
> - Suites: **unit_v4 64/64 · validate_v3 48/48 · selftest 45/45 · validate_v4 17/17**
>   (the new acceptance bar) + per-phase three-lens adversarial review. **Plan B
>   (references playback, tempo/dynamics comparison, technique media, MIDI polish) is
>   the remaining work.**
>
> *Everything below this box describes v3.2 and earlier; the 🐛 tables remain accurate
> history — but note the v3.2 "mic follows along, MIDI+drills judge" split is SUPERSEDED:
> in v4 mic NEVER grades (drills included), MIDI is the only precise path.*
>
> 🎧 **v3.2 UPDATE (2026-07-07): the listening rebuild.** Real-use blew up — locked
> to a stale navigation range, the app judged him at 16% and cut him off mid-phrase.
> Root cause ran deeper: a **clean mic take reads 35–52% with second-scale timing σ**
> (lossy transcription), so any precise mic judgment is noise. Now: **never interrupt
> mid-phrase** (mic + MIDI), **localize don't lock** (a set range is a hint, not a
> judging window), **the mic follows along instead of grading** (acknowledge + invite,
> trust yellow, no recording of bad grades — precise judging is MIDI + drills only),
> and **continuous listening with no Listen/loop/clear buttons**. Adversarially
> reviewed; `selftest` 43/43 (+ mic-leniency cycle) + `validate_v3` 48/48. Details:
> [[(C) PianoCoach — Version History#🎧 v3.2 — the listening rebuild (2026-07-07)|Version History §v3.2]]
> · full log [[(C) v3.2 Listening Rebuild Log (2026-07-07)]].
>
> 🎚️ **v3.1 (2026-07-07): the interface pass.** After using v3,
> Christian's feedback was about the interface, not the coaching — *"less time
> interacting with the interface, more time playing."* Now shipped: the **whole
> score scrolls freely** (no chunk-lock, no bars box), a **real-PDF toggle**,
> **link + fingering** annotation tools, a roomier palette, **Today's Session +
> History as live editable vault docs**, the coach **knows the whole screen**, and
> the "AI font" is gone. `validate_v3.py` 48/48 + `selftest.py` 41/41 stay green;
> every slice verified live. Details:
> [[(C) PianoCoach — Version History#🎚️ v3.1 — the first-real-use pass (2026-07-07)|Version History §v3.1]].
>
> 🎼 **v3 (2026-07-07): the reframe is built.** Every 🐛 issue below is fixed at
> the root and verified (`validate_v3.py` + `selftest.py` 41/41 + the real narrated
> recordings). The v2 root-cause table is kept below as the historical record —
> each row has a **✅ FIXED** line pointing at the v3 code.
> The remaining backlog is **deep diagnosis, deferred by design** (fingering
> suggestion, pattern detection, section-type classification) — the reframe says
> "rhythm, dynamics, and deep diagnosis come later." v3 is the rep-tracker first.

# 🩺 PianoCoach — State, Strengths, Weaknesses & Roadmap

> The honest "where is it really at" doc — what genuinely works, what's broken,
> what's coded-but-dormant, and **exactly what to fix, with the code location**.
> This is the doc to open when you sit down to work on the app. Map: [[(C) Coach App]] ·
> how it works: [[(C) Coach App — How It Works]] · your raw notes: [[v2 issues]].

> 🔭 **Direction update (2026-07-06):** your [[v2 issues]] expanded from "fix v2's bugs"
> into a **full reframe** — the coach should be a *verbal, interactive, lenient rep-tracker*,
> not a diagnostician. The target + the behavior contract distilled from your recordings
> live in **[[(C) PianoCoach — v3 Vision & Coaching Spec]]**. *This* doc = current state +
> bugs + backlog; *that* doc = where we're going. The backlog below is reordered around it.

## 🧭 Quick nav
- [Status box](#status) · [✅ What genuinely works](#works) · [🐛 Your v2 issues → root cause → fix](#issues)
- [😴 Coded but dormant](#dormant) · [⚠️ Fragility & tech debt](#debt) · [🎯 Prioritized backlog](#backlog)
- [🛠️ Dev quickstart](#dev)

---

## <a name="status"></a>📦 Status box
| | |
|---|---|
| **App** | `/Applications/PianoCoach.app` **v3.2** — built, launched, in use |
| **Listening** | ✅ **continuous** (no Listen button); **never cuts him off mid-phrase**; **localizes** (a set range is a hint, not a lock); **mic = follow-along** (approximate, never a fault-grade), **MIDI + drills = precise** |
| **Core loop** | ✅ greet → listen continuously → find where he is → follow along / (MIDI) verdict → drill |
| **Voice / brain** | `gemini-3.1-flash-live-preview` (thinkingBudget 0, **~2.3s to first speech**) + on-demand Claude text brain |
| **v2 risks** | ✅ git (local `main`, per-slice commits) · ✅ adaptive noise floor · ✅ wrong-measure re-locate · ✅ warm-up window |
| **Progress layer** | ✅ un-frozen — the over-strict `clean` gate loosened; non-clean steps down a tier instead of resetting |
| **The moat** | ✅ interactive annotated score — **whole piece scrolls freely**, score ⇄ PDF toggle, coach points at exact notes + **knows what's on screen**, Christian draws / links / fingers back |
| **Live docs** | ✅ **Today's Session** (editable, seeded daily, coach writes it live) + **History** (rolling archive) — real vault files |
| **Pieces live** | 3 of 5 (Beethoven Op.90, Scherzo No.2, Griffes). Étude & Prokofiev are PDF-only. |
| **Remaining backlog** | deep diagnosis (fingering-suggestion engine, pattern detector, section-type) — **deferred by design** · off-disk git remote (needs `gh` auth — Christian) |

---

## <a name="works"></a>✅ What genuinely works (real strengths)
- **Architecture is clean and right.** One socket, one Verdict object, template
  speech + streaming Claude depth. The "two brains disagree" bug is genuinely dead.
- **Score parsing is solid** — own MusicXML parser, KernScores-aware, handles ties/chords/grace, cached.
- **Alignment is rubato-immune** — Needleman-Wunsch by pitch content, timing measured after. Pauses don't break matching.
- **MIDI path is excellent** — exact notes/durations/velocity, instant verdict, hot-plug. **If you play through a MIDI keyboard, most of the mic problems below vanish.**
- **Never-grade-a-pause is real** — enforced in 4 places; the v1 0/36 disaster is gone.
- **Reduced-task grading is real** — LH-alone drills grade the LH only.
- **The rep loop is genuinely teacherly** — verify manner → count → reset → escalate → auto-backup → cool-down on a slow-perfect pass.
- **It reproduced a real teacher's verdict** — Yukiko's "the rhythm isn't being counted" on her actual lesson audio (self-test run 4).
- **Vault integration** — live-parsed Strategy Engine, named-source pedagogy, writes back only to `(C)` files.

---

## <a name="issues"></a>🐛 Your [[v2 issues]] → root cause → fix

Every complaint you logged has a concrete code cause. Ranked by impact.

### 1. 🎧 "Recognition is bad with silences… any perceived sound is terrible"
- **Root cause:** the mic listener uses **absolute, gain-dependent thresholds** —
  `stream.py`: onset `flux > 0.5`, "quiet" `rms < 0.01`, rep-boundary `max(recent_rms) < 0.01`;
  `realtime/gate.py`: Silero speech `p > 0.5`. None adapt to your room or mic level.
  Too quiet → nothing registers; room noise → it never reads "silent," so drills never segment.
- **Fix direction:** calibrate a **noise floor** at lesson start (sample 1 s of
  silence), make onset/quiet thresholds **relative** to it (e.g. `flux > k × noise_floor`),
  and normalize input gain. Add a live input-level indicator so you can see it hearing you.
  *(Or just use MIDI — the whole class of problem disappears.)*

### 2. 🎯 "It looks at the wrong measure… 5 measures of wrong notes should trigger a re-check" + "measure 500 glitch on a different piece"
- **Root cause (two bugs):**
  1. **Position tracking is forward-only** in *both* `stream.py` and `midi_in.py`
     (`range(_ptr+1, …)`) — it can't rewind if you jump back, and there's **no
     re-locate fallback** when a supplied range simply doesn't match what you play.
     `trim_to_played` just returns the original range on total mismatch.
  2. **Piece switch doesn't reset the range** — `server.set_piece` reloads the
     score but leaves the old `m_from/m_to`, so measure 500 from the Scherzo
     "follows" you onto a piece that has no measure 500.
- **Fix direction:**
  - On piece change, **reset range** to the new piece's `first_measure`, clear the take, reset the cursor.
  - Add a **catastrophic-mismatch trigger**: if match-rate stays under ~40% for
    N onsets (or >~20 wrong in a row), **re-run `align.locate`** and re-anchor
    (exactly what you asked for). This is the single most valuable new feature.

### 3. 🧊 "It assumes I start at the exact tempo/beat — listen 2–3 measures before judging"
- **Root cause:** there is **no warm-up/confirmation window**. The moment you hit
  Listen it starts tracking and grading; `locate` only runs if you left the range blank.
- **Fix direction:** add a **warm-up phase** — track (don't grade) the first 2–3
  aligned measures, confirm position + tempo, *then* start emitting verdicts/errors.
  Show a "listening… found you at m.X, ♩≈Y" confirmation before judging.

### 4. 🪢 "Way more flexibility before it calls something wrong"
- **Root cause:** the `clean` gate is strict (`σ < 25 ms`, zero errors), yellow-trust
  mic takes still call exact wrong notes, and single anomalies can flag.
- **Fix direction:** for mic mode, require **clusters not singletons** before
  calling a wrong note (the coach is *told* to do this in prose, but the analyzer
  still reports singles); widen `clean` timing tolerance; add a "just let me play" low-sensitivity mode.

### 5. 🐢 "It should prescribe slow practice when I'm consistently under tempo"
- **Root cause:** `engine.diagnose` has **no target-tempo-aware rule.** It never
  compares your played tempo to the piece's full-speed target (which *does* exist
  in `(C) coach-profile.md` but is only read for `phase`/`focus`, not tempo).
- **Fix direction:** load a **target tempo** per piece (coach-profile), and add a
  diagnosis rule: *played tempo ≪ target AND notes weak → prescribe `slow_meta`,
  not subdivisions.* This matches how you actually practice.

### 6. 🧹 "It's doing too much / give me more flexibility to actually play"
- **Root cause:** many metrics/flags fire on every take; it always has an opinion.
- **Fix direction:** a **"just play" mode** — listen, follow the cursor, log the
  take, but only speak if you ask or if something is clearly wrong. Make the coach
  quieter by default; earn the right to interrupt.

### 7–12. 🆕 The 2026-07-06 expansion (reframe — full detail in the Vision doc)
These are less "bugs" than a change in what the app *is*. Full spec + your own rules:
**[[(C) PianoCoach — v3 Vision & Coaching Spec]]**. Summary + where each lands in code:

| Ask (your words) | What it means | Where it touches the code |
|---|---|---|
| **7. "just ask me what I want… communication is key"** | Coach **asks the goal**, talks back and forth, tells you before enforcing a rule | `prompts.py` (personas/tools) + `reploop.py` — add ask-first turns; voice tools already exist |
| **8. "too defined… I start a drill and it counts exactly"** → **negotiated drills** | Suggest a drill; you can override/change it mid-way; it adapts | `reploop.py` — the state machine must accept user re-specs, not lock a fixed count |
| **9. "create its own MD document… update it with only important context"** | **Living per-piece coach-memory doc** (hard measures, learned/todo/goals, resume point) | `vault.py` — new: a curated `(C) coach-memory {piece}.md` the coach rewrites (beyond the per-session dumps it already writes) |
| **10. "it's just doing too much" / "much more leniency"** | Repetition-first; quiet by default; loosen judging | `analyze.py` `clean` gate + `engine.diagnose` thresholds + `verdict.py` |
| **11. "I like the progress window but reset it to be more lenient"** | The clean-rep gate is so strict the Progress tab reads ~0 | `analyze.py:155` (`clean`) — the same fix un-freezes the scheduler (see Dormant, below) |
| **12. interactive annotated score + draw/whiteboard; full UI rehaul** | Coach annotates the sheet music it references; you draw on it | `web/` overhaul (OSMD annotation layer + a canvas) — **the Cadencify "moat"**; use the design skills |

> 🗣️ **The behavior contract** (don't-grade-restarts, wait for note-hunting, verify-before-
> calling-wrong, the ~80% wrong-measure trigger, believe-me, notes-first, anticipatory cues,
> track resume point…) is written out in full in the Vision doc, pulled straight from your
> narrated recordings. **That contract is effectively the Strategy Engine v3.**

---

## <a name="dormant"></a>😴 Coded but dormant (the docs oversold these)
These features exist in code but **barely fire in your real data**:

| Feature | Why it's dormant |
|---|---|
| **Clean-rep % (the "hero metric")** | Almost **no take ever scores `clean`** (strict gate) → the hero number sits ~0. |
| **Spaced repetition tiers (24→168h)** | Nothing scores clean → intervals never advance past 24h. All 16 tracked spots are stuck at tier 0. |
| **`tempo_ceiling` per spot** | Only set on a clean rep → always `null`. |
| **Tempo gates** | Need 3 clean of an *exact* range → never pass (ranges fragment: `8-11` vs `1-14` vs `1-16`). |
| **Sleep-anchoring ("retest first tomorrow")** | `today_plan` narrates it but **never calls `mark_hardest()`** → `retest_first` always null. |
| **Decay "radar"** | It's a flat **3-day** cutoff, not a forgetting curve. |

**The through-line:** loosen the `clean` gate (issue #4) and these light up. They're
all downstream of that one over-strict boolean.

---

## <a name="debt"></a>⚠️ Fragility & tech debt (found in the code)
- **✅ Git (as of 2026-07-06).** `~/piano-coach/` is now under version control (local `main`). Remaining gap: **no remote** — add a private GitHub so it survives disk failure, not just an in-place rebuild.
- **📝 Vault writes are non-atomic** (`vault.py` `write_text`) — a crash mid-write could corrupt a hand-authored note. Riskiest path in the app. Use temp-file + `os.replace`.
- **🧠 Threshold duplication** — the notes-vs-rhythm cutoffs are copy-pasted in `engine.diagnose` **and** `coachtalk._problem_sentence`. Edit one, they drift, and the "one verdict" fragments — the exact bug it was meant to kill. Extract shared constants.
- **🥁 Two different `clean` definitions** — `analyze.py` treats `σ=None` as *not* clean; `reploop.py` treats it as clean. A rep and its take verdict can disagree.
- **🎚️ `verdict.build_rep` trust is a dead ternary** (`verdict.py:80`) — every drill rep is tagged green even on a noisy mic.
- **🎼 Rhythm-distortion vs rubato** — measures deviation from a single global tempo, so genuine rit./rubato reads as "rhythm not counted." Needs a tempo-curve-aware comparison.
- **🔒 Gemini API key is passed in the URL** (`gemini_live.py`) — leak risk in logs/proxies.
- **⚙️ Realtime model settings have no default** — an unset `gemini_live_model`/`openai_realtime_model` produces `models/None` and a silent connect failure.
- **🌍 Not portable** — `VAULT` + `CKPT` hardcoded to `christians universe` on this Mac. Fine for you; blocks reuse/sharing.
- **🧟 Orphaned code** — `coach/voice.py` (whole v1 local voice stack) is dead weight; `config.MODEL` unused; see [[(C) Coach App — How It Works#-dead-orphaned-code|dead-code list]].
- **🖥️ Frontend nits** — deprecated `ScriptProcessorNode`; Mental-practice leaks a keydown listener each open; `positionCursor` walks O(measures) per update.

---

## <a name="backlog"></a>🎯 Prioritized backlog

### 🔴 P0 — do first
- [x] **`git init` in `~/piano-coach/`** — ✅ done 2026-07-06. `.gitignore` excludes `venv/`, the parse cache, and **`data/secrets.env`** (your API key); first commit on `main`, 92 files (code + docs + practice data). ⚠️ **Still local-only — add a private GitHub remote for off-disk backup** (a local repo survives an in-place rebuild but not a dead disk).
- [ ] **Reset the range on piece switch** (issue #2b) — small, kills the "measure 500" glitch.

### 🟠 P1 — make it a *trustworthy rep-tracker* (the core of the reframe)
- [ ] **Adaptive audio thresholds** — noise-floor calibration + relative onset/quiet (issue #1).
- [ ] **Re-locate on catastrophic mismatch** — at <~80% accuracy, ask "am I on the right measure?" and re-run `align.locate` (issues #2a, #4; the ~80% trigger is your stated number).
- [ ] **Warm-up window** — track/confirm position + tempo over 2–3 bars before grading (issue #3).
- [ ] **Don't grade restarts / note-hunting / one-hand & technique fooling-around** — grade only the latest completed pass (from the recordings; partly in `reploop` already, extend to takes).
- [ ] **Loosen the `clean` gate + require clusters (not singletons) for mic wrong-notes** (issues #10, #11) — also un-freezes the scheduler + Progress tab.
- [ ] **Target-tempo → slow-practice rule** in `engine.diagnose` (issue #5): far-under-tempo → prescribe slow-metronome reps, not subdivisions.

### 🟡 P2 — make it *verbal & interactive*
- [ ] **Greet on start + ask the goal**; minimal text; talk back and forth (issues #7, #12-narration).
- [ ] **Negotiated drills** — `reploop` accepts your override/re-spec mid-drill instead of a locked count (issue #8).
- [ ] **Brief anticipatory cues** (~1 bar ahead) for known trouble notes.
- [ ] **Switch voice to `gemini-3.1-flash-live-preview` + `thinkingConfig.thinkingBudget=0`** (kills the ~8s delay — Cadencify already proved this); reconsider whether the Claude text-brain is even needed in v3.

### 🟢 P3 — memory · grounding · validation · UI
- [ ] **Living per-piece coach-memory doc** (`(C) coach-memory {piece}.md`): hard spots, learned/todo/goals, **resume point** (issue #9).
- [ ] **Interactive annotated score + draw/whiteboard** (the Cadencify moat) (issue #12).
- [ ] **Validate against the real narration recordings** — listen to every minute, test the pipeline output for interactivity/leniency (his explicit mandate; see Vision doc).
- [ ] **Full UI rehaul** using the design skills (`artifact-design`, `dataviz`).

### 🩶 Debt — clean up alongside the above
- [ ] Extract shared diagnosis thresholds (kill the `engine`/`coachtalk` duplication).
- [ ] Unify the two `clean` definitions; fix `build_rep` trust ternary.
- [ ] Atomic vault writes. · Delete `coach/voice.py` + other dead code.
- [ ] Add MusicXML for the Étude & Prokofiev (or mark them PDF-only in the UI).

---

## <a name="dev"></a>🛠️ Dev quickstart (for you or an AI in this vault)
- **Code lives in `~/piano-coach/`** (outside the vault). The spine is `server.py`; the brain is `coach/`.
- **Run for dev:** `cd ~/piano-coach && venv/bin/uvicorn server:app --port 8765` → open http://localhost:8765 in Chrome (mic works there without the WKWebView patches).
- **Self-test:** with the server up, `venv/bin/python test_assets/selftest.py` (synthetic + real lesson audio). ⚠️ **These pass on synthetic audio — they did NOT catch the live silence/wrong-measure bugs. Test against real playing.**
- **Change coaching behavior** without touching code: edit `Piano Practice/(C) Strategy Engine (AI).md` (routing/methods) — it re-parses live.
- **Where to make each fix:** the root-cause table above names the exact file for every issue.
- **First, read** [[(C) Coach App — How It Works]] end to end — it's accurate to the current code.
