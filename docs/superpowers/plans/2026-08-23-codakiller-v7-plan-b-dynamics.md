# CodaKiller v7.0.0 Plan B — Dynamics Checker (B1 meter core · B2 calibration · B3 live readout · B4 target mode)

> **Status:** Historical/as built; the loudness-only Dynamics Checker shipped in v7.0.0. The
> preamble's original B0 hold is superseded by the completed spike/release evidence. It remains a
> loudness aid, never an interpreter or grader of piano playing.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

---

## PREAMBLE — preconditions (read before starting Task B1)

### 1. B0 spike status: **NOT CONFIRMED → this plan is ON HOLD**

Ledger item 9 (`.workflow/LEDGER.md:24`) requires the B0 throwaway spike to run FIRST and
answer: _can a cpal input stream coexist with the hear-CLI STT process on the same default
mic on the M2 Air, both live?_ Evidence gathered 2026-08-23:

- `.workflow/LEDGER.md` item 9 is **unchecked** — no recorded answer.
- Session task list item #3 ("Build v7 Foundations: B0 spike + schema v15") is **pending**.
- `.workflow/scratch/recon-v7.md` records the current audio reality and contains **no B0
  result**: "`audio/mod.rs`: OUTPUT-ONLY engine … **NO input stream exists anywhere**."
- `grep -ril "coexist"` over `.workflow/`, `docs/superpowers/plans/` and `NOTES.md` returns
  only an unrelated NOTES.md line about tests coexisting with bugs. No spike report exists.

**Therefore:** per the spec (`Plan B — Dynamics Checker (isolated; spike first)`,
`…v6.0.1-fixes-v7-motivation-layer.md`), _"If coexistence fails, the fallback design is
push-to-measure (dynamics capture pauses STT) — Christian decides that trade-off if the spike
forces it."_ This plan is written for the **always-on meter** shape. Do **not** start Task B1
until one of these holds:

- **(a) B0 returns "coexistence OK"** — record the result (CPU/RSS numbers + verdict) in
  `.workflow/LEDGER.md` item 9, then execute this plan unchanged.
- **(b) B0 returns "coexistence fails"** — the plan is **blocked on Christian's
  push-to-measure decision**. If he takes push-to-measure, this plan needs an amendment
  before execution: `dynamics_meter_start` must first close the STT gate
  (`SttHandle::set_gate(false)`, `stt/mod.rs:7-10`, gate call sites `voice_loop.rs:336,359,
419,3074`) and `dynamics_meter_stop` must reopen it via the `ReopenGuard`
  (`voice_loop.rs:407`) — a **gate-only** change, still no voice-router or fast-path edit,
  so the narrated-corpus gate is not triggered. Write that amendment as a new task B1a and
  get it reviewed before coding.

Everything below assumes (a). If you are executing under (b), stop and escalate.

### 2. Schema v15 assumption: **the migration does NOT exist yet — Foundations must land first**

Verified: `src-tauri/src/store/migrations.rs:11` reads `pub const SCHEMA_VERSION: i32 = 14;`.
There is no `SCHEMA_V15`, no `dynamics_profile`, no `dynamics_calibration_point` anywhere in
`src-tauri/` (grep for all three returns nothing in source). The v14 step at
`src-tauri/src/store/migrations.rs:1675-1687` is the cascading-step template v15 copies.

The v15 migration is authored by the sibling plan
**`docs/superpowers/plans/2026-08-23-codakiller-v7-foundations.md`** (LEDGER items 1-4), which
must be executed and merged **before Task B2 of this plan starts**. Task B2 here *consumes*
those tables and authors none of them.

The exact DDL B2 is written against (copied from that plan's `SCHEMA_V15` constant —
re-read it before writing B2 and amend B2, never the schema, if it has moved):

```sql
CREATE TABLE dynamics_profile (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
-- one active profile database-wide (partial unique index; same idiom as
-- set_contract_one_active_v2_idx, SCHEMA_V14, migrations.rs:993-994)
CREATE UNIQUE INDEX dynamics_profile_one_active_idx
  ON dynamics_profile(active) WHERE active=1;

CREATE TABLE dynamics_calibration_point (
  profile_id INTEGER NOT NULL REFERENCES dynamics_profile(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  dynamic_label TEXT NOT NULL CHECK (dynamic_label IN ('pp','p','mf','f','ff')),
  measured_db REAL NOT NULL,
  PRIMARY KEY (profile_id, ordinal)
);
```

Three consequences for Task B2, all load-bearing:

- The timestamp column is **`created_at`**, not `created_ts` — the `DynamicsProfile` struct
  field is `created_at`.
- `dynamics_calibration_point` has **no `id`**; its primary key is `(profile_id, ordinal)`,
  so inserts must supply `ordinal` 0..4 in pp→ff order.
- The DDL carries **no length CHECK on `label`** and **no range CHECK on `measured_db`** —
  so B2's `validate_points` and the 1-120-char label rule are the *only* thing standing
  between a bad capture and a stored profile. They are not belt-and-braces; they are the belt.

### 3. Verified anchors (all re-checked 2026-08-23; drift noted)

| Anchor                                                                                                                                                            | Status                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src-tauri/src/audio/mod.rs:1-42` realtime-discipline doc comment                                                                                                 | **confirmed at 1-42**                                                                                                                                                                                              |
| `src-tauri/src/metronome.rs:772-776` `pub(crate) fn emit` → `app.emit("metro://state", s)`                                                                        | recon said 773-775; the `emit` fn body is **772-776**, the `app.emit` call is **line 774**. Minor drift, use 772-776.                                                                                              |
| `src/features/metronome/useMetronome.ts:194-221` listen-then-fetch                                                                                                | **confirmed**; the doc comment explaining WHY is at 193-198, the effect at 200-221                                                                                                                                 |
| `src/features/dock/dockState.ts:316` `DOCK_CHAIN_BASE_Y = 16`                                                                                                     | **confirmed at 316**                                                                                                                                                                                               |
| `src/features/dock/dockState.ts:286` `DENSE_LAYOUT_FLOOR = {720,520}`                                                                                             | **confirmed at 286**                                                                                                                                                                                               |
| `src/features/dock/dockState.ts:280` `NAV_RAIL_WIDTH = 148`, `:261` `PANEL_STACK_GAP_PX = 8`, `:47` `PANEL_WIDTH_EDGE_MARGIN = 24`, `:52` `MIN_PANEL_WIDTH = 200` | **confirmed**                                                                                                                                                                                                      |
| `src/features/dock/ClockPanel.tsx:35-38` `DEFAULT_POSITION`, `:43` `PANEL_WIDTH = 320`, `:69-76` `clockDefaultX`, `:223-228` `<DockPanel>`                        | **confirmed**                                                                                                                                                                                                      |
| `src/shell/Shell.tsx:1201` `<ClockPanel />` inside `<DockProvider>` (1177)                                                                                        | **confirmed** — the one mount site for dock panels                                                                                                                                                                 |
| `src-tauri/src/lib.rs:2240` `.invoke_handler(tauri::generate_handler![`                                                                                           | **confirmed at 2240**                                                                                                                                                                                              |
| `src/devMock/tauriDevMock.ts:2764` `function routeCommand`, `:3260` `installTauriDevMock`, `:3347` `uninstallTauriDevMock`                                        | **confirmed** (`grep -a` required — the file trips grep's binary heuristic)                                                                                                                                        |
| `.workflow/devmock-coverage-audit.mjs`                                                                                                                            | **confirmed**: a 6-bucket agent pipeline that finds `case "cmd"` blocks in the devMock with real logic and no sibling `tauriDevMock.<name>.test.ts` seam coverage, then adversarially re-verifies each claimed gap |
| `cpal = "0.18.1"`, `crossbeam-queue = "0.3.13"` in `src-tauri/Cargo.toml:25,27`                                                                                   | **confirmed** — no new dependency needed                                                                                                                                                                           |

**Open question flagged for the implementer:** the devMock's event seam
(`tauriDevMock.ts:3302-3320`) _deliberately never fires a listener callback_ —
`transformCallback` returns an id and discards the handler. A mock `dynamics://level` ticker
therefore requires a small, additive change to that seam (Task B3, step 4). This is the one
place this plan touches shared devMock infrastructure; it is additive and every existing
suite must stay green.

---

**Goal:** A loudness-only dynamics meter: a Rust level-meter core (own thread, own cpal input
stream), a per-piano calibration wizard (pp→ff), a live dock-panel readout mapping the current
level onto the calibrated band, and a user-triggered target mode that shows where the playing
landed relative to a chosen dynamic or crescendo range.

**Architecture:** New Rust module `src-tauri/src/dynamics/` (`mod.rs` + `weighting.rs`) owning
its own thread and its own cpal **input** stream, completely separate from `audio/mod.rs`'s
output `Engine` and mirroring that module's realtime-discipline rules verbatim (no locks, no
allocations, no I/O in the callback; state leaves via `AtomicU32`s and a lock-free
`ArrayQueue`). A control-side ticker thread — never the audio callback — emits
`dynamics://level` at 8 Hz via `app.emit`, the `metronome.rs:772-776` idiom. Frontend adds one
new dock panel (`src/features/dock/DynamicsPanel.tsx`, id `"dynamics"`) plus one hook
(`src/features/dock/useDynamics.ts`) that follows the `useMetronome.ts:194-221`
listen-then-fetch idiom exactly and **never polls**. Calibration profiles persist in the
schema-v15 `dynamics_profile` / `dynamics_calibration_point` tables. Target mode is **pure UI
state** — zero DB writes, zero event appends.

**Tech Stack:** Rust / cpal 0.18.1 / crossbeam-queue 0.3.13 / rusqlite + `cargo test` ·
React 19 + TS + vitest (jsdom) · **no new dependencies** (the A-weighting cascade is derived
in-repo from the IEC 61672 analog pole/zero set by bilinear transform — no DSP crate, no
lookup table).

**Spec path:** `docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`
(Part 2 → _Plan B — Dynamics Checker_; Constraints; Non-goals (v7))

## Global Constraints

- **THE LAW: loudness only, forever. No FFT, no pitch/onset/note detection, no
  transcription, no grading. The Rust module exposes dB figures and NOTHING else. No verdict
  writes, no streak effects from target mode. 8GB M2 Air: A-weighting = cascaded biquads, no
  models.** If a design detail drifts that way, the detail is wrong and gets cut.
- **Isolation rule (restated at every task):** metronome, rep, session, voice/STT/TTS,
  score, calendar and notebook code is **UNTOUCHED**. Everything new lives behind the
  `src-tauri/src/dynamics/` module boundary and the `"dynamics"` dock-panel boundary. **No
  file under `src-tauri/src/voice*`, `src-tauri/src/stt/`, or `src/features/voice/` is
  modified by any task in this plan** — verify with `git diff --name-only` before each commit.
- **No voice commands for dynamics in v7 — deliberate.** Adding one would touch the voice
  router or fast-path allowlist and trigger the narrated-corpus replay gate (finals AND
  partial-stream suites, 1,309 utterances, zero false mutations — spec Constraints; LEDGER
  item 21). The meter is opened, started and stopped from the dock panel only. Revisit in a
  later release, behind its own corpus run.
- **The mic never runs idle.** The cpal input stream exists only between an explicit
  `dynamics_meter_start()` and `dynamics_meter_stop()`. Panel close/unmount stops it. App
  exit stops it. There is no "warm" or "paused" state that holds the device open.
- **Realtime discipline** (`src-tauri/src/audio/mod.rs:1-42`): the input callback owns its
  filter state and ring buffer outright (moved into the closure), allocates its buffers once
  at stream build, and never locks, allocates, frees, or does I/O. All outward state crosses
  the thread boundary through `AtomicU32`/`AtomicU64`, never a mutex.
- **Practice truth is append-only and untouched.** This plan adds **zero** write paths to
  `rep`, `rep_block`, `session`, `session_event`, `goal`, `region`, or `set_contract`. The
  only writes anywhere are to `dynamics_profile` / `dynamics_calibration_point` (Task B2).
- Never delete or rename a CSS token; new styles use existing paper tokens (`--ink`,
  `--ink-dim`, `--hairline`, `--s-1..--s-3`, `--text-xs..--text-xl`, `--signal-*`) — the
  `dock.css` vocabulary, see `src/features/dock/dock.css:240-301`.
- `prefers-reduced-motion: reduce` disables the needle transition (the app-wide idiom, e.g.
  `src/App.css:151`).
- **devMock is BINDING:** every command the frontend calls gets a `routeCommand` case plus
  deterministic fixtures usable at 720×520, state cleared in `installTauriDevMock()`, plain-
  string rejects; sibling seam test `tauriDevMock.dynamics.test.ts`. Commands the frontend
  calls **on a timer** (here: the `dynamics://level` stream) must also have a mock ticker.
- Dense floor: every new surface usable at 720×520; no default panel position may cover the
  score toolbar, the rep card, or the day sheet's header.
- TDD per task; scoped suites per task, full gates at B5. Commit per task on branch
  `v7/plan-b`.

---

### Task B1: Level-meter core (Rust) — cpal input → A-weighting → RMS/peak → `dynamics://level`

**Files:**

- Create: `src-tauri/src/dynamics/mod.rs` (meter thread, cpal input stream, state machine,
  ticker, three `#[tauri::command]` fns, inline `#[cfg(test)] mod tests`)
- Create: `src-tauri/src/dynamics/weighting.rs` (analog A-weighting pole/zero set, bilinear
  transform, `BiquadCascade`, inline `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/lib.rs` — add `mod dynamics;` beside the existing module
  declarations, register `Arc<DynamicsMeter>` in Tauri state at setup, add three names to the
  `generate_handler!` list at `src-tauri/src/lib.rs:2240`, and call
  `meter.shutdown()` in the existing window-destroyed handler alongside
  `metro.shutdown()` (`lib.rs:2235-2237`)
- **Untouched:** `src-tauri/src/audio/**` (the output Engine), `metronome.rs`, `voice*`,
  `stt/**`, `rep/**`, `sessions/**`, `store/**`

**Interfaces (produces):**

`src-tauri/src/dynamics/weighting.rs`:

```rust
/// One direct-form-I biquad. `Copy` and POD — the callback owns it by value.
#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    pub b0: f32, pub b1: f32, pub b2: f32,
    pub a1: f32, pub a2: f32,
    x1: f32, x2: f32, y1: f32, y2: f32,
}

impl Biquad {
    /// Bilinear-transform an analog section `(b2s s^2 + b1s s + b0s) /
    /// (a2s s^2 + a1s s + a0s)` at `sample_rate`, normalized so `a0 == 1`.
    pub fn from_analog(
        b2s: f64, b1s: f64, b0s: f64,
        a2s: f64, a1s: f64, a0s: f64,
        sample_rate: f64,
    ) -> Self;

    /// Process one sample. NO allocation, NO branch on state — callback-safe.
    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32;

    /// Complex magnitude of this section at `hz`. Test/analysis only.
    pub fn magnitude_at(&self, hz: f64, sample_rate: f64) -> f64;
}

/// The IEC 61672 A-weighting curve as three cascaded biquads plus the scalar
/// that normalizes the cascade to 0 dB at 1 kHz.
#[derive(Clone, Copy, Debug)]
pub struct AWeighting {
    sections: [Biquad; 3],
    gain: f32,
}

impl AWeighting {
    /// Derive the cascade for `sample_rate` (44_100.0 / 48_000.0 / anything).
    pub fn new(sample_rate: f64) -> Self;
    /// Process one sample through all three sections + the 1 kHz normalizer.
    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32;
    /// Cascade magnitude response in dB at `hz`. Test/analysis only.
    pub fn response_db(&self, hz: f64, sample_rate: f64) -> f64;
}

/// IEC 61672 A-weighting break frequencies, in Hz.
pub const F1: f64 = 20.598_997;
pub const F2: f64 = 107.652_65;
pub const F3: f64 = 737.862_23;
pub const F4: f64 = 12_194.217;
```

`src-tauri/src/dynamics/mod.rs`:

```rust
/// dBFS floor. Digital silence reports exactly this, never -inf.
pub const DB_FLOOR: f32 = -100.0;
/// RMS integration window. 125 ms == IEC "fast" weighting.
pub const RMS_WINDOW_MS: u32 = 125;
/// Control-side emit rate. 8 Hz — one event per RMS window, no faster.
pub const TICK_HZ: u32 = 8;

/// Levels published by the audio callback, read by the ticker thread.
///
/// # f32-bits-as-u32 encoding
///
/// `AtomicF32` does not exist in `std`. Both fields hold `f32::to_bits(v)` of a
/// dBFS figure and are read back with `f32::from_bits(..)`. The transform is
/// lossless and total for every finite f32 (`to_bits`/`from_bits` are exact
/// inverses), so no precision is traded for lock-freedom. Each field is stored
/// with `Ordering::Relaxed`: the two are INDEPENDENT readings, never a pair that
/// must be observed atomically together — a ticker that catches `rms` from
/// window N and `peak` from window N+1 is displaying two truthful numbers 125 ms
/// apart, which is invisible at 8 Hz and costs nothing. `seq` (Release on write,
/// Acquire on read) exists only so the ticker can tell "the callback is alive and
/// producing" from "the stream died silently".
#[derive(Debug)]
pub struct SharedLevels {
    rms_db_bits: AtomicU32,
    peak_db_bits: AtomicU32,
    seq: AtomicU64,
}

impl SharedLevels {
    pub fn new() -> Self;
    /// Called ONLY from the audio callback. Two relaxed stores + one release
    /// store; no allocation, no lock, wait-free.
    #[inline(always)]
    pub fn publish(&self, rms_db: f32, peak_db: f32);
    /// Called ONLY from the ticker thread.
    pub fn read(&self) -> (f32, f32, u64);
}

/// Fixed-capacity sum-of-squares ring. Allocated ONCE at stream build (before
/// the callback exists) and moved into the callback; `push` never allocates,
/// never grows, never frees.
pub struct RmsRing {
    buf: Vec<f32>,   // len == capacity, filled with 0.0 at build
    idx: usize,
    sum_sq: f64,
    peak_abs: f32,
    filled: usize,
}

impl RmsRing {
    pub fn new(sample_rate: u32, window_ms: u32) -> Self;
    /// Push one weighted sample; returns (rms_dbfs, peak_dbfs) for the window.
    #[inline(always)]
    pub fn push(&mut self, weighted: f32, raw_abs: f32) -> (f32, f32);
}

/// Linear amplitude (0.0..=1.0-ish) -> dBFS, floored at `DB_FLOOR`.
/// Never returns -inf or NaN.
pub fn amplitude_to_dbfs(amplitude: f32) -> f32;

/// The control-side handle. Mutex-guarded state machine over a lock-free core —
/// the same shape `metronome.rs` uses over `audio::EngineHandle`.
pub struct DynamicsMeter { /* Mutex<Option<RunningStream>>, Arc<SharedLevels>, ... */ }

impl DynamicsMeter {
    pub fn new() -> Self;
    /// Idempotent: starting an already-running meter is Ok(()) and does NOT
    /// reopen the device.
    pub fn start(&self, app: AppHandle) -> Result<(), String>;
    /// Idempotent: stopping an already-stopped meter is Ok(()). FULLY tears the
    /// cpal stream down (drops the `Stream`, joins the ticker) — no idle capture.
    pub fn stop(&self) -> Result<(), String>;
    pub fn state(&self) -> MeterState;
    /// Called from lib.rs's window-destroyed handler.
    pub fn shutdown(&self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct MeterState { pub running: bool, pub has_input_device: bool }

/// The `dynamics://level` payload. dBFS figures and a timestamp. NOTHING else —
/// no spectrum, no pitch, no onset, no note, no verdict. THE LAW.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct LevelEvent { pub rms_db: f32, pub peak_db: f32, pub ts_ms: i64 }

#[tauri::command] pub async fn dynamics_meter_start(app: AppHandle, meter: State<'_, Arc<DynamicsMeter>>) -> Result<MeterState, String>;
#[tauri::command] pub async fn dynamics_meter_stop(meter: State<'_, Arc<DynamicsMeter>>) -> Result<MeterState, String>;
#[tauri::command] pub fn dynamics_meter_state(meter: State<'_, Arc<DynamicsMeter>>) -> MeterState;
```

**Signal chain (exact):** cpal default input device → `build_input_stream::<f32>` (mirroring
`audio/mod.rs`'s `choose_f32_config` device-config selection, `audio/mod.rs:465`) → for each
frame, average the channels to mono → `AWeighting::process` → `RmsRing::push(weighted,
raw_abs)` → `SharedLevels::publish(rms_db, peak_db)` once per window boundary → ticker thread
sleeps `1000/TICK_HZ` ms, reads `SharedLevels`, emits `dynamics://level`.

**A-weighting derivation (no lookup tables).** The analog transfer function is

```
H(s) = k · s^4 / [ (s + w1)^2 · (s + w2) · (s + w3) · (s + w4)^2 ],   wN = 2π·fN
```

split into three second-order sections, each bilinear-transformed independently with
`s -> K(1 - z^-1)/(1 + z^-1)`, `K = 2·fs`:

| Section | analog numerator | analog denominator          |
| ------- | ---------------- | --------------------------- |
| 1       | `s^2`            | `s^2 + 2·w1·s + w1^2`       |
| 2       | `s^2`            | `s^2 + (w2 + w3)·s + w2·w3` |
| 3       | `1`              | `s^2 + 2·w4·s + w4^2`       |

`k` is not hardcoded: `AWeighting::new` computes the cascade's own digital magnitude at
1000 Hz and sets `gain = 1.0 / that`, so the curve is exactly 0 dB at 1 kHz **at whatever
sample rate the device gives us** (44.1 kHz and 48 kHz are both real cases on this machine).

- [ ] Write the failing tests first — `src-tauri/src/dynamics/weighting.rs`, bottom of file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // IEC 61672-1 Table 3, class-1 tolerances are ±0.7 dB at 100 Hz; we assert
    // the textbook A-weighting values with room for the bilinear transform's
    // own low-frequency warping.
    #[test]
    fn a_weighting_is_unity_at_1khz_at_both_real_sample_rates() {
        for fs in [44_100.0_f64, 48_000.0_f64] {
            let w = AWeighting::new(fs);
            let db = w.response_db(1000.0, fs);
            assert!(db.abs() <= 0.5, "fs={fs}: 1 kHz response {db} dB, want ~0 dB");
        }
    }

    #[test]
    fn a_weighting_attenuates_100hz_by_about_19db() {
        for fs in [44_100.0_f64, 48_000.0_f64] {
            let w = AWeighting::new(fs);
            let db = w.response_db(100.0, fs);
            assert!(
                (db - (-19.1)).abs() <= 1.5,
                "fs={fs}: 100 Hz response {db} dB, want ~-19.1 dB"
            );
        }
    }

    #[test]
    fn a_weighting_rolls_off_below_the_piano_fundamental_range() {
        // Sanity that the curve is monotone-ish upward across the low band and
        // is NOT a spectrum analyser in disguise — it is one scalar per sample.
        let fs = 48_000.0;
        let w = AWeighting::new(fs);
        assert!(w.response_db(31.5, fs) < w.response_db(100.0, fs));
        assert!(w.response_db(100.0, fs) < w.response_db(1000.0, fs));
    }

    #[test]
    fn biquad_process_is_allocation_free_and_stateful() {
        let mut b = Biquad::from_analog(1.0, 0.0, 0.0, 1.0, 2.0, 1.0, 48_000.0);
        let first = b.process(1.0);
        let second = b.process(1.0);
        assert!(first.is_finite() && second.is_finite());
        assert_ne!(first, second, "biquad must carry state across samples");
    }
}
```

and `src-tauri/src/dynamics/mod.rs`, bottom of file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dbfs_conversion_floors_instead_of_returning_neg_infinity() {
        assert!((amplitude_to_dbfs(1.0) - 0.0).abs() < 1e-4);
        assert!((amplitude_to_dbfs(0.5) - (-6.0206)).abs() < 1e-3);
        assert_eq!(amplitude_to_dbfs(0.0), DB_FLOOR);
        assert_eq!(amplitude_to_dbfs(-0.0), DB_FLOOR);
        assert!(amplitude_to_dbfs(1e-12).is_finite());
    }

    #[test]
    fn rms_ring_reports_full_scale_dc_as_zero_dbfs_once_the_window_fills() {
        let mut ring = RmsRing::new(48_000, RMS_WINDOW_MS); // 6000 samples
        let mut last = (DB_FLOOR, DB_FLOOR);
        for _ in 0..6_000 { last = ring.push(1.0, 1.0); }
        assert!((last.0 - 0.0).abs() < 0.01, "rms {} want 0 dBFS", last.0);
        assert!((last.1 - 0.0).abs() < 0.01, "peak {} want 0 dBFS", last.1);
    }

    #[test]
    fn rms_ring_reports_a_sine_three_db_below_its_peak() {
        let fs = 48_000_u32;
        let mut ring = RmsRing::new(fs, RMS_WINDOW_MS);
        let mut last = (DB_FLOOR, DB_FLOOR);
        for n in 0..fs {
            let s = (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / fs as f32).sin();
            last = ring.push(s, s.abs());
        }
        // RMS of a full-scale sine is 1/sqrt(2) -> -3.01 dBFS; peak is 0 dBFS.
        assert!((last.0 - (-3.01)).abs() < 0.2, "rms {}", last.0);
        assert!((last.1 - 0.0).abs() < 0.2, "peak {}", last.1);
    }

    #[test]
    fn rms_ring_window_is_exactly_the_configured_duration() {
        assert_eq!(RmsRing::new(48_000, 125).capacity(), 6_000);
        assert_eq!(RmsRing::new(44_100, 125).capacity(), 5_512);
    }

    #[test]
    fn shared_levels_round_trip_through_the_u32_bit_encoding() {
        let s = SharedLevels::new();
        s.publish(-42.5, -12.25);
        let (rms, peak, seq) = s.read();
        assert_eq!(rms, -42.5);
        assert_eq!(peak, -12.25);
        assert_eq!(seq, 1);
        s.publish(DB_FLOOR, DB_FLOOR);
        let (rms, _, seq) = s.read();
        assert_eq!(rms, DB_FLOOR);
        assert_eq!(seq, 2);
    }

    #[test]
    fn meter_state_machine_is_idempotent_and_starts_stopped() {
        // Device-free path: `start` may fail on a headless CI box, but the
        // state machine's own invariants must hold either way.
        let m = DynamicsMeter::new();
        assert!(!m.state().running, "meter must never start itself");
        assert!(m.stop().is_ok(), "stopping a stopped meter is a no-op");
        assert!(m.stop().is_ok(), "…and stays a no-op");
        assert!(!m.state().running);
    }
}
```

- [ ] Run `cd src-tauri && cargo test dynamics` — expect **compilation failure**, not test
      failure: `error[E0432]: unresolved import crate::dynamics` / `error[E0433]: failed to
    resolve: use of undeclared crate or module dynamics`. That is the correct red state; a
      test file that compiles against a stub would be a false red.
- [ ] Implement the minimum that makes those tests pass, in this order: 1. `weighting.rs`: `Biquad::from_analog` (bilinear:
      `b0 = b2s·K² + b1s·K + b0s`, `b1 = 2(b0s − b2s·K²)`, `b2 = b2s·K² − b1s·K + b0s`,
      same for `a*`, then divide all six by `a0`), `process` (direct form I),
      `magnitude_at` (evaluate `|H(e^{jω})|` from the five coefficients),
      `AWeighting::new` (three `from_analog` calls from `F1..F4`, then
      `gain = 1/cascade_magnitude(1000)`), `process`, `response_db`. 2. `mod.rs`: `amplitude_to_dbfs` (`if a.abs() <= 1e-10 { DB_FLOOR } else {
       (20.0 * a.abs().log10()).max(DB_FLOOR) }`), `RmsRing` (`Vec` sized
      `sample_rate·window_ms/1000` at construction, running `sum_sq` updated by
      subtracting the evicted square and adding the new one, `peak_abs` recomputed as the
      max over the ring only when the outgoing sample WAS the peak — otherwise a single
      `max` compare), `SharedLevels`, then `DynamicsMeter`'s state machine. 3. cpal input stream inside `DynamicsMeter::start`: enumerate the default input device,
      pick an f32 config the same way `audio/mod.rs:465`'s `choose_f32_config` does,
      construct `AWeighting` + `RmsRing` **before** the closure, `move` both in, and in the
      closure do only arithmetic + the two relaxed atomic stores. `stop()` drops the
      `Stream` (which closes the device) and joins the ticker via an `AtomicBool` flag. 4. Ticker: `std::thread::spawn` sleeping `125 ms`, reading `SharedLevels`, calling
      `app.emit("dynamics://level", LevelEvent { .. })` and logging failures with
      `eprintln!` — best-effort, exactly like `metronome::emit`
      (`src-tauri/src/metronome.rs:772-776`). 5. `lib.rs`: `mod dynamics;`, `.manage(Arc::new(DynamicsMeter::new()))` at setup, three
      names appended to `generate_handler!` (`src-tauri/src/lib.rs:2240`), and
      `if let Some(meter) = window.try_state::<Arc<DynamicsMeter>>() { meter.shutdown(); }`
      beside the existing `metro.shutdown()` at `lib.rs:2235-2237`.
- [ ] Run `cd src-tauri && cargo test dynamics` (all green), then `cargo test` (whole crate —
      blast-radius check that `lib.rs` still compiles and no existing suite moved) and
      `cargo clippy --all-targets -- -D warnings`.
- [ ] **Isolation check:** `git diff --name-only` must list only
      `src-tauri/src/dynamics/mod.rs`, `src-tauri/src/dynamics/weighting.rs`,
      `src-tauri/src/lib.rs`. Nothing under `audio/`, `voice*`, `stt/`, `rep/`, `sessions/`,
      `store/`.
- [ ] Commit `feat(dynamics): A-weighted level-meter core with own cpal input stream + dynamics://level`.

---

### Task B2: Calibration wizard — pp→ff capture, monotonic validation, profile persistence

**Files:**

- Create: `src-tauri/src/store/dynamics_profiles.rs` (queries + types; add
  `pub mod dynamics_profiles;` to `src-tauri/src/store/mod.rs` beside the existing
  `crud`/`calendar`/`measure_map` module declarations) + inline `#[cfg(test)] mod tests`
- Create: `src/features/dock/calibration.ts` (pure validation + median math) +
  `src/features/dock/calibration.test.ts`
- Create: `src/features/dock/CalibrationWizard.tsx` +
  `src/features/dock/CalibrationWizard.test.tsx`
- Modify: `src-tauri/src/lib.rs` (three more `generate_handler!` entries at `:2240`)
- **Untouched:** every existing `store/` module, all practice tables, all voice code

**Interfaces (produces — the frontend mirrors these types verbatim):**

```rust
// src-tauri/src/store/dynamics_profiles.rs
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CalibrationPoint { pub dynamic_label: String, pub measured_db: f64 }

#[derive(Debug, Clone, serde::Serialize)]
pub struct DynamicsProfile {
    pub id: i64,
    pub device_id: String,
    pub label: String,
    pub active: bool,
    pub created_at: String,
    pub points: Vec<CalibrationPoint>, // always ordered pp,p,mf,f,ff
}

/// The five labels, in the only legal order.
pub const DYNAMIC_LABELS: [&str; 5] = ["pp", "p", "mf", "f", "ff"];

impl Store {
    /// Insert profile + its five points and make it the sole active profile,
    /// in ONE transaction. The partial unique index
    /// `dynamics_profile_one_active_idx` makes a two-statement version racy;
    /// the deactivate MUST precede the insert inside the same BEGIN IMMEDIATE.
    pub fn dynamics_profile_save(
        &self, device_id: &str, label: &str, points: &[CalibrationPoint],
    ) -> Result<DynamicsProfile, String>;

    pub fn dynamics_profile_list(&self) -> Result<Vec<DynamicsProfile>, String>;
    pub fn dynamics_profile_activate(&self, id: i64) -> Result<DynamicsProfile, String>;
    pub fn dynamics_profile_active(&self) -> Result<Option<DynamicsProfile>, String>;
}

/// Reject anything that is not five points, correctly labelled, in order, and
/// STRICTLY increasing. The message names the offending pair — never a generic
/// "invalid".
pub fn validate_points(points: &[CalibrationPoint]) -> Result<(), String>;

#[tauri::command] pub fn dynamics_profile_save(store: State<'_, Store>, device_id: String, label: String, points: Vec<CalibrationPoint>) -> Result<DynamicsProfile, String>;
#[tauri::command] pub fn dynamics_profile_list(store: State<'_, Store>) -> Result<Vec<DynamicsProfile>, String>;
#[tauri::command] pub fn dynamics_profile_activate(store: State<'_, Store>, id: i64) -> Result<DynamicsProfile, String>;
```

```ts
// src/features/dock/calibration.ts
export const DYNAMIC_LABELS = ["pp", "p", "mf", "f", "ff"] as const;
export type DynamicLabel = (typeof DYNAMIC_LABELS)[number];

export interface CalibrationPoint {
  dynamic_label: DynamicLabel;
  measured_db: number;
}
export interface DynamicsProfile {
  id: number;
  device_id: string;
  label: string;
  active: boolean;
  created_at: string;
  points: CalibrationPoint[];
}

/** Median of a capture window. Even-length windows average the two middles. */
export function medianDb(samples: number[]): number;

/** Mirrors the Rust `validate_points` message-for-message so the wizard can
 * reject BEFORE the round-trip and the user sees the same words either way. */
export function validateMonotonic(points: CalibrationPoint[]): string | null;
```

**Wizard behaviour (exact):** the wizard is a **view inside the dynamics dock panel**, not a
Settings page — Settings is untouched by this plan. Steps `pp → p → mf → f → ff`. Each step:
the user presses "Capture", the wizard collects `rms_db` from the already-running
`dynamics://level` stream for **2 seconds** (16 events at 8 Hz), stores `medianDb(window)`,
and advances. A profile **label is free text** (e.g. `"Steinway, living room, lid half"`),
1-120 chars, required. On finish the wizard calls `dynamics_profile_save`; a save **always
creates a new profile row** — recalibrating never mutates an existing one, so the old curve
stays inspectable. The new profile becomes active and every other profile is deactivated in
the same transaction.

**Validation message shape** (identical in Rust and TS — the honest, specific form the spec
demands):

```
Calibration must get louder at every step, but mf (-31.4 dB) is not louder
than p (-29.8 dB). Recapture mf, or start again from pp.
```

- [ ] Write the failing Rust tests in `src-tauri/src/store/dynamics_profiles.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn pts(v: [f64; 5]) -> Vec<CalibrationPoint> {
        DYNAMIC_LABELS.iter().zip(v).map(|(l, db)| CalibrationPoint {
            dynamic_label: (*l).to_string(), measured_db: db,
        }).collect()
    }

    #[test]
    fn rejects_a_non_increasing_curve_naming_the_offending_pair() {
        let err = validate_points(&pts([-48.0, -29.8, -31.4, -18.0, -9.0])).unwrap_err();
        assert!(err.contains("mf"), "message must name mf: {err}");
        assert!(err.contains("-31.4"), "message must quote the measured dB: {err}");
        assert!(err.contains("p ("), "message must name the step it failed against: {err}");
        assert!(!err.to_lowercase().contains("invalid input"), "no generic wording: {err}");
    }

    #[test]
    fn rejects_equal_neighbours_strictly_increasing_means_strictly() {
        assert!(validate_points(&pts([-48.0, -38.0, -38.0, -18.0, -9.0])).is_err());
    }

    #[test]
    fn rejects_a_short_or_mislabelled_point_set() {
        assert!(validate_points(&[]).is_err());
        let mut wrong = pts([-48.0, -38.0, -28.0, -18.0, -9.0]);
        wrong[2].dynamic_label = "mp".into();
        let err = validate_points(&wrong).unwrap_err();
        assert!(err.contains("mp"), "{err}");
    }

    #[test]
    fn accepts_a_strictly_increasing_curve() {
        assert!(validate_points(&pts([-48.0, -38.0, -28.0, -18.0, -9.0])).is_ok());
    }

    #[test]
    fn save_activates_the_new_profile_and_deactivates_every_other() {
        let store = Store::open_in_memory_v15().unwrap();
        let a = store.dynamics_profile_save("mic-1", "Steinway, lid closed",
            &pts([-50.0, -40.0, -30.0, -20.0, -10.0])).unwrap();
        assert!(a.active);
        let b = store.dynamics_profile_save("mic-1", "Steinway, lid half",
            &pts([-48.0, -38.0, -28.0, -18.0, -9.0])).unwrap();
        assert!(b.active);
        let all = store.dynamics_profile_list().unwrap();
        assert_eq!(all.iter().filter(|p| p.active).count(), 1);
        assert_eq!(store.dynamics_profile_active().unwrap().unwrap().id, b.id);
        assert_eq!(all.len(), 2, "recalibration creates a NEW profile, never mutates");
    }

    #[test]
    fn save_stores_all_five_points_in_pp_to_ff_order() {
        let store = Store::open_in_memory_v15().unwrap();
        let p = store.dynamics_profile_save("mic-1", "Steinway",
            &pts([-50.0, -40.0, -30.0, -20.0, -10.0])).unwrap();
        let labels: Vec<_> = p.points.iter().map(|c| c.dynamic_label.as_str()).collect();
        assert_eq!(labels, DYNAMIC_LABELS.to_vec());
    }

    #[test]
    fn a_rejected_save_writes_nothing_at_all() {
        let store = Store::open_in_memory_v15().unwrap();
        assert!(store.dynamics_profile_save("mic-1", "bad",
            &pts([-50.0, -40.0, -45.0, -20.0, -10.0])).is_err());
        assert!(store.dynamics_profile_list().unwrap().is_empty());
    }

    #[test]
    fn activate_moves_the_active_flag_without_creating_rows() {
        let store = Store::open_in_memory_v15().unwrap();
        let a = store.dynamics_profile_save("mic-1", "A", &pts([-50.0,-40.0,-30.0,-20.0,-10.0])).unwrap();
        let _b = store.dynamics_profile_save("mic-1", "B", &pts([-48.0,-38.0,-28.0,-18.0,-9.0])).unwrap();
        let back = store.dynamics_profile_activate(a.id).unwrap();
        assert!(back.active);
        assert_eq!(store.dynamics_profile_list().unwrap().len(), 2);
        assert_eq!(store.dynamics_profile_list().unwrap().iter().filter(|p| p.active).count(), 1);
    }
}
```

- [ ] Run `cd src-tauri && cargo test dynamics_profile` — expect
      `error[E0433]: failed to resolve: use of undeclared crate or module dynamics_profiles`.
- [ ] Implement `validate_points` first (pure, no DB), then the three `Store` methods using
      one `BEGIN IMMEDIATE` transaction per write:
      `UPDATE dynamics_profile SET active = 0 WHERE active = 1;` **then**
      `INSERT INTO dynamics_profile(...) VALUES (..., 1)` **then** the five
      `dynamics_calibration_point` inserts, `COMMIT`. Follow the existing lock discipline
      (`Store { conn: Mutex<Connection> }`, `store/mod.rs:56-57`) — take the connection once
      per command, never across a call into another service.
- [ ] `cargo test dynamics_profile` green; register the three commands in
      `generate_handler!` (`src-tauri/src/lib.rs:2240`); `cargo test` whole crate; `cargo
    clippy --all-targets -- -D warnings`.
- [ ] Write the failing TS tests — `src/features/dock/calibration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DYNAMIC_LABELS, medianDb, validateMonotonic } from "./calibration";

const pts = (v: number[]) =>
  DYNAMIC_LABELS.map((l, i) => ({ dynamic_label: l, measured_db: v[i] }));

describe("calibration math", () => {
  it("takes the median of a capture window, not the mean (one bang must not move it)", () => {
    expect(medianDb([-40, -39, -41, -40, -2])).toBe(-40);
  });

  it("averages the two middles for an even-length window", () => {
    expect(medianDb([-42, -40, -38, -36])).toBe(-39);
  });

  it("accepts a strictly increasing curve", () => {
    expect(validateMonotonic(pts([-48, -38, -28, -18, -9]))).toBeNull();
  });

  it("rejects a non-increasing curve, naming the step and both dB figures", () => {
    const msg = validateMonotonic(pts([-48, -29.8, -31.4, -18, -9]));
    expect(msg).toContain("mf");
    expect(msg).toContain("-31.4");
    expect(msg).toContain("-29.8");
    expect(msg?.toLowerCase()).not.toContain("invalid");
  });

  it("rejects equal neighbours", () => {
    expect(validateMonotonic(pts([-48, -38, -38, -18, -9]))).not.toBeNull();
  });
});
```

and `src/features/dock/CalibrationWizard.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalibrationWizard } from "./CalibrationWizard";

const stream = () => {
  const listeners: ((db: number) => void)[] = [];
  return {
    subscribe: (fn: (db: number) => void) => {
      listeners.push(fn);
      return () => {};
    },
    emit: (db: number) => listeners.forEach((l) => l(db)),
  };
};

describe("CalibrationWizard", () => {
  it("walks pp -> p -> mf -> f -> ff, one capture per step", async () => {
    const s = stream();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/play pp/i)).toBeTruthy();
    for (const [i, db] of [-48, -38, -28, -18, -9].entries()) {
      fireEvent.click(screen.getByRole("button", { name: /capture/i }));
      for (let k = 0; k < 16; k++) s.emit(db);
      await waitFor(() =>
        expect(screen.getByTestId("wizard-step").textContent).toBe(
          String(i + 1 < 5 ? i + 2 : 5),
        ),
      );
    }
    expect(screen.getByLabelText(/profile name/i)).toBeTruthy();
  });

  it("refuses to save a non-increasing capture and says exactly which step is wrong", async () => {
    const s = stream();
    const onSave = vi.fn();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    for (const db of [-48, -29.8, -31.4, -18, -9]) {
      fireEvent.click(screen.getByRole("button", { name: /capture/i }));
      for (let k = 0; k < 16; k++) s.emit(db);
      await waitFor(() => {});
    }
    fireEvent.change(screen.getByLabelText(/profile name/i), {
      target: { value: "Steinway" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("mf"),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("requires a free-text profile label before saving", async () => {
    const s = stream();
    const onSave = vi.fn();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    for (const db of [-48, -38, -28, -18, -9]) {
      fireEvent.click(screen.getByRole("button", { name: /capture/i }));
      for (let k = 0; k < 16; k++) s.emit(db);
      await waitFor(() => {});
    }
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/profile name/i), {
      target: { value: "Steinway, living room, lid half" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Steinway, living room, lid half", [
        { dynamic_label: "pp", measured_db: -48 },
        { dynamic_label: "p", measured_db: -38 },
        { dynamic_label: "mf", measured_db: -28 },
        { dynamic_label: "f", measured_db: -18 },
        { dynamic_label: "ff", measured_db: -9 },
      ]),
    );
  });
});
```

- [ ] Run `npx vitest run src/features/dock/calibration` — expect
      `Failed to resolve import "./calibration"` / `"./CalibrationWizard"`.
- [ ] Implement `calibration.ts` then `CalibrationWizard.tsx`. The wizard takes a
      `levelStream` subscribe function as a prop (so the test never needs a Tauri seam) and
      collects `CAPTURE_EVENT_COUNT = 16` samples per step. Buttons use the existing
      `Button` from `../../ui` (the `ClockPanel.tsx:4` import).
- [ ] `npx vitest run src/features/dock` green; `npx tsc --noEmit`.
- [ ] **Isolation check:** `git diff --name-only` touches only the four new files, `store/mod.rs`
      and `lib.rs`. No practice-table module, no voice file.
- [ ] Commit `feat(dynamics): pp-ff calibration wizard with one-active-profile persistence`.

---

### Task B3: Live readout dock panel — `DynamicsPanel`, `useDynamics`, devMock, CSS

**Files:**

- Create: `src/features/dock/DynamicsPanel.tsx` + `src/features/dock/DynamicsPanel.test.tsx`
- Create: `src/features/dock/useDynamics.ts` + `src/features/dock/useDynamics.test.ts`
- Create: `src/devMock/tauriDevMock.dynamics.test.ts`
- Modify: `src/features/dock/dock.css` (append the `.dynamics-panel-*` block — the existing
  file/idiom, `src/features/dock/dock.css:240-301` is the ClockPanel precedent)
- Modify: `src/features/dock/dockDefaultLayout.test.ts` (pin the new default position)
- Modify: `src/shell/Shell.tsx` — one `<DynamicsPanel />` line beside `<ClockPanel />`
  (`src/shell/Shell.tsx:1201`), inside the existing `<DockProvider>`
- Modify: `src/devMock/tauriDevMock.ts` (five `routeCommand` cases + the level ticker + the
  event-seam change described below)
- **Untouched:** `DockProvider.tsx`, `DockPanel.tsx`, `dockState.ts`, `RepPanel.tsx`,
  `PausedSetsTray.tsx`, `ClockPanel.tsx` — the new panel is a pure consumer of the framework

**Interfaces (produces):**

```ts
// src/features/dock/DynamicsPanel.tsx
/** Narrow (260) because the panel is a vertical band + one row of controls; it
 * still clears MIN_PANEL_WIDTH (200, dockState.ts:52) with room to spare. */
export const PANEL_WIDTH = 260;

/** Conservative height ceiling, same role as RepPanel's/PausedSetsTray's. */
export const ASSUMED_MAX_HEIGHT = 260;

/** The dock chain's first column is FULL at the 720x520 floor: rep(108) ->
 * tray(340) -> clock(504) already reaches the floor (dockState.ts:288-316,
 * dockDefaultLayout.test.ts). So the dynamics panel takes a SECOND column,
 * beside the rep panel, whenever the whole panel fits there — the exact
 * boolean `clockDefaultX` (ClockPanel.tsx:69-76) already uses, with this
 * panel's own width. `y` is DOCK_CHAIN_BASE_Y + the shell-topbar clearance,
 * i.e. the same 108 the rep panel uses, so the one interactive band present on
 * EVERY tab (`.shell-topbar`, live-measured 0-99.5px) is never covered, and the
 * panel sits ABOVE the score toolbar's own row rather than on it.
 *
 * At the 720x520 floor a second column cannot fit (608 + 260 + 24 = 892 > 720),
 * so the fallback is the first column at the clock's y — where, like the
 * rep-vs-tray case round 4 deliberately left to runtime, `resolveCollision` +
 * the open-time viewport clamp (DockPanel's become-visible effect) settle the
 * landing. Both panels default CLOSED, so this only ever matters once the user
 * opens both at the floor. QA (Task B5) measures this live and may retune the
 * fallback `y`; if it moves, update dockDefaultLayout.test.ts's pin with it. */
export function dynamicsDefaultX(viewportWidth: number | undefined): number;
export const DEFAULT_POSITION: { x: number; y: number };
export const FLOOR_FALLBACK_Y: number; // === ClockPanel DEFAULT_POSITION.y (504)

export function DynamicsPanel(): JSX.Element;
```

```ts
// src/features/dock/useDynamics.ts
export interface LevelEvent {
  rms_db: number;
  peak_db: number;
  ts_ms: number;
}
export interface MeterState {
  running: boolean;
  has_input_device: boolean;
}

export interface UseDynamics {
  level: LevelEvent | null;
  meter: MeterState;
  profile: DynamicsProfile | null; // the ACTIVE profile, or null if uncalibrated
  profiles: DynamicsProfile[];
  error: string | null;
  /** Subscribe to the raw level stream — what CalibrationWizard consumes. */
  subscribeLevel: (fn: (rmsDb: number) => void) => () => void;
  saveProfile: (label: string, points: CalibrationPoint[]) => Promise<void>;
  activateProfile: (id: number) => Promise<void>;
}

/** `enabled` is the panel's own open state (`useDock("dynamics").isOpen`):
 * true starts the meter, false (and unmount) stops it. The mic is NEVER open
 * while the panel is closed or minimized-to-pill. */
export function useDynamics(enabled: boolean): UseDynamics;
```

**The listen-then-fetch idiom is mandatory** — copy the shape and the reasoning from
`src/features/metronome/useMetronome.ts:193-221` verbatim: `await listen("dynamics://level",
…)` FIRST, set an `eventArrived` flag inside the handler, and only THEN `await
invoke("dynamics_meter_state")`, discarding the fetch's result if a live event already
landed. Reversing the order drops any event emitted while the fetch is in flight. **Never
poll** — there is no `setInterval` anywhere in this hook.

**Readout (exact):** a vertical band, `pp` at the bottom and `ff` at the top, whose tick
positions come from the ACTIVE profile's five `measured_db` values linearly interpolated to
band height. A **live needle** tracks `rms_db`; a **peak tick** tracks `peak_db` and decays.
If there is **no active profile**, the band is replaced by a raw `dBFS` numeric readout plus
a `Calibrate` button that opens `CalibrationWizard` inside the same panel — no fake band, no
guessed mapping. The panel header shows the active profile's free-text label so Christian can
see _which_ piano/lid state he is being measured against.

- [ ] Write the failing hook test `src/features/dock/useDynamics.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const calls: string[] = [];
const listeners = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "dynamics_meter_state")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_start")
      return { running: true, has_input_device: true };
    if (cmd === "dynamics_meter_stop")
      return { running: false, has_input_device: true };
    if (cmd === "dynamics_profile_list") return [];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    calls.push(`listen:${name}`);
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));

import { useDynamics } from "./useDynamics";

describe("useDynamics", () => {
  beforeEach(() => {
    calls.length = 0;
    listeners.clear();
  });

  it("listens BEFORE it fetches state (useMetronome.ts:194-221 idiom)", async () => {
    renderHook(() => useDynamics(true));
    await waitFor(() => expect(calls).toContain("dynamics_meter_state"));
    expect(calls.indexOf("listen:dynamics://level")).toBeLessThan(
      calls.indexOf("dynamics_meter_state"),
    );
  });

  it("never polls — exactly one meter_state invoke for the whole mount", async () => {
    vi.useFakeTimers();
    renderHook(() => useDynamics(true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter((c) => c === "dynamics_meter_state")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("starts the meter when enabled and stops it on unmount", async () => {
    const { unmount } = renderHook(() => useDynamics(true));
    await waitFor(() => expect(calls).toContain("dynamics_meter_start"));
    unmount();
    await waitFor(() => expect(calls).toContain("dynamics_meter_stop"));
  });

  it("does not open the mic while the panel is closed", async () => {
    renderHook(() => useDynamics(false));
    await waitFor(() => expect(calls).toContain("dynamics_profile_list"));
    expect(calls).not.toContain("dynamics_meter_start");
  });

  it("surfaces the streamed level", async () => {
    const { result } = renderHook(() => useDynamics(true));
    await waitFor(() => expect(listeners.has("dynamics://level")).toBe(true));
    act(() =>
      listeners.get("dynamics://level")!({
        payload: { rms_db: -28.4, peak_db: -19.2, ts_ms: 1 },
      }),
    );
    await waitFor(() => expect(result.current.level?.rms_db).toBe(-28.4));
  });
});
```

and the panel test `src/features/dock/DynamicsPanel.test.tsx` (rendered inside a real
`DockProvider`, the `ClockPanel.test.tsx` convention):

```tsx
it("shows raw dBFS and a Calibrate call-to-action when uncalibrated", async () => {
  /* … */
});
it("renders a pp..ff band scaled from the active profile's measured levels", async () => {
  /* … */
});
it("moves the needle to the position the active profile maps rms_db onto", async () => {
  /* … */
});
it("shows the active profile's free-text label in the panel header", async () => {
  /* … */
});
it("minimizes to a pill and stops the meter while pilled", async () => {
  /* … */
});
```

- [ ] Run `npx vitest run src/features/dock/useDynamics src/features/dock/DynamicsPanel` —
      expect `Failed to resolve import "./useDynamics"`.
- [ ] Implement `useDynamics.ts`, then `DynamicsPanel.tsx` (wrapped in `<DockPanel id="dynamics"
    title="Dynamics" width={PANEL_WIDTH} defaultPosition={{ x: dynamicsDefaultX(viewportWidth),
    y: DEFAULT_POSITION.y }}>`, driven by `const dock = useDock("dynamics")` — the exact
      `ClockPanel.tsx:107,223-228` registration shape, which gives minimize-to-pill for free).
      Add `<DynamicsPanel />` on its own line after `<ClockPanel />` in
      `src/shell/Shell.tsx:1201`.
- [ ] **devMock (BINDING).** In `src/devMock/tauriDevMock.ts`: 1. Add five `routeCommand` cases (`dynamics_meter_start`, `dynamics_meter_stop`,
      `dynamics_meter_state`, `dynamics_profile_list`, `dynamics_profile_save`,
      `dynamics_profile_activate`) with real logic: `save` re-runs the monotonic
      validation and **rejects with a plain string** (the backend's error convention),
      activates the new profile and deactivates the rest in the mock store. 2. Add `MOCK_DYNAMICS_PROFILES` + `mockDynamicsRunning` module state and **clear both in
      `installTauriDevMock()`** beside the existing resets (`tauriDevMock.ts:3266-3298`). 3. Add the **mock level ticker**: a `setInterval` at 125 ms started by
      `dynamics_meter_start` and cleared by `dynamics_meter_stop` (and by
      `uninstallTauriDevMock`, `tauriDevMock.ts:3347`), producing a deterministic
      slow sweep (e.g. a fixed 40-step ramp from -55 to -8 dB and back, index-driven — not
      `Math.random()`, so live QA screenshots are reproducible). 4. **Event-seam change (the one shared-infrastructure edit in this plan).** Today
      `transformCallback` discards the handler and no listener is ever fired
      (`tauriDevMock.ts:3302-3320`). Add a `Map<number, (p: unknown) => void>` populated by
      `transformCallback`, have the `plugin:event|listen` branch record
      `event -> callbackId`, and add an internal `emitMockEvent(name, payload)` the ticker
      calls. This is **purely additive**: with no ticker running, no callback is ever
      invoked, so every existing suite's behaviour is unchanged. Prove it — the full
      vitest run below is the gate. 5. Create `src/devMock/tauriDevMock.dynamics.test.ts` in the `seamInvoke` style the
      audit expects (see `.workflow/devmock-coverage-audit.mjs`'s PREAMBLE, and
      `src/devMock/tauriDevMock.bookAdd.test.ts` for the header-comment convention):
      assert `dynamics_meter_state` flips with start/stop, `dynamics_profile_save`
      rejects a non-increasing curve with a plain string naming the step, a successful
      save leaves exactly one active profile, `dynamics_profile_activate` moves the flag
      without adding rows, and the ticker fires `dynamics://level` payloads to a real
      `listen()` subscriber and stops firing after `dynamics_meter_stop`.
- [ ] Add the default-position pin to `src/features/dock/dockDefaultLayout.test.ts`:
      `DYNAMICS_DEFAULT_POSITION.x >= NAV_RAIL_WIDTH`; `.y >= SHELL_TOPBAR_BOTTOM`;
      `dynamicsDefaultX(720) + PANEL_WIDTH <= 720`; `dynamicsDefaultX(1440)` returns the
      second column; `PANEL_WIDTH >= MIN_PANEL_WIDTH`.
- [ ] CSS: append a `.dynamics-panel-*` block to `src/features/dock/dock.css` using only
      existing tokens (`--ink`, `--ink-dim`, `--hairline`, `--s-1..--s-3`, `--text-xs`,
      `--text-xl`, `--signal-*`), `font-variant-numeric: tabular-nums` on the dB readout
      (the `.clock-panel-readout` precedent, `dock.css:264-272`), and:

```css
.dynamics-needle {
  transition: transform 120ms linear;
}
@media (prefers-reduced-motion: reduce) {
  .dynamics-needle {
    transition: none;
  }
}
```

- [ ] Run `npx vitest run src/features/dock src/devMock` then the FULL `npx vitest run`
      (the event-seam change's blast radius — 0 failures required), then `npx tsc --noEmit`.
- [ ] Re-run the devMock coverage audit and confirm zero new confirmed gaps for the six
      `dynamics_*` commands: `node .workflow/devmock-coverage-audit.mjs` (add the six commands
      to a bucket, or run it with a bucket scoped to them). Record the result in the commit body.
- [ ] **Isolation check:** `git diff --name-only` — nothing under `src/features/voice/`,
      `src/features/rep/`, `src/features/metronome/`, `src-tauri/src/voice*`,
      `src-tauri/src/stt/`. `Shell.tsx` gains exactly one line.
- [ ] Commit `feat(dynamics): live readout dock panel on the calibrated pp-ff band + devMock ticker`.

---

### Task B4: Target mode — target zone, landed markers, and the zero-write proof

**Files:**

- Create: `src/features/dock/targetMode.ts` (pure state machine + zone math) +
  `src/features/dock/targetMode.test.ts`
- Create: `src/features/dock/dynamicsNoWrites.test.tsx` (the spy test)
- Modify: `src/features/dock/DynamicsPanel.tsx` (target-mode controls + zone + markers),
  `src/features/dock/DynamicsPanel.test.tsx`, `src/features/dock/dock.css`
- **Untouched:** everything else. In particular this task adds **no** command, **no** Rust
  code, and **no** devMock case — because it writes nothing.

**Interfaces (produces):**

```ts
// src/features/dock/targetMode.ts
export type Target =
  | { kind: "single"; dynamic: DynamicLabel }
  | { kind: "crescendo"; from: DynamicLabel; to: DynamicLabel };

/** The dB window a target maps to under a profile. A single dynamic gets a
 * tolerance band of half the distance to each neighbour; a crescendo spans from
 * the low edge of `from` to the high edge of `to`. */
export interface TargetZone {
  lowDb: number;
  highDb: number;
}
export function targetZone(
  target: Target,
  profile: DynamicsProfile,
): TargetZone;

export type Landing = "under" | "in" | "over";
/** Where a completed 3s trace sat relative to the zone. Uses the trace's median
 * rms so one accidental bang cannot decide the marker. */
export function landingFor(traceRmsDb: number[], zone: TargetZone): Landing;

export const TRACE_WINDOW_MS = 3_000;

export interface LandedMarker {
  id: number;
  medianDb: number;
  landing: Landing;
  atMs: number;
}

/** Pure reducer. `state` is React state and NOTHING else — no persistence, no
 * command, no event append. Deliberate: the spec says the app reports levels and
 * Christian judges the music (Plan B, B4). No verdict writes, no streak effects. */
export function reduceTargetMode(
  state: TargetModeState,
  ev: TargetModeEvent,
): TargetModeState;
```

**Behaviour (exact):** the user picks a target dynamic (`pp`..`ff`) **or** a crescendo range
(`from` → `to`) from controls inside the panel. The band highlights the resulting zone. While
target mode is on, the panel accumulates `rms_db` into a 3-second trace; at each window
boundary it appends a **landed marker** at the trace's median position, tagged
`under` / `in` / `over`. The last `MAX_MARKERS = 6` markers are kept; leaving target mode
clears them. Markers live for the life of the panel and are gone on reload — that is the
point.

- [ ] Write the failing tests `src/features/dock/targetMode.test.ts`:

```ts
const profile = {
  id: 1,
  device_id: "mic-1",
  label: "Steinway",
  active: true,
  created_at: "",
  points: [
    { dynamic_label: "pp", measured_db: -48 },
    { dynamic_label: "p", measured_db: -38 },
    { dynamic_label: "mf", measured_db: -28 },
    { dynamic_label: "f", measured_db: -18 },
    { dynamic_label: "ff", measured_db: -9 },
  ],
} as const;

it("gives a single dynamic a zone halfway to each neighbour", () => {
  expect(targetZone({ kind: "single", dynamic: "mf" }, profile)).toEqual({
    lowDb: -33,
    highDb: -23,
  });
});

it("clamps the outermost dynamics' zones to the calibrated ends", () => {
  expect(targetZone({ kind: "single", dynamic: "pp" }, profile).lowDb).toBe(
    -48,
  );
  expect(targetZone({ kind: "single", dynamic: "ff" }, profile).highDb).toBe(
    -9,
  );
});

it("spans a crescendo from the low edge of `from` to the high edge of `to`", () => {
  expect(
    targetZone({ kind: "crescendo", from: "p", to: "f" }, profile),
  ).toEqual({ lowDb: -43, highDb: -13.5 });
});

it("lands on the trace median, so one stray bang cannot flip the marker", () => {
  const zone = { lowDb: -33, highDb: -23 };
  expect(landingFor([-29, -28, -30, -28, -4], zone)).toBe("in");
});

it("reports under and over honestly", () => {
  const zone = { lowDb: -33, highDb: -23 };
  expect(landingFor([-40, -41, -39], zone)).toBe("under");
  expect(landingFor([-15, -14, -16], zone)).toBe("over");
});

it("keeps at most six markers and clears them when target mode turns off", () => {
  /* … */
});
```

and the **zero-write proof** `src/features/dock/dynamicsNoWrites.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  act,
  waitFor,
} from "@testing-library/react";

// Every command the app can reach goes through this ONE spy. If any dynamics
// code path ever calls a practice-mutating command, this test fails loudly.
const invokeSpy = vi.fn(async (cmd: string) => {
  if (cmd === "dynamics_meter_state" || cmd === "dynamics_meter_start")
    return { running: true, has_input_device: true };
  if (cmd === "dynamics_meter_stop")
    return { running: false, has_input_device: true };
  if (cmd === "dynamics_profile_list") return [ACTIVE_PROFILE];
  return null;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeSpy }));

const emit = { fn: null as null | ((e: { payload: unknown }) => void) };
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_n: string, cb: (e: { payload: unknown }) => void) => {
    emit.fn = cb;
    return () => {
      emit.fn = null;
    };
  }),
}));

/** Everything that appends practice truth or mutates a practice row. Sourced
 * from the real command surface (lib.rs generate_handler!, :2240). */
const FORBIDDEN = [
  "rep_check",
  "rep_undo",
  "rep_correct",
  "rep_restart",
  "rep_pause",
  "rep_resume",
  "rep_reflect",
  "rep_close",
  "rep_recover",
  "rep_safety_stop",
  "rep_open",
  "set_open",
  "set_pause",
  "set_resume",
  "set_close",
  "session_start",
  "session_end",
  "session_event_append",
  "session_end_and_export",
  "goal_update",
  "day_sheet_save",
  "verdict_record",
  "tempo_change",
];

describe("dynamics target mode writes NOTHING (spec Plan B4: no verdict writes, no streak effects)", () => {
  beforeEach(() => {
    invokeSpy.mockClear();
    emit.fn = null;
  });

  it("appends zero events and mutates zero practice rows across the whole target-mode flow", async () => {
    render(<DynamicsPanelHarness />);
    await waitFor(() => expect(emit.fn).not.toBeNull());

    // Open target mode, pick a single dynamic, run three full traces.
    fireEvent.click(screen.getByRole("button", { name: /target mode/i }));
    fireEvent.click(screen.getByRole("button", { name: /^mf$/ }));
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < 24; i++) {
        act(() =>
          emit.fn!({
            payload: { rms_db: -28, peak_db: -20, ts_ms: t * 3000 + i * 125 },
          }),
        );
      }
    }
    await waitFor(() =>
      expect(screen.getAllByTestId("landed-marker").length).toBe(3),
    );

    // Then a crescendo range, and turning target mode back off.
    fireEvent.click(screen.getByRole("button", { name: /crescendo/i }));
    fireEvent.click(screen.getByRole("button", { name: /^p$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^f$/ }));
    for (let i = 0; i < 24; i++) {
      act(() =>
        emit.fn!({
          payload: { rms_db: -20, peak_db: -14, ts_ms: 9000 + i * 125 },
        }),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: /target mode/i }));

    const called = invokeSpy.mock.calls.map(([cmd]) => cmd as string);
    for (const forbidden of FORBIDDEN) {
      expect(
        called,
        `target mode must never invoke ${forbidden}`,
      ).not.toContain(forbidden);
    }
    // Stronger: the ONLY commands the panel may ever call are the dynamics six.
    const allowed = new Set([
      "dynamics_meter_start",
      "dynamics_meter_stop",
      "dynamics_meter_state",
      "dynamics_profile_list",
      "dynamics_profile_save",
      "dynamics_profile_activate",
    ]);
    for (const cmd of called) {
      expect(
        allowed.has(cmd),
        `unexpected command from dynamics code: ${cmd}`,
      ).toBe(true);
    }
    // And target mode itself invokes NOTHING beyond the mount-time calls.
    expect(called.filter((c) => c === "dynamics_profile_save")).toHaveLength(0);
  });
});
```

- [ ] Run `npx vitest run src/features/dock/targetMode src/features/dock/dynamicsNoWrites` —
      expect `Failed to resolve import "./targetMode"`.
- [ ] Implement `targetMode.ts` (pure functions + reducer), then wire the controls, the zone
      highlight, and the landed markers into `DynamicsPanel.tsx`. Markers are `useState`
      only — no `useEffect` that calls `invoke`, no localStorage, no DB.
- [ ] CSS: `.dynamics-target-zone` (a `--signal-*`-tinted band) and `.dynamics-landed-marker`
      appended to `dock.css`, reduced-motion respected (markers appear without transition
      under `prefers-reduced-motion: reduce`).
- [ ] `npx vitest run src/features/dock` green; `npx tsc --noEmit`.
- [ ] **THE LAW check:** `grep -rniE "fft|pitch|onset|note_?detect|transcri|grade|verdict" src/features/dock/DynamicsPanel.tsx src/features/dock/targetMode.ts src/features/dock/useDynamics.ts src/features/dock/calibration.ts src-tauri/src/dynamics/`
      must return **nothing** (other than the doc comments that state the prohibition). The
      module's whole public surface is dB figures.
- [ ] **Isolation check:** `git diff --name-only` touches only `src/features/dock/*`. Confirm
      explicitly that no path under `src-tauri/src/voice*`, `src-tauri/src/stt/`, or
      `src/features/voice/` appears anywhere in this plan's cumulative diff:
      `git diff --name-only main...v7/plan-b | grep -iE "voice|stt"` must be **empty**.
- [ ] Commit `feat(dynamics): target mode with zone + landed markers, zero practice writes`.

---

### Task B5: Gates, 720×520 screenshot QA, live at-Steinway acceptance note, protocol, merge

**Files:**

- Create: `.workflow/scratch/dynamics-qa/` (screenshots + notes)
- Create: `docs/superpowers/plans/2026-08-23-dynamics-steinway-acceptance.md` (the manual
  acceptance checklist handed to Christian)
- Modify: vault docs per the update protocol
- **Untouched:** all source code, unless a QA finding forces a scoped fix wave

- [ ] Full gates: `npx vitest run` (0 fail), `npx tsc --noEmit`,
      `cd src-tauri && cargo test` (0 fail), `cargo clippy --all-targets -- -D warnings`,
      `npm run build`.
- [ ] **Real-window screenshot QA at exactly 720×520** (`DENSE_LAYOUT_FLOOR`,
      `dockState.ts:286`), in `dev:mock` with fresh localStorage, capturing at minimum: 1. **Idle / uncalibrated** — panel open, meter running against the mock ticker, raw
      dBFS readout + the `Calibrate` call-to-action visible, no fake band drawn. 2. **Calibration wizard mid-flow** — stopped at the `mf` step, the two already-captured
      values shown, the free-text profile-name field reachable **without inner scrolling**
      (the `ClockPanel` Start/Reset lesson, `ClockPanel.tsx:44-58`). 3. **Target mode with a landed marker** — a single-dynamic target with the zone
      highlighted and at least two landed markers on the band, one `in` and one `over`.
      Plus: the panel minimized to a pill alongside the other three pills (distinct slots,
      `PILL_STACK_STEP_PX`); and the panel open on the **Score** tab confirming it does not
      cover the score toolbar, and on **Today** confirming it does not cover the rep card or
      the day-sheet header. Repeat 1-3 at Christian's real window size.
      Console must be error-free.
- [ ] Adversarial live QA: open and close the panel 20× in a row (the cpal stream must be
      torn down every time — confirm with `lsof`/Activity Monitor that no input device stays
      open while the panel is closed); start the calibration wizard and abandon it mid-step;
      save a deliberately non-monotonic curve and read the error out loud (it must name the
      step); switch profiles while the meter is running; run target mode with the mic muted.
- [ ] Write **`docs/superpowers/plans/2026-08-23-dynamics-steinway-acceptance.md`** — the
      manual, **not-automatable** acceptance step for Christian at the actual piano. Content:

  > **Live at-Steinway calibration acceptance — dynamics checker (v7 Plan B)**
  >
  > Sit at the Steinway with the app open and the Dynamics panel showing. This is a feel
  > check, not a test suite — nothing here can be automated, and nothing here writes to your
  > practice record.
  >
  > 1. **Room baseline.** With the panel open and hands off the keys, the readout should
  >    settle low and stay still. If it wanders more than a couple of dB with nobody playing,
  >    stop — the mic is picking up something (fan, fridge, window) and every number after
  >    this is measuring that instead of you.
  > 2. **Run the wizard, lid in its usual position.** Name the profile for what is actually
  >    true right now — "Steinway, living room, lid half". Play each step the way you would
  >    play it _in a piece_, four or five notes, not one poke.
  > 3. **Does the curve refuse when it should?** Deliberately play your `mf` softer than your
  >    `p`. The wizard must refuse and tell you _which_ step is wrong. If it accepts it, the
  >    validation is broken and the profile is worthless.
  > 4. **Play back down the ladder.** With the profile active, play `ff`, then `f`, `mf`, `p`,
  >    `pp` in turn and watch the needle. Each one should land in or near its own band. If the
  >    top two are indistinguishable, the mic is clipping — move it back and recalibrate.
  > 5. **Does it feel honest at `pp`?** The soft end is where a loudness meter is most likely
  >    to lie. Play your genuine `pp`. If the needle pins to the floor, the calibration floor
  >    is too high for this room.
  > 6. **Target mode, one real passage.** Pick a dynamic, play a passage you know, and see
  >    whether the landed markers match _your own judgement_ of what you just played. They are
  >    reporting decibels; you are judging the music. If they disagree with you, you are right
  >    and the meter needs recalibrating.
  > 7. **Crescendo range.** Set `p → f`, play a real crescendo, and check the markers walk
  >    upward across the zone rather than jumping.
  > 8. **Lid change.** Move the lid and replay `mf`. The number should visibly change — that
  >    is why profiles are per-piano-per-setup, and why recalibrating makes a _new_ profile
  >    instead of overwriting the old one.
  >
  > **Accept if:** the five bands are distinguishable by ear-to-eye agreement, the wizard
  > refuses a bad curve with a message that names the step, and target-mode markers agree with
  > your own sense of what you played. **Reject if** any of those fail — and say which, so the
  > fix is scoped.

- [ ] Whole-branch review (most capable model) over the Plan B diff + triage; ONE fix wave if
      findings; scoped re-review. Then fresh-context adversarial verification of the branch.
- [ ] **Final isolation audit** (paste the output into the merge commit body):
      `git diff --name-only main...v7/plan-b` — expect exactly: `src-tauri/src/dynamics/mod.rs`,
      `src-tauri/src/dynamics/weighting.rs`, `src-tauri/src/store/dynamics_profiles.rs`,
      `src-tauri/src/store/mod.rs`, `src-tauri/src/lib.rs`, `src/features/dock/{DynamicsPanel,
    CalibrationWizard}.tsx(+tests)`, `src/features/dock/{useDynamics,calibration,targetMode}.ts(+tests)`,
      `src/features/dock/dynamicsNoWrites.test.tsx`, `src/features/dock/dock.css`,
      `src/features/dock/dockDefaultLayout.test.ts`, `src/shell/Shell.tsx`,
      `src/devMock/tauriDevMock.ts`, `src/devMock/tauriDevMock.dynamics.test.ts`, plus the two
      docs. **Zero** files under `voice`/`stt`/`rep`/`sessions`/`metronome`/`audio`.
- [ ] UPDATE PROTOCOL: Changelog entry, Roadmap (Plan B done), Command Center thread,
      CodaKiller.md, Flaws (record the deliberate deltas: **no voice command for the meter in
      v7** — narrated-corpus gate avoidance; **the devMock event seam now fires callbacks** —
      shared-infrastructure change; **the dynamics panel's floor fallback shares the clock's
      landing slot**, resolved at runtime), NOTES.md facts, repo CLAUDE.md status. Tick LEDGER
      items 10, 11, 12, 13 (and 18, 20 as continuously enforced by Task B4's LAW check).
- [ ] Merge `v7/plan-b` → main (`--no-ff`). No version bump, no install — v7.0.0 ships once
      Plans A, B and C are all merged.
