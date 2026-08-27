# CodaKiller v7.0.0 Plan A — Galaxy & Ritual (A1 living galaxy · A2 day streak · A3 photo calendar · A4 completion animations)

> **Status:** Historical. This plan shipped in v7.0.0, but the galaxy itself failed Christian's
> motivation/progress test and was intentionally removed in v8.1.0. Current Universe truth is the
> canonical-evidence XP/level/badge/cadence dashboard in the Aug 8 rev-3 spec.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Universe view stops being a still index and becomes an earned-only living
galaxy; a day streak derived from focused minutes appears in Today and Calendar; day close
offers a webcam/file photo that renders Liftoff-style in the Calendar week; and three
completion moments (set complete, mastery landing, day close) get a short CSS flourish.
Every one of those visuals is a pure function of already-recorded practice evidence.

**Architecture:** One new pure frontend module (`galaxy.ts`) turns the existing
`universe_snapshot` payload into deterministic SVG geometry, which `UniverseWorkspace`
renders as static SVG animated only by CSS `@keyframes`; one new Rust read model
(`store/streaks.rs` → `streak_summary`) counts consecutive local days over the configured
focused-minute threshold; four new Rust commands (`day_photo_save/_thumbs/_read/_delete`)
write JPEGs under `app_data_dir()/day-photos/` and one row per day into the schema-v15
`day_photo` table; one new frontend module (`ritual/completionFx.tsx`) owns all three
animation moments. **No new schema in this plan** — Plan A consumes schema v15 (the
`day_photo` table) as a merged prerequisite from the v7 Foundations plan; if `day_photo`
is not present when Task 5 starts, STOP and land Foundations first.
Spec: `docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md`
(Part 2, "Plan A — Galaxy & Ritual").
Requirements ledger: `.workflow/LEDGER.md` items 5, 6, 7, 8 (features) and 19, 22, 25
(binding constraints).

**Tech Stack:** React 19 + TS + vitest (jsdom) · Rust/rusqlite + cargo test · pure SVG +
CSS `@keyframes` for all motion (no d3, no rAF, no physics, no animation library) ·
`sha2 = "0.10"` declared direct in `src-tauri/Cargo.toml` (already at 0.10.9 in
`Cargo.lock` transitively, so this adds zero new compilation — same rationale as the
existing `base64`/`reqwest` declarations) · `base64 0.22` (already direct) · browser
`getUserMedia` + `<canvas>` for capture/thumbnailing · no other new dependencies.

## Global Constraints

- **Earned-only law (LEDGER 19).** Nothing in the galaxy/streak/photo layer may be
  granted, bought, backfilled or faked. Every rendered star, orbit, glow, streak number
  and thumbnail must trace back to a snapshot field or a database row. No points, no
  coins, no levels, no social. Each task below carries at least one explicit
  "no evidence → no visual" assertion.
- **All 85+ legacy CSS token names preserved (LEDGER 22).** Never delete or rename a
  token; new styles use existing paper tokens only. `universe.css` currently references
  52 distinct `var(--…)` tokens — that set may grow only by reusing tokens already
  defined in `src/design/tokens.css`, never by introducing a hex value. The rejected
  dark-on-paper inversion stays rejected.
- **Paper/ink design language throughout.** Motion is ambient and quiet, never a game
  effect.
- **Live DB is never opened or migrated from dev code.** Plan A adds no migration; it
  reads the v15 `day_photo` table that Foundations created. The v15 rehearsal
  (`CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib
  rehearse_migration_on_real_database_copy -- --ignored`) is Foundations' gate, not this
  plan's — but no Plan A task may touch `~/Library/Application Support/…/codakiller.db`.
- **devMock coverage rule (NOTES.md:32, audited by `.workflow/devmock-coverage-audit.mjs`).**
  Every command the frontend calls gets a `routeCommand` case in
  `src/devMock/tauriDevMock.ts` with deterministic fixtures, plus a sibling
  `tauriDevMock.<name>.test.ts` exercising it through
  `window.__TAURI_INTERNALS__.invoke` (pattern:
  `src/devMock/tauriDevMock.historyDays.test.ts`). Rejects are plain strings.
- **Dense floor 720×520 (LEDGER 25).** Every new surface — galaxy, streak line, capture
  card, photo cell, animation overlay — must be usable and screenshot-clean at
  `DENSE_LAYOUT_FLOOR` (`src/features/dock/dockState.ts:286`) as well as at Christian's
  real window size.
- **`window.confirm` is BANNED.** Any confirmation uses the existing inline-confirm idiom
  (`src/features/session/SessionBar.tsx:117-149`, itself modelled on Banner.tsx).
- **No overlay may cover interactive content.** Every completion overlay is
  `pointer-events: none` and self-removes.
- **`prefers-reduced-motion` is honored CSS-only.** No JS `matchMedia` read exists in this
  codebase and none may be added; reduced motion is expressed as a
  `@media (prefers-reduced-motion: reduce)` block (app-wide precedent:
  `src/App.css:151-157`).
- **Local day means `date(ts,'localtime')`** — the convention `history_days.rs` and
  `session_last_event_and_same_local_day` already use. Streaks and photo day keys must
  agree with session day-scoping or the surfaces will disagree.
- **No voice-router or fast-path touchpoint in this plan** — so the narrated-corpus gate
  (LEDGER 21) is not re-run for Plan A. If a task ends up touching `voice_loop.rs` intent
  routing, STOP and escalate: that changes the gate set.
- TDD per task; scoped suites per task, full gates at Task 9. Commit per task on branch
  `v7/plan-a`.

### Deliberate deviation recorded up front

`src/features/universe/universe.css:6` currently reads *"NO ambient animation. No
@keyframes, no infinite anything."* — the v5 rule written when the d3-force galaxy was
removed. **v7 A1 retires that rule for this one stylesheet, deliberately and with
Christian's approval** (spec Part 2, A1: *"'Living' = deterministic ambient motion
(twinkle, slow orbit, parallax) — no physics sim (removed in v5, stays removed)"*). What
stays banned is what actually died in v5: the simulation, the rAF loop, the pan/zoom
canvas, the eight glowing palettes. What returns is *declarative* CSS motion with a fully
static reduced-motion render. Task 2 rewrites that header comment to say exactly this, and
Task 9 records it in the vault Flaws register as a deliberate delta.

---

### Task 1: `galaxy.ts` — the pure deterministic layout module

**Files:**

- Create: `src/features/universe/galaxy.ts`, `src/features/universe/galaxy.test.ts`
- Modify: none (this task adds no render path)
- Test: `src/features/universe/galaxy.test.ts`

**Interfaces (produces — Task 2 consumes these verbatim):**

```ts
export interface GalaxyViewport {
  width: number;
  height: number;
}

/** The streak facts the galaxy is allowed to react to (A2's read model). */
export interface GalaxyStreak {
  current_days: number;
}

/** One mastered region, orbiting its piece's star. */
export interface GalaxyOrbit {
  region_id: number;
  name: string;
  /** Orbit radius in px from the star centre. */
  radius: number;
  /** Resting angle in degrees, deterministically hashed from the region id. */
  phase: number;
  /** Seconds for one revolution — wider orbits turn slower. */
  period: number;
  /** 0.92–1.00, straight off `RegionSignal.quality_brightness`. */
  brightness: number;
  /** The snapshot field that earned this body. Rendered as `data-evidence`. */
  evidence: "mastery_contracts_completed";
}

/** One piece, as a star system. */
export interface GalaxyStar {
  piece_id: number;
  title: string;
  composer: string;
  cx: number;
  cy: number;
  /** Log-scaled from `focused_seconds`. */
  radius: number;
  /** 0.92–1.00, straight off `UniversePiece.quality_brightness`. */
  brightness: number;
  /** 0–1, straight off `UniversePiece.earned_maturity` — the growth ring. */
  ring: number;
  /** True only when the day streak is live. */
  glow: boolean;
  orbits: GalaxyOrbit[];
}

export interface GalaxyLayout {
  viewport: GalaxyViewport;
  /** Stable order: composer sort key, then piece_id. */
  stars: GalaxyStar[];
}

export function fnv1a32(input: string): number;

export function galaxyLayout(
  snapshot: UniverseSnapshot,
  viewport: GalaxyViewport,
  streak: GalaxyStreak | null,
): GalaxyLayout;
```

Design notes bound by the spec:

- **Order** reuses `composerSortKey` from `./repertoire` (`repertoire.ts:205`) then
  `piece_id` — the same key `groupByComposer` (`repertoire.ts:218`) already sorts by, so a
  piece keeps its place between visits exactly as the current index does.
- **Star radius** is log-scaled focused time, saturating at 20 focused hours — the same
  saturation the Rust `earned_maturity` uses (`src-tauri/src/universe.rs:427`,
  `focused_minutes.ln_1p() / 1_200f64.ln_1p()`), so the two signals never disagree.
- **Orbit phase** is `fnv1a32("region:" + region_id) % 360`. FNV-1a 32-bit is chosen over
  any `Math.random`/`Date.now` seed because it is a total function of the region id: same
  id, same angle, forever, on every machine — which is what makes the property test
  (identical event history ⇒ identical galaxy) hold.
- **Orbits exist only for regions with `mastery_contracts_completed > 0`** — the same
  predicate `blockState` uses for `"mastered"` (`repertoire.ts:53`).
- **Glow is `streak.current_days > 0`** and nothing else.

- [ ] Failing test: write `src/features/universe/galaxy.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { fnv1a32, galaxyLayout } from "./galaxy";
import type { UniversePiece, UniverseSnapshot } from "./types";

const VIEWPORT = { width: 720, height: 520 };

function region(id: number, over: Partial<UniversePiece["region_signals"][0]> = {}) {
  return {
    region_id: id,
    name: `Region ${id}`,
    kind: "section",
    focused_seconds: 600,
    active_days_28: 1,
    practiced: true,
    revisited: false,
    quality_brightness: 0.96,
    last_practiced: "2026-08-20T10:00:00Z",
    practice_events: 4,
    rated_rep_events: 2,
    clean_rep_events: 1,
    distinct_practice_dates: 1,
    ...over,
  };
}

const CHOPIN: UniversePiece = {
  piece_id: 7,
  title: "Nocturne Op. 9 No. 2",
  composer: "Chopin",
  focused_seconds: 5430,
  active_days_28: 5,
  regions_total: 3,
  regions_practiced: 2,
  regions_revisited: 1,
  mastered_targets: 1,
  practice_sessions: 8,
  earned_maturity: 0.64,
  quality_brightness: 0.97,
  last_practiced: "2026-08-22T10:00:00Z",
  region_signals: [
    region(1, { mastery_contracts_completed: 1 }),
    region(2),
    region(3, { practiced: false, focused_seconds: 0 }),
  ],
};

const GRIFFES: UniversePiece = {
  ...CHOPIN,
  piece_id: 9,
  title: "The White Peacock",
  composer: "Griffes",
  focused_seconds: 600,
  earned_maturity: 0.11,
  quality_brightness: 0.93,
  region_signals: [region(21)],
};

const SNAPSHOT: UniverseSnapshot = {
  generated_at: "2026-08-23T09:00:00Z",
  definitions: [],
  traces: {
    source: "canonical practice events",
    practice_event_kinds: ["rep_open", "rep", "verdict", "tempo_change"],
    idle_threshold_seconds: 120,
    active_window_start: "2026-07-26",
    active_window_end: "2026-08-23",
    quality_formula: "bounded smoothing",
  },
  totals: {
    focused_seconds: 6030,
    active_days_28: 5,
    regions_practiced: 3,
    regions_revisited: 1,
  },
  pieces: [CHOPIN, GRIFFES],
};

describe("galaxyLayout", () => {
  it("is deterministic: the same snapshot lays out identically twice", () => {
    const a = galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 });
    const b = galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 });
    expect(a).toEqual(b);
  });

  it("places a piece in the same spot however the snapshot is ordered", () => {
    const forward = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const reversed = galaxyLayout(
      { ...SNAPSHOT, pieces: [GRIFFES, CHOPIN] },
      VIEWPORT,
      null,
    );
    expect(reversed.stars.map((s) => s.piece_id)).toEqual(
      forward.stars.map((s) => s.piece_id),
    );
    expect(reversed).toEqual(forward);
  });

  it("grows the star with focused time, log-scaled and bounded", () => {
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const chopin = stars.find((s) => s.piece_id === 7)!;
    const griffes = stars.find((s) => s.piece_id === 9)!;
    expect(chopin.radius).toBeGreaterThan(griffes.radius);
    // Log-scaled, not linear: 9x the seconds is nowhere near 9x the radius.
    expect(chopin.radius).toBeLessThan(griffes.radius * 3);
    for (const star of stars) {
      expect(star.radius).toBeGreaterThanOrEqual(6);
      expect(star.radius).toBeLessThanOrEqual(34);
    }
  });

  it("orbits ONLY regions with a completed mastery contract", () => {
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const chopin = stars.find((s) => s.piece_id === 7)!;
    expect(chopin.orbits.map((o) => o.region_id)).toEqual([1]);
    expect(chopin.orbits[0].evidence).toBe("mastery_contracts_completed");
    // Griffes has practice but no mastery contract: no bodies at all.
    expect(stars.find((s) => s.piece_id === 9)!.orbits).toEqual([]);
  });

  it("hashes the orbit phase from the region id — stable, spread, no randomness", () => {
    expect(fnv1a32("region:1")).toBe(fnv1a32("region:1"));
    expect(fnv1a32("region:1")).not.toBe(fnv1a32("region:2"));
    const { stars } = galaxyLayout(SNAPSHOT, VIEWPORT, null);
    const phase = stars.find((s) => s.piece_id === 7)!.orbits[0].phase;
    expect(phase).toBe(fnv1a32("region:1") % 360);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(360);
  });

  it("carries brightness and the growth ring straight off the snapshot", () => {
    const chopin = galaxyLayout(SNAPSHOT, VIEWPORT, null).stars.find(
      (s) => s.piece_id === 7,
    )!;
    expect(chopin.brightness).toBe(CHOPIN.quality_brightness);
    expect(chopin.ring).toBe(CHOPIN.earned_maturity);
    // A snapshot that never computed maturity gets no ring — not a guessed one.
    const bare = galaxyLayout(
      { ...SNAPSHOT, pieces: [{ ...CHOPIN, earned_maturity: undefined }] },
      VIEWPORT,
      null,
    );
    expect(bare.stars[0].ring).toBe(0);
  });

  it("glows only while a day streak is live", () => {
    expect(
      galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 3 }).stars.every((s) => s.glow),
    ).toBe(true);
    expect(
      galaxyLayout(SNAPSHOT, VIEWPORT, { current_days: 0 }).stars.some((s) => s.glow),
    ).toBe(false);
    expect(galaxyLayout(SNAPSHOT, VIEWPORT, null).stars.some((s) => s.glow)).toBe(false);
  });

  it("no evidence, no visual: an empty snapshot lays out nothing", () => {
    const empty = galaxyLayout({ ...SNAPSHOT, pieces: [] }, VIEWPORT, {
      current_days: 9,
    });
    expect(empty.stars).toEqual([]);
  });

  it("keeps every star inside the 720x520 dense floor", () => {
    const many: UniverseSnapshot = {
      ...SNAPSHOT,
      pieces: Array.from({ length: 24 }, (_, i) => ({
        ...CHOPIN,
        piece_id: 100 + i,
        title: `Piece ${i}`,
        composer: `Composer ${String(i).padStart(2, "0")}`,
      })),
    };
    for (const star of galaxyLayout(many, VIEWPORT, null).stars) {
      expect(star.cx - star.radius).toBeGreaterThanOrEqual(0);
      expect(star.cx + star.radius).toBeLessThanOrEqual(VIEWPORT.width);
      expect(star.cy - star.radius).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] Run `npx vitest run src/features/universe/galaxy.test.ts` — expect
      `Failed to resolve import "./galaxy"` (the module does not exist yet).
- [ ] Minimal implementation: create `src/features/universe/galaxy.ts`.

```ts
import { composerSortKey } from "./repertoire";
import type { RegionSignal, UniversePiece, UniverseSnapshot } from "./types";

/**
 * The living galaxy's geometry — a PURE function of one universe snapshot.
 *
 * This module is where "living" is made honest. It computes positions, sizes,
 * ring thicknesses and orbit phases; it never animates anything. Motion is left
 * entirely to CSS @keyframes in universe.css, which means there is no
 * requestAnimationFrame, no simulation, no tick, and nothing to desynchronise —
 * exactly the property that killed the v5 d3-force galaxy.
 *
 * Everything here is derived from snapshot fields the Rust `universe::snapshot`
 * already earns from recorded practice events:
 *   focused_seconds            -> star radius (log-scaled)
 *   quality_brightness         -> star/body brightness
 *   earned_maturity            -> growth-ring thickness
 *   mastery_contracts_completed-> whether a region orbits at all
 *   streak.current_days        -> whether the star glows
 * There is no sixth input. If a visual cannot name its field, it does not ship.
 */

export interface GalaxyViewport {
  width: number;
  height: number;
}

/** The streak facts the galaxy is allowed to react to (A2's read model). */
export interface GalaxyStreak {
  current_days: number;
}

export interface GalaxyOrbit {
  region_id: number;
  name: string;
  radius: number;
  /** Degrees. */
  phase: number;
  /** Seconds per revolution. */
  period: number;
  brightness: number;
  evidence: "mastery_contracts_completed";
}

export interface GalaxyStar {
  piece_id: number;
  title: string;
  composer: string;
  cx: number;
  cy: number;
  radius: number;
  brightness: number;
  ring: number;
  glow: boolean;
  orbits: GalaxyOrbit[];
}

export interface GalaxyLayout {
  viewport: GalaxyViewport;
  stars: GalaxyStar[];
}

/** Smallest and largest a star may draw, in px. */
export const STAR_MIN_RADIUS = 6;
export const STAR_MAX_RADIUS = 34;
/**
 * Twenty focused hours saturate the star, matching the `earned_maturity` time
 * term in `src-tauri/src/universe.rs` (`ln_1p(minutes) / ln_1p(1200)`), so the
 * ring and the disc never tell different stories about the same piece.
 */
const FOCUS_SATURATION_MINUTES = 1_200;

/** One grid cell per piece; sized so 720px fits five columns at the dense floor. */
const CELL_WIDTH = 132;
const CELL_HEIGHT = 132;
const GUTTER = 8;

/** Orbit geometry, all deterministic. */
const ORBIT_GAP = 11;
const ORBIT_BASE_PERIOD_SECONDS = 42;
const ORBIT_PERIOD_STEP_SECONDS = 9;

/**
 * FNV-1a, 32-bit. Chosen for the orbit phase because it is a TOTAL function of
 * the region id: no seed, no clock, no PRNG state. Two databases with identical
 * event histories therefore place every orbiting body at the same angle, which
 * is the property test the spec asks for.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function starRadius(focusedSeconds: number): number {
  const minutes = Math.max(0, focusedSeconds) / 60;
  const scaled = Math.log1p(minutes) / Math.log1p(FOCUS_SATURATION_MINUTES);
  const bounded = Math.min(1, Math.max(0, scaled));
  return STAR_MIN_RADIUS + (STAR_MAX_RADIUS - STAR_MIN_RADIUS) * bounded;
}

/** A region orbits only once it has a completed mastery contract on record. */
function orbiting(regions: RegionSignal[]): RegionSignal[] {
  return regions.filter((region) => (region.mastery_contracts_completed ?? 0) > 0);
}

function orbitsFor(piece: UniversePiece, radius: number): GalaxyOrbit[] {
  return orbiting(piece.region_signals).map((region, index) => ({
    region_id: region.region_id,
    name: region.name,
    radius: radius + ORBIT_GAP * (index + 1),
    phase: fnv1a32(`region:${region.region_id}`) % 360,
    period: ORBIT_BASE_PERIOD_SECONDS + ORBIT_PERIOD_STEP_SECONDS * index,
    brightness: region.quality_brightness,
    evidence: "mastery_contracts_completed",
  }));
}

/** Composer sort key, then piece id — the order the paper index already uses. */
function stableOrder(pieces: UniversePiece[]): UniversePiece[] {
  return [...pieces].sort((a, b) => {
    const byComposer = composerSortKey(a.composer ?? "").localeCompare(
      composerSortKey(b.composer ?? ""),
    );
    return byComposer !== 0 ? byComposer : a.piece_id - b.piece_id;
  });
}

export function galaxyLayout(
  snapshot: UniverseSnapshot,
  viewport: GalaxyViewport,
  streak: GalaxyStreak | null,
): GalaxyLayout {
  const glow = (streak?.current_days ?? 0) > 0;
  const columns = Math.max(1, Math.floor(viewport.width / CELL_WIDTH));
  const stars = stableOrder(snapshot.pieces).map((piece, index) => {
    const radius = starRadius(piece.focused_seconds);
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      piece_id: piece.piece_id,
      title: piece.title,
      composer: piece.composer ?? "",
      cx: column * CELL_WIDTH + CELL_WIDTH / 2,
      cy: row * CELL_HEIGHT + CELL_HEIGHT / 2,
      radius,
      brightness: piece.quality_brightness,
      // No maturity on the wire means no ring. An absent signal is never a
      // guessed one.
      ring: piece.earned_maturity ?? 0,
      glow,
      orbits: orbitsFor(piece, radius),
    };
  });
  // Nothing may be drawn outside the viewport at the dense floor: the widest
  // thing in a cell is the star plus its outermost orbit, and GUTTER keeps that
  // off the edge.
  const maxExtent = CELL_WIDTH / 2 - GUTTER;
  for (const star of stars) {
    star.radius = Math.min(star.radius, maxExtent);
  }
  return { viewport, stars };
}
```

- [ ] Run `npx vitest run src/features/universe/galaxy.test.ts` — all green.
      Run `npx tsc --noEmit`.
- [ ] Commit `feat(universe): deterministic galaxy layout module (A1)`.

### Task 2: UniverseWorkspace renders the galaxy — SVG + CSS keyframes, test replacement

**Files:**

- Modify: `src/features/universe/UniverseWorkspace.tsx`,
  `src/features/universe/universe.css`,
  `src/features/universe/UniverseWorkspace.test.tsx`
- Modify: `src/shell/Shell.tsx` (pass the streak down at `Shell.tsx:1042-1047`)
- Unchanged, deliberately: `DetailPanel.tsx`, `repertoire.ts`, `format.ts`, `api.ts`,
  `types.ts`, and the route id `"universe"` / `data-testid="universe-workspace"`
  (`UniverseWorkspace.tsx:105`) / the `onOpenPractice` deep link
  (`UniverseWorkspace.tsx:99-102`, wired at `Shell.tsx:1043`).
- Test: `src/features/universe/UniverseWorkspace.test.tsx`

**Interfaces:**

- `UniverseWorkspace` gains one optional prop:
  `streak?: { current_days: number } | null` (default `null`). Task 4 threads A2's
  `streak_summary` into it from `Shell.tsx`; until then it renders un-glowed, which is the
  honest default.
- Rendered contract the tests bind to:
  - `<svg class="universe-galaxy" data-testid="universe-galaxy">` inside the existing
    `.universe-map` section, ABOVE the composer index (which stays — the galaxy is the
    picture, the index is still the place you can learn).
  - one `<g class="universe-star" data-piece-id data-evidence="focused_seconds">` per star,
    containing `<circle class="universe-star-disc">`, `<circle class="universe-star-ring"
    data-evidence="earned_maturity">` (rendered only when `ring > 0`), and
    `<circle class="universe-star-glow" data-evidence="streak">` (only when `glow`).
  - one `<circle class="universe-orbit-body" data-region-id
    data-evidence="mastery_contracts_completed">` per orbit.
  - clicking a star calls the SAME `setSelection({ kind: "piece", pieceId })` the card
    does, so DetailPanel behaviour is byte-identical.

- [ ] Failing tests: in `UniverseWorkspace.test.tsx`, REPLACE the existing
      `"runs no simulation, no animation frame loop and no keyframes"` test
      (currently lines 204-213) with the four assertions below. Keep every other test in
      the file — in particular `"places a piece in the same spot however the snapshot is
      ordered"` (currently line 226) and the DetailPanel drill-down tests — untouched.

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// …existing imports…
import { galaxyLayout } from "./galaxy";

  // (a) The v5 lesson still holds: declarative motion only, never a loop.
  it("runs no simulation and no animation frame loop", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = await renderMap();
    expect(raf).not.toHaveBeenCalled();
    // The galaxy IS an <svg> now — but a static one, drawn once from a layout.
    expect(container.querySelector(".universe-canvas")).toBeNull();
    expect(container.querySelectorAll("svg.universe-galaxy")).toHaveLength(1);
    raf.mockRestore();
  });

  // (b) Property: identical event history => identical galaxy.
  it("lays the galaxy out deterministically for the same snapshot", () => {
    const viewport = { width: 720, height: 520 };
    const once = galaxyLayout(SNAPSHOT, viewport, { current_days: 2 });
    const twice = galaxyLayout(SNAPSHOT, viewport, { current_days: 2 });
    expect(once).toEqual(twice);
  });

  // (c) Earned-only: every rendered visual traces back to a snapshot field.
  it("renders no visual that is not backed by snapshot evidence", async () => {
    const { container } = await renderMap();
    const galaxy = container.querySelector(".universe-galaxy") as SVGElement;

    const pieceIds = new Set(SNAPSHOT.pieces.map((p) => String(p.piece_id)));
    const masteredRegionIds = new Set(
      SNAPSHOT.pieces.flatMap((p) =>
        p.region_signals
          .filter((r) => (r.mastery_contracts_completed ?? 0) > 0)
          .map((r) => String(r.region_id)),
      ),
    );

    const stars = [...galaxy.querySelectorAll(".universe-star")];
    expect(stars).toHaveLength(SNAPSHOT.pieces.length);
    for (const star of stars) {
      expect(pieceIds.has(star.getAttribute("data-piece-id") ?? "")).toBe(true);
    }

    const bodies = [...galaxy.querySelectorAll(".universe-orbit-body")];
    expect(bodies.length).toBe(masteredRegionIds.size);
    for (const body of bodies) {
      expect(masteredRegionIds.has(body.getAttribute("data-region-id") ?? "")).toBe(true);
      expect(body.getAttribute("data-evidence")).toBe("mastery_contracts_completed");
    }

    // A ring only exists where earned_maturity does.
    const ringed = [...galaxy.querySelectorAll(".universe-star-ring")].map((node) =>
      node.closest(".universe-star")!.getAttribute("data-piece-id"),
    );
    const withMaturity = SNAPSHOT.pieces
      .filter((p) => (p.earned_maturity ?? 0) > 0)
      .map((p) => String(p.piece_id));
    expect(ringed.sort()).toEqual(withMaturity.sort());

    // No streak was supplied, so nothing may glow.
    expect(galaxy.querySelectorAll(".universe-star-glow")).toHaveLength(0);
  });

  it("glows every star only when a live streak is passed in", async () => {
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} streak={{ current_days: 4 }} />,
    );
    await screen.findByRole("heading", { name: "Your repertoire" });
    expect(container.querySelectorAll(".universe-star-glow")).toHaveLength(
      SNAPSHOT.pieces.length,
    );
  });

  it("draws nothing at all when there is no practice evidence", async () => {
    invokeMock.mockResolvedValue({ ...SNAPSHOT, pieces: [] });
    const { container } = render(
      <UniverseWorkspace onOpenPractice={vi.fn()} streak={{ current_days: 9 }} />,
    );
    await screen.findByRole("heading", { name: "Your universe is quiet for now." });
    expect(container.querySelector(".universe-galaxy")).toBeNull();
  });

  // (d) Reduced motion collapses the galaxy to a fully static render, CSS-only.
  it("wraps every keyframe animation in a prefers-reduced-motion escape", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./universe.css", import.meta.url)),
      "utf8",
    );
    const animated = [
      ".universe-star-disc",
      ".universe-orbit-body",
      ".universe-galaxy-field",
    ];
    for (const selector of animated) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/@keyframes universe-twinkle/);
    expect(css).toMatch(/@keyframes universe-orbit/);
    expect(css).toMatch(/@keyframes universe-parallax/);

    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).not.toBe("");
    expect(reduced).toContain("animation: none !important");
    // And no JS ever reads the media query — the app has zero matchMedia calls.
    expect(css).not.toContain("matchMedia");
  });

  it("selects a piece by clicking its star, same as clicking its card", async () => {
    await renderMap();
    fireEvent.click(
      screen.getByTestId("universe-galaxy").querySelector(
        '.universe-star[data-piece-id="7"] .universe-star-hit',
      ) as Element,
    );
    expect(
      await screen.findByRole("complementary", { name: "Nocturne Op. 9 No. 2" }),
    ).toBeTruthy();
  });
```

- [ ] Run `npx vitest run src/features/universe/UniverseWorkspace.test.tsx` — expect the
      new tests to fail on `.universe-galaxy` being null and on the missing `@keyframes`.
- [ ] Implementation, part 1 — `UniverseWorkspace.tsx`. Update the prop type and the
      component doc-comment (the current one at lines 40-52 claims "no keyframes"; that
      sentence is now false and must be rewritten, not left to rot), then render the
      galaxy inside `.universe-map-and-detail`, immediately before `<div
      className="universe-index">` (currently line 235).

```tsx
import { galaxyLayout, type GalaxyLayout } from "./galaxy";

interface UniverseWorkspaceProps {
  /** Jump to the Score/Atlas workspace (null = open Atlas with no piece). */
  onOpenPractice: (piece: PracticePieceContext | null) => void;
  /** Optional jump to the History workspace for a piece. */
  onOpenLedger?: (piece: PracticePieceContext) => void;
  /**
   * A2's day-streak read model. The ONLY thing it may change is whether stars
   * glow; it can never add, move or resize one. Null = no streak known yet,
   * which renders un-glowed rather than optimistically lit.
   */
  streak?: { current_days: number } | null;
}

/** The galaxy is laid out for the dense floor and scaled by the SVG viewBox. */
const GALAXY_VIEWPORT = { width: 720, height: 520 };
```

```tsx
  const galaxy = useMemo<GalaxyLayout | null>(
    () => (snapshot ? galaxyLayout(snapshot, GALAXY_VIEWPORT, streak ?? null) : null),
    [snapshot, streak],
  );
```

```tsx
{galaxy && galaxy.stars.length > 0 && (
  <svg
    className="universe-galaxy"
    data-testid="universe-galaxy"
    viewBox={`0 0 ${GALAXY_VIEWPORT.width} ${galaxyHeight(galaxy)}`}
    role="img"
    aria-label={`${galaxy.stars.length} pieces as star systems`}
  >
    {/* One parallax layer: a still field of tick marks derived from the star
        grid itself, drifting a few pixels. It carries no data — it is the
        page, not a signal — which is why it has no data-evidence attribute
        and no piece/region id. */}
    <g className="universe-galaxy-field" aria-hidden="true">
      {galaxy.stars.map((star) => (
        <circle
          key={`field-${star.piece_id}`}
          cx={star.cx + 46}
          cy={star.cy - 38}
          r={1}
        />
      ))}
    </g>
    {galaxy.stars.map((star) => (
      <g
        key={star.piece_id}
        className="universe-star"
        data-piece-id={star.piece_id}
        data-evidence="focused_seconds"
        style={
          {
            "--star-brightness": star.brightness,
            "--star-phase": `${fnv1a32(`piece:${star.piece_id}`) % 4000}ms`,
          } as CSSProperties
        }
      >
        {star.glow && (
          <circle
            className="universe-star-glow"
            data-evidence="streak"
            cx={star.cx}
            cy={star.cy}
            r={star.radius + 6}
          />
        )}
        {star.ring > 0 && (
          <circle
            className="universe-star-ring"
            data-evidence="earned_maturity"
            cx={star.cx}
            cy={star.cy}
            r={star.radius + 3}
            style={{ strokeWidth: 1 + 3 * star.ring }}
          />
        )}
        <circle
          className="universe-star-disc"
          cx={star.cx}
          cy={star.cy}
          r={star.radius}
        />
        {star.orbits.map((orbit) => (
          <g
            key={orbit.region_id}
            className="universe-orbit"
            style={
              {
                "--orbit-period": `${orbit.period}s`,
                "--orbit-phase": `${orbit.phase}deg`,
                transformOrigin: `${star.cx}px ${star.cy}px`,
              } as CSSProperties
            }
          >
            <circle
              className="universe-orbit-body"
              data-region-id={orbit.region_id}
              data-evidence="mastery_contracts_completed"
              cx={star.cx + orbit.radius}
              cy={star.cy}
              r={2.5}
            />
          </g>
        ))}
        {/* The click target is a real <circle> with a title, not a bare <g>:
            SVG hit areas need geometry, and the composer index below still
            carries the accessible <button> for every piece. */}
        <circle
          className="universe-star-hit"
          cx={star.cx}
          cy={star.cy}
          r={Math.max(star.radius + 10, 18)}
          onClick={() => setSelection({ kind: "piece", pieceId: star.piece_id })}
        >
          <title>{star.title}</title>
        </circle>
      </g>
    ))}
  </svg>
)}
```

```tsx
/** Tall enough for the last row of stars, so nothing is clipped. */
function galaxyHeight(galaxy: GalaxyLayout): number {
  const lowest = galaxy.stars.reduce(
    (max, star) => Math.max(max, star.cy + star.radius + 24),
    0,
  );
  return Math.max(galaxy.viewport.height, lowest);
}
```

- [ ] Implementation, part 2 — `universe.css`. Rewrite the header rule at lines 5-7 and
      append the galaxy block. Every colour keeps coming from existing tokens; no hex.

```css
/*
 *   - AMBIENT MOTION IS ALLOWED IN THE GALAXY BLOCK ONLY, and only as CSS
 *     @keyframes: twinkle, slow orbit, parallax drift. v5 removed a d3-force
 *     SIMULATION with a requestAnimationFrame tick loop, and that stays
 *     removed — there is still no JS animation of any kind on this screen.
 *     v7 A1 deliberately retires the older "no @keyframes" wording (see
 *     docs/superpowers/plans/2026-08-23-codakiller-v7-plan-a-galaxy-ritual.md).
 *     Every animation below must collapse to a fully static render under
 *     @media (prefers-reduced-motion: reduce) at the bottom of this file.
 */

.universe-galaxy {
  width: 100%;
  height: auto;
  display: block;
  margin-bottom: var(--s-4);
  overflow: visible;
}

.universe-galaxy-field circle {
  fill: var(--rule);
  opacity: 0.5;
  animation: universe-parallax 90s linear infinite;
}

.universe-star-disc {
  fill: var(--ink);
  opacity: var(--star-brightness, 0.96);
  animation: universe-twinkle 6s ease-in-out infinite;
  animation-delay: var(--star-phase, 0ms);
}

.universe-star-ring {
  fill: none;
  stroke: var(--ink-soft);
  opacity: 0.55;
}

.universe-star-glow {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1;
  opacity: 0.45;
  animation: universe-twinkle 4s ease-in-out infinite;
}

.universe-orbit {
  animation: universe-orbit var(--orbit-period, 42s) linear infinite;
  animation-delay: calc(var(--orbit-period, 42s) * -1 * (var(--orbit-phase, 0deg) / 360deg));
}

.universe-orbit-body {
  fill: var(--ink-soft);
}

.universe-star-hit {
  fill: transparent;
  cursor: pointer;
}

.universe-star-hit:hover ~ .universe-star-disc,
.universe-star-hit:focus-visible ~ .universe-star-disc {
  fill: var(--accent);
}

@keyframes universe-twinkle {
  0%, 100% { opacity: var(--star-brightness, 0.96); }
  50% { opacity: calc(var(--star-brightness, 0.96) * 0.72); }
}

@keyframes universe-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes universe-parallax {
  0%, 100% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(6px, -4px, 0); }
}

/* The static render. Not a slower galaxy — a still one. */
@media (prefers-reduced-motion: reduce) {
  .universe-galaxy-field circle,
  .universe-star-disc,
  .universe-star-glow,
  .universe-orbit {
    animation: none !important;
  }
  /* Bodies keep their hashed resting angle, so the picture is still the
     earned one — it simply stops moving. */
  .universe-orbit {
    transform: rotate(var(--orbit-phase, 0deg));
  }
}
```

- [ ] Implementation, part 3 — `Shell.tsx`: leave `Shell.tsx:1042-1047` structurally as-is
      and add the prop placeholder now so Task 4 only has to supply a value:
      `<UniverseWorkspace onOpenPractice={openFromUniverse} onOpenLedger={openLedgerForPiece} streak={streak} />`
      with `const streak = null;` for this task (Task 4 replaces it with the real hook).
- [ ] Run `npx vitest run src/features/universe/` (all four suites: workspace, detail,
      repertoire, api — DetailPanel and repertoire must stay green untouched) +
      `npx tsc --noEmit`.
- [ ] Manual check at 720×520 in `npm run dev:mock`: stars twinkle, mastered bodies orbit,
      the index below still reads as paper.
- [ ] Commit `feat(universe): living galaxy render — SVG + CSS keyframes, reduced-motion static (A1)`.

### Task 3: Rust `streak_summary` read model + `streak.threshold_minutes` setting

**Files:**

- Create: `src-tauri/src/store/streaks.rs` (queries + types + inline `#[cfg(test)]` tests,
  house style — same as `history_days.rs`)
- Modify: `src-tauri/src/store/mod.rs` (`mod streaks;` alongside the existing declarations
  at lines 8-24, and a `pub use streaks::StreakSummary;` beside the existing
  `pub use history_days::{HistoryDayDetail, HistoryDaySummary};` at line 27),
  `src-tauri/src/lib.rs` (one `#[tauri::command]` beside the Plan B read models at
  lines 1362-1398, and one entry in `generate_handler!` at line 2240 beside
  `history_days` at line 2314), `src-tauri/src/settings.rs` (`SettingsSnapshot` at
  lines 57-78, `SettingsPatch` at lines 80-100, `snapshot()` at lines 101-137, and the
  matching arm in `update()`)
- Test: inline in `streaks.rs`; settings coverage in the existing `settings.rs` test module

**Interfaces (produces):**

- `streak_summary(threshold_minutes: i64) -> StreakSummary` where
  `StreakSummary { current_days: i64, best_days: i64, threshold_minutes: i64,
  today_focused_seconds: i64 }`.
- A LOCAL calendar day joins the streak when that day's total event-derived
  `metrics::focused_seconds` (`src-tauri/src/metrics/mod.rs:32-49`) is
  `>= threshold_minutes * 60`. Day bucketing is `date(started_at,'localtime')` — the same
  SQL `history_days.rs:114-125` uses.
- **Walk direction: backward from today.** `current_days` is the run of qualifying days
  ending at today, with yesterday accepted as the anchor so a streak is not declared dead
  at 00:01 before the day has had a chance. A forward walk would happily report a
  three-week-old run as "current", which is exactly the fake progress the earned-only law
  forbids.
- **`metrics::streak()` (`metrics/mod.rs:54-74`) is reused verbatim for `current_days`** —
  it already takes `&[String]` of `YYYY-MM-DD` days, dedups, sorts, and counts the run
  ending at the latest day, which is precisely the current-run semantics. It is *not*
  general enough for `best_days` (it only ever counts the trailing run), so `streaks.rs`
  adds a `longest_run` helper for that and nothing else.
- New setting key `streak.threshold_minutes`, default **10**, bounds 1..240, stored in the
  same generic `setting` key/value table every other setting uses.

- [ ] Failing Rust tests: add to `src-tauri/src/store/streaks.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    /// Seed one session on `day` (LOCAL) with `count` practice events spaced
    /// 60s apart — under IDLE_THRESHOLD_SECS, so every gap counts as focus.
    /// `count` events therefore yield (count - 1) * 60 focused seconds.
    fn seed_day(store: &Store, day: &str, count: usize) {
        let sid = store.open_session().expect("open session");
        store
            .set_session_started_at(sid, &format!("{day}T14:00:00"))
            .expect("stamp session");
        for index in 0..count {
            let ts = format!("{day}T14:{:02}:00", index);
            store
                .insert_session_event_at(sid, "rep", &serde_json::json!({}), &ts)
                .expect("event");
        }
    }

    #[test]
    fn longest_run_counts_the_best_consecutive_stretch_not_the_last() {
        let days = vec![
            "2026-08-01".to_string(),
            "2026-08-02".to_string(),
            "2026-08-03".to_string(),
            // gap
            "2026-08-10".to_string(),
        ];
        assert_eq!(longest_run(&days), 3);
        assert_eq!(longest_run(&[]), 0);
        assert_eq!(longest_run(&["2026-08-01".to_string()]), 1);
    }

    #[test]
    fn a_day_joins_the_streak_only_once_it_clears_the_threshold() {
        let store = Store::open_in_memory().expect("store");
        // 3 events = 120 focused seconds = 2 minutes. Below a 10-minute bar.
        seed_day(&store, "2026-08-22", 3);
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 0);
        assert_eq!(out.best_days, 0);
        assert_eq!(out.threshold_minutes, 10);
    }

    #[test]
    fn a_twenty_four_second_launch_poke_never_counts() {
        let store = Store::open_in_memory().expect("store");
        seed_day(&store, "2026-08-22", 2); // 60 focused seconds
        assert_eq!(store.streak_summary(10).expect("summary").best_days, 0);
    }

    #[test]
    fn consecutive_qualifying_local_days_form_the_current_run() {
        let store = Store::open_in_memory().expect("store");
        let today = store.today_local().expect("today");
        let yesterday = crate::date::Date::parse(&today).unwrap().add_days(-1).to_string();
        let two_back = crate::date::Date::parse(&today).unwrap().add_days(-2).to_string();
        let far = crate::date::Date::parse(&today).unwrap().add_days(-9).to_string();
        // 11 events = 600 focused seconds = exactly 10 minutes: the bar is >=.
        for day in [&today, &yesterday, &two_back, &far] {
            seed_day(&store, day, 11);
        }
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 3, "today + 2 back, the far day is a gap");
        assert_eq!(out.best_days, 3);
        assert_eq!(out.today_focused_seconds, 600);
    }

    #[test]
    fn a_stale_run_is_never_reported_as_current() {
        let store = Store::open_in_memory().expect("store");
        let today = crate::date::Date::parse(&store.today_local().unwrap()).unwrap();
        for back in 5..9 {
            seed_day(&store, &today.add_days(-back).to_string(), 11);
        }
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(out.current_days, 0, "the run ended five days ago");
        assert_eq!(out.best_days, 4, "but it is still the best on record");
        assert_eq!(out.today_focused_seconds, 0);
    }

    #[test]
    fn an_empty_database_has_no_streak_and_no_visual_to_show() {
        let store = Store::open_in_memory().expect("store");
        let out = store.streak_summary(10).expect("summary");
        assert_eq!(
            out,
            StreakSummary {
                current_days: 0,
                best_days: 0,
                threshold_minutes: 10,
                today_focused_seconds: 0,
            }
        );
    }

    #[test]
    fn the_threshold_is_configurable_and_clamped() {
        let store = Store::open_in_memory().expect("store");
        seed_day(&store, &store.today_local().unwrap(), 3); // 120s = 2 min
        assert_eq!(store.streak_summary(1).expect("s").current_days, 1);
        assert_eq!(store.streak_summary(10).expect("s").current_days, 0);
        assert_eq!(store.streak_summary(0).expect("s").threshold_minutes, 1);
        assert_eq!(store.streak_summary(9_999).expect("s").threshold_minutes, 1_440);
    }
}
```

- [ ] Run `cd src-tauri && cargo test streaks` — expect compile failure (module absent).
- [ ] Implementation: create `src-tauri/src/store/streaks.rs`.

```rust
//! A2: the GLOBAL day-streak read model.
//!
//! `metrics::streak` already exists but is piece-scoped in practice (it backs
//! `progress_summary`) and only ever counts the trailing run. This module is the
//! global, threshold-gated day source the Today and Calendar headers read: it
//! buckets sessions by LOCAL calendar day with `date(started_at,'localtime')` —
//! the same convention `history_days.rs` and `session_last_event_and_same_local_day`
//! use — sums each day's event-derived `metrics::focused_seconds`, and keeps only
//! the days that cleared the configured minute bar.
//!
//! Read-only. No migration, no new table, no write path: a streak is a fact about
//! events that already happened, and there is nowhere to store one even if
//! somebody wanted to grant it.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::Serialize;

use super::Store;
use crate::date::Date;
use crate::metrics;

/// The default focused-minute bar a local day must clear to join the streak
/// (spec A2). Mirrored by `settings::snapshot`'s `streak.threshold_minutes`.
pub const DEFAULT_STREAK_THRESHOLD_MINUTES: i64 = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StreakSummary {
    /// Consecutive qualifying LOCAL days ending today (or yesterday, while
    /// today is still in progress). Zero when the last qualifying day is older.
    pub current_days: i64,
    /// The longest qualifying run ever recorded.
    pub best_days: i64,
    /// Echoed back so the UI never has to guess what bar produced these numbers.
    pub threshold_minutes: i64,
    /// Today's event-derived focused seconds — the "you are N minutes away" fact.
    pub today_focused_seconds: i64,
}

/// `(local day, session id)` for every session on record, oldest first.
fn sessions_by_local_day(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT date(started_at,'localtime') AS day, id FROM session ORDER BY day, id",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
    rows.collect()
}

/// The longest stretch of consecutive days in an unsorted day list.
/// `metrics::streak` cannot answer this — it only counts the run ending at the
/// latest day — so `best_days` needs its own walk.
pub fn longest_run(days: &[String]) -> i64 {
    let mut ordinals: Vec<i64> = days
        .iter()
        .filter_map(|day| Date::parse(day).map(Date::days_since_epoch))
        .collect();
    ordinals.sort_unstable();
    ordinals.dedup();
    let mut best = 0i64;
    let mut run = 0i64;
    let mut previous: Option<i64> = None;
    for ordinal in ordinals {
        run = match previous {
            Some(prev) if ordinal == prev + 1 => run + 1,
            _ => 1,
        };
        best = best.max(run);
        previous = Some(ordinal);
    }
    best
}

impl Store {
    /// Today's LOCAL calendar date, read through SQLite so it uses exactly the
    /// same clock and timezone rule as every day-bucketing query in the app.
    pub(crate) fn today_local(&self) -> rusqlite::Result<String> {
        let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
        conn.query_row("SELECT date('now','localtime')", [], |row| row.get(0))
    }

    /// Consecutive LOCAL days whose event-derived focused time cleared
    /// `threshold_minutes`, plus the best such run and today's raw seconds.
    pub(crate) fn streak_summary(&self, threshold_minutes: i64) -> rusqlite::Result<StreakSummary> {
        let threshold_minutes = threshold_minutes.clamp(1, 1_440);
        let threshold_seconds = threshold_minutes.saturating_mul(60);
        let today = self.today_local()?;

        let pairs = {
            let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
            sessions_by_local_day(&conn)?
        };

        // Outside the lock above: `events_for_session` takes its own lock and
        // `std::sync::Mutex` is not reentrant (same discipline as
        // `Store::history_days`).
        let mut focused_by_day: BTreeMap<String, i64> = BTreeMap::new();
        for (day, session_id) in pairs {
            let events = self.events_for_session(session_id)?;
            *focused_by_day.entry(day).or_insert(0) += metrics::focused_seconds(&events) as i64;
        }

        let qualifying: Vec<String> = focused_by_day
            .iter()
            .filter(|(_, seconds)| **seconds >= threshold_seconds)
            .map(|(day, _)| day.clone())
            .collect();

        // Backward walk: the run must reach today (or yesterday, so a streak is
        // not declared dead before today has had its chance). A forward walk
        // would report a three-week-old run as "current" — fake progress, which
        // the earned-only law forbids.
        let anchor_is_live = qualifying
            .last()
            .and_then(|day| Date::parse(day))
            .zip(Date::parse(&today))
            .map(|(last, now)| {
                let gap = now.days_since_epoch() - last.days_since_epoch();
                (0..=1).contains(&gap)
            })
            .unwrap_or(false);

        Ok(StreakSummary {
            current_days: if anchor_is_live {
                i64::from(metrics::streak(&qualifying))
            } else {
                0
            },
            best_days: longest_run(&qualifying),
            threshold_minutes,
            today_focused_seconds: focused_by_day.get(&today).copied().unwrap_or(0),
        })
    }
}
```

- [ ] Wire the module: in `src-tauri/src/store/mod.rs` add `mod streaks;` to the
      declaration block (lines 8-24, alphabetical: after `session_plan`) and
      `pub use streaks::{StreakSummary, DEFAULT_STREAK_THRESHOLD_MINUTES};` beside the
      existing `pub use history_days::{…};` at line 27.
- [ ] Add the setting. In `src-tauri/src/settings.rs`: one field on `SettingsSnapshot`
      (after `calendar_capacity_minutes`, line 72) and one on `SettingsPatch` (line 94);
      in `snapshot()`
      `streak_threshold_minutes: integer(store, "streak.threshold_minutes", 10, 1, 240),`
      beside the `calendar.daily_capacity_minutes` line; in `update()` the matching arm
      following the `calendar_capacity_minutes` precedent exactly.
- [ ] Add the command. In `src-tauri/src/lib.rs`, directly after `day_sheets_range`
      (ends line 1398):

```rust
// ── Day streak (Plan A, task A2) ───────────────────────────────────────────
//
// A pure read over the event log. There is no streak table and no streak write
// path anywhere in the app: a streak is a fact about practice that already
// happened, so it cannot be granted, bought or backfilled.

/// Consecutive LOCAL days whose event-derived focused time cleared the
/// configured `streak.threshold_minutes` bar, plus the best run on record.
#[tauri::command]
fn streak_summary(store: State<'_, Arc<Store>>) -> Result<store::StreakSummary, String> {
    let threshold = i64::from(settings::snapshot(&store).streak_threshold_minutes);
    store.streak_summary(threshold).map_err(|e| e.to_string())
}
```

      and add `streak_summary,` to `generate_handler!` (line 2240) beside `history_days`
      (line 2314).
- [ ] Run `cd src-tauri && cargo test streaks settings` (0 fail) then
      `cargo test` (full suite, no regression) and
      `cargo clippy --all-targets -- -D warnings`.
- [ ] Commit `feat(streak): global day-streak read model + streak.threshold_minutes setting (A2)`.

### Task 4: Streak surfaced in Today and Calendar + Settings field + devMock

**Files:**

- Create: `src/features/streak/api.ts`, `src/features/streak/useStreak.ts`,
  `src/features/streak/StreakLine.tsx`, `src/features/streak/streak.css`,
  `src/features/streak/StreakLine.test.tsx`,
  `src/devMock/tauriDevMock.streakSummary.test.ts`
- Modify: `src/features/today/TodayWorkspace.tsx` (streak line under the date at line 94),
  `src/features/today/TodayWorkspace.css`,
  `src/features/calendar/CalendarWorkspace.tsx` (streak line in the
  `.calendar-header` opened at line 229, beside the capacity control at lines 232-256),
  `src/features/settings/SettingsPanel.tsx` (a `NumberField` — the component is defined at
  lines 726-752 — in the Calendar-capacity `Disclosure` at lines 588-604),
  `src/shell/Shell.tsx` (replace Task 2's `const streak = null` with `useStreak()` and
  pass it to `UniverseWorkspace` at lines 1042-1047),
  `src/devMock/tauriDevMock.ts` (a `routeCommand` case beside `history_days` at line 3161)
- Test: `StreakLine.test.tsx`, `tauriDevMock.streakSummary.test.ts`, plus updated
  `TodayWorkspace.test.tsx` / `CalendarWorkspace.test.tsx` assertions

**Interfaces:**

- `src/features/streak/api.ts` mirrors the Rust type VERBATIM:

```ts
export interface StreakSummary {
  current_days: number;
  best_days: number;
  threshold_minutes: number;
  today_focused_seconds: number;
}

export function streakSummary(): Promise<StreakSummary>;
```

- `useStreak(): StreakSummary | null` — one `invoke` on mount, `null` until it lands.
  No polling (nothing in this app polls; the streak only changes at day granularity).
- `<StreakLine summary={…} />` — the single component both headers mount, so Today and
  Calendar can never render different numbers.

> **Open question for Christian (do not guess in code — flag it in the PR):** "Today" in
> the spec maps to two real surfaces. `src/features/today/TodayWorkspace.tsx` is the main
> menu (mark, date at line 94, quote, nav); `src/features/today/TodayPracticePanel.tsx` is
> the actual practice window it opens. **This plan puts the streak line on the menu,
> directly under the date**, because that is the surface literally titled with today's
> date and the one he sees on every launch. If he wants it on the practice window's header
> (`today-practice-head`, line 87 of TodayPracticePanel) instead or as well, that is a
> one-line move — but it is his call, not the implementer's.

- [ ] Failing tests: `src/features/streak/StreakLine.test.tsx`.

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreakLine } from "./StreakLine";

afterEach(cleanup);

describe("StreakLine", () => {
  it("names the current run and the best on record", () => {
    render(
      <StreakLine
        summary={{
          current_days: 4,
          best_days: 11,
          threshold_minutes: 10,
          today_focused_seconds: 900,
        }}
      />,
    );
    expect(screen.getByTestId("streak-line").textContent).toContain("4 day streak");
    expect(screen.getByTestId("streak-line").textContent).toContain("best 11");
  });

  it("says nothing at all when nothing has been earned", () => {
    const { container } = render(
      <StreakLine
        summary={{
          current_days: 0,
          best_days: 0,
          threshold_minutes: 10,
          today_focused_seconds: 0,
        }}
      />,
    );
    // No evidence, no visual: not a zero, not a dimmed placeholder — nothing.
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the summary is still loading", () => {
    const { container } = render(<StreakLine summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the best run alone once the current one has lapsed", () => {
    render(
      <StreakLine
        summary={{
          current_days: 0,
          best_days: 11,
          threshold_minutes: 10,
          today_focused_seconds: 0,
        }}
      />,
    );
    const line = screen.getByTestId("streak-line").textContent ?? "";
    expect(line).toContain("best 11");
    expect(line).not.toContain("day streak");
  });

  it("states the bar the day has to clear, so the number is never a mystery", () => {
    render(
      <StreakLine
        summary={{
          current_days: 2,
          best_days: 2,
          threshold_minutes: 25,
          today_focused_seconds: 300,
        }}
      />,
    );
    expect(screen.getByTestId("streak-line").getAttribute("title")).toContain(
      "25 focused minutes",
    );
  });
});
```

      and `src/devMock/tauriDevMock.streakSummary.test.ts`, following
      `tauriDevMock.historyDays.test.ts` exactly:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import type { StreakSummary } from "../features/streak/api";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

describe("dev-mock streak_summary handler", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("returns a deterministic, internally consistent summary", async () => {
    const a = await seamInvoke<StreakSummary>("streak_summary");
    const b = await seamInvoke<StreakSummary>("streak_summary");
    expect(a).toEqual(b);
    expect(a.best_days).toBeGreaterThanOrEqual(a.current_days);
    expect(a.threshold_minutes).toBe(10);
    expect(a.today_focused_seconds).toBeGreaterThanOrEqual(
      a.current_days > 0 ? a.threshold_minutes * 60 : 0,
    );
  });
});
```

- [ ] Run `npx vitest run src/features/streak src/devMock/tauriDevMock.streakSummary.test.ts`
      — expect unresolved imports for `./StreakLine` and `../features/streak/api`.
- [ ] Implementation: `src/features/streak/api.ts`

```ts
import { invoke } from "@tauri-apps/api/core";

// TypeScript mirror of `src-tauri/src/store/streaks.rs::StreakSummary`, field
// for field. Nothing here re-derives a streak; it only carries the already
// event-derived numbers across the wire.
export interface StreakSummary {
  current_days: number;
  best_days: number;
  threshold_minutes: number;
  today_focused_seconds: number;
}

export function streakSummary(): Promise<StreakSummary> {
  return invoke<StreakSummary>("streak_summary");
}
```

      `src/features/streak/useStreak.ts`

```ts
import { useEffect, useState } from "react";
import { streakSummary, type StreakSummary } from "./api";

/**
 * One read on mount. Deliberately not polled: a streak changes at LOCAL-day
 * granularity, and this app's streaming idiom is listen-then-fetch-once, never
 * a timer (see useMetronome). A failed read leaves the value null, which every
 * consumer renders as "nothing", never as a zero streak.
 */
export function useStreak(): StreakSummary | null {
  const [summary, setSummary] = useState<StreakSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void streakSummary()
      .then((next) => {
        if (alive) setSummary(next);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return summary;
}
```

      `src/features/streak/StreakLine.tsx`

```tsx
import type { StreakSummary } from "./api";
import "./streak.css";

/**
 * The one component both the Today menu and the Calendar header mount, so the
 * two surfaces can never disagree about the same number.
 *
 * Renders NOTHING when nothing has been earned — not a zero, not a greyed-out
 * "start your streak!" nudge. The earned-only law is a rendering rule, not just
 * a data rule: an unearned visual is still an unearned visual.
 */
export function StreakLine({ summary }: { summary: StreakSummary | null }) {
  if (!summary) return null;
  const { current_days, best_days, threshold_minutes } = summary;
  if (current_days === 0 && best_days === 0) return null;
  return (
    <p
      className="streak-line"
      data-testid="streak-line"
      title={`A day joins the streak at ${threshold_minutes} focused minutes.`}
    >
      {current_days > 0 && (
        <span className="streak-current">
          {current_days} day streak
        </span>
      )}
      {best_days > 0 && <span className="streak-best">best {best_days}</span>}
    </p>
  );
}
```

      `src/features/streak/streak.css` (existing paper tokens only)

```css
.streak-line {
  display: flex;
  gap: var(--s-3);
  align-items: baseline;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.streak-current {
  color: var(--ink);
  font-weight: 600;
}

.streak-best::before {
  content: "·";
  margin-right: var(--s-3);
  color: var(--rule);
}
```

- [ ] Mount it in both headers.
      `TodayWorkspace.tsx`: import `useStreak`/`StreakLine`, and directly after the date
      paragraph (`<p className="today-date today-menu-date">{todayLabel()}</p>`, line 94)
      render `<StreakLine summary={useStreak()} />` — hoisted to a
      `const streak = useStreak();` at the top of the component beside the existing
      `useHomeQuote` call (line 55), since hooks may not be called inline in JSX.
      `CalendarWorkspace.tsx`: `const streak = useStreak();` beside the other state hooks
      (lines 41-58) and `<StreakLine summary={streak} />` inside `.calendar-header`
      (line 229), before `.calendar-capacity` (line 232).
- [ ] Settings field: in `SettingsPanel.tsx`, inside the existing Calendar Disclosure
      (lines 588-604), directly after the "Calendar capacity" `NumberField`:

```tsx
          <NumberField
            label="Streak threshold (minutes)"
            value={value.streak_threshold_minutes}
            min={1}
            max={240}
            onChange={(streak_threshold_minutes) =>
              setValue({ ...value, streak_threshold_minutes })
            }
          />
```

      and add `streak_threshold_minutes: number;` to the settings snapshot type this file
      consumes.
- [ ] Shell: replace Task 2's placeholder with `const streak = useStreak();` and pass
      `streak={streak}` at `Shell.tsx:1042-1047`. This is where the galaxy's glow finally
      gets its evidence.
- [ ] devMock: add to `routeCommand` (beside `history_days`, line 3161)

```ts
    // Day streak (Task A2) — derived from the same fixture days history_days
    // serves, so the mock can never show a streak the mock history does not
    // support.
    case "streak_summary":
      return streakSummaryMock();
```

      with the helper defined near `historyDaysMock`:

```ts
const STREAK_THRESHOLD_MINUTES = 10;

function streakSummaryMock() {
  const qualifying = historyDaysFixture()
    .filter((day) => day.focused_seconds >= STREAK_THRESHOLD_MINUTES * 60)
    .map((day) => day.date)
    .sort();
  const today = todayLocal();
  return {
    current_days: trailingRun(qualifying, today),
    best_days: longestRun(qualifying),
    threshold_minutes: STREAK_THRESHOLD_MINUTES,
    today_focused_seconds:
      historyDaysFixture().find((day) => day.date === today)?.focused_seconds ?? 0,
  };
}
```

- [ ] Also add `streak_threshold_minutes: 10` to the devMock `SETTINGS_SNAPSHOT` constant
      (used by `settings_snapshot` at `tauriDevMock.ts:2767`).
- [ ] Run `npx vitest run src/features/streak src/features/today src/features/calendar
      src/features/settings src/devMock` + `npx tsc --noEmit` +
      `node .workflow/devmock-coverage-audit.mjs` (must report `streak_summary` covered).
- [ ] Commit `feat(streak): current+best streak in Today and Calendar, Settings threshold, devMock (A2)`.

### Task 5: Rust `day_photo_*` commands + devMock

> **Prerequisite gate.** This task consumes the schema-v15 `day_photo` table from the v7
> Foundations plan. Before writing a line, run
> `cd src-tauri && grep -n 'SCHEMA_VERSION' src/store/migrations.rs` — if it still says
> `14`, Foundations has not merged; STOP and land it first. At the time this plan was
> written it said `14` (`migrations.rs:11`), so expect to wait.
> **Column names are taken from the Foundations plan**
> (`docs/superpowers/plans/2026-08-23-codakiller-v7-foundations.md`, Task 2), which
> specifies:
> `day_photo(day TEXT PRIMARY KEY CHECK (day GLOB '____-__-__'), rel_path TEXT NOT NULL,
> content_hash TEXT NOT NULL, created_at TEXT NOT NULL)`.
> The queries below use `rel_path` and `created_at` accordingly. **Re-read the merged
> migration before writing them** — if Foundations changed shape during execution, the
> migration wins, not this plan.

**Files:**

- Create: `src-tauri/src/store/day_photos.rs` (row CRUD + inline tests),
  `src/devMock/tauriDevMock.dayPhoto.test.ts`
- Modify: `src-tauri/Cargo.toml` (declare `sha2 = "0.10"` — already at 0.10.9 in
  `Cargo.lock`, so zero new compilation; comment it the way `base64` at line 45 is
  commented), `src-tauri/src/store/mod.rs` (`mod day_photos;` + `pub use`),
  `src-tauri/src/lib.rs` (four `#[tauri::command]` fns + four `generate_handler!` entries
  at line 2240), `src/devMock/tauriDevMock.ts`
- Test: inline in `day_photos.rs`; `tauriDevMock.dayPhoto.test.ts`

**Interfaces (produces):**

- `day_photo_save(day: String, jpeg_base64: String, thumb_base64: String) -> ()` —
  writes `app_data_dir()/day-photos/<day>.jpg` and `<day>.thumb.jpg`, computes the
  SHA-256 of the FULL jpeg bytes, upserts one `day_photo` row keyed by day.
- `day_photo_thumbs(from: String, to: String) -> Vec<DayPhotoThumb>` where
  `DayPhotoThumb { day: String, thumb_base64: String }` — the Calendar week's one call.
- `day_photo_read(day: String) -> String` — the full jpeg as base64.
- `day_photo_delete(day: String) -> ()` — removes both files and the row.

Decisions, with reasons:

- **The row lives in `store/day_photos.rs`; the file I/O lives in the `lib.rs` command.**
  This follows the split the codebase already uses: `Store` never learns about
  `AppHandle`, and commands that need a directory resolve it themselves (precedent:
  `score_page_image`, `lib.rs:540-553`, which takes `app: AppHandle` and calls
  `app.path().app_cache_dir()`). `app_data_dir()` — not cache — because day photos are
  DURABLE; the score page cache is not (`lib.rs:2086`).
- **The thumbnail is generated in the FRONTEND** (`<canvas>`, ≤320px long edge) and both
  base64 strings arrive in ONE `day_photo_save` call. No image crate enters the Rust
  build: the 8 GB constraint says keep the dependency surface thin, and the webview
  already has a hardware-accelerated resampler.
- **Day key is the LOCAL calendar day** (`YYYY-MM-DD`), validated with
  `crate::date::is_valid` the way `history_day_detail` validates its date
  (`history_days.rs:352-355`).

- [ ] Failing Rust tests: add to `src-tauri/src/store/day_photos.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn a_saved_photo_round_trips_by_day() {
        let store = Store::open_in_memory().expect("store");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "abc123")
            .expect("upsert");
        let row = store.day_photo_row("2026-08-22").expect("read").expect("row");
        assert_eq!(row.day, "2026-08-22");
        assert_eq!(row.rel_path, "day-photos/2026-08-22.jpg");
        assert_eq!(row.content_hash, "abc123");
        assert!(!row.created_at.is_empty());
    }

    #[test]
    fn re_saving_a_day_replaces_it_rather_than_stacking_rows() {
        let store = Store::open_in_memory().expect("store");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "first")
            .expect("upsert");
        store
            .day_photo_upsert("2026-08-22", "day-photos/2026-08-22.jpg", "second")
            .expect("re-upsert");
        assert_eq!(
            store.day_photo_row("2026-08-22").unwrap().unwrap().content_hash,
            "second"
        );
        assert_eq!(store.day_photo_rows("2026-08-01", "2026-08-31").unwrap().len(), 1);
    }

    #[test]
    fn a_range_read_returns_only_days_inside_it_oldest_first() {
        let store = Store::open_in_memory().expect("store");
        for day in ["2026-08-10", "2026-08-22", "2026-09-02"] {
            store
                .day_photo_upsert(day, &format!("day-photos/{day}.jpg"), "h")
                .expect("upsert");
        }
        let rows = store.day_photo_rows("2026-08-01", "2026-08-31").expect("rows");
        assert_eq!(
            rows.iter().map(|r| r.day.as_str()).collect::<Vec<_>>(),
            vec!["2026-08-10", "2026-08-22"]
        );
    }

    #[test]
    fn a_day_with_no_photo_is_none_not_an_error() {
        let store = Store::open_in_memory().expect("store");
        assert!(store.day_photo_row("2026-08-22").expect("read").is_none());
        assert!(store.day_photo_rows("2026-08-01", "2026-08-31").unwrap().is_empty());
    }

    #[test]
    fn deleting_a_day_removes_its_row() {
        let store = Store::open_in_memory().expect("store");
        store.day_photo_upsert("2026-08-22", "p", "h").expect("upsert");
        store.day_photo_delete_row("2026-08-22").expect("delete");
        assert!(store.day_photo_row("2026-08-22").expect("read").is_none());
        // Deleting a day that was never photographed is a no-op, not an error.
        store.day_photo_delete_row("2026-08-22").expect("idempotent delete");
    }

    #[test]
    fn an_invalid_day_key_is_rejected_before_it_reaches_the_filesystem() {
        let store = Store::open_in_memory().expect("store");
        assert!(store.day_photo_upsert("../../etc/passwd", "p", "h").is_err());
        assert!(store.day_photo_upsert("2026-13-99", "p", "h").is_err());
        assert!(store.day_photo_row("not-a-date").is_err());
    }

    #[test]
    fn the_content_hash_is_stable_and_content_addressed() {
        assert_eq!(sha256_hex(b"hello"), sha256_hex(b"hello"));
        assert_ne!(sha256_hex(b"hello"), sha256_hex(b"hello!"));
        assert_eq!(sha256_hex(b"hello").len(), 64);
    }
}
```

- [ ] Run `cd src-tauri && cargo test day_photo` — expect compile failure.
- [ ] Implementation: `src-tauri/src/store/day_photos.rs`

```rust
//! A3: one row per LOCAL calendar day that has a practice photo.
//!
//! The IMAGE never enters the database. The row carries the day key, the path
//! relative to the app data dir, a SHA-256 of the full JPEG bytes, and when it
//! was created; the bytes live in `app_data_dir()/day-photos/`. That split is a
//! schema-v15 decision (spec: "Images are files under app data, never DB blobs")
//! and it keeps the durable practice database small enough to back up in one
//! copy.
//!
//! This module owns the ROW only. The filesystem half lives in the `day_photo_*`
//! commands in `lib.rs`, because resolving `app_data_dir()` needs an `AppHandle`
//! and `Store` deliberately knows nothing about Tauri (same split as
//! `score_page_image`).

use rusqlite::OptionalExtension;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::practice_v2::invalid;
use super::Store;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayPhotoRow {
    /// `YYYY-MM-DD`, local.
    pub day: String,
    /// Relative to the app data dir — never absolute, so a restored backup on a
    /// different machine still resolves.
    pub rel_path: String,
    /// SHA-256 hex of the full JPEG bytes.
    pub content_hash: String,
    pub created_at: String,
}

/// SHA-256 as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn checked_day(day: &str) -> rusqlite::Result<&str> {
    let day = day.trim();
    if !crate::date::is_valid(day) {
        return Err(invalid("day must be a valid YYYY-MM-DD local date"));
    }
    Ok(day)
}

impl Store {
    /// Insert or replace the row for `day`.
    pub(crate) fn day_photo_upsert(
        &self,
        day: &str,
        rel_path: &str,
        content_hash: &str,
    ) -> rusqlite::Result<()> {
        let day = checked_day(day)?;
        let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
        conn.execute(
            "INSERT INTO day_photo (day,rel_path,content_hash,created_at)
             VALUES (?1,?2,?3,datetime('now'))
             ON CONFLICT(day) DO UPDATE SET
               rel_path=excluded.rel_path,
               content_hash=excluded.content_hash,
               created_at=excluded.created_at",
            rusqlite::params![day, rel_path, content_hash],
        )?;
        Ok(())
    }

    pub(crate) fn day_photo_row(&self, day: &str) -> rusqlite::Result<Option<DayPhotoRow>> {
        let day = checked_day(day)?;
        let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT day,rel_path,content_hash,created_at FROM day_photo WHERE day=?1",
            [day],
            |row| {
                Ok(DayPhotoRow {
                    day: row.get(0)?,
                    rel_path: row.get(1)?,
                    content_hash: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()
    }

    pub(crate) fn day_photo_rows(
        &self,
        from: &str,
        to: &str,
    ) -> rusqlite::Result<Vec<DayPhotoRow>> {
        let from = checked_day(from)?;
        let to = checked_day(to)?;
        let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
        let mut stmt = conn.prepare(
            "SELECT day,rel_path,content_hash,created_at FROM day_photo
             WHERE day BETWEEN ?1 AND ?2 ORDER BY day ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![from, to], |row| {
            Ok(DayPhotoRow {
                day: row.get(0)?,
                rel_path: row.get(1)?,
                content_hash: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    /// Idempotent: deleting a day that was never photographed is a no-op.
    pub(crate) fn day_photo_delete_row(&self, day: &str) -> rusqlite::Result<()> {
        let day = checked_day(day)?;
        let conn = self.conn.lock().unwrap_or_else(|poison| poison.into_inner());
        conn.execute("DELETE FROM day_photo WHERE day=?1", [day])?;
        Ok(())
    }
}
```

- [ ] Wire it: `mod day_photos;` in `src-tauri/src/store/mod.rs` (declaration block, lines
      8-24) and `pub use day_photos::{sha256_hex, DayPhotoRow};` beside line 27.
- [ ] The four commands in `src-tauri/src/lib.rs`, after `streak_summary` from Task 3:

```rust
// ── Day photos (Plan A, task A3) ───────────────────────────────────────────
//
// The ritual's artefact. Bytes go to `app_data_dir()/day-photos/`; the database
// stores only the day key, the relative path and a content hash (schema v15).
// The thumbnail is produced by the FRONTEND canvas and arrives in the same call,
// so no image codec enters the Rust build.

/// Where day photos live. Created on first save.
fn day_photos_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?
        .join("day-photos");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create day-photos dir: {e}"))?;
    Ok(dir)
}

fn decode_jpeg(field: &str, value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("{field} is not valid base64: {e}"))
}

/// Write one day's full photo and its thumbnail, and record the row.
#[tauri::command]
fn day_photo_save(
    day: String,
    jpeg_base64: String,
    thumb_base64: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<(), String> {
    if !date::is_valid(day.trim()) {
        return Err("day must be a valid YYYY-MM-DD local date".into());
    }
    let day = day.trim().to_string();
    let full = decode_jpeg("jpeg_base64", &jpeg_base64)?;
    let thumb = decode_jpeg("thumb_base64", &thumb_base64)?;
    let dir = day_photos_dir(&app)?;
    std::fs::write(dir.join(format!("{day}.jpg")), &full)
        .map_err(|e| format!("write day photo: {e}"))?;
    std::fs::write(dir.join(format!("{day}.thumb.jpg")), &thumb)
        .map_err(|e| format!("write day photo thumbnail: {e}"))?;
    store
        .day_photo_upsert(
            &day,
            &format!("day-photos/{day}.jpg"),
            &store::sha256_hex(&full),
        )
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct DayPhotoThumb {
    day: String,
    thumb_base64: String,
}

/// Every photographed day in `[from,to]`, thumbnails only — one call per
/// visible Calendar week, never one per cell.
#[tauri::command]
fn day_photo_thumbs(
    from: String,
    to: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<Vec<DayPhotoThumb>, String> {
    use base64::Engine as _;
    let dir = day_photos_dir(&app)?;
    let rows = store
        .day_photo_rows(from.trim(), to.trim())
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            // A row whose file has gone missing renders as no photo, not as a
            // broken cell — the bars fall back automatically.
            let bytes = std::fs::read(dir.join(format!("{}.thumb.jpg", row.day))).ok()?;
            Some(DayPhotoThumb {
                day: row.day,
                thumb_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect())
}

/// One day's full-resolution photo.
#[tauri::command]
fn day_photo_read(
    day: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<String, String> {
    use base64::Engine as _;
    let row = store
        .day_photo_row(day.trim())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no photo recorded for {}", day.trim()))?;
    let bytes = std::fs::read(day_photos_dir(&app)?.join(format!("{}.jpg", row.day)))
        .map_err(|e| format!("read day photo: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Remove a day's photo — both files and the row.
#[tauri::command]
fn day_photo_delete(
    day: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<(), String> {
    let day = day.trim().to_string();
    let dir = day_photos_dir(&app)?;
    // Missing files are fine; the row is the record that matters.
    let _ = std::fs::remove_file(dir.join(format!("{day}.jpg")));
    let _ = std::fs::remove_file(dir.join(format!("{day}.thumb.jpg")));
    store.day_photo_delete_row(&day).map_err(|e| e.to_string())
}
```

      plus `day_photo_save, day_photo_thumbs, day_photo_read, day_photo_delete,` in
      `generate_handler!` at line 2240.
- [ ] devMock: four `routeCommand` cases plus an in-memory `DAY_PHOTOS` map cleared in
      `installTauriDevMock()`, and `src/devMock/tauriDevMock.dayPhoto.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTauriDevMock, uninstallTauriDevMock } from "./tauriDevMock";
import { todayLocal, addDays } from "../features/calendar/dates";

function seamInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<T> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
}

const JPEG = "/9j/4AAQSkZJRg==";
const THUMB = "/9j/4AAQSkZJRh==";

describe("dev-mock day_photo handlers", () => {
  beforeEach(() => installTauriDevMock());
  afterEach(() => uninstallTauriDevMock());

  it("saves, lists by range, reads back, and deletes", async () => {
    const today = todayLocal();
    await seamInvoke("day_photo_save", {
      day: today,
      jpegBase64: JPEG,
      thumbBase64: THUMB,
    });

    const thumbs = await seamInvoke<{ day: string; thumb_base64: string }[]>(
      "day_photo_thumbs",
      { from: addDays(today, -6), to: today },
    );
    expect(thumbs.map((t) => t.day)).toContain(today);
    expect(thumbs.find((t) => t.day === today)!.thumb_base64).toBe(THUMB);

    expect(await seamInvoke<string>("day_photo_read", { day: today })).toBe(JPEG);

    await seamInvoke("day_photo_delete", { day: today });
    const after = await seamInvoke<{ day: string }[]>("day_photo_thumbs", {
      from: addDays(today, -6),
      to: today,
    });
    expect(after.map((t) => t.day)).not.toContain(today);
  });

  it("returns nothing for a range with no photos, and rejects an unphotographed read", async () => {
    expect(
      await seamInvoke("day_photo_thumbs", { from: "1999-01-01", to: "1999-01-31" }),
    ).toEqual([]);
    await expect(
      seamInvoke("day_photo_read", { day: "1999-01-01" }),
    ).rejects.toBe("no photo recorded for 1999-01-01");
  });

  it("clears saved photos between installs", async () => {
    const today = todayLocal();
    await seamInvoke("day_photo_save", { day: today, jpegBase64: JPEG, thumbBase64: THUMB });
    uninstallTauriDevMock();
    installTauriDevMock();
    expect(
      await seamInvoke("day_photo_thumbs", { from: today, to: today }),
    ).toEqual([]);
  });
});
```

- [ ] Run `cd src-tauri && cargo test day_photo` then full `cargo test`,
      `cargo clippy --all-targets -- -D warnings`;
      `npx vitest run src/devMock/tauriDevMock.dayPhoto.test.ts`;
      `node .workflow/devmock-coverage-audit.mjs`.
- [ ] Commit `feat(photos): day_photo save/thumbs/read/delete commands + devMock (A3)`.

### Task 6: The day-close capture card — SessionBar hook + next-launch rollover prompt

**Files:**

- Create: `src/features/ritual/DayPhotoCapture.tsx`,
  `src/features/ritual/DayPhotoCapture.test.tsx`, `src/features/ritual/thumbnail.ts`,
  `src/features/ritual/thumbnail.test.ts`, `src/features/ritual/ritual.css`,
  `src/features/ritual/api.ts`
- Modify: `src/features/session/SessionBar.tsx` (after the inline End-day confirm at
  lines 117-149), `src/shell/Shell.tsx` (`endSession`, lines 824-832; the SessionBar mount
  at lines 992-1000), `src-tauri/src/sessions/mod.rs` (`rollover_close`, line 223 — emit a
  marker so the next launch can offer the prompt), `src/devMock/tauriDevMock.ts`
- Test: `DayPhotoCapture.test.tsx`, `thumbnail.test.ts`, updated `SessionBar` suite

**Interfaces:**

```ts
// src/features/ritual/thumbnail.ts
/** Longest edge of a stored thumbnail, in px. */
export const THUMB_MAX_EDGE = 320;

/** Draw `source` into a <=320px canvas and return base64 JPEG (no data: prefix). */
export function toThumbnailBase64(
  source: HTMLVideoElement | HTMLImageElement,
  maxEdge?: number,
): Promise<string>;

/** Full-size frame as base64 JPEG (no data: prefix). */
export function toFullBase64(
  source: HTMLVideoElement | HTMLImageElement,
): Promise<string>;
```

```tsx
// src/features/ritual/DayPhotoCapture.tsx
export interface DayPhotoCaptureProps {
  /** LOCAL day this photo belongs to. */
  day: string;
  /** Called after a successful day_photo_save, or on skip. */
  onDone: () => void;
  /** Test seam; production uses navigator.mediaDevices.getUserMedia. */
  getMedia?: () => Promise<MediaStream>;
}
export function DayPhotoCapture(props: DayPhotoCaptureProps): JSX.Element;
```

Behaviour bound by the spec ("skippable in one keypress — a ritual, not a toll"):

- Escape anywhere in the card skips. A single visible "Skip" button also skips. There is
  no confirm-your-skip step, ever.
- `getUserMedia` denial is not an error state: the card silently drops the video preview
  and shows the file-drop zone + file picker. The flow never blocks.
- Nothing is written unless a frame is actually captured — a skipped day has no row, and
  a day with no row renders the existing planned-vs-done bars (Task 7).

- [ ] Failing tests: `src/features/ritual/DayPhotoCapture.test.tsx`.

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./thumbnail", () => ({
  THUMB_MAX_EDGE: 320,
  toThumbnailBase64: () => Promise.resolve("THUMB64"),
  toFullBase64: () => Promise.resolve("FULL64"),
}));

import { DayPhotoCapture } from "./DayPhotoCapture";

const DAY = "2026-08-23";

function stream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});
afterEach(cleanup);

describe("DayPhotoCapture", () => {
  it("captures a frame and saves both sizes in ONE call", async () => {
    const onDone = vi.fn();
    render(
      <DayPhotoCapture day={DAY} onDone={onDone} getMedia={() => Promise.resolve(stream())} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Take today's photo" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("day_photo_save", {
        day: DAY,
        jpegBase64: "FULL64",
        thumbBase64: "THUMB64",
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("skips in one keypress and writes nothing", async () => {
    const onDone = vi.fn();
    const { container } = render(
      <DayPhotoCapture day={DAY} onDone={onDone} getMedia={() => Promise.resolve(stream())} />,
    );
    fireEvent.keyDown(container.firstChild as Element, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("skips in one button press too — never a two-step toll", async () => {
    const onDone = vi.fn();
    render(
      <DayPhotoCapture day={DAY} onDone={onDone} getMedia={() => Promise.resolve(stream())} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    // No "are you sure" anywhere.
    expect(screen.queryByText(/sure/i)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("falls back to file drop when the camera is denied, without an error state", async () => {
    render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() => Promise.reject(new DOMException("denied", "NotAllowedError"))}
      />,
    );
    expect(await screen.findByTestId("day-photo-dropzone")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Take today's photo" })).toBeNull();
    // The picker is still one press away.
    expect(screen.getByLabelText("Choose a photo")).toBeTruthy();
  });

  it("never uses window.confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <DayPhotoCapture day={DAY} onDone={vi.fn()} getMedia={() => Promise.resolve(stream())} />,
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("stops the camera track when it unmounts", async () => {
    const stop = vi.fn();
    const { unmount } = render(
      <DayPhotoCapture
        day={DAY}
        onDone={vi.fn()}
        getMedia={() =>
          Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
        }
      />,
    );
    await screen.findByRole("button", { name: "Take today's photo" });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("fits the 720x520 dense floor", async () => {
    const { container } = render(
      <DayPhotoCapture day={DAY} onDone={vi.fn()} getMedia={() => Promise.resolve(stream())} />,
    );
    const card = container.querySelector(".day-photo-card") as HTMLElement;
    expect(card.className).toContain("day-photo-card");
    // The card is width-capped in CSS, not by an inline pixel size that could
    // exceed the floor.
    expect(card.getAttribute("style")).toBeNull();
  });
});
```

      and `src/features/ritual/thumbnail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toThumbnailBase64, THUMB_MAX_EDGE } from "./thumbnail";

function fakeVideo(width: number, height: number) {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

describe("thumbnail", () => {
  it("never exceeds 320px on the long edge and preserves aspect ratio", async () => {
    const drawn: { w: number; h: number }[] = [];
    // jsdom has no canvas backend; the module exposes its sizing as a pure step.
    const { thumbnailSize } = await import("./thumbnail");
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [640, 480],
      [200, 100],
    ] as const) {
      const size = thumbnailSize(w, h, THUMB_MAX_EDGE);
      drawn.push({ w: size.width, h: size.height });
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(THUMB_MAX_EDGE);
      expect(size.width / size.height).toBeCloseTo(w / h, 2);
    }
    // A source already under the cap is not upscaled.
    expect(drawn[3]).toEqual({ w: 200, h: 100 });
  });

  it("rejects a source with no dimensions rather than writing a blank frame", async () => {
    await expect(toThumbnailBase64(fakeVideo(0, 0))).rejects.toThrow(
      /no frame/i,
    );
  });
});
```

- [ ] Run `npx vitest run src/features/ritual` — expect unresolved imports.
- [ ] Implementation: `thumbnail.ts` (pure `thumbnailSize` + canvas encode),
      `api.ts` (`dayPhotoSave/dayPhotoThumbs/dayPhotoRead/dayPhotoDelete` wrapping
      `invoke`, mirroring Task 5's signatures verbatim), `DayPhotoCapture.tsx`, and
      `ritual.css` using existing paper tokens (card on `--paper`, `--rule` border,
      `--ink` text; the capture button is the existing primary-button token set).

```tsx
/**
 * The day-close ritual card. A ritual, not a toll: Escape or one button press
 * leaves without writing anything, and a denied camera silently becomes a
 * file-drop card rather than an error the user has to dismiss.
 *
 * There is deliberately no window.confirm anywhere in this flow — wry/WKWebView
 * has returned falsy from it silently in the past (see SessionBar.tsx's comment
 * at line 111), and the whole point of this card is that it must never be able
 * to trap him at the end of a practice day.
 */
```

```tsx
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    const request = getMedia ?? (() =>
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }));
    void request()
      .then((next) => {
        if (!alive) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        setMode("camera");
        if (videoRef.current) videoRef.current.srcObject = next;
      })
      .catch(() => {
        // Denied, or no camera. Not an error — just the other path.
        if (alive) setMode("files");
      });
    return () => {
      alive = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [getMedia]);
```

- [ ] Hook it into the End-my-day flow. `SessionBar.tsx` keeps its inline confirm exactly
      as it is (lines 117-149); after `onEnd()` resolves, the SHELL shows the card — the
      bar is a slim strip and must not grow a modal. In `Shell.tsx`, extend `endSession`
      (lines 824-832):

```tsx
  const [photoDay, setPhotoDay] = useState<string | null>(null);

  const endSession = useCallback(async () => {
    setEnding(true);
    try {
      await session.endSession();
      // The ritual only follows a day that actually closed. A failed end throws
      // above this line and never reaches the card.
      setPhotoDay(todayLocal());
    } catch {
      // useSession preserves the live session and publishes the receipt.
    } finally {
      setEnding(false);
    }
  }, [session]);
```

      and render `{photoDay && <DayPhotoCapture day={photoDay} onDone={() => setPhotoDay(null)} />}`
      at shell level beside the existing overlays.
- [ ] Next-launch prompt for a midnight auto-close. `sessions/mod.rs::rollover_close`
      (line 223) already appends `SESSION_END` for the retroactively closed day; add — as
      the last step of that function, after the `SESSION_END` append — a record of the day
      that closed unattended, then a `day_photo_prompt() -> Option<String>` command that
      returns that day IF it has no `day_photo` row yet, and `None` once photographed or
      skipped. Shell calls it once on mount and sets `photoDay` from it.

```rust
        // A5/A3: the day closed while nobody was here. Remember WHICH day, so
        // the next launch can offer its photo — the ritual should not be lost
        // just because the rollover happened at 00:00.
        if let Err(e) = self.store.set_setting("ritual.unphotographed_day", last_ts) {
            eprintln!("session: failed to record rollover day for the photo prompt: {e}");
        }
```

      **Note for the implementer:** verify `Store::set_setting`'s exact name against the
      generic `setting` key/value helpers before writing this — `settings.rs` reaches them
      through `string()`/`integer()` readers and `update()`'s writer, and the store-level
      setter may be named differently. Match what is actually there.
- [ ] Run `npx vitest run src/features/ritual src/features/session src/shell` +
      `npx tsc --noEmit` + `cd src-tauri && cargo test sessions`.
- [ ] Commit `feat(ritual): day-close photo capture card + next-launch rollover prompt (A3)`.

### Task 7: Calendar day cells render photo thumbnails Liftoff-style

**Files:**

- Modify: `src/features/calendar/CalendarWorkspace.tsx` (the `DayCell` component — its
  props destructure at lines 399-411, its `<section className="calendar-day">` at
  line 420, and the `{/* v7: streak/photo layer slots here */}` marker left by Plan B at
  **line 478**), `src/features/calendar/CalendarWorkspace.css`,
  `src/features/calendar/api.ts` (one `dayPhotoThumbs(from,to)` caller beside
  `historyDays`/`daySheetsRange` at lines 31-32), `src/features/calendar/types.ts`
- Test: `src/features/calendar/CalendarWorkspace.test.tsx`

**Interfaces:**

- `CalendarApi` gains `dayPhotoThumbs: (from: string, to: string) => Promise<DayPhotoThumb[]>`
  where `DayPhotoThumb { day: string; thumb_base64: string }`.
- The week fetch issues **ONE** `day_photo_thumbs` call per visible week, alongside the
  existing single `history_days` + single `day_sheets_range` calls — never one per cell.
- `DayCell` gains `photo: string | null` (the base64 thumb, or null). When present it
  renders as the cell background and the planned-vs-done block is REPLACED by a compact
  overlay caption; when absent the cell renders exactly as it does today.

- [ ] Failing tests: add to `CalendarWorkspace.test.tsx`.

```tsx
  it("fetches the week's photo thumbnails in ONE call, not one per cell", async () => {
    const api = mockApi();
    render(<CalendarWorkspace api={api} initialToday={TODAY} />);
    await screen.findByTestId("calendar-workspace");
    await waitFor(() => expect(api.dayPhotoThumbs).toHaveBeenCalledTimes(1));
    expect(api.dayPhotoThumbs).toHaveBeenCalledWith(WEEK_START, WEEK_END);
  });

  it("renders a photographed day Liftoff-style, as the cell's own background", async () => {
    const api = mockApi({
      dayPhotoThumbs: vi.fn().mockResolvedValue([
        { day: TODAY, thumb_base64: "THUMB64" },
      ]),
    });
    const { container } = render(<CalendarWorkspace api={api} initialToday={TODAY} />);
    await screen.findByTestId("calendar-workspace");
    const cell = await waitFor(() =>
      container.querySelector(`.calendar-day[data-date="${TODAY}"]`) as HTMLElement,
    );
    const photo = cell.querySelector(".calendar-day-photo") as HTMLElement;
    expect(photo).toBeTruthy();
    expect(photo.style.backgroundImage).toContain("data:image/jpeg;base64,THUMB64");
    expect(photo.getAttribute("data-evidence")).toBe("day_photo");
  });

  it("leaves a practice day WITHOUT a photo exactly as it was — bars unchanged", async () => {
    const api = mockApi({ dayPhotoThumbs: vi.fn().mockResolvedValue([]) });
    const { container } = render(<CalendarWorkspace api={api} initialToday={TODAY} />);
    await screen.findByTestId("calendar-workspace");
    const cell = await waitFor(() =>
      container.querySelector(`.calendar-day[data-date="${TODAY}"]`) as HTMLElement,
    );
    expect(cell.querySelector(".calendar-day-photo")).toBeNull();
    expect(cell.querySelector(".calendar-day-progress-bars")).toBeTruthy();
    expect(cell.textContent).toContain("planned");
    expect(cell.textContent).toContain("done");
  });

  it("no evidence, no visual: a day with neither photo nor practice renders neither", async () => {
    const api = mockApi({
      dayPhotoThumbs: vi.fn().mockResolvedValue([]),
      historyDays: vi.fn().mockResolvedValue([]),
      daySheetsRange: vi.fn().mockResolvedValue([]),
    });
    const { container } = render(<CalendarWorkspace api={api} initialToday={TODAY} />);
    await screen.findByTestId("calendar-workspace");
    for (const cell of container.querySelectorAll(".calendar-day")) {
      expect(cell.querySelector(".calendar-day-photo")).toBeNull();
      expect(cell.querySelector(".calendar-day-progress")).toBeNull();
    }
  });

  it("survives a photo read that fails without breaking the week", async () => {
    const api = mockApi({
      dayPhotoThumbs: vi.fn().mockRejectedValue("day-photos dir unavailable"),
    });
    const { container } = render(<CalendarWorkspace api={api} initialToday={TODAY} />);
    await screen.findByTestId("calendar-workspace");
    // The bars still render; the photo layer simply is not there.
    await waitFor(() =>
      expect(container.querySelector(".calendar-day-progress-bars")).toBeTruthy(),
    );
    expect(container.querySelectorAll(".calendar-day")).toHaveLength(7);
  });
```

- [ ] Run `npx vitest run src/features/calendar/CalendarWorkspace.test.tsx` — expect
      failures on the missing `dayPhotoThumbs` api member and `.calendar-day-photo`.
- [ ] Implementation: add `data-date={date}` to the day `<section>` (line 420-423), thread
      `photo` down, and replace the marker at line 478 with:

```tsx
      {photo ? (
        // Liftoff-style: the day IS the picture. The planned-vs-done numbers
        // survive as one caption line over the image rather than as bars, so a
        // photographed day still reports its practice truth.
        <div
          className="calendar-day-photo"
          data-evidence="day_photo"
          role="img"
          aria-label={`Practice photo for ${label.weekday} ${label.date}`}
          style={{ backgroundImage: `url(data:image/jpeg;base64,${photo})` }}
        >
          {progress && progress.doneMinutes > 0 && (
            <span className="calendar-day-photo-caption">
              {progress.doneMinutes} done
            </span>
          )}
        </div>
      ) : null}
```

      with the existing `{progress && (...)}` block (lines 437-476) gated to
      `{!photo && progress && (...)}` — the one-line change that makes "a day with
      practice but no photo shows the existing planned-vs-done bars unchanged" literally
      true.
- [ ] CSS (existing tokens only):

```css
.calendar-day-photo {
  position: relative;
  min-height: 3.5rem;
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  background-size: cover;
  background-position: center;
  margin-block: var(--s-2);
}

.calendar-day-photo-caption {
  position: absolute;
  inset-inline-start: var(--s-2);
  inset-block-end: var(--s-2);
  padding: 0 var(--s-2);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-xs);
  border-radius: var(--radius-sm);
}
```

- [ ] Run `npx vitest run src/features/calendar` + `npx tsc --noEmit`.
- [ ] Commit `feat(calendar): Liftoff-style photo thumbnails in day cells (A3)`.

### Task 8: `completionFx` — three moments, CSS-only, never input-blocking

**Files:**

- Create: `src/features/ritual/completionFx.tsx`,
  `src/features/ritual/completionFx.test.tsx`,
  `src/features/ritual/completionFx.css`
- Modify: `src/features/rep/useRep.ts` (the `rep://state` listener at lines 768-804 is the
  transition source), `src/shell/Shell.tsx` (mount the overlay host once, at shell level,
  and fire `day_close` from `endSession` at lines 824-832)
- Test: `completionFx.test.tsx`

**Interfaces:**

```tsx
export type CompletionMoment = "set_complete" | "mastery_landing" | "day_close";

/**
 * Which moment (if any) a rep-snapshot transition just crossed. PURE: two
 * snapshots in, at most one moment out. This is the whole detection layer —
 * there is no separate event, no new command and no new audio path.
 */
export function detectMoment(
  previous: RepSnapshot | null,
  next: RepSnapshot | null,
): CompletionMoment | null;

/** Fire-and-forget; the overlay removes itself. */
export function useCompletionFx(): {
  fire: (moment: CompletionMoment) => void;
  overlay: JSX.Element | null;
};
```

Bindings from the spec and the codebase:

- **set complete** = `set_state` leaves `"active"` for a non-`"mastered"` terminal state
  (the values are `"active" | "paused" | "mastered"`, enforced at
  `src-tauri/src/store/practice_v2.rs:1135` and set at `:1358`).
- **mastery landing** = `set_state` becomes `"mastered"` (written at
  `practice_v2.rs:1246`) OR `mastery_status` crosses to `"satisfied"`
  (`useRep.ts:176-178`, `repMasteryStatus` at `:188`). Mastery wins over set-complete when
  both would fire — you land mastery once.
- **day close** = fired explicitly by `Shell.endSession` after the session ends, alongside
  the A3 capture card.
- **Audio:** none added. The existing ack policy already covers these moments — routine
  confirmations chime via `Confirm::chime` (`src-tauri/src/voice_loop.rs:289`, implemented
  at `:318-325` over `audio::chime::ack_chime`, `src-tauri/src/audio/chime.rs:65`) and
  info-carrying acks speak via `Confirm::say` (`voice_loop.rs:286`, `:314-317`). The
  overlay is purely visual and MUST NOT construct an `Audio` object; the one UI-local
  chime in the app (`ClockPanel.tsx:158-167`, `/chime.wav`) is a timer affordance and is
  not a precedent for this.

- [ ] Failing tests: `src/features/ritual/completionFx.test.tsx`.

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectMoment, useCompletionFx } from "./completionFx";
import type { RepSnapshot } from "../rep/useRep";

const BASE = {
  block_id: 1,
  set_state: "active",
  mastery_status: "not_satisfied",
} as unknown as RepSnapshot;

function snap(over: Partial<RepSnapshot>): RepSnapshot {
  return { ...BASE, ...over } as RepSnapshot;
}

afterEach(cleanup);

describe("detectMoment", () => {
  it("fires set_complete when an active set leaves the piano", () => {
    expect(detectMoment(snap({}), snap({ set_state: "paused" }))).toBe("set_complete");
    expect(detectMoment(snap({}), null)).toBe("set_complete");
  });

  it("fires mastery_landing, not set_complete, when mastery lands", () => {
    expect(
      detectMoment(snap({}), snap({ set_state: "mastered", mastery_status: "satisfied" })),
    ).toBe("mastery_landing");
    expect(detectMoment(snap({}), snap({ mastery_status: "satisfied" }))).toBe(
      "mastery_landing",
    );
  });

  it("fires nothing without a transition — no evidence, no visual", () => {
    expect(detectMoment(null, null)).toBeNull();
    expect(detectMoment(snap({}), snap({}))).toBeNull();
    expect(detectMoment(null, snap({}))).toBeNull(); // opening a set is not completing one
    // A different block replacing the current one is a switch, not a landing.
    expect(detectMoment(snap({}), snap({ block_id: 2 }))).toBeNull();
    // Already-satisfied stays satisfied: it does not re-fire on every tick.
    expect(
      detectMoment(
        snap({ mastery_status: "satisfied" }),
        snap({ mastery_status: "satisfied" }),
      ),
    ).toBeNull();
  });
});

describe("useCompletionFx", () => {
  function Host() {
    const { fire, overlay } = useCompletionFx();
    return (
      <div>
        <button type="button" onClick={() => fire("day_close")}>
          go
        </button>
        {overlay}
      </div>
    );
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a non-blocking overlay and removes it inside 1.5s", () => {
    render(<Host />);
    act(() => screen.getByRole("button", { name: "go" }).click());
    const overlay = screen.getByTestId("completion-fx");
    expect(overlay.getAttribute("data-moment")).toBe("day_close");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    act(() => void vi.advanceTimersByTime(1_500));
    expect(screen.queryByTestId("completion-fx")).toBeNull();
  });

  it("never blocks input", () => {
    render(<Host />);
    act(() => screen.getByRole("button", { name: "go" }).click());
    const overlay = screen.getByTestId("completion-fx");
    expect(overlay.className).toContain("completion-fx");
    // The rule is expressed in CSS, so assert it there rather than trusting a
    // computed style jsdom does not fully implement.
    const css = readFileSync(
      fileURLToPath(new URL("./completionFx.css", import.meta.url)),
      "utf8",
    );
    expect(css).toMatch(/\.completion-fx\s*\{[^}]*pointer-events:\s*none/);
  });

  it("is deterministic — no randomness anywhere in the module", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./completionFx.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("requestAnimationFrame");
  });

  it("opens no audio path of its own", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./completionFx.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("new Audio");
    expect(source).not.toContain("AudioContext");
  });

  it("collapses to a single static fade under reduced motion, CSS-only", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./completionFx.css", import.meta.url)),
      "utf8",
    );
    expect(css).toMatch(/@keyframes completion-bloom/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("completion-fade");
    expect(css).not.toContain("matchMedia");
  });

  it("every animation is under 1.5s", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./completionFx.css", import.meta.url)),
      "utf8",
    );
    for (const [, seconds] of css.matchAll(/animation:[^;]*?([\d.]+)s/g)) {
      expect(Number(seconds)).toBeLessThan(1.5);
    }
  });
});
```

- [ ] Run `npx vitest run src/features/ritual/completionFx.test.tsx` — expect unresolved
      import.
- [ ] Implementation: `completionFx.tsx`

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepSnapshot } from "../rep/useRep";
import "./completionFx.css";

/**
 * The three completion moments (spec A4): set complete, mastery landing, day
 * close. One module, one overlay, three data-moment variants.
 *
 * Rules this module keeps:
 *   - CSS-only. No requestAnimationFrame, no Math.random, no timeline library.
 *     The only JS timer is the one that unmounts the overlay.
 *   - pointer-events: none, and it removes itself. It can never sit on top of
 *     something he is trying to press.
 *   - No new audio path. The existing ack policy already covers these moments
 *     (Confirm::chime for routine confirmations, Confirm::say when there is
 *     something to say); this layer is purely visual.
 *   - Deterministic: the same transition always produces the same flourish.
 */

export type CompletionMoment = "set_complete" | "mastery_landing" | "day_close";

/** Long enough to read as a flourish, comfortably under the 1.5s ceiling. */
const FX_DURATION_MS = 1_100;

function satisfied(snapshot: RepSnapshot | null): boolean {
  return snapshot?.mastery_status === "satisfied";
}

export function detectMoment(
  previous: RepSnapshot | null,
  next: RepSnapshot | null,
): CompletionMoment | null {
  if (!previous) return null;
  // A different set replacing this one is a switch, not a completion.
  if (next && next.block_id !== previous.block_id) return null;
  // Mastery outranks set-completion: you land mastery once, and that is the
  // moment worth marking.
  if (!satisfied(previous) && (satisfied(next) || next?.set_state === "mastered")) {
    return "mastery_landing";
  }
  if (previous.set_state === "active" && next?.set_state !== "active") {
    return "set_complete";
  }
  return null;
}

export function useCompletionFx() {
  const [moment, setMoment] = useState<CompletionMoment | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((next: CompletionMoment) => {
    if (timer.current) clearTimeout(timer.current);
    setMoment(next);
    timer.current = setTimeout(() => setMoment(null), FX_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    fire,
    overlay: moment ? (
      <div
        className="completion-fx"
        data-testid="completion-fx"
        data-moment={moment}
        // Decorative, and it must not steal a screen reader's attention from
        // whatever the user is actually doing.
        aria-hidden="true"
      >
        <span className="completion-fx-mark" />
      </div>
    ) : null,
  };
}
```

      `completionFx.css`

```css
.completion-fx {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  /* The non-negotiable line: this layer can never intercept a press. */
  pointer-events: none;
  z-index: 45;
}

.completion-fx-mark {
  width: 4rem;
  height: 4rem;
  border: 2px solid var(--ink);
  border-radius: 50%;
  opacity: 0;
  animation: completion-bloom 1.1s ease-out 1 forwards;
}

.completion-fx[data-moment="mastery_landing"] .completion-fx-mark {
  border-color: var(--accent);
  width: 5.5rem;
  height: 5.5rem;
}

.completion-fx[data-moment="day_close"] .completion-fx-mark {
  border-style: dashed;
}

@keyframes completion-bloom {
  0% { opacity: 0; transform: scale(0.6); }
  35% { opacity: 0.9; }
  100% { opacity: 0; transform: scale(1.35); }
}

@keyframes completion-fade {
  0% { opacity: 0; }
  30%, 70% { opacity: 0.7; }
  100% { opacity: 0; }
}

/* One static fade, no scale, no travel. */
@media (prefers-reduced-motion: reduce) {
  .completion-fx-mark {
    animation: completion-fade 1.1s linear 1 forwards !important;
    transform: none !important;
  }
}
```

- [ ] Integration point 1+2 (set complete, mastery landing): in `Shell.tsx`, keep a
      `useRef<RepSnapshot | null>` of the previous `rep.snap` and call
      `fire(detectMoment(previous, rep.snap))` in an effect keyed on `rep.snap`. This
      reads the SAME `rep://state` projection `useRep.ts:768-804` already publishes — no
      new event, no new command, and no change to the rep hot loop.
- [ ] Integration point 3 (day close): in `Shell.endSession` (lines 824-832), call
      `fire("day_close")` on the same success branch that sets `photoDay` — the flourish
      and the capture card arrive together.
- [ ] Run `npx vitest run src/features/ritual src/features/rep src/shell` +
      `npx tsc --noEmit`.
- [ ] Commit `feat(ritual): completion flourishes for set complete, mastery landing, day close (A4)`.

### Task 9: Gates, live QA, protocol, merge

- [ ] Full gates, all from a clean tree:
      `npx vitest run` (0 fail), `npx tsc --noEmit`,
      `cd src-tauri && cargo test` (0 fail),
      `cargo clippy --all-targets -- -D warnings`, `npm run build`,
      `node .workflow/devmock-coverage-audit.mjs` (must show all five new commands —
      `streak_summary`, `day_photo_save`, `day_photo_thumbs`, `day_photo_read`,
      `day_photo_delete` — covered, plus `day_photo_prompt` if Task 6 added it).
- [ ] CSS token audit: `grep -o 'var(--[a-z0-9-]*)' src/features/**/*.css | sort -u`
      compared against `src/design/tokens.css` — every token referenced by the new
      galaxy/streak/ritual/photo CSS must already be defined there, and no previously
      defined token may have been removed or renamed (LEDGER 22).
- [ ] Earned-only sweep: `grep -rn 'data-evidence' src/features/` — every galaxy visual,
      every photo cell and every streak number must be traceable, and the four
      "no evidence → no visual" tests (Tasks 1, 4, 7 and `detectMoment`'s null cases in
      Task 8) must all be present and green.
- [ ] **Screenshot QA at 720×520 AND at Christian's real window size** (LEDGER 25), in
      `npm run dev:mock` with fresh localStorage, capturing both sizes for every item:
      1. Galaxy — **no active streak**: stars twinkle, no glow rings anywhere.
      2. Galaxy — **active streak** (devMock fixture with ≥1 qualifying day): every star
         carries its glow ring.
      3. Galaxy — **with orbiting mastered regions**: bodies visible and turning; confirm
         the count matches the fixture's `mastery_contracts_completed > 0` regions.
      4. Galaxy — **with NO mastered regions** (fixture variant): stars, no bodies.
      5. Galaxy — **reduced motion ON** (macOS System Settings → Accessibility → Display →
         Reduce motion): a completely still picture, bodies parked at their hashed angles.
      6. Galaxy — **reduced motion OFF**: motion present, no jitter, no layout shift.
      7. Galaxy — the composer index below still reads as paper; DetailPanel still opens
         from both a star and a card; `onOpenPractice` deep link still lands on Score.
      8. Calendar week — **with photo thumbnails** on 2+ days, mixed with bar-only days:
         photographed cells show the image, unphotographed practice days show unchanged
         planned-vs-done bars.
      9. Calendar week — **no photos at all**: byte-identical to v6 behaviour.
      10. Today menu + Calendar header — streak line present and identical in both; a
          fixture with `current_days: 0, best_days: 0` shows NOTHING on either surface.
      11. Settings → streak threshold field: change it to 60, reload, confirm the streak
          number changes and the tooltip text follows.
      12. Day-close capture card — **webcam available**: End my day → inline confirm →
          card with live preview → capture → the day appears in the Calendar next week
          render.
      13. Day-close capture card — **camera denied** (deny at the macOS prompt, or run in
          a context without camera access): file-drop zone + picker, no error state, flow
          completes.
      14. Day-close capture card — **skip**: Escape once, and separately the Skip button
          once; nothing is written either time (confirm no new Calendar thumbnail).
      15. Completion animation — **set complete**, reduced motion OFF then ON.
      16. Completion animation — **mastery landing**, reduced motion OFF then ON.
      17. Completion animation — **day close**, reduced motion OFF then ON.
      18. Adversarial: click straight through each overlay while it is on screen (must
          land on the control beneath); fire three moments in rapid succession (one
          overlay, no stacking); navigate away from the galaxy mid-animation; spam week
          navigation while photos are loading.
      19. Console error-free throughout (Settings is now safe to open — but if the known
          B63 behaviour reappears, record it rather than fixing it in this plan).
      20. **B75 rides along:** run measure mapping once on a real score during this pass,
          so the headline v6 feature finally has a live datapoint (LEDGER 26).
- [ ] Whole-branch review with the most capable model over the entire `v7/plan-a` diff,
      then triage. ONE fix wave if there are findings, then a scoped re-review of just the
      changed files. Per LEDGER 24, each non-trivial slice also gets a fresh-context
      adversarial verification pass before it counts as done — do not skip these because
      the suites are green.
- [ ] UPDATE PROTOCOL (repo `CLAUDE.md`, binding):
      - vault `(C) Changelog.md` — date · what · why · files, for all four features.
      - vault `(C) Roadmap.md` — v7 Plan A done; Plans B and C still open.
      - vault `(C) CodaKiller Command Center.md` — status line + threads.
      - vault `CodaKiller.md` — portable summary + its `Last updated:` line.
      - vault `(C) Flaws.md` — record the deliberate deltas, never delete an entry:
        (1) `universe.css`'s "NO ambient animation / no @keyframes" rule retired for the
        galaxy block by design, with the reduced-motion guarantee that replaces it;
        (2) the streak is read-only with no table, so it can never be granted;
        (3) day-photo thumbnails are frontend-generated, so no image codec entered the
        Rust build; (4) the Today streak placement decision (menu, not practice window)
        and the fact it was Christian's call.
      - vault `(C) How To Use.md` — user-facing changes DO exist here (the galaxy view,
        the streak line, the day-close photo card, the completion flourishes), so update
        it and bump its `Matches: vX.Y.Z` line.
      - repo `NOTES.md` — engineering facts worth keeping: FNV-1a as the orbit-phase
        hash and why; the backward streak walk and the today-or-yesterday anchor;
        `sha2` declared direct but already in the lock; the app-data-vs-cache choice for
        day photos; the "row in DB, bytes on disk" split.
      - repo `CLAUDE.md` — Status section refreshed.
      - `.workflow/LEDGER.md` — tick items 5, 6, 7, 8 and note 19/22/25 as satisfied for
        Plan A.
- [ ] Merge `v7/plan-a` → main (`--no-ff`). **No version bump, no tag, no DMG, no
      install** — v7.0.0 ships only after Plans B and C land and the full release
      mechanics (LEDGER 27) run.
