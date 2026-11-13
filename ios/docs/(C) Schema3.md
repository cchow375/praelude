# (C) Schema3 — the on-device data model

**Build11/schema5 compatible extension (October10,2026; candidate, not installed):**
`TextBoxAnnotation.style` adds optional text formatting. Missing style decodes to size20/system/
black/leading/plain; sizes must be finite and within12–48. Other choices are serif/rounded/
monospaced, bold/italic, blue/red/green/purple and center/trailing. No migration or eager file
rewrite occurs; local saves/backups retain the style. `AnnotationSyncRow` nests `textStyle` inside
the existing region JSONB object while preserving its four geometry keys. Older clients can
read geometry/text but drop style when rewriting; current native clients are required to retain
formatting. Core tests cover old-file byte preservation and save/reload/backup/sync roundtrips.

**Build5/schema5 extension (October2,2026):** the model below is the baseline. Pieces additionally
carry reviewed scoreSections/measureAnchors/defaultPracticeBPM; goals and routines carry durable
createdAt/updatedAt/deletedAt; Preferences has a backward-compatible clock and score controls.
Schema5 migrations preserve exact originals and backups use version4. See
[the shared platform contract](../../docs/PLATFORM_DATA_CONTRACT.md) and current Core models for
wire/deletion compatibility. Historical schema3 details below remain their original baseline.


Schema3 is `ios/Praelude/Core`'s on-disk `library.json` format (`LibraryState.schemaVersion == 3`).
It replaces schema2 (1.1.0/build2, the version currently installed on the physical iPad) with a
model every later feature track — instruments, library organization, passages/scheduling, practice
rules, warmups, audio, rewards, notebook, profile — can build on without editing `Models.swift`
again. Core stays Foundation-only; nothing here depends on PencilKit, PDFKit or SwiftUI.

## Where things live

`Models.swift` keeps the original practice primitives (`Piece`, `Passage`, `PracticeConfiguration`,
`ActiveSet`, `PracticeSession`, …) plus `LibraryState`, which now also lists every schema3
collection. Each subsystem's own types live in their own file so a future change to, say, Warmups
never touches Models.swift: `Geometry.swift` (a shared normalized rect), `Ink.swift`, `Instruments.swift`,
`LibraryOrganization.swift` (tags/folders/setlists/bookmarks/page edits/links/text & stamp
annotations), `PassageScheduling.swift` (learning state/schedule/cold grades/break-point taps),
`PracticeRules.swift` (`SetGoal`, `RuleID`, `RuleEvent`, `RuleSettings`), `Warmups.swift`,
`Audio.swift`, `Rewards.swift`, `Notebook.swift`, `Profile.swift`, and `SchemaMigration.swift`.

`PracticeStore` gained a `save*`/`delete*` (or `record*`/`append*` for logs) pair per new collection,
following the exact shape the existing `saveGoal`/`deleteGoal` methods already used. `validate(_:)`
grew a matching block per collection: unique ids, sane bounds, and the reference checks that are
cheap to do (a tag/folder/instrument/passage a piece points to must exist).

## Sync metadata (§4d)

Every **mutable** record — one a person can edit or remove — carries `id: UUID`, `createdAt: Date`,
`updatedAt: Date`, `deletedAt: Date?`. A delete sets `deletedAt` rather than removing the row, so a
tombstone can reach every replica instead of the row silently reappearing from one that never heard
about the deletion.

Every **append-only log** — `Attempt` (already existed), `ColdGradeRecord`, `BreakPointTap`,
`RuleEvent`, `RewardLedgerEntry`, `Badge`, `MilestoneEvent` — carries only `id` and its own event
date. Nothing about a log row is ever edited or deleted, so a stable id is already enough for two
replicas to merge by set union; adding `updatedAt`/`deletedAt` to these would be dead weight.

**Field-level last-write-wins, or the documented alternative:** true per-field clocks (a
`[String: Date]` per record) would be heavy, easy to let drift from real mutations, and awkward to
keep Codable-stable. Schema3's alternative is: one `updatedAt` per record is the default granularity
(whole-record LWW), _except_ for the two places where that granularity is visibly wrong:

- **Ink** merges by stroke, not by page (see below) — each `InkStroke` row is its own LWW unit, which
  is a stronger guarantee than a per-field clock would give a single "ink" field.
- **`Piece.lastPage`** changes on every page turn, far more often than title/composer/tags/etc.
  change. It gets its own `lastPageUpdatedAt` clock (bumped only by `updateLastPage`) so reading
  a score on one device can never race a deliberate metadata edit made offline on another.

`updatePiece`/`savePassage`/the new `save*` methods trust the caller's struct for `updatedAt` the
same way the codebase already trusted it for `createdAt` — they replace the stored record wholesale
and do not second-guess it. An editor is expected to set `updatedAt = Date()` when it constructs the
edited struct, the same way it already sets whichever field it actually changed. The exceptions are
narrow, store-owned counters with no caller struct to trust: `updateLastPage` (`lastPageUpdatedAt`),
`setPieceStatus` (`updatedAt`), and `recordWarmupUse` (`lastUsedAt`/`useCount`).

**Guest-mode ownership:** `Profile.ownerID: UUID?` stays `nil` until an account exists. It is the one
field the backend/sync track needs; Core does not stamp an `ownerID` on every row; because today's
library is always exactly one person's local data even before they have an account, a single
top-level owner is the correct granularity, not per-record ownership.

## Ink: per-stroke storage (§4d/§7)

`InkStroke` replaces schema2's `ScoreDrawing` (one opaque blob per page). Each row is
`id/pieceID/page/layer(mine/teacher/performance)/data/createdAt/updatedAt/deletedAt`; `data` is
still opaque to Core — an app-encoded PencilKit blob it never parses.

`PracticeStore.replaceInk(pieceID:page:layer:strokes:)` is the merge primitive: given the layer's
_current full set_ of stroke blobs, it diffs by content against what is stored — an unchanged blob
keeps its row's id/`createdAt` (so an untouched stroke never looks "updated" to a future sync
engine), a blob no longer present is tombstoned, a new blob becomes a new row.
`inkStrokes(pieceID:page:layer:)` reads the live rows back.

Today's app still edits a whole page's ink as one PencilKit `PKDrawing` and saves it wholesale, so
`saveDrawing`/`drawing` (unchanged signatures) are kept as a compatibility layer on top of
`replaceInk`: they operate on the `.mine` layer with a single-element strokes array, which is
byte-for-byte what schema2 did. **Views were not changed for this** — `ScoreWorkspace`,
`NativeLibraryFiles` and the app's optimistic-concurrency ink-conflict check all call the exact same
methods they always did. `ScoreExport` and `NativeLibraryFiles`'s backup validation, which read
`state.scoreDrawings` directly, were updated to read `state.inkStrokes` (grouped by page, since a
page can now legitimately hold more than one row); `ScoreExport` now merges every row's strokes
into one `PKDrawing` before rendering, so a page's export is unaffected by how many rows it is
stored across.

A future PencilKit-aware call site can switch straight to `replaceInk`/`inkStrokes` with one
`PKStroke`-per-row (`PKStroke.identifier`, iOS 17+) for true per-stroke merge, with no further Core
change — the storage already supports it; only today's call site is coarser than that.

## Migration (schema1 → 3, schema2 → 3)

`PracticeStore.init` and `restoreBackup`/`decodeBackup` all funnel through one function,
`SchemaMigration.migrateToSchema3(_:at:)`. Almost every schema2 field already decodes into its
schema3 shape for free — every new collection is `decodeIfPresent(...) ?? []`/a default value, which
is correct (not lossy) because those collections are wholly new: there was never any prior data to
lose. Two fields are a genuine reshape and need real migration code:

1. **`scoreDrawings` → `inkStrokes`.** `LibraryState`'s decoder looks for schema3's `inkStrokes` key
   first; if absent, it falls back to decoding the legacy `scoreDrawings` key (kept out of the type's
   normal `CodingKeys` so it can never be written again) and maps each legacy `{pieceID, page, data}`
   into one `InkStroke` on the `.mine` layer.
2. **`Passage`/`Piece` sync fields that never existed before schema3** (`Passage.createdAt`/
   `updatedAt`, `Piece.updatedAt`/`lastPageUpdatedAt`). Their decoders fall back to
   `Date.praeludeEpochSentinel` (the Unix epoch — no genuine record is ever created then) when the
   key is missing. `migrateToSchema3` sweeps the whole decoded state and replaces every sentinel with
   the single, consistent timestamp of that migration event, then sets `schemaVersion = 3`.

`migrateToSchema3` is pure and idempotent: run it on an already-schema3 state (no sentinels left)
and it only confirms `schemaVersion == 3`.

**Hard rule — never lose user data.** `PracticeStore.init` preserves the exact pre-migration bytes
(`library-schema1-<uuid>.json` or `library-schema2-<uuid>.json`, named for the version it found, next
to `library.json`) _before_ the first schema3 write, for either source version — extending the
byte-for-byte preserve-then-verify-then-write sequence schema1→2 already used. `validate(_:)` also
gained a `schemaVersion < 3` check that a library claiming an older format never already carries a
schema3-only field, mirroring the existing schema1-only check for regions/ink/`passageSnapshot`.
Newer or unreadable data is unaffected — it is still never migrated and still stays read-only.

`ios/PraeludeCoreTests/PracticeCoreTests.swift` builds realistic schema1 and schema2 fixtures the
same way the existing schema1 test already did: encode a real schema3 `LibraryState`, then strip the
later fields via `JSONSerialization` (`legacyData`/`schema2Data`, sharing a `schema2Shape` helper) —
which is also how a genuine schema1 file (see `git log -p` on `Models.swift`'s first two commits)
differs from schema2, and schema2 from schema3. Both migration tests inject a fixed clock and assert
the exact backfilled timestamp, that ink survives byte-for-byte, and that the original is preserved
and byte-verified.

## Honesty (§14)

`RewardLedgerEntry.coinsDelta`/`xpDelta` are plain `Int`s, but `validate(_:)` rejects any entry where
either is negative. That is enforced structurally, not just by naming: there is no way to persist a
reward-ledger penalty, for a Sloppy verdict or anything else.

## What is deliberately not here yet

- **`deletePassage` still hard-removes** rather than tombstoning, even though `Passage.deletedAt` now
  exists. Flipping it would mean auditing every View that lists passages (`ScoreWorkspace`,
  `PassagePickerView`, …) to filter out tombstones — real Views work, out of scope for a Core-only
  change and left for whichever track wires up real sync.
- **Rule evaluation (R1–R15), warmup rotation, rewards economy, and profile/social sync** are not
  implemented here. Schema3 gives each of them a home (`RuleSettings`/`RuleEvent`,
  `WarmupExercise`, `RewardsState`/`rewardLedger`/`badges`, `Profile`) with the spec's flagged
  defaults, but the actual decision logic ("does R6 fire now") is a future feature track's, the same
  way `PracticeEngine` already owns tempo/streak replay for the existing rules.
- **Backend/Supabase sync itself (§4a/§4b)** is untouched; this is the on-device half only.
