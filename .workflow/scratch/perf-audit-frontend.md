# CodaKiller React/TS Frontend Perf Audit (ledger 41/42/43 — React half)

Read-only. No code changed. Scope: `src/` (React 19, Tauri `invoke`, ~1248 tests).
Honesty bar: a prior 14-finding audit verified down to ONE real bug — every finding
below is traced file:line with verbatim code, the actual call/render frequency, and
a concrete before/after. Anything I couldn't trace that far is called out explicitly
as a non-finding rather than padded in.

Method: read the newest v4 surfaces in full (notebook/DaySheet.tsx, useDaySheet.ts,
useAutosavedDocument.ts, DaySheetStore.tsx, PassageHelper.tsx, ScorePlanTab.tsx,
quoteRotation.ts, firstPageCache.ts), the two React contexts in the whole app
(ReceiptCenter.tsx, DaySheetStore.tsx), the score render/zoom pipeline
(ScoreView.tsx, ScoreWorkspace.tsx), the HUD (RepHud.tsx, useRep.ts), the metronome
hook (useMetronome.ts), and grepped every `listen(`/`setInterval`/`setTimeout`/
`invoke(`/`.map(` site in `src/` to cross-check for outliers. `grep -rln
"React.memo|memo("` over `src/` (excluding tests) returned **zero hits** — the
codebase does not use `React.memo` anywhere, which shaped where I looked (there is
nothing to "defeat"; the question is whether re-render volume plus render-function
cost actually adds up to something measurable).

---

## 1. Unnecessary re-renders — 0 findings that clear the bar

Checked and found clean / by-design, not bugs:

- **`ReceiptCenter.tsx` (`ReceiptContext`)** — the publisher object is built with
  `useMemo(() => ({...}), [dismiss, publish])` (line 120-153), and `dismiss`/`publish`
  are themselves stable `useCallback`s. Context value is genuinely stable across
  unrelated re-renders. Correct.

- **`DaySheetStore.tsx` (`TodaySheetContext`)** — `TodaySheetProvider` passes
  `sheet` (the raw return of `useDaySheet(today)`) straight into
  `<TodaySheetContext.Provider value={sheet}>` (line 20) with no `useMemo`. In
  isolation this looks like the classic "unmemoized provider value" smell, but I
  traced it: `sheet.body` is itself a `useState` value that changes on literally
  every keystroke (that's the whole point — it's the live document), so every
  consumer (`TodayDaySheet`, `ScorePlanTab` when the Plan tab is open,
  `SuggestedFromRetention`) _needs_ to see every edit. Wrapping the return in
  `useMemo` keyed on `[body, setBody, status, error, saving, updatedAt, flush]`
  would produce a new object on the same keystrokes anyway (`body` is in the dep
  list), so it would not reduce a single re-render. Verified non-issue, not a
  finding.

- **`ScorePlanTab.tsx`** is only mounted when `tab === "plan"`
  (`ScoreWorkspace.tsx:322-326`, conditional render, not `hidden`), so it does not
  pay any cost while the Score tab is showing instead. When it _is_ open, it
  re-renders on every Today-sheet keystroke by design (spec C3: two-way live sync)
  — that's the feature, not a bug.

- **`DaySheet.tsx`'s row list** (`body.map(renderLine)`, lines 826-832) has no
  per-row `React.memo`/component split, so every keystroke re-executes
  `renderText`/`renderPiece`/`renderNotes`/etc. for _every_ line, not just the
  edited one, including an `Array.find` over `pieces` for each `piece`/
  `lesson_prep` line (`pieceTitle`, lines 260-265). This is real, but a day sheet
  is one day's practice plan — realistically 5-40 lines, so this is O(n) trivial
  work (microseconds) on every keystroke, not O(anything that matters). I could
  not trace a frequency×cost that would survive verification, so I'm not counting
  it — flagging only as something to revisit if day sheets ever grow much larger
  (e.g. a "show all history inline" feature).

- **Score zoom/pan hot path (`ScoreView.tsx`)** — already the subject of ledger
  items 18-20 (verified/merged): scale changes flow through `scaleRef`/
  `containerWidthRef` refs read by native wheel/gesture listeners (lines 837-843,
  911-941) specifically so a pinch/drag never re-subscribes effects or forces a
  PDF.js re-raster; `visiblePageList`/`mountedPages`/`overlayItems`/
  `displayedRegions` are all `useMemo`'d with precise deps. This still holds up.

- **`RepHud.tsx`** — re-renders when `snap` changes; `snap` changes on explicit
  user actions (verdict/undo/pause/etc.) and a 15s durability checkpoint
  (`useRep.ts:1223`, `window.setInterval(persist, 15_000)`), not a per-second UI
  clock. All 4 `useEffect`s there are correctly scoped and cleaned up. No issue.

**Low-confidence observation (not counted as a finding):** `Shell.tsx:403` calls
`useMetronome()` directly inside the monolithic `Shell()` component purely to read
`metronome.state.running` for the voice-grounding `tierAContext` memo
(`Shell.tsx:410,416`). Every mounted `useMetronome()` instance (this one, plus each
`MetronomeQuickBar`'s own independent instance) subscribes to the same backend
`metro://state` event, which fires on every `metro_set` — including the
drag-BPM-wheel path (`useMetronome.ts:301-329`, throttled to ≤1 backend call per
150ms while dragging). So dragging the BPM wheel anywhere in the app makes `Shell()`
re-render (and rebuild its ~250-line inline `shellTree`, since nothing below it is
`React.memo`'d) at up to ~6-7Hz for the duration of the drag. I verified the
mechanism precisely but could _not_ verify it costs anything material — the
re-executed work in mounted descendants is dominated by memoized values and cheap
`Array.find`/`.map` over small arrays (editions ~1-5, regions ~5-30). Noting it
honestly rather than either suppressing it or overstating it as a "bug."

---

## 2. Caching opportunities — 2 findings

### F1 — `pieces_list` fetched independently from 7 call sites, no shared cache

`pieces_list` is read-mostly data (the task brief's own example). It is invoked
independently, with no sharing, from:

- `src/features/calendar/api.ts:28` — `listPieces: () => invoke<PieceSummary[]>("pieces_list")`
- `src/features/composer/useComposerCandidates.ts:26` — `pieces: () => invoke<PieceSummary[]>("pieces_list")`
- `src/features/ledger/LedgerWorkspace.tsx:38`
- `src/features/pieces/PiecesPanel.tsx:51`
- `src/features/score/ScoreWorkspace.tsx:114`
- `src/features/notebook/DaySheet.tsx:63-65` (defines `PIECES_LIST`, fetched in a `useEffect` at lines 196-209)
- `src/features/brain/BrainWorkspace.tsx:84`

The most concrete repeat-offender is `DaySheet.tsx`: `TodayPracticePanel` is
conditionally rendered — `TodayWorkspace.tsx:175`, `{practiceOpen && <TodayPracticePanel .../>}`
— so `TodayDaySheet` → `DaySheetView` fully unmounts on close and remounts on
reopen. Its mount effect:

```tsx
// src/features/notebook/DaySheet.tsx:196-209
useEffect(() => {
  let alive = true;
  executeCommand(PIECES_LIST, undefined).then(
    (list) => {
      if (alive) setPieces(list);
    },
    () => {
      /* the sheet is still fully usable without piece titles */
    },
  );
  return () => {
    alive = false;
  };
}, []);
```

fires a fresh `pieces_list` round trip _every single time the Today's Practice
window is opened_ — which, per the UI design (ledger item 26: an Esc/×-closable
overlay meant to be popped open during a practice session), can happen many times
per session. Meanwhile `ScoreWorkspace` may already be mounted (and may already
have the identical list) at the same time — `Shell.tsx:1115-1123` keeps
`ScoreWorkspace` mounted-but-`hidden` once visited (`data-testid="score-shell-cache"`),
so its own `pieces_list` fetch already ran once and is sitting unused in that
component's local state.

**Fix sketch:** hoist a tiny shared `usePiecesList()` hook (or a `PiecesProvider`
alongside `TodaySheetProvider`/`ReceiptCenterProvider` in `Shell.tsx`) that fetches
once, caches in a ref/state at the provider level, and every current call site
subscribes instead of calling `invoke("pieces_list")` itself. A "list changed"
invalidation only needs to fire after piece add/remove/rename (`PiecesPanel`'s
`scan`/mutations already know when that happens) — everything else here is a pure
read.

### F2 — the first-page bitmap LRU cache is defeated by the piece-switch `key`, so the "instant switch-back" path never actually fires

`ScoreView.tsx` builds a proper piece-switch accelerator (`firstPageCache.ts`): a
compressed WebP/JPEG snapshot of a piece's fitted first page, looked up from an
in-memory LRU before falling back to a Tauri disk read:

```ts
// src/features/score/ScoreView.tsx:556
const bitmapCacheRef = useRef(new LruMap<Blob>(6));
```

```ts
// src/features/score/ScoreView.tsx:731-748 (inside the editionId-load effect)
const key = firstPageCacheKey(pieceId, previewFingerprint, 1, bucket);
const cached = bitmapCacheRef.current.get(key);
if (cached) {
  setPreviewFromBlob(cached); // instant, synchronous
} else {
  void api
    .loadFirstPage(pieceId, previewFingerprint, 1, bucket) // Tauri invoke + disk read
    .then((buffer) => {
      /* ...bitmapCacheRef.current.set(key, blob)... */
    });
}
```

The module header even documents the intent: _"On the next switch back to that
piece/edition we paint the snapshot instantly... This module is pure and
display-only: a key builder, a fit-context bucket, an image-MIME sniffer, and an
**in-memory LRU**"_ (`firstPageCache.ts:1-10`), and the LRU is sized for 6 entries
— i.e. built to remember several recently-viewed pieces across switches.

But the component that owns `bitmapCacheRef` is remounted from scratch on every
piece switch:

```tsx
// src/features/score/ScoreWorkspace.tsx:308-309
<ScoreView
  key={selectedId}
  pieceId={selectedId}
  ...
```

`key={selectedId}` forces React to unmount the old `ScoreView` fiber and mount a
brand-new one whenever the viewed piece changes — which discards `bitmapCacheRef`
(a plain `useRef`, component-scoped) and replaces it with a fresh, empty
`LruMap(6)`. Switching from piece A → B → back to A therefore _always_ misses the
in-memory cache and always pays the `api.loadFirstPage` round trip (Tauri IPC +
disk read + `Blob` construction), even though piece A's bitmap was captured and
`.set()` into the map moments earlier (`captureFirstPage`, line 855-892, called
from `handleRasterized` at line 897-902 every time a first page finishes
rastering). The capacity-6 LRU can, in production, never hold more than the
entries produced _within a single piece's own mount lifetime_ (e.g. re-fitting on
a window resize, which reuses a different bucket key for the same piece) — it can
never serve a cross-piece hit, which is the entire stated purpose of the module.

I confirmed this isn't an artifact of my reading: `ScoreView.tsx` already has a
`useEffect(() => {...}, [pieceId])` at lines 609-628 that manually resets
target-drawing/wizard/dock state on a piece change — i.e. the component is _already_
built to handle `pieceId` transitions via effects rather than requiring a remount.
The `key={selectedId}` sits one level up and quietly undoes that, plus destroys
every other piece of `ScoreView` state (scale mode, manual zoom, `sectionsVisible`,
etc.) on every switch, not just the bitmap cache.

Separately, `ScoreView.test.tsx`'s own switch-path tests
(`"paints a cached first-page bitmap instantly on switch..."`, lines 822-869) use
`view.rerender(<ScoreView pieceId={8} .../>)` **without** a changing `key` — i.e.
they exercise the same-instance rerender path, not the real
`key={selectedId}`-driven remount `ScoreWorkspace` actually uses in production. The
test suite's simulated "switch" is therefore not representative of how a real
piece switch behaves, which is exactly why this survived to now.

**Fix sketch (either one kills the bug):**

1. Drop `key={selectedId}` from `ScoreWorkspace.tsx:309` and let the existing
   `[pieceId]`-keyed effects (already present) drive the reset, so `ScoreView`
   itself stays mounted across a switch and `bitmapCacheRef` survives; or
2. If the remount is wanted for other reasons (e.g. to force-reset the transient
   editing state cleanly), hoist the LRU out of the component — a module-scope
   `const scoreBitmapCache = new LruMap<Blob>(6);` shared by every `ScoreView`
   instance — so a fresh mount still sees prior pieces' snapshots.

---

## 3. Memory leaks — 0 findings (explicitly empty)

Per the brief, the `alive.current`/`mountedRef` guard pattern (`usePanels.ts`) is
the accepted repo standard and not a finding on its own; I looked for the actual
failure modes (missing `unlisten()`, timers without `clear*`, effects that write
state after unmount with no guard) and found none.

- **Every `listen()` call in `src/`** (`ScoreView.tsx:1364-1402`,
  `useRep.ts:701-737` and `:747-778` — two separate listeners,
  `useVoice.ts:230-283`, `useMetronome.ts:200-238`, `useSession.ts:100-145`,
  `pieces/AddScore.tsx:206-224`) follows the same shape: subscribe inside an
  `alive`-guarded async IIFE, store the returned `unlisten` in a local variable,
  and call it unconditionally in the effect cleanup (`unlisten?.()` or a loop over
  `unlisteners`). No orphaned subscriptions.
- **Every `setTimeout`/`setInterval` in `src/`** has a matching `clearTimeout`/
  `clearInterval` in its effect's cleanup or in the next call that supersedes it:
  `ReceiptCenter.tsx:93-105` (dismiss timers tracked in a `Map`, all cleared on
  unmount), `useAutosavedDocument.ts:75,136-143,199-203` (debounce timer cleared
  both on manual `flush()` and on the key-change effect's cleanup — this is the
  autosave core behind the new day-sheet/piece-plan editors and it's careful about
  it), `RepHud.tsx:163-167,196-200` (both return `() => clearTimeout(...)`),
  `useMetronome.ts` (`errorTimer`, drag-throttle timer, and the audition
  auto-stop timer are all cleared in the mount effect's cleanup at lines 225-227,
  plus the audition-in-flight case is explicitly stopped rather than left running,
  lines 228-236), `useRep.ts:1218-1229` (checkpoint interval + a
  `visibilitychange` listener, both cleaned up together).
- **New v4 surfaces specifically** (`DaySheet.tsx`, `useDaySheet.ts`,
  `useAutosavedDocument.ts`, `PassageHelper.tsx`, `ScorePlanTab.tsx`,
  `quoteRotation.ts`, `firstPageCache.ts`): none of `PassageHelper.tsx`,
  `ScorePlanTab.tsx`, or `quoteRotation.ts` register any listener or timer at all
  (`quoteRotation.ts` is synchronous `localStorage` reads/writes; `firstPageCache.ts`
  is a pure module — key builder, MIME sniffer, LRU class — with no I/O of its
  own). `DaySheet.tsx`'s three effects (pieces load, yesterday load, goal-ref
  resolution) all use the `alive` guard correctly (lines 196-209, 212-226,
  231-258). `useAutosavedDocument.ts`'s key-change effect cleanup
  (lines 199-213) correctly fires an outgoing flush-on-unmount/key-change using a
  captured `outgoingRef` handle rather than the (possibly already-reassigned)
  live config — this is the subtle case a naive implementation gets wrong, and
  it's handled.

---

## 4. Frontend invoke-in-loop (N+1) patterns — 2 findings

### F3 — `useComposerCandidates.ts`: 2 invokes per piece, every time "Suggested from retention" loads

```ts
// src/features/composer/useComposerCandidates.ts:181-192
const [pieces, dueRetention, plannedWork] = await Promise.all([
  api.pieces(),
  api.retention(asOfDate),
  api.work(asOfDate),
]);
const graphs = await Promise.all(
  (pieces ?? []).map(async (piece) => {
    const [regions, blocks] = await Promise.all([
      api.regions(piece.id), // invoke("region_list", { pieceId })
      api.blocks(piece.id), // invoke("rep_blocks_for_piece", { pieceId })
    ]);
    return { pieceId: piece.id, regions: regions ?? [], blocks: blocks ?? [] };
  }),
);
```

For N pieces this is 1 (`pieces_list`) + 2N (`region_list` + `rep_blocks_for_piece`
per piece) Tauri IPC round trips, all fired concurrently via `Promise.all`. This
runs via `reload()` (called from the mount effect at line 210-218) every time
`SuggestedFromRetention` mounts — i.e. every time the Today's Practice window
opens (`TodayPracticePanel.tsx:144-154`). For a working repertoire of, say, 15-30
active pieces that's 30-60 concurrent `invoke` calls on every window open, just to
build the "due checks / repairs" suggestion fold — which the user may not even
expand (`open` starts `false`, `TodayPracticePanel.tsx:155`, so the network cost is
paid even when the fold stays collapsed).

I confirmed there is no batched alternative to fall back to: `src-tauri/src/lib.rs`
only exposes single-piece-id signatures —
`fn region_list(piece_id: i64, ...)` (line 762) and
`fn rep_blocks_for_piece(...)` (line 714) — no `region_list_all`/
`rep_blocks_for_pieces` command exists.

**Fix sketch:** either (a) add a Rust batch command
(`regions_and_blocks_for_pieces(piece_ids: Vec<i64>)`) that does one SQL query with
an `IN (...)` clause instead of N round trips, or (b) at minimum gate the fetch
behind the `<details>` actually being opened (`onToggle`) instead of firing
unconditionally on mount, so the cost is paid only when the fold is used.

### F4 — `CalendarWorkspace.tsx`: 1 invoke per piece, every Calendar mount

```tsx
// src/features/calendar/CalendarWorkspace.tsx:97-106
useEffect(() => {
  let active = true;
  void (async () => {
    try {
      const pieces = await api.listPieces();
      const goalLists = await Promise.all(
        pieces.map((piece) => api.listGoals(piece.id)),
      );
      if (active) setReferences({ pieces, goals: goalLists.flat() });
    } catch (cause) {
      if (active) setError(errorMessage(cause));
    }
  })();
  return () => {
    active = false;
  };
}, [api]);
```

Same shape as F3: fetch `pieces_list`, then `Promise.all` one `goal_list` invoke
per piece to build a flat `references.goals` lookup, on every mount of the
Calendar workspace (i.e. every time the user opens the Calendar). Confirmed no
batch command exists — `src-tauri/src/lib.rs:1163` only defines
`fn goal_list(piece_id: i64, ...)`.

**Fix sketch:** same as F3 — a `goal_list_all()`/`goals_for_pieces(piece_ids)`
batch command, or share the result with `useComposerCandidates`'s already-fetched
piece list via the same caching layer proposed in F1 (both end up wanting
"pieces + per-piece related rows" and currently fetch it independently).

---

## Summary

| Category                         | Findings                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| 1. Unnecessary re-renders        | 0 (1 low-confidence mechanism noted, not counted)               |
| 2. Caching opportunities         | 2 (F1 `pieces_list` fan-out, F2 dead first-page LRU)            |
| 3. Memory leaks                  | 0 (explicitly empty — checked every `listen()`/timer in `src/`) |
| 4. Frontend N+1 (invoke-in-loop) | 2 (F3 composer candidates, F4 Calendar goals)                   |

**Total: 4 findings**, all traced file:line with verbatim code and a concrete fix
sketch. Confidence: high on F1-F4 (each independently re-derivable from the cited
lines — F2 in particular I cross-checked against the test suite to confirm the
tests don't exercise the real `key`-driven remount path, which is why it wasn't
caught before). Categories 1 and 3 are genuinely empty at the bar this audit
requires, not under-searched — see the "checked and found clean" notes above for
what was ruled out and why.
