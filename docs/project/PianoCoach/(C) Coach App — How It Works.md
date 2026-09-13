---
type: reference
tags: [piano, coach, app, reference, v4, technical]
app_version: "4.0 (phases 0-4; T27 MIDI deferred)"
doc_updated: 2026-07-09
accuracy: v2 deep map below is still accurate for the spine; v3 delta + v4 delta at the top
---

# 🔧 PianoCoach — How It Actually Works (Deep Reference)

> **🎛️ v4 delta (2026-07-08→09, Phases 0-4 shipped; T27 MIDI polish deferred):** the
> app is now two-mode (mic = verbal tracker that never grades notes; MIDI = the precise
> brain, toggled). What changed in the code, phase by phase:
> - **`coach/speechgov.py` (new)** — ALL template speech now passes
>   `SpeechGovernor.gate()` inside `_voice_say`: identical lines within 10 s are
>   dropped (card-only), a new turn waits for the in-flight one (asyncio.Event wired
>   to the realtime callbacks), and `_cue_until` is held for the line's estimated TTS
>   length so the coach's own room-mic bleed can't barge itself in. Onset barge-in is
>   OFF while a drill is live (`self.drill is None` guard in `_take_event`); talking
>   still interrupts via the SpeechGate.
> - **Drill lifecycle** — `_grade_rep`'s 'done' now finalizes via
>   `asyncio.create_task(self._finish_phrase())` (never `stop_take()` inline from the
>   drain chain); `start_take` treats a same-cfg re-fire <15 s as a dupe no-op and
>   ends a *different* replaced live drill properly (summary lands).
> - **Mic gates** — `scheduler.update_from_drill` only on `source()=='midi'`;
>   `_believe_last_take` only rewrites history/scheduler/memory for MIDI takes.
> - **`coach/memory.py`** — per-piece `RLock` + `_mutate()` read-modify-write, mkstemp
>   temp files, corrupt JSON backed up to `*.corrupt-<stamp>.json` before blanking
>   (the silent-wipe path is dead); `add_mark` keeps hard-kind marks in `marks[]`.
> - **`coach/safety.py`** — pain stop requires a first-person present-tense report
>   (`_pain_hit`); a goal that merely *mentions* pain is captured as a goal.
> - **Frontend** — drill events no longer double-feed the transcript buffer;
>   `state.sentSamples` resets per lesson socket; cache-bust `v=13`.
> - **Data** — `data/archive/pre-v4/` holds the poisoned scheduler (18 spots, blanked
>   live); `test_assets/unit_v4.py` is the new plain-python unit harness; `docs_check.py`
>   enforces doc freshness at phase gates.
>
> **🎚️ Phase 1 (input-mode gate) added on top:**
> - **`CoachSession.input_mode()` → "mic"|"midi"** — auto (MIDI cable → midi, else mic)
>   with a voice/UI override (`set_input_mode` tool, ws `input_mode` message, the
>   🎙️/🎹 `#inputModeChip`). `source()` DELEGATES to it, so every gate obeys. The take's
>   source is FROZEN at start in `self._take_src` — read that, never live `source()`,
>   in per-take judging (a cable plugged mid-take can't flip the gates).
> - **`coach/reploop.py`** — the post-grade state machine extracted into
>   `_apply_rep(clean, spot, tempo)`; `verbal_rep(clean, n)` and `fragment_heard()`
>   feed it from Christian's voice. `server._grade_rep` forks on `_take_src`: mic →
>   `fragment_heard()` + a `{'type':'drill','event':'heard'}` (NO analyze, NO grade, NO
>   speech); MIDI → the exact old path. The graded-window cap is span-derived in both
>   `stream.py` (LiveTake) and `midi_in.py` (MidiTake).
> - **`coach/analyze.py`** — on mic: `mic_approx=True`, `coverage_pct`, and
>   `n_missed/n_wrong/missed_notes/wrong_notes` suppressed (never assert a note error);
>   tempo estimate >300 bpm → None. MIDI byte-identical. **`coach/engine.py` `diagnose`**
>   on `mic_approx` emits only a widened-gate `rhythm_wrong` (dist ≥ 1.5× threshold AND
>   coverage ≥ 40 — reaches Yukiko's real read) or an honest low-coverage
>   `notes_wont_stick`; no note-level flags. **`coach/methods.py`** — no tempo-manner
>   scolds off a phantom/absent tempo. **`coach/align.py` `classify`** — substitutions
>   only when same-hand and ≤4 semitones apart.
> - **Memory reset + re-intake** — `coach/memory.py` `_blank` carries
>   `intake{done,at}`; `mark_intake_done()`; `server._greet` opens with the fresh-start
>   walkthrough when intake is armed; `intake_done` tool + INTAKE persona.
>   `scripts/reset_memory_pre_v4.py` archived the misheard memory to
>   `data/archive/pre-v4/{memory,vault}/` and kept only his fingerings + drawn marks.
>
> **🗣️ Phase 2 (verbal toolset) added on top:**
> - **`coach/counters.py`** — named rep counters + tempo ladders (pure module). Voice
>   tools `start_counter`/`count_rep`/`set_count`/`counter_status`/`stop_counter`. In
>   `server._grade_rep` the post-grade tail is now `_post_rep_event(res, analysis)`;
>   `count_rep` routes a MIC drill's verbal rep through `drill.verbal_rep` → the SAME
>   `_post_rep_event` (MIDI path byte-identical), else `counters.bump` (ladder rung →
>   `_emit_counter` steps the metronome + speaks). `count_rep` is a no-op on a MIDI
>   drill (the keyboard is the count).
> - **Metronome on demand** — the `metro` event carries `offbeat`/`accent_every`/
>   `subdiv`/`sound`; `web/app.js` `scheduleClick` renders them; `set_metronome` tool
>   passes them through. All clicks (incl. subdivisions) still reported so the server
>   filters its own clicks.
> - **Organizer** — `memory` goals are `{text, deadline, at}` (migrated on read in
>   `load()`); `add_goal(deadline=)`; `greeting_context` surfaces the nearest deadline.
>   Tools `end_session {summary}` (wrap-up line + tomorrow's resume point + counter
>   flush + sign-off) and `recall {topic}` (memory + today-tail + history-tail).
> - **Knowledge advice** — `vault.knowledge_snippets(query)` (section-scored over the
>   classical-piano dump, degrades to '' if absent); `practice_advice {m_from,m_to,
>   problem}` gathers score excerpt + Engine routing + knowledge + his context → the
>   model prescribes one drill.
> - **`test_assets/validate_v4.py`** — the acceptance bar: 6 integration cycles driving
>   the headline promises through a real CoachSession (lived-failure, spam throttle,
>   verbal ladder, mode gate, organizer close, safety-vs-goal).
>
> **🎧 Phases 3-4 (musicality + media) SHIPPED:**
> - **`coach/references.py`** — per-piece reference library (`data/references/{piece}/
>   {slug}/`), yt-dlp `fetch` (network-isolated `_run_ytdlp` seam), `transcribe_long`
>   (chunked, overlap-deduped), `build_map` (score-windowed time-local alignment,
>   monotonic) → `map.json` measure→timestamp, `locate_measures`, `compare` (tempo/
>   dynamics curves — NO note-accuracy keys). A module `_JOB_LOCK` enforces one
>   transcription job at a time (8GB). `scripts/build_reference_map.py`.
> - **`server.py` playback + comparison tools** — `fetch_reference`/`play_reference`/
>   `stop_reference`/`list_references`/`compare_to_reference`; REST `/api/reference/…`
>   + `/api/compare_ref`. `play_reference` sets `_ref_playing` + a per-clip `_ref_token`
>   and `stop_take(silent=True)` BEFORE playing so the room mic can't transcribe the
>   recording as Christian; the client's `ref_done` (token-matched) re-arms.
> - **Spotify** — `spotify_play`/`spotify_control` via osascript (graceful spoken
>   degrade if Spotify absent).
> - **`coach/media.py`** — `fetch_clip` (yt-dlp ≤480p → ffmpeg trim → 500 MB
>   oldest-first cache); `show_technique`/`clear_media` tools + `/api/media/{name}`;
>   inline `<video>` in `#mediaBox`.
> - **Click-clock (p4.2)** — CoachSession tracks `_rx_samples` + stamps `_take_origin_s`
>   at each `start_take`; both `clicks` handlers shift click times into the take's clock.
> - **T27 (MIDI auto-verdict + wrong-recap) DEFERRED** — mic-only user, no device; the
>   MIDI precise path itself is unchanged (selftest cycle 12 green).
> Full design/plan: vault **[[(C) v4 — Design, Plan & Build Prompt]]** + repo
> `docs/superpowers/plans/2026-07-08-v4-phases-0-2.md` (+ `-phases-3-4.md`).

> **This is the accurate technical map.** The v2 deep read below (the spine —
> server socket, alignment, analysis, drill loop, MIDI vs mic) is unchanged in
> v3; read the **v3 delta box first** for what moved. Honest state:
> [[(C) PianoCoach — State & Roadmap]]; the friendly hub is [[(C) Coach App]].

> ## 🎼 v3 delta (2026-07-07) — new modules + behavior
> The v2 pipeline still runs; v3 wraps it with the reframe. New/changed:
> - **`coach/engine.py` `contract()` + `is_clean()`** — the coaching numbers
>   (accuracy ladder, clean σ, rep gate) parse from a `contract:` YAML block in
>   Strategy Engine **§8** and are the SINGLE source every judging module reads
>   (kills the v2 threshold drift). `clean` gate loosened (σ<45 MIDI / <60 mic).
> - **`coach/tracker.py` `PositionGuard`** — the warm-up window, the
>   below-83%-ask ("am I on the right measure?"), and the catastrophic-mismatch
>   re-locate. Shared by BOTH `stream.py` (mic) and `midi_in.py` (MIDI).
> - **`coach/analyze.py`** — `_demote_singleton_wrongs` (mic clusters, not
>   singletons), `position_check` (re-locate + re-grade or ask), `_hand_sync`
>   (identify the TYPE: a hand entering early = a sync fault). `source`-aware.
> - **`coach/align.py` `detect_restarts`** — grade only the latest completed
>   pass (no-silence-gap restarts, via unique-anchor backward jumps).
> - **`coach/memory.py`** — the living per-piece coach-memory (`(C) coach-memory
>   {piece}.md`): resume point, goals, hard spots, fingerings, drawn marks.
> - **`coach/safety.py`** — deterministic pain/fatigue detection (pain stops;
>   fatigue eases off), independent of the voice model.
> - **`coach/speech.py`** — the musician number-speech normalizer (`m.494` →
>   "measure four ninety-four"), applied to EVERY spoken line (was the dead v1
>   `coach/voice.py`, now deleted).
> - **`coach/reploop.py` `respec()`** — negotiated drills (count/tempo/range/
>   method/hand changeable mid-drill).
> - **`coach/realtime/gemini_live.py`** — model = `gemini-3.1-flash-live-preview`,
>   `thinkingConfig.thinkingBudget=0` (the 8s-delay fix), session resumption +
>   context compression, key in the `x-goog-api-key` header.
> - **`web/annotate.js`** — the interactive annotated score (the moat): coach
>   points at exact notes via OSMD `GraphicSheet`; Christian draws / **links** two
>   notes / writes **fingerings** back.
> - **`server.py`** — `set_piece` resets the range (kills "measure 500");
>   deterministic greeting + ask-goal; barge-in by playing; `just_play` mode.
> - **Validation**: `test_assets/validate_v3.py` (18 cycles) + `selftest.py`.
>
> **🎚️ v3.1 interface delta (2026-07-07):** the score now **renders the whole
> piece and scrolls freely** (the bars-input box is gone — click a bar to jump,
> drag to select); a **score ⇄ PDF toggle** shows his real edition (poppler page
> images) and the coach reads those pages on demand (`show_pdf`); **Today's
> Session** (editable, seeded daily) + **History** (rolling archive) are live
> vault docs (`coach/session.py`, `/api/session/*`); and the client streams a
> **[SCREEN NOW]** note so the coach knows the visible measures / view / panel /
> tool (`server.on_viewport`, `gemini_live.send_context`). Full write-up:
> [[(C) PianoCoach — Version History#🎚️ v3.1 — the first-real-use pass (2026-07-07)|Version History §v3.1]].
>
> **🎧 v3.2 listening delta (2026-07-07):** the listening loop was rebuilt after it
> judged him wrong and cut him off. Now: (1) **no mid-phrase interruption** — the live
> `position_doubt` push is gone on mic (`stream.py`) AND MIDI (`midi_in.py`); (2) a set
> range is a **hint, not a lock** — a lesson take is placed by grading each `align.locate`
> candidate at finalize (`stream.py._finalize`); (3) the **mic follows along, never grades**
> — a clean mic take reads 35–52% (lossy transcription), so a mic lesson take acknowledges
> + invites, is trust-yellow, and is NOT recorded (precise judging = MIDI + drills only;
> `server.py._final_verdict`); (4) **continuous listening, no Listen/loop/clear buttons**
> (`_maybe_auto_stop` + `CoachSession.continuous`/`_rearm`). Full write-up:
> [[(C) PianoCoach — Version History#🎧 v3.2 — the listening rebuild (2026-07-07)|Version History §v3.2]]
> · [[(C) v3.2 Listening Rebuild Log (2026-07-07)]].

## 🧭 Quick nav
- [The shape in one diagram](#shape) · [What happens when you play](#flow) · [What happens when you talk](#talk)
- [The three "outputs" (verdict / voice / brain)](#outputs) · [MIDI vs mic](#input)
- [The listening pipeline](#listening) · [The alignment + analysis](#analysis) · [The drill loop](#drill)
- [The practice brain (Strategy Engine)](#engine) · [The scheduler](#scheduler)
- [Config & the model-name truth](#config) · [How it reads/writes your vault](#vault-io)
- [File map](#file-map) · [Dead / orphaned code](#dead) · [Run & troubleshoot](#run)

---

## <a name="shape"></a>🗺️ The shape in one diagram

```
  /Applications/PianoCoach.app   (52 KB native launcher, arm64)
        │  execs
        ▼
  ~/piano-coach/venv/bin/python app.py
        │  starts FastAPI in a thread + opens a WKWebView window (pywebview)
        ▼
  server.py  ── the spine ── one WebSocket:  /ws/coach
        │
        ├─ audio IN (mic, Int16 PCM 16kHz)  ┐
        │                                   ├─► PIANO  → stream.py (mic)  OR  midi_in.py (keyboard)
        │                                   │            → align.py → analyze.py → verdict.py
        │                                   └─► SPEECH → realtime/gate.py (Silero) → cloud voice
        │
        ├─ events OUT (JSON)  → web/app.js  (score, chart, verdict cards, chat)
        └─ audio OUT (Float32 24kHz) → the coach's spoken voice
```

**Key idea:** the `.app` is just a launcher. **All the logic is Python in
`~/piano-coach/`** serving a local web UI inside a native window. One socket
(`/ws/coach`) carries everything: your audio up, the coach's events + voice down.

---

## <a name="flow"></a>🎬 What happens when you play (the lesson loop)

1. The browser captures the mic (`getUserMedia`), downsamples to **16 kHz Int16
   PCM**, and streams it up the socket continuously (`web/app.js` → `attachSender`).
   *(There is no "record" button — it listens the whole time.)*
2. `server.py`'s `CoachSession.feed_audio` splits the stream:
   - **Piano** → the active *take* (`stream.LiveTake` for mic, `midi_in.MidiTake` if a keyboard is plugged in).
   - **Speech** → the **Silero gate** → the cloud voice (only if voice is on).
3. The take emits **live events** (current bar, tempo, per-bar error cells) that
   fill the chart and move the score cursor as you play.
4. You trail off. The browser detects **~2.5 s of silence** (mic RMS) and sends
   `listen_stop`. *(MIDI auto-stops server-side after 1.5 s of no notes.)*
5. The take is **finalized**: align → analyze → build **one Verdict** → the voice
   **speaks** the headline (~1 s), the **chart** shows numbers, and Claude
   **streams the deeper "why"** into the text pane.

**The take is trimmed to the bars you actually played** (`align.trim_to_played`),
so unplayed bars aren't counted as "missed."

---

## <a name="talk"></a>🗣️ What happens when you talk

- Your speech (over the mic) passes a **Silero speech gate** (`realtime/gate.py`)
  that only opens on **sustained** speech (≥0.35 s), so single piano notes don't
  trigger it — but talking *over* the piano still works.
- Gated speech goes to the **cloud realtime voice model**, which hears and
  replies in its own voice, streamed back and played gap-free.
- **Barge-in:** the instant the gate opens, the coach's playback is flushed and
  the model is told to stop — you can cut it off by talking or playing.
- The voice model has **7 tools** it can call to run the lesson (`prompts.VOICE_TOOLS`):
  `set_range`, `start_drill`, `stop_drill`, `set_metronome`, `get_score`,
  `today_plan`, `log_practice`. So *"actually I'm on measure 494"* moves the
  window; *"let's drill that"* starts the rep loop; etc.

---

## <a name="outputs"></a>🎯 The three outputs — one verdict, three renderings

This is the core contract (`coach/verdict.py`). Every judged moment produces
**exactly one `Verdict` object**, built only from **measured facts + the Strategy
Engine**. Three things render it — they never form a second opinion:

| Channel | What it carries | Who produces it |
|---|---|---|
| 🗣️ **SPOKEN** | ≤2 sentences: method + measure + tempo + why | **A template** (`coachtalk.py`) — *no LLM*. The voice model just says it aloud. |
| 📊 **CHART** | Per-bar missed/wrong, timing σ, tempo, dynamics | The Verdict's own numbers — never recited in words. |
| 📝 **DETAIL** | The spoken line PLUS sourced depth | **Claude** (`llm.py`), streamed to the text pane, told to *expand not re-judge*. |

> ⚙️ **Important nuance:** "the two brains can never disagree" is enforced by
> **architecture + prompt instructions, not by runtime checks.** The spoken line
> is a deterministic template; Claude is *told* not to contradict it, but nothing
> validates that it doesn't. (And the template thresholds are duplicated from the
> engine — see [[(C) PianoCoach — State & Roadmap]].)

---

## <a name="input"></a>🎹 MIDI vs mic + trust tiers

The app auto-detects the input: **if a MIDI keyboard is connected, it supersedes
the mic entirely.**

| | 🟢 MIDI (`midi_in.py`) | 🟡 Mic (`stream.py`) |
|---|---|---|
| Notes / onsets | **exact** (from the keyboard) | transcribed by **ByteDance** piano model |
| Note **durations** | **exact** (note-off − note-on) | model estimate |
| Metronome bleed | none (doesn't hear it) | click times sent + filtered (±35 ms) |
| Verdict lag | instant (no transcription) | ~1 s (tail transcription) |
| Trust tier | **green by construction** | green for clusters; **yellow** on fast/dense/loud; **red** if nothing matches |

**Trust tiers** (`verdict._trust`): `midi → green`. Mic: `red` if it matched
nothing, `yellow` if note-density > 8/s or very loud (velocity mean > 105), else
`green`. *(Bug: drill **reps** are always tagged green regardless of source —
`verdict.py:80`. See Roadmap.)*

---

## <a name="listening"></a>👂 The listening pipeline (per module)

| Module | Job | Key real details |
|---|---|---|
| `midi_in.py` | Exact keyboard capture | `python-rtmidi`, hot-plug poll every 2 s; opens the first non-"through" port; rep boundary at **1.5 s** silence; live tempo from median pitch-anchor slope. |
| `stream.py` | Mic streaming listener | 16 kHz, 1024-sample frames; **spectral-flux onset detection**; chroma-cosine live position; runs **ByteDance transcription** on ~6 s segments in a background thread to backfill exact per-bar verdicts. |
| `transcribe.py` | Audio → notes | Wraps ByteDance high-res piano transcription (**CPU-only**), checkpoint `~/piano_transcription_inference_data/note_F1=0.9677_pedal_F1=0.9186.pth`. Adaptive 1–10 s segment sizing. Shared with the lesson-tools. |
| `score.py` | MusicXML → notes | Own parser; KernScores-aware (hands as separate `<part>`s), `.mxl` auto-unzip, tie/chord/grace handling, disk cache in `data/scores/`. |

> 🎧 **The single biggest real-world failure lives here:** onset/silence detection
> uses **absolute, gain-dependent thresholds** (`flux > 0.5`, `rms < 0.01`). Too
> quiet → nothing registers; too much room noise → it never reads "silent," so
> drill reps never segment. This is the root of your "recognition is bad with
> silences / any perceived sound is terrible." Details + fix in the Roadmap.

---

## <a name="analysis"></a>🧮 Alignment + analysis (how it judges a take)

**Alignment (`align.py`) — rubato-immune, by pitch not timing:**
1. `locate` — if you didn't set a bar range, guess where you are via a 12-bin
   **pitch-class-histogram** match (coarse; shows top-3 guesses).
2. `align` — **Needleman-Wunsch** on chord onset-groups; cost = pitch-set
   dissimilarity. Timing is measured *afterwards*, so rubato/pauses don't break matching.
3. `classify` — per note: matched / missed / wrong (substitution) / extra.

**Analysis (`analyze.py`) — the measured facts:**
| Metric | How | Threshold that matters |
|---|---|---|
| Tempo (♩ bpm) | Theil–Sen robust slope of anchors | needs ≥4 anchors |
| Timing σ (ms) | deviation from a local tempo fit | **σ < 25 ms** = tight |
| **Rhythm distortion %** | played note-length ratios vs *written* values at the global tempo | **≥40%** off = "rhythm not counted" |
| Search pauses | gap > **2.5 s** between onsets | flagged, **never lowers accuracy** |
| Uneven runs | IOI coefficient-of-variation on even passagework | CoV > 0.12 |
| Voicing / legato / balance | velocity + gap analysis (polish phase only) | 🟡 velocity is relative |
| **`clean`** | the gatekeeper boolean | **no missed, no wrong, AND σ < 25 ms** |

> ⚠️ Two real problems here (see Roadmap): (1) **rhythm distortion vs a single
> global tempo flags genuine rubato/rit. as "not counted."** (2) The **`clean`
> bar is strict** — in your real `data/`, almost **nothing** ever scores clean,
> which quietly freezes the whole scheduler.
>
> **🎧 v3.2 supersedes most of this for MIC.** These numbers were being computed on
> a mic signal that reads a *clean* take at 35–52% with second-scale timing σ — so
> as of v3.2 a **mic lesson take is never graded or recorded at all** (it follows
> along + acknowledges; trust yellow). `clean`/σ/`accuracy_pct` and the scheduler
> now only bite on **MIDI-exact** takes and **drills**. So on mic these two problems
> simply don't fire — the app stopped pretending it could grade the mic.

**Notes-before-rhythm** (`engine.diagnose`): a low match-rate (< 75%) or any
searching pause defaults the diagnosis to *"notes aren't secure,"* and rhythm is
only the headline when the notes are demonstrably there **and** note-lengths are
measurably wrong. This is what reproduces Yukiko's real "the rhythm isn't being
counted" verdict on her lesson audio.

---

## <a name="drill"></a>🥁 The drill loop (`reploop.py`)

A hands-free state machine. Start it from a verdict card, the **Loop** button, or
by telling the voice "let's drill that." Silence (~1.5 s) segments your reps.

```
PRESCRIBE  → speaks it once ("dotted, m.494–499, ♩=72, three clean. Watch the thumb.")
STEP 0     → partial/searching?  → "take your time" — NOT counted (never grade a pause)
STEP 1     → VERIFY manner (methods.py): are you actually doing the method?
             (dotted must sound dotted) — wrong manner → correction, streak survives
STEP 2     → GRADE: clean?  (distorting methods ignore timing; others need σ<25ms)
COUNT      → clean → "clean, N more";  3 clean → GATE +4 bpm → "locked, up to 76"
MISS       → count resets, names the bar, then ADAPT (in this order):
               3 fails in a row + metronome → AUTO-BACKUP (slower, click on)
               same spot twice             → ESCALATE to a finer method
               wandering misses            → RUNG DOWN (−4 bpm)
COOLDOWN   → at target tempo, one SLOW perfect pass required before "done"
             (never ends on your fastest sloppy tempo)
```

Defaults are **hardcoded**: `need_clean=3`, `bpm_step=4`, backup ×0.75, cooldown
at 0.7× target. **Manner verification only exists for 9 methods** (dotted,
staccato, blocking, rhythmic_groups, chunk, slow_meta, voice_split, hands_sep,
additive); any other prescribed method skips the manner gate. **Metronome-off
drills lose auto-backup and rung-down** entirely.

**Reduced-task grading:** told to play LH alone, you're graded on the LH only
(`reduced_events`) — playing hands-together is a *manner* note, not a wrong-notes fail.

---

## <a name="engine"></a>🧠 The practice brain — the Strategy Engine

**No practice logic is hardcoded in the app** (mostly — see the caveat). It's
parsed **live** from your vault file:

- **File:** `Piano Practice/(C) Strategy Engine (AI).md` (`engine.py`, mtime-cached
  so edits apply on the next take).
- **What it parses:** `§2` routing table (symptom → method ids, markdown pipe
  table), `§3` methods (fenced ```yaml``` blocks), and a `backbone` block
  (regex-salvaged if not strict YAML).
- **Flow:** `diagnose(analysis)` → one ranked problem flag → `route(flag)` →
  `prescribe()` → one concrete drill (method + bars + start tempo `max(40, tempo×0.75)` + escalation).
- **Pedagogy attribution** (`pedagogy.py`): parses [[classicalpianodumpknowledge]]
  (100+ pianists/pedagogues) so advice is attributed to real named sources
  (Neuhaus, Cortot, Chang…), with low-confidence sources (Schindler myths, "whole-beat") dropped.

> ⚠️ **Caveat to "nothing is hardcoded":** the gate rules (`"3 clean → +4 bpm, a
> miss resets"`) are **string literals** in `engine.prompt_block` and defaults in
> `reploop.py`. If you change the gate in the Engine markdown, those won't follow.

---

## <a name="scheduler"></a>📅 The scheduler + the two live docs (Today's Session / History)

`scheduler.py` + `history.py`, state in `data/schedule.json` and `data/history/<piece>.jsonl`.

> **🎚️ v3.1:** the scheduler's plan is no longer its own tab — it's **seeded into
> the Today's Session doc**. `coach/session.py` owns two real vault files per piece:
> **`(C) today-session.md`** (the concise plan + goal + a Log the coach fills in
> live from the opening reflection, every take, drill, and mark; user-editable,
> saved on blur; fresh each day) and **`(C) practice-history.md`** (yesterday's
> session rolls in here, newest-first). Served by `/api/session/today` (GET/PUT)
> and `/api/session/history` (GET). The old manual "log to practice-log.md" form
> is gone — the session auto-logs everything now.

- **Spaced repetition** per trouble spot: intervals **24 / 48 / 72 / 120 / 168 h**.
  A clean rep advances one tier; a miss resets to 24 h.
- **`today_plan`** orders: retest-first → due spots → interleave (top trouble
  zones) → hardest-last → decay warnings, each with a *why*.
- **Decay radar:** a flat **3-day** "untouched, about to slip" cutoff.
- **Trouble zones** (`history.trouble_zones`): measures with the most summed errors over the last 60 takes.

> 🩺 **Reality check:** in your actual data, **no take scores `clean`**, so every
> spot is stuck on the 24 h tier, `tempo_ceiling` is always null, tempo gates
> never pass, and **`retest_first` is always null** (the sleep-anchor code is
> never called). The scheduler *runs*, but its adaptive tiering is effectively
> dormant. See [[(C) PianoCoach — State & Roadmap]].

---

## <a name="config"></a>⚙️ Config & the model-name truth

There are **three different model names** across the code, and a fourth in the
docs. Here's the actual resolution order:

| Source | Value | Actually used? |
|---|---|---|
| `data/settings.json` → `deep_model` | **`claude-sonnet-4-6`** | ✅ **YES — this is what runs** |
| `settings.py` default (if unset) | `claude-sonnet-5` | only if settings.json is wiped |
| `config.py` `MODEL` | `claude-opus-4-8` | ❌ effectively unused by the brain |
| old docs | "Sonnet 5" | ❌ wrong |

**The brain (`llm.py`)** calls `settings.get("deep_model", ...)` and streams via
**two backends, first available wins:**
1. **API key** — if `ANTHROPIC_API_KEY` is set, the `anthropic` SDK (streaming, prompt-cached). *(Not set for you.)*
2. **Claude Code login** — else `claude-agent-sdk` rides your existing `claude` CLI login (**no key, no per-token bill**). ← **this is your path.**

**Voice** (`data/settings.json`): `voice_provider = gemini` → **Gemini Live**
(`gemini-2.5-flash-native-audio-preview-12-2025`, voice "Kore"). OpenAI option is
`gpt-realtime-2`, voice "marin". Keys live in `data/secrets.env` (chmod 600) —
only `GEMINI_API_KEY` is set.

**Other config:** `PIANO_COACH_PORT` (8765), vault path is **hardcoded** in
`config.py` to `~/Desktop/christians universe/Piano Practice` (not portable).

---

## <a name="vault-io"></a>🔗 How it reads & writes your vault (`vault.py`)

**Reads:** `(C) Strategy Engine (AI).md` (live-parsed brain), [[classicalpianodumpknowledge]],
`(C) Daily Practice.md`, `(C) Drill Library.md`, and per piece: overview,
score-map, practice-plan, interpretation, `(C) coach-profile.md` (phase + focus),
practice-log, and the `score/` folder.

**Writes — only ever `(C)`-prefixed files:**
- Practice-log rows → inserted at the top of the first table in `(C) practice-log.md`.
- Session debriefs → new `(C) coach-session {date}.md`.
- Checkbox toggles in `(C) Daily Practice.md`.

> ⚠️ **These vault writes are NOT atomic** (`path.write_text` rewrites the whole
> file). A crash mid-write could corrupt a hand-authored note. This is the
> riskiest write path in the app — see Roadmap.

---

## <a name="file-map"></a>📁 File map (`~/piano-coach/`)

```
PianoCoach.app/            52 KB native launcher → runs venv python app.py
app.py                     FastAPI-in-thread + WKWebView window + mic-permission patches
run.sh                     browser fallback (uvicorn on :8765, opens Chrome)
server.py    ★ the spine — /ws/coach socket, all REST, the CoachSession orchestrator
coach/
  config.py                paths (VAULT, CKPT), model/port, piece discovery
  settings.py  settings.json + secrets.env      config.py's sibling source of truth
  ── LISTENING ──
  midi_in.py               exact keyboard capture (MidiTake)
  stream.py                mic streaming listener (LiveTake) — DSP + backfill
  transcribe.py            ByteDance piano transcription (CPU)
  score.py                 MusicXML parser (+ cache)
  align.py                 locate / Needleman-Wunsch / classify
  analyze.py               tempo, timing, rhythm distortion, polish, `clean`
  ── THE BRAIN ──
  verdict.py   ★ the ONE Verdict object (spoken/chart/detail renderings)
  coachtalk.py             instant template speech (no LLM)
  engine.py                parses (C) Strategy Engine (AI).md → diagnose/prescribe
  methods.py               acoustic "are you doing the method?" checks (9 methods)
  pedagogy.py              parses classicalpianodumpknowledge.md → named sources
  prompts.py               personas + voice tools + SPOKEN/DETAIL parser
  reploop.py               the drill state machine
  llm.py                   Claude deep brain (API key OR Claude Code login), streaming
  ── VOICE (cloud) ──
  realtime/__init__.py     provider factory (openai / gemini / none)
  realtime/base.py         callbacks, PCM helpers, facts-card renderer
  realtime/gate.py         Silero speech gate (piano-vs-voice)
  realtime/openai_rt.py    OpenAI Realtime adapter
  realtime/gemini_live.py  Gemini Live adapter
  ── SUPPORT ──
  scheduler.py             spaced repetition · decay · today plan
  history.py               per-take records · trouble zones · gates
  corpus.py                session training-corpus logger
  vault.py                 Obsidian read/write (only (C) files)
  voice.py                 ⚠️ ORPHANED v1 local voice stack (see below)
web/                       index.html + app.js (39 KB) + style.css + vendored OSMD/marked
data/                      history/ · corpus/ · scores/ (cache) · schedule.json ·
                           settings.json · secrets.env (0600) · takes/ (empty)
test_assets/               selftest.py + CYCLE_LOG.md + fluidsynth take generators
```

---

## <a name="dead"></a>🧟 Dead / orphaned code (don't be fooled)
- **`coach/voice.py`** — the **entire v1 local voice stack** (Silero VAD + whisper.cpp
  + Kokoro-82M TTS). v2 does **not** use it; only its `measure_words()` text helper
  is still imported. The real voice is `coach/realtime/`. Safe to gut later.
- **`config.py` `MODEL = claude-opus-4-8`** — the brain reads `settings.deep_model`, not this.
- **`data/takes/`** — empty; declared but unused. **`data/scores/`** — used (parse cache).
- **`n_fragments`** (read in `coachtalk.py` but never produced), **`SIL_EAGER_S`**
  (defined, unused in `stream.py`), **`.sparkmark`** CSS (never emitted) — small dead ends.

---

## <a name="run"></a>▶️ Run & troubleshoot
- **Start:** open `PianoCoach.app`. Logs: `~/Library/Logs/PianoCoach.log`.
- **Browser fallback:** `~/piano-coach/run.sh` → http://localhost:8765 (Chrome).
- **Rebuild the app** after editing `app.py`/plist: `venv/bin/python build_app.py`.
- **No voice?** ⚙ Settings → provider + key → Test. Without a key it's text+chart.
- **Mic silent in the window?** macOS Settings → Privacy → Microphone → PianoCoach ON, relaunch. Worst case: run.sh + Chrome.
- **MIDI not detected?** Hot-plugs — plug in, wait ~2 s, badge flips to MIDI.
- **Engine edits apply live** — save `(C) Strategy Engine (AI).md`, next take uses it.
- **Self-test:** `venv/bin/uvicorn server:app --port 8765` then `venv/bin/python test_assets/selftest.py`.
- **8 GB RAM:** models stagger-load after launch; the ByteDance ears only load in mic mode (MIDI skips them).

---

*For the honest assessment of what works vs. what's broken or dormant — and the
prioritized fix list for your [[v2 issues]] — see [[(C) PianoCoach — State & Roadmap]].*
