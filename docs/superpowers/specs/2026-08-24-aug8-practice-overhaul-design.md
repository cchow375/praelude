# CodaKiller — Aug 8 Practice Overhaul (organized asks, designs, plan of attack)

> **Status:** APPROVED rev 3 as-built truth. P0–P2 shipped in v7.0.1–v7.2.0; P3–P6 and the
> earned-motivation redesign shipped together in **v8.1.0/schema 19 on 2026-08-27**. Exact final
> source/artifact facts are recorded in the v8.1 version record. Release tag `v8.1.0` points to
> `0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed; private `origin/main` is current
> through the post-tag documentation correction.
> Real-provider B5 and packaged-native microphone/Steinway acceptance remain explicitly open.
> **Rev 3 (2026-08-27):** corrects the denominator from 21 to **23** (the table always contained
> 23 IDs), records Christian's final decisions (Assistant OFF; archive + recent-first, no folders;
> keyboard figures; session-temporary takes), and maps the now-present P3–P6 source. It also
> records the user-requested motivation follow-up: the decorative galaxy is replaced by
> canonical focused-minute XP, deterministic levels, earned badges, exact next milestones and
> 28-day cadence. The later release evidence below converts those source statuses to installed fact.
> **Rev 2 (2026-08-25):** Christian's verdict on rev 1: _"I see no selection box thing
> within the selection box in my app. It was not shipped or it is very bad… everything I'm
> asking for is because I don't see it."_ Diagnosis confirmed him right (§3): sub-sections
> are fully coded but functionally invisible — creation is gated behind an unexplained
> select-in-list-then-drag sequence — and hidden-by-default is the app's pattern, not a
> one-off. Rev 2 flips the stance: **"shipped" claims count for nothing; visible at the
> piano is the only done.** Statuses re-graded, a visibility standard added (§4b), the
> micro-target redesign promoted to its own early phase, and every phase now carries a
> discoverability gate (§8).
> **Source:** Christian's Aug 8 feedback dump (the sixth real-use feedback round), written
> before v6.0.0 (Aug 18), v6.0.1 (Aug 21), and v7.0.0 (Aug 24) shipped.
> **Grounding:** 7-scout read-only recon of the v7.0.0 codebase + vault (2026-08-24), plus
> a 2-scout reachability/discoverability diagnosis (2026-08-25). Exact file:line anchors
> throughout.
> **How to execute:** see §8. Each phase gets its own implementation plan in the
> writing-plans format at phase start; this document is the spec those plans argue from.

---

## 1. The asks, organized

The Aug 8 dump normalizes to **23 discrete asks** (duplicates merged — tempo demotion is
stated twice, sub-selections three times, "less friction" throughout). Status codes:
**NEW** = not built anywhere · **PARTIAL** = some machinery exists · **INVISIBLE** =
code exists but a real user cannot find or feel it in normal practice (rev 2's honest
re-grade of rev 1's "SHIPPED?") · **SOURCE** = implemented with its focused gates green,
but not yet packaged or installed · **SHIPPED** = present in the installed app · **GATE** =
blocked on a decision only Christian can make. Documentation records evidence; Christian's
normal-use verdict is still the acceptance authority.

| ID  | Ask (his words, condensed)                                                                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                               | Phase                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A1  | 3 sloppy in a row → step the metronome tempo back down an increment; 2 more → down again; togglable/tunable ("there needs to be more punishment")                                                           | **SHIPPED v8.1.0.** The global sloppy-only demotion remains; the composer adds inherit / off / set-local first+repeat thresholds, and the HUD keeps the visible demotion moment.                                                                                                                                                                                                                                    | P1 + v8.1 correction              |
| A2  | Variant chains: queue of practice modes (dotted, reverse dotted, staccato, tenuto, legato + custom), 5-in-a-row each, auto-advance                                                                          | **SHIPPED v7.2.0.** v7.1.0 introduced visible chains/streak stages; v7.2.0 fixes B86 so every stage governs mastery, attempts follow the clean-streak stage, recovery debt remains earned-only, each intermediate stage chimes exactly once, and recovery synchronously defeats the guarded final auto-close.                                                                                                   | P1 + v7.2 correction              |
| A3  | Practice-set window layout: variants right under Practice focus, above clean-streak target; tempo ladder / attempt review boundary / one-pass demoted to a bottom dropdown ("taking up WAY TOO MUCH SPACE") | **SHIPPED through v7.2.0.** The v7.1 composer hierarchy remains; v7.2 keeps variant name and consecutive-clean target readable at 720×520.                                                                                                                                                                                                                                                                     | P1                                |
| A4  | Timed rotation through chosen sections (interleaving)                                                                                                                                                       | **SHIPPED v8.1.0.** Add 2+ exact targets to a dock panel, choose minutes/order/shuffle, receive a chime + explicit Next-station prompt; it never yanks a set at the deadline and pauses only its exact owned block. Full-cycle completion is earned once. At 720×520 an unsafe restored/collision position clamps to `y=164`, preserving a 56px Tools reserve.                                                                   | P6                                |
| A5  | Metronome not locked to quarter note, incl. for practice sets                                                                                                                                               | **SHIPPED v8.1.0.** Durable beat value/meter/subdivision shipped earlier; the running HUD adds bounded `sub N` −/+ control. Beat value remains a label for the entered click rate, never a BPM conversion.                                                                                                                                                                                                              | P1 + v8.1 correction              |
| A6  | Verdict hotkeys: space=clean, right-shift=sloppy, return=again; configurable                                                                                                                                | **SHIPPED-CORRECTED v8.1.0.** Defaults and guards shipped in v7.1. Settings remaps now publish to the already-mounted HUD after Save—no reload required—and invalid/duplicate mappings remain rejected.                                                                                                                                                                                                           | P1 + v8.1 correction              |
| A7  | Frictionless add/subtract reps (UI)                                                                                                                                                                         | **SHIPPED v7.1.0.** `+ clean` and `undo last` use the existing receipt/ledger path.                                                                                                                                                                                                                                                                                                                                 | P1                                |
| B1  | Mini selection boxes INSIDE a practice section (2-beat / 5-note micro-targets), persistent, visible only when the parent is clicked, hideable, measure numbers merely estimated                             | **SHIPPED-CORRECTED v8.1.0 atop v7.2.** The direct atomic parent-scoped flow remains; each drag now has a durable command identity and one bounded same-identity retry. A lost post-commit reply replays the original Region; same-id/different-geometry conflicts.                                                                                                                                                 | **P0 unlock + P2 + B89 closure**  |
| B2  | Split a piece's PDF into movements (op. 90: mvt 2 starts page 7)                                                                                                                                            | **SHIPPED v8.1.0.** Piece Detail stores title + first PDF page; Score gets Whole score / movement scoping for pages and anchored sections. Zero rows preserves old behavior; history and files are not rewritten.                                                                                                                                                                                                       | P4                                |
| B3  | Selection-box refresh: migrate old pieces' laggy legacy boxes; more contrast, very low opacity but prominent                                                                                                | **SHIPPED v7.2.0.** `ScoreView` mounts one memoized `ScoreOverlay` per page for persisted Regions, mapping/create state and the atlas target draft. Shared styling applies to old pieces automatically; parity and render-count regressions passed.                                                                                                                                                              | P2                                |
| B4  | "Save section" edit UI overlap — fix                                                                                                                                                                        | **SHIPPED v7.0.1.** The editor reflows at the 720×520 floor.                                                                                                                                                                                                                                                                                                                                                        | P0                                |
| B5  | Effective measure mapping with little user input                                                                                                                                                            | **FLOW SHIPPED v8.1.0; LIVE ACCEPTANCE OPEN.** The flow is reachable, teaches prerequisites/provider readiness, refuses Start without a key, states whole-edition upload, and keeps Apply human-gated. No Anthropic key exists and the live DB still has 0 rows, so real-provider effectiveness remains unproven and must not be called accepted.                                                                         | P4 + external acceptance          |
| C1  | Warmups: catalog of techniques, visual, configurable routines targeted at today's repertoire, rep tracking                                                                                                  | **SHIPPED v8.1.0.** Search/filter visual catalog, SVG keyboard figures + how-to text, named ordered routines, per-item BPM/streak and an exact system-piece rep-engine runner. Final installed-native 720×520 passed with no overlay/clipping, **Restore Rep Counter** in Tools and the active set unchanged. Warmup focus counts honestly; the system piece stays out of repertoire surfaces.                             | P5                                |
| C2  | Per-rep self-recording + listen-back BEFORE the verdict, for subjective targets; tiny temp files, auto-deleted, keepable; tuned to hear a piano                                                             | **SHIPPED v8.1.0; NATIVE HARDWARE ACCEPTANCE OPEN.** Opt-in Review automatically records the next take, physically suspends native STT before WebView capture, prompts listen-before-verdict with explicit judge-anyway, deletes temporary bytes unless Keep is selected, and replays kept files with output gain. Mic/Steinway use remains unproven.                                                                 | P6 + native acceptance            |
| C3  | Mute button for the microphone                                                                                                                                                                              | **SHIPPED v7.0.1.** The labelled Mic/Muted rail control is always present when voice is available and explains the disabled state when it is not.                                                                                                                                                                                                                                                                   | P0                                |
| D1  | Voice "done" must work; rep-counter voice as responsive as metronome commands                                                                                                                               | **SHIPPED v8.1.0; AT-PIANO ACCEPTANCE OPEN.** Live-set-only `mark done` / `rep done` / `mark sloppy` / `mark again` partial fast path, immediate verdict chime, persistent last-three final heard feed and live 300–2000 ms settle control. Bare/natural phrases still settle normally. Narrated firewall gates do not replace Steinway use.                                                                           | P3                                |
| D2  | Add/subtract reps by voice                                                                                                                                                                                  | **SHIPPED v8.1.0.** Counted deterministic add-Clean and append-only undo phrases share native projection/receipts, reject over-undo without partial mutation, and stay inside the active-set firewall.                                                                                                                                                                                                                | P3                                |
| E1  | Pieces window: archive old pieces, folders not immediately visible, declutter                                                                                                                               | **SHIPPED v8.1.0 at accepted scope.** Reversible archive/restore, collapsed Archived group and recent-practice-first ordering; destructive file removal is separately named **Delete files…** and history remains. Christian explicitly chose this over folders.                                                                                                                                                      | P6                                |
| E2  | Practice notes displayed next to the active session, renamed toward desired sound ("sotto voce", "grand")                                                                                                   | **SHIPPED v8.1.0.** The active HUD promotes the Region's editable **Sound target** beside the verdict work.                                                                                                                                                                                                                                                                                                            | P6                                |
| E3  | Practice Universe UI overhaul                                                                                                                                                                               | **SHIPPED v8.1.0.** The galaxy is replaced by a legible canonical-evidence dashboard: 1 XP/completed focused minute, deterministic level, badge cabinet, exact next-badge rails, 28-day cadence, progress rails, repertoire evidence and technique aggregate. Quality/verdicts never score; archived/deleted history remains real.                                                                                       | v8.1 motivation redesign          |
| E4  | Assistant UI cleanup                                                                                                                                                                                        | **CLOSED BY ACCEPTED PRODUCT DECISION.** Assistant stays OFF and Rust-gated; tab, Today entry, passage helper, connection controls and Books remain hidden. The off-state Settings guide teaches only the hands-free practice lane; Voice owns settle timing and the enable switch remains findable. Its separate held overhaul is not part of this piano-practice train.                                                   | Accepted cleanup boundary         |
| E5  | End-session crash — fix                                                                                                                                                                                     | **RACE CLOSED v7.1.0.** B56's exporter and opener windows are closed at the session-lifecycle boundary. That proves the race class fixed; it does not retroactively prove every historical crash had that cause.                                                                                                                                                                                                     | P0 + P1 completion                |
| E6  | Much more gamified; "spike dopamine"                                                                                                                                                                        | **SHIPPED v8.1.0.** Level/XP/badges/next milestones/cadence make progress visible; warmup-routine, rotation-cycle and kept-reference-take boundaries join existing earned celebrations. No coins, social pressure, quality grades or UI-granted progress. Sustained-use motivation remains a human verdict.                                                                                                           | v8.1 motivation redesign          |

**Final matrix:** **22 delivered / 1 B5 external-only / 0 absent**. C2 source is delivered; its
real WKWebView microphone and Steinway acceptance remains external rather than absent.

## 2. What he's truly asking for (the brainstorm)

Five intents underlie all 23 asks — plus the meta-finding rev 2 adds as the sixth:

1. **Friction is the enemy of reps.** The recurring sentence is "so I don't have to move
   my hand off the piano." Metric: actions per rep and seconds between reps → zero.
2. **Deliberate-practice science, encoded.** Punishment (demotion), variation (chains),
   interleaving (rotation), micro-chunking (sub-boxes), self-monitoring (record → listen
   → judge), transfer-targeted warmups.
3. **The score is the practice map.** Boxes and sub-boxes that persist and accumulate;
   movements so pages show only what belongs; measure numbers as estimates, never input.
4. **Motivation as a first-class feature.**
5. **Trust and polish.** Crashes, overlapping editors, laggy boxes.
6. **If he can't see it, it doesn't exist.** _"Everything I'm asking for is because I
   don't see it."_ The 2026-08-25 audit proved this is a systemic app pattern, not user
   error: features default to off/hidden/empty and demand multi-step reveals. This is
   now a standard (§4b), enforced by a gate in every phase (§8).

## 3. What the code claims vs. what the piano shows (the 2026-08-25 diagnosis)

Rev 1 called five asks "shipped — verify." Christian's reply refuted that framing, and
the two-scout diagnosis explains why he is right:

- **B1 sub-sections — the smoking gun.** Everything exists: the write path
  (`region_create_with_parent`, `store/crud.rs:249-301`), child rendering when the
  parent is selected (`ScoreView.tsx:1519-1544`), the count badge, passing tests, even
  a tutorial section in `(C) How To Use.md`. But creating one requires selecting the
  parent in the Tricky Sections LIST first, THEN dragging on the score — a rule stated
  nowhere in the app (only in the code comment at `ScoreView.tsx:2130-2132`, and the
  tutorial omits the select-first step too). Worse, the "+ Add" button a user would
  naturally press explicitly clears the parent linkage (`ScoreView.tsx:3006`). There is
  no affordance, no hint, no cursor change. **A feature reachable only by accident is
  not shipped.**
- **The app-wide pattern (discoverability audit, ranked):** variant lanes = open form →
  click "More" → scroll → "+ Add variant" before anything exists; all Practice Dock
  panels (Rep Counter, Paused Sets, Clock, Dynamics) default to CLOSED pills
  (`dockState.ts:72-80`) and can persist minimized forever; the day-streak line renders
  `null` until a streak exists (`StreakLine.tsx:15`); the heard-text pill flashes 1.8 s
  in the lower-left and leaves no trace (`Shell.tsx:1246`, and the promised mic-level
  meter was never built — `HeardPill.tsx:25-36` documents why); "Map measures" renders
  disabled with no explanation until a PDF is ready (`ScoreView.tsx:2618`); completion
  animations last 1.1 s; the dynamics checker requires open-pill-then-calibrate before
  showing anything. Individually defensible; together they produce exactly Christian's
  experience: _the app looks like it doesn't have the features it has._
- **Consequence for this plan:** the earned-only law stays (nothing fake), but
  hidden-by-default stops being the house style for _tools_. Tools are visible;
  _rewards_ are earned.

## 4. Binding constraints (the laws — nothing below may violate these)

1. **User is the sensor; the app is the memory.** Never interprets audio as music. The
   dynamics checker stays loudness-only, forever. C2 recording complies: pure
   record/playback; the human makes every judgment.
2. **Deterministic hot loop.** The LLM is never in the rep/metronome path.
3. **Voice-router law (B70):** every router/fast-path touchpoint re-passes the full
   narrated corpus (finals AND partial-stream) with zero false mutations; no bare
   prefix word ever joins the fast-path allowlist.
4. **Earned-only motivation law:** nothing grantable, buyable, backfillable, fakeable;
   no points, coins, levels, social. (Teaching empty states are lawful: they promise,
   they never display unearned progress.)
5. **8 GB M2 Air:** no local ML runtimes, no FFT; fixed-size audio buffers; tiny
   bounded recordings.
6. **Live DB is sacred:** migrations rehearse on a fresh copy via
   `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib
rehearse_migration_on_real_database_copy -- --ignored`.
7. **All 85+ legacy CSS token names preserved** (`src/design/tokens.css:143-169`).
8. **devMock covers every command the frontend calls** (B80 rule).
9. **Assistant:** ships OFF; Plan C resumes only on Christian's word. E4 is gated.
10. **Vault update protocol** after every change/session. A session without it is not
    done.

### 4b. The visibility standard (new in rev 2 — binding for all work in this plan)

- **Definition of done:** a feature is done when Christian uses it unprompted in normal
  practice — not when tests pass, not when the tutorial describes it. Docs never close
  an ask; only he does.
- **One-gesture rule:** the primary tool of any surface is at most one gesture away and
  visibly afforded (a control you can see, labeled with what it does).
- **Empty states teach.** Every feature's zero-data state names the feature and shows
  the gesture that starts it ("No sub-sections yet — drag inside this section to
  isolate a spot"). Lawful under law 4: promising is not granting.
- **The 10-second test (release gate):** someone who has never read the docs must find
  each new feature within 10 seconds of reaching its surface. Screenshot QA must show
  the affordance, not just the feature in use.
- **Progressive disclosure is for settings, not tools.** Advanced knobs may collapse;
  the thing you practice with may not.

## 5. Feature designs

Entity vocabulary (recon-confirmed): `piece` → `rep_block` ("practice set", table
`rep_block_v3`) → `rep` (verdict `clean`/`flawed`/`failed`); sections are `region` rows
with normalized 0–1 page geometry; sub-sections via `target_meta.parent_region_id`;
sessions link through the append-only `event` table; focused time and streaks always
derived, never stored.

### 5.1 A1 — Tempo demotion ("the punishment")

**Behavior.** During a set with the tempo ladder active: after **3 consecutive
`flawed` reps** (default), the ladder steps DOWN one rung: `bpm = max(start_bpm,
bpm − bpm_step)`; `cleans_at_step` and the consecutive-sloppy counter reset. While
demoted, the threshold for further demotions is **2 consecutive**. A clean rep resets
the counter. Floor = the set's `start_bpm` (manual "Back off tempo" recovery still
exists for going lower). Re-climb uses normal ladder rules. `failed` ("again") does
not count by default (Q4). Config: `rep.demote_enabled` (default **on**),
`rep.demote_first` (3), `rep.demote_repeat` (2); per-set override in Advanced.
Feedback: a clearly visible HUD moment "tempo pulled back to N" + chime — calm,
ink-colored, no shame styling.

**As-built disposition (2026-08-27):** the behavior/defaults and HUD moment shipped in
v7.1.0. v7.2.0 exposes the global on/off and first/repeat
thresholds in Settings. The designed per-set override is still absent and must not be
described as delivered.

**Where.** `src-tauri/src/rep/ladder.rs` (new `DemotionRule` + `step_down`
counterpart to `step()` `:103-118`; counter in the snapshot beside
`current_clean_streak`); `rep/mod.rs` `check()` `:323`; settings pattern
(`settings.rs:79-209`, `state/settings.ts:18-64`); HUD in `RepHud.tsx` (streak block
`:470-537`); composer override per 5.3. No schema change.

**Tests.** 3×flawed → one rung down; clean interleave resets; floor respected;
repeat threshold 2 after first demotion; toggle off → no-op; failed doesn't count;
demote→re-climb; HUD moment renders; devMock. Acceptance: three sloppy reps at the
piano audibly pull the click back, and he can see why.

### 5.2 A2 — Variant chains (he flagged this "very very important")

**Behavior.** A set carries an ordered **variant chain**. Each variant = `{name,
clean_streak}` (default 5). Sequential stages: complete variant 1's clean streak →
auto-advance (chime + completion moment) → … → chain complete. Preset chips
one-tap-addable: **Slow · Dotted · Reverse dotted · Staccato · Tenuto · Legato ·
Hands separate · Blocked chords** + free-text custom (remembered as a chip). Drag to
reorder; per-variant streak editable inline.

**Ladder interplay.** Chain + ladder: one full chain pass at the current tempo counts
as the ladder's clean group → tempo steps → chain restarts at the new tempo (rungs ×
variants). Chain-without-ladder: fixed tempo, one pass, set completes. A1 demotion
operates within the current variant.

**Upgrades existing machinery.** `VariantSpec {name, reps}`
(`src/features/rep/useRep.ts:53-56`; Rust `store/model.rs`), cycled per-rep by
`variant_index_for_rep` (`ladder.rs:120-136`) → becomes sequential streak-gated
stages. JSON payload on `rep_block_v3` extends with serde defaults (`clean_streak`
defaulting from old `reps`) — no migration expected (verify column type at execution).

**Visibility (per §4b — the current lanes are three actions deep and effectively
invisible).** The chain builder is a primary, always-visible element of the composer
(5.3) — preset chips on the form face, not behind a disclosure. The HUD shows the
current stage as a headline element: "dotted · 3/5 → next: reverse dotted", wired to
`fireCompletionFx` (`Shell.tsx:452-459`) on stage/chain completion.

**Tests.** Advance at exactly N cleans; flawed resets stage streak (feeds A1);
chain+ladder composition; chain-only completion ends the set; legacy `{name, reps}`
payloads load; devMock; HUD stage rendering. Acceptance: he sets Dotted → Reverse
dotted → Staccato ×5 and the app walks him through hands-free.

**As-built v7.2 final boundary:** each intermediate stage transition emits exactly one
chime. Beginning recovery synchronously cancels a pending six-second close, and the timer
rechecks the live completion boundary immediately before firing, so stale callbacks cannot
close recovered work.

### 5.3 A3 + A5 — Composer overhaul & metronome beat value

**Layout (`BlockForm.tsx` — today everything hides behind one "More" disclosure at
`:334-567`, which §3 ranked the single most invisible feature in the app).** New
order:

1. Always visible, no disclosure: Section/Target (measures, start/target bpm,
   `:255-331`), **Practice focus** (`:355-374`), **Variant chain** (preset chips +
   "+", directly below focus, above streak target — his explicit placement;
   collapsible but default-open), **Clean streak target** (`:388-425`).
2. One collapsed `<details>` "Advanced" at the bottom: tempo ladder mode/step
   (`:427-508`), demotion override, attempt review boundary (`:510-524`), one pass ≈
   (`:483-506`), beat unit + subdivision.

**Beat value (A5).** Engine already supports `subdivision` 1–16 and `beats_per_bar`
(`audio/clock.rs:21-40`, `metronome.rs:60-117`); sets pass only bpm
(`useRep.ts:386-420`). Add per-set `beat_unit` (♩ ♪ ♩. 𝅗𝅥 — entered bpm IS that
unit's rate; engine receives pulse bpm unchanged) + `subdivision`/`beats_per_bar`
passthrough on `METRO_START`/`METRO_SET`/`METRO_RESTART`; stored in the set context
JSON (`BlockForm.tsx:243-247` pattern). Quick subdivision control in the HUD
metronome row during a set.

**Tests.** Arg plumbing; unit label; persistence round-trip; devMock; composer at
720×520 with Advanced genuinely collapsed; screenshot QA showing variant chips
visible with zero clicks.

**As-built disposition (2026-08-27):** v7.1.0 shipped `tuning_json` plus the Rust/wire
model but no user control. v7.2.0 exposes beat value, beats
per bar and subdivision under Advanced and keeps the variant/streak row readable at
720×520. The designed RepHud quick-subdivision control is still absent.

### 5.4 A6 — Verdict hotkeys

While a set is live AND the practice view is the active workspace (Shell `view`
state) AND focus is not in a text field/dialog: **Space → clean**, **Right Shift →
sloppy** (`event.code === "ShiftRight"`), **Return → again**. `preventDefault` on
Space/Return; ignore auto-repeat. Remappable in Settings (capture control →
`hotkeys.verdict_*`); master toggle default **on**. Per §4b: the mapping renders as a
visible one-line hint in the HUD itself (not the drawer) until first use, then
compacts. New `src/features/rep/useVerdictHotkeys.ts` mounted by `RepHud.tsx`,
calling the buttons' `submit()` path (`:226-243`). **Tests:** fires only with live
set + correct view; suppressed in inputs/dialogs (B77 warning); remap round-trip;
repeat suppressed; devMock. Acceptance: a full set with hands never leaving the keys.

### 5.5 A7 + D2 — Add/subtract reps (UI + voice)

**UI.** "＋ clean" and "↩ undo last" beside the verdict row, always visible during a
set (not in the drawer) — using the normal `rep_check` path (provenance
`manual_adjust`) and existing `REP_UNDO` (`useRep.ts:983-1020`); receipts in the feed.

**Voice (D2).** New multi-word, set-gated intents in `src-tauri/src/intent/mod.rs`
(grammar shape of `rep_check` `:332-382`): "add a clean" / "add two cleans" / "count
that" → N× clean; "take one back" / "take one away" / "remove the last rep" / "undo
that" → `rep_undo`. Never bare words (law 3); mode-gated like `is_bare_stop`
(`:769-773`). **Gate:** full corpus replay zero false mutations + new fixtures incl.
near-miss negatives.

### 5.6 D1 — Voice verdict responsiveness ("when I say done, nothing happens")

Mechanism (recon): "done" IS a verdict phrase (`intent/mod.rs:334-344`) but excluded
from the 3-phrase partial fast path after bare words misfired on prefixes
(`voice_loop.rs:120-139`); it pays 600 ms settle (`stt/supervisor.rs:606-658`) + hear's
0.5–2.3 s final latency. And the app gives almost no evidence of hearing: the pill
flashes 1.8 s (`Shell.tsx:1246`) and the mic-level meter was never built
(`HeardPill.tsx:25-36`). Fixes, in expected-value order, all inside law 3:

1. **Instant verdict chime-ack** the moment a verdict lands (metronome actions already
   chime — `voice_loop.rs:169-173,752-753`; extend to all verdict outcomes).
2. **Persistent heard-feed:** replace the 1.8 s flash with a small scrolling last-3
   transcript strip on the Rep panel (every final, even Ignored) — misses become
   visible instead of vanishing. (Honest limit stays stated: the app can show what the
   OS heard, not hear better.)
3. **Mode-gated two-word fast-path phrases:** "mark done" / "rep done" (+ "mark
   sloppy", "mark again") join the partial fast path ONLY while a set is live
   (`FAST_PATH_PHRASES` `voice_loop.rs:250`, partial handling `:80-145`). Corpus must
   prove zero false mutations or the phrase is cut. Bare "done" keeps working settled.
4. **Tunable settle:** `stt.settle_ms` setting (default 600, floor 300), measured at
   the piano.
5. **P0 baseline first:** measure utterance→action for "done" vs "metronome off" at
   his piano; if the heard-feed shows nothing when he says "done", the OS engine never
   finalized — hotkeys (5.4) are the honest mitigation and the in-app help says so.

### 5.7 C3 — Mic mute button (built, invisible)

Backend complete and hardened (`voice_loop.rs:1300-1310`, gate refuses reopen while
muted `:414-427`, route guard `:478-480`; hook `useVoice.ts:112-113,287-293`). Work =
one prominent, always-visible mic toggle in the session HUD + voice pill, unmistakable
muted state, token colors, reflecting `voice://status`. Auto-mute during C2 playback
later. Tests: toggle round-trip; muted survives TTS-ack completion; devMock.

### 5.8 B1 — Micro-targets: P0 unlock, then the P2 rebuild

**P0 unlock (small, immediate — make the existing feature findable):**

- Clicking a parent box ON THE SCORE selects it (today selection lives in the list;
  add score-side click-to-select if absent — executor verifies against
  `ScoreView.tsx:1519-1544` selection state).
- While a parent is selected: a hint chip near the box — "Drag inside to isolate a
  spot" — and a crosshair cursor inside its bounds; the chip disappears after the
  first successful child (per-piece, stored as a seen-flag setting, not schema).
- Sections list empty-state and How To Use gain the missing sentence: select first,
  then drag.

**P2 rebuild ("micro-targets v2" — the ask he called fundamental, done properly):**

- **Zero-mode creation:** select an anchored top-level parent, press **Isolate a spot**
  and drag one box fully inside a current-edition parent rect. On pointer-up the child
  EXISTS immediately with an automatic `Spot N` label and interpolated/clamped measure
  estimate — **no form, no typed title/range and no second mapping drag**. The dedicated
  `score_micro_target_create` command writes the Region, parent, colour, anchor and event
  in one SQLite transaction and independently revalidates the one-level/geometry contract.
  **v8.1 source correction:** it now carries a durable command identity and payload fingerprint.
  One bounded retry reuses the exact identity/payload; a lost post-commit reply returns the original
  Region, while same-identity/different-geometry is rejected. Transaction atomicity and retry
  idempotency are independently tested.
- **Direct practice:** the selected child shows a **Practice this** chip. It resumes the
  latest paused set for that exact spot or starts a contextual 3-clean set immediately;
  another active set produces an explanation and no mutation. The list row still opens
  the prefilled composer for customization. Resume uses exact `region_id`, so same-range sibling
  spots cannot alias. The chip is suppressed while any score pointer mode owns the page.
- **Persistence + display:** children render when their parent is selected or when the
  child itself is selected. Each parent has a persisted **Hide spots / Show spots** toggle.
  Distinct calm styling uses a dashed border and ~10% fill. There is no claim here of a
  separate show-all mode or hover-only reveal.
- **Legacy recovery:** an unlinked contained box is inferred as a child only when its
  measures are strictly contained, edition/fingerprint match, every child-rect centre is
  inside exactly one candidate parent and the child is not already explicitly parented.
  Explicit linkage wins; the rule never rewrites the live database.
- **"+ Add" repaired:** while a parent is selected, the add flow offers "sub-section
  of {parent}" as the default instead of clearing it (`ScoreView.tsx:3006` inverted).
- Rendering rides the unified overlay (5.9). B62 snap-to-bar-edges did not ship in v7.2.0
  and remains optional future polish.

**Tests.** Score-side click-to-select; full-rect containment; atomic creation and forced
rollback; auto-label/interpolation; instant creation with no dialog; direct start, exact
Region-ID paused-set resume (including same-range siblings), active-set conflict and pointer-mode
suppression; hide toggle; conservative legacy inference;
unified-overlay parity; 720×520 screenshot QA of the affordance itself (§4b).
Acceptance: he isolates a five-note spot and is practicing it in **two gestures**.

### 5.9 B3 + B4 — One overlay path, new skin, un-overlapped editor

**B3 delivery (P2, v7.2.0).** `ScoreView` mounts
one memoized `ScoreOverlay` per page for persisted parents/children, measure-mapping
and create state, and the atlas target draft (storage remains untouched; all geometry
is already normalized 0–1). Shared low-fill, contrasted-border and selected/hover
states apply to old pieces automatically. A parity regression proves persisted boxes
and atlas selection share the same DOM/pointer path, and a render-count regression
proves identical props skip repaint; both passed before packaging and installation.

**B4 editor overlap (P0).** Repro at 720×520 (legacy `RegionEditor.tsx` advanced
tools `:220-309`; atlas `TargetDraftEditor.css:71-148`), fix, file as a flaw, pin
with a dense-fixture screenshot regression.

### 5.10 B2 — Movements (P4)

**Installed status (v8.1.0): shipped.** The schema-v17 table, strict CRUD, Piece Detail
editor and Score toolbar scope are present. Movement selection constrains pages and the visible
current-edition section list; zero rows preserves whole-score behavior. The live Beethoven data
has not been hardcoded or silently split—Christian may enter page 7 through the UI after install.

Schema v17: `piece_movement(id INTEGER PK, piece_id INTEGER NOT NULL REFERENCES
piece(id) ON DELETE CASCADE, title TEXT NOT NULL, start_page INTEGER NOT NULL
CHECK(start_page >= 1), display_order INTEGER NOT NULL DEFAULT 0)`. Zero rows =
today's behavior. A region belongs to the movement whose page range contains its
anchor page — derived at read time, no data migration. UI: PieceDetail "Movements"
editor; ScoreView toolbar movement selector scoping pages + section lists;
TrickySectionsPanel groups by movement. Seeding op. 90 (mvt 2 = page 7) is a
one-minute UI action. Tests: page→movement resolution incl. boundaries;
no-movement passthrough; CRUD; migration rehearsal; UI filtering; screenshots.

### 5.11 B5 — Measure mapping activation (P4)

**Installed status (v8.1.0): flow shipped; effectiveness acceptance open.** The button
states now explain loading/edition/page prerequisites. The intro identifies Claude/Gemini
readiness, disables Start when neither key exists, states that every edition page is sent and
keeps writes behind review + Apply. There is still no Anthropic key and the last live audit still
held zero mappings. That external/use fact cannot be closed by source or mock evidence.

Built; never run (B75, 0 live rows; B67 no key). P4: with Christian's key (Q8), run
the full wizard on the Beethoven + one more edition, fix what reality breaks,
un-disable the button's mystery (per §4b: a disabled "Map measures" explains why and
what to do). If he declines the key, the calibration-anchor manual path gets the
same visibility pass and the flaw stays honestly open.

### 5.12 C1 — Warmups (P5, the big new subsystem)

**Installed status (v8.1.0): shipped.** The installed catalog is broader than
the original ~40 sketch (118 code-owned entries at this source boundary), paged 36 at a time for
the 720×520 floor. Search/target filters, SVG keyboard figures, saved/reordered routines,
per-item BPM/streak and the exact system-piece runner are present. Progress advances only after
authoritative verified mastery; a completed routine celebrates once.

Curated catalog (~40 entries: scales all keys + contrary motion + thirds/sixths +
chromatic; arpeggios incl. sevenths/inversions; Hanon 1–20; octave work — scales,
repeated, jumps, broken; blocked chords/voicing; independence — five-finger,
held-note, trills, double-thirds; wrist/rotation drills), each: `id, name, category,
targets[], description, how_to, keyboard_figure, default_bpm range, default_streak`.
Target vocabulary: `velocity · evenness · octaves · chords/voicing · endurance ·
stretch/rotation · coordination · trills`. Routine builder (`src/features/warmups/`,
a Today-page card + workspace, visible by default per §4b): filter by target
("octave étude today"), tap to add, reorder, per-item tempo/streak; saved named
routines. **Runner = the existing rep engine:** schema adds `piece.kind` ('repertoire'
| 'system') + seeded system piece "Warm-ups"; a warmup run opens a normal `rep_block`
on it — ladders, chains, demotion, hotkeys, voice, streaks, celebrations all work on
day one. Tables: `warmup_routine(id, name, created_at)`,
`warmup_routine_item(id, routine_id FK CASCADE, catalog_id TEXT, display_order,
params_json)`; catalog stays in code. System pieces excluded from PiecesPanel, the
galaxy (property test: never a star), and score surfaces; warmup time counts toward
day streaks (derived, real, lawful). Visuals v1: SVG keyboard figures + tight how-to
text; engraved notation = Q3. Tests: migration rehearsal + idempotent seed; routine
CRUD; runner opens blocks on the system piece; exclusion property tests; catalog
lint; devMock; screenshots. Acceptance: "octave day" → targeted 3-item routine built
in <30 s, run hands-free, counted in the streak.

### 5.13 C2 — Rep recording + listen-back (P6, spike first)

**Installed status (v8.1.0): source delivered with the safe fallback; native hardware acceptance open.**
Three-way sharing was not trusted as the production contract. Review mode first acquires a native
capture lease that physically suspends STT, then opens WebView MediaRecorder; pending/failure
synchronously blocks verdict mutation, and teardown restores the exact prior mute/voice state.
Temporary bytes are discarded unless Keep is selected; kept exact-attempt files live below the
confined replay root, survive restart and play through output-only gain. Packaged permissions,
device ownership and piano usefulness still need native/Steinway acceptance.

Opt-in "Review mode" per set: continuous MediaRecorder; the rep-boundary gesture
(space/voice/click) closes the clip and starts the next; a playback card appears —
listen, then verdict (soft nudge, never a hard lock); next rep already rolling.
Capture tuned for piano: `getUserMedia({audio: {echoCancellation: false,
noiseSuppression: false, autoGainControl: false, channelCount: 1}})`, mono Opus
(~45 KB / 15 s); playback `<audio>` + WebAudio gain boost (output-only, lawful).
Files under app-data `rep_replays/<YYYY-MM-DD>/` (files, never blobs); schema:
`rep_replay(id, rep_id NULLABLE REFERENCES rep(id), rel_path TEXT NOT NULL,
duration_ms INTEGER, kept INTEGER NOT NULL DEFAULT 0, created_at)`. Unkept clips +
files deleted at session close (`replay.retention` setting: session-end | day-end,
Q6); "Keep this take" survives; deletion provably confined to `rep_replays/`
(the day-photo path-traversal lesson). Mic auto-mutes during playback (5.7).
**Spike S0 first (throwaway):** MediaRecorder + `hear` + dynamics sharing the mic on
the 8 GB Air (B0 proved two-way; this proves three-way), WKWebView constraint
honoring, RSS/CPU while recording + metronome; if three-way fails → review mode
pauses voice capture and Christian picks the tradeoff. Tests: clip lifecycle;
retention; migration rehearsal; mute-during-playback; confinement; devMock;
screenshots.

### 5.14 A4 — Section rotation (P6)

**Installed status (v8.1.0): shipped.** A station deadline is prompt-only. It chimes and
waits for explicit **Next station**, pauses only the exact block the rotation owns, verifies the
new snapshot matches the requested piece/Region/range, and leaves failures retryable. A full
cycle celebrates exactly once.

Pick 2+ sections + minutes-per-station (default 5) → rotation dock panel (existing
dock family) with station + countdown; at zero: chime + "switch to <next>" with
one-click open of that section's set (composer prefill or Paused Sets resume).
Prompt-based on purpose — never yanks a live set mid-rep. Shuffle per cycle with
keep-order toggle. Completion moment on a full cycle. Tests: advance, prefill,
resume path, seeded shuffle determinism, devMock, screenshots.

### 5.15 E1 + E2 — Pieces organization & sound targets (P6)

**Installed status (v8.1.0): shipped at the approved boundary.** Archive/restore,
recent-first grouping and separate typed-name **Delete files…** are present; folders are not owed
because Christian chose archive + recent-first. The active HUD exposes an editable **Sound
target**. Historical practice remains visible in the Universe even when files are deleted.

**E1.** Schema: `piece.archived_at INTEGER NULL`. Archived pieces collapse into an
"Archived (n)" group at the bottom (one click, unarchive in place); excluded from
Today suggestions; dimmed-not-hidden in the galaxy (history is real). "Recently
practiced first" sort joins alphabetical (derived; `store/mod.rs:268-277`). The
existing trash-move `archive()` (`pieces.rs:177-232`) is renamed to what it is
("Delete files…"). Folders deferred (Q5). **E2.** The section's free-text becomes
**"Sound target"** (placeholder: _sotto voce · grand · like bells_) and renders as
one calm line beside the verdict boxes (promoted out of the drawer,
`RepHud.tsx:640-656`), tap-to-edit. Tests: partition, unarchive, exclusion, sort,
migration rehearsal; sound-target render/edit; 720×520.

### 5.16 E5 — End-session crash (P0, first fixed)

The path audits clean of panics (`SessionBar.tsx:104,149` → `Shell.tsx:889-902` →
`lib.rs:933-939` → `sessions/mod.rs:446-459`; poison-safe locks, no non-test
unwraps) — prime suspect is **B56**: `end_session_and_export` no longer serializes
against a concurrent open. Plan: repro across five scenarios (end-during-active-set,
end-during-checkpoint, double-end, midnight rollover, missing export dir); restore
serialization (single store-level write lock across end/open/checkpoint); pin with a
concurrency test; if unreproducible, instrument the path and say so honestly. Flaws
register updated either way.

### 5.17 E6 — Gamification hooks (continuous, earned-only)

Christian's next verdict was explicit: the Universe remained terrible, progress was hard to see
and the app still was not gamified enough. The v8.1 source therefore replaces the decorative
galaxy with an evidence dashboard. **1 Practice XP = 1 fully completed focused minute**;
deterministic triangular level thresholds, six badge tracks, exact next-badge rails, 28-day
cadence, repertoire rails and a technique aggregate all read canonical SQLite evidence. Verdict
quality never changes XP. Archived and deleted repertoire history remains included; warmup system
work is shown separately as technique. Warmup routine, full rotation cycle and explicitly kept
reference take add earned completion moments. No coins, social comparison, randomness or
UI-grantable progress.

## 6. Plan of attack — the release train (rev 3 truth pass)

Phases are releases; each ships installed and is judged by Christian's normal use
before the next starts. Rev 2 changes: **P0 gains the sub-section unlock + a
default-visibility pass; the micro-target rebuild is promoted to P2** (he called it
fundamental); voice slides to P3; movements + mapping to P4; warmups P5; review &
flow P6. He can reorder P2–P6 at any gate.

| Phase                       | Version | Payload                                                                                                                                                                                                                                                                                                     | Schema  | Size |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| **P0 — Stabilize & Reveal** | v7.0.1  | E5 crash + B56 · B4 overlap fix · C3 mute button · **B1 unlock** (score-side select + hint chip + fixed "+ Add" default) · default-visibility pass (Rep panel auto-opens with a live set; pill bar labeled; streak/mapping/dock empty states teach per §4b) · owed v7 QA · D1 latency baseline at his piano | —       | M    |
| **P1 — Practice Set Core**  | v7.1.0  | A1 demotion · A2 variant chains · A3 composer overhaul (variants un-buried) · A5 beat value · A6 hotkeys · A7 ± reps                                                                                                                                                                                        | —       | L    |
| **P2 — Micro-Targets v2**   | v7.2.0  | **SHIPPED + INSTALLED 2026-08-27.** 5.8 rebuild (zero-mode creation, one-tap practice, persistent accumulation) · B3 overlay unification + restyle · E3 empty-state pass · A1/A5 visibility corrections · B86/B87 corrections. All source/release gates and live before/after checks passed; Christian's native/at-piano verdict remains owed. | —       | M–L  |
| **P3 — Voice Reliability**  | v8.1.0 | **SHIPPED + INSTALLED 2026-08-27.** D1 chimes/feed/live-set phrases/settle · D2 counted add/undo · live hotkey-remap correction. Steinway acceptance remains open.                                                                                                                                                                                                     | —       | M    |
| **P4 — Score Map**          | v8.1.0 | **SHIPPED except external acceptance.** B2 movements · B5 honest provider/prerequisite activation. Real mapping still needs a configured provider and live score.                                                                                                                                                                                                    | **v17** | M    |
| **P5 — Warmups**            | v8.1.0 | **SHIPPED + INSTALLED 2026-08-27.** C1 visual catalog + routines + exact rep-engine runner.                                                                                                                                                                                                                                                                           | **v18** | L    |
| **P6 — Review & Flow**      | v8.1.0 | **SHIPPED + INSTALLED 2026-08-27.** C2 safe capture/listen/keep · A4 exact prompt-only rotation · E1 archive/recent-first · E2 Sound targets. Native audio acceptance remains open.                                                                                                                                                                                   | **v19** | L    |
| **Motivation correction**   | v8.1.0 | **SHIPPED + INSTALLED 2026-08-27.** Evidence-based XP/levels/badges/next rails/28-day cadence; old galaxy removed. Installed-native Universe passed 720×520.                                                                                                                                                                                                          | —       | L    |
| **Accepted boundaries**     | —       | E4 Assistant stays OFF/gated with practice-only Settings guide and no Books furniture · folders declined in favor of archive/recent-first · keyboard figures rather than notation v1.                                                                                                                                                                                      | —       | —    |

## 7. Decisions received + remaining acceptance questions

- **Q1 decided:** Assistant stays OFF and gated; that is the cleanup. Its off-state Settings
  guide contains only the practice-command lane, Books/provider-only surfaces disappear, settle
  timing remains under Voice, and the enable switch stays discoverable.
- **Q2 answered by later feedback:** progress must be visual and substantially more gamified;
  the earned XP/levels/badges/cadence redesign is the source answer. Sustained motivation still
  requires Christian's lived verdict.
- **Q3 decided:** keyboard figures + text; no VexFlow in v1.
- **Q4 decided:** Sloppy only; Again does not count toward demotion.
- **Q5 decided:** archive + recent-first; no folders in this train.
- **Q6 decided:** unkept takes are temporary/session-bound; only explicit Keep persists.
- **Q7 decided:** Space / Right Shift / Return defaults, all remappable.
- **Q8 unresolved externally:** no Anthropic key is configured. Gemini may be available, but B5
  stays open until a real current-edition mapping is applied to the live DB.
- **Acceptance still owed:** packaged-native 720×520 interaction, native microphone ownership,
  Listen Back usefulness on the piano, and the whole voice path over the Steinway.

## 8. Execution protocol (binding for every phase, sized for any executor)

1. **Per phase:** implementation plan first (writing-plans format: exact files,
   failing-test-first, commit per task) arguing from this spec; fresh-context
   adversarial verification per slice before it counts done.
2. **Gates, exactly:** vitest full run · `cargo test` unfiltered (`filtered out: 0`)
   · `cargo clippy --all-targets --all-features` · `./node_modules/.bin/tsc` (never
   bare `npx tsc`) · narrated corpus (finals + partials, zero false mutations) on any
   voice touchpoint · devMock coverage for every new command · dense-fixture
   screenshots at 720×520 · **the §4b 10-second discoverability test per new feature,
   with the affordance itself in the screenshots**.
3. **Schema bumps:** new `SCHEMA_VN` + crash-atomic `if version < N` block
   (`migrations.rs:1513+`), bump `SCHEMA_VERSION` (`:11`), rehearse on a FRESH live-DB
   copy; note the v11→v12 rehearsal limitation (NOTES.md:39-42 / B58).
4. **Release mechanics:** tarball the outgoing app to `~/Library/CodaKiller-rollbacks/`
   BEFORE the release script; check `pgrep` + live DB for an open session before
   quitting; pre-install DB backup with SHA; re-sign after bundle copy; tag; push.
5. **Vault protocol every session** (law 10) — including `(C) How To Use.md` whenever
   anything user-facing changes, with the find-it gesture stated, not just the feature.
   Long build stages run as direct resumable agents, not Workflow lanes.

## 9. Spec self-review (rev 3, done inline)

Rev-3 release facts are measured in the version record. Tag `v8.1.0` is pushed at
`0a3d6a5d339955fd7e7318299eaa6c3063674415`; private `origin/main` is current through the
post-tag documentation correction.
Consistency: the **23** statuses in §1 match the installed release; phase
labels match §6 everywhere (P2 = micro-targets, P3 = voice, P4 = score map, P5 =
warmups, P6 = review & flow); future schemas v17/v18/v19 assigned once each. The visibility
standard (§4b) is referenced by every design it modifies (5.2, 5.3, 5.4, 5.7, 5.8,
5.11, 5.17) and enforced in §8's gates. Scope: still a multi-plan program by design.
The remaining ambiguity is external acceptance, not an undocumented product choice.
Browser/devMock evidence includes the final 720×520 Rotation posture (`y=164` above a 56px Tools
reserve) and the shrinkable 480px Warmups stage. Installed-native Universe at 720×520 is separately
accepted; browser frames and Settings tests do not promote microphone/Steinway acceptance.
