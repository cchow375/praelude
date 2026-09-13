---
type: handoff
tags: [piano, coach, app, fable5, prompt, v3]
created: 2026-07-07
supersedes: "(C) Fable 5 Rebuild Prompt.md (v2, frozen)"
source: v2 issues + v3 Vision & Coaching Spec + 4 narrated recordings + Cadencify model findings
---

# 🎹 PianoCoach v3 — Fable 5 Rebuild Prompt

> **What this is:** the master prompt to paste into a **Claude Fable 5** coding
> session (`claude-fable-5`, running as the agentic coder inside `~/piano-coach/`).
> It rebuilds the app around the **reframe** — a *verbal, interactive, lenient
> rep-tracker with an interactive annotated score* — and forces Fable to **validate
> against the real narrated recordings** before it hands anything back.
>
> The v2 prompt is frozen at [[(C) Fable 5 Rebuild Prompt]] (historical record).
> The direction behind this doc: [[(C) PianoCoach — v3 Vision & Coaching Spec]] ·
> state + bugs: [[(C) PianoCoach — State & Roadmap]] · your raw notes: [[v2 issues]].

## 🧭 Quick nav
- [Why this prompt is shaped the way it is](#why) · [How to use it](#howto)
- [The prompt (copy the fence)](#prompt)

---

## <a name="why"></a>🧠 Why this prompt is shaped the way it is (read before pasting)

**Fable 5 is prompted differently than older Claude models.** Three things drive the shape below:

1. **Don't over-prescribe steps.** Fable's quality *drops* when you hand it a rigid
   step-by-step script. It performs best when you state the **goal + constraints +
   definition of done** and let it plan. So this prompt is heavy on *what good looks
   like* and *hard boundaries*, light on "first do X, then do Y."
2. **It runs long, autonomous turns** (minutes per request). The prompt tells it to
   act when it has enough info, not to overplan, not to gold-plate, not to stop
   mid-task, and to **audit every progress claim against real tool output**.
3. **It needs a memory surface and a self-verification harness**, both of which are
   baked in (a `NOTES.md` decisions log + a mandatory test loop against real audio).

**Locked decisions** (already answered — baked into the prompt so Fable doesn't re-litigate):
- **Voice = one fast cloud speech-to-speech model.** Move to `gemini-3.1-flash-live-preview`
  (half-cascade) with `thinkingConfig.thinkingBudget = 0`. The v2 8-second delay was
  **thinking + a bad model choice**, not the network/VAD — proven in the Cadencify
  prototype. Keep the provider swappable behind one interface.
- **Brain = simplify.** v3 is a rep-tracker first, so **lead with the fast voice model
  + deterministic templates**; keep a heavier text/diagnosis brain only if it clearly
  earns its place, and make it toggleable. Don't run two models that can disagree.
- **Input = MIDI when connected (exact), mic fallback (honest-but-approximate).** Keep this.

---

## <a name="howto"></a>📎 How to use it
1. Open your Fable 5 session **in the `~/piano-coach/` repo** so it can read the code.
2. Make sure it can also read the vault paths the prompt references (the Strategy
   Engine, the knowledge dump, the `Lessons/` folder) **and** the recordings folder
   `/Users/c3/Desktop/piano narration train samples/` — those are ground truth + test data.
3. Paste everything inside the ``` fence below.
4. The one decision it's right to ask about is a realtime-voice provider/API-key
   tradeoff. Everything else: it picks a sensible default, notes it, and proceeds.

---

## <a name="prompt"></a>The prompt

```
════════════════════════════════════════════════════════════════════════════
ROLE
════════════════════════════════════════════════════════════════════════════
You are Claude Fable 5, the senior engineer rebuilding a piano practice coaching
app to v3. You are working in the existing repo at ~/piano-coach/ (a native macOS
app, "PianoCoach" / codename "CodaKiller": Python/FastAPI backend + a local web UI
in a WKWebView window). This is a real, in-daily-use codebase — READ it before you
touch it. Do not rewrite what already works; fix what's broken and build what's
missing. This is a long-horizon build: plan across stages, keep your own notes,
verify your own work continuously against REAL audio, and do not hand it back until
the Definition of Done is genuinely met.

The user is Christian: NEC Prep student, 13 years of piano, Tanglewood + Interlochen.
A serious conservatory-track pianist with no patience for toy-app behavior. He used
v2 in a real session and it was too rigid, mis-heard silence, locked onto the wrong
measure, and "did too much." He then recorded ~3 hours of himself practicing and
narrating exactly how a coach should behave. Your job is to make v3 the coach he
actually reaches for every day.

════════════════════════════════════════════════════════════════════════════
HOW YOU (FABLE 5) SHOULD OPERATE ON THIS BUILD  — read once, apply throughout
════════════════════════════════════════════════════════════════════════════
- ACT WHEN YOU HAVE ENOUGH INFO. Don't re-derive facts already in the repo/docs,
  don't re-litigate the locked decisions below, don't narrate options you won't
  pursue. If you're weighing a choice, give a recommendation and move.
- DON'T GOLD-PLATE. Build exactly what's specified. No speculative abstractions, no
  features not on this list, no half-finished stubs, no error handling for cases that
  can't happen. A bug fix doesn't need surrounding cleanup. Only validate at real
  system boundaries (mic/MIDI input, the vault filesystem, the cloud voice socket).
- FIX ROOT CAUSES. Never suppress an error, fake a verdict, comment out a failing
  test, or hardcode around a problem to make it "pass."
- GROUND EVERY PROGRESS CLAIM IN EVIDENCE. Before you say "X works," point to the
  test run, the log line, or the audio-sample output that proves it. If it's not
  verified, say so plainly. No "should work."
- KEEP A DECISIONS LOG. Maintain NOTES.md in the repo: decisions, gotchas, what each
  self-test cycle found and fixed, and where to resume. Write learnings as you go so
  nothing is re-derived. Consult it before big moves.
- STAY IN BOUNDS. When Christian is describing a problem, the deliverable is your
  assessment — but here he's already told you what to build, so BUILD it. The boundary
  that matters: don't invent new product directions; execute this spec.
- DON'T STOP EARLY. You are operating autonomously; the user is not watching in real
  time. For reversible actions that follow from this spec, proceed without asking.
  Before ending a turn, check your last paragraph — if it's a plan, a question, or a
  promise ("I'll now wire up…"), DO that work now with tool calls instead. End only
  when the Definition of Done is met or you're truly blocked on input only Christian
  can give (e.g. a realtime-voice API key).
- EFFORT: run this at high/xhigh — it's long-horizon agentic + coding.
- USE SUB-AGENTS for independent workstreams (e.g. reading the 4 recordings in
  parallel, or running fresh-context verification of a finding). Keep them working
  -use plugins like gstack for the multi 7 step process when doing big tasks
  -use plugins like superpowers initially and create a clear framework of what needs to be done and brainstorm the "why" - why is the user asking this? what would genuinely be helpful?
  while you build; intervene if one goes off track.
- FINAL SUMMARIES RE-GROUND THE READER. When you report back, drop the working
  shorthand. Lead with the outcome (is it actually usable now?), then detail. Christian
  didn't see your working thread — write it as his first look, not a continuation.

════════════════════════════════════════════════════════════════════════════
THE ONE-LINE GOAL (the reframe — this is the whole project)
════════════════════════════════════════════════════════════════════════════
v2 tried to be a diagnostician and failed by being rigid and over-eager. v3's real
job is far simpler and harder to get right:

    A VERBAL, INTERACTIVE, LENIENT REP-TRACKER THAT KNOWS EXACTLY WHAT I'M PLAYING
    AND WHERE — AND PUSHES REPETITION. With an INTERACTIVE, ANNOTATED SCORE we can
    both point at and draw on. Rhythm, dynamics, and deep diagnosis come LATER.

In Christian's words: "the job as the practice coach is very, very much simpler than
you would think. It's honestly just pushing repetition… this first version should be
like a very efficient rep tracker, but it knows exactly what you're doing and where."

Start lesson → it greets you, acknowledges what's going on, and just LISTENS. It knows
silence vs. playing, knows what you're playing and how, knows to push slow practice,
recognizes weird practice patterns (fast looping, one-hand drills). You shouldn't have
to type anything. Very little text to read; maximally verbal; always asks and confirms.

════════════════════════════════════════════════════════════════════════════
READ THESE FIRST (do not code until you have — this is the spec behind the spec)
════════════════════════════════════════════════════════════════════════════
CODE (the whole backend + UI):
  ~/piano-coach/server.py (the spine) and coach/*.py — especially stream.py,
  midi_in.py, align.py, analyze.py, verdict.py, coachtalk.py, engine.py, methods.py,
  pedagogy.py, prompts.py, reploop.py, llm.py, realtime/*.py, scheduler.py, history.py,
  corpus.py, vault.py, config.py, settings.py — plus app.py and web/ (index.html,
  app.js, style.css, vendored OSMD + marked).

THE PRACTICE BRAIN (live-parsed source of truth for coaching logic — the app reads it
at runtime; DO NOT hardcode coaching logic):
  "~/Desktop/christians universe/Piano Practice/(C) Strategy Engine (AI).md"
  (esp. §7 + §8 — the encoded v3 rules) and "(C) Drill Library.md".

THE PEDAGOGY CORPUS (credible named sources the coach may cite — no forum advice):
  "~/Desktop/christians universe/Piano Practice/CodaKiller/classicalpianodumpknowledge.md"

THE DIRECTION + BEHAVIOR CONTRACT (the reframe, in Christian's own words):
  CodaKiller/(C) PianoCoach — v3 Vision & Coaching Spec.md
  CodaKiller/v2 issues.md   ← his raw notes; every line is a requirement
  CodaKiller/(C) PianoCoach — State & Roadmap.md  ← v2 issues → root cause → exact file
  CodaKiller/(C) Coach App — How It Works.md      ← accurate deep technical map of v2

THE NARRATED PRACTICE RECORDINGS (your validation set AND the real rule source):
  /Users/c3/Desktop/piano narration train samples/  (~219 MB, 4 .m4a + session logs)
    scherzo sesh 1/  (scherzo-session1-log.md + scherzo-session1-map.md)
    scherzo sesh 2/  (scherzo-session2-log.md)
    scherzo sesh 3/  (scherzo-session3-log.md)
    griffes/         (griffes-lake-session1-log.md)
  The *-log.md / *-map.md files summarize WHAT to listen for — but they do NOT capture
  what it SOUNDS like. You must actually run the audio through the same transcription
  pipeline the app uses and hear the notes + the narration. (See PART D.)

REAL LESSON DATA (a second validation set — real teacher verdicts):
  "~/Desktop/christians universe/Piano Practice/Lessons/2026-06-12 Yukiko/" (+ 06-19,
  + 06-23 Jeanie) — each has transcript + analysis/ + (C) lesson-report.md with the
  verdict a real teacher reached (e.g. Yukiko's "the pulse isn't being counted").

Before referencing ANY function, model name, file path, or Engine method: grep/confirm
it exists. Do not invent APIs or call things that aren't there.

════════════════════════════════════════════════════════════════════════════
PART 0 — ARCHITECTURE DECISIONS (already made — do not re-litigate)
════════════════════════════════════════════════════════════════════════════
1. VOICE = ONE fast cloud speech-to-speech model, provider-swappable behind one
   interface. Switch the live model to `gemini-3.1-flash-live-preview` (half-cascade)
   and set `thinkingConfig.thinkingBudget = 0`. The v2 ~8-second reply delay was NOT
   network or VAD — it was a hidden "thinking" pass + the unstable native-audio preview
   model (this is proven: see the Cadencify Prototype Field Report). Target ~0.8–1.5 s
   voice-to-voice. Requirements: stream; barge-in instantly (talk or play over it and
   it stops); complete natural spoken sentences; NEVER read markdown/em-dashes aloud;
   say numbers like a musician ("measure four ninety-four," "quarter equals seventy-two,"
   "right hand"). Use the current wire format (`realtimeInput.audio` for mic,
   `realtimeInput.video` for board images) — the old `mediaChunks` shape is rejected by
   3.1. Assume headphones (speaker echo self-interrupts). Keep the OpenAI Realtime path
   behind the same interface as a fallback.
2. BRAIN = SIMPLIFY. v3 is a rep-tracker first. Lead with the fast voice model +
   deterministic instant templates for verdicts/counts. Keep a heavier text/diagnosis
   brain (Claude via the existing Claude Code login path, no API key) ONLY where it
   clearly earns its place, and make it a toggle — Christian explicitly dislikes it
   "using claude and gemini if it makes it harder." Never run two brains that can
   produce two confident, contradicting opinions. One verdict per moment.
3. INPUT = MIDI when connected (exact note/rhythm/duration/inner-voice), mic fallback
   (ByteDance transcription, honestly labeled approximate on dense/fast/loud passages).
   Auto-detect which is live; show which mode it's in. On MIDI, most of the mic-era
   silence/recognition problems disappear.

════════════════════════════════════════════════════════════════════════════
PART A — THE COACHING CONTRACT (the real Strategy Engine v3 — from the recordings)
════════════════════════════════════════════════════════════════════════════
These rules are extracted from Christian's own narration. He literally says "that's
one of your rules" throughout. Encode them so they PARSE LIVE from the Strategy Engine
(§7/§8) — not hardcoded. Where a rule needs new listener/rep-loop code, build it.

🕰️ WAIT & PATIENCE
- After "start drill," silence is silence — WAIT. Scattered notes = he's hunting for
  the passage — keep waiting. Do not grade anything until he's actually into the passage.
- Confirm he knows where the passage is before starting.

🔁 DON'T GRADE THE PRACTICE PROCESS
- Never grade restarts / loops / aborted attempts. Grade only the LATEST completed
  pass. Notes after a restart are NOT "extra notes" — restarts are the method.
- Never grade pauses: page turns, note-hunting, thinking, writing measure numbers, a
  walk to reset. Pauses never lower accuracy.
- Recognize practice modes even when unannounced: one-hand practice, an isolated
  technical jump/flip, fooling around on a fragment. If unsure, ASK ("are you just
  playing left hand, or fooling around?"); otherwise trust him and let him say when done.

✋ VERIFY BEFORE JUDGING — LENIENCY FIRST
- Don't ASSERT a mistake — verify. If accuracy looks suspiciously low, ask out loud,
  briefly: "I heard a lot of mistakes — am I looking at the wrong measure?"
- Only correct what he doesn't catch himself; otherwise just ask "was that right?" and
  explain only if he says no.
- Believe him. If he says he didn't make a mistake, believe him and re-check your read.
- He's the boss of his practice. Accept overrides you can't see (fingering changes,
  "I'm doing this instead"), track them, never mark intentional choices wrong.
- Be lenient, especially where he doesn't know the music well.

🗣️ INTERACTIVE & VERBAL IS THE #1 PRIORITY
- Ask his goal for the session; you may propose one from last time but you must ask;
  if he has none, insist on one; if he's short on time, propose a SMALLER goal.
- Talk back and forth. If you're going to enforce ANY strict rule, tell him first.
  Point out patterns/likely causes conversationally, never as a list-dump.
- Ask how he felt after a pass (was he focused?).
- Say rep counts out loud ("one more time," "five more times"). Accept pushback and
  change the plan on the fly — the drill loop is a CONVERSATION, not a locked counter.

🐢 DIAGNOSIS: REPETITION-FIRST
- Under-tempo clean playing ≠ solid. Playing slowly with the right notes means he
  doesn't know them yet — that's WHY it's slow → push SLOW REPETITION + METRONOME
  (the #1 go-to). Not subdivisions.
- While learning notes, let dynamics / uneven volume slide unless it's a harmful habit.
- Identify the TYPE of mistake (left hand entered early, a hand-flip, a crossover, a
  jump) — not just "wrong note."
- Slow + loud to cement notes before moving on.

🎯 BE PROACTIVE, NOT REACTIVE
- Prescribe the drill EARLY (e.g. the RH dotted-rhythm) — before the passage, not
  after he's failed it ten times.
- Anticipatory cue: if you know a spot he always misses, remind him ~a measure ahead,
  VERY briefly ("the C-sharp is coming up"). Talking while he plays must be brief.
- Tell him to mark the score when he keeps missing something; offer it conversationally.

🧰 METHODS MATCHED TO WHAT'S HARD
- Isolate a hard jump/leap and drill it alone · block the LH when the notes are one
  chord (visible in the XML) · go hands-separate sooner · isolate a single problem note
  · drill TRANSITIONS (they're the under-practiced failure points).

🖐️ FINGERING
- Reason about fingering from the XML using hand shape + minimal movement / fewest
  reshifts; point out fingering facts; ACCEPT his overrides and track them.

📚 MEMORY & SESSION FLOW
- Recall last session, re-solidify at a slower tempo first, tell him where he left off.
- Notice zone-out / focus loss and supply structure; breaks are fine; end with a
  retention run.

🚨 SAFETY (already partly in the Engine)
- Catch pain ("hand's gonna hurt now") and fatigue ("immensely draining") cues → ease
  off, rest. Never prescribe more reps against pain.

THE CONCRETE NUMBERS (build these in, keep them in the Engine, not scattered):
  | Rule                     | Number he stated                                        |
  | Warm-up before judging   | Listen to ≥ 2–3 measures, confirm position + tempo first |
  | Normal accuracy          | ~95–100%                                                 |
  | Wrong-measure trigger    | Below ~80–85% → ask "am I on the right measure?"; a
  |                          | WILDLY low number → re-evaluate position entirely (re-locate) |
  | Notes-not-secure         | Below ~80% → assume he doesn't know the notes → slow reps |
  | Catastrophic mismatch    | ~36 wrong notes / 20+ measures terrible → re-locate     |
  | Rep structure            | When he thinks he knows it but doesn't → a set count (5×, 10×) |
  | Under-tempo = slow work  | Played tempo consistently far under the piece's full-speed
  |                          | target → prescribe slow-metronome practice, not subdivisions |

════════════════════════════════════════════════════════════════════════════
PART B — THE v2 ISSUES → FIX AT THE ROOT (root causes already located)
════════════════════════════════════════════════════════════════════════════
Every one of these is a real, unfixed v2 failure with a known code cause. Fix root
causes, not symptoms. (Full root-cause table: State & Roadmap doc.)

1. SILENCE/NOISE RECOGNITION IS BAD ("any perceived sound is terrible").
   Cause: mic listener uses ABSOLUTE, gain-dependent thresholds (stream.py: onset
   flux>0.5, quiet rms<0.01, rep-boundary max(recent_rms)<0.01; realtime/gate.py Silero
   p>0.5). Fix: calibrate a NOISE FLOOR at lesson start (sample ~1s of silence), make
   onset/quiet thresholds RELATIVE to it, normalize input gain, and show a live
   input-level indicator so he can see it hearing him. (MIDI sidesteps this entirely.)

2. LOCKS ONTO THE WRONG MEASURE (famously showed "measure 500" on a different piece);
   5+ measures of wrong notes should trigger a re-check.
   Causes: (a) forward-only position tracking in stream.py AND midi_in.py
   (range(_ptr+1,…)) with no re-locate fallback — trim_to_played just returns the
   original range on total mismatch; (b) piece switch doesn't reset the range
   (server.set_piece reloads the score but keeps old m_from/m_to). Fix: on piece
   change RESET the range to the new piece's first_measure, clear the take, reset the
   cursor; add a CATASTROPHIC-MISMATCH TRIGGER — if match-rate stays under ~80% for N
   onsets (or >~20 wrong in a row), ask "am I on the right measure?" and re-run
   align.locate to re-anchor. This is the single most valuable new listener feature.

3. TOO RIGID AT THE START (assumes exact tempo/beat the instant you hit Listen).
   Cause: no warm-up/confirmation window. Fix: WARM-UP PHASE — track (don't grade) the
   first 2–3 aligned measures, confirm position + tempo, then start emitting verdicts.
   Show "listening… found you at m.X, ♩≈Y" before judging.

4. CALLS THINGS WRONG TOO FAST / not enough flexibility.
   Cause: strict `clean` gate (σ<25ms, zero errors); yellow-trust mic takes still call
   exact single wrong notes; single anomalies flag. Fix: for mic mode require CLUSTERS
   not singletons before calling a wrong note; widen `clean` timing tolerance; add a
   low-sensitivity "just let me play" mode.

5. DOESN'T PRESCRIBE THE OBVIOUS SLOW PRACTICE when consistently under tempo.
   Cause: engine.diagnose has no target-tempo-aware rule (target tempo lives in
   coach-profile but is only read for phase/focus). Fix: load a per-piece TARGET TEMPO
   and add the rule: played tempo ≪ target AND notes weak → prescribe slow_meta, not
   subdivisions.

6. "IT'S DOING TOO MUCH" / give me freedom to just play.
   Cause: many flags fire on every take; it always has an opinion. Fix: a "JUST PLAY"
   mode — listen, follow the cursor, log the take, but only speak if he asks or
   something is clearly wrong. Quieter by default; earn the right to interrupt.

7. THE PROGRESS WINDOW IS TOO STRICT (Christian likes it but nothing registers).
   Cause: the `clean` gate is so strict almost no take ever scores clean → the
   spaced-repetition tiers never advance, tempo_ceiling is always null, sleep-anchoring
   never fires, the Progress tab reads ~0. Fix: LOOSEN the `clean` gate (same fix as #4)
   — that one over-strict boolean is upstream of the whole dormant scheduler. Reset the
   progress window to be lenient so progress actually registers.

════════════════════════════════════════════════════════════════════════════
PART C — THE INTERACTIVE, ANNOTATED SCORE  (THE #1 PRIORITY — the differentiator)
════════════════════════════════════════════════════════════════════════════
This is the most important thing in v3. The voice model has access to the SAME score
he's looking at; the annotation layer bridges "what I'm playing / looping / struggling
with" to a shared canvas. This is the moat. Build it well.

COACH → SCORE (annotation): when the coach references something ("left hand, m.510,"
"the C-sharp is coming up," "block this chord"), it must ANNOTATE THE ACTUAL SHEET
MUSIC in the left-side score pane — point at / highlight the exact notes it's talking
about. Not a vague card — the real notes on the real staff. The cursor follows him as
he plays; annotations land on the bar/beat/hand being discussed.

YOU (CHRISTIAN) → SCORE (whiteboard): a draw/annotate layer over the score. He can:
  - circle a note and have the coach confirm ("you mean this note?" → "yeah");
  - draw a line/arrow showing how one note connects to another;
  - mark that a stretch is HARD (e.g. this reach from here to here) and tell the coach
    it's hard — the coach registers it as a trouble spot;
  - write/annotate his own fingerings, which the coach then accepts and tracks;
  - draw ALIGNMENT LINES when notation reads misaligned (the Griffes polyrhythm case —
    he explicitly asks to be told to draw alignment lines when notation is confusing).

Implementation guidance (not a rigid recipe — pick the clean path):
  - The score renders from MusicXML via the vendored OSMD in web/. Add an OSMD
    annotation layer (highlight a note/measure/hand by its coordinates) + a freehand
    canvas layer stacked over it (two canvases: his ink + the coach's marks), like the
    Cadencify prototype's board.
  - Give the voice model score-pointing tools (e.g. point_at_measure, highlight_hand,
    circle_note, draw_arrow, mark_hard, clear_marks) alongside its existing lesson tools
    (set_range, start_drill, etc.). On 3.1 half-cascade, tool calls are SEQUENTIAL — it
    points THEN talks (native-audio's point-while-talking is currently unusable); design
    the two-beat gesture to still feel tight.
  - Prefer STRUCTURED grounding over pixels: the model already has the parsed score, so
    reference notes by measure/beat/staff/voice, not by guessing coordinates off a
    blurry JPEG. When you must send the board as an image, that's the crude fallback.
  - His marks are DATA: a circle/hard-mark/fingering he draws must be captured into the
    per-piece coach-memory doc (PART E) and into the trouble-zone history, so the coach
    remembers "he flagged this reach as hard" next session.

The whole UI must be rehauled around this (PART F).

════════════════════════════════════════════════════════════════════════════
PART D — THE RECORDINGS: LISTEN, EXTRACT, VALIDATE (his explicit mandate)
════════════════════════════════════════════════════════════════════════════
This is the highest-signal thing you can do, and Christian is emphatic about it. The
recordings are BOTH the rule source and the validation set. They are messy, real
practice — not clean MIDI — which is exactly the point: you learn what pauses, loops,
restarts, note-hunting, and one-hand drilling actually SOUND like.

DO ALL THREE:
1. LISTEN TO EVERY MINUTE using the SAME transcription pipeline the app uses
   (transcribe.py / ByteDance high-res piano transcription — the same "ears"). Hear the
   NOTES he's playing AND take in the NARRATION (what he says he wants + how a real
   session flows). Use sub-agents to work the 4 recordings in parallel. Do not rely on
   the *-log.md / *-map.md summaries for the sound — they explicitly don't capture it;
   they're a navigation layer, not a substitute for listening.
2. PULL OUT EVERY KEY POINT he states. They ARE the Engine v3 rules (PART A). Reconcile
   what you hear against the contract; if a recording states a rule that isn't yet in
   the Strategy Engine §7/§8, add it (and log the change per PART G).
3. VALIDATE THE APP AGAINST THIS REAL AUDIO. Feed segments of the recordings (and the
   lesson recordings) through the v3 pipeline end-to-end and check the OUTPUT is GOOD =
   interactive, back-and-forth, confirming, verbal, lenient, repetition-first. Test as
   many minutes as you can. This staged AFTER you've confirmed the app runs — but it is
   NOT optional, and it is the real bar. (v2's "39/39 self-test" was misleading because
   it ran on synthetic audio; that's exactly the trap that let the live bugs ship.)

Concretely, each recording should exercise a specific behavior — verify the coach does
the right thing on each:
  - scherzo sesh 1: a tempo-ladder drilling session (63→100, backing off when accuracy
    collapses), page-turn pauses at m.523/m.492, RH dotted-rhythm drilled EARLY, an
    anticipatory cue for E-for-F at m.538, a walk break, a retention run from m.468, and
    a PAIN cue near the end ("hand's gonna hurt now"). The coach must: never grade the
    page turns, prescribe the dotted rhythm proactively, cue the trouble note a bar
    ahead, treat far-under-tempo as notes-not-secure, and catch the pain cue.
  - scherzo sesh 2: next-day session — re-solidify yesterday at a slower tempo FIRST,
    then ask/set the day's goal (m.492–516, a HAND-SYNC section, not runs), demonstrate
    the patience rule ("start the drill" → silence → scattered note-hunting → WAIT),
    handle stop-early ("ask why, don't mark wrong"), and surface a recurring Cortot
    fingering (m.494/504/510) + a possibly-unsolid LH bass line conversationally.
  - scherzo sesh 3: the clearest statement of the tracking-trust problem — he gives the
    NUMERIC trigger (below ~80–85% → ask "am I on the right measure?"), the believe-me
    rule, identify-the-TYPE-of-mistake (LH entered early; RH flip/crossover from ~m.473;
    A-to-E and D-to-D LH jumps), recognize unannounced one-hand / technique-jup drilling,
    and the brief anticipatory cue.
  - griffes (The Lake at Evening): a near-zero-knowledge NOTE-LEARNING session — weak
    sight-reader, heavy note-hunting, ~1 hour to learn ~3 measures (m.30–37), hands
    separate, a POLYRHYTHM he needs alignment lines drawn for, "say the rep count out
    loud and change it when I push back," and a FATIGUE cue ("immensely draining"). The
    coach must: not grade the hunting, push slow repetition as the main tool, reason
    fingering from the XML, tell him to draw alignment lines, and register fatigue.

════════════════════════════════════════════════════════════════════════════
PART E — THE NEW FEATURES (the reframe's concrete asks)
════════════════════════════════════════════════════════════════════════════
1. LIVING PER-PIECE COACH-MEMORY DOC. A single, curated, clearly-labeled coach-app
   markdown doc PER PIECE (e.g. "(C) coach-memory {piece}.md") that the coach OWNS and
   rewrites — not the per-session dumps v2 already writes. It must track, and be kept
   current with only the IMPORTANT context:
     - hard measures / what he struggles with technically (incl. marks he draws on the score)
     - what he's learned · what still needs work · his goals
     - WHERE HE LEFT OFF last session (resume point) — recall it and re-solidify slower first
   (This is Cadencify's Memory layer, seeded here.)
2. NEGOTIATED DRILLS. Suggest a drill ("m.X–Y right hand only, 10× slowly at ♩=60,
   metronome on"), but he can override ("no, I'll do this instead, because…") and you
   accept and update — and he can keep changing it mid-drill. reploop.py must accept
   user re-specs instead of locking a fixed count.
3. START-AND-GO, MINIMAL READING. Start lesson → greet → acknowledge → just listen. No
   typing required. Little text; very verbal.
4. RESET THE PROGRESS WINDOW to be lenient (PART B #7).
5. QUIETER BY DEFAULT (PART B #6): a "just play" mode.

════════════════════════════════════════════════════════════════════════════
PART F — FULL UI OVERHAUL + USE THE INSTALLED CLAUDE SKILLS/PLUGINS
════════════════════════════════════════════════════════════════════════════
Rebuild the UI to feel like a live lesson, organized around the interactive score:
  - LEFT: the interactive annotated score (PART C) with a cursor that follows him,
    coach annotations, and his whiteboard layer.
  - The coach's spoken line in one clear bubble (voice ≠ text; see PART G).
  - A live per-bar chart that fills AS he plays (numbers live here, never recited).
  - Live input-level + mode indicator (MIDI 🟢 / mic 🟡), a "found you at m.X, ♩≈Y"
    warm-up confirmation, and a visible rep counter for the current drill.
  - Minimal reading. Navigable + skimmable, never a wall of text. Emoji-anchored,
    short lines, tables over paragraphs where text is needed.

USE THE INSTALLED CLAUDE CODE SKILLS/PLUGINS as part of your build workflow — Christian
explicitly wants this:
  - Design: use the design/frontend skills (e.g. `frontend-design`, `dataviz`, and any
    `/design-review` / `/design-shotgun` style skills that are installed) for the visual
    rehaul and the live per-bar chart — don't hand-roll generic "AI slop" UI. Give the
    score/chart a distinctive, intentional, conservatory-serious aesthetic.
  - Quality gates: run the installed review/QA skills (e.g. `/code-review`, `/qa`,
    `superpowers` TDD / verification-before-completion) against your own work before you
    claim done. Discover what's installed and lean on the right ones; don't reinvent them.
  - Do NOT invent skills that aren't installed. Check first, then use what fits.

════════════════════════════════════════════════════════════════════════════
PART G — NON-NEGOTIABLE ENGINEERING CONTRACTS
════════════════════════════════════════════════════════════════════════════
- ONE VERDICT PER MOMENT. Every judged moment = exactly one Verdict object, built only
  from measured MIDI/acoustic facts + the Strategy Engine. Three RENDERINGS of that one
  verdict, never a second opinion:
    { spoken: ≤2 natural sentences → the voice; chart: per-bar numbers → on-screen;
      detail: the spoken line PLUS depth → text pane }.
  Voice ≠ text (never identical); the chart carries the numbers so neither channel
  recites data. If the measurement is uncertain, the coach SAYS so — it does not fork
  into two confident contradictions. (v2 "enforces" this only by prompt convention and
  duplicated thresholds — make it real: extract shared diagnosis thresholds into ONE
  place so engine.diagnose and coachtalk can't drift.)
- EVERY PRACTICE DECISION TRACES TO THE LIVE-PARSED STRATEGY ENGINE. No coaching logic
  hardcoded. Edit the Engine markdown in the vault → the coaching changes on the next
  take. (Fix the v2 caveat where gate rules are string literals in engine.prompt_block
  and defaults in reploop.py — make the gate parse from the Engine too, or clearly
  document the single source.)
- NEVER PRESCRIBE A MEASURE YOU HAVEN'T ACTUALLY READ from the score, and verify bar
  numbering against a landmark before trusting it. (This rule exists because a past
  version handed out drills built on guessed measure numbers — see the HARD RULE in the
  Piano Practice CLAUDE.md. KernScores files put each hand in a separate <part> with no
  <staff> tags; watch pickup/0-indexed bars that shift every later number.)
- TRUST TIERS, HONESTLY LABELED: 🟢 solid, 🟡 uncertain, 🔴 can't tell — especially for
  mic verdicts on dense/ff passages. MIDI is 🟢 by construction. (Fix the v2 dead
  ternary in verdict.build_rep where every drill rep is tagged green regardless of source.)
- PAIN/FATIGUE RULE: any mention of pain/strain/numbness → stop, drop the wrist, rest;
  fatigue cues → ease off. Never prescribe more reps against pain.
- ATOMIC VAULT WRITES: vault.py writes must be temp-file + os.replace (currently a whole
  -file write_text — a crash mid-write can corrupt a hand-authored note). Only ever
  write "(C)"-prefixed files.
- GIT: the repo is under local git. Do NOT lose work. Commit meaningful checkpoints as
  you go; add a private remote if one isn't set (off-disk backup — a local repo survives
  an in-place rebuild but not a dead disk). Losing v1's source to an in-place overwrite
  is exactly why this rule exists.
- SESSION CORPUS: keep logging every session (audio features, verdicts, what the coach
  said, what actually helped) into a clean training corpus for a future local model —
  and make the brain swappable behind one interface so a local model can drop in later.
- LOG ALL CHANGES + KEEP DOCS CURRENT (Christian's explicit ask): as you change the app,
  keep NOTES.md current, and update the vault docs that describe the app to match what
  the code actually does — (C) Coach App — How It Works.md, (C) PianoCoach — State &
  Roadmap.md, (C) PianoCoach — Version History.md (add the v3 entry). Docs written from a
  spec drift immediately; document what the code DOES, re-checked against real data.
  Keep clean code filenames — NO "(C)" prefix on code files; follow existing repo conventions.

════════════════════════════════════════════════════════════════════════════
PART H — HOW TO WORK (plan, build, verify — not optional)
════════════════════════════════════════════════════════════════════════════
- PLAN FIRST, LIGHTLY. Produce a short written plan + a checklist of every item in
  PARTS A–G. Keep the checklist in NOTES.md and update it as you go. Complete and VERIFY
  one slice before starting the next. Do NOT expand the plan into a giant up-front
  document — state the goal per slice and build.
- THINK HARD ON THE HARD PARTS: the re-locate-on-mismatch listener, the warm-up window,
  adaptive noise-floor thresholds, the single-verdict architecture, the interactive
  score + whiteboard, and the realtime voice loop. Design these deliberately.
- ESTABLISH A SELF-CHECKING HARNESS EARLY and run it on a cadence: a test harness that
  drives the whole pipeline WITHOUT Christian at the piano, fed by (a) segments of his
  ACTUAL playing from the 4 recordings + the lesson recordings, and (b) synthetic MIDI
  takes you generate (clean, wrong-note, rushed, uneven, paused-mid-passage,
  hands-separate, dotted-drill-done-straight). Prefer separate fresh-context sub-agents
  to VERIFY findings over self-critique.

════════════════════════════════════════════════════════════════════════════
PART I — THE MANDATORY VALIDATION LOOP (do NOT hand back the first thing you build)
════════════════════════════════════════════════════════════════════════════
Run at least 10 end-to-end cycles against REAL audio (PART D) + synthetic takes. Each
cycle, simulate a realistic practice moment end-to-end and check:
  - Does a PAUSE ever get graded as an error? It must NEVER. Test "I stopped to find
    the notes" explicitly. Zero false 0/36s. No "{blank text}" message can ever be sent.
  - Does silence get recognized in a real room (adaptive noise floor), not just clean audio?
  - On a wrong-measure / catastrophic-mismatch stretch, does it ASK and RE-LOCATE (not
    plow on grading the wrong bar)? Does the range reset on piece switch (no "measure 500")?
  - Does it warm up over 2–3 bars and confirm position/tempo before judging?
  - Is it LENIENT — clusters not singletons on mic, believe-me, don't grade restarts/loops?
  - Does far-under-tempo prescribe slow-metronome practice (not subdivisions)?
  - Is it genuinely INTERACTIVE — greets, asks the goal, says rep counts out loud,
    accepts pushback mid-drill, asks "was that right?" instead of asserting?
  - Can he interrupt mid-drill and redirect ("actually I'm on m.494") and it adapts?
  - When it prescribes hands-separate / a reduced drill, does it grade against THAT?
  - Does the coach ANNOTATE the exact notes it references on the score? Can he draw on
    the score and have it confirm / register the mark?
  - Is the response effectively instant, and does the voice sound like a person (musician
    number-speech, no markdown/em-dashes read aloud, no spoken essays)?
  - Is there EVER a moment where voice and text/chart contradict? There must never be.
  - Does it catch the PAIN cue in scherzo sesh 1 and the FATIGUE cue in griffes?
  - Does it independently reach the real teachers' diagnoses on the lesson recordings
    (e.g. Yukiko's "the pulse isn't being counted")?
After each cycle, WRITE DOWN every inconvenience/confusion/wrong behavior and FIX it
before the next. Keep the cycle log in NOTES.md. Then run an ADVERSARIAL self-review in
a fresh perspective: pretend you are a jaded NEC teacher trying this for the first time
— what annoys you in the first 5 minutes? Fix all of it. Only hand back when the loop is
genuinely clean, with the log as proof.

════════════════════════════════════════════════════════════════════════════
DEFINITION OF DONE — do not stop until ALL are true (show evidence for each)
════════════════════════════════════════════════════════════════════════════
[ ] Start lesson → greet → just listens; no typing required; minimal text; very verbal.
[ ] A pause is NEVER graded; adaptive noise floor recognizes silence in a real room; no
    "{blank text}" message can be sent.
[ ] Warm-up window: tracks/confirms position + tempo over 2–3 bars before judging.
[ ] Wrong-measure re-locate works: <~80% → asks "am I on the right measure?" and
    re-anchors; range resets on piece switch (no "measure 500" glitch).
[ ] Lenient by default: clusters not singletons on mic, believe-me, restarts/loops/
    hunting never graded, "just play" mode exists.
[ ] Far-under-tempo → prescribes slow-metronome practice (not subdivisions); target
    tempo loaded per piece.
[ ] Negotiated drills: suggests, accepts override/re-spec mid-drill, says rep counts
    aloud; the drill loop is a conversation, not a locked counter.
[ ] Interactive annotated score works: coach points at the exact notes it references;
    Christian can draw/circle/mark-hard/write-fingerings and the coach confirms + registers it.
[ ] Living per-piece coach-memory doc exists and is kept current (hard spots, learned/
    todo/goals, resume point, his drawn marks).
[ ] Progress window reset to lenient; the scheduler/progress layer actually fires on
    real data (clean-rep % is non-zero, tiers advance).
[ ] Voice = one fast streaming S2S model (gemini-3.1-flash-live + thinkingBudget 0),
    barge-in instant, musician number-speech, no markdown/em-dashes ever spoken; ~sub-1.5s.
[ ] Exactly ONE verdict per moment; voice and text never contradict; shared thresholds
    extracted (no engine/coachtalk drift).
[ ] MIDI names the exact wrong note/hand/beat; mic fallback honestly labeled approximate;
    trust tiers real (build_rep ternary fixed).
[ ] Every coaching decision traces to the live Strategy Engine; pain/fatigue rule active;
    atomic vault writes; git checkpoints (+ remote).
[ ] The ≥10-cycle validation loop ran against the REAL narrated recordings + lesson audio,
    is logged, and is clean; the coach reaches the real teachers' diagnoses.
[ ] It runs as the native app; you launched it and confirmed the end-to-end flow with
    EVIDENCE (test output / logs / audio-sample runs), not assertion.
[ ] Design skills used for the UI/chart; review/QA skills run against your own work.
[ ] All changes logged in NOTES.md; the vault docs (How It Works, State & Roadmap,
    Version History) updated to match the real v3 code.

When everything above is green, summarize (OUTCOME FIRST, plain sentences, no working
shorthand): whether it's actually usable now, what you changed, what you built beyond
the ask, what the validation loop found and fixed, and anything genuinely blocked that
needs Christian. Don't pad it.
```

---

## 🔎 What changed vs the v2 prompt (so you know this is a real rewrite, not a reskin)

| Area | v2 prompt | v3 prompt |
|---|---|---|
| **Core framing** | "Be an NEC teacher / diagnostician" | **Lenient, interactive, verbal rep-tracker** (the reframe) |
| **Fable operating style** | Generic "plan + self-test" | **Fable-5-specific**: act-when-ready, no gold-plating, grounded-progress, autonomous no-stop, memory surface, sub-agents, re-ground summaries |
| **#1 priority** | "UI overhaul" (generic) | **Interactive annotated score + whiteboard** (the moat), spelled out |
| **Validation** | Synthetic self-test (the trap that shipped the live bugs) | **Listen to every minute of the 4 narrated recordings** + validate the pipeline on them |
| **Behavior rules** | From memory/spec | **Extracted from the recordings** with the concrete numbers (80–85% trigger, 2–3 bar warm-up, etc.) |
| **Voice model** | "pick OpenAI/Gemini, justify" | **Locked**: gemini-3.1-flash-live + `thinkingBudget:0` (the 8s-delay fix, proven in Cadencify) |
| **Brain** | Two-brain "one verdict" | **Simplify**: fast voice + templates first, heavy brain only if it earns it, toggleable |
| **New requirements** | — | living per-piece coach-memory doc, negotiated drills, re-locate-on-mismatch, adaptive noise floor, "just play" mode, **log all changes + update docs**, use installed Claude skills |

---

## ✅ Next action

**Open your Fable 5 session in `~/piano-coach/`, confirm it can also read the vault + the `piano narration train samples/` folder, and paste the fenced prompt above.** The one thing it may rightly ask you: which realtime-voice provider/key to use — answer that and let it run.

Want me to also do a quick pass right now to **verify the recordings + lesson folders are exactly where the prompt says they are** (so Fable doesn't waste a cycle hunting), or tighten any section further before you ship it?

## Parent
- [[(C) Coach App]]
