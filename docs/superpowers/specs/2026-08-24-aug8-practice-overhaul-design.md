# CodaKiller — Aug 8 Practice Overhaul (organized asks, designs, plan of attack)

> **Status:** DRAFT — awaiting Christian's review. Nothing here is being built yet.
> **Source:** Christian's Aug 8 feedback dump (the sixth real-use feedback round), pasted
> 2026-08-24 — i.e. written BEFORE v6.0.0 "Practice Core" (shipped Aug 18), v6.0.1
> (Aug 21), and v7.0.0 "Motivation Layer" (shipped + installed Aug 24). Part of this
> document's job is the honest diff: which asks those releases already answered.
> **Grounding:** every file/line reference below comes from a same-day read-only recon of
> the v7.0.0 codebase (7 parallel scouts) plus the vault Roadmap/Flaws/Changelog.
> **How to execute:** see §8. Each phase gets its own implementation plan in the
> writing-plans format at phase start; this document is the spec those plans argue from.

---

## 1. The asks, organized

The Aug 8 dump normalizes to **21 discrete asks** (duplicates merged — tempo demotion is
stated twice, sub-selections three times, "less friction" throughout). Status codes:
**NEW** = not built anywhere · **PARTIAL** = some machinery exists · **SHIPPED?** =
built in v6/v7 after the note was written, needs Christian's at-piano verdict ·
**GATE** = blocked on a decision only Christian can make.

| ID  | Ask (his words, condensed)                                                                                                                                                                                               | Status                                                                                                                                                                                    | Phase                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| A1  | 3 sloppy in a row → step the metronome tempo back down an increment; 2 more → down again; togglable/tunable ("there needs to be more punishment")                                                                        | **NEW**                                                                                                                                                                                   | P1                      |
| A2  | Variant chains: queue of practice modes (dotted, reverse dotted, staccato, tenuto, legato, slow + custom), 5-in-a-row each, auto-advance to the next                                                                     | **PARTIAL** (free-text variant lanes exist; no streak-per-variant, no auto-advance, no presets)                                                                                           | P1                      |
| A3  | Practice-set window layout: variants right under Practice focus, above clean-streak target, minimizable; tempo ladder / attempt review boundary / one-pass demoted to a bottom dropdown ("taking up WAY TOO MUCH SPACE") | **NEW** (layout)                                                                                                                                                                          | P1                      |
| A4  | Timed rotation through chosen sections (interleaving — "pull deep from muscle memory")                                                                                                                                   | **NEW**                                                                                                                                                                                   | P5                      |
| A5  | Metronome not locked to quarter note, incl. for practice sets                                                                                                                                                            | **PARTIAL** (engine has subdivision 1–16 + beats/bar; sets pass only bpm; no beat-unit concept)                                                                                           | P1                      |
| A6  | Verdict hotkeys: space=clean, right-shift=sloppy, return=again; only when the practice window is active; configurable                                                                                                    | **NEW**                                                                                                                                                                                   | P1                      |
| A7  | Frictionless add/subtract reps (UI)                                                                                                                                                                                      | **NEW** (only verdict buttons + a fixed "+2 recovery cleans" exist)                                                                                                                       | P1                      |
| B1  | Mini selection boxes INSIDE a practice section (2-beat / 5-note micro-targets), persistent, visible only when the parent is clicked, hideable, measure numbers merely estimated                                          | **SHIPPED?** — v6 S2 sub-sections match this spec almost exactly (`target_meta.parent_region_id`, drag-inside-parent, child-visible-only-when-parent-selected, 3-in-a-row default)        | P0 verify → P4 polish   |
| B2  | Split a piece's PDF into movements (op. 90: mvt 2 starts page 7); sections stop cluttering the wrong movement                                                                                                            | **NEW**                                                                                                                                                                                   | P4                      |
| B3  | Selection-box refresh: migrate old pieces' laggy legacy boxes to the new look; more contrast, very low opacity but still prominent                                                                                       | **PARTIAL** — two overlay paths confirmed coexisting (legacy `RegionOverlay` + atlas `TargetDraftOverlay`)                                                                                | P4                      |
| B4  | "Save section" edit UI overlap — fix                                                                                                                                                                                     | **NEW** (unfiled; needs repro)                                                                                                                                                            | P0                      |
| B5  | Effective measure mapping with little user input                                                                                                                                                                         | **SHIPPED?** — v6 S1 cloud-vision mapping exists but has NEVER run on the live DB (B75; B67 = no Anthropic key). He also ranked this below the visual-selection UX                        | P4 (activation)         |
| C1  | Warmups: catalog of warmup techniques, visual, configurable routines targeted at what today's repertoire demands, rep tracking                                                                                           | **NEW** (biggest new subsystem)                                                                                                                                                           | P3                      |
| C2  | Per-rep self-recording + listen-back BEFORE the verdict, for subjective targets (phrasing, dynamics); tiny temp files, auto-deleted, keepable; tuned to hear a piano                                                     | **NEW** (zero audio-recording code exists anywhere)                                                                                                                                       | P5                      |
| C3  | Mute button for the microphone                                                                                                                                                                                           | **PARTIAL** — backend fully built (`voice_mute`, mute-hardened gate); no visible button                                                                                                   | P0                      |
| D1  | Voice "done" must work; rep-counter voice as responsive as the metronome commands                                                                                                                                        | **PARTIAL** — "done" is in the grammar but excluded from the fast path (B70 law), so it pays 600 ms settle + 0.5–2.3 s STT latency                                                        | P2                      |
| D2  | Add/subtract reps by voice                                                                                                                                                                                               | **NEW** (no such phrases in the router)                                                                                                                                                   | P2                      |
| E1  | Pieces window: archive old pieces, folders not immediately visible, declutter                                                                                                                                            | **NEW** (current "archive" is a typed-confirmation trash move; list is title-alphabetical only)                                                                                           | P5                      |
| E2  | Practice notes displayed next to the active session, renamed toward desired sound ("sotto voce", "grand")                                                                                                                | **PARTIAL** (per-attempt notes + focus contract exist in the HUD; section notes don't surface there)                                                                                      | P5                      |
| E3  | Practice Universe UI overhaul ("overlap, placement doesn't make sense")                                                                                                                                                  | **SHIPPED?** — v7 replaced it with the deterministic earned-only galaxy (no absolute positioning found; overlap claims predate v7)                                                        | P0 verify               |
| E4  | Assistant UI cleanup ("so many random things… really messy")                                                                                                                                                             | **GATE** — Christian's own 2026-08-24 direction: Assistant OFF by default, Plan C ON HOLD "until I tell you to resume". This note predates that direction.                                | Gate                    |
| E5  | End-session crash — fix                                                                                                                                                                                                  | **NEW** (no documented fix; prime suspect is flaw B56: `end_session_and_export` no longer serializes against a concurrent open)                                                           | P0                      |
| E6  | Much more gamified; "spike dopamine"                                                                                                                                                                                     | **SHIPPED?** — v7.0.0 Motivation Layer landed today; the note predates it. New mechanics in this plan (variant chains, warmups, demotion recovery) each get earned-only celebration hooks | P0 verify + every phase |

## 2. What he's truly asking for (the brainstorm)

Five intents underlie all 21 asks. Every design decision below traces to one of these:

1. **Friction is the enemy of reps.** The recurring sentence is "so I don't have to move
   my hand off the piano." Voice, hotkeys, one-gesture sub-selections, recording built
   into the rep loop, notes already in view, one-tap ± rep. Metric that matters: actions
   per rep and seconds between reps — both should approach zero.
2. **Deliberate-practice science, encoded.** Punishment (tempo demotion), variation
   (variant chains), interleaving (rotation), micro-chunking (sub-selections),
   self-monitoring (record → listen → judge), transfer-targeted warmups. The app should
   make the scientifically-right practice the path of least resistance.
3. **The score is the practice map.** Persistent spatial memory: boxes and sub-boxes
   that survive and accumulate ("these mini selection boxes should stay so I can come
   back"), movements so each page shows only what belongs there, measure numbers as
   estimates, never as required input.
4. **Motivation as a first-class feature.** "Practice is really hard to do without
   motivation and that is why many pianists can't get better."
5. **Trust and polish.** Crashes, overlapping edit UIs, laggy legacy boxes, messy
   surfaces — each one erodes the willingness to practice inside the app at all.

## 3. What v6/v7 already answered (verify, don't rebuild)

The note is from Aug 8; three releases have shipped since. These asks are plausibly
already satisfied and need Christian's **at-piano verdict**, not code:

- **B1 sub-sections** — v6 S2 shipped his spec: drag inside a parent creates a child
  box; children render only while the parent is selected with a count badge; measures
  auto-fill from the map when present, free-text beat label otherwise; one-gesture set
  start, 3-in-a-row default. Known residual: B62 (boxes clamp to score bounds, no
  snap-to-bar-edges). Question for him: does the _creation gesture_ feel frictionless
  at the piano, and are child boxes discoverable enough?
- **D1 baseline** — v6 S9 shipped the fast path (metronome phrases), chime acks, fuzzy
  matching, and the "heard-text pill" (every final, even Ignored, flashes what was
  heard). His "when I say done nothing happens" may partly predate this. P2 measures
  the residual gap before changing anything.
- **B5 measure mapping** — v6 S1 shipped the full cloud-vision pipeline; it has never
  once run against the live DB (B75), partly because there's no Anthropic key (B67).
- **E3 Universe** — v7 A1 replaced it wholesale with the earned-only galaxy.
- **E6 gamification** — v7's whole Motivation Layer (galaxy, day streaks, photo ritual,
  completion animations) landed today; he wrote the ask before ever seeing it.

P0 includes a structured feedback round on exactly these five, so later phases spend
effort only where reality (not an outdated note) says it's still needed.

## 4. Binding constraints (the laws — nothing below may violate these)

1. **User is the sensor; the app is the memory.** The app never interprets audio as
   music. The dynamics checker is the one approved mic-judges-loudness feature —
   loudness only, forever. C2 (recording) complies: pure record/playback, the human
   makes every judgment; zero analysis of the recording.
2. **Deterministic hot loop.** The LLM is never in the rep/metronome path.
3. **Voice-router law (B70 postmortem):** every router/fast-path touchpoint re-passes
   the full narrated corpus (finals AND partial-stream suites) with **zero false
   mutations**; **no bare prefix word ever joins the fast-path allowlist**.
4. **Earned-only motivation law:** nothing grantable, buyable, backfillable, fakeable;
   no points, coins, levels, or social. Every visual is a pure function of recorded
   practice events.
5. **8 GB M2 Air:** no local ML runtimes, no FFT; fixed-size audio buffers; recordings
   must be small and bounded.
6. **Live DB is sacred:** never opened/migrated from dev code; every migration
   rehearses on a fresh copy via `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib
rehearse_migration_on_real_database_copy -- --ignored`.
7. **All 85+ legacy CSS token names preserved** (`src/design/tokens.css:143-169` —
   "NEVER DELETE A NAME FROM THIS FILE"); new UI consumes existing semantic tokens.
8. **devMock covers every command the frontend calls** (B80 rule).
9. **Assistant:** ships OFF; Plan C resumes only on Christian's word. E4 is gated.
10. **Vault update protocol** after every change/session (Changelog, CodaKiller.md,
    Roadmap/Flaws/Command Center, How To Use on user-facing change, NOTES.md, commit,
    tag on version bump). A session without it is not done.

## 5. Feature designs

Designs are written against exact current anchors so an executor needs no discovery
pass. Entity vocabulary (recon-confirmed): `piece` → `rep_block` ("practice set",
table `rep_block_v3`) → `rep` (one attempt: verdict `clean`/`flawed`/`failed`);
sections are `region` rows with geometry in normalized 0–1 page coords; sub-sections
via `target_meta.parent_region_id`; sessions link through the append-only `event`
table; focused time and streaks are always derived, never stored.

### 5.1 A1 — Tempo demotion ("the punishment")

**Behavior.** During a set with the tempo ladder active: after **3 consecutive
`flawed` reps** (default), the ladder steps DOWN one rung: `bpm = max(start_bpm,
bpm − bpm_step)`; `cleans_at_step` and the consecutive-sloppy counter reset. While at
a demoted rung, the threshold for further demotions is **2 consecutive** (his "if it's
again two times"). A clean rep resets the consecutive-sloppy counter. Floor is the
set's `start_bpm` (the manual "Back off tempo" recovery action still exists for going
below). Re-climbing uses the normal ladder rules.

- `failed` ("again") does **not** count toward demotion by default — "again" means
  didn't-complete, not played-sloppy. (Open question Q4 if he disagrees.)
- Config: global settings `rep.demote_enabled` (default **on**), `rep.demote_first`
  (3), `rep.demote_repeat` (2); per-set override in the composer's Advanced area.
- Feedback: HUD moment "tempo pulled back to N" + the existing chime-ack path; a
  demotion is a _practice event like any other_ — no shame styling, ink-colored, calm.

**Where.** Rust `src-tauri/src/rep/ladder.rs` (new `DemotionRule` + a `step_down`
counterpart to `step()` at `:103-118`; consecutive-flawed counter in the snapshot
alongside `current_clean_streak`); `src-tauri/src/rep/mod.rs` `check()` at `:323`
(wire the counter); settings via the existing key/value pattern
(`src-tauri/src/settings.rs:79-209`, `src/state/settings.ts:18-64`); HUD surface in
`src/features/rep/RepHud.tsx` (streak block `:470-537`); composer override in
`BlockForm.tsx` Advanced area (see 5.3). No schema change (snapshot/state, not new
tables; per-set override rides the existing increment-rule JSON).

**Tests.** Ladder unit tests: 3×flawed → one rung down; clean interleave resets;
floor respected; repeat threshold 2 after first demotion; toggle off → pure no-op;
`failed` doesn't count; demote → re-climb sequence. HUD: moment renders; devMock
updated. Acceptance: at the piano, three sloppy reps audibly pull the click back.

### 5.2 A2 — Variant chains (he flagged this as "very very important")

**Behavior.** A set can carry an ordered **variant chain**. Each variant = `{name,
clean_streak}` (default streak 5). The set runs variants sequentially: complete
variant 1's clean streak → auto-advance to variant 2 (chime + completion moment) →
… → chain complete. Preset chips one-tap-addable: **Slow · Dotted · Reverse dotted ·
Staccato · Tenuto · Legato · Hands separate · Blocked chords** (+ free-text custom,
which is remembered and offered as a chip next time). Reordering by drag; per-variant
streak editable inline.

**Ladder interplay.** When both chain and ladder are active: one full chain pass at
the current tempo counts as the ladder's clean group → tempo steps up → the chain
restarts at the new tempo. (Chain-without-ladder = fixed tempo, chain once, set
completes.) A1 demotion operates within the current variant. This is the elegant
composition of his two asks: rungs × variants.

**Current machinery being upgraded.** `VariantSpec {name, reps}` exists
(`src/features/rep/useRep.ts:53-56`, Rust `store/model.rs`), cycled per-rep by
`variant_index_for_rep` (`ladder.rs:120-136`) — i.e. today variants interleave by
count; the upgrade makes them sequential streak-gated stages. The `variants` payload
is JSON on `rep_block_v3` → extend the shape with serde defaults (`clean_streak`
defaulting from old `reps`), **no migration** (verify column is TEXT/JSON at
execution; if it's structured, this becomes part of the P3 schema bump instead).

**Where.** `ladder.rs` (stage progression: `variant_stage`, `stage_clean_streak` in
the snapshot; advance rule); `rep/mod.rs` `check()`; composer UI per 5.3;
`RepHud.tsx` — the current variant is displayed at `:423-424` today; promote it: big
current-variant label + streak-within-variant (e.g. "dotted · 3/5") + "next:
reverse dotted" preview + auto-advance moment wired to the existing
`fireCompletionFx` sites (`Shell.tsx:452-459`). Voice/status strings updated.

**Tests.** Stage advance at exactly N cleans; flawed resets stage streak (and feeds
A1); chain+ladder composition (full pass → tempo step → chain restart); chain-only
completion ends the set; legacy `{name, reps}` payloads still load (serde default
path); devMock; HUD stage rendering. Acceptance: he sets Dotted→Reverse
dotted→Staccato ×5 and the app walks him through it hands-free.

### 5.3 A3 + A5 — Practice-set composer overhaul & metronome beat value

**Layout (BlockForm.tsx — today everything hides behind one "More" disclosure at
`:334-567`).** New order:

1. Always visible: Section/Target (measures, start/target bpm — unchanged from
   `:255-331`), **Practice focus** (`:355-374`), **Variant chain** (new, directly
   below focus, above streak target — his explicit placement; collapsible but
   default-open), **Clean streak target** (`:388-425`).
2. Collapsed `<details>` "Advanced" at the bottom: Tempo ladder mode/step
   (`:427-508`), demotion override (5.1), Attempt review boundary (`:510-524`),
   One pass ≈ (`:483-506`), beat unit + subdivision (below).

**Beat value (A5).** The click engine already supports `subdivision` 1–16 and
`beats_per_bar` (`audio/clock.rs:21-40`, `metronome.rs:60-117`) — sets just never
pass them (`useRep.ts:386-420` sends only `{setId, bpm}`). Add per-set `beat_unit`
(display semantics: ♩ / ♪ / ♩. / 𝅗𝅥 — the entered bpm IS that unit's rate; the engine
receives it as the pulse bpm unchanged) and `subdivision` + `beats_per_bar`
passthrough on `METRO_START`/`METRO_SET`/`METRO_RESTART`. Stored in the set's
context JSON alongside `pass_seconds` (`BlockForm.tsx:243-247` pattern). Quick
subdivision control also surfaces in the HUD's metronome row during a set.

**Tests.** Args plumbing (set opens metronome with subdivision/beats), unit label
rendering, persistence round-trip, devMock. Visual: composer at 720×520 — no
scroll-trap, Advanced actually collapsed by default, screenshot QA.

### 5.4 A6 — Verdict hotkeys

**Behavior.** While a set is live AND the active workspace shows the practice HUD
(Shell's `view` state — his "clicked onto the practice window"; Settings/Pieces/etc.
don't fire) AND focus is not in a text field/dialog: **Space → clean**,
**Right Shift → sloppy** (`event.code === "ShiftRight"`), **Return → again**.
`preventDefault` on Space (page scroll) and Return. Ignore key auto-repeat. Remappable
in Settings (capture-a-key control writing `hotkeys.verdict_clean|flawed|failed`);
master toggle `hotkeys.verdicts_enabled` default **on**. A one-line hint renders in
the HUD drawer so the mapping is discoverable.

**Where.** New `src/features/rep/useVerdictHotkeys.ts` (document `keydown` listener,
mounted by `RepHud.tsx`; guards as above), calling the same `submit()` path as the
buttons (`RepHud.tsx:226-243`). Settings per the standard pattern
(`settings.rs` + `state/settings.ts` + `SettingsPanel.tsx`). No global-hotkey
infra exists today (recon-confirmed) — this stays component-scoped by design.

**Tests.** Fires only with live set + correct view; suppressed in inputs/dialogs
(the B77 focus-trap flaw is a warning here — add a dialog-open guard test);
remap round-trip; repeat-key suppressed; devMock. Acceptance: a full set at the
piano without touching the trackpad or speaking.

### 5.5 A7 + D2 — Frictionless add/subtract reps (UI + voice)

**UI.** Two compact controls beside the verdict row (not in the drawer):
"＋ clean" (records a clean via the normal `rep_check` path, provenance source
`manual_adjust`) and "↩ undo last" (existing `REP_UNDO`, `useRep.ts:983-1020`).
Both get receipts in the feed. (Today the only adjustment controls are Undo in the
drawer and a fixed "+2 recovery cleans" — recon (f).)

**Voice (D2).** New router intents in `src-tauri/src/intent/mod.rs` (grammar
follows the existing `rep_check` shape at `:332-382`): "**add a clean**" / "**add
two cleans**" / "**count that**" → N× clean check; "**take one back**" / "**take
one away**" / "**remove the last rep**" / "**undo that**" → `rep_undo`. All are
multi-word phrases (law 3 respected — never bare words), full-utterance matches,
routed only while a set is open (mode-gated like `is_bare_stop` at `:769-773`).

**Gate.** Full narrated-corpus replay (finals + partial-stream), zero false
mutations, plus new fixtures for each phrase and near-miss negatives ("add a clean
shirt to the laundry" must stay Ignored — the 12-word ambient cap and conversational
exclusions already help).

### 5.6 D1 — Voice verdict responsiveness ("when I say done, nothing happens")

Recon found the mechanism, not a mystery: "done" IS a verdict phrase
(`intent/mod.rs:334-344`, exact whole-utterance) but was **deliberately** excluded
from the 3-phrase partial-stream fast path after single words empirically fired on
sentence prefixes (`voice_loop.rs:120-139`, the B70 postmortem). So every "done"
pays the 600 ms settle + hear's own 0.5–2.3 s final-delivery latency. Fix within
the law, in order of expected value:

1. **Instant verdict chime-ack** (v6 S9 gave chimes to metronome actions; extend to
   verdict check-offs) — kills the "did it hear me?" dead air even when latency is
   unchanged. `voice_loop.rs` ack path, existing output engine, no new audio path.
2. **Mode-gated two-word fast-path phrases:** "**mark done**" / "**rep done**"
   (+ "**mark sloppy**", "**mark again**") join the partial-stream fast path ONLY
   while a set is live (fast path already exists: `FAST_PATH_PHRASES`
   `voice_loop.rs:250`, partial handling `:80-145`). Two-word exact phrases are not
   bare prefix words; the corpus (finals + partials) must prove zero false
   mutations or the phrase is cut. "done" alone keeps working on the settled path.
3. **Tunable settle:** expose `stt.settle_ms` (default stays 600; floor 300) in
   Settings as an experiment knob; measure at the piano before/after.
4. **Measure first (P0):** baseline utterance→action latency for "done" vs
   "metronome off" at the piano, and check the v6 heard-pill actually flashes his
   missed "done"s (if the pill shows nothing, the OS engine never finalized —
   that's flaw A1/B24 territory, hotkeys A6 are the honest mitigation, and the
   in-app help says so plainly).

**Gate:** same corpus law as 5.5. **Files:** `voice_loop.rs` (fast path + acks),
`stt/supervisor.rs:606-658` (settle constant → setting), `intent/mod.rs` (aliases),
settings plumbing, new corpus fixtures.

### 5.7 C3 — Mic mute button (mostly done, invisibly)

Backend complete (recon): `voice_mute` command, `VoiceLoop::set_muted`
(`voice_loop.rs:1300-1310`), gate refuses to reopen while muted (`:414-427`), route
guard (`:478-480`), frontend hook `useVoice.ts:112-113,287-293`. **Work = surface
it:** a prominent mute toggle (mic icon, unmistakable muted state, token colors) in
the session HUD area + voice status pill, reflecting `voice://status`. Also mutes
during C2 playback later (5.11 auto-mutes via the same call). Test: toggle
round-trip, muted state survives TTS-ack completion (the hardening path), devMock.

### 5.8 B2 — Movements

**Model.** New table (rides P3's schema bump, v16): `piece_movement(id INTEGER PK,
piece_id INTEGER NOT NULL REFERENCES piece(id) ON DELETE CASCADE, title TEXT NOT
NULL, start_page INTEGER NOT NULL CHECK(start_page >= 1), display_order INTEGER NOT
NULL DEFAULT 0)`. A piece with zero rows behaves exactly as today (movements are
opt-in). A section/region belongs to the movement whose page range contains its
anchor page — **derived at read time, no per-region column, no data migration**.

**UI.** PieceDetail: a small "Movements" editor (add: title + first page; edit;
delete = merge back). ScoreView: when movements exist, a movement selector in the
toolbar scopes page navigation and section lists; TrickySectionsPanel and practice
surfaces group by movement. Seeding op. 90 (mvt 2 = page 7) is a one-minute UI
action by Christian, not a script.

**Where.** `store/migrations.rs` (SCHEMA_V16 const + `if version < 16` block per
the crash-atomic pattern at `:1513-1560`), new `store` CRUD + Tauri commands
(list/create/update/delete, devMock coverage), `PieceDetail.tsx`, `ScoreView.tsx`
toolbar + section filtering, `TrickySectionsPanel`. **Tests:** movement resolution
(page → movement, boundary pages, no-movements passthrough), CRUD, migration
rehearsal on live-DB copy, UI filter tests, 720×520 screenshots.

### 5.9 B3 + B4 — One overlay path, new skin, un-overlapped editor

**B3 unify.** Both box systems render as siblings inside `PdfPage`
(`ScoreView.tsx:2866` legacy `RegionOverlay`, `:2935` atlas `TargetDraftOverlay`).
Unify **rendering** on one component (keep storage as-is — `pdf_anchor` rects and
atlas geometry both already normalized 0–1): one box renderer for parent regions,
child regions, and drafts, styled via tokens — fill opacity ~0.08–0.12, clearly
contrasted 1.5px borders, distinct-but-calm parent/child/selected/hover states, no
new hex colors (law 7). Profile the legacy overlay's lag (suspect: re-render per
pointermove) and memoize; the freehand-pencil module (`store/score_marks.rs`,
p50 16.7 ms) is the performance reference pattern. Old pieces get the new look
automatically because only rendering changes, not data.

**B4 editor overlap.** Repro at 720×520 first (both editors: legacy
`RegionEditor.tsx` with its "Advanced section tools" details at `:220-309`, and
atlas `TargetDraftEditor` flex layout at `TargetDraftEditor.css:71-148`), fix the
offender, add a dense-fixture screenshot regression. Unfiled today — file it as a
flaw when reproduced (never delete a flaw; add one honestly).

### 5.10 C1 — Warmups (the big new subsystem)

**Concept.** A curated **catalog** of warmup techniques, a **routine builder** that
filters by what today's repertoire demands, and a **runner** that is just the
existing rep engine — so ladders (A1/A5), variant chains (A2), hotkeys (A6), voice
(D1/D2), streak/focused-time accounting, and celebrations all work for warmups on
day one, for free.

**Catalog** (static TypeScript data + Rust seed, ~40 entries at launch, each:
`id, name, category, targets[], description, how_to, keyboard_figure, default_bpm
range, default_streak`). Categories × examples: **Scales** (all majors/minors,
contrary motion, thirds/sixths apart, chromatic) · **Arpeggios** (triads,
sevenths, dominant/diminished, inversions) · **Hanon** (1–20 as numbered drills)
· **Octaves** (scales in octaves, repeated-note octaves, octave jumps, broken
octaves) · **Chords** (blocked triads/inversions, chord streams, voicing top-note)
· **Finger independence** (five-finger patterns, held-note drills, trills,
double-thirds) · **Wrist/rotation** (rotation pairs, staccato wrists, chromatic
minor-third rotations). Targets vocabulary: `velocity · evenness · octaves ·
chords/voicing · endurance · stretch/rotation · coordination · trills`. Visuals:
v1 = an SVG **keyboard figure** (pattern start + contour) + tight how-to text —
honest and fast; real engraved notation (VexFlow) is Q3, a deliberate later choice.

**Routine builder** (`src/features/warmups/`, a Today-page card + workspace):
filter chips by target ("today: octave étude" → octave-heavy suggestions), tap to
add, reorder, per-item tempo/streak params; save named routines ("Chopin day").

**Runner = rep engine.** Schema v16 adds `piece.kind TEXT NOT NULL DEFAULT
'repertoire' CHECK(kind IN ('repertoire','system'))` and one seeded system piece
"Warm-ups" (idempotent seed in the migration); a warmup run opens a normal
`rep_block` on it (focus = warmup name, tempo/streak from item params). New tables:
`warmup_routine(id, name, created_at)` and `warmup_routine_item(id, routine_id FK
CASCADE, catalog_id TEXT, display_order, params_json)`. Catalog stays in code (no
table) — `catalog_id` is a stable string key.

**Exclusions (laws + YAGNI).** System pieces are excluded from PiecesPanel,
galaxy/Universe (earned-only law: warmups fuel _day streaks and focused time_,
which is real and derived — but they are not a repertoire star), and IMSLP/score
surfaces. No audio interpretation anywhere; the app never claims a warmup was
played correctly — verdicts stay human.

**Tests.** Migration v16 rehearsal (counts preserved; seed idempotent on
re-migrate); routine CRUD; runner opens blocks on the system piece; galaxy/pieces
filters exclude system pieces (property test: a system piece never renders a
star); catalog data lint (every entry has targets, figure, sane bpm); devMock;
720×520 screenshots. Acceptance: "I'm playing octave études today" → 3-item
targeted routine built in <30 s, run hands-free, counted toward the day streak.

### 5.11 C2 — Rep recording + listen-back ("removes ALL that struggle")

**Flow ("Review mode", opt-in per set).** While a review-mode set runs, the
webview records continuously (MediaRecorder, chunked). Marking the rep boundary
(hotkey/voice/click — same gestures as ever) closes the current clip and
immediately starts the next; a **playback card** appears in the HUD with the clip
(auto-play optional): listen → then verdict (buttons/hotkeys enabled after
playback starts; skippable — soft nudge, never a hard lock). Verdict binds the
clip to the rep row. During playback the mic auto-mutes (5.7) so TTS/clicks don't
re-trigger voice.

**Capture (tuned to hear a piano).** `getUserMedia({audio: {echoCancellation:
false, noiseSuppression: false, autoGainControl: false, channelCount: 1}})` —
processing OFF is the single biggest "hear the piano honestly" lever; Opus/WebM
~24 kbps mono (a 15 s rep ≈ 45 KB). Playback via `<audio>` + a WebAudio gain node
for a boost slider (output-only — lawful). Precedent: the photo ritual already
uses getUserMedia in this webview (camera), so the permission surface exists;
audio-in support in Tauri's WKWebView is exactly what the spike verifies.

**Storage & retention.** Files under app-data `rep_replays/<YYYY-MM-DD>/` (files,
never blobs — the day-photo rule). Schema v17: `rep_replay(id, rep_id NULLABLE
REFERENCES rep(id), rel_path TEXT NOT NULL, duration_ms INTEGER, kept INTEGER NOT
NULL DEFAULT 0, created_at)`. **Auto-delete `kept=0` clips + files at session
close** (default; horizon setting `replay.retention` = session-end | day-end);
"Keep this take" flips `kept=1` and survives. Path handling follows
`day_photos.rs` (the path-traversal lesson from the v7 verification record).

**Spike first (the phase's S0, throwaway):** MediaRecorder + `hear` STT +
dynamics meter sharing the mic on the 8 GB M2 Air (the B0 spike proved two-way;
this proves three-way), constraint honoring in WKWebView, RSS/CPU while recording

- metronome; if three-way fails, fallback = review mode pauses voice capture
  (mute already exists) — Christian picks push-to-talk-style tradeoff.

**Tests.** Clip lifecycle (boundary → new file, verdict binds clip, orphan clips
cleaned), retention (kept survives, unkept + files gone at close — and a test
that deletion NEVER touches outside `rep_replays/`), migration v17 rehearsal,
mute-during-playback, devMock (recording commands mocked), UI at 720×520.
Acceptance: he records a phrasing rep, listens back, verdicts sloppy, keeps one
reference take — without leaving the HUD or touching a DAW.

### 5.12 A4 — Section rotation (interleaving)

**Behavior.** From the sections panel: pick 2+ sections + minutes-per-station
(default 5). A rotation panel (existing dock family, `src/features/dock/`) shows
current station + countdown; at zero: chime + "switch to <next section>" prompt
with one-click "open its set" (pre-filled composer or resume its paused set via
the existing Paused Sets tray machinery). Prompt-based advance, v1 — no
auto-closing of a live set mid-rep (that would fight the rep engine; YAGNI until
he asks). Rotation order shuffles per cycle (variation science) with a
keep-order toggle.

**Where.** New `src/features/rotation/` dock panel; wiring into
TrickySectionsPanel (multi-select) and the set composer prefill; countdown uses
the existing Clock/Timer panel patterns; completion moment on a full cycle.
**Tests:** timer advance, prompt→composer prefill, paused-set resume path,
shuffle determinism given a seed, devMock, screenshots.

### 5.13 E1 — Pieces window organization

Schema v17: `piece.archived_at INTEGER NULL`. Archived pieces vanish from the
main list into a collapsed "Archived (n)" group at the bottom (one click to
expand, unarchive in place); excluded from Today suggestions and (per earned-only
law discussion) still visible in the galaxy but dimmed — history is real and
stays. Sort stays alphabetical; add a "recently practiced first" toggle (derived
from events, no schema). **Folders/tags: deliberately deferred** (Q5) — with 10
pieces, archive + sort covers the mess he described; folders are a data model
he may never need. **Where:** `store/mod.rs:268-277` (list query),
`PiecesPanel.tsx`, archive/unarchive commands (the existing `pieces.rs archive()`
trash-move stays as "Delete files…", renamed honestly — archiving is now the
non-destructive default). **Tests:** list partition, unarchive round-trip,
Today exclusion, migration rehearsal.

### 5.14 E2 — Sound targets beside the active session

Rename the concept, not just the field: the section-level free-text becomes
**"Sound target"** (placeholder: _sotto voce · grand · like bells · whispered_)
and renders read-only (tap to edit) inside the HUD right next to the verdict
boxes — joining the focus contract drawer content (`RepHud.tsx:640-656`) but
promoted out of the drawer, one calm line under the streak numeral. Source:
`region.notes` for the active set's section (+ the set's `focus`). The score
Goals banner (`piece.banner_text`, v6 S8) is untouched — different altitude.
**Tests:** renders for section-backed sets, absent otherwise, edit round-trip,
no layout overlap at 720×520 (B60 mounted-hidden class awareness), devMock.

### 5.15 E5 — End-session crash

Recon audited the path (`SessionBar.tsx:104,149` → `Shell.tsx:889-902` →
`session_end` `lib.rs:933-939` → `end_and_export` `sessions/mod.rs:446-459`):
poison-safe locks, no non-test unwraps, defensive export IO — **and no
documented fix since Aug 8**. Prime suspect: **B56** — `end_session_and_export`
no longer serializes against a concurrent open (a live, filed race). Plan:
(1) attempt repro (end-during-active-set, end-during-checkpoint, double-end,
end-at-midnight-rollover, end-while-export-dir-missing); (2) fix B56 by
restoring serialization (single store-level write lock around
end/open/checkpoint); (3) regression tests incl. a concurrency test; (4) if
repro fails, instrument (structured crash log on the session path) and move on
honestly — "could not reproduce, added serialization + telemetry" is the
truthful outcome. Flaws register updated either way.

### 5.16 E6 — Gamification hooks (continuous, earned-only)

No new gamification _system_ until Christian has lived with v7 (Q2). Each phase
wires its mechanic into the existing earned-only celebration layer
(`completionFx` via `Shell.tsx:452-459,896`): variant-stage completion and full
chain completion (P1), first hands-free voice-adjusted set (P2), warmup routine
completion + warmups feeding day streaks (P3), a kept reference take (P5). All
pure functions of recorded events; nothing grantable (law 4).

## 6. Plan of attack — the release train

Phases are releases; each ships installed and verified before the next starts.
P1 is deliberately the practice-engine payload — it changes tomorrow's practice
the most. Christian can reorder P2–P5 freely at any review gate.

| Phase                       | Version        | Contents                                                                                                                                                                       | Schema                                                                     | Size |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---- |
| **P0 — Stabilize & Verify** | v7.0.1 (patch) | E5 crash + B56 fix · B4 editor-overlap repro+fix · C3 mute button · owed v7 720×520 live QA · **at-piano feedback round** on the five SHIPPED? asks (§3) + D1 latency baseline | none                                                                       | S    |
| **P1 — Practice Set Core**  | v7.1.0         | A1 demotion · A2 variant chains · A3 composer overhaul · A5 beat value/subdivision · A6 verdict hotkeys · A7 ± rep UI                                                          | none expected                                                              | L    |
| **P2 — Voice Reliability**  | v7.2.0         | D1 (verdict chimes, mode-gated two-word fast-path, settle knob) · D2 voice ± reps · new corpus fixtures from P0 baseline                                                       | none                                                                       | M    |
| **P3 — Score Map**          | v7.3.0         | B2 movements · B3 overlay unification + restyle · B4 residuals · B5 activation (B75 live run; **needs B67 key from Christian**) · optional B62 snap polish                     | **v16** (`piece_movement`, `piece.kind` + system-piece seed staged for P4) | M    |
| **P4 — Warmups**            | v8.0.0         | C1 catalog + routine builder + rep-engine runner + streak integration                                                                                                          | v16 tables (or v17 if split)                                               | L    |
| **P5 — Review & Flow**      | v8.1.0         | C2 recording/listen-back (spike S0 first) · A4 rotation · E1 pieces archive · E2 sound targets                                                                                 | **v17** (`rep_replay`, `piece.archived_at`)                                | L    |
| **Gate**                    | —              | E4 assistant (on Christian's word only) · further gamification (after v7 lived-with feedback) · folders (Q5) · VexFlow notation (Q3)                                           | —                                                                          | —    |

Dependency notes: A6 hotkeys make C2's rep-boundary gesture good, and P0's latency
baseline decides how hard P2 pushes; movements (P3) precede warmups only because
they share the v16 migration — P4 can swap ahead with its own bump if he wants
warmups sooner. Every phase ends install-verified at the piano before the next
plan is written.

## 7. Open questions for Christian (none block P0–P1 except Q1's own item)

- **Q1 — Assistant (E4):** the Aug 8 "assistant UI is messy" predates your Aug 24
  "put it on hold / it ships off" direction. Options: (a) stays off, ask closed;
  (b) resume Plan C properly; (c) a minimal cleanup-only pass. Your word, per your
  own rule.
- **Q2 — Gamification (E6):** after a few days with v7's galaxy/streaks/ritual —
  what still doesn't spike dopamine? Specifics become the next earned-only round.
- **Q3 — Warmup visuals:** keyboard-figure SVG + text (fast, honest, v1 default)
  or real engraved notation (VexFlow — a new rendering dependency)?
- **Q4 — Demotion counting:** default counts only "sloppy" (flawed); should
  "again" (failed) count too?
- **Q5 — Pieces:** is archive + recently-practiced sort enough, or do you truly
  want folders?
- **Q6 — Recording retention default:** delete unkept takes at session end (spec
  default) or keep until day close?
- **Q7 — Hotkey defaults:** Space/RightShift/Return confirmed? (Right Shift is
  unusual — it's what you asked for; all remappable regardless.)
- **Q8 — B67:** an Anthropic key in Keychain is the one thing only you can do to
  let measure mapping run for real.

## 8. Execution protocol (binding for every phase, sized for any executor)

1. **Per phase:** write the implementation plan first (writing-plans format:
   exact files, failing-test-first steps, commit per task) arguing from this
   spec; fresh-context adversarial verification per slice before it counts done
   (the process that has refuted work six times in ten rounds — keep it).
2. **Gates, exactly:** vitest full run · `cargo test` **unfiltered** (check
   `filtered out: 0`) · `cargo clippy --all-targets --all-features` ·
   `./node_modules/.bin/tsc` (NEVER bare `npx tsc` — resolves to a bogus tsc and
   passes vacuously in clean worktrees) · narrated corpus (finals + partials,
   zero false mutations) on any voice touchpoint · devMock covers every new
   command · dense-fixture screenshots at 720×520 for every new surface.
3. **Schema bumps:** new `SCHEMA_VN` const + `if version < N` crash-atomic block
   (`migrations.rs:1513+` pattern), bump `SCHEMA_VERSION` (`migrations.rs:11`),
   rehearse on a FRESH copy of the live DB
   (`CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib
rehearse_migration_on_real_database_copy -- --ignored`); note the known
   v11→v12 rehearsal limitation (NOTES.md:39-42 / B58).
4. **Release mechanics:** tarball the outgoing installed app to
   `~/Library/CodaKiller-rollbacks/` BEFORE the release script (it deletes the
   previous bundle); check `pgrep` + live DB for an open session before quitting
   the app; pre-install DB backup with SHA recorded; re-sign after any bundle
   copy; tag; push to the private remote.
5. **Vault protocol after every session** (law 10). Long build stages run as
   direct resumable agents, not Workflow lanes (the 2026-07-30 lesson).

## 9. Spec self-review (done inline)

Placeholders: none — every feature names its files, tables, defaults, and tests.
Consistency: A1/A2 ladder composition defined once (5.2) and referenced; schema
bumps v16/v17 assigned to phases without overlap; verdict vocabulary
(clean/flawed/failed) used uniformly. Scope: this is deliberately a multi-plan
program — §6 is the decomposition the writing-plans scope check requires.
Ambiguities converted to defaults + an open question (Q4–Q7) rather than left
vague.
