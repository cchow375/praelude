# CodaKiller Rust Backend Performance Audit (read-only)

Scope: `/Users/c3/codakiller/src-tauri/src/` (~49.8k lines, ~581 lib tests, rusqlite +
Tauri v2). Covers LEDGER items 40 (N+1, Rust half), 43 (Rust half — leaks), 44
(redundant computation). No code was changed. Every finding below was independently
traced end-to-end (file:line, verbatim code, caller chain, realistic call frequency)
by the auditor after an initial three-way reconnaissance sweep; candidates that didn't
survive tracing are listed as ruled out, not omitted.

Honesty-bar note: this repo's own history says a prior 14-finding audit verified down
to ONE real bug. This audit found **2 real N+1 findings, 0 memory leaks, 0 redundant-
computation findings** meeting the "actual call frequency" bar. Both N+1 findings are
genuine (traced to real frontend call sites, not synthetic loops), but neither is
catastrophic — see severity notes.

---

## 1. N+1 query patterns — 2 findings

### Finding N1 (moderate priority): `calendar.rs::recovery_apply` — up to ~4 per-decision

queries where 1–2 batched queries would do

**File:** `/Users/c3/codakiller/src-tauri/src/store/calendar.rs:447-623`

The function is capped at `decisions.len() > 200` (line 452) → error, so N ≤ 200 per
call. It already batches one thing correctly (total/recovered daily load per date via
one `GROUP BY scheduled_date` query, lines 479-500) — proving the author knows how to
batch — but does NOT apply that pattern to three other lookups:

```rust
// Loop 1, lines 503-519 — one query_row per decision, unconditionally:
let mut current_rows = Vec::with_capacity(decisions.len());
for decision in &decisions {
    ...
    let work = get_view(&tx, decision.id)?;   // line 511
    ...
    current_rows.push(work);
}

// Loop 2, lines 521-598 — for "move" decisions, TWO more per-decision queries:
"move" => {
    ...
    let (goal_deadline, parent_deadline): (Option<String>, Option<String>) = tx
        .query_row(                                   // lines 531-538
            "SELECT g.target_date,parent.target_date
             FROM goal g LEFT JOIN goal parent ON parent.id=g.parent_goal_id
             WHERE g.id=?1", ...)?;
    ...
    let next_order: i64 = tx.query_row(               // lines 558-562
        "SELECT COALESCE(MAX(sort_order)+1,0) FROM daily_work WHERE scheduled_date=?1",
        [date_text], |row| row.get(0))?;
    ...
    result_items.push(get_view(&tx, work.id)?);       // line 569, re-fetch after UPDATE
}
"done" | "dismiss" => {
    ...
    result_items.push(get_view(&tx, work.id)?);       // line 581
}
```

`get_view` (lines 90-124) is a 3-way `JOIN` (`daily_work JOIN goal JOIN piece LEFT
JOIN goal parent`), not a trivial PK lookup, and only supports `WHERE w.id = ?1` — no
`IN (...)` variant exists anywhere in the file.

**Why it's real, not a "6-item loop":** `recovery_apply`'s caller,
`/Users/c3/codakiller/src/features/calendar/RecoveryReview.tsx:49-59`, builds the
`decisions` array from **every item in the recovery preview** (`preview.items.map(...)`)
and sends them all in one call — i.e., N is however many `daily_work` rows lapsed while
the user was away from the app (the whole point of the "recovery" feature). After a
week-plus gap this is realistically dozens of items across several pieces/goals, not 6.

**Cost:** ~1 + up to 4N queries for N decisions (up to ~800 for N=200), each a real
join/aggregate, all inside one transaction (so no per-query fsync — that mitigates the
worst case). Not catastrophic, but a genuine, traceable N+1 with an easy batched fix.

**Before/after sketch:**

```rust
// Before: current_rows built via N sequential get_view(&tx, id) calls.
// After: one batched fetch keyed by id.
let ids: Vec<i64> = decisions.iter().map(|d| d.id).collect();
let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
let mut stmt = tx.prepare(&format!("{VIEW_SELECT} WHERE w.id IN ({placeholders})"))?;
let mut by_id: HashMap<i64, DailyWorkView> = stmt
    .query_map(rusqlite::params_from_iter(ids.iter()), view_from_row)?
    .collect::<rusqlite::Result<Vec<_>>>()?
    .into_iter()
    .map(|v| (v.id, v))
    .collect();
// current_rows.push(by_id.remove(&decision.id)...) instead of get_view per decision.

// Similarly batch goal deadlines once up front:
let goal_ids: HashSet<i64> = current_rows.iter().map(|w| w.goal_id).collect();
// SELECT g.id, g.target_date, parent.target_date FROM goal g
// LEFT JOIN goal parent ON parent.id = g.parent_goal_id WHERE g.id IN (...)
// into a HashMap<i64, (Option<String>, Option<String>)>.

// And next_order per distinct target scheduled_date, one GROUP BY query
// (same shape as the existing total_load/recovery_load prefetch at lines 479-500)
// instead of one query_row per "move" decision.
```

The two `get_view` re-fetches after `UPDATE` (lines 569, 581) can be dropped entirely —
the updated fields are already known locally (new `scheduled_date`, `status`,
`updated_ts` token) and can be spliced into the already-fetched `DailyWorkView` instead
of a second SQL round-trip.

---

### Finding N2 (lower priority, but real and more frequent than it looks):

`tutorials.rs::tutorial_video_scan` — redundant per-file `SELECT` + no transaction
around per-file `INSERT`

**File:** `/Users/c3/codakiller/src-tauri/src/store/tutorials.rs:355-386`, helper at
`63-70` and `75-102`

```rust
pub fn tutorial_video_scan(&self, piece_id: i64) -> rusqlite::Result<Vec<TutorialVideo>> {
    let conn = self.conn.lock()...;
    let tutorials = piece_tutorials_dir(&conn, piece_id)?;   // line 360: query #1 (once, fine)
    ...
    let mut paths = Vec::new();
    collect_video_files(&root, &root, &mut paths)?;
    paths.sort();
    paths.dedup();
    for path in paths {
        let path = validated_video_path(&conn, piece_id, &path)?;  // line 371
        ...
        conn.execute(                                        // line 378-383
            "INSERT INTO tutorial_video (piece_id,title,file_path)
             VALUES (?1,?2,?3) ON CONFLICT(piece_id,file_path) DO NOTHING",
            rusqlite::params![piece_id, normalized_title(title)?, path.to_string_lossy()],
        )?;
    }
    Self::tutorial_video_list_conn(&conn, piece_id)
}
```

`validated_video_path` (line 75) calls `piece_tutorials_dir(conn, piece_id)` again
internally (line 83):

```rust
fn piece_tutorials_dir(conn: &Connection, piece_id: i64) -> rusqlite::Result<PathBuf> {
    let folder: String = conn.query_row(
        "SELECT folder_path FROM piece WHERE id = ?1", [piece_id], |row| row.get(0))?;
    Ok(PathBuf::from(folder).join("tutorials"))
}
```

— so the exact same invariant (`piece_id`'s `folder_path`) is re-queried once per
discovered video file, even though the caller already computed `tutorials` at line 360.
Additionally, none of the loop is wrapped in an explicit `tx = conn.transaction()`, and
`store/mod.rs` sets no `journal_mode`/`synchronous` pragma (only `PRAGMA foreign_keys =
ON` at `store/mod.rs:97`), so this repo runs on SQLite's default rollback-journal +
`synchronous=FULL` — each `conn.execute` INSERT here is its own autocommitted,
fsync-backed transaction. N files → N separate synchronous disk syncs, not one.

**Why it's real, not a "6-item loop":** this isn't a manual "rescan" action, it fires
automatically:
`/Users/c3/codakiller/src/features/tutorials/TutorialPanel.tsx:30-45`:

```tsx
async function load() {
  const found = await invoke<TutorialVideo[]>("tutorial_video_scan", { pieceId });
  ...
}
useEffect(() => { void load(); }, [pieceId]);
```

i.e., every time the Tutorials panel mounts for a piece — every time the user switches
to or opens a piece's Tutorials tab — the backend does a full filesystem walk plus one
redundant `SELECT` and one autocommit `INSERT` per video file already on disk. A
pianist with a real tutorial-video library (tens of clips per piece, accumulated over
months) pays this on every piece switch, not once ever.

**Severity:** genuinely bounded (per-piece video count, not reps/history — realistically
single digits to low hundreds) and each query is a cheap indexed PK lookup, so this is
not the top-priority finding, but it is a real, traced, repeatedly-triggered pattern —
unlike a one-time migration loop.

**Before/after sketch:**

```rust
pub fn tutorial_video_scan(&self, piece_id: i64) -> rusqlite::Result<Vec<TutorialVideo>> {
    let mut conn = self.conn.lock()...;
    let tutorials = piece_tutorials_dir(&conn, piece_id)?;
    if !tutorials.exists() { return Self::tutorial_video_list_conn(&conn, piece_id); }
    let root = fs::canonicalize(&tutorials)...;
    let mut paths = Vec::new();
    collect_video_files(&root, &root, &mut paths)?;
    paths.sort();
    paths.dedup();

    let tx = conn.transaction()?;                 // one commit for the whole scan
    let mut stmt = tx.prepare(
        "INSERT INTO tutorial_video (piece_id,title,file_path)
         VALUES (?1,?2,?3) ON CONFLICT(piece_id,file_path) DO NOTHING")?;
    for path in paths {
        // pass the already-known `root` in instead of re-querying folder_path:
        let path = validated_video_path_with_root(&root, &path)?;
        let title = ...;
        stmt.execute(rusqlite::params![piece_id, normalized_title(title)?, path.to_string_lossy()])?;
    }
    drop(stmt);
    tx.commit()?;
    Self::tutorial_video_list_conn(&conn, piece_id)
}
```

(`validated_video_path_with_root` = the same containment check, minus the DB call,
taking `root: &Path` instead of `conn` + `piece_id`.)

---

### Areas swept — no genuine N+1 found (explicit "checked, clean")

- **`rep/mod.rs` (4279 lines) and `rep/ladder.rs`** — the highest-frequency user action
  in the app (marking a rep) — independently grepped for loop-adjacent
  `conn.execute|query_row|prepare|execute_batch`: only test-only `test_execute_batch`
  hits. Rep persistence goes through `store/practice_v2.rs::v2_record_attempt` and
  `store/practice_loop.rs`, both single-query-per-attempt. **Clean.**
- **`store/practice_v2.rs`** — `for attempt in effective.iter()...` (lines 402, 453) is
  pure in-memory ladder-projection iteration over an already-fetched `Vec`; no DB call
  inside either loop body. **Clean.**
- **`store/practice_loop.rs`** — `for row in rows { actions.push(row?); }` (line 738)
  drains one `query_map` result set (single query total). The one `conn.query_row`
  inside a `for action in &actions` loop (line 764, `"tempo_backoff"` branch) fires at
  most once per manual recovery action in a set's small action list — bounded by
  user-triggered interventions per set, not reps/history. **Not flagged.**
- **`store/score_atlas.rs`** — loops at lines 266, 579 are pure in-memory validation
  (bounds/finite checks), no DB calls inside. **Clean.**
- **`store/day_sheet.rs`, `crud.rs`, `session_plan.rs`, `events.rs`** — all iteration
  hits are single-query result draining, in-memory grouping, or test code. **Clean.**
- **`ledger/mod.rs`, `sessions/mod.rs`, `sessions/export.rs`, `planner/mod.rs`,
  `metrics/mod.rs`, `anomalies.rs`** — zero matches for any SQL call
  (`conn.execute|query_row|stmt.execute|conn.query|prepare(|execute_batch`) in any of
  these files. They consume data the store layer already fetched. **No N+1 risk by
  construction.**
- **One-time/backfill code** (`store/backfill.rs`, `history_backfill.rs`,
  `v8_backfill.rs`) — do contain classic per-row query-in-a-loop patterns (e.g.
  `v8_backfill.rs:131`, `history_backfill.rs:149`), but these are schema-version-gated
  migrations that run once ever, at startup, on a fixed historical dataset. Per the
  task's own exclusion criterion, **not reported as hot-path findings** — noted here
  only for completeness.

---

## 2. Memory leaks / unbounded growth — 0 genuine findings

**No genuine instance found.** Every thread/channel/cache candidate was traced to a
proper join/drop or a naturally bounded key space. Independently verified (not just
taken from reconnaissance) the two highest-risk-looking areas myself:

- **`audio/mod.rs::EngineHandle`** (lines 117-270, 279-350) — one dedicated
  `"codakiller-audio"` OS thread per `Engine::start()` call. `impl Drop for
EngineHandle` (lines 262-270) sets an `AtomicBool` shutdown flag, unparks the thread,
  and **joins it** (`t.join()`) before returning. `metronome.rs`'s engine-restart path
  (`start_engine`, line ~303-324 in metronome.rs) sets `inner.handle = None` before
  assigning a new handle — dropping the old one, which joins its thread — so
  start/stop/restart cycles (which a user can trigger many times per practice session)
  do not accumulate threads. **Clean.**
- **`metronome.rs`** — `std::thread::spawn` appears 4 times (lines 1508, 1521, 1567,
  1584); independently confirmed by reading the surrounding code (context around
  1495-1610) that all four are inside `#[cfg(test)]` functions using `mpsc` channels to
  synchronize test assertions about command ordering, joined via `.join().unwrap()` at
  the end of each test. **No production thread-spawn in this file.**
- **`voice_loop.rs::VoiceLoop`** — one `mpsc::Sender<ActionMessage>` +
  `action_thread: Mutex<Option<JoinHandle<()>>>` for the app's lifetime (constructed
  once in `lib.rs:1547`). `shutdown()` (line 967) drops the sender and joins the
  thread; `impl Drop for VoiceLoop` (line 986) calls `shutdown()`. **Clean.**
- **`stt/supervisor.rs`** — manager thread spawned once per `SttHandle`; per-restart
  reader/stderr threads are `.join()`ed every restart cycle before the loop continues,
  so no thread accumulation across STT restarts. The `restarts: Vec<Instant>` used for
  the restart-storm cap (line 299) is trimmed with `.retain()` on every check (line 431) — bounded by the restart time window, not by app lifetime. Independently
  confirmed both the `retain()` call and its guard condition. **Clean.**
- **`tts/mod.rs::Speaker`** — one worker thread per instance, `shutdown()` drops the
  sender + joins, `Drop` calls `shutdown()`. Job queue is a plain `mpsc::channel`
  drained serially by the worker's `for job in rx.iter()` — fire-and-forget queuing of
  user-triggered spoken lines (not a hot/bursty producer). **Clean.**
- **`brain/corpus.rs::CACHE`** (`static OnceLock<Mutex<HashMap<PathBuf,
Arc<CachedCorpus>>>>`, line 236) — keyed by corpus root directory path. The app has
  exactly one corpus root in practice, so this map holds effectively one live entry for
  the app's lifetime, not unbounded growth. No eviction exists, but none is needed
  given the bounded key space. **Not a leak** (see also positive note under Redundant
  Computation below — this is the file's _correct_ caching pattern).
- **Event listeners**: grepped the whole backend for `.listen(` / `app.listen` /
  `window.listen` — **zero matches**. Backend → frontend communication is one-way via
  `app.emit`, never a registered listener that could leak. **Clean.**
- **`audio/mixer.rs`, `audio/clock.rs`, `rep/mod.rs`, `recovery/mod.rs`,
  `universe.rs`** — no threads, no static/global caches; `Vec` usage is local, per-call
  return data, not accumulating shared state. **Clean.**

No dependency on `tokio` exists in `Cargo.toml`; all async Tauri commands use
`tauri::async_runtime::spawn_blocking` (managed by Tauri's own bounded thread pool,
one task per call, awaited to completion — not a leak surface).

---

## 3. Redundant computation — 0 genuine findings

**No genuine instance found meeting the "actual call frequency" bar.** Details:

- **Regex compiled in loops:** structurally impossible — **the `regex` crate is not a
  dependency at all** (`Cargo.toml` has no `regex` entry; confirmed independently via
  `grep -rn "Regex::new(" src-tauri/src` → 0 matches, and `grep -c regex Cargo.toml` →
  0). The "deterministic hot-loop intent router" (per this repo's CLAUDE.md) does
  manual character/token parsing (`for c in text.chars()`, `.split()`), not regex.
  **No genuine instance — category is structurally empty for this codebase.**
- **Corpus/book parsing (`brain/corpus.rs`):** already correctly cached, not a
  finding — a positive control that shows the team knows this pattern.
  `static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<CachedCorpus>>>>` (line 236);
  `load_cached` (lines 266-283) computes a fingerprint (manifest signature + file
  mtimes) and only rebuilds when it changed, otherwise returns the cached `Arc`.
  Independently confirmed the fingerprint-then-rebuild logic is real (not a no-op
  cache). `brain/library.rs::EmbeddedLibrary` builds its card index once at
  construction from embedded static data, not per-call. **Already mitigated.**
- **MusicXML parsing (`brain/score_context.rs`):** `xml_measure_facts` (line 187) and
  `summarize` (line 233) both re-parse the score file from disk on every call, with no
  cache analogous to `corpus.rs`'s — this is a real _asymmetry_ worth naming, but it
  does not clear the call-frequency bar to count as a finding. Traced both call chains:
  - `summarize` ← `brain/context.rs:127` ← `brain_ask` (`lib.rs:1253`) — fires once per
    assistant question that has a piece in context. Per this repo's own design law
    ("deterministic hot loop... the LLM brain is for open questions only" —
    `CLAUDE.md`), `brain_ask` is explicitly _not_ the hot path; it's occasional
    user-initiated questions, not a poll/render loop.
  - `xml_measure_facts` ← `lib.rs:1292` ← frontend
    `/Users/c3/codakiller/src/features/score/ScoreView.tsx:975-985`, gated by a
    `useEffect` that only fires `if (!wizardOpen) return` — i.e., once per mapping-
    wizard open, a rare/deliberate per-piece setup action, not per-render or per-poll.
    Both are "a few times per session at most," which the task brief explicitly excludes
    ("a once-per-session cost is not a finding"). **Considered and ruled out** — flagged
    here only so it's visible if brain_ask/wizard-open frequency turns out higher than
    traced; if it ever does, the fix is the same pattern already proven in `corpus.rs`
    (cache `parse_measures`'s output keyed by `(canonical_path, mtime)`).
- **Sorting:** checked all 18 `.sort()/.sort_by()/.sort_by_key()` call sites backend-
  wide. Two (`store/mod.rs:1552,1702`) are inside `#[cfg(test)]` code. The rest
  (`brain/corpus.rs:435`, `brain/library.rs:165`, `vault/mod.rs:60,124,148`,
  `settings.rs:362`, `brain/context.rs:351`, `metrics/mod.rs:180`,
  `store/tutorials.rs:368`, `brain/corpus.rs:788`, `recovery/mod.rs:336,420`,
  `planner/mod.rs:92,226`) either (a) sort query-dependent relevance scores computed
  fresh per query (can't be precomputed), or (b) sort small, session-scoped
  collections (piece lists, warnings, tutorial paths) on non-hot handlers
  (per-piece-view loads, not per-poll). **No genuine instance.**
- **Metronome per-tick recomputation:** `metro_state` (`metronome.rs:1014`, plausibly
  polled) is just a `Mutex` lock + `clone()` of the state struct via `snapshot()`
  (lines 243-245) — no parsing, sorting, or extra serialization work. **Clean.**
- **Repeated serialization:** no case found of the same struct being
  `serde_json::to_string`'d multiple times per request, or eager serialization of
  rarely-consumed data, across `store/score_atlas.rs`, `store/crud.rs`,
  `protocol/mod.rs`, `pieces.rs`, `imslp.rs`, `references.rs`. **No genuine instance.**

---

## Summary

| Category                        | Findings | Notes                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N+1 query patterns              | **2**    | N1 `calendar.rs:503-598` (moderate), N2 `tutorials.rs:355-386` (lower priority, more frequent than it looks)                                                                                                                                                                               |
| Memory leaks / unbounded growth | **0**    | Explicitly checked and cleared: audio engine thread (joined on Drop), metronome test-only threads, voice_loop/tts worker threads (joined on shutdown/Drop), stt supervisor restart-cap Vec (retained/bounded), corpus cache (bounded key space), zero event listeners in the backend       |
| Redundant computation           | **0**    | Regex category structurally empty (no regex crate at all); corpus parsing already fingerprint-cached; MusicXML re-parsing in `score_context.rs` traced and ruled out on call-frequency grounds (occasional brain_ask / wizard-open, not a hot path); sorting and serialization swept clean |

**Confidence: high.** Both N1 and N2 were traced from the Rust store layer through to
the exact frontend call site that determines real-world N and call frequency, not
inferred from the loop shape alone. The three empty-category conclusions (leaks, redundant
computation) were cross-checked by independent reads of the highest-risk files (audio
engine, metronome, voice loop, STT supervisor, corpus cache, rep persistence path) after
the initial reconnaissance sweep, rather than accepted on reconnaissance alone.
