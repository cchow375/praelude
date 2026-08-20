# CodaKiller v6.0.1 "Real-Use Fixes" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the schema-free v6.0.1 patch: score toolbar overlap fix, dock ergonomics (mount clamp + defaults + reset), B70 voice tail-guard suppress-by-routed-intent, B72 nested-form fix.

**Architecture:** Four independent fixes, no schema change, no migration. Rust change is confined to `voice_loop.rs` (guard stores the routed `Intent` instead of phrase text; suppression compares intents after routing the final). Frontend changes are CSS reflow (`ScoreView.css`), dock state/provider hardening (`dockState.ts`, `DockProvider.tsx`, panel defaults), and one form de-nesting (`BooksPanel.tsx`) plus one Settings row (`SettingsPanel.tsx`).

**Tech Stack:** Tauri v2 — Rust (cargo test) + React/TS (vitest, RTL, jsdom). Live visual QA via `npm run dev:mock` in a browser at 720×520.

**Spec:** `docs/superpowers/specs/2026-08-20-codakiller-v6.0.1-fixes-v7-motivation-layer.md` (Part 1).

## Global Constraints

- No schema change, no migration, no new write paths — this is a patch.
- Every voice change re-passes the full narrated-corpus replay (finals AND partial-stream suites) with **zero false mutations**. No bare prefix word ever joins the fast-path allowlist (`FAST_PATH_PHRASES` stays exactly `["metronome off", "metronome stop", "metronome on"]`).
- All 85+ legacy CSS token names preserved; toolbar files use the `--space-*` token family (Banner/measureMapping use `--s-*` — do not "unify" them in this patch).
- The repo has NO container queries — use `@media` only, matching `ScoreView.css:1073`'s idiom.
- jsdom here has no `window.localStorage` (no setupFiles polyfill) — persistence tests assert via mocks/spies, not real storage. jsdom `getBoundingClientRect()` is all-zero unless stubbed via `vi.spyOn`.
- Window floor is **720×520** (`src-tauri/tauri.conf.json:18-19`); every visual change is screenshot-verified there.
- Commit per numbered task minimum; gates before ship: vitest all green, `cargo test` all green, `tsc` clean, `cargo clippy --all-targets -- -D warnings` clean, `npm run build` clean.
- Panels stay freely draggable — never restrict where Christian can PUT a panel, only where it LANDS by default/on mount.

---

### Task 1: B70 — tail guard suppresses by routed intent, not prefix

**Files:**

- Modify: `src-tauri/src/voice_loop.rs` (guard field ~L440, arm site ~L523-528, `is_fast_path_tail` ~L558-570, `route_and_act` ~L464-552)
- Maybe modify: `src-tauri/src/intent/mod.rs` (derive `PartialEq` on `Intent`/`MetroSetArgs` if not already derived)
- Test: `src-tauri/src/voice_loop.rs` `#[cfg(test)]` FAST PATH section (~L1605+)

**Interfaces:**

- Consumes: `Router::route(text, mode) -> Intent` (pure, stateless, `intent/mod.rs:154`); `crate::intent::canonicalize`; `DEDUP_WINDOW` (2500 ms, L208); `replay_partial_stream` test helper (L1622-1634).
- Produces: guard field becomes `fast_path: Option<(Intent, Instant)>`; `is_fast_path_tail` is replaced by an intent-comparison check inside `route_and_act` — no other module touches these (all private to `voice_loop.rs`).

- [ ] **Step 1: Write the two failing regression tests (the B70 scenarios), in the existing partial-stream idiom**

In the FAST PATH test section, following the exact pattern of `corpus_prefix_collisions_replayed_as_partials_stay_inert` (L1665) — snapshot state before, replay, assert after:

```rust
#[test]
fn a_final_with_a_different_intent_is_not_swallowed_by_the_tail_guard() {
    // B70(a): "metronome on ninety six" — fast path fires MetroStart(None) on the
    // "metronome on" partial; the settled final routes MetroStart(Some(96)) and
    // MUST reach the router so the tempo is set.
    let (mut ctx, rec) = test_ctx_with_metronome_stopped(); // use the section's existing ctx helper
    replay_partial_stream(&mut ctx, "metronome on ninety six", t0());
    assert!(ctx.metro_running(), "click should be running");
    assert_eq!(ctx.metro_bpm(), 96.0, "the settled final must set 96, not keep the old tempo");
}

#[test]
fn an_ambient_final_routing_to_ignored_does_not_phantom_act() {
    // B70(b): a real "metronome off" fast-path fire, then within the window an
    // UNRELATED ambient final that merely starts with the phrase but routes to
    // Ignored. It must not be swallowed (it shows in the heard pill) and must
    // not re-act.
    let (mut ctx, rec) = test_ctx_with_metronome_running();
    replay_partial_stream(&mut ctx, "metronome off", t0());
    assert!(!ctx.metro_running());
    ctx.metro_start_for_test(80.0); // click deliberately restarted
    ctx.handle_final(&final_at("metronome off the whole time honestly", t0() + ms(1200)));
    assert!(ctx.metro_running(), "an Ignored-routing ambient sentence must not phantom-stop");
    assert!(rec.saw_transcript("metronome off the whole time honestly"), "final must surface, not be swallowed");
}
```

Adapt helper names (`test_ctx_*`, `t0`, `ms`, `final_at`, `rec.saw_transcript`) to the ones the surrounding tests actually use — the section already constructs contexts, recorders, and timestamped finals; copy its idiom exactly. Do not invent new helpers if an existing one fits.

- [ ] **Step 2: Run to verify both fail against current prefix semantics**

Run: `cd src-tauri && cargo test voice_loop -- a_final_with_a_different_intent an_ambient_final_routing`
Expected: FAIL — first keeps old bpm, second phantom-stops/swallows.

- [ ] **Step 3: Implement — store the routed intent; compare intents after routing**

1. Ensure `Intent` (and `MetroSetArgs`) derive `PartialEq` in `intent/mod.rs` (add to the existing derive list if absent).
2. Change the guard field (~L440): `fast_path: Option<(Intent, Instant)>`.
3. At the arm site (~L523-528), store the intent the fast path actually acted on (the routed intent of the fired partial — `handle_fast_path` routes it; thread that value through) instead of `canonicalize(&t.text)`.
4. In `route_and_act` (~L464-552): delete the pre-routing early return at L471-473. Route the final first (`let intent = Router::route(&t.text, &mode);` — already at ~L485), then:

```rust
if !via_fast_path {
    if let Some((fired, at)) = &self.fast_path {
        if t.at.duration_since(*at) <= DEDUP_WINDOW && intent == *fired {
            return; // the settled final of the same utterance — already acted
        }
    }
}
```

5. Delete `is_fast_path_tail` (~L558-570) and its callers; the block above replaces it.

- [ ] **Step 4: Update the three tests asserting the old prefix semantics**

- `the_settled_final_after_a_multi_word_fire_is_still_suppressed` (~L1795): still passes conceptually (same-intent final suppressed) — update only if it constructed the guard tuple directly.
- `fast_path_suppresses_a_final_that_extends_the_fired_phrase` (~L1976): keep IF its extending final routes to the same intent (e.g. "metronome off please" → MetroStop). If its fixture extends with a tempo ("metronome on 96"-like), it now asserts the OPPOSITE — rewrite its assertion to expect the tempo to land, and rename accordingly.
- `fast_path_guard_expires_with_the_dedup_window` (~L1998): semantics unchanged (window still applies); update construction to the new `(Intent, Instant)` tuple.
- `an_ignored_fast_path_partial_does_not_arm_the_guard` (~L2024): unchanged behavior; fix compile if the tuple type changed.

- [ ] **Step 5: Run the full voice suites + corpus gates**

Run: `cd src-tauri && cargo test` (all, not just voice_loop — the corpus/firewall suites live in the crate)
Expected: all green, zero false mutations reported by the corpus suites.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/voice_loop.rs src-tauri/src/intent/mod.rs
git commit -m "fix(voice): B70 — tail guard suppresses by routed intent, not prefix"
```

---

### Task 2: Score toolbar top-row reflow (B76)

**Files:**

- Modify: `src/features/score/ScoreView.css` (`.score-edition-group` L90-95, `.score-atlas-draw-hint` L130-137, `@media (max-width: 900px)` L1073-1086)

**Interfaces:**

- Consumes: existing tokens `--space-*`; grid defined at `ScoreView.css:40-52`.
- Produces: nothing consumed elsewhere — pure CSS.

- [ ] **Step 1: Let the edition group wrap and stop the hint widening the row**

In `ScoreView.css`:

```css
/* L90-95 — B76: six controls + a conditional hint cannot fit one non-wrapping
   row at narrow widths; wrap instead of colliding. */
.score-edition-group {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
}

/* L130-137 — the armed-target hint takes its own line instead of stretching
   the control row. */
.score-atlas-draw-hint {
  flex-basis: 100%;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-xs);
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

(Keep every existing declaration in those rules that isn't shown changed here.)

- [ ] **Step 2: Reflow the toolbar grid at the narrow breakpoint**

Replace the toolbar part of the 900px media query (L1073-1086) so the edition group gets the full first row and page/zoom share the second:

```css
@media (max-width: 900px) {
  .score-toolbar {
    grid-template-columns: auto 1fr;
  }
  .score-edition-group {
    grid-column: 1 / -1;
  }
  .score-zoom {
    justify-content: flex-end;
  }
  /* keep the existing .score-body { --score-sidebar-width: 340px; } rule */
}
```

- [ ] **Step 3: Visual QA at the floor and at real widths**

Run: `npm run dev:mock`, open in a browser, resize to exactly 720×520 and to ~1000×700. On the Score view verify, with screenshots saved to `docs/qa/v6.0.1-toolbar-720x520.png` (and `-1000x700.png`):

- all six edition-group controls visible and clickable, no element overlapping another;
- with target mode armed, the "Drag a rectangle…" hint sits on its own line;
- with a stale measure map and the pencil bar open simultaneously, the full top stack (toolbar rows + stale notice + pencil bar) still leaves the score page usable at 720×520.

**Decision point (by eye, per spec):** if the wrapped toolbar eats too much score height at 720×520, add the "⋯" overflow menu collapsing Draw target/Pencil/Map measures/Show measures at ≤ 900px — otherwise skip it (YAGNI). If the menu is needed, STOP and surface to the orchestrator; that is new UI and gets its own review.

- [ ] **Step 4: Run the frontend gates**

Run: `npm test && npx tsc --noEmit`
Expected: green (CSS-only change; catches accidental TSX touches).

- [ ] **Step 5: Commit**

```bash
git add src/features/score/ScoreView.css docs/qa/v6.0.1-toolbar-*.png
git commit -m "fix(score): B76 — toolbar top row wraps instead of overlapping at narrow widths"
```

---

### Task 3: Dock — mount-time re-clamp of persisted positions

**Files:**

- Modify: `src/features/dock/DockProvider.tsx` (`ensurePanel` L85-92)
- Modify: `src/features/dock/dockState.ts` (export a `reclampPanel` helper next to `clampPosition` L85-102)
- Test: `src/features/dock/dockOpenClamp.test.tsx` (existing idiom: per-defect `describe`, stubbed rects/rAF)

**Interfaces:**

- Consumes: `clampPosition(x, y, size, viewport, minVisible)` (`dockState.ts:85-102`), `MIN_VISIBLE_PX = 48` (L~102), `DockPanelState { x, y, minimized, open, z, flashing }` (L6-20).
- Produces: `ensurePanel(id, defaults)` now guarantees the returned panel's `(x, y)` is within-viewport per `clampPosition` even when the persisted blob predates a resize/display change. No signature change.

- [ ] **Step 1: Write the failing test**

In `dockOpenClamp.test.tsx`, new `describe("v6.0.1 — persisted off-viewport position is re-clamped on ensurePanel")`, following the file's existing mock idiom (stub viewport size, seed state as if loaded from storage with `x: 5000, y: 5000`, mount a panel, assert its effective position is clamped to keep ≥ `MIN_VISIBLE_PX` visible).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/dock/dockOpenClamp.test.tsx`
Expected: FAIL — `ensurePanel` reuses the persisted position verbatim (current L85-92 behavior).

- [ ] **Step 3: Implement**

In `dockState.ts`, add beside `clampPosition`:

```ts
/** Persisted positions can predate a resize or display change; never trust
 *  them past the current viewport. */
export function reclampPanel(
  p: DockPanelState,
  size: Size,
  viewport: Size,
): DockPanelState {
  const { x, y } = clampPosition(p.x, p.y, size, viewport, MIN_VISIBLE_PX);
  return x === p.x && y === p.y ? p : { ...p, x, y };
}
```

In `DockProvider.tsx` `ensurePanel`: on the panel-already-exists path, return `reclampPanel(existing, sizeFor(id), currentViewport())` (using whatever size/viewport accessors the provider already uses for its clamp effect at `DockPanel.tsx:113-144` — reuse, don't duplicate).

- [ ] **Step 4: Run the dock suites**

Run: `npx vitest run src/features/dock`
Expected: all green, including the pre-existing defect-1/2/4 suites.

- [ ] **Step 5: Commit**

```bash
git add src/features/dock/dockState.ts src/features/dock/DockProvider.tsx src/features/dock/dockOpenClamp.test.tsx
git commit -m "fix(dock): re-clamp persisted panel positions on ensurePanel"
```

---

### Task 4: Dock — defaults clear the score toolbar; Reset panel layout in Settings

**Files:**

- Modify: `src/features/dock/RepPanel.tsx` (`DEFAULT_POSITION` L17; tray/clock chain-stack from it automatically)
- Modify: `src/features/dock/dockState.ts` (add `resetDockLayout()`), `src/features/dock/DockProvider.tsx` (listen for reset)
- Modify: `src/features/settings/SettingsPanel.tsx` (Appearance disclosure L647-676)
- Test: `src/features/dock/dockDefaultLayout.test.ts`, `src/features/settings/SettingsPanel.test.tsx`

**Interfaces:**

- Consumes: `DOCK_STORAGE_KEY = "ck.dock.v1"` (`dockState.ts:27`), `NAV_RAIL_WIDTH = 148` (L244), panel default chain (RepPanel → PausedSetsTray → ClockPanel via `*_ASSUMED_MAX_HEIGHT`).
- Produces: `resetDockLayout(): void` in `dockState.ts` — clears the persisted blob and dispatches `window` event `"ck:dock-reset"`; `DockProvider` resets all panels to their `defaultPosition` on that event. `RepPanel.DEFAULT_POSITION.y` changes 16 → 72.

- [ ] **Step 1: Write the failing default-position test**

Extend `dockDefaultLayout.test.ts` (it already cross-checks defaults against `NAV_RAIL_WIDTH`): assert `REP DEFAULT_POSITION.y >= 64` with a comment naming the score toolbar's 46px min-height + padding as the strip no default may cover, and assert the tray/clock chain still stacks strictly below with the existing 24px gaps.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/dock/dockDefaultLayout.test.ts` → FAIL (y is 16).

- [ ] **Step 3: Implement the default shift**

`RepPanel.tsx:17`: `export const DEFAULT_POSITION = { x: NAV_RAIL_WIDTH + 12, y: 72 };` (tray and clock derive from it — verify no other hardcoded `y: 16` remains via `grep -n "y: 16" src/features/dock`).

- [ ] **Step 4: Write the failing reset tests**

- `dockState.test.ts`: `resetDockLayout` removes `DOCK_STORAGE_KEY` (spy on the storage accessor the module already guards with try/catch — jsdom has no localStorage, so mock the module boundary the way `loadDockState` tests do) and dispatches `"ck:dock-reset"`.
- `SettingsPanel.test.tsx`: the Appearance section renders a "Reset panel layout" button; clicking it calls `resetDockLayout` (mock the import).

- [ ] **Step 5: Run to verify both fail**, then **implement**:

`dockState.ts`:

```ts
export function resetDockLayout(): void {
  try {
    window.localStorage?.removeItem(DOCK_STORAGE_KEY);
  } catch {
    /* storage is best-effort everywhere in this module */
  }
  window.dispatchEvent(new Event("ck:dock-reset"));
}
```

`DockProvider.tsx`: a mount effect adds a `"ck:dock-reset"` listener that sets every registered panel back to its registered `defaultPosition` (open/minimized flags reset to their initial values too — a "reset" that keeps a panel lost-minimized is not a reset).

`SettingsPanel.tsx` (inside the Appearance `Disclosure`, matching the `Row` idiom at L698-713):

```tsx
<div className="settings-row">
  <span>Floating panels</span>
  <Button type="button" onClick={() => resetDockLayout()}>
    Reset panel layout
  </Button>
</div>
```

- [ ] **Step 6: Run** `npx vitest run src/features/dock src/features/settings` → green.

- [ ] **Step 7: Commit**

```bash
git add src/features/dock src/features/settings/SettingsPanel.tsx src/features/settings/SettingsPanel.test.tsx
git commit -m "fix(dock): defaults clear the score toolbar; add Reset panel layout to Settings"
```

---

### Task 5: B72 — de-nest the BooksPanel form

**Files:**

- Modify: `src/features/settings/BooksPanel.tsx` (form L154-219, submit button L205, handler `add` L82+)
- Test: existing BooksPanel coverage in `src/features/settings/` (find its test file; extend, don't replace)

**Interfaces:**

- Consumes: `add(event)` handler (keeps its guard `event.preventDefault?.()`), `Button` component.
- Produces: identical behavior — Add a book validates and calls `api.add(...)`; no `<form>` in the tree under SettingsPanel's `<form>` (L194).

- [ ] **Step 1: Write the failing structural test** — render SettingsPanel with the Books disclosure open; assert `container.querySelectorAll("form form").length === 0` and that the Add flow still calls the mocked `api.add` on click.
- [ ] **Step 2: Run to verify the nested-form assertion fails.**
- [ ] **Step 3: Implement** — `BooksPanel.tsx:154`: `<form className="books-add" aria-label="Add a book" onSubmit={add}>` → `<div className="books-add" role="group" aria-label="Add a book">`; the submit button becomes `type="button"` with `onClick={add}`; keep `event.preventDefault?.()` defensive in `add`. Enter-to-submit in the title/path inputs must keep working: add `onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(e); } }}` to the two text inputs (the old form gave Enter submit for free; do not regress it).
- [ ] **Step 4: Run** `npx vitest run src/features/settings` → green; also confirm no React dev-mode nested-form error in `npm run dev:mock` console.
- [ ] **Step 5: Commit**

```bash
git add src/features/settings/BooksPanel.tsx src/features/settings
git commit -m "fix(settings): B72 — Add a book is a group, not a form nested in a form"
```

---

### Task 6: Full gates, live QA, ship v6.0.1

**Files:**

- Modify: version metadata (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — wherever `6.0.0` is pinned; `grep -rn "6\.0\.0" package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`)
- Vault docs per the binding update protocol (Changelog, CodaKiller.md, Flaws — B70/B72/B76 → Resolved with commits, How To Use — un-caveat "metronome on 96"; NO `versions/` record: patch releases are Changelog-only)

**Steps:**

- [ ] **Step 1: Gates** — `npm test`, `npx tsc --noEmit`, `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`, `npm run build`. All green or the ship stops.
- [ ] **Step 2: Fresh-context adversarial verification** — a verifier with no build context gets the four claims (B70 scenarios behave; toolbar clean at 720×520; persisted off-screen panel recovers; no nested form) and tries to refute each against the built app (`npm run tauri dev` or dev:mock where sufficient). REFUTED ⇒ back to the offending task.
- [ ] **Step 3: Bump to 6.0.1, build, install** — follow the repo's release flow (`release:mac` script; `--bundles app` note in NOTES.md: the dmg step deletes the .app dir). Archive the current installed app to `~/Library/CodaKiller-rollbacks/CodaKiller-v6.0.0-rollback.app.tar.gz` **as tar.gz, never an unpacked .app** (Spotlight one-copy rule). Back up the live DB first: copy `~/Library/Application Support/com.christian.codakiller/codakiller.db` to the vault backups as `(C) pre-v6.0.1-install-<timestamp>.db` + SHA-256 (no migration in this patch, but the backup rule is unconditional). Quit + relaunch the installed app after install.
- [ ] **Step 4: Tag + docs** — `git tag v6.0.1`; run the full vault update protocol.
- [ ] **Step 5: Backup remote (deferred user step)** — when Christian runs `gh auth login`: `gh repo create codakiller --private --source=. --push`, then verify `git remote -v` and mark B54/C1 resolved.

---

## Self-Review (done at write time)

- **Spec coverage:** P1 → Task 2 (+ its decision point for the overflow menu); P2 → Tasks 3–4; P3 → Task 1; P4 → Task 5; P5 → Task 6. No spec item unowned.
- **Placeholder scan:** helper names in Task 1 Step 1 are explicitly flagged as adapt-to-local-idiom with the source line to copy from (L1665) — deliberate, since the test module's private helpers are the authority; everything else is concrete.
- **Type consistency:** `fast_path: Option<(Intent, Instant)>` used consistently in Task 1 steps 3–4; `reclampPanel`/`resetDockLayout` names consistent across Tasks 3–4.
