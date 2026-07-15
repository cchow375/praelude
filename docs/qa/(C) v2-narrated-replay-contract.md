# CodaKiller v2 — Narrated Practice Replay Contract

**Status: CONTRACT / PLANNED — NOT IMPLEMENTED, NOT RUN, NOT PASSING**  
**Contract date:** 2026-07-15  
**Source corpus:** `/Users/c3/piano-coach/test_assets/narrated/`

This document defines the acceptance contract for replaying Christian's four narrated practice
sessions against CodaKiller v2. It is a specification for future fixtures and tests, not evidence
that the app currently satisfies them. A checkbox in this file describes required work until a
future dated run records concrete output beside it.

## Binding authority boundary

> **CodaKiller must never grade, diagnose, locate, or otherwise interpret the piano audio as
> musical performance. Christian is the sensor; the app is the memory.**

The recordings may be used to test speech recognition, command routing, interaction flow,
state transitions, false mutations, receipts, correction, and session memory. They may not be
used to assert any of the following from acoustic piano sound:

- correct, incorrect, missed, or extra notes;
- rhythmic accuracy, pulse, synchronization, dynamics, articulation, or fingering;
- played tempo or score position;
- whether a passage, hand, exercise, restart, loop, or rep was completed;
- a teacher-like verdict derived from the waveform or note-transcription output.

An explicit statement from Christian such as `again, missed the E` may create a failed rep with
his note. The same fact inferred from the WAV may not. Silence, playing, looping, searching,
page turns, score writing, and interruptions create no rep and no diagnosis.

This later boundary supersedes the early PianoCoach cycle claims that mic audio could reproduce
teacher verdicts. The later empirical result in `/Users/c3/piano-coach/NOTES.md` is authoritative:
a clean acoustic take read only 35–52% note accuracy with timing error in whole seconds, and the
subsequent verbal architecture prohibited mic grading. Do not resurrect the earlier grader.

## Corpus manifest

All four source WAVs are mono, 16 kHz, signed 16-bit PCM (`pcm_s16le`) at 256 kbps. Narration
JSON/TXT was generated in English with Whisper large-v3-turbo. The transcript is source material,
not perfect ground truth.

| Recording | Duration | Size | Narration segments | WAV SHA-256 |
|---|---:|---:|---:|---|
| `scherzo1.wav` | 1:31:40.693 | 167.9 MiB | 721 | `9d15d0421d1340822f35229f8aab191811f0a6b107bea8b421f37ad4baf6e10f` |
| `scherzo2.wav` | 0:18:21.163 | 33.6 MiB | 201 | `9b6a44ee71d994b8e68a1c0c705bbfa225015d2ceb5cd5c5b32179b47ed918c0` |
| `scherzo3.wav` | 0:29:49.355 | 54.6 MiB | 308 | `03b294f5a2c57e23eb06c4122f3799c7697abbc9abbd767e509231b7df21de63` |
| `griffes.wav` | 1:03:33.675 | 116.4 MiB | 79 | `48f2780ce73b70bca71783a82890e88a5a29d5a20fab667042a2f16922a1b42b` |
| **Total** | **3:23:24.885** | **372.5 MiB** | **1,309** | — |

Transcript caveats are part of the contract:

- Scherzo 1 contains at least 467 obvious repeated-text artifacts, about 64.8% of its segments.
- Repeated phrases include `I don't have to take that long`, `I'm going to make that mistake`,
  and `This is like a big part of the page` over long piano spans.
- Segment end offsets often point to the next detected speech after minutes of piano. They are
  ordering anchors, not reliable utterance or clip boundaries.
- The derived `*_notes.json` files are not truth fixtures and must not be consulted for a grade.
- Committed deterministic fixtures should preserve source id, timestamp, raw text, and manual
  adjudication. Raw WAV presence should be verified by hash; a missing local WAV must produce an
  explicit skipped/blocked audio result, never a silent pass.

## Action-authority tiers

The replay harness must distinguish three kinds of speech:

1. **Tier A — unambiguous hot-loop command.** A bounded deterministic command executes
   immediately and emits a visible receipt: `done`, `again, missed the jump`, `metronome 60`,
   `undo last rep`, `restart the streak`, or `close the block`.
2. **Tier B — natural structured mutation.** A request such as `I want to play 492 to 516 at
   50 and get to 64, fifteen times` becomes a typed draft. CodaKiller repeats the parsed piece,
   range, tempo, target, method, and criterion concisely; mutation occurs only after acceptance.
3. **Tier C — coaching or ambiguous context.** Open questions and uncertain numerical or score
   references may produce a grounded answer or clarification. They never mutate practice state
   until Christian explicitly approves a typed action.

The Brain may help parse or propose Tier B/C content, but it has no direct hot-loop authority.
All writes go through bounded deterministic commands with validation, a receipt, and an undo path.

## Representative narrated moments

These moments seed the curated fixtures. Timestamps identify the approximate narration start;
they do not authorize musical conclusions about the audio between speech segments.

| Source | Approx. time | Narration / situation | Required CodaKiller behavior |
|---|---:|---|---|
| Scherzo 1 | 00:00:04 | `from measure 516, because that's where I left off` | Recall or draft m.516 as the resume point; show the recalled tempo/issues; confirm before changing active state. |
| Scherzo 1 | 00:00:29 | `Two, three, sixty-three quarter note` | Treat the leading numbers as ambiguous; confirm 63 BPM rather than guessing. |
| Scherzo 1 | 00:06:53 | page turn at `5:23` | Permit an optional m.523 page-turn note; the pause itself is inert. |
| Scherzo 1 | 00:14:45 | `I missed the E` | When explicitly accepted as the verdict, record one failed attempt, save `missed E`, and reset the consecutive-clean streak. |
| Scherzo 1 | 00:16:12 | `right-hand dog rhythm` | Preserve the raw transcript; propose `right-hand dotted rhythm` only in method context and require confirmation. |
| Scherzo 1 | 00:31:59 | `write down that B` | Draft a section note/mark at the selected context; persist only after confirmation. |
| Scherzo 1 | 00:33:16 | `practice it 10 times, 5 times` | Offer an editable consecutive-success criterion; never infer that playing fulfilled it. |
| Scherzo 1 | 01:13:04 | blocking/miming the E-flat | Change or draft the practice method; do not count a full-passage rep. |
| Scherzo 1 | 01:21:04 | transition `from 43` while working in the 500s | Context may suggest m.543, but CodaKiller must ask rather than silently expand the number. |
| Scherzo 1 | 01:25:29 | larger pass to test retention | Close/isolate the micro-drill and open an integration or retention stage without erasing its history. |
| Scherzo 1 | 01:27:07 | `It's kind of hurt now` | Pause the metronome and active practice flow, save a safety receipt, and offer a break; no rep. |
| Scherzo 2 | 00:00:00 | next-day return; prior tempo was slow; start at 50 | Recall yesterday, ask today's goal/time, and draft a slower consolidation start. |
| Scherzo 2 | 00:02:26 | bad rep; restart from 484 | Record only an explicit verdict; permit immediate range correction/restart. |
| Scherzo 2 | 00:04:54 | session goal m.492–516 | Save an ephemeral session goal and make the current plan visible. |
| Scherzo 2 | 00:07:32 | silence/scattered notes while finding the passage | No rep, fault, or state mutation. |
| Scherzo 2 | 00:08:28 | stopped before the requested end | Wait for Christian's explanation or verdict; do not infer a partial failure. |
| Scherzo 2 | 00:10:31 | tempo 60; ask how focus felt | Set tempo only from explicit/confirmed intent; allow a short self-report on focus. |
| Scherzo 2 | 00:11:11 | `forget the last one` | Atomically void/undo the last rep and recompute derived streak/quality state. |
| Scherzo 2 | 00:12:54 | synchronize left and right hands; tempo 65 | Re-spec the active stage to hands/coordination without losing prior attempts. |
| Scherzo 3 | 00:00:55 | Christian reports the left hand entered early | Store his reported issue; do not claim acoustic detection. |
| Scherzo 3 | 00:03:57 | verify before writing in the score | Ask before creating a Tricky Section or score mark. |
| Scherzo 3 | 00:05:40 | E instead of C-sharp; RH dotted then both hands slow | Log the declared issue and draft the two-stage method for approval. |
| Scherzo 3 | 00:11:09 | constant loops/restarts | No automatic attempts or errors; only explicit verdicts count. |
| Scherzo 3 | 00:18:17 | left-hand-only work | Change/draft the hand scope; never call the absent right hand wrong. |
| Scherzo 3 | 00:19:00 | isolated technical jump | Track the method and Christian's self-report, not score rhythm accuracy. |
| Scherzo 3 | 00:23:04 | transition from 487 | Create/resume a transition subsection quickly, preserving its parent Region. |
| Scherzo 3 | 00:28:37 | `I didn't make any note mistakes` | Believe the user and permit correction; there is no mic grade to defend. |
| Scherzo 3 | 00:29:12 | request for a brief advance C-sharp reminder | Provide a pre-pass cue or visible focus note; never claim live acoustic score-following. |
| Griffes | 00:00:00 | new piece; notes largely unknown | Set/draft note-acquisition state and ask for a bounded goal. |
| Griffes | 00:07:25 | writing measure numbers during silence | No action. |
| Griffes | 00:07:55 | m.31, separate hands | Select/draft range and hand scope; correction to m.30 must be immediate. |
| Griffes | 00:08:45 | Christian notices a static top E | Save only as his observation or send it to grounded Brain analysis. |
| Griffes | 00:09:09 | ambiguous `three, four ... 43 ... 30 quarter note` | Require tempo clarification; never execute multiple guessed numbers. |
| Griffes | 00:15:57 | blocked-chord sequence | Tag the method; count only explicitly reported attempts. |
| Griffes | 00:17:52 | repetition is the main request | Create an editable consecutive-success target with visible attempts and streak. |
| Griffes | 00:21:37 | `one more` / `five more`; accept pushback | Adjust the target and plan immediately, retaining the audit trail. |
| Griffes | 00:29:53 | remove metronome to work on synchronization | Stop only on explicit intent; preserve the stage as no-metronome work. |
| Griffes | 00:38:04 | draw alignment lines | Draft an annotation on the selected score context; confirm before save. |
| Griffes | 00:40:49 | phone interruption | Ignore; do not create a rep or end the block. |
| Griffes | 00:54:11 | slow to 30 BPM | Confirm and set 30; retain the prior tempo history. |
| Griffes | 01:01:34 | hour-long debrief with limited progress | Produce an honest summary and a concise, editable next entry point. |

## ASR corruption contract

The corruption fixtures must include both positive equivalence cases and fail-safe ambiguity cases.

### Required variants

- Measure/time punctuation: `516`, `five sixteen`, `5:16`, `5-16`, `5 16`.
- Lost hundreds: `43` while the active context is in the 500s.
- Measure confusion: `5-8` for 508; `446, 468`; `500, 510`.
- Piece aliases: `Griffes`, `Griffiths`, `griff`.
- Method aliases: `dotted rhythm` / `dog rhythm`.
- Beat-unit aliases: `quarter note` / `chord note`.
- Number homophone/tense: `bump it up four` / `bumped it up for`.
- Progressive revisions: `Metronome 90` followed about 213 ms later by `Metronome 96`.
- Identical-final resends 0.5–2.3 seconds apart.
- Long chunks containing a possible command token inside ambient explanation.
- Repeated Whisper phrases emitted over piano spans.

### Required safety assertions

- An explicit tracker phrase containing `5:16 to 5:30` must never open measures 5–16.
- A lost hundred may produce a clarification draft, never a silent contextual expansion.
- A progressive ASR revision executes only the settled final action.
- Transport-level duplicate finals create one action.
- Genuine rapid micro-reps must remain possible without trusting a 2.5-second text-only dedup
  heuristic; use an utterance identity/boundary or a deterministic batch command.
- `no thanks`, `again, like you have to recognize that`, and `again, just to double check` are
  ambient negatives even while a block is open.
- `no, shoot, I got it wrong` is a positive failed self-report when in the active practice context;
  an immediate identical ASR resend must not create a second rep.
- `I missed the E` must be supported through an explicit deterministic form or a confirmed Tier B
  draft; it must not be silently discarded after confirmation.

## Fixture schema

Deterministic fixtures should be JSONL. Each row represents one adjudicated speech/state moment:

```json
{
  "id": "s3-0049",
  "source": "scherzo3",
  "at_ms": 340030,
  "raw_text": "I played E instead of C sharp",
  "state_before": {
    "piece": "Scherzo",
    "range": [468, 492],
    "block_active": true,
    "method": "integration",
    "hands": "both",
    "bpm": 55,
    "success_mode": "consecutive",
    "streak": 2,
    "target_streak": 5
  },
  "classification": "explicit_self_report",
  "authority": "tier_a",
  "expected_events": [
    {"kind": "rep_recorded", "verdict": "failed", "note": "E instead of C-sharp"},
    {"kind": "streak_reset", "from": 2, "to": 0},
    {"kind": "issue_observed", "text": "E instead of C-sharp"}
  ],
  "forbidden_events": [
    "audio_grade",
    "automatic_score_mark",
    "automatic_drill_start"
  ],
  "ack_key": "rep_failed_noted"
}
```

Required fields are `id`, `source`, `at_ms`, `raw_text`, `state_before`, `classification`,
`authority`, `expected_events`, and `forbidden_events`. Assert canonical events and final state,
not incidental prose. Exact spoken-string snapshots belong only to a small speech-hygiene suite.

## Planned replay lanes

None of these lanes is passing until a future run records implementation, command, date, and
result. A unit test that merely loads the fixture is not a passing replay.

### Lane A — raw transcript firewall

- [ ] Replay all 1,309 ordered transcript segments with source timestamps.
- [ ] Replay/adjudicate idle, metronome-running, and active-block contexts where relevant.
- [ ] Ambient narrative produces no durable mutation.
- [ ] Only manually allowlisted explicit self-reports/commands may act.
- [ ] Preserve sequence timing for duplicate/revision tests, but do not treat Whisper segment end
  offsets as speech duration.
- [ ] Record every unexpected routed intent with fixture id and before/after state.

### Lane B — curated semantic moments

- [ ] Curate at least 12 high-value moments per recording (at least 48 total).
- [ ] Cover resume, goal, range correction, tempo, mode/hand/method changes, verdicts, notes,
  undo, score-mark drafts, safety, block close, retention, and session close.
- [ ] Verify Tier B requests create a draft before mutation.
- [ ] Verify every accepted mutation emits a visible receipt and is undoable.

### Lane C — ASR corruption matrix

- [ ] Cover every variant and safety assertion in the ASR section above.
- [ ] Test progressive hypotheses separately from identical final resends.
- [ ] Test raw and normalized text so normalization itself cannot hide a wrong range.
- [ ] Treat unresolved numeric ambiguity as clarification, never best-guess execution.

### Lane D — stateful session scenarios

- [ ] **Scherzo 1 — resume and transition:** resume m.516 around 63; explicit failures/notes;
  tempo changes; page-turn note; isolate m.536; five consecutive; integrate from m.531 and later
  m.468; pain pauses the flow.
- [ ] **Scherzo 2 — next-day consolidation:** recall prior work; ask goal/time; start around 50;
  goal m.492–516; hunting is inert; correct/undo; re-spec hands/synchronization; retain next step.
- [ ] **Scherzo 3 — confirm and mark:** no-metronome start; Christian reports LH early; score mark
  requires confirmation; RH dotted then both hands slow; loops inert; user correction wins;
  larger pass preserves micro-drill history.
- [ ] **Griffes — new-piece acquisition:** resolve piece alias; goal m.30–36; separate hands and
  blocked chords; tempo 40 then 30; phone/silence inert; close with honest debrief and next action.

### Lane E — mastery mechanics

- [ ] Clean increments the consecutive-clean streak by one.
- [ ] Flawed and failed attempts reset that streak to zero.
- [ ] Reset attempts remain in total attempts and quality history.
- [ ] A five-in-a-row block cannot finish after five total attempts containing any flaw/failure.
- [ ] Block completion uses its declared success criterion, not merely `reps_done >= planned`.
- [ ] Variants/stages do not advance because failed attempts consumed ordinal slots.
- [ ] `undo last rep` atomically voids the attempt and recomputes streak, verdict totals, tempo
  consequences, variant stage, receipts, and export state from canonical history.
- [ ] `restart streak` is distinct from voiding a mistaken log; it preserves honest attempts.
- [ ] Closing early records incomplete/abandoned honestly instead of fabricating mastery.
- [ ] Slow clean work may count as practice but does not imply target-tempo or retention readiness.

### Lane F — property and invariant tests

- [ ] No waveform-derived grade, diagnosis, position, tempo, note, hand, or rep event exists.
- [ ] No ambiguous number mutates range, tempo, target, reps, page, or measure.
- [ ] No suggestion starts a drill without Christian's acceptance.
- [ ] Silence, playing, loops, restarts, page turns, score writing, and phone interruptions are inert.
- [ ] Selected piece, range, hands, method, tempo, success criterion, streak, attempts, and latest
  receipt remain inspectable after every mutation.
- [ ] User correction wins over a draft or prior self-report and leaves an audit event.
- [ ] A piece switch cannot leak range, block, issue memory, or last-rep state across pieces.
- [ ] Session export equals canonical accepted/voided event history after relaunch.
- [ ] The Brain cannot directly grade, start/alter a block, change tempo, mark the score, or schedule
  work; a validated confirmed action boundary owns those writes.
- [ ] Speech hygiene keeps measure/tempo wording speakable and prevents blank or markdown TTS.

### Lane G — raw-audio speech acceptance

This is an installed-app/local-hardware lane, not deterministic CI and not a music-analysis lane.

- [ ] Verify each WAV hash before use.
- [ ] Create manually adjudicated speech clips with listening-confirmed boundaries; do not cut
  blindly from Whisper segment end offsets.
- [ ] Measure command recall for Christian's speech over/around real piano.
- [ ] Assert zero state mutations during adjudicated piano-only spans.
- [ ] Assert raw playing never creates a rep or musical verdict.
- [ ] Test the installed app's actual recognizer, permissions, wake-word setting, half-duplex gate,
  TTS bleed behavior, and concise acknowledgement path.
- [ ] Run a final at-Steinway acceptance session; prerecorded WAV success is not a substitute.

## Pass record template

Do not change the status at the top to passing until all required lanes have an honest result.
When implemented, append—not prefill—one row per run:

| Date | App/build | Lane | Command or installed procedure | Result | Failures/fixes |
|---|---|---|---|---|---|
| _not run_ | — | — | — | **PLANNED** | Contract only |

## Release gate

CodaKiller v2 is not ready for narrated-practice acceptance until:

1. deterministic fixtures and the replay runner exist;
2. Lanes A–F pass with saved output;
3. Lane G passes on the installed app without grading piano;
4. every discovered false mutation or missed required action is fixed and re-run;
5. the human at-piano checklist confirms that the flow is faster, clearer, correctable, and less
   intrusive than the recorded sessions; and
6. the result is logged in the project changelog/version/update protocol at the time it actually
   happens.

Until then, this document remains **CONTRACT / PLANNED — NOT PASSING**.
