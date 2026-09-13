# CodaKiller v3.0.0 — Version Record

> **Shipped: 2026-07-16 · tag `v3.0.0` · installed at `/Applications/CodaKiller.app`**  
> Complete v3 frontend rework, replacing v2.0.0. Every phase adversarially verified. This
> record is immutable after ship except factual corrections.

## What this version is

v3.0.0 is a ground-up frontend rework on top of the P7 practice-truth cutover: a pure
black-and-white dark shell, five focused workspaces (Today/Score/Brain/Ledger/Universe), a
real Score-mapping wizard replacing the old mapping dead-end, and the Universe reimagined as
a live d3-force galaxy. The Brain's long-standing offline bug is fixed and the Brain is now
online. All six of Christian's pieces ship pre-mapped. This is the release that finally
installs the P7 Practice OS work — v2.0.0 never installed; v3.0.0 supersedes it directly.

## What shipped

- **Pure monochrome shell.** Whole app is black-and-white dark, system fonts throughout;
  color is reserved for the Universe view, score marks/region colors, and green/red save
  receipts. Five tabs in a left rail — Today, Score, Brain, Ledger, Universe — with Settings
  and Metronome as quiet buttons at the rail bottom.
- **Today.** Session composer (editable proposed routine; Start is the only write), a
  retention queue, disclosure-organized layout. The Rep HUD (live set: measures, N-of-M,
  streak, focus clock, tempo; Clean is the solid primary button; Sloppy/Again + tools are text
  buttons) floats at shell level and follows across every tab, as do save receipts and voice
  surfaces (wake-cue confirm card unchanged: "Coda, ..." proposes verdict/tempo/undo/restart;
  nothing happens without Confirm).
- **Score.** PDF + region overlays + annotations as before, plus the new "Map this score"
  wizard — click each line's start, type its measure (~2 min per piece; partial maps fine).
  Drawing a box now shows its measures instantly (editable; corrections sharpen the map). The
  old "Mapping required" dead end is gone. All six of Christian's pieces ship pre-mapped: 288
  anchors total across Scherzo Op.31/Ekier, Étude Op.10/4/Cortot, Beethoven Op.90/Henle,
  Prokofiev Op.1/Jurgenson, Griffes Lake at Evening, and Barber Pas de Deux primo — injected
  into the live database through the validated `score_calibration_save` path, after a fresh
  backup.
- **Brain.** Chat transcript with one-glance answers and citation chips, per-piece memory, a
  persistent truthful status line (`● online — gemini` / `○ offline — <reason>`), and a
  Settings Test-connection button showing model+latency or the exact error. **The Brain is
  online** — the offline bug (invalid default model name, swallowed transient errors, an
  emptied Keychain key) is fixed and the key restored.
- **Ledger.** Ledger | Calendar | Pieces switch. Ledger is piece → block → attempts drill-in
  behind disclosures, with inline-editable set titles; attempts stay append-only immutable
  (corrections/voids keep the original visible); the anomaly panel is preserved. Calendar is
  the week view, recovery review, capacity. Pieces is the piece browser + intake form + goals
  editor + references.
- **Universe.** A live, draggable d3-force galaxy: pieces are suns, sections are planets,
  sessions are satellites (older ones cluster; click to expand). Drag/pan/zoom, hover lights a
  node's neighborhood, click opens a detail panel with jumps to Ledger/score. Anti-gaming
  growth rules are unchanged. Dragged positions last for the app session; the sky's base
  layout is stable across separate opens.

## Verification

- **Every phase (0 through 7) independently adversarially verified** in source before this
  install: Brain online fix, design system/shell/Settings, Brain workspace, Score wizard +
  premap, Today workspace + perf audit, Ledger + Calendar, Universe force graph — each
  returned CONFIRMED (several 7/7) with only benign/documented caveats, all since fixed or
  explicitly logged as open.
- **Parity audit:** every row of the original P0 parity inventory checked off or explicitly
  approved as a deliberate removal (e.g. the dead "Mapping required" button, the old v2
  Shell.tsx).
- **Injection rehearsal:** the 288-anchor pre-map was rehearsed on a disposable database copy
  through the validated save path before touching Christian's live database; a fresh backup
  was taken immediately before the live injection.
- **Live-DB integrity:** post-injection, the live database passed integrity/quick checks with
  zero foreign-key violations; schema and all pre-existing rows preserved.
- **Final gates:** npm **706 passed / 0 failed / 2 todo**; cargo **518 passed / 0 failed**;
  `tsc` clean.
- **Final commits (main):** `56dada3` (style), `c53230a` (pieces-gap close), `b2e751f`
  (version bump); tagged `v3.0.0`.
- Installed and verified running at `/Applications/CodaKiller.app`.

## Honest gaps

- **Voice-over-Steinway acceptance is still unproven.** All of this passed automated/native
  gates; only a real session with Christian at the piano can prove voice recognition, the
  wake-cue confirm-card feel, and the metronome against the live instrument.
- **Auto-OMR (S2) is not done.** The six pieces are pre-mapped and the wizard is
  user-driven — this is not automatic score recognition.
- **Natural-language voice section-start (V2) is not built.** Voice still opens blocks via
  command grammar, not free conversational phrasing.
- **Next-day retention FLOW (the rest of P6) is not built** beyond the existing retention
  queue.
- **Durable Universe layout persistence is deferred.** Dragged node positions last only for
  the app session; a small new backend command would be needed for cross-session
  persistence.
- **B25 (history-at-scale reflow) is still open** — out of this release's scope.
- **The repo is still local-only.** `gh auth login` → push remains the #1 infrastructure
  risk.

## Data and artifacts

- Fresh pre-install backup: `(C) pre-v3.0.0-install-2026-07-16.db`, SHA prefix `3d18c0ba`, in
  the app-data backups directory.
- Rollbacks available: `~/CodaKiller-v2.0.0-rollback.app`, `~/CodaKiller-v1.3.0-rollback.app`.

## ⟶ Next steps

1. **Christian runs the complete v3.0.0 at-piano acceptance:** voice "done" over the
   Steinway, the wizard's real feel on an unmapped edition, and a judgment call on the
   Universe's drag/click/detail-panel experience.
2. Create and push the private off-disk git remote (`gh auth login` first).
3. Build the retention flow (rest of P6) beyond the current queue.
4. Build the V2 natural-language voice section-start slice, with Christian's at-piano
   feedback as the acceptance fixture.

## Addendum — same-night patch v3.0.1

Same night, Christian's first hands-on feedback on v3.0.0 found the Score view — which
rendered all pages of a PDF as one continuous strip — was laggy on a 25-page score, and the
tricky-sections panel wasn't independently scrolled (it pinned/scrolled with the strip). He
also said he liked the release a lot better overall.

Fixed same night in commit `92cfdb7` / tag `v3.0.1` / release `612b1ec`: Score view was
converted to a true paged reader — one page at a time, fit to the window, navigable via ‹ ›
buttons, a typed page number, or PageUp/PageDown/←/→; only the current page ±1 ever render
(never more than 3 canvases); zoomed pages scroll within their own pane; and the
tricky-sections panel now scrolls independently of the score. Suite **706 passed / 0
failed**; `tsc` clean.
