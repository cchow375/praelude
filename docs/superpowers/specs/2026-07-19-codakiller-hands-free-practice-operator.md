# CodaKiller Hands-Free Practice Operator — Design

**Date:** 2026-07-19  
**Release target:** v3.1.0 stabilization, followed by the complete Practice Operator capability set  
**Product sentence:** Less work for Christian; more reliable practice truth.

## 1. Why this exists

Christian's July 19 at-piano sessions validated the user-as-sensor premise and
failed the interaction premise. Routine receipts stayed over the controls,
metronome ownership differed between voice and UI, and the v3 shell disconnected
already-built Brain context/action seams. The installed tutorial nevertheless
described those seams as live. Today offered a large derived composer but no
obvious place to say what the session was for.

The desired app is not a collection of memorized voice phrases. Christian should
be able to speak naturally about the section, page, intention, drill, tempo,
attempt, result, and next step. CodaKiller should translate that conversation into
the same typed operations available to the visible UI, read consequential changes
back, ask when meaning is ambiguous, and execute once after confirmation.

## 2. Non-negotiable boundary

- Christian remains the sensor. Piano sound never creates a clean/flawed verdict,
  identifies notes, or claims a rep happened.
- The deterministic hot loop remains instant and offline for verdicts, metronome,
  undo/restart, pause/resume, navigation, and pending confirmation responses.
- A language model may interpret open English and propose typed operations. It
  never writes the database, calls arbitrary IPC, clicks the DOM, or bypasses a
  revision/permission check.
- Read-only questions and navigation may run directly. Practice-truth mutations
  require a concise visual and spoken read-back; ambiguous/destructive changes
  require an explicit confirm/cancel/change response.
- Every operation is idempotent, revalidated against current entity revisions,
  audited, receipted, and reversible where the domain permits it.

## 3. One shared semantic surface

The shell owns an `AppContextSnapshot` that describes what Christian actually sees:

- active workspace;
- selected piece and exact edition;
- current PDF page and mapped page range;
- selected Region or drawn score box;
- active practice set, contract state, and revision;
- authoritative metronome running/BPM/owner/revision;
- active session and reviewed plan;
- today's plain-English intention;
- relevant goal, calendar, retention, and recovery revisions.

Score, Today, Rep HUD, metronome, deterministic voice, and Brain all consume this
same snapshot. A workspace must not maintain a second, independent idea of the
selected piece or metronome state.

The snapshot is semantic data, not pixels. This gives the Brain the useful meaning
of the screen without fragile screenshots, accessibility scraping, or unrestricted
computer control.

## 4. One capability registry

Buttons, exact voice commands, and Brain proposals target the same closed registry.
Each capability declares its input schema, read/write class, confirmation policy,
validation, execution owner, receipt text, undo behavior, and TTS summary.

Initial capabilities:

1. metronome start/set/stop;
2. start practice set from selected target, page mapping, or explicit measures;
3. record user-declared clean/flawed attempt;
4. undo/correct/restart/pause/resume/close a set;
5. navigate to piece/page/Region;
6. read current/last-session progress.

Next capabilities:

7. set today's intention and session duration;
8. create/change week goals and schedule reviewed Daily Work;
9. revise or explain prior session records through append-only corrections;
10. record a diagnostic single pass/observation without pretending it is a
    repetition contract or mastery evidence.

## 5. Natural conversation flow

Example first vertical slice:

1. Christian selects a score box, then says: “Right hand dotted rhythms five
   times at 72.”
2. The local parser combines the words with the exact score context and creates a
   typed `start_practice_set` draft.
3. Coda says and shows: “Start Beethoven Op. 90, page 4 selected section, right
   hand dotted rhythms, five attempts at 72?”
4. “Confirm” executes exactly once. “Cancel” writes nothing. “Change it to 66”
   revises and re-reads the draft.
5. If the metronome is stopped, the practice owner starts it at 72. If it is
   already running, it changes live without rebuilding the audio engine. If a
   manual metronome owns the click, later pause/close behavior respects that owner.

No wake phrase is required for assistant-directed natural language. To prevent
ambient piano-room speech from mutating data, open English can only produce a
draft. Exact pending `confirm`/`cancel` is handled locally; an unprompted “yes” is
never treated as consent.

## 6. Page-first targeting

Page numbers are a first-class navigation and conversation cue. A page is not
silently invented into a measure range:

- selected Region/box on that page wins;
- otherwise verified edition anchors resolve Regions or a bounded mapped range;
- one clear match may be proposed;
- zero or multiple matches triggers a short clarification and visible highlight.

The stored practice contract still uses canonical measure/Region identity so
history remains stable across different PDF editions.

## 7. Metronome authority

There is one native audio engine and one transition policy:

- stopped + requested BPM → start;
- running + different requested BPM → live set;
- running + same BPM → no-op;
- stop → stop the authoritative engine;
- opening a drill never rebuilds an already-running engine.

The native state will ultimately expose `owner: manual | practice(set_id)` so
pause/resume/close only controls a click that belongs to that set. Raw handled
voice text, normalized intent, and before/after metronome state are stored locally
for diagnosis; they are not sent to a model unless Christian intentionally asks
the Brain a question.

## 8. Provider model

The Practice Operator is provider-neutral. Claude API, Gemini API, and a future
local adapter may implement the same interpreter interface. Christian's consumer
Claude subscription is not an API credential and is not embedded as an
unrestricted computer agent. A local model is optional, not a prerequisite for
screen context or safe app control: deterministic routing and the typed registry
own correctness.

## 9. v3.1.0 acceptance gate

- Routine success/undo/duplicate receipts disappear within 1.5 seconds and never
  intercept the covered UI; errors/confirmations remain reviewable.
- UI and voice drill starts obey the same idempotent metronome transition policy.
- Literal stop forms stop; handled voice commands retain enough local audit data
  to diagnose recognition such as “stop” → “sixty.”
- Brain receives the exact selected piece/page/edition/Region/active set from the
  visible shell and voice questions reach it as voice requests.
- Supported Brain actions and natural set drafts are visible, confirmation-gated,
  and executable through shared domain handlers; no mutation occurs before
  confirmation.
- Natural set requests reuse the current score target instead of dead-ending on a
  missing piece. Page-only ambiguity is disclosed.
- Today has a direct plain-English intention box. Settings has an accurate in-app
  guide separating exact hot-loop commands, natural Brain requests, and present
  limits.
- Focused tests, full frontend tests, full Rust tests, production build, fresh
  adversarial review, packaged install, and quit/relaunch verification pass.

## 10. Honest remaining boundary after v3.1.0

v3.1.0 restores and hardens the broken first slice; it does not claim the whole
Practice Operator is finished. Goal/calendar mutation by voice, durable pending
draft recovery across relaunch, full metronome ownership, diagnostic single-pass
semantics, and complete conversational plan revision remain gated follow-up work
until their typed capabilities and live at-piano acceptance exist.
