# CodaKiller v6.0 Plan C — Score Intelligence (S1 Measure Mapping · S2 Sub-Sections)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in cloud-vision measure mapping with deterministic reconciliation and a human
review/Apply gate — then selection boxes that snap to bars, and sub-sections nested inside
regions. The v6 unlock.

**Architecture:** Rust owns the vision transport (extending the existing provider plumbing with
image content blocks), the strict output validation, and the deterministic reconciliation
against MusicXML totals + calibration anchors; nothing reaches `measure_map` (table shipped
empty in v14) until the user clicks Apply. The overlay/review UI follows the PencilOverlay
normalized-coords→SVG pattern. Sub-sections ride the dormant `target_meta.parent_region_id`
(v8). Vector pages that the Rust fast path refuses are rasterized browser-side and passed as
bytes (the firstPageCache browser-encodes/Rust-stores idiom).

**Tech Stack:** Rust/rusqlite + reqwest (existing) · React 19 + TS + vitest · no new npm/cargo
deps. Vision calls happen ONLY on explicit user action (the Map measures button / re-scan) —
never automatically.

## Global Constraints

- Deterministic hot loop untouched; the LLM never enters rep/metronome paths. Vision is a
  one-shot, user-triggered, confirm-gated tool — the same posture as the Brain.
- Nothing is stored as mapping truth until Apply. Cancel discards everything.
- `measure_map` rows are keyed (piece_id, edition_fingerprint, page) — fingerprint change ⇒
  stale map, surfaced ALWAYS (never gated behind a mode; Flaws B48 lesson).
- Practice truth append-only; no changes to rep/rep_block writes. Region writes limited to:
  optional parent linkage (target_meta) + measure-prefilled creation.
- Lock discipline (NOTES.md law): never hold rep.active across sessions calls; order
  lifecycle < current < pause_hook < active < store.conn. New store code takes conn only.
- API keys via the existing `resolve_secret` Keychain path; NEVER logged, NEVER in test
  fixtures; provider tests use the existing Transport-mock seam — no network in cargo tests.
- devMock: full offline coverage with canned vision outputs so the whole flow QAs at 720×520.
- Paper tokens only; co-located tests; TDD; commit per task on branch `v6/plan-c`.
- No migration (v14 already has the table). The rehearsal harness stays untouched (B58).

---

### Task C1: `measure_map` store CRUD + typed systems model

**Files:**

- Create: `src-tauri/src/store/measure_map.rs` (types + validation + queries; `mod` wire-up)
- Modify: `src-tauri/src/lib.rs` (commands)
- Test: alongside

**Interfaces (produces — contract):**

- Typed model (serde, versioned): `MeasureMapPage { version: 1, systems: Vec<MapSystem> }`,
  `MapSystem { y_top: f64, y_bottom: f64, x_left: f64, x_right: f64, bars: Vec<MapBar> }`,
  `MapBar { x_right: f64, number: u32, confidence: Option<f64>, source: MapBarSource }`,
  `MapBarSource = "model" | "user" | "interpolated"` — all coords normalized 0–1, top-left
  origin (the pencil-mark convention). Bar i spans (previous bar's x_right → its x_right)
  within its system; numbers strictly increasing across systems top-to-bottom, pages in order.
- Commands: `measure_map_get(piece_id, edition_id, edition_fingerprint) ->
Vec<{page: u32, map: MeasureMapPage}>` (empty = unmapped);
  `measure_map_apply(piece_id, edition_id, edition_fingerprint, pages: Vec<{page, map}>) -> u32`
  (validates every page, upserts atomically in ONE transaction — partial maps legal, replaces
  existing rows for the same fingerprint+page set, returns pages written);
  `measure_map_clear(piece_id, edition_fingerprint) -> u32`.
- Validation (reject with clear errors): coords in [0,1], y_top<y_bottom, x_left<x_right,
  bars non-empty per system, x_right strictly increasing within a system, numbers strictly
  increasing page-over-page (the apply payload is validated as a WHOLE — cross-page continuity
  enforced at the boundary), serialized size ≤ the column CHECK (262144).

- [ ] Failing Rust tests: round-trip; whole-payload continuity rejection (page 2 restarting at
      1); atomic apply (one invalid page ⇒ zero rows written); replace-on-reapply; clear; oversized
      rejection; stale fingerprint coexistence (old fingerprint rows remain until cleared).
- [ ] Implement; scoped cargo tests + `cargo clippy --all-targets -- -D warnings`; commit
      `feat(map): measure_map store CRUD with typed, whole-payload-validated systems model`.

### Task C2: Vision transport + per-page scan command

**Files:**

- Create: `src-tauri/src/score/measure_scan.rs`
- Modify: `src-tauri/src/brain/provider.rs` (image-capable request builders — additive; text
  paths byte-identical), `src-tauri/src/lib.rs`
- Test: alongside (Transport mock — no network)

**Interfaces:**

- Provider extension: `claude_vision_request(system, prompt, jpeg: &[u8])` (content array:
  image block base64 + text block; same model/headers/timeout) and
  `gemini_vision_request(...)` (inline_data part). Chain: Claude primary, Gemini fallback —
  the Brain's existing order and key resolution.
- Vision output contract (the prompt demands STRICT JSON; parser validates, one retry on
  invalid, then a clear error): `ScanPageOutput { systems: Vec<ScanSystem> }`,
  `ScanSystem { y_top, y_bottom, x_left, x_right, barline_xs: Vec<f64>,
printed_numbers: Vec<{ number: u32, x: f64, y: f64, confidence: f64 }>, staves: u32 }` —
  normalized 0–1. The prompt (a Rust const, versioned comment) includes grand-staff,
  multi-instrument, and single-line system examples and instructs: count bars per system,
  report barline x positions, report ONLY printed measure numbers actually visible, never
  infer them.
- Command `measure_scan_page(piece_id, edition_id, edition_fingerprint, page,
page_jpeg: Option<Vec<u8>>) -> ScanPageOutput`: when `page_jpeg` is None, render via the
  existing `render_page_image` fast path (2048 bucket); when the fast path refuses (vector
  page), return a typed `needs_client_raster` error so the frontend re-calls with
  canvas-encoded JPEG bytes (the firstPageCache idiom). Never cached — scans are explicit.

- [ ] Failing tests (mock transport): request shape for both providers (image block present,
      key header, text prompt); strict-JSON parse + one-retry-then-error; refusal passthrough for
      vector pages; oversized page_jpeg rejected (cap 8 MB).
- [ ] Implement; scoped cargo tests + clippy; commit
      `feat(map): vision transport (Claude/Gemini image requests) + measure_scan_page`.

### Task C3: Deterministic reconciliation (pure Rust)

**Files:**

- Create: `src-tauri/src/score/measure_reconcile.rs`
- Test: alongside (fixture ScanPageOutputs — clean, noisy, hallucinated)

**Interfaces:**

- `reconcile(pages: Vec<(u32, ScanPageOutput)>, xml: Option<XmlTotals>,
anchors: Vec<CalibrationAnchor>) -> ReconcileResult` where
  `XmlTotals { max_measure: u32, has_pickup: bool }` (from the existing `xml_measure_facts`),
  `CalibrationAnchor { page: u32, measure: u32 }` (from `score_calibration_get` points), and
  `ReconcileResult { pages: Vec<{page, map: MeasureMapPage}>, conflicts: Vec<MapConflict>,
total_bars: u32 }`.
- Numbering: bars numbered sequentially from 1 (or 0 if `has_pickup` — surfaced, not guessed:
  when has_pickup, emit conflict kind `pickup_ambiguity` unless a printed number pins the
  offset); printed numbers act as anchors — between two anchors the count must match the
  barline count, else conflict `continuity_break { page, system, expected, found }`; total vs
  `max_measure` mismatch ⇒ `total_mismatch { mapped, xml }`; calibration anchors that
  disagree ⇒ `anchor_disagreement { page, anchor_measure, mapped_measure }`; model confidence
  < 0.5 on a printed number used as an anchor ⇒ `low_confidence_anchor`. Repeats/voltas don't
  alter numbering (print order); da-capo out of scope.
- Pure function, no I/O; the command `measure_reconcile(piece_id, edition_id,
edition_fingerprint, pages_json) -> ReconcileResult` wires xml/anchors lookups around it.

- [ ] Failing tests (exact fixtures): clean 3-page scan reconciles with zero conflicts and
      correct numbering; printed-number anchor pulls a miscounted system into conflict;
      pickup handling both with and without a pinning printed number; total mismatch; anchor
      disagreement; a hallucinated extra system (y-band overlapping another) flagged.
- [ ] Implement; scoped cargo tests + clippy; commit
      `feat(map): deterministic measure reconciliation with typed conflicts`.

### Task C4: Mapping UI — scan, review overlay, Apply gate

**Files:**

- Create: `src/features/score/mapping/MeasureMapPanel.tsx` (+test), `measureMap.ts` (API +
  mirrored types), `MeasureOverlay.tsx` (+test), `measureMapping.css`
- Modify: `src/features/score/ScoreWorkspace.tsx` (small **Map measures** toolbar button +
  overlay mount), `src/devMock/tauriDevMock.ts`
- Test: co-located + devMock

**Interfaces:**

- Flow: button → panel (explains cost/network honestly, lists pages) → Scan runs
  `measure_scan_page` per page sequentially with per-page progress + cancel between pages
  (vector pages: render the current PDF.js canvas to JPEG and re-call — the
  `needs_client_raster` path) → `measure_reconcile` → REVIEW state: `MeasureOverlay` renders
  tiny grey numbers at each bar's x_right/system baseline (normalized→SVG viewBox, the
  PencilOverlay pattern; toggleable), conflicts listed + highlighted amber on-page → user
  edits: click a bar number → set number (renumbers forward through the system chain,
  source:"user" pins it as an anchor, re-runs reconcile locally) or drag a barline x; Apply →
  `measure_map_apply`; Cancel discards. Review state lives in memory only; navigating away
  warns.
- After Apply: overlay renders from `measure_map_get` (cached per fingerprint in a module
  store, bannerStore pattern); fingerprint change ⇒ a visible "map is stale — re-scan"
  notice wherever the overlay would render (NOT mode-gated).
- devMock: canned ScanPageOutputs for the mock piece (one clean page, one with a
  continuity_break conflict) + full command coverage so the entire flow is offline-QA-able.

- [ ] Failing tests: button visibility (per piece with an edition); scan progress + cancel
      between pages; conflict list renders + amber highlight; user renumber re-reconciles and
      clears the conflict; Apply sends the exact reviewed payload (spy, byte-shape) and ONLY on
      click; Cancel sends nothing; stale-notice on fingerprint change; overlay toggle; 720×520.
- [ ] Run score/devMock suites + `npx tsc --noEmit`; commit
      `feat(map): scan→review→apply mapping flow with on-page overlay`.

### Task C5: Snap selection + sub-sections

**Files:**

- Modify: `src/features/score/` selection surface (drag on a mapped page snaps to bars),
  `src/features/pieces/RegionEditor.tsx` (measures pre-filled, editable),
  `src-tauri/src/lib.rs` + `src-tauri/src/store/crud.rs` (region_create gains optional
  `parent_region_id`, written to `target_meta`; `region_list` joins
  `target_meta.parent_region_id` into its rows), `src/devMock/tauriDevMock.ts`
- Test: co-located both sides

**Interfaces:**

- Snap: on a page with an applied map, a drag selection resolves to the bar range its rect
  intersects (system-aware: multi-system drags span the systems' bars); the region-create
  flow opens with m_start/m_end PRE-FILLED from the snap (user can still edit — typing is
  the unmapped fallback and stays intact).
- Sub-sections: `region_create` accepts `parent_region_id: Option<i64>` — Rust enforces ONE
  nesting level (parent must itself have no parent) + same-piece (trigger already exists);
  `region_list` rows gain `parent_region_id: number | null`. Score view: child regions render
  only while their parent is selected; parent rows show a count badge ("3 sub-sections");
  child creation = drag inside the parent's page area while the parent is selected. Child
  below-bar labels stay free text (the map knows bars, not beats — honest). One-gesture set
  start on a child defaults `required_success = 3`; **Come back later** routes through the
  existing retention queue exactly as the spec's S2 describes (reuse the existing queue
  commands — no new engine). Parent delete with children asks: cascade or promote (existing
  confirm idiom).

- [ ] Failing tests: snap resolves exact bar ranges (fixture map; incl. a multi-system drag);
      unmapped page falls back to typed measures; Rust one-level nesting rejection + same-piece
      trigger still bites; region_list carries parent ids; children hidden unless parent
      selected; badge; child set default 3; cascade/promote both paths.
- [ ] Run affected suites + tsc + scoped cargo + clippy; commit
      `feat(regions): map-snapped selection + one-level sub-sections via target_meta`.

### Task C6: Real-scan acceptance — Scherzo (+ one multi-staff edition)

**This task uses the REAL vision API (Keychain key, network) from the dev machine — the one
task that does. Zero writes to the live DB; work against the vault PDFs read-only.**

- [ ] Run the full pipeline dev-side on `Pieces/Chopin - Scherzo No.2 Op.31/score/
ekierscherzochopin2.pdf` (measure-accurate MusicXML present): scan all pages, reconcile,
      record per-page results. ACCEPTANCE: after review-resolving any conflicts, the map's numbers
      match the printed numbers on sampled pages (min 5 pages incl. first/last) AND the vault
      landmark checks hold (m.67 LH C♭ / m.95 LH F♮ pages locate correctly via the map) AND total
      reconciles with MusicXML max_measure (pickup rule applied).
- [ ] Multi-staff path: run one system-detection scan over 3 sample pages of the Cortot scan
      set (`Cortot Scherzos 1-2 .../page-NN.jpg` — image inputs exercise the client-raster arm)
      and record system/bar counts vs a hand count. Target: system count exact; bar count within
      1 per page, misses documented honestly.
- [ ] Write the evidence (numbers, mismatches, screenshots of the overlay on real pages, API
      cost/latency actually observed) to `docs/qa/plan-c-scherzo-acceptance.md` + commit. If
      acceptance FAILS: report BLOCKED with the evidence — do not tune prompts blind; the
      controller decides the iteration.

### Task C7: Gates, live QA, review, protocol, merge

- [ ] Full gates (vitest 0 fail, tsc, cargo, clippy, build).
- [ ] Fresh-context live QA at 720×520 in dev:mock: full mapping flow offline (scan progress →
      conflicts → renumber → Apply → overlay + snap selection → sub-section create/select/badge →
      child set start), stale-notice, cancel paths, console clean.
- [ ] Whole-branch review (most capable model) + ledger triage; ONE fix wave; scoped re-review.
- [ ] UPDATE PROTOCOL (Changelog, Roadmap, Flaws — record honest limits: vision accuracy is
      edition-dependent; beats not mapped; da-capo numbering out of scope; per-scan API cost —
      CodaKiller.md, Command Center, NOTES.md, repo CLAUDE.md). How To Use still untouched.
- [ ] Merge `v6/plan-c` → main (--no-ff). No version bump, no install.
