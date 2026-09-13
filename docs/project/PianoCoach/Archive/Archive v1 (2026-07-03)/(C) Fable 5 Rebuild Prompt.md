---
type: handoff
tags: [piano, coach, app, fable5, prompt]
created: 2026-07-03
---

# 🎹 CodaKiller v2 — Fable 5 Rebuild Prompt

> **What this is:** the exact prompt to paste into **Claude Fable 5** (running as the
> agentic coder inside `~/piano-coach/`). Copy everything inside the ``` fence below.
> It restates every v1 issue, sets the bar far above "issues gone," and forces Fable
> to test itself ≥10× against real lesson data before it hands anything back.

> **Locked decisions** (already answered — baked into the prompt):
> 1. **Voice = cloud real-time speech-to-speech** (native app shell, realtime voice API for conversation).
> 2. **Brain = one cloud coach now, architected local-ready** (logs every session to train a future local model).
> 3. **Input = MIDI when connected, mic fallback** (MIDI is the precision path; mic is honest-but-approximate).

---

```
ROLE
You are Claude Fable 5, the senior engineer rebuilding a piano practice coaching app.
You are working in the existing repo at ~/piano-coach/ (a native macOS app called
CodaKiller / PianoCoach.app, Python backend + WKWebView shell). This is a real,
in-use codebase — read it before you touch it. Do not rewrite what already works;
fix what's broken and build what's missing. This is a long-horizon build: plan across
stages, verify your own work continuously, and do not hand it back until it actually
passes the tests defined at the bottom.

═══════════════════════════════════════════════════════════════════════════
THE ONE-LINE GOAL
═══════════════════════════════════════════════════════════════════════════
Make CodaKiller feel like a New England Conservatory teacher on a Zoom lesson,
listening in real time — hearing the wrong note the instant it sounds, reacting
immediately, and telling me EXACTLY how to practice the fix (which measure, which
hand, which drill, what tempo, how many reps, what to watch for). Right now it feels
like a fragmented chatbot I play *at* and then wait on. That gap is the whole project.

The user (Christian) is an NEC Prep student, 13 years of piano, Tanglewood +
Interlochen. Serious player, no patience for toy-app behavior. He described v1 as
"genuinely unusable." Your job is to make it something a conservatory-track pianist
would actually reach for every day.

═══════════════════════════════════════════════════════════════════════════
THREE ARCHITECTURE DECISIONS — already made, do not re-litigate
═══════════════════════════════════════════════════════════════════════════
1. VOICE = real-time, cloud speech-to-speech. Replace the current STT→LLM→TTS
   pipeline (whisper.cpp → gemma/Claude via a BLOCKING `claude -p` subprocess →
   Kokoro) with a true streaming realtime voice loop (e.g. OpenAI Realtime API or
   Gemini Live — pick the best one, justify it, make the provider swappable behind
   one interface). It must: stream, barge-in instantly (I can talk or play over it
   and it stops), respond in well under a second, and speak in complete natural
   spoken sentences — NEVER read text/markdown aloud, never say em-dashes, never
   pronounce "m.492" as "em dot four nine two." The app shell stays a native desktop
   app; only the conversation goes to the cloud.

2. BRAIN = ONE coach, cloud now, local-ready later. Kill the two-model split
   (gemma3:1b AND Claude both talking and DISAGREEING is the #1 fragmentation bug).
   There is exactly ONE coach persona and ONE source of truth per verdict. Ship it on
   one strong cloud model today (use the streaming API — NOT the blocking CLI
   subprocess; that subprocess is the real cause of the 10-second delay, not the model
   tier). Christian prefers Claude Sonnet 4.6 or Opus 4.7 for the written/diagnostic
   brain — honor that. Architect so a fine-tuned LOCAL model can drop in behind the
   same interface later with no rewrite, and LOG every session (audio features,
   verdicts, what the coach said, what actually helped) into a clean training corpus
   for that future local model. The long-term goal is to not need the cloud at all —
   build toward it, don't pretend you're there.

3. INPUT = MIDI when connected, mic fallback. Add MIDI/USB input (python-rtmidi or
   mido). When a MIDI keyboard is present, use it: exact note, exact rhythm, exact
   duration, exact inner-voice/chord content — this makes "name the exact wrong note
   and beat" trivially correct, which is the single feature every competitor fails at.
   When no MIDI, fall back to the mic pipeline, and clearly LABEL mic verdicts as
   approximate on dense/fast/loud passages (don't assert what the mic can't hear).
   Auto-detect which input is live and tell me which mode it's in.

═══════════════════════════════════════════════════════════════════════════
READ THESE FIRST (do not code until you have)
═══════════════════════════════════════════════════════════════════════════
- The whole backend: ~/piano-coach/coach/*.py (esp. stream.py, voice.py, llm.py,
  reploop.py, methods.py, coachtalk.py, analyze.py, align.py, score.py, engine.py,
  prompts.py, config.py) + server.py + app.py + web/.
- The practice brain (source of truth for ALL coaching logic — the app parses it live):
  "~/Desktop/christians universe/Piano Practice/(C) Strategy Engine (AI).md"
  and "(C) Drill Library.md".
- The grounding corpus you will teach the coach from:
  "~/Desktop/christians universe/Piano Practice/CodaKiller/classicalpianodumpknowledge.md"
  (100+ pianists/pedagogues, real methods, WHEN to use each — this is the credible-
  voices library the coach must reason from; no forum-post advice, only named sources).
- The app docs: CodaKiller/(C) Coach App.md and (C) Coach App — How It Works.md
  (includes Christian's own "MY NOTES" — read them; they are the spec behind the spec).
- REAL LESSON DATA you will test against (see the self-test section):
  "Piano Practice/Lessons/2026-06-12 Yukiko/", ".../2026-06-19 Yukiko/",
  ".../2026-06-23 Jeanie/" — each has transcript/lesson.txt + .json, analysis/ (audio
  features, note transcription, measure index), and (C) lesson-report.md with the
  verdict a real teacher reached. These are your ground truth for "does the coach
  reach a real teacher's diagnosis."
- Pieces with real scores: Chopin Scherzo No.2 Op.31, Beethoven Op.90 mvt 1,
  Griffes "The Lake at Evening" (MusicXML installed).

Before referencing ANY function, model name, file path, or Engine method: grep/confirm
it exists. Do not invent APIs or call things that aren't there.

═══════════════════════════════════════════════════════════════════════════
PART A — THE FLOOR: every v1 issue must be gone AND the thing must make sense
═══════════════════════════════════════════════════════════════════════════
These are the minimum. "All issues fixed" is NOT success on its own — the app must
also be coherent and genuinely usable. Fix root causes, not symptoms. Do not hide a
bug by suppressing an error, faking a verdict, or hardcoding around it.

1. BACK-AND-FORTH CONVERSATION. It must be a real dialogue. Today there's no way to
   talk to it mid-drill. I need to say "actually I'm doing measure 494," or "this bar
   feels impossible," or "play me what it should sound like," WHILE practicing, and
   have it adapt. Build a real-time interaction channel that works during listening
   AND during drills. Barge-in always on.

2. KILL THE IMPATIENCE. v1 treats a pause as a mistake: if I stop to find the notes,
   it says I played it wrong and gives me "0/36." A human teacher knows the difference
   between a wrong note and a person locating the next chord. Detect natural pauses.
   Never grade silence. Never send a "{blank text}" message to the model (that bug —
   voice picks up nothing, ships an empty string, the model "responds" to nothing —
   must be impossible by construction). If I go quiet, it waits, or says "take your
   time," not "wrong."

3. RESPONSE TIME → NEAR ZERO. Asking a question about the instructions should not take
   ten seconds. Instant reflex verdicts/counts stay token-free templates; the
   conversational turn streams from the realtime voice model. Remove the blocking
   `claude -p` subprocess entirely.

4. ONE COACH, NOT TWO. The engine and the LLM currently disagree ("engine says X,
   Claude says Y"). There is now ONE verdict per moment. Measured acoustic/MIDI facts
   feed ONE coach persona; voice and text are two RENDERINGS of that single verdict,
   never two opinions. If the measurement is uncertain, the coach says so — it doesn't
   fork into two confident contradictions.

5. NO VERBAL DRILLS. The engine can't understand "say the subdivision out loud" drills
   and it prescribed unhelpful ones (e.g. "1 e and a" for a passage where that doesn't
   apply). Prescribe ONLY things I physically play at the keyboard. Every drill = a
   concrete keyboard action + target tempo + rep count + one thing to watch.

6. DIAGNOSE NOTES BEFORE RHYTHM. v1 assumes a missed/paused note means I don't know the
   RHYTHM. Usually it means I don't know the NOTES yet. Default an ambiguous miss or a
   pause to "notes not secure," and DEPRIORITIZE rhythm as a diagnosis until the notes
   model is solid. (Claude got this right in v1; the engine got it wrong — encode the
   right default.) Below a slow threshold it's sight-reading, not "uncounted rhythm."

7. UNDERSTAND SEPARATE-HANDS PRACTICE. v1 told me to practice left hand alone, then
   marked me WRONG because it compared what I played to the full texture. If it
   prescribes hands-separate (or any reduced task — one voice, blocked chords, dotted
   rhythm), it must GRADE against that reduced task, not the printed score. Verify the
   MANNER before grading the rep (a straight run of a "dotted" drill is the wrong
   exercise, not a clean rep).

8. REPLACE "LISTEN" (click-to-record-then-analyze) with a real-time teacher. No more
   "record a clip, wait, get a wall of text." It listens as I play and reacts.

9. SPEECH THAT SOUNDS HUMAN. Complete spoken sentences. Numbers said like a musician
   ("measure four ninety-four," "quarter equals seventy-two," "right hand"). No em-
   dashes, no markdown read aloud, no ten-minute spoken instruction dumps. Voice says
   the ONE important thing (method + measure + why); the nitty-gritty (exact missing
   notes, per-bar chart, timing graphs) lives on-screen, never recited.

10. LEARN FROM THE CLAUDE LOGS. Save the coach's diagnoses and outcomes so the system
    improves its own coaching over time and builds the corpus the future local model
    trains on. "What worked / what didn't" must persist per trouble spot.

11. GROUND IT IN REAL PEDAGOGY. Give the coach a real library of how great pianists and
    pedagogues practice — from classicalpianodumpknowledge.md and the Strategy Engine —
    matched to WHEN to use each method (long fast RH run + uneven → dotted-rhythm or
    accent-shift; leaps → land-the-target isolation; hands-not-syncing → HT slow with a
    fixed pulse; etc.). For well-known pieces, it may pull what named artists actually
    do (sourced, attributed — never anonymous forum advice).

12. UI OVERHAUL. The current UI is weak and looks bad. Rebuild it to feel like a live
    lesson: score with a cursor that follows me, a live per-bar chart that fills AS I
    play, the coach's spoken line in a clear bubble, clickable measures, and a session
    view that reads like a lesson in progress — navigable, skimmable, not a wall of text.

═══════════════════════════════════════════════════════════════════════════
PART B — THE BAR: go far beyond what I asked. Build the coach nobody has.
═══════════════════════════════════════════════════════════════════════════
Research (serious-pianist forums + motor-learning science) shows every existing app
fails the same way: feedback is binary and forgiving, and it collapses on real
repertoire. The open gap is measure-level DIAGNOSTIC coaching on REAL music. Own it.
Build these unless one is genuinely infeasible on this machine (if so, say why and
build the best version you can — do not silently skip):

CORE (high demand, you can actually deliver these):
- Diagnostic feedback that NAMES the exact wrong note + hand + beat (trivial on MIDI;
  best-effort + labeled-approximate on mic). Not a red dot — "you played F♯ instead of
  F♮, right hand, beat 3 of m.17."
- Isolate any measure/range on the real score and LOOP it, with feedback each pass.
- Rep-gated tempo laddering: 3–5 CLEAN reps → +5–10 bpm; at the sloppy ceiling, drop
  back and END on one slow-perfect pass. A hunted/wrong rep resets the count. Enforce
  the clean-rep GATE — that's the part every app skips.
- "What should I practice today": prescribe ONE drill matched to a diagnosed weakness
  AND SHOW THE REASONING ("LH rushes m.17 because the thumb-under is late → this
  isolation drill fixes that"). Answer the universal complaint that AI plans hide the why.
- Spaced-repetition scheduler for trouble spots + a repertoire-maintenance rotation
  (24/48/72-hr spacing for new material; surface what's due).
- Note-duration / hold-length grading and rushing/uneven/tempo-drift detection — the
  things you structurally cannot hear yourself while executing.
- Auto-slow / auto-backup: too many errors in a row → it backs up to the top of the bar,
  drops the tempo, turns on the metronome — like a teacher saying "stop, slow down, again."
- Record → timeline → self-comparison (this take vs. last week vs. a reference).
- Progress analytics as graphs: tempo-ceiling curve per passage, clean-rep %, trouble-
  zone history. Milestones a solo player otherwise never gets.
- Session orchestration that mirrors a real lesson (see PART C) — a scaffold, not a cage.

DELIGHTERS (mostly nobody does these — each grounded in real research):
- Quality score, not a minute count: the hero metric is PROPORTION OF CLEAN REPS. (Top
  pianists ~3 error-trials vs ~13.6 for everyone; practice-minutes had ZERO correlation
  with next-day retention. Reframe the whole dashboard around clean reps, not time.)
- "You didn't hear these": after a take, surface the errors I COULDN'T catch myself
  (players catch ~38% of their own errors by ear) — "5 mistakes on that pass you didn't
  hear, here they are, with timestamps."
- Anticipatory-stopping trainer: the one elite behavior from the Duke study — as I
  approach the bar I always miss, cue me to slow down RIGHT BEFORE it without stopping.
- Repertoire-decay radar: "You haven't touched the Scherzo in 12 days — it's about to
  slip. 10-minute refresh?"
- Sleep-anchored scheduling: serve the hardest trouble spot last before bed, auto-retest
  it first next session (sleep selectively repairs the hardest transitions).
- Mental-practice mode: play the score, I audiate + tap the hard transition away from
  the keyboard (real reps, no piano).
- "Sherlock Holmes" new-piece mode: before playing a new piece, a guided score-analysis
  pass (structure, patterns, harmony) — how experts actually build memory.

Do NOT gold-plate beyond this. No speculative abstractions, no features I didn't ask
for that aren't on this list, no half-finished stubs. Build these well and completely.

═══════════════════════════════════════════════════════════════════════════
PART C — THE MODEL OF A REAL PRACTICE SESSION (structure the app to match this)
═══════════════════════════════════════════════════════════════════════════
Before building the session flow, internalize how a real lesson / solo session is paced,
then structure CodaKiller so a session FEELS like this (branch on difficulty; the timer
is a scaffold, never a rigid box):
  1. Warm-up → 2. ONE technique target → 3. Score-study/diagnose the hard spot →
  4. Isolate the hardest bar (as short as a couple of beats) while fresh →
  5. Slow practice at 50–60% (diagnostic — exposes what speed hides) →
  6. Hands-separate ONLY for passages not yet secure hands-together (HT is ~4× harder,
     not 2×) — but branch: secure passages go hands-together and musical early →
  7. Tempo ladder with the clean-rep gate → 8. Interleave trouble spots (random chunks) →
  9. Cool-down: END on a slow, perfect pass (never stop at your fastest sloppy tempo) →
  10. Journal + assign: log piece, section, TEMPO CEILING (bpm), what improved, what
      still fails — and hand it off as specific per-measure, per-hand homework.
Study the three real lesson transcripts to see how Yukiko and Jeanie actually run this
(they name the measure, they play the passage to demonstrate, they assign one specific
thing). Match that texture. The app's "assign homework" should read like their handoffs.

═══════════════════════════════════════════════════════════════════════════
PART D — NON-NEGOTIABLE ENGINEERING CONTRACTS
═══════════════════════════════════════════════════════════════════════════
- VOICE ≠ TEXT. Every coach reply is structured: { spoken: ≤2 natural sentences → TTS;
  chart: per-bar data → on-screen; detail: everything spoken PLUS depth → text pane }.
  Text says everything the voice says plus more; voice and text are NEVER identical; the
  chart carries the numbers so neither channel recites data.
- Every practice decision traces to the live-parsed Strategy Engine. No coaching logic
  hardcoded. Edit the Engine in the vault → the coaching changes.
- Never prescribe a measure you haven't actually read from the score. Verify bar
  numbering against a landmark before trusting it. (This rule exists because v1 handed
  out drills built on guessed measure numbers — see the HARD RULE in the Piano Practice
  CLAUDE.md.)
- Trust tiers, honestly labeled: 🟢 solid, 🟡 uncertain, 🔴 can't tell — especially for
  mic verdicts on dense/ff passages. MIDI is 🟢 by construction.
- Pain rule: any mention of pain/strain/numbness → stop the student, drop the wrist,
  rest. Never prescribe more reps against pain.
- Musicality lands a beat later than note-level reaction (it needs the whole passage) —
  that's fine, that's how a real teacher works. Frame interpretation as evidence, not
  verdict, and anchor it to named sources.
- Keep the UI-agnostic backend where it's sound; swap the pieces that are broken.
- Files: keep calculator-style clean names, no "(C)" prefix on code. Follow the existing
  repo conventions.

═══════════════════════════════════════════════════════════════════════════
PART E — HOW YOU MUST WORK (this is not optional)
═══════════════════════════════════════════════════════════════════════════
- PLAN FIRST. Before writing code, produce a written plan + a test plan and a checklist
  of every item in PART A and PART B. Keep the checklist in a scratchpad file and update
  it as you go. Complete and VERIFY one slice before starting the next.
- Think hard on the hard parts (realtime voice loop, MIDI+mic alignment, the single-
  verdict architecture, the impatience/pause detection). Design them deliberately.
- Keep a memory file (e.g. NOTES.md in the repo) of decisions, gotchas, and what you
  learned each pass, so nothing is re-derived and the next session resumes cleanly.
- Fix root causes. Do NOT suppress errors, comment out failing tests, fake verdicts, or
  hardcode to pass. If something is blocked, say so explicitly — don't half-finish.
- Ground every progress claim in evidence. Before you say "X works," point to the test
  output or the run that proves it. Don't report a feature done because it "should" work.
- Ask me (AskUserQuestion) only for decisions genuinely mine to make (e.g. which realtime
  voice provider if there's a real cost/quality tradeoff, or an API key). For everything
  else, pick the sensible default, note it, and proceed. Do not stall.
- Do not stop early. You are done only when PART F passes. If you hit the finish line in
  your head but the tests aren't green, you are not done.

═══════════════════════════════════════════════════════════════════════════
PART F — THE MANDATORY SELF-TEST LOOP (≥10 cycles before you hand it back)
═══════════════════════════════════════════════════════════════════════════
Do NOT give me the first thing you build. You must test it on YOURSELF at least 10 times,
find every inconvenience a real user would hit, and fix it — until it genuinely makes
sense to a player like me. Concretely:

1. BUILD A TEST HARNESS that can drive the whole pipeline without me at the piano:
   - Feed it segments of my ACTUAL playing from the three real lesson recordings
     (Lessons/*/audio + the transcribed notes in analysis/), and synthetic MIDI takes
     you generate (clean, wrong-note, rushed, uneven, paused-mid-passage, hands-separate,
     dotted-drill-done-straight). fluidsynth + the existing test_assets/ rig is a start.
2. FOR EACH of ≥10 test cycles, simulate a realistic practice moment end-to-end and check:
   - Does it reach the diagnosis a real teacher reached? (Compare against the actual
     (C) lesson-report.md verdicts — e.g. on the Scherzo opening Yukiko's real verdict
     was "the pulse isn't being counted"; on the Griffes sight-read the issue was left-
     hand-dominant / wrong-clef errors. The coach should independently land these.)
   - Does a PAUSE ever get graded as an error? (It must never. Test the "I stopped to
     find the notes" case explicitly. Zero false 0/36s.)
   - Is the response effectively instant, and does the voice sound like a person (no
     em-dashes, no read-aloud markdown, numbers spoken like a musician)?
   - Can I interrupt mid-drill and redirect it ("actually I'm on m.494")? Does it adapt?
   - When it prescribes hands-separate / a reduced drill, does it grade against THAT,
     not the full score?
   - Does an ambiguous miss default to "notes not secure," not "rhythm"?
   - Is there ever a moment where the voice and the text/chart CONTRADICT each other?
     (There must never be. One verdict.)
   - On MIDI: is the named wrong note/beat exactly right? On mic: is it labeled
     approximate where it should be?
   - Does the session flow like a real lesson (PART C), and does the homework handoff
     read like Yukiko's/Jeanie's?
3. After each cycle, write down every inconvenience, confusion, or wrong behavior you
   hit — then FIX it before the next cycle. Keep a log of the 10+ cycles and what each
   one changed.
4. RUN AN ADVERSARIAL SELF-REVIEW in a fresh perspective: pretend you are a jaded NEC
   teacher trying this for the first time. What annoys you in the first 5 minutes? Fix
   all of it.
5. Only after the loop is genuinely clean do you hand it back — with the cycle log as
   proof.

═══════════════════════════════════════════════════════════════════════════
DEFINITION OF DONE — do not stop until ALL of these are true (show evidence for each)
═══════════════════════════════════════════════════════════════════════════
[ ] Real back-and-forth conversation works during listening AND during drills; barge-in instant.
[ ] A pause is never graded as an error; no "{blank text}" message can ever be sent.
[ ] Conversational response is effectively instant; the blocking `claude -p` subprocess is gone.
[ ] Voice is true streaming speech-to-speech; complete natural sentences; musician number-speech; no markdown/em-dashes ever spoken.
[ ] Exactly ONE coach verdict per moment; voice and text never contradict.
[ ] MIDI input works and names the exact wrong note/hand/beat; mic fallback works and is honestly labeled approximate.
[ ] Only physical-keyboard drills are prescribed; the manner is verified before a rep is graded; reduced drills are graded against the reduced task.
[ ] Ambiguous misses default to "notes not secure," not rhythm.
[ ] All PART A issues fixed at the root (no suppression/hardcoding).
[ ] The CORE PART B features are built and working; the DELIGHTERS are built (or, if truly infeasible here, explained + best-effort delivered).
[ ] Session flow matches PART C; homework handoff reads like a real teacher's.
[ ] Every coaching decision traces to the live Strategy Engine; no hardcoded logic.
[ ] Sessions are logged into a clean corpus for the future local model; the brain is swappable behind one interface.
[ ] UI is rebuilt and feels like a live lesson (score cursor, live per-bar chart, clickable measures, navigable — not a wall of text).
[ ] The ≥10-cycle self-test loop ran, is logged, and is clean; the coach reaches the real teachers' diagnoses on the three lessons.
[ ] It runs as the native app; you launched it and confirmed the end-to-end flow with evidence, not assertion.

When everything above is green, summarize (outcome first): what you changed, what you
built beyond the ask, what the test loop found and fixed, and anything genuinely blocked
that needs me. Do not pad it. Lead with whether it's actually usable now.
```

---

## 📎 How to use this

1. Open your Fable 5 coding session **in the `~/piano-coach/` repo** (so it can read the code).
2. Paste everything inside the ``` fence above.
3. Make sure it can also see the vault paths it references (the Strategy Engine, the
   knowledge dump, and the `Lessons/` folder) — those are its ground truth and its test data.
4. If it asks which realtime-voice provider or for an API key, that's the one decision
   it's right to ask about — answer and let it run.

*Restates all 24 of your v1 issues, folds in real pedagogy + serious-pianist research,
and is structured the way Fable 5 actually performs best: full spec up front, a
self-test harness it can't escape, hard definition-of-done, and explicit
anti-gold-plating / anti-early-stopping gates.*
