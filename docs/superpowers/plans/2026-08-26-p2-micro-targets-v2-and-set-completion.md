# P2 — Micro-targets v2, set completion, voice silence

**Status:** approved by Christian's 2026-08-26 feedback message (which supersedes
the P2 slot's original sequencing).
**Releases:** v7.1.1 (Tasks A + B, ships first — they block practice today),
then v7.2.0 (Task C, the headline rebuild).

---

## Why this plan exists

Christian's verdict on what v7.1.0 shipped: *"the sub section selecgtion box is
terrible. you didnt listen to what i wanted."* That is a correct judgement, and the
plan below argues from his own words rather than from the spec's paraphrase of them.

Three defects, in his priority order but not his fix order — A and B are small and
block every set he runs today, so they ship first.

### What he actually asked for (Aug 8 notes, verbatim)

> "When I have a practice section selected, instead of having to manually type in what
> measures im practicing for a set, I should just be able to make a quick selection box
> within the bigger selection box of the section im practicing and just be able to
> practice that small part and have that selection box appear when I click a specific
> practice section … it should be able to basically just estimate where it is but it
> shouldnt even really matter what measure numbers it records because it is just for me
> to select and see what ive practiced."

> "these selection boxes should stay so that I can come back and keep practicing that
> same little spot later on and it isn't just a one off thing — Obviously the score
> would get too crowded so these mini selection boxes should only appear when you click
> on the passage they are apart of, and you should be able to hide them"

And on 2026-08-26:

> "i should have a button within that thing that allows me to just select what measures
> i want to play with the select box **as a replacement for having to type what measure
> range i am doing** … it **shouldnt require me to type anything at all** … i
> **shouldnt have to name it at all** because it is already part of the named selection
> box."

### Why what shipped fails that

Traced in the code, not assumed:

| His requirement | What v7.1.0 does | Where |
|---|---|---|
| A button inside the selected section | No button. A *checkbox* buried in the "+ Add" form | `ScoreView.tsx:3115` |
| No typing | `createRegion` hard-rejects an empty title AND requires a measure range | `ScoreView.tsx:2092-2100` |
| Measures inferred | Only if a measure map exists. **The live DB has zero map rows (B75)** — so on his actual scores it is *always* typing | `ScoreView.tsx:2180-2186` |
| No naming | `normalized_region_name` rejects empty; the form demands a title | `crud.rs:166-172` |
| The box persists and is visible | Creation leaves the child with **no anchor** and drops him into marks mode to draw it *again* | `ScoreView.tsx:2129` |
| Children shown only when parent is selected | True in the LIST, false on the SCORE — `overlayItems` maps every region unconditionally | `ScoreView.tsx:2045-2057` vs `:1544` |
| Hideable | Does not exist | — |

So the gesture he described as "frictionless" currently costs: select → drag → type a
name → type two measure numbers → click create → drag the box a second time. Six steps,
two of them typing, one of them redundant. "Terrible" is accurate.

The backend is not the problem — `region_create_with_parent` already enforces the
one-level rule and writes the linkage (`crud.rs:242-300`). This is a front-end
friction problem, and the fix belongs almost entirely in `ScoreView.tsx`.

---

## Task A — Silence the spoken acks (v7.1.1)

**His ask:** *"i dont want the voice to talk when i say again or restart sets or
anything just have that turned off for now."*

**The choke point.** Every spoken word in the app goes through one trait method:
`AckPlayer::say` (`voice_loop.rs:325-328`), which calls `Speaker::speak_blocking`.
The chime (`AckPlayer::chime`) is a separate PCM path and is *not* talking — it is the
"heard you" blip. So muting speech does not have to mean losing the acknowledgement.

**Design.** `AckPlayer` gains a shared `Arc<AtomicBool>`; when speech is muted,
`say()` **falls through to `chime()`** rather than going silent. He still gets
confirmation that the command registered; the app just stops narrating. The gate
cycle is identical either way, so the half-duplex contract (`voice_loop.rs` module
docs) is untouched.

- New setting `voice.speak_acks`, **default `false`** (muted), following the
  `rep.demote_enabled` pattern exactly (`settings.rs:195`, `:334`).
- Surfaced in Settings as "Speak confirmations aloud" with a caption saying the ack
  chime still plays — per §4b, a thing that is off must say so, not just be absent.
- `voice_speak` (the Brain answer path, `lib.rs:2459`) respects the same flag.
- The flag lives on `VoiceLoop`; settings writes push it through immediately (no
  restart), because a mute the user cannot verify instantly is a mute they will not
  trust.

**Tests.** `AckPlayer::say` chimes instead of speaking when muted; unmuted behaviour
byte-identical to today; the setting round-trips and defaults to muted; junk stored
value falls back to muted. Existing `tts_gate.rs` / `tts_live.rs` are unaffected
because the flag defaults to *unmuted* inside the `tts` crate boundary — only the app
sets it false.

## Task B — The set must finish itself (v7.1.1)

**His ask:** *"when i hit 5 out of 5 it just stays at 5/5 and i have to close the set,
manually X the one i just did and move onto the next variation it doesnt do it
automatically. same thing happens even if its not a variaton chain it just stays 5/5
and i have to like manially x out of it. it should close after a few seconds and move
on (not just close instantaneously)."*

Two distinct bugs hide in that sentence.

### B1 — A chained set declares mastery after the FIRST variant

`variant_stage()` (`ladder.rs:177-217`) does advance stages correctly. But the mastery
rule above it (`practice_v2.rs:701-705`) satisfies the set as soon as
`eligible >= effective_required_success` — which happens at the end of stage one.
The chain-aware rule immediately below it (`:710-715`) is gated on
`row.target_bpm.is_none()`, so **any set with a target tempo ignores the chain
entirely.** He sets a target tempo. Hence: 5/5, set over, chain abandoned, and he has
to close it and delete the finished variant chip to continue — exactly what he
described.

**Fix.** When a set has variants, the chain governs completion:

```
if !row.variants.is_empty() {
    mastery = if chain_complete { Satisfied } else { NotSatisfied }
}
```

This deletes the `target_bpm.is_none()` special case rather than adding a second one.
It is also the honest reading of his Aug 8 note — *"after I do like five in a row for
the first variation(dotted) then it automatically moves me onto the next
variation(reverse dotted), then the next(stacatto), and so on"* — the chain **is** the
set. The ladder keeps running underneath; it just no longer ends the set early.

Earned-only law: this makes mastery *harder*, never easier. Nothing is granted.

### B2 — Nothing closes a finished set

`completionFx.tsx:34-58` plays a 1.1 s flourish and stops. There is no timer anywhere
(confirmed: `rep_close` at `lib.rs:738` is the only close path and only the Close
button calls it, `RepHud.tsx:534`).

**Fix.** A new `useSetCompletion` hook: when `mastery_status` flips to `satisfied`,
count down from 6 s and then call the existing close path. The HUD shows a completion
banner — "Set complete · closing in 4…" — with a **"Stay open"** button that cancels
the countdown permanently for that set. Explicitly *not* instantaneous, per his
parenthesis. The countdown is cancelled by any new attempt, by pausing, and by
closing manually; it never fires twice for one set.

The banner carries `data-compact-visible` so B82 cannot repeat — it must be visible
at 720×520 collapsed, and the screenshot proves it.

**Also (B3, small):** while a chain is running the HUD headline must be the *stage*
counter, not the mastery streak, so "5/5 → 0/5, staccato" reads as the advance he
asked for instead of a number that freezes. `variant_stage_*` is already on the
snapshot (`model.rs:832-851`); A2 rendered it as a small span (`RepHud.tsx`), which is
why the advance was invisible. Promote it.

**Tests.** Chain + target tempo does not satisfy at stage one (this test fails against
today's code — that is the point); chain completion satisfies with or without a
target; countdown fires once, cancels on "Stay open", cancels on a new attempt;
headline shows stage progress while chained; density test at 720×520.

## Task C — Micro-targets v2 (v7.2.0)

The rebuild. Spec §5.8's P2 section already describes this ("Zero-mode creation …
**no form**"); his message sharpens two points the spec under-weighted — the **button**
(he should not have to know a gesture) and **inference without a map** (the spec
assumed the map would be there; B75 says it is not).

### C1 — The button

While a section is selected, its panel shows a primary action: **"⊕ Isolate a spot"**.
Armed, the cursor becomes a crosshair over that section's boxes and a floating chip
reads "Drag a small box inside {name} · Esc to cancel". This is the "button within
that thing" he asked for, and it makes the gesture discoverable instead of secret.
The existing drag-inside-a-selected-parent gesture keeps working and takes the same
path — the button is an additional entrance, not a replacement.

### C2 — Zero-friction creation

On pointer-up the child **exists**. No form, no dialog.

- **Name:** auto `"Spot 1"`, `"Spot 2"` … numbered per parent (max existing + 1, so
  deleting one does not reuse its number). He never types or sees a naming prompt; the
  list renders it as a child of the named parent, which is his "it is already part of
  the named selection box".
- **Measures:** measure map when present; otherwise **interpolated** from the parent's
  own `m_start..m_end` by where the drag landed inside the parent's anchor rects
  (reading order: page, then y, then x). Clamped into the parent's range. This is
  precisely his *"it should be able to basically just estimate where it is but it
  shouldnt even really matter what measure numbers it records"* — and it is the piece
  that makes zero typing possible on his real, unmapped scores.
- **Anchor:** the dragged rect is written as the child's `pdf_anchor` for the current
  edition **in the same operation**. No second drag. This is the single biggest
  friction removal.
- **Undo:** a toast — "Spot 2 · Undo" — for ~8 s. An instant-create gesture needs an
  instant escape; without it an accidental drag leaves litter.

The pure parts (`estimateSpotMeasures`, `nextSpotName`) go in a new
`src/features/score/microTargets.ts` so they are unit-testable without a DOM — the
jsdom-green-≠-app-works rule means the geometry must be provable in isolation *and*
shown in a screenshot.

### C3 — They stay, and they hide

- `overlayItems` gains the same gating the list already has: a child renders on the
  score only when its parent is selected, or when the child itself is selected.
- Per-parent **"Hide spots"** toggle in the section panel, persisted per piece via the
  existing `set_setting` seam (no schema change).
- Distinct calm styling: dashed 1.5 px border, ~10 % fill, so a spot never reads as a
  full tricky section.

### C4 — One click to practise

A selected child shows a **"Practice this"** chip on the box itself. It opens the
composer prefilled — child's range, parent's context, 3-in-a-row (the existing
sub-section default, `ScoreView.tsx:2553-2560`) — or resumes that child's paused set
if one exists. Click box → click chip → first rep. Two gestures, which is the spec's
stated acceptance bar.

**Tests.** Interpolation across single-rect, multi-rect and multi-page parents, and
the clamp; name numbering including after a delete; creation writes the anchor in one
call (asserted against the mock, since this is the bug that made the feature useless);
score-side gating; hide toggle persists; "Practice this" prefill; undo removes the
region; 720×520 screenshots **showing the button and a spot box**, per §4b.

**Acceptance (his words, not mine):** he selects Rolled Chords Accuracy, clicks the
button, drags over half a measure, and is practising it — having typed nothing and
named nothing. And tomorrow he selects Rolled Chords Accuracy and the spot is still
there.

---

## Gates (unchanged, non-negotiable)

vitest full · `cargo test` UNFILTERED with `filtered out: 0` · `cargo clippy
--all-targets --all-features` · `./node_modules/.bin/tsc` · narrated corpus finals +
partials zero false mutations (Task A touches the voice path, so this gate is live) ·
devMock covers every new command · 720×520 screenshots showing the affordance itself ·
§4b 10-second find-it test.

No schema change in either release — Task A is a setting, Task B is derived, Task C
reuses `target_meta.parent_region_id`. So no migration rehearsal is required, and that
claim is verified by diffing `migrations.rs` before release, not assumed.
