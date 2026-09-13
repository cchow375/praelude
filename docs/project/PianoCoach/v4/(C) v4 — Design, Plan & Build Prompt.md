---
type: reference
tags: [piano, coach, app, v4, design, plan, build-prompt, mic-only]
doc_updated: 2026-07-08
status: DESIGN APPROVED (all 4 sections, 2026-07-08) — ready to build
---

# 🎹 CodaKiller v4 — Design, Plan & Master Build Prompt

> **What this is:** the complete, self-contained v4 spec — the restart of the
> cut-off Part 2 (design + plan) of [[(C) v3.3 Reframe — Diagnosis, Decisions & Plan]],
> rebuilt from scratch with Fable 5 and expanded to cover the full
> [[v3. ideas for next and issues(v4 ideas)|v4 wishlist]]. Design approved section-by-section
> by Christian on 2026-07-08. **A fresh AI session can execute v4 from this doc alone**
> (the build prompt is [§9](#prompt)).
>
> Related: [[(C) Coach App]] (hub) · [[(C) Coach App — How It Works]] ·
> [[(C) PianoCoach — State & Roadmap]] · [[(C) PianoCoach — Version History]]

---

## 🧭 Quick nav
- [§0 · TL;DR](#tldr)
- [§1 · Decisions locked (scope + approach)](#decisions)
- [§2 · Design — architecture: the InputMode gate](#arch)
- [§3 · Design — the verbal toolset](#tools)
- [§4 · Design — musicality: references + media](#music)
- [§5 · The phases](#phases)
- [§6 · Bug→phase checklist (all 21 findings)](#bugs)
- [§7 · Data model](#data)
- [§8 · Validation — the honest bar](#validation)
- [§9 · 🚀 THE MASTER BUILD PROMPT](#prompt)
- [§10 · Open items](#open)

---

## <a name="tldr"></a>§0 · TL;DR

- **v4 = the reframe, built.** Christian plays a **Steinway acoustic through a mic**
  (MacBook built-in for now; open to a ~$100 upgrade). A clean mic take transcribes at
  **35–52% accuracy** — so on mic the app must **never grade notes**. He's NEC-prep;
  he owns note-correctness. The app owns **structure**.
- **Two modes, one gate.** `mic` (default) = **verbal practice tracker + organizer** —
  he talks, it tracks; lenient follow-along listening that never asserts errors.
  `midi` (toggle) = the intact precise brain, for if an e-piano ever gets plugged in.
- **Because listening is weak, everything else gets 10×:** voice rep counters + tempo
  ladders, metronome on demand, goals/deadlines organizer, score+knowledge drill
  suggestions, reference recordings of real pianists played measure-accurately
  mid-lesson, honest sound comparison (tempo/dynamics only), inline technique clips.
- **Built in 5 phases on the existing repo** (`~/piano-coach/`), each independently
  shippable, each killing its slice of the **21 audited findings**, each ending with
  tests green → docs updated → commit.
- **Phase 0 lands first and fast** — it stops the app from being actively harmful
  (spam, cutoffs, scheduler poison, memory-wipe race) before any reframe work.

---

## <a name="decisions"></a>§1 · Decisions locked (2026-07-08, with Christian)

| Decision | Choice |
|---|---|
| **Scope** | **Everything, phased** — tracker reframe core + musicality/reference recordings + technique media in one v4 plan; each phase usable alone, stop after any |
| **Approach** | **In-place evolution + central gate** — keep the repo and its validated assets; ONE `InputMode` gate consulted at 4 chokepoints (not 19 scattered checks, not a clean-slate rebuild) |
| **Mic hardware** | MacBook **built-in** today; Christian is **open to a ~$100 external condenser** if justified (it is — see [§10](#open)) |
| **e-piano** | None exists, none planned. MIDI mode = "just in case" toggle; fix its 2 lurking bugs (Phase 4) but don't over-invest |
| **Reference audio sources** | **yt-dlp** (local, analyzable, clippable, includes video) + **Spotify** (full-track listening/browsing tier, driven via the desktop app). Own-library files also accepted if he drops them in |
| **Design approval** | All 4 sections (§2–§5 below) approved individually 2026-07-08 |

**Prior art this stands on:** the 2026-07-07 adversarial audit — 8 subsystems, 27
findings, 19 CONFIRMED + 2 plausible, root cause = *trust comes from the INPUT (mic vs
MIDI), not from intent*. Full diagnosis: [[(C) v3.3 Reframe — Diagnosis, Decisions & Plan]].
That doc's §7/§8 were never generated (session cut off); **this doc replaces them.**

---

## <a name="arch"></a>§2 · Design — architecture: the InputMode gate ✅ approved

**One new concept: `CoachSession.input_mode` → `"mic" | "midi"`.**
- **Auto-detected**: a MIDI device connected *and sending notes* ⇒ `midi`; else `mic`.
- Shown as a **mode chip** in the UI; overridable by voice ("switch to MIDI mode").
- Lives in ONE place. Four chokepoints consult it **at their entrance**:

| Chokepoint | `mic` (default) | `midi` (toggle) |
|---|---|---|
| **Verdict builder** (`server._final_verdict`) | Follow-along only: "followed you through m.X" — never asserts wrong notes, never grades | Full precise verdict (existing v3 path, untouched) |
| **Drill loop** (`coach/reploop.py`) | Reps counted from **his voice**; passive listening only corroborates ("sounded about right") | Existing graded rep loop, clean-gate, tempo ladder |
| **Scheduler writes** (`update_from_drill`, history) | **Never writes from heard data** — only what he *said* happened | Writes as today |
| **Diagnosis** (`coach/analyze.py`, `coach/methods.py`) | Only what the mic hears well: pulse/timing trends, dynamics (RMS), coverage — and only when asked or clearly confident | Full note-level diagnosis |

**The mic listening contract** (working assumption: **50% of heard notes are wrong** — his words):
- Passive follow-along localization **stays** (cursor tracking, "you're at m.492" — genuinely useful).
- May **soft-guess** ("that sounded like the coda — right?") but **never asserts an
  error, never blocks progress, never nags.**
- **Speech throttle + dedup at the voice layer** — identical consecutive lines
  suppressed; one utterance per state transition. Kills the spam *class*, not instances.
- **No barge-in-by-playing while the coach speaks a drill/tracker line** (barge-in by
  *talking* stays). He has no headphones on an acoustic — the coach's own TTS is in the
  room mic; while the coach speaks, mic onsets are ignored for tracking/grading (TTS-bleed guard).

**Stays 100% intact:** score parser, OSMD annotated score + drawing moat, PDF toggle,
screen awareness, Today's Session/History live docs, Gemini Live voice stack
(`gemini-3.1-flash-live-preview`, thinkingBudget 0), the whole MIDI precise path.

---

## <a name="tools"></a>§3 · Design — the verbal toolset ✅ approved

All voice tools registered with Gemini Live (the mechanism `show_pdf`/annotation already use).

### 🔢 Rep tracker on demand
- "100 reps of m.492" → named counter. **He counts** ("one… two…" / "that's 12 done") —
  never counted from audio.
- "I did a bunch without counting, call it 20" → trusted, logged 20; passive listening
  may add "sounded like roughly that, yeah."
- **Custom ladders**: "every 10 reps bump the metronome +4 toward ♩=96" → it runs the
  ladder, announces rungs.
- Counters persist mid-session: "where am I on the LH jumps?" → "34 of 100."

### 🎼 Metronome on demand
- All verbal: "metronome 72" / "offbeat clicks" / "accent every 3rd" / "woodblock
  sound" / "stop." Web metronome gains offbeat/subdivision/accent/sound options.
- Click-vs-note filtering fixed at the source (`app.js:774` take-clock bug) so its own
  click never pollutes listening.

### 📋 The organizer (replaces paper — the #1 stated use)
- **Open**: greet, recall resume point + goals, "what are we doing today?"
- He narrates → it structures: "this spot is hard, note it" / "I got the LH jump wrong"
  / "m.517 fingering solved" → per-piece memory + Today's Session, timestamped.
- **Goals with deadlines**: "memorized by Aug 1" → tracked. **Close**: "what did you
  get done?" → reconciles vs the plan, seeds tomorrow.
- Ask-anything recall: "when did I last work the coda? what did I say?"

### 📚 Knowledge-grounded suggestions (advice, never note-grading)
- "m.517 RH is trouble — how do I practice it?" → reads the **actual score** (existing
  parser), pulls from [[classicalpianodumpknowledge]] + the Drill Library + named
  credible sources → ONE specific drill. Recognizes when advanced techniques fit vs
  plain "slow + dotted rhythms ×10."
- Knows his context: NEC-prep, **pulse is the teacher-flagged #1 problem**, his hand notes.

### 🧹 One-time memory reset (Phase 1 step)
- All "problem spots"/tiers/hard-spot data derived from *heard* audio →
  **archived to `data/archive/pre-v4/` (never deleted), then cleared.** It was
  collected by an app that misheard him.
- First v4 session = **verbal re-intake**: "walk me through the piece — what's actually
  hard right now? goals? deadlines?" → the new baseline is what HE says.

---

## <a name="music"></a>§4 · Design — musicality: references + media ✅ approved

### 🎧 The reference library (per piece, built lazily)
- "Get me recordings of the Scherzo" → find 2–4 canonical interpretations
  (Rubinstein, Pollini, Argerich…) via **yt-dlp** → local `data/references/{piece}/`.
- **The key step:** run each through the existing ByteDance transcription + score
  alignment **once, offline** → a **measure→timestamp `map.json`** per recording.
- From then on: *"play how Rubinstein does m.492–516"* → instant local fragment
  playback, score cursor following along.
- **Coach-initiated demos**: when making a musicality point ("this should breathe at
  the phrase end") it *plays* those exact bars from a real pianist. **Never synthesized audio.**
- **Spotify tier**: "put on the Argerich recording" → drives the Spotify **desktop app**
  (AppleScript play/seek) for full listens + browsing interpretations. yt-dlp copies are
  the analyzable/clippable tier.

### 📈 Sound comparison — honest about the mic
- Compares ONLY what the mic hears well: **tempo curve** (rubato shape), **dynamics
  arc** (RMS), **phrase timing/breathing**. **Never note accuracy.**
- "Compare my last take to Rubinstein" → side-by-side tempo/dynamics curves over the
  same bars on screen + a verbal read ("he stretches beat 1 of m.493 far more; your
  crescendo peaks two bars early"). Reuses existing analysis machinery, pointed at
  references instead of at judging him.

### 🎬 Technique media
- "Show me what rotation looks like here" → find a real demonstration (yt-dlp search)
  → download → **ffmpeg-clip the exact seconds** → show inline in the app (autoplaying
  local video, **not a YouTube link**). Images = stills from video frames.
- Cached in `data/media/`, logged to the session doc (what was shown, for what),
  evictable later — his "use it, mark it, delete it" rule.

### 🧠 8GB reality
Reference transcription = one-off batch job per recording, run staggered like model
warm-up. Playback/clipping trivial. **Nothing new resident in memory during lessons.
No local LLM, ever** (v2 lesson).

---

## <a name="phases"></a>§5 · The phases ✅ approved

> Every phase ends the same way: **validate green → live Steinway check → all four
> generalized docs + NOTES.md updated → commit.** Each is independently usable;
> Christian can stop after any phase.

| Phase | Ships | Kills |
|---|---|---|
| **0 · Stop the bleeding** *(hours — land before anything else)* | Speech throttle + dedup; no play-barge-in during coach speech; turn serialization; scheduler gated off mic; memory-wipe race fixed; pain-word goal fix; double-render + double-`start_drill` fixes; **detox `schedule.json`** (archive poisoned entries, e.g. m.691–698) | 8 bugs + the poison |
| **1 · The gate** | `InputMode` + 4 chokepoints; mic verdict = follow-along only; drills verbal-first; window/segmentation/fabrication/false-pulse/phantom-tempo paths become MIDI-only or fixed; **memory reset + verbal re-intake** | 8 bugs |
| **2 · Verbal toolset** | Rep counters + ladders; metronome-on-demand; organizer (goals/deadlines/open/close); knowledge-grounded drills | 1 bug (escalation layer becomes reachable) |
| **3 · Musicality** | Reference library + measure maps; fragment playback + coach demos; tempo/dynamics comparison; Spotify tier | — |
| **4 · Media + MIDI polish** | Inline technique clips; the 2 lurking MIDI bugs; metronome click-clock fix — the toggle is truly ready | 4 bugs |

### 📝 Auto-doc rule (his wishlist #6 — a process rule, not a feature)
A `docs_check.py` script in the repo fails a phase if the `doc_updated:` frontmatter of
[[(C) Coach App — How It Works]], [[(C) PianoCoach — State & Roadmap]],
[[(C) PianoCoach — Version History]] (and the hub, when touched) lags the latest
commit date. Docs can no longer drift from code — the thing that bit v2.

---

## <a name="bugs"></a>§6 · Bug→phase checklist — all 21 findings

> From the audit appendix in [[(C) v3.3 Reframe — Diagnosis, Decisions & Plan]].
> This is the working checklist; tick as each lands. `sev`: 🔴 critical · 🟠 major · 🟡 plausible.

### Phase 0 — stop the bleeding (8)
- [ ] 🟠 `server.py:1082` — every fragment speaks, no throttle/dedup → *suppress identical consecutive lines; speak only on state transitions*
- [ ] 🟠 `server.py:983` — barge-in-by-playing cuts the coach's own verdict → *no onset barge-in while coach speaks (drill/tracker lines); talking still interrupts*
- [ ] 🟠 `server.py:941` — no turn serialization; prescription + verdict fuse → *don't inject a new line until the prior turn completes*
- [ ] 🟠 `server.py:1111` — mic drill summaries poison the scheduler (0-clean → spot self-promotes to #1 forever) → *gate `update_from_drill` on input mode / self-report; mic → session doc only*
- [ ] 🟠 `memory.py:59` — fixed `.tmp` path + concurrent writes silently WIPE per-piece memory → *`tempfile.mkstemp` + per-piece write lock + back up a corrupt file, never overwrite*
- [ ] 🟠 `server.py:637` — a goal containing sore/tired fires a false safety-stop and drops the goal → *capture the goal regardless; require first-person present-tense pain phrasing to stop*
- [ ] 🟠 `web/app.js:740` — every drill line rendered twice → *only the coach_spoken/coach_done stream drives the buffer*
- [ ] 🟠 `server.py:716` — `start_drill` not idempotent; speaks twice, orphans a session → *debounce; duplicate = no-op or respec*
- [ ] 🧹 **Detox `data/schedule.json`** — archive mic-poisoned entries to `data/archive/pre-v4/`

### Phase 1 — the gate (8)
- [ ] 🔴 `reploop.py:101` — clean mic (35–52%) < 0.5 gate → "take your time" forever; drill unwinnable → *mic drills don't gate on note-match at all (verbal-first)*
- [ ] 🔴 `engine.py:145` — `is_clean()` needs ZERO missed notes; mic drops ~half → *mic never gates cleanliness on note count (self-report/coverage instead)*
- [ ] 🔴 `analyze.py:76` — reports 30–55% miss on perfect mic playing → *on mic report only coverage/pulse/dynamics; never missed/wrong*
- [ ] 🟠 `stream.py:359` — 12s graded window < an 8-bar cell; breaks even flawless MIDI reps → *derive window from the silence-bounded span / range × tempo*
- [ ] 🟠 `stream.py:344` — 1.5s silence = a new "rep"; slow careful practice chopped up → *no audio-segmented graded reps on mic; verbal boundaries*
- [ ] 🟠 `align.py:336` — fabricates "you played A4 instead of G3" by zipping unrelated pitches → *substitution only when leftover pitches are near (few semitones) + same hand; else missed + extra*
- [ ] 🟠 `analyze.py:117` — mic timing jitter → false "you're not counting the rhythm" (gaslights his #1 real problem) → *suppress timing_sd/rhythm diagnoses on mic, or widen by the measured noise floor*
- [ ] 🟠 `methods.py:144` — phantom 374/548-bpm reading → false "too fast, slow down" → *no tempo-based manner checks on mic; bound implausible readings*

### Phase 2 — verbal toolset (1)
- [ ] 🟠 `reploop.py:171` — auto-backup/rung-down/escalation dead on mic (needs a graded miss) → *trigger from self-reported misses / repeated struggle in the verbal flow*

### Phase 4 — media + MIDI polish (4)
- [ ] 🟠 `server.py:1407` — a MIDI lesson gives NO verdict when he just plays → *MidiTake trailing-silence auto_stop + re-arm (port the mic pattern)*
- [ ] 🟠 `midi_in.py:315` — MIDI localizes to the wrong recap, records as green-truth → *port mic finalize's grade-every-candidate + earliest pick*
- [ ] 🟡 `midi_in.py:315` (recap variant) — confirm the fix covers repetitive-material localization
- [ ] 🟡 `web/app.js:774` — metronome clicks on a lesson-cumulative clock vs per-phrase take → clicks transcribe as wrong notes → *send click times relative to the take's sample origin*

---

## <a name="data"></a>§7 · Data model ✅ approved

| Data | Where |
|---|---|
| Rep counters + ladders | Session state → flushed into Today's Session + per-piece coach-memory |
| Goals + deadlines | Structured block in `(C) coach-memory {piece}.md` |
| Reference recordings | `data/references/{piece}/` — audio/video + `map.json` (measure→timestamp per recording) |
| Technique clips | `data/media/` cache; usage logged to the session doc; evictable |
| Pre-v4 poisoned data | **Archived** to `data/archive/pre-v4/` — never silently deleted |

---

## <a name="validation"></a>§8 · Validation — the honest bar ✅ approved

- **`validate_v4.py`** extends the v3 harness. New cycles, in order of importance:
  1. **The lived failure**: a clean mic take inside a drill → **zero nags, zero
     scheduler writes, counter moves only on his voice.**
  2. Spam throttle (repeat fragments → one utterance).
  3. Memory concurrency fuzz (parallel writes → no wipe, corrupt file backed up).
  4. Pain-word goal ("the run that makes my wrist sore") → goal logged, no stop.
  5. Ladder math (reps → rung announcements at the right counts).
  6. Reference map accuracy (known recording → measure timestamps within tolerance).
- **selftest.py** stays green (43/43 + new cycles); `validate_v3` cycles must not regress.
- **The real bar: a live test on the Steinway before any phase is called done.**
  Synthetic tests did NOT catch the v2 silence/wrong-measure bugs — never trust them alone.

---

## <a name="prompt"></a>§9 · 🚀 THE MASTER BUILD PROMPT

> Paste everything in this section into a fresh Fable 5 (Claude Code) session on this
> Mac — or hand it to the current session — to execute v4. It is self-contained given
> vault + repo access.

```
Build PianoCoach v4 (the "CodaKiller" app at ~/piano-coach/).

CONTEXT — READ FIRST
- The complete approved spec is the vault doc:
  "Piano Practice/CodaKiller/v4/(C) v4 — Design, Plan & Build Prompt.md".
  Follow it exactly: §2–§4 design, §5 phases, §6 bug checklist, §7 data, §8 validation.
- Diagnosis background (19 confirmed bugs, root cause):
  "Piano Practice/CodaKiller/v3/(C) v3.3 Reframe — Diagnosis, Decisions & Plan.md".
- Technical reference (accurate to v3.2 code):
  "Piano Practice/CodaKiller/(C) Coach App — How It Works.md" + repo NOTES.md (gotchas).
- Christian: NEC-prep pianist, plays a Steinway ACOUSTIC through a mic (no MIDI,
  none coming). A clean mic take transcribes at 35–52% accuracy. Therefore: ON MIC,
  NEVER GRADE NOTES. He counts his own reps by voice. The app is a verbal practice
  tracker + organizer with lenient follow-along listening. MIDI mode keeps the
  precise brain intact behind a toggle.

HARD RULES
1. Phases land IN ORDER (0 → 4). Phase 0 first, same day — it stops active harm.
2. Every phase: implement → validate_v4 + selftest green → LIVE check → update ALL
   generalized vault docs (How It Works, State & Roadmap, Version History, hub if
   touched) + NOTES.md → commit. docs_check.py (build it in Phase 0) enforces the
   doc freshness; a phase is NOT done while it fails.
3. Every non-trivial slice gets a fresh-context adversarial review (a subagent tries
   to refute the change / find what it breaks) BEFORE it counts as done. The v3.2
   MIDI-cutoff miss was caught exactly this way.
4. The InputMode gate lives in ONE place (CoachSession); chokepoints check it at
   their ENTRANCE. Do not scatter mic/midi conditionals through call sites.
5. Never touch the MIDI precise path except where §6 names it (Phase 4).
6. Archive, never delete: poisoned scheduler/memory data goes to data/archive/pre-v4/.
7. 8GB M2 rules: no local LLM ever; stagger model loads; reference transcription is
   a staggered offline batch job, never during a lesson.
8. Repo gotchas (NOTES.md has more — read it): `python server.py` starts nothing
   (use venv/bin/uvicorn server:app --port 8765); kill stale servers first
   (lsof -ti:8765 | xargs kill -9); bump the web cache-bust ?v=N whenever touching
   style.css/app.js/annotate.js; WKWebView has no PDF plugin (use <img> stacks);
   score cache doesn't invalidate on parser changes (bump CACHE_VERSION).
9. New deps (yt-dlp, ffmpeg) via brew, install without asking. Media/references are
   for Christian's personal study; clips are cached locally, logged, and evictable.
10. Commit messages end with the Claude Co-Authored-By line. Update
    "(C) PianoCoach — Version History.md" §v4 as phases ship.

DEFINITION OF DONE (v4 overall)
- All 21 checklist items in spec §6 ticked, each verified by a test or a live check.
- validate_v4 cycle 1 passes: a clean mic take in a drill produces zero nags, zero
  scheduler writes, and the rep counter moves only on Christian's voice.
- He can run a full practice session hands-free by voice: open (recall + goals),
  rep counters + ladders + metronome, notes/marks captured, close (reconcile + seed
  tomorrow) — with the app never once asserting he played a wrong note on mic.
- "Play how Rubinstein does m.492" works measure-accurately on the Scherzo, and a
  tempo/dynamics comparison of his take vs a reference renders on screen.
- MIDI toggle verified with a synthetic MIDI stream (no hardware): precise path
  intact, its 2 lurking bugs fixed.
START: Phase 0.
```

---

## <a name="open"></a>§10 · Open items (not blocking)

1. **🎤 Mic upgrade** — recommended: a ~$100 USB condenser (e.g. an AT2020USB-class
   mic) placed near the piano. Won't make note-grading viable (model ceiling), but
   raises the floor for localization, pulse/dynamics analysis, and reference
   comparison. Buy any time; zero code depends on it.
2. **☁️ Off-disk git remote** — still missing (needs `gh auth` — Christian). Losing
   the disk loses the repo. `brew install gh && gh auth login` →
   `gh repo create piano-coach --private --source=. --push`.
3. **🎼 PDF-only pieces** — Étude Op.10/4 + Prokofiev still need MusicXML to be live
   in the app (unchanged from v3).

---

*Design approved section-by-section by Christian, 2026-07-08. This doc supersedes the
empty §7/§8 of the v3.3 Reframe doc. Next action: run [§9](#prompt) — Phase 0 today.*
