# CodaKiller Foundation Implementation Plan

> **Status:** Shipped as v0.3.0 on 2026-07-12. Execution evidence and the honest visual-QA gap are recorded in `.superpowers/sdd/progress.md` and `docs/qa/(C) foundation-v0.3.0.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade CodaKiller's data layer from an append-only log into a durable, fully-editable SQLite graph (regions, goals, events, editable blocks/reps) and make the UI non-blocking and organized — editable-in-place fields, floating panels, region-grouped history, and tempo decoupled from the metronome.

**Architecture:** A schema-v3 additive migration adds `region`, `goal`, and `event` tables, extends `rep_block` (region_id, focus, use_metronome, nullable BPM ladder) and `session` (focused_seconds), and idempotently back-fills regions/goals from existing data. Rust gains a CRUD layer (`store/crud.rs`), a durable event log (`store/events.rs`), and a stateless `metrics/` layer, all surfaced as new Tauri commands; every mutation appends an `Event` and re-emits the existing `rep://state`/`session://event` observables. React gains inline-edit primitives, a lightweight floating-panel system, and a region-grouped history panel — the existing hot loop (regex voice router, metronome audio, rep engine) is untouched except where tempo decoupling requires.

**Tech Stack:** Tauri v2, Rust (rusqlite, cpal), React 19 + TypeScript + Vite, vitest, cargo test.

## Global Constraints
- **Additive, non-destructive migration.** v2→v3 is new tables + new nullable columns + one table rebuild that copies all rows; no data is dropped; back-fill runs once, guarded by `PRAGMA user_version`; a v2-preservation test gates it.
- **User is the sensor; the app is the memory.** No audio is ever interpreted as music. Every verdict comes from the human. Nothing here adds perception.
- **Deterministic hot loop.** The regex intent router and rep engine stay authoritative; new code is CRUD/metrics/UI, never in the voice→verdict path.
- **SQLite is the single source of truth.** The durable `event` table + canonical graph tables are what export, metrics, and future features derive from; no feature reads in-memory-only state.
- **Floating panels, not a window manager.** Drag/resize/collapse/snap/persist only — no minimize-to-taskbar, no tiling engine, no OS multi-window.
- **No score-viewer / brain / reward UI this phase.** Introduce `Region.pdf_anchor` (reserved), `Goal.parent_goal_id`/`target_date` (reserved), and `focused_seconds`/derivable mastery — render none of them.
- **Ship protocol.** On completion run the vault UPDATE PROTOCOL (Changelog, CodaKiller.md, Roadmap, Flaws, Command Center, How To Use with `Matches:` bump, repo NOTES.md), commit, and tag `v0.3.0`.

## Execution order & parallelism
- **T1 blocks all other Rust work** — every CRUD/metrics command reads the v3 schema. Do T1 first, alone, and gate it hard.
- **T10 (edit primitives) blocks T11, T14, T15, T16, T19** — the inline-edit affordance is shared. Do T10 before any editable-UI wiring.
- **F2 (T12–T14, floating panels) is independent of F1's T2–T9** and can run in parallel with the Rust CRUD/metrics stream, sharing only T10.
- **F4 T18 (ladder decouple) depends on T1** (needs `focus`/`use_metronome` columns) but is independent of T2–T17.
- Suggested waves: **W0** T1. **W1 (parallel)** {T2, T3, T4, T5, T6, T7 on Rust} ‖ {T10 then T12→T13 on frontend}. **W2** {T8, T9 (need events/graph)} ‖ {T11, T14 (need T10 + panels)}. **W3** {T15, T16, T17} ‖ {T18, T19}. **W4** T20 then T21.
- Every task ends with an independently testable deliverable and a commit; each non-trivial task gets a fresh-context `verifier` gate before it counts as done.

---

## File Structure

**Rust — `src-tauri/src/`**
| File | Responsibility |
|---|---|
| `store/migrations.rs` *(modify)* | Add `SCHEMA_VERSION = 3`, the additive v3 batch (new tables + `rep_block` rebuild + `session.focused_seconds`), and the idempotent back-fill call. |
| `store/model.rs` *(modify)* | Add `Region`, `Goal`, `Event`, `ProgressSummary`+parts, `PanelLayout`, and the `*Patch` structs; extend `BlockHistory`/`RepSnapshot`-adjacent wire types with `focus`/`use_metronome`/`region_id`. |
| `store/backfill.rs` *(new)* | Idempotent v3 back-fill: cluster blocks→regions, intake `goals[]`→`Goal(kind=big)`, `hard_spots[]`→`Region(kind=hard_spot)`. Pure over a `&Connection`. |
| `store/events.rs` *(new)* | Durable append-only `event` log: `append_event`, `events_for_session`, `events_for_piece`, `all_events`, `EventKind`. |
| `store/crud.rs` *(new)* | Region/block/rep/goal/piece-field update+delete+create+reorder+merge on `Store`; verdict-count recompute. |
| `store/mod.rs` *(modify)* | `mod backfill; mod events; mod crud;` and re-exports; add block/rep readers CRUD needs (`block_row`, `reps_for_block`). |
| `metrics/mod.rs` *(new)* | Stateless derived metrics over `(events, graph)`: `focused_seconds`, `per_region_mastery`, `streak`, `best_tempo_reached`, `time_by_focus`, and `progress_summary`. |
| `rep/mod.rs` *(modify)* | Ladder advance decoupled from metronome; edits to the active block re-emit `rep://state`; honor `focus`/`use_metronome`. |
| `sessions/export.rs` *(modify)* | `write_session_md` reads the canonical graph (rep_block + rep, current values) so edits survive relaunch and appear in the markdown. |
| `lib.rs` *(modify)* | Register all new commands in `generate_handler!` and define their thin `#[tauri::command]` wrappers. |

**Frontend — `src/`**
| File | Responsibility |
|---|---|
| `components/EditableField.tsx` *(new)* | Double-click→text input; Enter/blur saves via a passed `onSave`, Esc cancels; optimistic with rollback on reject. |
| `components/EditableNumber.tsx` *(new)* | Same contract, numeric with stepper affordance and min/max/step. |
| `components/ConfirmDelete.tsx` *(new)* | Inline confirm popover ("Delete this block and its N reps?") → `onConfirm`. |
| `components/FloatingPanel.tsx` *(new)* | Draggable/resizable/collapsible/snap-to-edge/viewport-clamped/raise-on-focus panel shell. |
| `components/usePanels.ts` *(new)* | Panel registry + geometry state; persists via `layout_set`/`layout_get`; `resetLayout()`. |
| `features/pieces/types.ts` *(modify)* | Add `Region`, `Goal`, `ProgressSummary`, `BlockPatch`, `PanelLayout`; extend `BlockHistory` with `region_id`/`focus`/`use_metronome`. |
| `features/pieces/HistoryPanel.tsx` *(new)* | Region-grouped collapsible history with summary lines + block→reps drill-in; filter/search/sort. |
| `features/pieces/BlockRow.tsx` *(new)* | One editable block row; expand→editable RepList; focus + metronome-toggle + optional BPM controls. |
| `features/pieces/RegionEditor.tsx` *(new)* | Rename/merge/split/recolor regions; reassign a block's region. |
| `features/pieces/GoalsPanel.tsx` *(new)* | Add/edit/delete/reorder goals (subgoal stub). |
| `features/pieces/PieceDetail.tsx` *(modify)* | Host HistoryPanel/GoalsPanel; inline-edit current-state/deadline/target-tempo/notes via `piece_field_update`. |
| `features/rep/BlockForm.tsx` *(modify)* | Add focus selector + metronome on/off + make BPM optional. |
| `features/rep/useCrud.ts` *(new)* | Thin invoke wrappers for every new mutation command (region/block/rep/goal/piece-field), returning typed results. |
| `components/Shell.tsx` *(modify)* | Host RepHud + SessionBar inside FloatingPanels; add reset-layout control; keep main content unblocked. |

---

### Task 1: Schema v3 migration + back-fill
**Files:** Modify `src-tauri/src/store/migrations.rs` (L11 `SCHEMA_VERSION`, L142–163 `migrate`); Create `src-tauri/src/store/backfill.rs`; Modify `src-tauri/src/store/mod.rs` (L8 module decls); Test `src-tauri/src/store/migrations.rs` (`#[cfg(test)]` mod) + `src-tauri/src/store/backfill.rs` tests.
**Interfaces:** Produces `pub const SCHEMA_VERSION: i32 = 3`; `pub fn migrate(conn: &Connection) -> rusqlite::Result<()>` (now reaches v3); `pub(crate) fn backfill_v3(conn: &Connection) -> rusqlite::Result<()>`. Consumes existing `piece.goals`/`piece.hard_spots` JSON columns and `rep_block` rows.

- [ ] **Step 1: Write the failing test.** In `migrations.rs` tests, build a v2 database by hand (stamp `user_version = 2`, create the v2 tables, insert a piece with `goals='["memorize","hands together"]'` and `hard_spots='[{"measures":"12-16","note":"LH leap"}]'`, three overlapping blocks `mm 1–8`, `mm 5–12`, `mm 40–48`, and reps on block 1), then run `migrate` and assert v3 shape + preservation + back-fill:

```rust
#[cfg(test)]
mod v3_tests {
    use super::*;
    use rusqlite::Connection;

    fn seed_v2() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        c.execute_batch(SCHEMA_V1).unwrap();
        c.execute_batch(SCHEMA_V2).unwrap();
        c.execute_batch("PRAGMA user_version = 2;").unwrap();
        c.execute(
            "INSERT INTO piece (id,title,folder_path,goals,hard_spots) VALUES \
             (1,'Etude','/p/1','[\"memorize\",\"hands together\"]',\
             '[{\"measures\":\"12-16\",\"note\":\"LH leap\"}]')", []).unwrap();
        for (id, s, e) in [(1, 1, 8), (2, 5, 12), (3, 40, 48)] {
            c.execute(
                "INSERT INTO rep_block (id,piece_id,m_start,m_end,start_bpm,increment_rule,planned_reps,status) \
                 VALUES (?1,1,?2,?3,40.0,'{\"clean_needed\":2,\"bpm_step\":4}',10,'done')",
                (id, s, e)).unwrap();
        }
        c.execute("INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'clean')", []).unwrap();
        c.execute("INSERT INTO rep (block_id,bpm,verdict) VALUES (1,40.0,'flawed')", []).unwrap();
        c
    }

    #[test]
    fn migrate_v2_to_v3_is_additive_and_backfills() {
        let c = seed_v2();
        migrate(&c).unwrap();

        // schema stamped
        let v: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);

        // new tables exist
        for t in ["region", "goal", "event"] {
            let n: i64 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "table {t} missing");
        }

        // all prior blocks/reps preserved
        let blocks: i64 = c.query_row("SELECT count(*) FROM rep_block", [], |r| r.get(0)).unwrap();
        assert_eq!(blocks, 3);
        let reps: i64 = c.query_row("SELECT count(*) FROM rep", [], |r| r.get(0)).unwrap();
        assert_eq!(reps, 2);

        // rep_block gained columns with correct defaults
        let (focus, use_metro): (String, i64) = c.query_row(
            "SELECT focus, use_metronome FROM rep_block WHERE id=1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(focus, "tempo");
        assert_eq!(use_metro, 1);

        // session gained focused_seconds
        c.execute("INSERT INTO session (id) VALUES (1)", []).unwrap();
        let fs: Option<i64> = c.query_row("SELECT focused_seconds FROM session WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(fs, None);

        // back-fill: blocks 1&2 overlap → one section region; block 3 → another; + 1 hard_spot region
        let sections: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='section'", [], |r| r.get(0)).unwrap();
        assert_eq!(sections, 2);
        let hard: i64 = c.query_row(
            "SELECT count(*) FROM region WHERE piece_id=1 AND kind='hard_spot'", [], |r| r.get(0)).unwrap();
        assert_eq!(hard, 1);
        // blocks 1 and 2 assigned to the same region
        let (r1, r2): (i64, i64) = c.query_row(
            "SELECT (SELECT region_id FROM rep_block WHERE id=1),(SELECT region_id FROM rep_block WHERE id=2)",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(r1, r2);

        // intake goals → Goal rows kind=big
        let goals: i64 = c.query_row(
            "SELECT count(*) FROM goal WHERE piece_id=1 AND kind='big'", [], |r| r.get(0)).unwrap();
        assert_eq!(goals, 2);

        // idempotent: second migrate does not duplicate
        migrate(&c).unwrap();
        let regions2: i64 = c.query_row("SELECT count(*) FROM region", [], |r| r.get(0)).unwrap();
        assert_eq!(regions2, 3);
    }
}
```

- [ ] **Step 2: Run it, verify it fails.** `cd ~/codakiller/src-tauri && cargo test store::migrations::v3_tests`. Expect failure: `SCHEMA_VERSION` is 2 so `migrate` never reaches v3; the `region`/`goal`/`event` table asserts fail (`table region missing`).

- [ ] **Step 3: Implement.** Bump the version, add the additive v3 batch (new tables + a full `rep_block` rebuild so `start_bpm`/`increment_rule` become nullable and the three new columns land, plus `session.focused_seconds`), wire the back-fill, and add `mod backfill;` to `store/mod.rs`.

In `migrations.rs`:
```rust
pub const SCHEMA_VERSION: i32 = 3;

/// Schema v3 — strictly additive in effect (all v2 rows preserved). New tables,
/// a `rep_block` rebuild that relaxes BPM/ladder NOT NULLs and adds
/// region_id/focus/use_metronome, and `session.focused_seconds`. The rebuild copies
/// every existing row; it is the only way SQLite can drop a NOT NULL constraint.
const SCHEMA_V3: &str = "\
CREATE TABLE region (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  name TEXT NOT NULL,
  m_start INTEGER NOT NULL,
  m_end INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'section'
       CHECK(kind IN ('section','phrase','group','hard_spot','custom')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  pdf_anchor TEXT                       -- reserved for P4 (JSON), nullable
);
CREATE TABLE goal (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'big' CHECK(kind IN ('big','sub')),
  parent_goal_id INTEGER REFERENCES goal(id),
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,
  created_ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  session_id INTEGER REFERENCES session(id),
  piece_id INTEGER REFERENCES piece(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'    -- JSON
);

-- rep_block rebuild: relax start_bpm/increment_rule NOT NULL, add v3 columns.
CREATE TABLE rep_block_v3 (
  id INTEGER PRIMARY KEY,
  piece_id INTEGER NOT NULL REFERENCES piece(id),
  m_start INTEGER NOT NULL, m_end INTEGER NOT NULL, label TEXT,
  start_bpm REAL, target_bpm REAL,
  increment_rule TEXT, planned_reps INTEGER NOT NULL DEFAULT 0,
  variants TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','abandoned')),
  region_id INTEGER REFERENCES region(id),
  focus TEXT NOT NULL DEFAULT 'tempo'
       CHECK(focus IN ('tempo','notes','phrasing','dynamics','memory','hands','other')),
  use_metronome INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO rep_block_v3
  (id,piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,planned_reps,variants,status,created_at)
  SELECT id,piece_id,m_start,m_end,label,start_bpm,target_bpm,increment_rule,planned_reps,variants,status,created_at
  FROM rep_block;
DROP TABLE rep_block;
ALTER TABLE rep_block_v3 RENAME TO rep_block;

ALTER TABLE session ADD COLUMN focused_seconds INTEGER;
";

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 { conn.execute_batch(SCHEMA_V1)?; }
    if version < 2 { conn.execute_batch(SCHEMA_V2)?; }
    if version < 3 {
        // The rep_block rebuild drops a table that `rep` FKs into. Disable FK
        // enforcement for the structural step (rows are re-inserted with identical
        // ids, so referential integrity is preserved) then re-enable.
        conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
        conn.execute_batch(SCHEMA_V3)?;
        super::backfill::backfill_v3(conn)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }
    if version != SCHEMA_VERSION {
        conn.execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION))?;
    }
    Ok(())
}
```

`store/backfill.rs` — the region-clustering algorithm is decision-locking:
```rust
//! One-shot v3 back-fill. Idempotent by construction: it only runs inside the
//! `version < 3` migration step, and each sub-step no-ops if its target rows
//! already exist (guards on `region`/`goal` emptiness per piece).
use rusqlite::Connection;
use serde_json::Value;

const PALETTE: [&str; 6] = ["#6b8fb5", "#b58f6b", "#8fb56b", "#b56b8f", "#6bb5a8", "#a86bb5"];

pub(crate) fn backfill_v3(conn: &Connection) -> rusqlite::Result<()> {
    let piece_ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM piece")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for pid in piece_ids {
        backfill_regions_for_piece(conn, pid)?;
        backfill_hard_spots_for_piece(conn, pid)?;
        backfill_goals_for_piece(conn, pid)?;
    }
    Ok(())
}

/// Cluster a piece's blocks into Regions by overlapping/touching measure ranges.
/// Sort by m_start; a block joins the current cluster iff m_start <= running m_end;
/// otherwise it starts a new cluster. One `kind='section'` Region per cluster; each
/// block in the cluster gets that region_id. Skips pieces that already have regions.
fn backfill_regions_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row(
        "SELECT count(*) FROM region WHERE piece_id=?1 AND kind='section'", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }

    // (block_id, m_start, m_end) ordered by start then end
    let blocks: Vec<(i64, i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT id, m_start, m_end FROM rep_block WHERE piece_id=?1 ORDER BY m_start, m_end")?;
        stmt.query_map([pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?
    };
    if blocks.is_empty() { return Ok(()); }

    let mut clusters: Vec<(i64, i64, Vec<i64>)> = Vec::new(); // (cs, ce, block_ids)
    for (bid, s, e) in blocks {
        match clusters.last_mut() {
            Some((_cs, ce, ids)) if s <= *ce => { *ce = (*ce).max(e); ids.push(bid); }
            _ => clusters.push((s, e, vec![bid])),
        }
    }
    for (i, (cs, ce, ids)) in clusters.into_iter().enumerate() {
        let color = PALETTE[i % PALETTE.len()];
        let name = format!("mm. {cs}–{ce}");
        conn.execute(
            "INSERT INTO region (piece_id,name,m_start,m_end,kind,sort_order,color) \
             VALUES (?1,?2,?3,?4,'section',?5,?6)",
            rusqlite::params![pid, name, cs, ce, i as i64, color])?;
        let rid = conn.last_insert_rowid();
        for bid in ids {
            conn.execute("UPDATE rep_block SET region_id=?1 WHERE id=?2", [rid, bid])?;
        }
    }
    Ok(())
}

/// intake hard_spots[] JSON ({measures, note}) → Region kind='hard_spot'.
fn backfill_hard_spots_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row(
        "SELECT count(*) FROM region WHERE piece_id=?1 AND kind='hard_spot'", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }
    let raw: String = conn.query_row("SELECT hard_spots FROM piece WHERE id=?1", [pid], |r| r.get(0))
        .unwrap_or_else(|_| "[]".into());
    let spots: Vec<Value> = serde_json::from_str(&raw).unwrap_or_default();
    for (i, spot) in spots.iter().enumerate() {
        let measures = spot.get("measures").and_then(Value::as_str).unwrap_or("").to_string();
        let note = spot.get("note").and_then(Value::as_str).unwrap_or("").to_string();
        let (ms, me) = parse_measure_range(&measures);
        let name = if note.is_empty() { format!("hard spot mm. {measures}") } else { note };
        conn.execute(
            "INSERT INTO region (piece_id,name,m_start,m_end,kind,sort_order,color) \
             VALUES (?1,?2,?3,?4,'hard_spot',?5,'#c05a5a')",
            rusqlite::params![pid, name, ms, me, (1000 + i) as i64])?;
    }
    Ok(())
}

/// intake goals[] JSON (string array) → Goal kind='big'.
fn backfill_goals_for_piece(conn: &Connection, pid: i64) -> rusqlite::Result<()> {
    let existing: i64 = conn.query_row("SELECT count(*) FROM goal WHERE piece_id=?1", [pid], |r| r.get(0))?;
    if existing > 0 { return Ok(()); }
    let raw: String = conn.query_row("SELECT goals FROM piece WHERE id=?1", [pid], |r| r.get(0))
        .unwrap_or_else(|_| "[]".into());
    let goals: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    for (i, text) in goals.iter().enumerate() {
        conn.execute(
            "INSERT INTO goal (piece_id,text,kind,sort_order) VALUES (?1,?2,'big',?3)",
            rusqlite::params![pid, text, i as i64])?;
    }
    Ok(())
}

/// "12-16" → (12,16); "12" → (12,12); unparseable → (0,0).
fn parse_measure_range(s: &str) -> (i64, i64) {
    let clean: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '-' || *c == '–').collect();
    let norm = clean.replace('–', "-");
    let mut parts = norm.split('-').filter(|p| !p.is_empty());
    let a = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let b = parts.next().and_then(|p| p.parse().ok()).unwrap_or(a);
    (a, b)
}
```
Add unit tests in `backfill.rs` for `parse_measure_range` (`"12-16"`, `"12"`, `"mm. 40–48"`, `""`) and the clustering (adjacent/touching/disjoint cases).

- [ ] **Step 4: Run tests, verify pass.** `cd ~/codakiller/src-tauri && cargo test store::migrations::v3_tests store::backfill`. Expect all green. Then `cargo test` (full suite) to confirm existing store/rep tests still pass against v3.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T1: schema v3 migration + idempotent back-fill (regions/goals/events)"` (append the Co-Authored-By trailer).

---

### Task 2: Durable event log module
**Files:** Create `src-tauri/src/store/events.rs`; Modify `src-tauri/src/store/mod.rs` (module decl + re-export), `src-tauri/src/rep/mod.rs` (append on open/check), `src-tauri/src/sessions/*` (append on session start/end); Test `src-tauri/src/store/events.rs` tests.
**Interfaces:** Consumes v3 `event` table (T1). Produces on `Store`: `pub fn append_event(&self, kind: &str, session_id: Option<i64>, piece_id: Option<i64>, payload: &serde_json::Value) -> rusqlite::Result<i64>`; `pub fn events_for_session(&self, session_id: i64) -> rusqlite::Result<Vec<Event>>`; `pub fn events_for_piece(&self, piece_id: i64) -> rusqlite::Result<Vec<Event>>`. `Event` wire type (added to `model.rs` in this task). `EventKind` string constants: `session_start`, `session_end`, `rep_open`, `rep`, `verdict`, `tempo_change`, `block_edit`, `rep_edit`, `region_change`, `goal_change`.

- [ ] **Step 1: Write the failing test.** In `events.rs`:
```rust
#[cfg(test)]
mod tests {
    use crate::store::Store;
    use serde_json::json;

    #[test]
    fn append_and_read_back_ordered() {
        let s = Store::open(":memory:").unwrap();
        let pid = 1i64; // event.piece_id FK is deferred/off in tests via nullable insert
        s.append_event(super::EventKind::REP_OPEN, Some(1), Some(pid), &json!({"block_id":7})).unwrap();
        s.append_event(super::EventKind::REP, Some(1), Some(pid), &json!({"verdict":"clean"})).unwrap();
        let evs = s.events_for_session(1).unwrap();
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].kind, "rep_open");
        assert_eq!(evs[1].payload["verdict"], "clean");
    }
}
```
(The test seeds a piece row first if the FK is enforced; add `s.append_event(EventKind::SESSION_START, Some(1), None, &json!({}))` variant to prove nullable piece_id.)

- [ ] **Step 2: Run it, verify it fails.** `cd ~/codakiller/src-tauri && cargo test store::events`. Expect failure: `append_event`/`events_for_session`/`EventKind` do not exist.

- [ ] **Step 3: Implement.** In `model.rs` add:
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Event {
    pub id: i64,
    pub ts: String,
    pub session_id: Option<i64>,
    pub piece_id: Option<i64>,
    pub kind: String,
    pub payload: serde_json::Value,
}
```
In `events.rs` implement the store methods plus:
```rust
pub struct EventKind;
impl EventKind {
    pub const SESSION_START: &'static str = "session_start";
    pub const SESSION_END:  &'static str = "session_end";
    pub const REP_OPEN:     &'static str = "rep_open";
    pub const REP:          &'static str = "rep";
    pub const VERDICT:      &'static str = "verdict";
    pub const TEMPO_CHANGE: &'static str = "tempo_change";
    pub const BLOCK_EDIT:   &'static str = "block_edit";
    pub const REP_EDIT:     &'static str = "rep_edit";
    pub const REGION_CHANGE:&'static str = "region_change";
    pub const GOAL_CHANGE:  &'static str = "goal_change";
}
```
`append_event` inserts `(kind, session_id, piece_id, payload_json)` and returns `last_insert_rowid()`; readers `SELECT id,ts,session_id,piece_id,kind,payload FROM event WHERE … ORDER BY id` and `serde_json::from_str` the payload. Then wire existing mutations: `rep/mod.rs::open` appends `REP_OPEN`, `check` appends `REP` (+ `TEMPO_CHANGE` when the ladder advances — landed fully in T18); `sessions` start/end append `SESSION_START`/`SESSION_END`. Keep the existing `session_event` writes as-is (they drive the live feed); the new `event` table is the durable canonical log.

- [ ] **Step 4: Run tests, verify pass.** `cargo test store::events` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T2: durable append-only event log + wire existing mutations"`.

---

### Task 3: Region CRUD commands
**Files:** Create `src-tauri/src/store/crud.rs` (region methods) — or extend if T4/T5/T6 land first; Modify `src-tauri/src/store/mod.rs`, `src-tauri/src/lib.rs` (command wrappers + `generate_handler!`), `src-tauri/src/store/model.rs` (`Region`, `RegionPatch`); Test `src-tauri/src/store/crud.rs` tests.
**Interfaces:** Consumes T1 `region` table, T2 `append_event`. Produces `Store` methods and commands: `region_list(piece_id: i64) -> Vec<Region>`, `region_create(args: RegionCreate) -> Region`, `region_update(id: i64, patch: RegionPatch) -> Region`, `region_delete(id: i64) -> ()` (sets member blocks' `region_id = NULL`), `region_merge(id_keep: i64, id_absorb: i64) -> Region` (reassigns absorbed blocks to keep, deletes absorbed, keep's range expands to cover both).

- [ ] **Step 1: Write the failing test.** `crud.rs`:
```rust
#[test]
fn region_merge_reassigns_and_widens() {
    let s = Store::open(":memory:").unwrap();
    seed_piece(&s, 1);
    let a = s.region_create(RegionCreate{piece_id:1,name:"A".into(),m_start:1,m_end:8,kind:"section".into()}).unwrap();
    let b = s.region_create(RegionCreate{piece_id:1,name:"B".into(),m_start:20,m_end:28,kind:"section".into()}).unwrap();
    let bid = seed_block(&s, 1, 22, 26); // block in region B
    s.block_set_region(bid, Some(b.id)).unwrap();
    let kept = s.region_merge(a.id, b.id).unwrap();
    assert_eq!(kept.id, a.id);
    assert_eq!(kept.m_start, 1);
    assert_eq!(kept.m_end, 28);                       // widened
    assert_eq!(s.region_list(1).unwrap().len(), 1);   // B gone
    assert_eq!(s.block_row(bid).unwrap().region_id, Some(a.id)); // reassigned
}
```
Plus tests: `region_delete` nulls member blocks but keeps them; `region_update` applies a partial patch; `region_list` orders by `sort_order`.

- [ ] **Step 2: Run it, verify it fails.** `cargo test store::crud::region`. Expect: methods/types missing.

- [ ] **Step 3: Implement.** `model.rs`:
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Region {
    pub id: i64, pub piece_id: i64, pub name: String,
    pub m_start: u32, pub m_end: u32, pub kind: String,
    #[serde(rename = "order")] pub order: i64,   // SQL column sort_order
    pub color: Option<String>,
    pub pdf_anchor: Option<serde_json::Value>,   // reserved P4
}
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RegionCreate { pub piece_id: i64, pub name: String, pub m_start: u32, pub m_end: u32, pub kind: String }
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct RegionPatch {
    pub name: Option<String>, pub m_start: Option<u32>, pub m_end: Option<u32>,
    pub kind: Option<String>, #[serde(rename="order")] pub order: Option<i64>, pub color: Option<String>,
}
```
Implement the `Store` methods (each mutation calls `append_event(EventKind::REGION_CHANGE, …)`), then thin commands in `lib.rs` (e.g. `#[tauri::command] fn region_list(piece_id: i64, store: State<Arc<Store>>) -> Result<Vec<Region>, String>`), and add all five to `generate_handler!`.

- [ ] **Step 4: Run tests, verify pass.** `cargo test store::crud::region` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T3: region CRUD + merge commands"`.

---

### Task 4: Block update/delete with active-snapshot sync
**Files:** Modify `src-tauri/src/store/crud.rs`, `src-tauri/src/store/model.rs` (`BlockPatch`), `src-tauri/src/rep/mod.rs` (active-block resync helper), `src-tauri/src/lib.rs`; Test `src-tauri/src/rep/mod.rs` tests (active-sync) + `store/crud.rs` tests (persist).
**Interfaces:** Consumes T1 schema, T2 events, T3 crud module. Produces `block_update(block_id: i64, patch: BlockPatch) -> BlockHistory`, `block_delete(block_id: i64) -> ()` (cascade-deletes its reps), and on `RepEngine`: `pub fn resync_active_if(&self, block_id: i64)` which, when `block_id` is the open block, reloads mutable fields into the in-memory `RepSnapshot` and calls `emit_state`.

- [ ] **Step 1: Write the failing test.** In `rep/mod.rs` tests, open a block, edit its label/target_bpm via `block_update`, then `resync_active_if`, and assert the emitted snapshot reflects the edit (use the existing test `StateEmitter` capture pattern):
```rust
#[test]
fn editing_active_block_reemits_snapshot() {
    let (engine, emitter) = engine_with_capture(); // existing helper
    let snap = engine.open(sample_open_args(/*piece*/1)).unwrap();
    engine.store.block_update(snap.block_id, BlockPatch{ label: Some(Some("legato".into())),
        target_bpm: Some(Some(120.0)), ..Default::default() }).unwrap();
    engine.resync_active_if(snap.block_id);
    let last = emitter.last_state();       // capture helper
    assert_eq!(last.label.as_deref(), Some("legato"));
    assert_eq!(last.target_bpm, Some(120.0));
}
```
Plus a `crud.rs` test: `block_delete` removes the block and its reps; `block_update` on a non-active block persists without touching the engine.

- [ ] **Step 2: Run it, verify it fails.** `cargo test rep::` and `cargo test store::crud::block`. Expect: `block_update`/`BlockPatch`/`resync_active_if` missing.

- [ ] **Step 3: Implement.** `BlockPatch` (nullable fields use `Option<Option<T>>`: absent = leave; `Some(None)` = set NULL; `Some(Some(v))` = set v):
```rust
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct BlockPatch {
    pub label: Option<Option<String>>,
    pub m_start: Option<u32>, pub m_end: Option<u32>,
    pub start_bpm: Option<Option<f64>>, pub target_bpm: Option<Option<f64>>,
    pub planned_reps: Option<u32>,
    pub focus: Option<String>, pub use_metronome: Option<bool>,
    pub region_id: Option<Option<i64>>,
    pub increment_rule: Option<Option<IncrementRule>>,
}
```
`block_update` builds a dynamic `UPDATE rep_block SET …` from the present patch fields, appends `EventKind::BLOCK_EDIT`, returns the refreshed `BlockHistory` (reuse `block_history`'s row-mapping for a single id via a new `block_row(id)` reader). `block_delete` runs `DELETE FROM rep WHERE block_id=?; DELETE FROM rep_block WHERE id=?` in a transaction + `BLOCK_EDIT` event. `RepEngine::resync_active_if` locks `active`, and if `Some(s)` with `s.block_id == block_id`, reloads label/m_start/m_end/bpm ladder/planned_reps from `block_row`, then `emit_state(Some(&s))`. The `block_update`/`block_delete` commands, after the store call, invoke `rep.resync_active_if(block_id)`.

- [ ] **Step 4: Run tests, verify pass.** `cargo test rep:: store::crud::block` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T4: block update/delete + active-snapshot resync + rep://state re-emit"`.

---

### Task 5: Rep update/delete with count recompute
**Files:** Modify `src-tauri/src/store/crud.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/rep/mod.rs` (resync after recompute); Test `store/crud.rs` tests.
**Interfaces:** Consumes T1/T2/T4. Produces `rep_update(rep_id: i64, patch: RepPatch) -> ()`, `rep_delete(rep_id: i64) -> ()`, and a private `recompute_block_counts(conn, block_id)` used by both. `RepPatch { verdict: Option<String>, note: Option<Option<String>> }`. After either, the owning block's active snapshot is resynced (`reps_done` + `verdicts` recomputed from surviving reps).

- [ ] **Step 1: Write the failing test.** `crud.rs`:
```rust
#[test]
fn deleting_a_rep_recomputes_block_counts() {
    let s = Store::open(":memory:").unwrap();
    seed_piece(&s, 1);
    let bid = seed_block(&s, 1, 1, 8);
    let r1 = seed_rep(&s, bid, "clean");
    let _r2 = seed_rep(&s, bid, "clean");
    let _r3 = seed_rep(&s, bid, "flawed");
    s.rep_delete(r1).unwrap();
    let b = s.block_row(bid).unwrap();          // BlockHistory
    assert_eq!(b.reps_done, 2);
    assert_eq!(b.verdicts.clean, 1);
    assert_eq!(b.verdicts.flawed, 1);
}

#[test]
fn updating_a_verdict_recomputes_counts() {
    let s = Store::open(":memory:").unwrap();
    seed_piece(&s, 1);
    let bid = seed_block(&s, 1, 1, 8);
    let r1 = seed_rep(&s, bid, "flawed");
    s.rep_update(r1, RepPatch{ verdict: Some("clean".into()), note: None }).unwrap();
    assert_eq!(s.block_row(bid).unwrap().verdicts.clean, 1);
}
```

- [ ] **Step 2: Run it, verify it fails.** `cargo test store::crud::rep`. Expect: `rep_update`/`rep_delete`/`RepPatch` missing.

- [ ] **Step 3: Implement.** The count-recompute is decision-locking — verdict counts and `reps_done` are always derived from surviving `rep` rows, never decremented in place:
```rust
fn recompute_block_counts(conn: &Connection, block_id: i64) -> rusqlite::Result<VerdictCounts> {
    let mut counts = VerdictCounts::default();
    let mut stmt = conn.prepare(
        "SELECT verdict, COUNT(*) FROM rep WHERE block_id=?1 GROUP BY verdict")?;
    let rows = stmt.query_map([block_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (v, n) = row?;
        match v.as_str() {
            "clean" => counts.clean = n as u32,
            "flawed" => counts.flawed = n as u32,
            "failed" => counts.failed = n as u32,
            _ => {}
        }
    }
    Ok(counts)
}
```
`block_row(id)` derives `reps_done = clean+flawed+failed` and `bpm` (current) from `MAX(bpm)` over surviving reps (or `start_bpm` when none), so recompute needs no stored counter. `rep_update` sets verdict/note then appends `EventKind::REP_EDIT`; `rep_delete` deletes the row then appends `REP_EDIT`. Both look up the owning `block_id`, and the commands call `rep.resync_active_if(block_id)` so a live drill-in edit re-emits `rep://state`.

- [ ] **Step 4: Run tests, verify pass.** `cargo test store::crud::rep` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T5: rep update/delete with verdict-count recompute"`.

---

### Task 6: Goal CRUD commands
**Files:** Modify `src-tauri/src/store/crud.rs`, `src-tauri/src/store/model.rs` (`Goal`, `GoalCreate`, `GoalPatch`), `src-tauri/src/lib.rs`; Test `store/crud.rs` tests.
**Interfaces:** Consumes T1/T2. Produces `goal_list(piece_id) -> Vec<Goal>` (ordered by `sort_order`), `goal_create(GoalCreate) -> Goal`, `goal_update(id, GoalPatch) -> Goal`, `goal_delete(id) -> ()`, `goal_reorder(piece_id, ordered_ids: Vec<i64>) -> ()` (assigns `sort_order` by array index in a transaction).

- [ ] **Step 1: Write the failing test.** `crud.rs`:
```rust
#[test]
fn goal_reorder_sets_sort_order_by_index() {
    let s = Store::open(":memory:").unwrap();
    seed_piece(&s, 1);
    let a = s.goal_create(GoalCreate{piece_id:1,text:"a".into(),kind:"big".into(),parent_goal_id:None,target_date:None}).unwrap();
    let b = s.goal_create(GoalCreate{piece_id:1,text:"b".into(),kind:"big".into(),parent_goal_id:None,target_date:None}).unwrap();
    s.goal_reorder(1, vec![b.id, a.id]).unwrap();
    let ids: Vec<i64> = s.goal_list(1).unwrap().into_iter().map(|g| g.id).collect();
    assert_eq!(ids, vec![b.id, a.id]);
}
```
Plus: `goal_update` toggles `done`; `goal_delete` removes it.

- [ ] **Step 2: Run it, verify it fails.** `cargo test store::crud::goal`. Expect: missing methods/types.

- [ ] **Step 3: Implement.** `model.rs`:
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Goal {
    pub id: i64, pub piece_id: i64, pub text: String, pub kind: String,
    pub parent_goal_id: Option<i64>, pub done: bool,
    #[serde(rename = "order")] pub order: i64,
    pub target_date: Option<String>, pub created_ts: String,
}
#[derive(Debug, Clone, serde::Deserialize)]
pub struct GoalCreate { pub piece_id: i64, pub text: String, pub kind: String,
    pub parent_goal_id: Option<i64>, pub target_date: Option<String> }
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct GoalPatch { pub text: Option<String>, pub done: Option<bool>,
    pub target_date: Option<Option<String>>, pub parent_goal_id: Option<Option<i64>> }
```
Implement the five methods (each mutation appends `EventKind::GOAL_CHANGE`); new goals get `sort_order = MAX(sort_order)+1` for the piece. Register commands.

- [ ] **Step 4: Run tests, verify pass.** `cargo test store::crud::goal` then `cargo test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T6: goal CRUD + reorder commands"`.

---

### Task 7: Inline piece-field update
**Files:** Modify `src-tauri/src/store/crud.rs`, `src-tauri/src/store/model.rs` (`PieceFieldPatch`), `src-tauri/src/lib.rs`; Test `store/crud.rs` tests.
**Interfaces:** Consumes T1/T2. Produces `piece_field_update(piece_id: i64, patch: PieceFieldPatch) -> ()` updating any of `current_state`, `deadline`, `target_tempo`, `notes` (each optional; absent = unchanged).

- [ ] **Step 1: Write the failing test.** `crud.rs`:
```rust
#[test]
fn piece_field_update_edits_current_state_only() {
    let s = Store::open(":memory:").unwrap();
    seed_piece(&s, 1);
    s.piece_field_update(1, PieceFieldPatch{ current_state: Some(Some("mm.1-40 solid".into())), ..Default::default() }).unwrap();
    let p = s.get_piece(1).unwrap();          // existing reader (PieceDetail)
    assert_eq!(p.current_state.as_deref(), Some("mm.1-40 solid"));
    assert_eq!(p.deadline, None);             // untouched
}
```

- [ ] **Step 2: Run it, verify it fails.** `cargo test store::crud::piece_field`. Expect missing method/type.

- [ ] **Step 3: Implement.**
```rust
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct PieceFieldPatch {
    pub current_state: Option<Option<String>>,
    pub deadline: Option<Option<String>>,
    pub target_tempo: Option<Option<f64>>,
    pub notes: Option<Option<String>>,
}
```
Dynamic `UPDATE piece SET …` over present fields. **No event is appended** — piece intake fields (current_state/deadline/target_tempo/notes) are metadata, not part of the practice-event stream that metrics derive from; this is a deliberate choice (goals, by contrast, DO emit `goal_change`). Register the command.

- [ ] **Step 4: Run tests, verify pass.** `cargo test store::crud::piece_field` then `cargo test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T7: piece_field_update inline edits (current_state/deadline/target_tempo/notes)"`.

---

### Task 8: Re-point export at the canonical graph
**Files:** Modify `src-tauri/src/sessions/export.rs` (L51 `write_session_md` + `render_section` L156); Test `src-tauri/src/sessions/export.rs` integration test.
**Interfaces:** Consumes T1 graph + T4/T5 edits. Produces `write_session_md(store: &Store, session_id: i64, pieces_dir: &Path) -> ExportResult` reading current `rep_block`/`rep` values (not frozen `session_event` payloads), so a block edited after its reps were logged exports with the edited label/tempo. Contract otherwise unchanged (append-only per-piece `(C) codakiller-sessions.md`).

- [ ] **Step 1: Write the failing test.** Integration test proving edit-then-relaunch-then-export reflects the edit:
```rust
#[test]
fn export_reflects_post_log_block_edit_after_relaunch() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("codakiller.db");
    let pieces = dir.path().join("pieces");
    std::fs::create_dir_all(pieces.join("etude")).unwrap();

    // session 1: log reps under original label
    let block_id;
    let session_id;
    {
        let store = Store::open(&db).unwrap();
        let pid = seed_piece_with_folder(&store, "Etude", pieces.join("etude").to_str().unwrap());
        session_id = store.start_session().unwrap();
        block_id = seed_block(&store, pid, 1, 8);      // label "mm.1-8"
        seed_rep(&store, block_id, "clean");
        // edit AFTER logging
        store.block_update(block_id, BlockPatch{ label: Some(Some("legato section".into())), ..Default::default() }).unwrap();
    } // store dropped == "relaunch"

    // relaunch: fresh Store on same db, export
    let store2 = Store::open(&db).unwrap();
    let res = write_session_md(&store2, session_id, &pieces);
    let md = std::fs::read_to_string(pieces.join("etude").join("(C) codakiller-sessions.md")).unwrap();
    assert!(md.contains("legato section"), "export must reflect the post-log edit; got:\n{md}");
    assert!(res.reps >= 1);
}
```

- [ ] **Step 2: Run it, verify it fails.** `cargo test sessions::export::export_reflects`. Expect failure: current `write_session_md` reconstructs from `session_event` payloads (frozen label "mm.1-8"), so `legato section` is absent.

- [ ] **Step 3: Implement.** Rewrite `write_session_md` to enumerate the session's pieces (via the `event`/session-piece linkage or the blocks touched in the session window) and render each piece section from `store.block_history(piece_id)` + `store.reps_for_block(block_id)` — the current canonical values. Keep the append-only file contract and `ExportResult` shape. `render_section` takes `&BlockHistory`/reps instead of event tallies.

- [ ] **Step 4: Run tests, verify pass.** `cargo test sessions::export` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T8: export reads canonical SQLite graph (survives relaunch, reflects edits)"`.

---

### Task 9: Derived-metrics layer + progress_summary
**Files:** Create `src-tauri/src/metrics/mod.rs`; Modify `src-tauri/src/lib.rs` (`mod metrics;` + command), `src-tauri/src/store/model.rs` (`ProgressSummary` + parts); Test `src-tauri/src/metrics/mod.rs` tests.
**Interfaces:** Consumes T1 graph + T2 events. Produces pure functions `focused_seconds(events: &[Event]) -> u64`, `per_region_mastery(regions, blocks, reps) -> Vec<RegionMastery>`, `streak(session_days: &[String]) -> u32`, `best_tempo_reached(reps) -> Option<f64>`, `time_by_focus(events, blocks) -> Vec<FocusTime>`, and the command `progress_summary(piece_id: i64) -> ProgressSummary`.

- [ ] **Step 1: Write the failing test.** `metrics/mod.rs` — test each metric as a pure function; `focused_seconds` derivation is decision-locking:
```rust
#[test]
fn focused_seconds_sums_gaps_under_idle_threshold() {
    // gaps of 30s, 45s, then a 10-min idle gap (excluded), then 20s
    let evs = events_at(&[0, 30, 75, 675, 695]); // seconds since epoch
    // 30 + 45 + (idle >120 → 0) + 20 = 95
    assert_eq!(focused_seconds(&evs), 95);
}

#[test]
fn streak_counts_consecutive_calendar_days_back_from_latest() {
    assert_eq!(streak(&["2026-07-10".into(),"2026-07-11".into(),"2026-07-12".into()]), 3);
    assert_eq!(streak(&["2026-07-08".into(),"2026-07-10".into(),"2026-07-11".into()]), 2);
}
```
Plus `per_region_mastery` (clean-ratio + best_bpm per region) and `best_tempo_reached`.

- [ ] **Step 2: Run it, verify it fails.** `cargo test metrics::`. Expect: functions missing.

- [ ] **Step 3: Implement.** `focused_seconds` (locked):
```rust
pub const IDLE_THRESHOLD_SECS: i64 = 120;

/// Sum the gaps between consecutive events, counting only gaps at or under the
/// idle threshold (a longer gap means the pianist stepped away — not focused time).
pub fn focused_seconds(events: &[Event]) -> u64 {
    let mut ts: Vec<i64> = events.iter().filter_map(|e| parse_ts_secs(&e.ts)).collect();
    ts.sort_unstable();
    ts.windows(2)
        .map(|w| (w[1] - w[0]).clamp(0, IDLE_THRESHOLD_SECS))
        .map(|g| if g <= IDLE_THRESHOLD_SECS { g } else { 0 })
        .sum::<i64>() as u64
}
```
`per_region_mastery`: group blocks by `region_id`, aggregate reps → `{ region_id, name, blocks, reps, clean_ratio, best_bpm, last_practiced }`. `streak`: dedupe session dates, sort desc, count consecutive calendar days back from the latest. `progress_summary` command loads events + graph via `Store` and returns `ProgressSummary { piece_id, focused_seconds, per_region_mastery, streak, best_tempo_reached, time_by_focus }`. Add the wire types to `model.rs`.

- [ ] **Step 4: Run tests, verify pass.** `cargo test metrics::` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T9: stateless metrics layer + progress_summary command"`.

---

### Task 10: Frontend edit primitives
**Files:** Create `src/components/EditableField.tsx`, `src/components/EditableNumber.tsx`, `src/components/ConfirmDelete.tsx`; Test `src/components/EditableField.test.tsx`, `EditableNumber.test.tsx`, `ConfirmDelete.test.tsx`.
**Interfaces:** Produces:
```typescript
interface EditableFieldProps {
  value: string;
  onSave: (next: string) => Promise<void>; // rejects → rollback
  placeholder?: string;
  ariaLabel: string;
}
interface EditableNumberProps {
  value: number | null;
  onSave: (next: number | null) => Promise<void>;
  min?: number; max?: number; step?: number;
  allowNull?: boolean; ariaLabel: string;
}
interface ConfirmDeleteProps {
  label: string;                 // "this block and its 9 reps"
  onConfirm: () => Promise<void>;
  children: React.ReactNode;     // the trigger
}
```
Behavior: double-click → input pre-filled; Enter or blur → optimistic set + call `onSave`; on reject, roll back to prior value and surface the error; Esc → cancel, no call. `EditableNumber` renders the existing stepper affordance; `allowNull` lets a cleared field save `null`. `ConfirmDelete` shows an inline popover with Confirm/Cancel; Confirm calls `onConfirm` and closes.

- [ ] **Step 1: Write the failing test.** `EditableField.test.tsx` (match the existing vitest + Testing Library style — `renderHook`/`render`, `@testing-library/react`; no setup file, `globals: false` so import `describe/it/expect` from `vitest`):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditableField } from "./EditableField";

describe("EditableField", () => {
  it("double-click → edit → Enter saves optimistically", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "legato" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("legato"));
    expect(screen.getByText("legato")).toBeTruthy();
  });

  it("rolls back when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("bad"));
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("label");
    fireEvent.change(input, { target: { value: "legato" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("mm.1-8")).toBeTruthy()); // rolled back
  });

  it("Esc cancels without calling onSave", () => {
    const onSave = vi.fn();
    render(<EditableField value="mm.1-8" onSave={onSave} ariaLabel="label" />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    fireEvent.keyDown(screen.getByLabelText("label"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
  });
});
```
Write analogous tests for `EditableNumber` (clear→null when `allowNull`, min/max clamp) and `ConfirmDelete` (Confirm calls `onConfirm`, Cancel does not).

- [ ] **Step 2: Run it, verify it fails.** `cd ~/codakiller && npx vitest run src/components/EditableField.test.tsx`. Expect: module not found.

- [ ] **Step 3: Implement.** Build the three components to satisfy the contract. Representative core (`EditableField`):
```tsx
export function EditableField({ value, onSave, placeholder, ariaLabel }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [display, setDisplay] = useState(value);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDisplay(value), [value]);

  async function commit() {
    setEditing(false);
    if (draft === display) return;
    const prev = display;
    setDisplay(draft);                       // optimistic
    try { await onSave(draft); }
    catch { setDisplay(prev); }              // rollback
  }
  if (!editing) {
    return <span className="editable" onDoubleClick={() => { setDraft(display); setEditing(true); }}>
      {display || placeholder}</span>;
  }
  return <input aria-label={ariaLabel} autoFocus value={draft}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />;
}
```

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/components/EditableField.test.tsx src/components/EditableNumber.test.tsx src/components/ConfirmDelete.test.tsx`. Then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T10: EditableField/EditableNumber/ConfirmDelete primitives"`.

---

### Task 11: Wire editability + delete into blocks/reps/goals/current-state
**Files:** Create `src/features/rep/useCrud.ts`, `src/features/pieces/BlockRow.tsx`, `src/features/pieces/GoalsPanel.tsx`; Modify `src/features/pieces/PieceDetail.tsx`, `src/features/pieces/types.ts`; Test `src/features/pieces/BlockRow.test.tsx`, `GoalsPanel.test.tsx`, `useCrud.test.ts`.
**Interfaces:** Consumes T3–T7 commands + T10 primitives. Produces `useCrud()` returning typed invokers: `blockUpdate(id, patch)`, `blockDelete(id)`, `repUpdate(id, patch)`, `repDelete(id)`, `goalList/Create/Update/Delete/Reorder`, `pieceFieldUpdate(id, patch)`, `regionList/...`. `BlockRow` renders a block with editable label/measures/BPM/planned-reps + `ConfirmDelete`, and expands to an editable RepList (verdict chip + note per rep, each editable/deletable). `GoalsPanel` add/edit/delete/reorder.

- [ ] **Step 1: Write the failing test.** Container logic test (`BlockRow.test.tsx`) mocking `@tauri-apps/api/core` `invoke` (same pattern as `useRep.test.ts`):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { BlockRow } from "./BlockRow";

const block = { block_id: 7, m_start: 1, m_end: 8, label: "mm.1-8", start_bpm: 40,
  bpm: 40, target_bpm: 60, planned_reps: 10, reps_done: 0, status: "done",
  verdicts: { clean: 0, flawed: 0, failed: 0 }, region_id: 1, focus: "tempo", use_metronome: true };

describe("BlockRow", () => {
  beforeEach(() => invokeMock.mockReset());
  it("editing the label calls block_update with a patch", async () => {
    invokeMock.mockResolvedValue({ ...block, label: "legato" });
    render(<BlockRow block={block} onChanged={vi.fn()} />);
    fireEvent.doubleClick(screen.getByText("mm.1-8"));
    const input = screen.getByLabelText("block label");
    fireEvent.change(input, { target: { value: "legato" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "block_update", { blockId: 7, patch: { label: "legato" } }));
  });
});
```
Plus: delete flows through `ConfirmDelete`→`block_delete`; goal reorder calls `goal_reorder` with the new id order.

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/features/pieces/BlockRow.test.tsx`. Expect module-not-found.

- [ ] **Step 3: Implement.** `useCrud.ts` wraps each command (`invoke("block_update", { blockId, patch })` etc., matching Tauri's camelCase arg convention). `BlockRow` composes `EditableField`/`EditableNumber`/`ConfirmDelete`; the rep drill-in maps `reps_for_block` (add a `reps_for_block(block_id)` reader/command if not present) to editable rows. Extend `types.ts`:
```typescript
export interface Region { id: number; piece_id: number; name: string; m_start: number; m_end: number; kind: string; order: number; color: string | null; pdf_anchor: unknown | null; }
export interface Goal { id: number; piece_id: number; text: string; kind: string; parent_goal_id: number | null; done: boolean; order: number; target_date: string | null; created_ts: string; }
export interface BlockHistory { /* …existing… */ region_id: number | null; focus: string; use_metronome: boolean; }
```
Wire `PieceDetail` current-state/deadline/target-tempo/notes to `EditableField`/`EditableNumber` → `piece_field_update`.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/features/pieces` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T11: wire editable blocks/reps/goals/current-state to CRUD commands"`.

---

### Task 12: FloatingPanel component
**Files:** Create `src/components/FloatingPanel.tsx`, `src/components/FloatingPanel.css`; Test `src/components/FloatingPanel.test.tsx`.
**Interfaces:** Produces:
```typescript
export interface PanelGeometry { id: string; x: number; y: number; w: number; h: number; collapsed: boolean; z: number; }
interface FloatingPanelProps {
  geometry: PanelGeometry;
  title: string;
  onGeometryChange: (g: PanelGeometry) => void;   // drag/resize/collapse/snap commit
  onFocus: (id: string) => void;                   // raise-to-front request
  viewport: { w: number; h: number };
  children: React.ReactNode;
}
export function clampToViewport(g: PanelGeometry, vp: { w: number; h: number }): PanelGeometry;
export function snapToEdges(g: PanelGeometry, vp: { w: number; h: number }, threshold?: number): PanelGeometry;
```
Behavior: drag by header (pointer events), resize from bottom-right corner handle, collapse toggle (shows header only, preserves `h`), snap to an edge when within threshold on drop, raise-on-focus (pointerdown → `onFocus`), and every committed geometry is passed through `clampToViewport` so a panel can never be stranded off-screen.

- [ ] **Step 1: Write the failing test.** The clamp/snap core is decision-locking; test them as pure functions plus a drag interaction:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingPanel, clampToViewport, snapToEdges } from "./FloatingPanel";

describe("panel geometry", () => {
  const vp = { w: 1000, h: 800 };
  it("clamps a panel that would leave the viewport", () => {
    const g = { id: "a", x: 1200, y: -50, w: 300, h: 200, collapsed: false, z: 1 };
    const c = clampToViewport(g, vp);
    expect(c.x).toBe(700);   // 1000 - 300
    expect(c.y).toBe(0);
  });
  it("snaps to the left/top edge within threshold", () => {
    const g = { id: "a", x: 8, y: 6, w: 300, h: 200, collapsed: false, z: 1 };
    const s = snapToEdges(g, vp, 12);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });
  it("drag by header commits a clamped geometry", () => {
    const onChange = vi.fn();
    render(<FloatingPanel geometry={{ id:"a", x:100, y:100, w:300, h:200, collapsed:false, z:1 }}
      title="Rep" onGeometryChange={onChange} onFocus={vi.fn()} viewport={vp}><div/></FloatingPanel>);
    const header = screen.getByText("Rep");
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 5000 });   // way off-screen
    fireEvent.pointerUp(window);
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.x).toBeLessThanOrEqual(vp.w - 300);                    // clamped
    expect(last.y).toBeLessThanOrEqual(vp.h - 200);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/components/FloatingPanel.test.tsx`. Expect module-not-found.

- [ ] **Step 3: Implement.** The clamp + snap cores (locked):
```typescript
export function clampToViewport(g: PanelGeometry, vp: { w: number; h: number }): PanelGeometry {
  const w = Math.min(g.w, vp.w);
  const h = Math.min(g.h, vp.h);
  const x = Math.max(0, Math.min(g.x, vp.w - w));
  const y = Math.max(0, Math.min(g.y, vp.h - h));
  return { ...g, x, y, w, h };
}
export function snapToEdges(g: PanelGeometry, vp: { w: number; h: number }, threshold = 12): PanelGeometry {
  let { x, y } = g;
  if (x <= threshold) x = 0;
  else if (vp.w - (x + g.w) <= threshold) x = vp.w - g.w;
  if (y <= threshold) y = 0;
  else if (vp.h - (y + g.h) <= threshold) y = vp.h - g.h;
  return clampToViewport({ ...g, x, y }, vp);
}
```
The component tracks a drag/resize offset with pointer capture; on `pointerdown` in the header it calls `onFocus(id)` and begins a drag; on `pointermove` it updates a transient position; on `pointerup` it computes `snapToEdges(clampToViewport(next))` and calls `onGeometryChange`. Corner handle drives resize. Collapse toggle flips `collapsed` and re-commits.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/components/FloatingPanel.test.tsx` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T12: FloatingPanel (drag/resize/collapse/snap/viewport-clamp)"`.

---

### Task 13: usePanels manager + layout persistence
**Files:** Create `src/components/usePanels.ts`; Modify `src-tauri/src/lib.rs` (`layout_get`/`layout_set` commands + `model.rs` `PanelLayout`); Test `src/components/usePanels.test.ts` + a small `store/crud.rs` test for layout round-trip via settings.
**Interfaces:** Consumes T12 `PanelGeometry`. Produces the commands `layout_get() -> Option<PanelLayout>` and `layout_set(layout: PanelLayout) -> ()` (stored as JSON under `setting` key `panel_layout`), and the hook:
```typescript
export interface UsePanels {
  panels: Record<string, PanelGeometry>;
  register: (id: string, defaults: Omit<PanelGeometry, "id">) => void;
  update: (g: PanelGeometry) => void;   // debounced persist via layout_set
  raise: (id: string) => void;          // bump z above all others
  resetLayout: () => void;              // clear persisted, restore defaults
  viewport: { w: number; h: number };
}
export function usePanels(): UsePanels;
```

- [ ] **Step 1: Write the failing test.** `usePanels.test.ts` mocks `invoke`; assert `register` seeds geometry, `raise` bumps `z` highest, `update` persists via `layout_set`, and mounting hydrates from `layout_get`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { usePanels } from "./usePanels";

describe("usePanels", () => {
  beforeEach(() => invokeMock.mockReset());
  it("hydrates from layout_get then persists updates via layout_set", async () => {
    invokeMock.mockResolvedValueOnce({ panels: [{ id: "rep", x: 10, y: 10, w: 300, h: 200, collapsed: false, z: 1 }] });
    const { result } = renderHook(() => usePanels());
    await waitFor(() => expect(result.current.panels.rep?.x).toBe(10));
    act(() => result.current.update({ id: "rep", x: 40, y: 10, w: 300, h: 200, collapsed: false, z: 1 }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("layout_set", expect.anything()));
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/components/usePanels.test.ts` and `cargo test store::crud::layout`. Expect: hook + commands missing.

- [ ] **Step 3: Implement.** `model.rs`: `PanelLayout { panels: Vec<PanelGeometry> }` with `PanelGeometry { id, x, y, w, h, collapsed, z }`. Commands serialize/deserialize JSON through `store.get_setting("panel_layout")` / `set_setting`. Hook keeps a `Record<string, PanelGeometry>`, hydrates on mount, debounces `update` persistence (~250 ms), `raise` sets `z = max(z)+1`, `resetLayout` clears the setting and re-seeds registered defaults, and reports `viewport` from `window.innerWidth/Height` (with a resize listener).

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/components/usePanels.test.ts` and `cargo test store::crud::layout` then `npm test` + `cargo test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T13: usePanels manager + layout_get/layout_set persistence"`.

---

### Task 14: Host RepHud + SessionBar in floating panels
**Files:** Modify `src/components/Shell.tsx`; Test `src/components/Shell.test.tsx` (or extend existing) — panel hosting + reset-layout + main-content-not-blocked assertions.
**Interfaces:** Consumes T12 `FloatingPanel`, T13 `usePanels`. Produces a Shell that renders `RepHud` and `SessionBar`/event feed each inside a `FloatingPanel`, registers both with `usePanels`, adds a "reset layout" control, and keeps `<main>` full-width and interactive underneath (panels are `position: fixed`, never a layout sibling that reflows content).

- [ ] **Step 1: Write the failing test.** Render `Shell` (mock `invoke`/`listen` as in existing hook tests) with an active rep snapshot; assert the RepHud appears inside a panel with a drag header, the main practice panel is still in the document, and clicking "reset layout" calls `resetLayout` (spy via mocked `layout_set` clear or a data hook). Behavioral assertions:
```tsx
it("hosts the rep HUD in a floating panel without removing main content", async () => {
  // …mount Shell with a snapshot emitted on rep://state…
  await waitFor(() => expect(screen.getByTestId("panel-rep")).toBeTruthy());
  expect(screen.getByTestId("main-practice")).toBeTruthy();     // still present/unblocked
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/components/Shell.test.tsx`. Expect: no `panel-rep` testid.

- [ ] **Step 3: Implement.** Wrap `RepHud` and `SessionBar` in `FloatingPanel`s driven by `usePanels`; give `<main>` a `data-testid="main-practice"` and the panels `data-testid="panel-rep"`/`"panel-session"`; add a reset-layout button (topbar or a settings popover) calling `resetLayout()`. Panels default to bottom-right/bottom-left; `position: fixed` so `<main>` never reflows.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/components/Shell.test.tsx` then `npm test`. Add a screenshot note: capture the running app with both panels moved off the block form for `docs/qa/` (done in T21).

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T14: host RepHud + SessionBar in floating panels; reset-layout; main unblocked"`.

---

### Task 15: Region-grouped HistoryPanel
**Files:** Create `src/features/pieces/HistoryPanel.tsx`; Modify `src/features/pieces/PieceDetail.tsx` (swap the flat list for HistoryPanel); Test `src/features/pieces/HistoryPanel.test.tsx`.
**Interfaces:** Consumes `region_list`, `rep_blocks_for_piece`, `progress_summary` (T3/T9) + `BlockRow` (T11). Produces `HistoryPanel({ pieceId })` that renders collapsible Region groups (`▸ mm. 544–570 · "legato section" — 6 blocks · best ♩40 · last: today`), each expanding to its `BlockRow`s, each expanding to reps. Blocks with `region_id == null` fall into an "Ungrouped" group.

- [ ] **Step 1: Write the failing test.** Grouping logic (`groupBlocksByRegion(blocks, regions)` pure helper) + a render test:
```tsx
it("groups blocks under their region and shows a summary line", async () => {
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "region_list") return Promise.resolve([{ id: 1, piece_id: 1, name: "legato section", m_start: 544, m_end: 570, kind: "section", order: 0, color: null, pdf_anchor: null }]);
    if (cmd === "rep_blocks_for_piece") return Promise.resolve([{ block_id: 9, region_id: 1, m_start: 544, m_end: 552, /* … */ }]);
    if (cmd === "progress_summary") return Promise.resolve({ per_region_mastery: [{ region_id: 1, name: "legato section", blocks: 1, reps: 6, clean_ratio: 0.5, best_bpm: 40, last_practiced: "today" }] /* … */ });
    return Promise.resolve(null);
  });
  render(<HistoryPanel pieceId={1} />);
  await waitFor(() => expect(screen.getByText(/legato section/)).toBeTruthy());
  expect(screen.getByText(/1 block/)).toBeTruthy();
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/features/pieces/HistoryPanel.test.tsx`. Expect module-not-found.

- [ ] **Step 3: Implement.** Fetch regions + blocks + summary; `groupBlocksByRegion` buckets blocks by `region_id` (null → Ungrouped); render collapsible groups with the summary line from `per_region_mastery`; expand → `BlockRow`s. Replace the flat list in `PieceDetail`.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/features/pieces/HistoryPanel.test.tsx` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T15: region-grouped collapsible HistoryPanel with summaries"`.

---

### Task 16: RegionEditor
**Files:** Create `src/features/pieces/RegionEditor.tsx`; Modify `src/features/pieces/HistoryPanel.tsx` (mount editor controls per group); Test `src/features/pieces/RegionEditor.test.tsx`.
**Interfaces:** Consumes `region_update`/`region_merge`/`region_create`/`region_delete` + `block_update` (region reassign). Produces `RegionEditor` controls: rename (EditableField→`region_update`), recolor (swatch→`region_update`), merge (pick target→`region_merge`), split (choose a measure→`region_create` new + reassign blocks), and per-block "move to region" (`block_update` with `region_id`).

- [ ] **Step 1: Write the failing test.** Assert rename calls `region_update` with `{ id, patch: { name } }`; merge calls `region_merge` with `{ idKeep, idAbsorb }`; reassign calls `block_update` with `{ blockId, patch: { region_id } }`:
```tsx
it("renaming a region calls region_update", async () => {
  invokeMock.mockResolvedValue({ /* Region */ });
  render(<RegionEditor region={{ id: 1, name: "legato", /* … */ }} regions={[]} onChanged={vi.fn()} />);
  fireEvent.doubleClick(screen.getByText("legato"));
  const input = screen.getByLabelText("region name");
  fireEvent.change(input, { target: { value: "bridge" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("region_update", { id: 1, patch: { name: "bridge" } }));
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/features/pieces/RegionEditor.test.tsx`. Expect module-not-found.

- [ ] **Step 3: Implement.** Compose primitives + a small color swatch row + a merge/split menu; wire to `useCrud`. Split creates a second region for the measures above the split point and reassigns the blocks whose `m_start >=` split.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/features/pieces/RegionEditor.test.tsx` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T16: RegionEditor (rename/merge/split/recolor/reassign)"`.

---

### Task 17: History filter / search / sort
**Files:** Modify `src/features/pieces/HistoryPanel.tsx` (controls + derived list); Test `src/features/pieces/HistoryPanel.test.tsx` (extend).
**Interfaces:** Consumes T15 data. Produces a `filterSortHistory(groups, { query, sort })` pure helper and UI controls: text filter over region name + block label + measure token; sort by `recent` (last-practiced desc), `by-measure` (m_start asc), `most-practiced` (reps desc). Empty query = all; sort default `recent`.

- [ ] **Step 1: Write the failing test.** Unit-test `filterSortHistory`:
```tsx
it("filters by measure token and sorts by measure", () => {
  const groups = [/* region A mm.1-8, region B mm.544-552 */];
  const out = filterSortHistory(groups, { query: "544", sort: "by-measure" });
  expect(out.map(g => g.region.name)).toEqual(["B (mm.544-552)"]);
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/features/pieces/HistoryPanel.test.tsx -t filter`. Expect: helper missing.

- [ ] **Step 3: Implement.** Add the search box + sort selector to `HistoryPanel`, feed groups through `filterSortHistory`, render the result.

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/features/pieces/HistoryPanel.test.tsx` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T17: history filter/search/sort"`.

---

### Task 18: Tempo ladder decoupled from metronome (Rust)
**Files:** Modify `src-tauri/src/rep/mod.rs` (`check`/`open` ladder-advance path, L173+); Test `src-tauri/src/rep/mod.rs` tests.
**Interfaces:** Consumes T1 (`focus`/`use_metronome`), T2 (`TEMPO_CHANGE` event). Produces: `check` advances the tempo ladder and appends a `tempo_change` event whenever the ladder step is reached, regardless of whether the metronome is running; the metronome is retuned only when `use_metronome` is true. A `focus != "tempo"` block carries no ladder — its reps count verdicts only and never advance BPM or emit `tempo_change`.

- [ ] **Step 1: Write the failing test.** Two tests: (a) a `focus=tempo`, `use_metronome=false` block still advances BPM + logs `tempo_change` on the clean-gated step; (b) a `focus=notes` block never changes `bpm` across reps:
```rust
#[test]
fn ladder_advances_with_metronome_off() {
    let (engine, _emit) = engine_with_capture();
    let args = open_args_tempo(/*use_metronome*/false, /*clean_needed*/2, /*step*/4.0, /*start*/40.0);
    let snap = engine.open(args).unwrap();
    engine.check(RepVerdict::Clean, None).unwrap();
    let out = engine.check(RepVerdict::Clean, None).unwrap();   // hits the step
    assert_eq!(out.snapshot.bpm, 44.0);                          // advanced
    let evs = engine.store.events_for_piece(snap.piece_id).unwrap();
    assert!(evs.iter().any(|e| e.kind == "tempo_change"));
}

#[test]
fn non_tempo_block_never_advances_bpm() {
    let (engine, _emit) = engine_with_capture();
    let snap = engine.open(open_args_focus("notes")).unwrap();
    let out = engine.check(RepVerdict::Clean, None).unwrap();
    assert_eq!(out.snapshot.bpm, snap.bpm);                      // unchanged
}
```

- [ ] **Step 2: Run it, verify it fails.** `cargo test rep::ladder rep::non_tempo`. Expect failure: current `check` couples the BPM step to a metronome retune and has no `focus` gate.

- [ ] **Step 3: Implement.** In `check`, compute ladder advance from verdicts as today, but gate the whole advance on `snap.focus == "tempo"`; when advancing, always update `snap.bpm` and `append_event(EventKind::TEMPO_CHANGE, …)`, and retune the metronome only if `snap.use_metronome`. `RepSnapshot` gains `focus: String` and `use_metronome: bool` (populated from the block row in `open`); `RepOpenArgs` gains matching optional fields (defaulting `focus="tempo"`, `use_metronome=true`) so the block form can pass them.

- [ ] **Step 4: Run tests, verify pass.** `cargo test rep::` then `cargo test`. Expect green.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T18: decouple tempo ladder from metronome; honor focus/use_metronome"`.

---

### Task 19: Block focus selector + metronome toggle + optional BPM (frontend)
**Files:** Modify `src/features/rep/BlockForm.tsx`, `src/features/rep/useRep.ts` / `types.ts` (`RepOpenArgs` gains `focus`/`use_metronome`), `src/features/pieces/BlockRow.tsx` (focus + metronome toggle on the block); Test `src/features/rep/BlockForm.test.tsx`.
**Interfaces:** Consumes T18 (`RepOpenArgs.focus`/`use_metronome`). Produces a focus selector (`tempo|notes|phrasing|dynamics|memory|hands|other`), a metronome on/off toggle, and BPM fields that become optional/hidden when `focus != tempo`. When focus is non-tempo, `open` is called with `start_bpm: null` and no ladder.

- [ ] **Step 1: Write the failing test.** `BlockForm.test.tsx`:
```tsx
it("hides BPM and sends null start_bpm for a non-tempo focus", async () => {
  const onOpen = vi.fn();
  render(<BlockForm pieceId={1} onOpen={onOpen} />);
  fireEvent.change(screen.getByLabelText("focus"), { target: { value: "notes" } });
  expect(screen.queryByLabelText("start bpm")).toBeNull();
  fireEvent.change(screen.getByLabelText("start measure"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("end measure"), { target: { value: "8" } });
  fireEvent.click(screen.getByText(/open block/i));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ focus: "notes", start_bpm: null }));
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/features/rep/BlockForm.test.tsx`. Expect: no focus control.

- [ ] **Step 3: Implement.** Add the focus `<select>` (aria-label "focus"), the metronome toggle, and conditional BPM fields; extend `RepOpenArgs` in `types.ts` with `focus: string; use_metronome: boolean`; assemble `open` args accordingly. Surface the same focus + metronome-toggle affordance on `BlockRow` for an already-open/logged block (via `block_update`).

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/features/rep/BlockForm.test.tsx` then `npm test`.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "T19: block focus selector + metronome toggle + optional BPM"`.

---

### Task 20: Design polish + design review
**Files:** Modify CSS/layout across `src/features/*` and `src/components/*` as the review requires; no schema/command changes.
**Interfaces:** No new interfaces — a polish + review pass gated by acceptance criteria, not code.

This task is a design pass, not a coded deliverable. Run `/frontend-design` then `/design-review` against the running app. **Acceptance criteria (all must hold):**
- [ ] **Calm default.** The piece view leads with *where you are* (editable current-state) and *what's next*, not a wall of forms; the block-create form is not the visually dominant element.
- [ ] **One editable affordance.** Every editable value (labels, measures, BPM, reps, verdicts, notes, goals, current-state, region names) uses the *same* hover/edit cue; nothing that looks editable is inert, and nothing inert looks editable.
- [ ] **One destroy affordance.** Every delete goes through the same `ConfirmDelete` popover copy pattern ("Delete this X and its N children?").
- [ ] **Drill-in tree reads cleanly.** Region → block → rep nesting has consistent indentation, collapse chevrons, and summary lines; a long history is scannable, not a wall.
- [ ] **Panels never block.** With RepHud + SessionBar panels at defaults, the block form and history are fully visible and interactive; a "reset layout" restores defaults.
- [ ] **Dark/light parity.** Both themes pass the review with no contrast or slop findings.
- [ ] `/design-review` returns no unresolved high/medium findings.
- [ ] **Commit:** `git add -A && git commit -m "T20: design polish + design-review pass"`.

---

### Task 21: Ship gate
**Files:** `docs/qa/` (screenshots), vault living docs, repo `NOTES.md`; tag `v0.3.0`.
**Interfaces:** None — release gate.

- [ ] **Step 1: Full test sweep.** `cd ~/codakiller/src-tauri && cargo test` (all green) and `cd ~/codakiller && npm test` (all green). Capture output as evidence.
- [ ] **Step 2: Code review.** Run `/code-review` over the full `foundation` diff; resolve all high/medium findings (fresh-context `verifier` gate on any non-trivial fix).
- [ ] **Step 3: Screenshots.** Run the app (`npm run tauri dev`), capture to `docs/qa/`: (a) region-grouped history expanded to reps, (b) a block mid-edit (inline field open), (c) RepHud + SessionBar panels moved clear of the block form, (d) a tempo-off / non-tempo-focus block. These are the §10 visual-verification records.
- [ ] **Step 4: Vault UPDATE PROTOCOL (binding).** In `~/Desktop/christian's universe/Piano Practice/CodaKiller/`: log the change in `(C) Changelog.md`; refresh `CodaKiller.md` (+ `Last updated:`); update `(C) Roadmap.md` (Foundation → shipped, P4 next), `(C) Flaws.md` (move "history not editable / panels block / flat history / tempo welded to metro" to Resolved; add any new known gaps), `(C) CodaKiller Command Center.md` status/threads, and `(C) How To Use.md` (editability + panels + tempo decoupling are user-facing → bump `Matches: v0.3.0`). Update repo `NOTES.md` with the schema-v3 rebuild gotcha (FK-off during `rep_block` rebuild), the `Option<Option<T>>` patch convention, and the `focused_seconds` idle-threshold decision.
- [ ] **Step 5: Commit + tag.** `git add -A && git commit -m "T21: Foundation ship — docs, QA screenshots, review"` then `git tag v0.3.0`.

---

## Notes for implementers
- **Tauri arg casing:** JS calls pass camelCase keys (`blockId`, `pieceId`) that serde maps to snake_case Rust params; nested structs (`patch`, `args`) deserialize by their own field names. Match the existing `invoke("rep_open", { args })` pattern.
- **Nullable patch fields** use `Option<Option<T>>`: field absent → leave unchanged; `Some(None)` → set NULL; `Some(Some(v))` → set `v`. On the JS side, omit the key to leave unchanged and send `null` to clear.
- **`Store` is a single `Mutex<Connection>`** — all CRUD serializes through it; keep multi-statement mutations inside one `conn.transaction()`.
- **Event, not session_event:** the new durable `event` table is the canonical log (nullable `session_id`/`piece_id`); the pre-existing `session_event` table keeps driving the live session feed. Do not conflate them.
- Every mutation command re-emits the relevant observable (`rep://state` via `resync_active_if`, `session://event` where the session feed is affected) so the UI updates live without a refetch.
- **Shared readers & test helpers.** `block_row(block_id) -> BlockHistory`, `reps_for_block(block_id) -> Vec<Rep>`, `block_set_region(block_id, region_id)`, and the test seeds `seed_piece`/`seed_block`/`seed_rep` are shared store/test utilities used across tasks (e.g. T3's merge test and T4 both call `block_row`; T8 calls `reps_for_block`). Whichever task lands first introduces them — put the readers in `store/mod.rs` and the seeds in a `#[cfg(test)]` support module — and later tasks reuse them. If the Rust CRUD tasks (T2–T9) are executed as one batch, introduce all four readers up front.
- **File-ownership / conflict avoidance.** `store/model.rs`, `store/crud.rs`, and `lib.rs` are touched by nearly every Rust task (T2–T9, T13, T18). Do NOT run those tasks in parallel worktrees — serialize the Rust stream. The frontend primitives/panels (T10, T12) touch disjoint files and CAN run in parallel with the Rust stream; frontend wiring (T11, T14–T17, T19) must wait for the Rust commands it calls to exist.
