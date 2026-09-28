# (C) History And Data Views — Today, History, Calendar, Notebook, Data

Build spec §15/§16, §4c ("stats local"). This track's Core surface is `ios/Praelude/Core/Insights/`
(pure, Foundation-only, the same shape as `Core/Rules/`): every function is a plain read over
`LibraryState`/`RuleContext` into a small value type a View renders — nothing here touches disk, the
clock, or `PracticeStore` directly. The Views layer is `Praelude/Views/{Today,History,Calendar,
Notebook,Insights}View.swift` plus `ScoreHeatmapOverlay.swift`, wired into `PraeludeApp.swift`'s
sidebar/tabs and, for the heatmap, one added case in `ScoreWorkspace.swift`'s Score options menu.

## Where things live

- `TodayOverview.swift` — due reviews, upcoming performances with day counts, daily streak status.
- `PassageHistory.swift` — a passage's cold-grade + attempt timeline, oldest first.
- `PracticeHeatmap.swift` — `HeatLevel` (solid/shaky/failing) for a passage, and a break-point tap's
  age-faded opacity.
- `PieceReadiness.swift` — a piece's readiness state, blending R4's ladder with whether it has been
  attempted at all.
- `SessionSummary.swift` — one session's moved-up/dropped-back/parked/due-tomorrow/time rollup.
- `WeeklyRecap.swift` — the 7-day aggregate the shareable recap image renders.
- `HistoryExport.swift` — CSV/JSON formatting for the History screen's export.
- `PracticeCalendarStats.swift` — daily practice totals and flattened performance-day rows.
- `NotebookShareComposer.swift` — the text a "Post as Note" hook would actually send.
- `PracticeStats.swift` — §4c's local profile stats: current streak (read straight from
  `RewardsState`), longest streak (derived from `sessions` — schema3 has no dedicated field for it),
  total practice time, pieces performance-ready, rank/division/badge count.

`Praelude/Services/NotebookPostHook.swift` is the one non-Core addition outside `Views/`: an
`@MainActor` protocol plus an `EnvironmentValues.notebookPostHook` key, `nil` until a social track
installs a real implementation. `NotebookView` disables "Post as Note" rather than pretending to send
anything while it is unset.

## The central gap every judgment call here answers the same way

Nothing in the live practice loop calls `PracticeRulesEngine.applyColdGrade` yet — §9's cold-attempt
grading UI and the wiring that would turn a real Clean/Sloppy/Again tap into R3/R4/R6/R7/R9 schedule
changes belong to the practice-HUD track (§9/§10), not this one. A freshly built library therefore has
`Attempt`s (the existing loop already records every verdict) long before it has any `ColdGradeRecord`,
and every passage's `learningState`/`schedule`/`parkedUntil` stay at their defaults indefinitely unless
something else sets them. Every function below that reads "recent results" says explicitly, in its own
doc comment, which of the two signals (the authoritative-once-wired rule state, or the already-live
attempt/session data) it prefers and why:

- **`PracticeHeatmap.passageLevel`** prefers the most recent in-window `ColdGradeRecord`; falls back to
  the clean ratio of the passage's most recent attempts so the heatmap is useful immediately.
- **`PieceReadiness.evaluate`** treats "any passage `learningState != .new`, or any set logged for this
  piece" as `.learning` rather than leaving an actively-practiced piece stuck at `.notStarted`.
- **`SessionSummary.summarize`** deliberately does _not_ replay R6/R7/R9 against a session's sets — that
  would either duplicate rule logic outside `Core/Rules/` or read as permanently empty. It reads only
  what the existing loop already guarantees (each touched passage's own tempo movement between its
  sets this session) plus whatever `parkedUntil`/`schedule.dueDate` already say — 0 today, accurate the
  moment something else starts writing those fields.
- **`WeeklyRecap.compute`**'s `newlyPerformanceReadyCount` reads `MilestoneEvent` (§14's purpose-built
  log for exactly this), not a derived heuristic — an honest 0 until the rewards track appends real
  milestones.

None of this requires a future change to this track's files: every function already reads the
authoritative schema3 field first and only falls back to derived data, so readiness/heatmap/session
summaries sharpen automatically once cold-grading (or the rewards ledger) is wired in elsewhere.

## Today (§15)

`TodayView` builds its session card by calling `PracticeRulesEngine.buildSession(availableMinutes:
context:)` directly (R15) — the first track to actually call the rules engine from UI. Reordering and
skipping are local `@State` on the built `[SessionItem]` array, never persisted: `SessionPlan.items` is
already documented as "a plain, freely-reorderable array" whose own items don't change schedule when
left out (see "(C) Rules Engine.md"), so an ephemeral, per-view-session list is the correct scope, not
a missing feature. A locally skipped item's id is remembered only long enough that "Rebuild session"
(the same `buildSession` call, re-run) doesn't immediately re-offer it in this view session.

**"Drag reorder" is implemented as explicit move-up/move-down buttons, not a drag gesture.** SwiftUI's
list drag-to-reorder (`.onMove`) requires the whole `List` to enter `EditMode`, which would also toggle
edit chrome on every other section on Today (the active-set card, recent pieces) and suppresses
`.swipeActions` — the mechanism this same row uses for "skip". Two explicit buttons avoid that
List-wide side effect, work identically under VoiceOver (where a raw drag gesture is the harder
interaction, not the easier one), and need no scoped-environment workaround. A future track preferring
a literal drag can replace `SessionItemRow`'s buttons without touching `Core/Insights/`.

**"One-tap Start session"** calls `PracticeRulesEngine.defaultConfiguration(for:context:)` for the
first item's passage (§10a) and `PracticeStore.startSet(_:)` directly, then opens that piece — the same
two calls `SetComposerView`'s own "Start" already makes, just without the modal. A `.runThrough` item
starts a plain whole-piece set (`passageID: nil`, `basis: .totalPlays, targetCount: 1`); a `.warmup`
item has no practice flow to start (§12 is separate, unwired scope) and shows as an informational row
only.

## History (§15)

`HistoryView` is deliberately a distinct screen from the existing "Progress" tab (unchanged, out of
scope — it is a different concern, XP/level framing, not touched by this track). History adds what the
audit called missing: per-passage grade/tempo history (`PassageHistory.timeline`, one screen per
touched passage) and CSV/JSON export. Export uses two patterns already established in this codebase —
`.fileExporter` with a small `FileDocument` (`HistoryCSVDocument`/`HistoryJSONDocument`, mirroring
`NativeBackupDocument`) for Files, and `ScoreShareView` (already used for the annotated-PDF share
sheet) for AirDrop/share sheet, writing the CSV to a scratch temp file first. A session's detail view
also renders its `SessionSummaryData` (§16's "session summary") — the natural place to look for it,
since a summary is inherently about one session, not a cross-session list.

## Calendar (§15)

A self-drawn month grid (`PracticeCalendarStats.dailyTotals`/`performanceDays`) rather than
`DatePicker(.graphical)` (used by Progress's existing "Practice calendar" sheet, left alone): the grid
needs to show a practice-minutes weight and a performance marker per day simultaneously, which a native
graphical date picker cannot annotate per-cell. Adding/removing a performance date edits
`Piece.performanceDates` directly via `PracticeStore.updatePiece` — schema3 already had this field; no
Core change was needed.

## Notebook (§15 → §5a)

`NotebookEntry`/`PracticeStore.saveNotebookEntry`/`deleteNotebookEntry` already existed (schema3).
`NotebookView` adds the UI: daily/lesson-note/lesson-prep kinds, a lesson-prep passage checklist scoped
to one chosen piece, and "Post as Note" gated on `EnvironmentValues.notebookPostHook` being installed.

## Data (§16)

`InsightsView` hosts piece readiness (`PieceReadiness.evaluate` per active piece) and the weekly recap,
rendered to a PNG via `ImageRenderer` and shared through the same `ScoreShareView` temp-file pattern
History uses. The score heatmap is **not** part of this screen — it colors one specific score's pages,
so it lives at `ScoreHeatmapView` (`ScoreHeatmapOverlay.swift`), reachable from that score's own
Score options menu, exactly like "Share annotated score" already is.

**The heatmap is a separate static-image renderer, not a live `ScorePageOverlay` layer.** PDFKit's
`pageOverlayViewProvider` returns exactly one view per page, and that one view is `ScorePageOverlay` —
the annotation track's file. Rather than touch it (or `PagedScoreView`'s tightly-coupled ink
`Coordinator`) to inject a second overlay, `ScoreHeatmapRenderer` composes one `UIImage` per page
(base thumbnail + heat-colored region boxes + tap dots), the same draw-then-overlay technique
`PassagePreview.makeThumbnail` already uses for a passage preview, including its page-rotation
correction. It opens as its own toggleable screen instead of tracking the live score's zoom/pan state,
which a plain SwiftUI layer over a `UIViewRepresentable` PDFView cannot do reliably.

**A break-point tap has no `page` field** (§4d keeps append-only rows minimal, and this track was
scoped to add files, not reshape an existing schema3 type). Its already page-normalized `location` is
attributed to a page by containment: it is drawn on a page only when it falls inside one of its own
passage's regions there. A tap that cannot be placed this way (a passage with no region on any page, or
a genuinely ambiguous multi-page passage where the point lands in neither region) is simply not drawn
— an honest omission, not a wrong position.

**Coloring stays monochrome, no accent.** "(C) Design System.md" enumerates exactly two places for
`PraeludeColor.live` (the practice dock's live progress fill, the listening mic indicator); this build
spec's own "monochrome weights + at most the one live accent" made the accent optional, not required,
so the heatmap uses three `PraeludeColor.scoreInk` alpha weights (solid 0.10 / shaky 0.22 / failing
0.40, plus a heavier stroke at each step) rather than adding a third place for the accent.

## Testing

`PraeludeCoreTests/InsightsTests.swift` — 26 staged-data tests, one or more per `Core/Insights/`
function (fire/no-fire/boundary cases, the same pattern `PracticeRulesEngineTests` uses).
`PraeludeAppTests/ScoreHeatmapRendererTests.swift` — the one piece of this track's logic living in the
app target: a synthetic one-page PDF, asserting a heat level and a break-point tap each visibly change
the rendered pixels, and that a tap outside every region on a page is correctly not drawn there.
