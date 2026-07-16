# CodaKiller Frontend Rework — Design Spec

**Date:** 2026-07-16 · **Status:** approved by Christian (section-by-section, this session)
**Target release:** v3.0.0 (full frontend replacement; backend unchanged)
**Baseline:** installed v2.0.0 dogfood build (HEAD `ce8dd35`), live DB schema 7→10 migration pending Christian's first launch.

## Quick nav

1. [Why](#1-why--the-five-complaints)
2. [Decisions already made](#2-decisions-made-with-christian)
3. [Architecture & phasing](#3-architecture--phasing)
4. [Slice A — Brain online fix + truthful status](#4-slice-a--brain)
5. [Slice B — Score mapping wizard + pre-mapped scores](#5-slice-b--score-mapping)
6. [Slice C — Theme & de-clutter](#6-slice-c--theme--de-clutter)
7. [Slice D — Universe force graph](#7-slice-d--universe)
8. [Verification, packaging, docs](#8-verification-packaging-docs)
9. [Non-goals & risks](#9-non-goals--risks)
10. [Acceptance criteria](#10-acceptance-criteria)

---

## 1. Why — the five complaints

From Christian's 2026-07-16 feedback on the installed v2.0.0 build (after a long Claude Code + Codex session left the UI worse):

| #   | Complaint                                                               | Root cause found                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "Mapping required" on score boxes, with no way to map                   | `TargetDraftEditor.tsx:493` renders a dead-end disabled button; calibration machinery exists in Rust (`score/mod.rs`, `store/score_atlas.rs`) but **no UI can create calibration anchors** — chicken-and-egg                                           |
| 2   | Brain always "offline" despite a Gemini key                             | Key IS in Keychain (`codakiller`/`gemini`, verified this session). Provider chain swallows transport/HTTP errors (`brain/provider.rs:162–171`, `eprintln!` only) and falls back silently; packaged-app Keychain read and stale model name are suspects |
| 3   | Theme: brown/terracotta + "scholarly" serif fonts, looks like a website | `tokens.css` implements the July-15 pasted design prompt (New York/Baskerville serifs, terracotta `#9f4937`, Cloud Dancer off-white). Christian's newer note — "mainly just black and white, color only for the universe" — supersedes it              |
| 4   | More elements than before, outlined buttons, huge empty boxes/circles   | Accumulated additive UI; no de-clutter discipline                                                                                                                                                                                                      |
| 5   | Universe is a static slideshow                                          | Pan/zoom exists (`UniverseWorkspace.tsx:258–304`) but no node drag, no physics, no click-to-detail; staggered-grid layout (`graphLayout.ts`), no graph library                                                                                         |

## 2. Decisions made with Christian

- **Mapping UX:** one-time **calibrate wizard** per piece (click line starts, type measure numbers); Claude pre-maps his current pieces as part of delivery.
- **Theme base:** **dark-first** pure monochrome; light mode dropped (or trivial afterthought toggle only if free).
- **Universe:** **full hierarchy force graph** — pieces (suns) → sections/targets (planets) → sessions (satellites), click → detail side panel.
- **Approach:** **frontend rewrite** on the frozen Rust backend (Christian's explicit choice over the surgical-slices recommendation), executed workspace-by-workspace with verification gates so it cannot become a big-bang failure.

## 3. Architecture & phasing

**Frozen (zero changes except the Brain bug fix):** all of `src-tauri/` — schema 10, PracticeContract RepEngine, receipts/idempotency, voice lanes, intent router, universe signal computation, every IPC command name and payload shape. The rewrite consumes the existing IPC contract as-is.

**New frontend:** fresh React 19 tree replacing `src/`. Dependencies: React, pdfjs-dist (existing), **+ d3-force** (physics math only). No Tailwind, no component libraries.

**Design system first:** one `tokens.css` (~15 custom properties) + a minimal component kit — `Button` (solid | text), `Panel`, `Disclosure`, `Dialog`, `Receipt` — and nothing else. Every workspace builds from these.

**Build order (Christian's priority):**

| Phase | Deliverable                                                                                                                           | Gate                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 0     | Feature-parity inventory of the current UI (receipts, confirm cards, HUD, composer, anomaly panel, annotations, tutorials, settings…) | inventory reviewed against running app |
| 1     | Brain backend bug fix (can ship independently, even before the rewrite lands)                                                         | packaged-app online answer proven      |
| 2     | New shell + design system + Settings                                                                                                  | browser QA (`dev:mock`)                |
| 3     | Brain workspace (status line, test connection, chat)                                                                                  | QA + adversarial verify                |
| 4     | Score/Atlas workspace incl. mapping wizard                                                                                            | QA + verify + scores pre-mapped        |
| 5     | Today workspace (HUD, composer, receipts)                                                                                             | QA + verify                            |
| 6     | Ledger workspace (incl. disclosure-first density)                                                                                     | QA + verify                            |
| 7     | Universe workspace (force graph)                                                                                                      | QA + verify                            |
| 8     | Parity audit vs Phase-0 inventory, packaged build, install                                                                            | at-piano acceptance = Christian        |

Old frontend remains in git history until Phase 8 passes; any phase is a rollback point. An installable build can be produced after any completed phase.

**De-clutter law (global):** one primary action per screen; secondary content behind disclosures; element count per screen must go _down_ vs v2.0.0.

## 4. Slice A — Brain

**Diagnosis (systematic-debugging, on the PACKAGED app, not dev):** candidates in order — (1) Keychain read failure under the ad-hoc-signed .app (`keys.rs` shells out to `security`), (2) stale/invalid Gemini model name rejected by the API, (3) "auto" preference trying Claude first with no Claude key and mishandling the failure, (4) settings default pinning preference to "offline". Evidence, not guesses: capture the swallowed error strings.

**Fix contract:**

- Key present + network up ⇒ online answer. Gemini is the primary provider (it's the key he has); Claude used only if that key ever appears.
- **Truthful status, always visible** in the Brain workspace: `● online — gemini` / `○ offline — <exact reason>` (key unreadable · no network · HTTP status + message · provider disabled in settings).
- **Settings → "Test connection"**: real round-trip; success shows model + latency, failure shows the exact error. This is also the user-visible proof of the fix.
- Errors are never swallowed silently again: every provider failure lands in the status reason and a log the UI can show.

**Unchanged:** brain stays out of the hot loop; confirm-gated actions; one-glance concise answers; per-piece memory (`brain_thread`/`brain_turn`).

## 5. Slice B — Score mapping

**Entry points:** a visible **"Map this score"** action on every score; auto-offered the first time a box is drawn on an unmapped page. The current dead-end button becomes the door into the wizard.

**Wizard flow:** large PDF page → user clicks the start of each system (line) → types its measure number → next page. Skippable pages; partial maps are valid and useful. ~2 min per piece.

**Resolution model:** anchors = (piece, PDF edition, page, y-geometry, measure number) persisted via the existing Rust calibration tables. Within a line, measures interpolate by x-geometry. Where a MusicXML exists, typed numbers are validated against it (warn on nonexistent measures; flag pickup-bar ±1 shifts) — **XML is not required to map**.

**After mapping:** any drawn box instantly resolves to `m.X–Y`, editable; user corrections become additional anchors (self-sharpening). Existing saved boxes resolve retroactively. Confidence thresholds stay, but "Mapping required" as a dead end ceases to exist.

**Pre-mapped delivery:** Claude runs the wizard's data path for the pieces in the app (Scherzo Op.31/Ekier, Étude Op.10 No.4, Beethoven Op.90, others with PDFs) by reading the PDFs page-by-page, then verifies anchors against MusicXML landmarks (e.g. Scherzo m.67 LH C♭, m.95 F♮). Pieces resolve boxes on day one.

## 6. Slice C — Theme & de-clutter

**Palette:** near-black base (≈`#0e0e10`), white→gray ink scale, 1px hairlines. **No hue in the chrome.** Color exists only in: universe/planets, score marks, semantic signals (error red, success green). Primary buttons = solid white-on-black inversion; secondary = text buttons. **No outlined buttons anywhere.**

**Type:** `system-ui` (SF Pro) only; serif stacks deleted. Mono (SF Mono/Menlo) strictly for numerals: tempo, measure ranges, rep counts, streaks. Two weights, three sizes — the whole system.

**De-clutter rules (enforced per workspace at port time):**

- No decorative circles/rings/empty stat frames — important numbers are simply shown, dense and legible.
- One primary action per screen; everything else behind `Disclosure`.
- Data (streaks, tempo paths, receipts) IS the interface; whitespace serves reading, never fills space.

**Motion ("more dynamic"):** fast micro-responses on every touch — press states, 120–180ms eased panel slides, receipts that visibly land; springy physics in the universe. No ambient looping animation.

## 7. Slice D — Universe

**Simulation:** d3-force over real earned data. Pieces = suns (size = focused time). Sections/targets = planets orbiting their sun (size/brightness = honest mastery state). Sessions = small satellites on the section they served. Faint link lines. All existing anti-gaming/earned-growth signal logic unchanged (backend already computes it).

**Interactions (Obsidian-graph mechanics):**

- Drag any node → spring physics, neighborhood reacts, settles on release; dragged positions persist per piece.
- Pan + zoom (deep into a session, out to the whole sky). Hover highlights the node's connections, dims the rest.
- Click → side detail panel: section = reps/cleans/best streak/tempo path/last practiced + "Open in Ledger" / "Open on score"; session = that day's story; piece = the whole arc.

**Color:** the app's only colorful place — stable per-piece palettes glowing on black.

**Scale guardrail (8GB):** SVG + d3-force is fine at hundreds of nodes; older sessions aggregate into expandable cluster nodes ("June · 14 sessions"). Simulation sleeps when settled (no idle CPU burn).

## 8. Verification, packaging, docs

- Every phase: browser QA on `dev:mock` + fresh-context adversarial verifier before the next phase starts.
- Phase 8: parity audit against the Phase-0 inventory; packaged `.app` build; TCC re-grant note (mic + Speech after rebuild); install with rollback assets preserved.
- Vault UPDATE PROTOCOL after every phase: `(C) Changelog`, `CodaKiller.md`, `(C) Roadmap`, `(C) Flaws` (B10/B25/etc. moved to Resolved only with fixing commits), `(C) Command Center`, `(C) How To Use` only when the installed app changes; repo `NOTES.md`; commit (tag on ship).
- Watch for the rogue claude-flow daemon re-dirtying the tree (NOTES.md); tree must be clean at every gate.

## 9. Non-goals & risks

**Non-goals (this release):** voice-over-Steinway tuning (needs Christian at the piano), natural-language "start a section by voice" (V2), next-day retention flow (P6), auto-OMR PDF reading (possible later layer on top of wizard anchors), off-disk git remote (still blocked on `gh auth login` — standing #1 risk).

**Risks:**

- Full rewrite scope creep → mitigated by the parity inventory + per-phase gates + rollback points.
- Brain root cause could be environmental (network/firewall) rather than code → the truthful-status work makes even that case visible and actionable.
- Pre-mapping accuracy on dense engravings → anchors verified against MusicXML landmarks; Christian's in-app corrections self-sharpen.
- The v7→v10 live migration still hasn't happened (his DB is schema 7) — rework lands on top of schema 10; the rehearsed migration path is unchanged by this design.

## 10. Acceptance criteria

1. Drawing a box on any of his mapped scores shows correct measure numbers instantly, with no typing. The wizard is reachable and completable for a brand-new PDF.
2. Brain answers online via Gemini in the packaged app; status line + Test connection show truthful state; no silent fallback exists.
3. No serif fonts, no terracotta/brown, no outlined buttons, no decorative empty boxes/circles anywhere; chrome is pure black-and-white; color only in universe/score/semantic signals.
4. Universe: nodes drag with physics, pan/zoom/hover-highlight work, clicking opens the correct detail panel with real ledger data, positions persist, no idle CPU burn.
5. Every v2.0.0 capability in the Phase-0 inventory exists in the new frontend (or its removal was explicitly approved).
6. All Rust tests still pass; frontend tests pass; packaged app installs and runs on his machine.
