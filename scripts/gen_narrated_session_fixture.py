#!/usr/bin/env python3
"""Deterministically convert the real griffes narration into a stateful
replay fixture. This is the mechanical converter the batch slice will reuse:
verbatim raw_text + at_ms from the source, plus a per-segment adjudication.

Every griffes segment is note-hunting narration; the contract's firewall must
route all of them to `ignored` and mutate no state. The adjudication buckets
are documentation/taxonomy — the harness asserts routed==expected regardless."""
import json, collections

SRC = "/Users/c3/piano-coach/test_assets/narrated/griffes_narration.json"
OUT = "/Users/c3/codakiller/src-tauri/tests/fixtures/narrated_session_griffes.json"
WAV_SHA = "48f2780ce73b70bca71783a82890e88a5a29d5a20fab667042a2f16922a1b42b"

# index -> (classification, basis, checkpoint|None)
# checkpoint asserts the running invariant AFTER the segment is processed.
IDLE = {"metro_running": False, "block_active": False}
OV = {
 0:  ("ambient_ignored", "New-piece acquisition narration (contract Griffes 00:00): naming the piece, no command token.", IDLE),
 6:  ("ambient_ignored", "'I'm still note hunting' — narration; no command token.", None),
 11: ("ambient_ignored", "'I don't have measure numbers. Give me a moment.' — no numbered command is issued.", None),
 12: ("ambient_ignored", "Explicit 'Don't, don't do anything' during silence (contract Griffes 07:25 → no action).", IDLE),
 13: ("ambient_ignored", "'recognize when it's silence' — silence span is inert.", None),
 14: ("correction", "Measure self-correction 30→31 (contract Griffes 07:55: correction must be immediate) but NO range command is open, so it is inert.", IDLE),
 15: ("ambient_ignored", "'practice it separate hands' — Tier C method narration; would need a confirmed Tier B draft, not a hot-loop command.", None),
 18: ("ambient_ignored", "Observation that the top voice is a static E until m.35 (contract Griffes 08:45: save only as an observation).", None),
 19: ("ambient_ignored", "'just going to note that E' — observation, persisted only via draft/confirm; firewall takes no hot-loop action.", None),
 20: ("asr_ambiguity", "Buried 'turn the metronome on' PLUS ambiguous 'so 43 quarter and 30 quarter note' (contract Griffes 09:09): multiple guessed numbers must never execute; the firewall yields NO metronome start.", {"metro_running": False, "block_active": False}),
 21: ("ambient_ignored", "Fingering/measure number narration ('five, two ... three, two'); bare numbers never route.", None),
 23: ("correction", "Fingering self-correction ('go back to three ... no, keep four'); inert — no active state to correct.", None),
 36: ("firewall_rejection", "Buried 'turn metronomal' (misheard metronome) + '40 quarter note'; not a clean metronome command → ignored.", {"metro_running": False}),
 37: ("correction", "'go from 30 actually, not 31' self-correction; inert (no active range/tracker).", None),
 39: ("ambient_ignored", "'sequence of chords from 30' — describing intended work; no command shape.", None),
 44: ("ambient_ignored", "Meta-coaching about repetition (contract Griffes 17:52): descriptive, not a hot-loop command.", None),
 45: ("ambient_ignored", "'It's just listen and make me do repetition' — instruction to the coach, not a command grammar match.", None),
 48: ("ambient_ignored", "'That was a pause ... it doesn't mean I didn't play it' — a pause is inert; no rep.", None),
 49: ("ambient_ignored", "Continues: the pause creates no rep and no state change.", None),
 50: ("ambient_ignored", "'you should be saying one more time or five more times' (contract Griffes 21:37): describing a desired target, not issuing one.", None),
 56: ("firewall_rejection", "Buried 'without the metronome first to get the syncing right' (contract Griffes 29:53 remove metronome): narration, no clean stop command → no metronome mutation.", {"metro_running": False}),
 57: ("firewall_rejection", "'I'm going to draw lines. Tell me if to draw lines' (contract Griffes 38:04 alignment lines): an annotation must be a confirmed draft, never auto; firewall ignores.", None),
 59: ("ambient_ignored", "Phone interruption 'it was on my phone. Sorry.' (contract Griffes 40:49): ignored — no rep, block not ended.", IDLE),
 67: ("firewall_rejection", "Buried 'slow it down ... it's 30 quarter note now' (contract Griffes 54:11 slow to 30): ASR narration, not a clean tempo command; an actual set to 30 would require confirmation / a Tier B draft.", {"metro_running": False}),
 68: ("ambient_ignored", "'slowest metronome tempo I can go. Ready?' — contains 'metronome'/'tempo' but no command shape.", None),
 70: ("ambient_ignored", "Hour-long honest debrief begins (contract Griffes 01:01:34): narration → no action.", IDLE),
 78: ("ambient_ignored", "Final debrief line ('Let me try again') outside any rep block → inert.", {"metro_running": False, "block_active": False, "attempts_recorded": 0}),
}

data = json.load(open(SRC))
segs = data["transcription"]
out_segs = []
for i, s in enumerate(segs):
    cls, basis, cp = OV.get(i, ("ambient_ignored", "Note-hunting narration; no command token.", None))
    seg = {
        "id": f"griffes-{i:04d}",
        "at_ms": s["offsets"]["from"],
        "raw_text": s["text"],
        "classification": cls,
        "classification_basis": basis,
        "expected": {"kind": "ignored"},
    }
    if cp is not None:
        seg["checkpoint"] = cp
    out_segs.append(seg)

fixture = {
    "schema": "codakiller.narrated_session_replay.v1",
    "session_id": "griffes",
    "piece_alias_hint": "Griffes",
    "source_wav_sha256": WAV_SHA,
    "source_narration_json": SRC,
    "segment_count": len(out_segs),
    "wake_word": None,
    "initial_state": {"metro_running": False, "metro_bpm": None, "block_active": False},
    "honesty_note": (
        "Griffes is a 79-segment new-piece note-hunting session. Every segment is "
        "ambient narration or a buried/ASR-ambiguous command token that the deterministic "
        "firewall must route to `ignored` with ZERO durable state mutation. There are no "
        "genuine hot-loop commands in this recording; that is the honest result, and the "
        "checkpoints assert the invariant at every contract-named boundary. Classifications "
        "are adjudication metadata; the assertion is routed-intent == expected plus the "
        "checkpoint state."
    ),
    "segments": out_segs,
}
json.dump(fixture, open(OUT, "w"), indent=2, ensure_ascii=False)
print("wrote", OUT, "segments:", len(out_segs))
buckets = collections.Counter(s["classification"] for s in out_segs)
print("buckets:", dict(buckets))
ats = [s["at_ms"] for s in out_segs]
print("monotonic non-decreasing:", all(ats[i] <= ats[i+1] for i in range(len(ats)-1)))
print("checkpoints:", sum(1 for s in out_segs if "checkpoint" in s))
