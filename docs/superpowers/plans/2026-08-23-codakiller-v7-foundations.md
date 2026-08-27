# CodaKiller v7.0.0 Foundations — B0 Mic-Coexistence Spike + Schema v15

> **Status:** Historical/as built; schema 15 and the bounded v7 foundations shipped in v7.0.0.
> Current installed schema is 19. Real Listen Back/voice microphone acceptance remains a distinct
> v8.1 external gate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two pieces of v7 "Motivation Layer" that every other v7 plan depends on,
before any UI work starts: (1) an answer to whether a `cpal` input stream can share the
default mic with the vendored `hear` STT binary on the 8 GB M2 Air, since Plan B (Dynamics
Checker) cannot be scoped until this is known; and (2) schema v15, which adds the tables Plans
A and B write to and drops the dead `session.focused_seconds` column (B74). This plan touches
**no UI** — it is pure Rust backend + one throwaway diagnostic binary.

**Architecture:**

- B0 is a throwaway `cargo run --example mic_coexist_spike` binary under
  `src-tauri/examples/` — examples/ is never compiled or run by `cargo test`, so it cannot
  regress the suite and needs no cleanup commit later. It opens a `cpal` **input** stream only
  (the existing `audio/mod.rs` **output** Engine is untouched — confirmed no
  `build_input_stream` call exists anywhere in `audio/`); computes 125 ms-window RMS → dBFS;
  prints one line per second for 60 s. The verdict comes from running it _while_ the vendored
  `hear` binary transcribes speech on the same machine, sampling both processes' CPU/RSS with
  a `ps`-based script.
- Schema v15 is one more cascading step in `src-tauri/src/store/migrations.rs`, following the
  exact `if version < N { BEGIN IMMEDIATE; execute_batch; PRAGMA user_version=N; COMMIT }`
  shape every prior step uses (verified template: the v13→v14 step at
  `migrations.rs:1675-1687`, gated on `SCHEMA_V14` at `migrations.rs:974-988`). No new Tauri
  commands are needed — migration runs automatically inside `Store::open`, which every existing
  call site already goes through.

**Tech Stack:** Rust/rusqlite (`bundled` feature, rusqlite 0.40.1) + cargo test · `cpal` 0.18.1
(already a dependency, used today only for output) · vendored `hear` CLI · macOS `ps` for
resource sampling · no new crates.

**Spec path:**
`docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md` (Part 2)

**Global Constraints** (copied verbatim from the spec's Constraints section):

- User-as-sensor. The dynamics checker is the first and only approved mic-judges-loudness
  feature: **loudness only, forever** — no pitch, no onset/note detection, no transcription,
  no correctness grading. If a design detail drifts that way, the detail is wrong and gets cut.
- Deterministic hot loop; the LLM is never in the rep/metronome path. Assistant tools are
  read-only and confirm-gated.
- 8 GB M2 Air (D1): no local ML runtimes. Dynamics DSP is a weighting filter + RMS — no FFT
  pipeline, no models.
- Live DB never opened/migrated from dev code; the v15 migration rehearses on a fresh copy via
  `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib rehearse_migration_on_real_database_copy
-- --ignored`.
- Every voice-router or fast-path change re-passes the narrated-corpus replay (finals AND
  partial-stream suites) with zero false mutations. No bare prefix word ever joins the
  fast-path allowlist.
- All 85+ legacy CSS token names preserved. Paper design language throughout.
- Suggest, never dictate. Earned-only: nothing in the galaxy/streak/photo layer can be granted,
  bought, backfilled, or faked — every visual is a pure function of recorded practice events.

**Additional binding constraints for this plan specifically:**

- This plan must not touch any UI file (no `src/` frontend changes; no `.tsx`/`.css` edits).
- Commit per numbered task.
- `cargo test` and `cargo clippy --all-targets -- -D warnings` green before every commit that
  touches `src-tauri/`.
- Work happens in a worktree at `~/.ck-lanes/v7-foundations` on branch `v7/foundations`, cut
  from `main` (verified current: `main`, remote `origin` =
  `https://github.com/cchow375/codakiller.git`).
- B0's HARD GATE: if the spike shows coexistence fails (device-steal, STT dropout, or CPU/RSS
  that would visibly compete with the audio callback's realtime budget), Plan B's live-meter
  design (B1-B4) halts pending Christian's push-to-measure decision. This plan does not decide
  that trade-off — it only produces the numbers and records the verdict.

---

## Setup: cut the lane

- [ ] `mkdir -p ~/.ck-lanes && cd ~/codakiller && git worktree add ~/.ck-lanes/v7-foundations -b v7/foundations main`
- [ ] `cd ~/.ck-lanes/v7-foundations && cargo build --manifest-path src-tauri/Cargo.toml` once,
      to confirm the worktree builds clean before any edits (baseline).

All paths below are relative to `~/.ck-lanes/v7-foundations` unless stated otherwise.

---

### Task 1: B0 — mic-coexistence spike (throwaway diagnostic)

**Files:**

- Create: `src-tauri/examples/mic_coexist_spike.rs` (throwaway; `examples/` is excluded from
  `cargo test` by cargo's default target discovery — confirmed no `[[example]]` or `[[bin]]`
  entries currently exist in `src-tauri/Cargo.toml`, so this is a plain auto-discovered
  example, no manifest edit needed)
- Create: `.workflow/scratch/sample-spike-resources.sh` (CPU/RSS sampler, throwaway)
- Create: `.workflow/scratch/b0-spike-verdict.md` (deliverable — verdict + numbers, filled in
  after the procedure runs)
- Modify: `NOTES.md` (append a dated entry with the empirical fact once the procedure runs)

**Interfaces:**

- Produces: `cargo run --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml` — a
  standalone process, no Tauri app context, no dependency on `resolve_hear_bin` (which needs
  `tauri::App` and isn't reachable from `examples/`). It mirrors the non-bundled fallback path
  `resolve_hear_bin` itself falls back to at `src-tauri/src/lib.rs:328-336`
  (`CARGO_MANIFEST_DIR/../vendor/bin/hear`) only as documentation in a comment — the spike
  itself never touches STT; the human runs the real vendored `hear` binary in a second
  terminal per the procedure below, so the spike stays a pure `cpal`-only program with zero
  dependency on `codakiller_lib`.
- Consumes: `cpal::traits::{HostTrait, DeviceTrait, StreamTrait}`, `cpal::default_host()`,
  `default_input_device()`. Never touches `audio::mod::Engine` or any output stream code.

This is a feasibility spike, not a unit-testable code path — there is no red/green cycle for
"does the OS let two processes read one mic." The checkbox sequence below is the equivalent
rigor: a concrete, runnable program with an expected-output contract, exercised by a written
procedure, with the exact numbers recorded as the deliverable.

- [ ] Write `src-tauri/examples/mic_coexist_spike.rs`:

```rust
//! THROWAWAY spike for v7 B0 (see docs/superpowers/plans/2026-08-23-codakiller-v7-foundations.md).
//! Answers: can a cpal INPUT stream coexist with the vendored `hear` STT binary on the same
//! default mic, on the 8 GB M2 Air, for 60s, without device-steal or a CPU/RSS spike that
//! would compete with the realtime audio output callback?
//!
//! This program NEVER touches src-tauri/src/audio/mod.rs's output Engine. It opens the
//! default INPUT device only, computes 125ms-window RMS -> dBFS, and prints one line per
//! second for 60 seconds, then exits. Run it CONCURRENTLY with the vendored `hear` binary
//! transcribing speech on the same mic (see the plan's procedure step) — this file only
//! produces the meter side of the experiment.
//!
//! `cargo run --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml`

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const RUN_SECS: u64 = 60;
const WINDOW_MS: u64 = 125;

fn main() {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .expect("no default input device found — grant mic permission and retry");
    println!(
        "spike: using input device {:?}",
        device.name().unwrap_or_else(|_| "<unknown>".to_string())
    );

    let config = device
        .default_input_config()
        .expect("no default input config on this device");
    let sample_rate = config.sample_rate().0 as usize;
    let channels = config.channels() as usize;
    let window_frames = (sample_rate * WINDOW_MS as usize) / 1000;

    // dBFS of the most recently completed 125ms window, shared with the print loop below.
    // Stored as millidecibels (i64) so an AtomicI64 can hold it lock-free from the audio
    // callback — the callback must never block.
    let latest_millidb = Arc::new(AtomicI64::new(-9000)); // -90.0 dBFS floor
    let latest_millidb_cb = Arc::clone(&latest_millidb);

    let mut window_buf: Vec<f32> = Vec::with_capacity(window_frames);

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                for frame in data.chunks(channels.max(1)) {
                    // Mono-fold by averaging channels in the frame — loudness only, no
                    // spatial info needed for a coexistence spike.
                    let sample: f32 =
                        frame.iter().copied().sum::<f32>() / (frame.len().max(1) as f32);
                    window_buf.push(sample);
                    if window_buf.len() >= window_frames {
                        let sum_sq: f32 = window_buf.iter().map(|s| s * s).sum();
                        let rms = (sum_sq / window_buf.len() as f32).sqrt();
                        let dbfs = if rms > 0.0 {
                            20.0 * rms.log10()
                        } else {
                            -90.0
                        };
                        latest_millidb_cb.store((dbfs * 1000.0) as i64, Ordering::Relaxed);
                        window_buf.clear();
                    }
                }
            },
            move |err| eprintln!("spike: input stream error: {err}"),
            None,
        )
        .expect("failed to build input stream — this itself is a coexistence-failure signal");

    stream.play().expect("failed to start input stream");
    println!(
        "spike: streaming for {RUN_SECS}s, one dBFS line per second. Start the vendored \
         `hear` binary transcribing speech NOW in another terminal per the plan's procedure."
    );

    let start = Instant::now();
    let mut last_print = Instant::now() - Duration::from_secs(1);
    while start.elapsed() < Duration::from_secs(RUN_SECS) {
        if last_print.elapsed() >= Duration::from_secs(1) {
            let dbfs = latest_millidb.load(Ordering::Relaxed) as f64 / 1000.0;
            println!("t={:>3.0}s  input_dbfs={:>7.2}", start.elapsed().as_secs_f64(), dbfs);
            last_print = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    println!("spike: done ({RUN_SECS}s elapsed). Stop `hear` now and record the verdict.");
}
```

- [ ] `cargo build --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml` — must
      compile clean. Expected failure mode if it doesn't: a `cpal` API mismatch against 0.18.1
      (check `build_input_stream` signature — the last-arg `None` is the
      `timeout: Option<Duration>` param cpal 0.18 added; drop it if the vendored version
      differs).
- [ ] Write `.workflow/scratch/sample-spike-resources.sh`:

```bash
#!/usr/bin/env bash
# Samples %CPU and RSS (KB) once per second for a given PID, for a given duration.
# Usage: sample-spike-resources.sh <pid> <label> <duration_secs> <out_file>
set -euo pipefail
pid="$1"
label="$2"
duration="$3"
out="$4"

echo "ts_s,label,pid,cpu_pct,rss_kb" > "$out"
for ((i=0; i<duration; i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "sample-spike-resources: pid $pid ($label) exited early at t=${i}s" >&2
    break
  fi
  line=$(ps -o %cpu=,rss= -p "$pid" | tr -s ' ')
  cpu=$(echo "$line" | awk '{print $1}')
  rss=$(echo "$line" | awk '{print $2}')
  echo "${i},${label},${pid},${cpu},${rss}" >> "$out"
  sleep 1
done
echo "sample-spike-resources: wrote $out"
```

- [ ] `chmod +x .workflow/scratch/sample-spike-resources.sh`
- [ ] **Procedure (manual, at the piano/mic setup, on the 8 GB M2 Air):** 1. Terminal A: `cargo run --release --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml & echo "spike pid: $!"` — note the PID. 2. Terminal B (immediately): `.workflow/scratch/sample-spike-resources.sh <spike_pid> spike 60 .workflow/scratch/b0-spike-cpu.csv` 3. Terminal C (immediately after starting A): run the vendored `hear` binary directly
      (same invocation `stt/supervisor.rs`'s `SttConfig::hear` uses — the binary is at the
      repo root `vendor/bin/hear`, confirmed present, 170 KB executable; e.g.
      `~/codakiller/vendor/bin/hear -m txt -d` style flags per the supervisor's config)
      and speak continuously for 60s (read a page of a book aloud). Note its PID. 4. Terminal D: `.workflow/scratch/sample-spike-resources.sh <hear_pid> hear 60 .workflow/scratch/b0-hear-cpu.csv` 5. Watch Terminal A's dBFS output — it must move with the speech (proves the input
      stream is live, not stuck at the floor) for the full 60s. 6. Watch Terminal C's transcription output — it must keep producing text throughout
      (proves `hear` was not starved of the mic by the spike opening it too). 7. Confirm no macOS "microphone in use by another app" dialog or silent device-steal
      (one process's stream unexpectedly stops producing data while the other runs).
- [ ] Write `.workflow/scratch/b0-spike-verdict.md` with the actual numbers observed
      (max/avg %CPU and RSS for each process from the two CSVs, whether both streams stayed
      live for the full 60s, and one of two explicit verdicts): - **PASS — coexistence confirmed.** Both `cpal` input and `hear` STT ran concurrently
      for 60s with live output from both and no device-steal. Plan B's live-meter design
      (B1 streams input alongside STT) proceeds as scoped. - **FAIL — coexistence does not hold.** [describe exact failure mode: device-steal /
      STT dropout / CPU headroom too tight]. Plan B's B1 must switch to push-to-measure
      (dynamics capture pauses STT via the existing `SttHandle::set_gate` half-duplex gate
      at `stt/mod.rs:7-10`) — flagged for Christian's decision before Plan B implementation
      starts.
- [ ] Append a dated entry to `NOTES.md` recording the empirical fact (pass or fail, with the
      headline numbers) — this is the kind of hard-won empirical fact the file exists for.
- [ ] Commit: `chore(v7-foundations): B0 mic-coexistence spike — verdict recorded`
      (commit includes the throwaway example, the sampler script, and the verdict + NOTES.md
      entry — nothing here ships to the app; `examples/` never builds into the app bundle).

---

### Task 2: Schema v15 — drop `session.focused_seconds`, add `day_photo`

**Files:**

- Modify: `src-tauri/src/store/migrations.rs`

**Interfaces:**

- Produces: `SCHEMA_VERSION` bumped `14 -> 15`; a new `if version < 15 { .. }` cascading step
  in `migrate()`, following the exact shape of the `if version < 14` step at
  `migrations.rs:1675-1687`.
- Two pre-flight guards run inside the v15 step, before the transaction, so a violated
  invariant fails loudly (panic, since this is a startup-time migration guard, not a
  recoverable-at-runtime condition — matches the "fail closed on an irreversible schema
  change" posture the rest of the file takes with its `.expect()`-heavy test helpers):
  `assert_sqlite_version_supports_drop_column(conn)` (bundled rusqlite 0.40.1 ships SQLite
  well past 3.35, confirmed via `rusqlite = { version = "0.40.1", features = ["bundled"] }` in
  `Cargo.toml:24` — but the assert stays as a real runtime check, not just a comment, in case a
  future dependency bump ever un-bundles it) and
  `assert_no_references_to_session_focused_seconds(conn)` (verified today: grepping the whole
  `src-tauri/src` tree for `focused_seconds` shows the DB column, added at `migrations.rs:201`
  by the v2→v3 step, is never read except by that step's own test at `migrations.rs:3160`;
  every runtime consumer — `store/history_days.rs`, `store/calendar.rs`, `metrics/mod.rs`,
  `store/model.rs:994` — computes it fresh from events via `metrics::focused_seconds`, never
  from the column. No index/view/trigger references it today, so this guard is expected to be
  a no-op, but it runs against the real `sqlite_master` at migration time rather than trusting
  that fact statically).

- [ ] Failing test — add to the `#[cfg(test)] mod tests` block in `migrations.rs`, immediately
      after `migrate_is_idempotent_at_v14` (so it sits next to the v14 tests it extends):

```rust
    /// Build a v14 database by chaining every prior step manually (mirrors seed_v13's own
    /// pattern), so v15's step can be exercised in isolation.
    fn seed_v14() -> Connection {
        let c = seed_v13();
        c.execute_batch("BEGIN IMMEDIATE;").unwrap();
        c.execute_batch(SCHEMA_V14).unwrap();
        c.execute_batch("PRAGMA user_version = 14; COMMIT;")
            .unwrap();
        c
    }

    /// v14 -> v15 drops session.focused_seconds (B74: never written, always computed fresh
    /// from events by metrics::focused_seconds) and adds the three v7 motivation-layer
    /// tables. Nothing else changes.
    #[test]
    fn migrate_v14_to_v15_drops_focused_seconds_and_adds_motivation_tables() {
        let c = seed_v14();
        c.execute(
            "INSERT INTO session (id, started_at, ended_at, summary_md, focused_seconds)
             VALUES (1, '2026-08-01T10:00:00Z', '2026-08-01T10:30:00Z', 'warmup', 900)",
            [],
        )
        .unwrap();
        let sessions_before = c
            .query_row("SELECT count(*) FROM session", [], |row| row.get::<_, i64>(0))
            .unwrap();

        migrate(&c).unwrap();

        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert_eq!(SCHEMA_VERSION, 15);

        // session row survives; only the column is gone.
        assert_eq!(
            c.query_row("SELECT count(*) FROM session", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            sessions_before,
            "dropping the column must not touch existing rows"
        );
        let mut stmt = c.prepare("SELECT name FROM pragma_table_info('session')").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            !cols.contains(&"focused_seconds".to_string()),
            "session.focused_seconds must be dropped by v15, found columns: {cols:?}"
        );

        // day_photo exists and enforces its day-key CHECK.
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='day_photo'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        c.execute(
            "INSERT INTO day_photo (day, rel_path, content_hash, created_at)
             VALUES ('2026-08-23', 'day-photos/2026-08-23.jpg', 'abc123', '2026-08-23T10:00:00Z')",
            [],
        )
        .unwrap();
        assert!(c
            .execute(
                "INSERT INTO day_photo (day, rel_path, content_hash, created_at)
                 VALUES ('not-a-day', 'x', 'y', 'z')",
                [],
            )
            .is_err());

        // dynamics_profile + dynamics_calibration_point exist with their CHECKs.
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name IN ('dynamics_profile','dynamics_calibration_point')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            2
        );
        c.execute(
            "INSERT INTO dynamics_profile (id, device_id, label, active, created_at)
             VALUES (1, 'steinway-living-room', 'Steinway, living room, lid half', 1, '2026-08-23T10:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO dynamics_calibration_point (profile_id, ordinal, dynamic_label, measured_db)
             VALUES (1, 0, 'pp', -42.0)",
            [],
        )
        .unwrap();
        assert!(c
            .execute(
                "INSERT INTO dynamics_calibration_point (profile_id, ordinal, dynamic_label, measured_db)
                 VALUES (1, 1, 'mezzo', -30.0)",
                [],
            )
            .is_err());

        // one-active enforcement: a second active profile is rejected.
        assert!(c
            .execute(
                "INSERT INTO dynamics_profile (id, device_id, label, active, created_at)
                 VALUES (2, 'steinway-studio', 'Steinway, studio', 1, '2026-08-23T10:05:00Z')",
                [],
            )
            .is_err());
        // a second INACTIVE profile is fine.
        c.execute(
            "INSERT INTO dynamics_profile (id, device_id, label, active, created_at)
             VALUES (3, 'steinway-studio', 'Steinway, studio', 0, '2026-08-23T10:05:00Z')",
            [],
        )
        .unwrap();
    }

    /// A second migrate() call at v15 changes nothing.
    #[test]
    fn migrate_is_idempotent_at_v15() {
        let c = seed_v14();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    /// A fresh (user_version 0) database migrates straight to v15 with the same guarantees.
    #[test]
    fn fresh_database_migrates_to_v15() {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
                .unwrap(),
            15
        );
        let mut stmt = c.prepare("SELECT name FROM pragma_table_info('session')").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(!cols.contains(&"focused_seconds".to_string()));
        for table in ["day_photo", "dynamics_profile", "dynamics_calibration_point"] {
            assert_eq!(
                c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name=?1",
                    [table],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
                1,
                "{table} must exist on a fresh v15 database"
            );
        }
    }
```

- [ ] Run to see it fail:
      `cargo test --manifest-path src-tauri/Cargo.toml --lib migrate_v14_to_v15 migrate_is_idempotent_at_v15 fresh_database_migrates_to_v15`
      — expected failure: compile error (`SCHEMA_V15` and the `if version < 15` step don't
      exist yet) or, once it compiles against a stub, `assert_eq!(SCHEMA_VERSION, 15)` failing
      because `SCHEMA_VERSION` is still `14`.
- [ ] Minimal implementation. Bump the version constant:

```rust
pub const SCHEMA_VERSION: i32 = 15;
```

Add the guard functions and `SCHEMA_V15` constant immediately before the `migrate()` function
(same placement convention as `SCHEMA_V14` before it):

```rust
/// Refuse the v15 step on a bundled SQLite that predates `ALTER TABLE ... DROP COLUMN`
/// support (added in SQLite 3.35.0). Confirmed today: `rusqlite = { version = "0.40.1",
/// features = ["bundled"] }` ships well past 3.35, so this is expected to always pass — it
/// exists so a future dependency change fails loudly at migration time instead of silently
/// corrupting the schema step.
fn assert_sqlite_version_supports_drop_column(conn: &Connection) {
    let version: String = conn
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("read sqlite_version()");
    let mut parts = version.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    assert!(
        (major, minor) >= (3, 35),
        "bundled SQLite {version} predates 3.35 — ALTER TABLE DROP COLUMN is unsupported; \
         do not ship schema v15 on this build"
    );
}

/// Refuse the v15 step if any index, view, or trigger still references
/// `session.focused_seconds` (B74: verified today that nothing does — every runtime reader
/// computes the value fresh via `metrics::focused_seconds`, never from the column). Runs
/// against the real `sqlite_master` rather than trusting the static check, since this guard
/// is the only thing standing between an irreversible DROP COLUMN and a broken dependent
/// object.
fn assert_no_references_to_session_focused_seconds(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT type, name FROM sqlite_master \
             WHERE type IN ('index','view','trigger') AND sql LIKE '%focused_seconds%'",
        )
        .expect("prepare sqlite_master scan");
    let hits: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .expect("query sqlite_master")
        .collect::<Result<_, _>>()
        .expect("collect sqlite_master rows");
    assert!(
        hits.is_empty(),
        "refusing schema v15: {} object(s) still reference focused_seconds: {hits:?}",
        hits.len()
    );
}

pub(crate) const SCHEMA_V15: &str = "\
ALTER TABLE session DROP COLUMN focused_seconds;
CREATE TABLE day_photo (
  day TEXT PRIMARY KEY CHECK (day GLOB '____-__-__'),
  rel_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE dynamics_profile (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX dynamics_profile_one_active_idx ON dynamics_profile(active) WHERE active=1;
CREATE TABLE dynamics_calibration_point (
  profile_id INTEGER NOT NULL REFERENCES dynamics_profile(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  dynamic_label TEXT NOT NULL CHECK (dynamic_label IN ('pp','p','mf','f','ff')),
  measured_db REAL NOT NULL,
  PRIMARY KEY (profile_id, ordinal)
);
";
```

Add the cascading step at the end of `migrate()`, after the existing `if version < 14 { .. }`
block and before its closing `Ok(())`:

```rust
    if version < 15 {
        let v15 = (|| -> rusqlite::Result<()> {
            assert_sqlite_version_supports_drop_column(conn);
            assert_no_references_to_session_focused_seconds(conn);
            conn.execute_batch("BEGIN IMMEDIATE;")?;
            conn.execute_batch(SCHEMA_V15)?;
            conn.execute_batch("PRAGMA user_version = 15;")?;
            conn.execute_batch("COMMIT;")?;
            Ok(())
        })();
        if let Err(error) = v15 {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }
```

- [ ] Run to pass:
      `cargo test --manifest-path src-tauri/Cargo.toml --lib migrate_v14_to_v15 migrate_is_idempotent_at_v15 fresh_database_migrates_to_v15`
      — all three green.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` — full lib suite green (blast
      radius: any test asserting `SCHEMA_VERSION == 14` elsewhere must be updated to `15`; grep
      confirmed today that `SCHEMA_VERSION` appears at `migrations.rs:2059,2097,2785,2878,
3044(as `SCHEMA_VERSION` comparison),3090,3236,3485,3691,3759,3959` — these compare
      against the constant symbolically, not a hardcoded `14`, so they should auto-adjust; the
      one hardcoded literal to check is `assert_eq!(SCHEMA_VERSION, 14)` inside
      `migrate_v13_to_v14_adds_measure_map_and_columns` at `migrations.rs:4300`, which stays as
      a fact about that specific step and does not need changing).
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — clean.
- [ ] Commit: `feat(store): schema v15 — drop session.focused_seconds (B74), add day_photo + dynamics_profile/dynamics_calibration_point`

---

### Task 3: Rehearse v15 on a real database copy

**Files:** none created/modified — this task exercises Task 2's migration against real data
and records the result; if it finds a problem, fix goes back into Task 2's commit territory
(amend forward with a new commit, never rewrite Task 2's).

**Interfaces:**

- Consumes: the ignored test at `store/mod.rs:1675`,
  `rehearse_migration_on_real_database_copy`, unmodified — it already asserts row-count
  invariance on `preserved_tables = ["region", "rep_block", "rep", "goal", "session",
"session_event"]` (`store/mod.rs:1698-1705`) and refuses any path containing
  `com.christian.codakiller` (`store/mod.rs:1684-1692`). `session` staying in that list is
  exactly right for v15: the test checks **row count**, not column shape, so dropping
  `focused_seconds` (a column, zero rows added/removed) still passes unmodified.

- [ ] Copy the newest vault backup to a scratch path (never the live app-data location):
      `mkdir -p /private/tmp/claude-501/-Users-c3/01076c20-8754-4b06-bae2-dbe1fad8c843/scratchpad/v7-rehearsal && cp "/Users/c3/Desktop/christian's universe/Piano Practice/CodaKiller/(C) pre-v6.0.1-install-2026-08-21-121450.db" /private/tmp/claude-501/-Users-c3/01076c20-8754-4b06-bae2-dbe1fad8c843/scratchpad/v7-rehearsal/rehearsal-copy.db`
      (confirmed present today, 19,070,976 bytes, dated Aug 21 12:14).
- [ ] Run the rehearsal:
      `CODAKILLER_MIGRATION_COPY=/private/tmp/claude-501/-Users-c3/01076c20-8754-4b06-bae2-dbe1fad8c843/scratchpad/v7-rehearsal/rehearsal-copy.db cargo test --manifest-path src-tauri/Cargo.toml --lib rehearse_migration_on_real_database_copy -- --ignored`
      — expect PASS: the copy carries `PRAGMA user_version` at whatever version it was backed
      up at (≤ 14, since it predates this plan), migrates cleanly through every intervening
      step including the new v15 step, and every `preserved_tables` row count matches
      before/after.
- [ ] If it fails: this is a real signal about the live schema, not a spec problem — stop,
      capture the exact assertion failure and error text, and treat it as a blocking finding
      for this task (do not proceed to Task 4 until resolved; the fix, if needed, lands as a
      new commit that amends Task 2's migration step, never silently).
- [ ] Delete the scratch copy: `rm -rf /private/tmp/claude-501/-Users-c3/01076c20-8754-4b06-bae2-dbe1fad8c843/scratchpad/v7-rehearsal` (never leaves a live-data copy lying around after the
      rehearsal).
- [ ] Commit: `test(store): rehearse schema v15 on a real database copy — passes` (an empty-diff
      commit is fine here if Task 2 already contains everything; if the rehearsal surfaced a
      fix, that fix's diff is what's committed, with this message describing why).

---

### Task 4: Gates, protocol, merge

- [ ] Full gates: `cargo test --manifest-path src-tauri/Cargo.toml` (0 fail),
      `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (clean).
      No `npx vitest` / `npx tsc` gate applies — this plan touches zero frontend files; confirm
      that with `git diff --stat main -- src/` returning empty before merge.
- [ ] Confirm no UI was touched: `git diff --stat main -- src/ '*.tsx' '*.css'` must be empty.
- [ ] Fresh-context adversarial verification pass (per the spec's binding verification regime)
      over both the B0 verdict and the v15 migration diff before either counts as done.
- [ ] UPDATE PROTOCOL: log this plan's landing in the vault `(C) Changelog.md` (schema v14→v15,
      B74 resolved, B0 verdict — pass or fail, and its consequence for Plan B's scope);
      `(C) Flaws.md` — move B74 to Resolved; if B0 came back FAIL, add a new flaw/decision entry
      recording the push-to-measure fork for Christian; `(C) Roadmap.md` — mark v7 Foundations
      done, note whether Plan B proceeds as scoped or needs the push-to-measure redesign;
      `(C) CodaKiller Command Center.md` status/threads. `(C) How To Use.md` is untouched — no
      UI or user-facing behavior changed by this plan. `CodaKiller.md` portable summary
      refreshed with its `Last updated:` line bumped. This repo's `NOTES.md` already got the B0
      empirical-fact entry in Task 1; add a schema-v15 entry here too if Task 3's rehearsal
      surfaced anything worth remembering.
- [ ] Merge `v7/foundations` → `main` (`--no-ff`) from the worktree's checkout of `main` (or via
      `cd ~/codakiller && git merge --no-ff v7/foundations`). No version bump, no install — this
      plan ships nothing to the app; v7.0.0's version bump happens when Plans A/B/C actually
      land.
- [ ] Remove the worktree once merged: `git worktree remove ~/.ck-lanes/v7-foundations`.
