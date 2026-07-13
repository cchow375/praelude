# CodaKiller P4 — Real-PDF Score Workspace

> **Status:** release gate · **Target:** v0.4.0 · **Branch:** `p4-score`
> **Goal:** make the chosen real score edition the practice hero surface, lightly mapped to the
> existing Region → block → rep graph without pretending MusicXML knows PDF geometry.

## Locked decisions

| Decision | Choice |
|---|---|
| Visual source | The real PDF edition, rendered with bundled PDF.js; never re-engrave with OSMD |
| File access | Rust validates the chosen in-piece edition and returns raw bytes over Tauri IPC; the WebView receives no filesystem scope |
| Large scores | Continuous scroll with lazy page canvases; 85-page and 12 MB files are hard test fixtures |
| Mapping | Drag a normalized rectangle on a page for a selected Region; anchor includes the edition identity |
| Editions | Discover every PDF in the piece folder; persist a preferred edition that rescans cannot overwrite |
| Musical structure | Region measure ranges remain canonical; PDF rectangles are navigation metadata only |
| Voice | Deterministic “go to measure/page N”; no LLM in navigation |

## Execution checklist

- [x] **P4.1 — Schema v4 / edition persistence.** Add crash-safe v3→v4 migration with
  `piece.preferred_pdf_path`; prove v3 rows, regions, blocks, reps, and goals survive.
- [x] **P4.2 — Secure score discovery and bytes.** Enumerate PDFs under the selected piece only,
  validate selection cannot escape the piece folder, persist it, and return the chosen PDF as a
  raw binary IPC response (never JSON/base64 and never a broad WebView filesystem scope).
- [x] **P4.3 — Region anchor write path.** Extend `RegionPatch` with nullable `pdf_anchor`; validate
  normalized edition/fingerprint + `{page,x,y,w,h}` geometry; regression-test save/clear/relaunch.
- [x] **P4.4 — PDF.js rendering core.** Bundle PDF.js + worker locally; load the cached asset;
  render high-DPI canvases with cancellable tasks, bounded concurrency, and lazy intersection.
- [x] **P4.5 — Score navigation.** Continuous vertical scroll, page indicator, previous/next,
  page jump, fit-width/manual zoom, current-page tracking, and measure/Region jump.
- [x] **P4.6 — Light Region mapping.** Mapping mode selects a Region then drag-maps a page box;
  visible colored overlays are clickable, remappable, and clearable; anchors from another edition
  are shown as needing remap rather than silently misplaced.
- [x] **P4.7 — Practice graph integration.** Clicking an anchor opens that Region's summary/history
  and a prefilled block form; an active block highlights every overlapping mapped Region.
- [x] **P4.8 — Voice navigation.** Route deterministic “go to measure N” / “go to page N” intents,
  emit `score://navigate`, and scroll the score without speaking over practice.
- [x] **P4.9 — Empty/error/edition UX.** PDF-less pieces degrade to tracking; missing/moved files
  explain how to scan/select; edition picker uses readable filenames; no raw paths dominate UI.
- [x] **P4.10 — Real-score gate.** Real vault discovery covered seven Scherzo editions (up to
  20.3 MB / 28 pages) and the 85-page Cortot volume; lazy-canvas eviction is regression-tested;
  the complete map/save/practice interaction passed the browser visual harness on this 8 GB M2.
- [x] **P4.11 — Whole-diff review.** Resolve all high/medium findings; frontend/Rust suites,
  strict clippy, production build, dark/light visual pass.
- [ ] **P4.12 — Ship v0.4.0.** Migrate the real DB, install one app, clean generated duplicate,
  update the full vault protocol, commit, tag, and fast-forward `main`.

## Verification invariants

- A vault rescan never resets the user's chosen edition.
- Mapping one Region cannot mutate its measure range, blocks, reps, or human-authored files.
- Coordinates are normalized and remain correct across zoom/HiDPI changes.
- Only pages near the viewport own live canvas bitmaps.
- Switching PDFs never displays old-edition anchors at false coordinates.
- A corrupt/missing PDF cannot crash the practice tracker.

## Next action

Implement P4.1–P4.3 test-first, then spike the real Scherzo PDF through the secured raw-byte path
before building the full scrolling surface.
