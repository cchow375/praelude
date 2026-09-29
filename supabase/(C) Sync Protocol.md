# (C) Sync Protocol — schema3 ↔ Supabase

This is the contract the iOS client integration track needs to talk to this backend. It assumes
familiarity with `ios/docs/(C) Schema3.md` (the on-device model this mirrors) and does not repeat
that document's rationale, only the parts a client author needs to get the wire format exactly
right on the first try. Everything here was verified against a live Swift toolchain and a live copy
of this schema, not assumed — see "Verified, not assumed" below for what was actually run and why it
mattered.

## 1. What goes through the generic sync engine, and what doesn't

Registered in `public.sync_tables` (whole-row last-write-wins) or `public.append_only_tables`
(insert-only): every schema3 collection in `LibraryState` — `pieces`, `passages`, `ink_strokes`,
`tags`, `folders`, `setlists`, `bookmarks`, `page_edits`, `score_links`, `annotations`,
`warmup_exercises`, `audio_recordings`, `notebook_entries`, `practice_goals`, `practice_routines`,
`rule_settings`, `rewards_state`, `practice_sessions`, `sets`, plus `instruments` (spec §6) and
`profiles` (spec §4c) — and the append-only logs `attempts`, `rule_events`, `reward_ledger`,
`badges`, `milestone_events`, `cold_grades`, `break_point_taps`.

**Not** part of this engine, ever: everything in spec §5 (friendships, blocks, activity_events,
reactions, comments, notes, note_replies, presence, studios/studio_members/studio_goals,
invite_codes, the contact-hash tables, reports). None of it has a Core-side mirror — `Profile.swift`
says so explicitly ("the backend/sync track owns the authoritative copy, friend graph and
moderation") — because it is inherently a live, server-first feature set, not an offline-editable
personal record. The client talks to it directly (RLS-gated reads/writes) or through the dedicated
RPCs in `supabase/(C) Backend.md` §5, never through `sync_upsert`/`sync_append`.

## 2. The four RPCs

All are `SECURITY DEFINER`, callable only by `authenticated`, and force `owner_id` (or `id`, for
`profiles`) to the caller's own `auth.uid()` server-side regardless of what the payload says.

- **`sync_upsert(p_table text, p_row jsonb) → jsonb`** — whole-row upsert for anything in
  `sync_tables`. `p_row` must be the _entire_ record (every column that table has, using the exact
  names in §3 below), including `updated_at` (and `id`, unless the table is one of the two
  owner-keyed singletons — `rule_settings`, `rewards_state` — or `profiles`, where the row's key is
  always the caller's own id and `id`/`owner_id` may be omitted). Returns
  `{"applied": true, "row": <the stored row now>}` when the write took effect (including a plain
  insert), or `{"applied": false, "row": <the server's current row>}` when a stored `updated_at` was
  already `>=` the incoming one — **adopt the returned row**, don't retry with the same payload. This
  decision is made atomically (a conditional `ON CONFLICT ... DO UPDATE ... WHERE`), not by a
  check-then-write race, so two devices pushing the same record at once resolve correctly regardless
  of which HTTP request happens to arrive last.
- **`sync_append(p_table text, p_row jsonb) → jsonb`** — insert-only for anything in
  `append_only_tables`. A retried push with the same `id` is a no-op (`applied: false, row: null`),
  not an error — safe to blindly retry after a dropped response.
- **`sync_update_last_page(p_id uuid, p_last_page int, p_at timestamptz) → jsonb`** — the one
  exception Schema3.md names (`Piece.lastPageUpdatedAt`'s own clock). Same
  `{"applied", "row"}` shape.
- **`sync_undo_attempt(p_id uuid, p_undone_at timestamptz) → jsonb`** — the other named exception
  (spec §9 Undo). No-ops if already undone or not owned by the caller.

Reading your own data back is ordinary PostgREST: `select * from pieces where owner_id = eq.<uid>
and updated_at > <last_sync_at>` (RLS already restricts every table to the caller's own rows, so the
`owner_id` filter is for query-planning, not security — see the indexes in
`(C) Backend.md`). `profiles` is the one table where a plain `select`/direct `PATCH` also "works" via
its self-only RLS — but a direct PATCH has no LWW comparison at all, so writes should still go
through `sync_upsert('profiles', ...)`, never a raw PATCH.

## 3. Field-name mapping: why this is not automatic

**Every SQL column in this schema is snake_case; every Core Swift property is camelCase, and Core's
existing `CodingKeys` already fix its JSON key to that same camelCase spelling** (see `Models.swift`
et al.). Foundation's `JSONEncoder.keyEncodingStrategy = .convertToSnakeCase` looks like the obvious
bridge, but **do not use it** — verified empirically (not assumed) against this exact Swift toolchain,
it mishandles a pluralized acronym:

```swift
struct Probe: Codable { var tagIDs: [UUID]; var folderIDs: [UUID]; var pieceID: UUID }
let e = JSONEncoder(); e.keyEncodingStrategy = .convertToSnakeCase
// pieceID -> "piece_id" (correct) but tagIDs -> "tag_i_ds", folderIDs -> "folder_i_ds" (wrong)
```

`pieceID`/`ownerID` (a single trailing acronym) convert correctly; `tagIDs`/`folderIDs`/
`joinedFromPassageIDs`/`currentlyWorkingOnPieceIDs` (a pluralized acronym) do not, and there is no
flag to fix just that case. Column names in this schema were kept as the natural, idiomatic
snake_case a person would choose (`tag_ids`, not `tag_i_ds`) rather than contorted to match a
Foundation quirk that could also differ across Swift versions. **The sync client must give every
type that crosses this boundary an explicit `CodingKeys` (or a parallel DTO) spelling out each
column name by hand**, not rely on an automatic conversion strategy. This is mechanical but is the
one place a generated/automatic approach would silently corrupt data (a field that always encodes
to a column name nothing matches is a field that quietly never syncs), so do it by hand and verify
against §5 below, which lists every column this schema actually has, table by table.

Two more encoding requirements, also verified rather than assumed:

- **Dates must use `.iso8601`.** `JSONEncoder`'s _default_ `dateEncodingStrategy` (`.deferredToDate`)
  encodes a `Date` as a raw `Double` (seconds since 2001-01-01), which `timestamptz`'s input parser
  does not understand at all. Set `.dateEncodingStrategy = .iso8601` /
  `.dateDecodingStrategy = .iso8601` on the encoder/decoder used for every sync payload. Verified:
  `Date(timeIntervalSince1970: 1_790_000_000)` encodes to `"2026-09-21T14:13:20Z"` with `.iso8601`,
  which Postgres accepts natively.
- **`bytea` columns (`ink_strokes.data`, `ink_strokes.fingerprint`) need hex, not base64.** Swift's
  `Data` encodes to base64 by default; Postgres's `bytea` input function expects `\x`-prefixed hex
  (or the legacy escape format), not base64. The client must hex-encode `InkStroke.data`/
  `.fingerprint` itself before putting it in a `sync_upsert('ink_strokes', ...)` payload (e.g.
  `"\\x" + data.map { String(format: "%02x", $0) }.joined()`), and hex-decode both fields back into
  `Data` when reading a row back. `fingerprint` is nullable — omit it, or send JSON `null`, for a row
  the whole-page compatibility shim wrote, which never computes one.
- **jsonb columns are opaque.** `regions`, `schedule_*` (flattened, not jsonb — see §5), `items`,
  `crop_rect`, `source_region`/`target_region`, `tempo_step`, `stages`, `passage_snapshot`,
  `location` (on `break_point_taps`) all just store whatever Core's own `JSONEncoder.encode(...)`
  produces for that Swift value, unmodified, and hand it back unmodified on read — the server never
  inspects their contents. In particular, `TempoStep` (an enum with one associated value and no
  custom `Codable` conformance) encodes as `{"fixed":{"_0":4}}` / `{"percent":{"_0":6}}` (verified),
  not the friendlier `{"kind":"fixed","amount":4}` a hand-written wire format might guess at — that's
  fine, since nothing server-side ever parses it, but don't hand-construct a "nicer-looking" jsonb
  value for this column expecting Core to read it back; round-trip whatever Core's own encoder
  produces.
- **Enum labels are exactly Core's raw values** (verified against the actual Swift, not re-derived):
  `performanceReady`, `pluckedStrings`, `lessonNote`, `lessonPrep`, `onlyMe` — camelCase, matching an
  undecorated Swift case's synthesized raw value, not the snake_case a human might guess.

## 4. Verified, not assumed

Every claim in §3 was checked by actually running the relevant Swift code against this Xcode
toolchain (`swift <file>.swift`, Foundation's real `JSONEncoder`/`JSONDecoder`) and by applying every
migration in this directory to the live hosted project (`supabase db query --linked -f`) rather than
only reading the SQL. Two real bugs were caught this way before any client depended on them: the
`tagIDs`-style snake_case mismatch above, and `sets.tempo_step`'s default value being a shape
(`{"kind":"fixed","amount":4}`) `TempoStep` doesn't actually produce. Treat this document, not an
assumption about what "should" work, as the source of truth for the wire format.

## 5. Table-by-table column reference

Column names below are exactly what's in the migrations; anything not listed here (id, owner_id,
created_at, updated_at, deleted_at) follows the obvious pattern already described. Enum/check-
constrained columns take the string exactly as shown; array columns take a JSON array of the
element's own JSON representation (UUID/ISO-date/int strings — never bytea, so no hex concern
there); jsonb columns are opaque per §3.

| Table                                                                                                       | Notable columns (Core field → SQL column, where they differ)                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instruments`                                                                                               | `transposition_semitones`, `transposition_label` (`Transposition?` flattened)                                                                                                                                                                                                                                         |
| `pieces`                                                                                                    | `tag_ids`, `folder_ids`, `performance_dates` (array), `last_page_updated_at` (own clock — write via `sync_update_last_page`, not `sync_upsert`)                                                                                                                                                                       |
| `passages`                                                                                                  | `regions` (jsonb array of `PassageRegion`), `joined_from_passage_ids`, `learning_state`, `schedule_due_date`/`schedule_interval_days`/`schedule_review_step` (`PassageSchedule` flattened)                                                                                                                            |
| `ink_strokes`                                                                                               | `data`, `fingerprint` (both bytea — hex, see §3; `fingerprint` nullable)                                                                                                                                                                                                                                              |
| `page_edits`                                                                                                | `crop_rect` (jsonb `NormalizedRect?`), `deleted` (Core's own reading-order flag — distinct from the sync tombstone `deleted_at`)                                                                                                                                                                                      |
| `score_links`                                                                                               | `source_region`/`target_region` (jsonb `NormalizedRect?`)                                                                                                                                                                                                                                                             |
| `annotations`                                                                                               | Unified `TextBoxAnnotation`/`StampAnnotation`: `kind` (`'text'` or `'stamp'`), `region` (jsonb), then either `text` or `stamp_kind`/`stamp_label` per the `annotations_kind_shape` check                                                                                                                              |
| `warmup_exercises`                                                                                          | `key`, `mode`, `instrument_family`, `custom_from_passage_id`                                                                                                                                                                                                                                                          |
| `sets`                                                                                                      | `PracticeConfiguration` + `ActiveSet` flattened onto one row: `tempo_step`/`stages`/`passage_snapshot` (jsonb, opaque), `goal`/`basis` (checked against the exact Swift raw values)                                                                                                                                   |
| `rule_settings`, `rewards_state`                                                                            | Owner-keyed singleton — no `id` column; `sync_upsert` targets them by the caller's own uid                                                                                                                                                                                                                            |
| `attempts`, `rule_events`, `cold_grades`, `break_point_taps`, `reward_ledger`, `badges`, `milestone_events` | Append-only: no `updated_at`/`deleted_at` at all — don't send them                                                                                                                                                                                                                                                    |
| `profiles`                                                                                                  | Superset of Core's `Profile` (spec §4c fields Core doesn't mirror locally — `age_bracket`, `is_private_account`, `leaderboard_opt_out`, `upcoming_performances`, `privacy_presence`, `privacy_notes` — are backend-only; the iOS integration track needs its own DTO for the full shape, not `Core.Profile` directly) |
