# CodaKiller Foundation — Design Spec (P3.5)
**Date:** 2026-07-12 · **Status:** Historical/as built — shipped as v0.3.0. The old proposal
language below records the design process; it is not a pending review or current roadmap.
**Builds on:** `2026-07-09-codakiller-design.md` (the approved product spec). Nothing here changes the core thesis (*user is the sensor, app is the memory*; deterministic hot loop; no audio interpretation). This spec is about making the app you already use **editable, non-blocking, organized, and flexible** — and laying the structured, honest data foundation that the score viewer, brain, planner, and reward system will stand on.

## 1. Why now (the friction, from real at-piano use)

Four screenshots from Christian's actual sessions (2026-07-11/12) show the daily pain of v0.2.0:

- **Nothing is editable after you commit it.** Block-history rows (`mm. 1–24 · both hands · ♩40 · 0 0 0`) are frozen. No way to fix a wrong tempo, relabel, correct a verdict count, delete a mis-logged block, or change the "WHERE I AM" note. Reps are append-only by design — but that design is now the #1 friction.
- **The open-block panel blocks the UI.** The floating rep HUD (`Clean / Sloppy / Again`) docks over the bottom of the "New practice block" form; the session/event feed pill overlaps content on the right. Neither can be moved.
- **History becomes an endless wall.** A flat reverse-chronological pile of `mm. 544–552 · …` rows with no grouping, collapsing, or spatial anchor to *where in the piece* the work happened.
- **Tempo is welded to the metronome.** The Auto/Manual tempo ladder lives inside the block form and only exists to drive the click. There's no way to work an increment or a phrasing pass with the metronome off.

Foundation fixes all four, and in doing so upgrades the data layer from "append-only log that dies on relaunch" to a **durable, fully-editable graph** that future features read from.

## 2. Decisions locked with Christian (this phase)

| Decision | Choice |
|---|---|
| Sequencing | **Foundation first** (this spec: editability + panels + organized history + tempo decoupling), *then* score viewer (P4) → brain (P5) → planning (P5.5) → home & universe (P6). |
| Editability | **Everything is editable in place.** Double-click any label/measure/BPM/rep/goal/note to edit; delete anything behind a confirm. SQLite becomes the single source of truth for a fully-CRUD graph. |
| Windows | **Lightweight floating panels** — draggable, resizable, closable, snap-to-edge, position persisted. Not a full OS window manager. |
| History organization | **Regions** — a named measure-range unit (section/phrase/group). Auto-seeded from block ranges now; becomes the thing you click on the PDF in P4. |
| Tempo | **Decoupled from the metronome.** Tempo ladder is tracking metadata; a block can advance tempo with the click off, or have no tempo at all (focus = phrasing/notes/dynamics/memory/hands). |
| Extensibility | **Event sourcing** — a durable append-only event table in SQLite is the single source future features derive from; a stateless **derived-metrics** layer computes focused-time / mastery / streaks. |
| Brain (recorded for P5, not built here) | Default to Christian's **Claude subscription** on **Sonnet 5** (note: "Sonnet 4.6" is not a released model; Sonnet 5 is the current sensible-cost pick), configurable, with **Gemini** as fallback. Kept *thin*: the heavy lifting lives in a clean, well-mapped data graph so the model reasons over structure, not raw mess. |
| Reward system (recorded for P6, not built here) | **Practice Universe** — measurable practice grows a personal universe (merges with the space-themed home W8). Honesty-first (see §8.3). Foundation only lays its data hooks. |

### Explicit non-goals for Foundation
- **No score viewer, no PDF rendering** (P4). We introduce the `Region` model and reserve a `pdf_anchor` slot, but render nothing.
- **No brain / LLM code** (P5). We shape the data graph it will read; we call no model.
- **No reward UI / universe** (P6). We capture `focused_seconds` and make mastery/streaks derivable; we render no reward.
- **No goals-calendar / missed-day recovery UI** (P5.5). We promote `Goal` to a real table with a `parent_goal_id` and `target_date` so that work drops in later; we ship only add/edit/delete/reorder now.
- No change to the voice grammar, the metronome audio engine, STT, or TTS beyond what tempo-decoupling requires.

## 3. Scope — four sub-milestones

Foundation ships as one phase (v0.3.0) in four reviewable sub-milestones:

- **F1 — Data graph + direct manipulation.** Schema v3 migration; full CRUD commands; `<EditableField>`/`<EditableNumber>` primitives; delete-with-confirm; edit blocks, reps, goals, notes, current-state; active-block edits sync the in-memory snapshot; export re-points to the canonical graph.
- **F2 — Floating panel system.** `<FloatingPanel>` + `usePanels()`; convert the rep HUD and session/event feed into movable, non-blocking, position-persisted panels.
- **F3 — Organized history + Regions.** `Region` model; collapsible region groups with summaries; filter/search/sort; block→reps drill-in.
- **F4 — Tempo decoupling.** Block model gains `focus` + `use_metronome`; BPM ladder optional; tempo controls move onto the block; log reps and advance tempo with the click off.

Each sub-milestone is independently shippable and gets a fresh-context `verifier` pass + screenshot verification before it counts as done.

## 4. Architecture changes

Same crate/module layout as the product spec (`store/`, `rep/`, `sessions/`, `vault/`, frontend `features/`). The changes:

```
Rust core
├── store/
│   ├── model.rs      + Region, Goal (tables); Block gains region_id, focus,
│   │                   use_metronome, optional bpm ladder; Rep gains stable id
│   ├── migrate.rs    schema v2 → v3 (additive; back-fill Regions from block ranges)
│   ├── events.rs     NEW: durable append-only event log table (event sourcing)
│   └── crud.rs       NEW: region/block/rep/goal update+delete; count recompute
├── metrics/          NEW: stateless derived-metrics (focused_seconds, mastery,
│                       streaks) over events + graph → progress_summary()
├── rep/mod.rs        edits to the active block re-emit rep://state; ladder
│                       advance decoupled from metro (metro follows only if on)
└── sessions/export.rs  export reads the canonical SQLite graph (survives relaunch,
                          reflects edits) instead of the in-memory event log

WebView frontend (features/)
├── ui/EditableField.tsx, EditableNumber.tsx, ConfirmDelete.tsx   NEW primitives
├── ui/FloatingPanel.tsx + usePanels.ts                           NEW panel system
├── pieces/HistoryPanel.tsx        NEW: region-grouped, collapsible, filterable
├── pieces/BlockRow.tsx            editable row; expand → RepList (editable reps)
├── pieces/RegionEditor.tsx        create/rename/merge/recolor regions
├── pieces/GoalsPanel.tsx          add/edit/delete/reorder goals (+ subgoal stub)
├── rep/RepHud.tsx                 → hosted inside a FloatingPanel
├── session/SessionBar.tsx         → event feed hosted inside a FloatingPanel
└── rep/BlockForm.tsx              focus selector + metronome on/off + optional BPM
```

**The two extensibility investments** (§8) — the durable event log and the derived-metrics layer — are what let P4/P5/P6 attach without schema churn.

## 5. Data model — schema v3 (additive migration)

| Entity | Change | Notes |
|---|---|---|
| `Region` | **NEW** table: `{ id, piece_id, name, m_start, m_end, kind: section\|phrase\|group\|hard_spot\|custom, order, color, pdf_anchor (nullable JSON, reserved for P4) }` | The named measure-range unit. Migration back-fills Regions by clustering each piece's blocks into overlapping measure-range groups (one Region per cluster); user can rename/merge/split/recolor. Fixes history now; becomes PDF-clickable in P4. |
| `Block` (`rep_block`) | **ADD** `region_id` (nullable FK), `focus` (enum, default `tempo`), `use_metronome` (bool, default true); **make** `start_bpm`/`bpm`/`target_bpm`/ladder columns **nullable** | Non-tempo blocks (phrasing/notes/…) carry no BPM. Existing rows migrate to `focus=tempo`, `use_metronome=true`, `region_id` = matched back-filled region. |
| `Rep` | **ADD** stable `id` (PK) if not already; allow `update` (verdict, note) and `delete`; block verdict counts are **recomputed** from surviving reps | Fix a mis-logged "clean"; delete a stray rep. |
| `Goal` | **NEW** table: `{ id, piece_id, text, kind: big\|sub, parent_goal_id (nullable), done (bool), order, target_date (nullable), created_ts }` | Promoted from the intake `goals[]` string array. Migration converts existing intake goals to `kind=big` rows. `parent_goal_id`+`target_date` pre-wire subgoals & calendar (P5.5). |
| `HardSpot` | Migrate intake `hard_spots[]` → `Region` rows with `kind=hard_spot` | So hard spots become first-class, editable, and show on the score in P4. |
| `current_state` / notes / deadline / target_tempo | No schema change; expose **inline editing anytime** (currently write-once at intake) | "WHERE I AM" stops being frozen. |
| `Event` | **NEW** table: `{ id, ts, session_id (nullable), piece_id (nullable), kind, payload (JSON) }` | Durable append-only log; kinds: `session_start`, `session_end`, `rep_open`, `rep`, `verdict`, `tempo_change`, `block_edit`, `rep_edit`, `region_change`, `goal_change`. Replaces the in-memory event log as the source of truth for export + metrics. |
| `Session` | **ADD** `focused_seconds` (derived at end from event gaps under an idle threshold) | Honest reward hook; also a real session-summary stat. |

**Migration safety:** v3 is strictly additive (new tables, new nullable columns, new PK). No destructive changes. Back-fill runs once, idempotently, guarded by the schema-version row. Old exports on disk are untouched. A migration test asserts a v2 DB opens, back-fills Regions/Goals, and every prior block/rep is preserved and now editable.

## 6. New Tauri commands (IPC)

```
region_list(piece_id) -> Region[]
region_create({piece_id, name, m_start, m_end, kind}) -> Region
region_update(id, patch) -> Region
region_delete(id) -> ()          # blocks keep their range; region_id set null
region_merge(id_keep, id_absorb) -> Region

block_update(block_id, patch) -> Block          # label, measures, bpms, focus,
block_delete(block_id) -> ()                     # use_metronome, planned_reps, region_id
                                                 # (also re-emits rep://state if active)
rep_update(rep_id, {verdict?, note?}) -> ()      # recomputes block counts
rep_delete(rep_id) -> ()

goal_list(piece_id) -> Goal[]
goal_create({piece_id, text, kind, parent_goal_id?, target_date?}) -> Goal
goal_update(id, patch) -> Goal
goal_delete(id) -> ()
goal_reorder(piece_id, ordered_ids[]) -> ()

piece_field_update(piece_id, {current_state?|deadline?|target_tempo?|notes?}) -> ()

progress_summary(piece_id) -> { focused_seconds, per_region_mastery[], streak, ... }

layout_get() -> PanelLayout          # panel positions/sizes/collapsed
layout_set(PanelLayout) -> ()        # (stored in settings)
```

All mutations write a corresponding `Event` row and, where relevant, re-emit the existing `rep://state` / `session://event` observables so the UI updates live.

## 7. Sub-milestone specs

### 7.1 F1 — Data graph + direct manipulation
- **Migration** (§5) runs on launch; guarded and idempotent.
- **Primitives:** `<EditableField>` (text) and `<EditableNumber>` (with the same stepper affordance as today) — double-click enters edit, Enter/blur saves via the matching `*_update` command, Esc cancels; optimistic update with rollback on command error. `<ConfirmDelete>` is a small inline popover ("Delete this block and its 9 reps?").
- **Everything editable:** block label, measure range, start/current/target BPM, planned reps, focus, region; each rep's verdict + note; each goal; the "WHERE I AM" current-state; deadline; target tempo.
- **Block → reps drill-in:** a block row expands to its individual reps (verdict chip + note + time), each editable/deletable; counts recompute live and re-emit.
- **Active block:** editing the currently-open block updates the in-memory `RepSnapshot` and re-emits `rep://state`, not just the DB.
- **Export correctness:** `sessions/export.rs` reads the canonical SQLite graph so edits survive relaunch and appear in the per-piece markdown. An integration test proves edit-then-relaunch-then-export reflects the edit.

### 7.2 F2 — Floating panel system
- `<FloatingPanel>`: drag by header, resize from a corner, close, collapse to header, snap to screen edges, raise-to-front on focus. Constrained to viewport (never lost off-screen).
- `usePanels()`: registry of open panels + their geometry; persists to settings via `layout_set`/`layout_get`; restores on launch.
- **Convert:** the rep HUD and the session/event feed become floating panels. The main content (piece detail, block form, history) scrolls underneath and is **never blocked**. A "reset layout" control restores defaults.
- Scope guard: no minimize-to-taskbar, no tiling engine, no multi-window OS behaviors.

### 7.3 F3 — Organized history + Regions
- **`HistoryPanel`** replaces the flat list with **collapsible Region groups**: `▸ mm. 544–570 · "legato section" — 6 blocks · best ♩40 · last: today`. Expand → blocks; expand a block → reps.
- **Region seeding:** auto-grouped from overlapping block measure-ranges at migration; `RegionEditor` lets you rename, merge, split, and recolor them. Blocks can be reassigned to a region by editing `region_id`.
- **Controls:** filter/search by label or measure; sort (recent / by measure / most-practiced); per-group summary line from `progress_summary`.
- **Continuity:** these same Regions become the clickable targets on the PDF in P4 — no rework.

### 7.4 F4 — Tempo decoupling
- Block gains a **focus** selector (`tempo · notes · phrasing · dynamics · memory · hands · other`) and a **metronome on/off** toggle, both surfaced on the block itself (out of the cramped create-form).
- **BPM optional:** `focus != tempo` blocks carry no ladder; reps are counted with verdicts only.
- **Ladder ≠ metronome:** advancing the tempo ladder (manual or clean-gated) is tracking metadata. If the metronome is running it follows; if off, nothing plays but the ladder still advances and logs. A `tempo_change` event records every step regardless of the click.

## 8. Extensibility & future-proofing

Christian's explicit ask: *leave room for many future ideas.* Three structural choices make new features cheap and keep the app honest.

### 8.1 Event sourcing
Every meaningful action appends an immutable `Event` row. Export, metrics, the future brain, analytics, and even session replay all **derive from this one log** rather than bespoke state. New event kinds are additive. This also fixes today's latent bug: the in-memory log (and thus export data) is lost on relaunch.

### 8.2 Stateless derived-metrics layer
`metrics/` holds pure functions over `(events, graph)`: `focused_seconds`, `per_region_mastery`, `streak/consistency`, `time_by_focus`, `best_tempo_reached`. One `progress_summary` command feeds history summaries now; the universe renders it later; the brain reads it as pre-digested structure. Adding a metric never touches schema — this is the "map it out clearly so the model does minimal thinking" principle in practice.

### 8.3 Reward-system readiness (Practice Universe, P6) — honesty-first
The design hooks (not the feature) go in now: accurate `focused_seconds`, derivable per-region mastery, derivable streaks. When built, the reward **weights un-fakeable work — focused time, consistency across days, breadth of coverage — most heavily**, and expresses *quality* (tempo/mastery) as gentle brightness rather than a score to chase. No red/punishment states, no leaderboards. This is deliberate: in a self-reported app, a reward that chases "clean reps" would incentivize dishonest self-assessment — the one thing this app exists to protect. The universe metaphor merges with the space-themed home (W8) so it reads as one product, not a bolted-on gimmick.

### 8.4 What each future phase attaches to
- **P4 score viewer** → `Region.pdf_anchor` (light manual tap-to-anchor mapping); click a region on the PDF → its history/annotations (already grouped by region in F3).
- **P5 brain** → the graph + `progress_summary` as grounded, pre-structured context; Sonnet 5 default via Claude subscription, Gemini fallback; open questions only.
- **P5.5 planning** → `Goal.parent_goal_id` (subgoals) + `Goal.target_date` (calendar) + streak/grace (missed-day recovery).
- **P6 home & universe** → `progress_summary` rendered as the growing universe; the space-themed landing + drill-in navigation.

## 9. Visual / UX direction

- **Calm default, drill-in tree.** Few buttons up front; depth lives in panels and settings that reveal on demand. The piece view leads with *where you are* and *what's next*, not a wall of forms.
- **Everything that looks editable is.** One consistent inline-edit affordance; one consistent confirm-before-destroy.
- **Panels get out of the way.** Nothing floats over the thing you're trying to use.
- Follows the existing dark/light design system; `/frontend-design` guides the polish pass; `/design-review` and `/code-review` gate the finish.

## 10. Testing & verification

- **Rust:** unit tests for every CRUD command, count-recompute, and the v3 migration (v2 DB opens, back-fills, preserves all prior blocks/reps); metrics unit tests (focused_seconds, mastery, streak); an **integration test proving edit → relaunch → export reflects the edit**.
- **Frontend:** vitest for `EditableField`/`EditableNumber` (edit/save/cancel/rollback), `ConfirmDelete`, `FloatingPanel` (drag/resize/snap/persist), and the region-grouping logic.
- **Visual:** real screenshots of each surface (via the running app, not mockups) — history panel, editable block, floating panels not overlapping, tempo-off block — attached to `docs/qa/`.
- **Process:** subagent-driven execution (executor/mech-executor) with a fresh-context `verifier` gate per sub-milestone; `security-executor` for the Keychain/subscription touch if any lands early; `/code-review` before ship.

## 11. Rollout, update protocol, risks

- **Branch:** `foundation` → merges to `main` at v0.3.0.
- **Update protocol (binding, from the vault CLAUDE.md):** on every change, refresh vault `(C) Changelog.md`, `CodaKiller.md`, `(C) Roadmap.md`, `(C) Flaws.md`, `(C) Command Center.md`, `(C) How To Use.md` (editability + panels + tempo are user-facing → bump `Matches:`), and repo `NOTES.md`; commit; tag `v0.3.0` on ship.
- **Risks:** (1) migration must be non-destructive — mitigated by additive-only + a v2→v3 preservation test + DB backup before migrate; (2) active-block edits must not desync the in-memory snapshot — mitigated by routing every edit through Rust and re-emitting `rep://state`; (3) panel geometry must never strand a panel off-screen — mitigated by viewport-clamp on restore; (4) scope creep from F2 toward a full window manager — mitigated by the explicit non-goals in §7.2.

## 12. The roadmap arc

| | Workstream | Phase | Version |
|---|---|---|---|
| W1 Direct manipulation · W2 Floating panels · W3 Organized history · W7 Tempo decoupling | **Foundation** | **P3.5 (this spec)** | v0.3.0 |
| W4 Score viewer (real PDF + light measure/section mapping) | Score | P4 | v0.4.0 |
| W5 The brain (Claude sub / Gemini + knowledge graph, thin) | Brain | P5 | v0.5.0 |
| W6 Goals · subgoals · calendar · missed-day recovery | Planning | P5.5 | v0.6.0 |
| W8 Space-themed home + navigation · W9 Practice Universe (measurable reward) | Home & Universe | P6 | v1.0.0 |
