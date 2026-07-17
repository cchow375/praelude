# Frontend Performance Audit — 2026-07-16 (verified)

Read-only analysis of `src/` (React 19 + Tauri v2 IPC), per the session ledger items 12–18.
Method: three parallel analysis lanes (IPC/N+1 + caching, re-renders + redundant computation,
memory leaks), then a **fresh-context verification pass** over every finding (item 18) that
confirmed file:line accuracy and re-graded severity against this app's real scale
(one user, 6 pieces, ~50 blocks, local sub-5ms Tauri IPC on an M2).

## The one finding that matters

**LEAK-1 — `src/features/score/ScoreView.tsx:995-1029` — Tauri `listen()` unlisten race (MODERATE, real bug).**
`void listen("score://navigate", …).then(fn => unlisten = fn)` with a synchronous
`return () => unlisten?.()` and no alive-guard. The effect's deps (`edition, jumpTo, regions,
selectRegion`) churn during data load, so cleanup can run before the promise resolves —
the subscription is orphaned and later fires stale closures. The correct pattern already
exists in this repo at `useRep.ts:643-680` (`if (alive) unlisten = un; else un();`).
**Disposition: fix folded into the v3 build (5-line alive-guard, copy the useRep pattern).**

## Everything else (verified verdicts)

| Finding                                                                  | Claimed                 | Verified verdict                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N+1-001 Calendar per-piece `goal_list` (CalendarWorkspace.tsx:102)       | MEDIUM, "300ms stall"   | **OVERSTATED → LOW.** `Promise.all` = one parallel wave; ~10ms real. Batched command not worth backend churn at 6 pieces.                                                                |
| N+1-002 Composer per-piece regions+blocks (useComposerCandidates.ts:186) | MED-HIGH, "600ms stall" | **OVERSTATED → LOW.** Two parallel waves (~2 round-trips), not 12 serial calls.                                                                                                          |
| CACHE-001 `pieces_list` refetched by 5 workspaces                        | LOW                     | **CONFIRMED LOW.** Accurate; negligible payload; per-workspace filters make dedupe not worth it now.                                                                                     |
| CACHE-002 `universe_snapshot` in Today + Universe                        | LOW                     | **CONFIRMED LOW.** Negligible.                                                                                                                                                           |
| A1 `PdfPage` no React.memo (PdfPage.tsx:26)                              | MEDIUM                  | **WRONG (fix ineffective).** Fresh `children` element every parent render defeats shallow memo.                                                                                          |
| A2 `RegionOverlay` no memo (RegionOverlay.tsx:166)                       | MEDIUM                  | **OVERSTATED.** Inline `mapping` object + closures defeat memo exactly when it would matter (mapping mode).                                                                              |
| A3 `RepHud` no memo, "250ms tick hot path" (RepHud.tsx:56)               | HIGH                    | **WRONG premise → LOW.** No 250ms tick exists (grep-proven); `rep.snap` changes on user actions + a 15s checkpoint. Memo would work (Shell handlers are stable) but buys almost nothing. |
| A4 Universe inline handlers in map                                       | MED-LOW                 | **MOOT** — UniverseWorkspace.tsx is rewritten in Phase 7.                                                                                                                                |
| A5 Shell `tierAContext` churn (Shell.tsx:192-204)                        | MEDIUM, "4-10×/sec"     | **OVERSTATED → negligible.** Already memoized on `rep.snap`; ref stable across unrelated Shell re-renders; snap doesn't change 4-10×/sec.                                                |
| B1 chained map/filter/map (RegionOverlay.tsx:244)                        | LOW-MED                 | **CONFIRMED LOW.** Handful of draft rects, mapping-mode only.                                                                                                                            |
| B4 `visiblePages` Set identity churn (ScoreView.tsx:664)                 | LOW-MED                 | **WRONG (already guarded)** — `samePages(prev,next) ? prev : next` dedupes identity at :651.                                                                                             |
| B5/B6 Universe signalData objects / gradient defs                        | LOW                     | **MOOT** — replaced in Phase 7.                                                                                                                                                          |
| B2/B3 "already correctly memoized" examples                              | —                       | **CONFIRMED** (overlayItems, displayedRegions, stable useCallbacks).                                                                                                                     |
| 14 "verified clean" leak patterns                                        | —                       | Spot-checks CONFIRMED (useRep alive-guard, useSession EVENTS_MAX cap, PdfPage destroy/cancel teardown).                                                                                  |

## Takeaways

1. The codebase's async hygiene is genuinely good — alive-guards, teardown, and caps are the
   norm; LEAK-1 is the one place the pattern was missed (new Phase 4 code).
2. At this app's scale, the IPC fan-outs are parallel waves measured in single-digit
   milliseconds; batching commands would add backend surface for no felt gain. Revisit only
   if piece count grows 10×.
3. Audit-lane cost models (serial IPC, invented tick rates) did not survive verification —
   which is why the verification gate (item 18) exists. Report only what survived.
4. For Phase 7's Universe rewrite: the moot findings (A4/B5/B6) describe patterns to simply
   not repeat — event delegation and memoized defs from the start; the d3-force sim must
   sleep at rest (already in the plan).
