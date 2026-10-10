# Shared account and practice data contract

Current native source: 2.0.0/build11/schema5 candidate; personal iPad:build10; requested friend’s fresh empty build11 installation pending final signing checks (Developer Mode/DDI ready). Updated October10,2026.
This contract is the starting point for a future Mac, Windows, Android or web client. The installed
Tauri Mac application does not yet implement this adapter. A shared backend is readiness for those
clients, not evidence that their local databases already synchronize.

## Identity and ownership

Use the same Supabase Auth account UUID on every platform. A guest library has no account owner;
signing in follows the existing account-isolation/guest catch-up flow. Bind the durable queue to the
account and clear queues/cursors at sign-out. Never send account A's queued data under account B.
Pending profile edit intent and its cache stay bound to the same library owner across ordinary
sign-out/re-login; a different account cannot adopt them. Account deletion detaches that ownership.
Passwords, refresh tokens and system permissions remain in platform credential/permission stores.

Use durable UUID record IDs, with append-only event IDs and soft-deletion clocks. Never create a new
record ID when retrying. Profile names, username, photo reference, biography, instruments, current
repertoire, privacy choices and server-managed profile fields use the existing `profiles` contract.
The backend enforces ownership and privacy; clients cannot establish ownership by passing an ID.

## Coverage

| Data | Shared location | Current native behavior |
| --- | --- | --- |
| Account/profile and privacy | Auth, profiles, dedicated profile/social RPCs | Profile DTO/cache, server-only fields retained |
| Scores and library organization | pieces, tags, folders, setlists, bookmarks, page_edits, score_links | Durable offline records, owner-scoped row sync |
| Passages and annotations | passages, ink_strokes, annotations | Colored boxes, source-page geometry, PencilKit bytes, stamps and sticky text; build11 adds optional style inside annotations.region JSONB |
| Movements, measure regions and default tempo | pieces.score_sections, measure_anchors, default_practice_bpm | Reviewed ranges and confirmed regions; no inferred OMR claims |
| Practice and history | practice_sessions, sets, attempts, cold_grades, break_point_taps, rule_events | Parent-first graph application, append IDs, durable remote Undo |
| Goals and routines | practice_goals, practice_routines | Edit/deletion clocks, offline queue and pull reconciliation |
| Instruments, warmups, notebook, rules, rewards | instruments, warmup_exercises, notebook_entries, rule_settings, rewards_state and event tables | Supported native model coverage |
| User preferences | account_preferences.preferences | Theme, screen-awake choice, haptics/voice preference, passage visibility, compact controls and auto-turn choice |
| PDFs, recordings, avatars, covers, social media | Private Storage buckets | Account-owned paths; PDFs/recordings/covers reconcile with retries; avatar/social uploads currently require user retry on failure; metadata does not substitute for bytes |
| Social graph, feeds, studios, moderation | Dedicated backend tables/RPCs | Server-authoritative; not offline whole-library sync |
| Original imported Mac archive | Local native files and backup | Retained intact; not uploaded or replayed as mobile rewards |

OS microphone/speech grants, live audio playback, device hardware capabilities, current sheets,
Pencil tool UI state and local file URLs are not account data. A synchronized preference is a
choice; each device still checks its own capability and permission before using it.

## Optional sticky-note style (build11 candidate)

Text annotations add local `style`, encoded as `region.textStyle` for sync. Existing x/y/width/height
and every SQL column remain unchanged; no backend deployment is required. Supported fields are
fontSize (12–48, default20 on a595-point canonical page width), fontFamily, isBold/isItalic,
textColor and alignment. Older notes decode readable defaults with no schema migration or eager
library rewrite. Updated native clients preserve style through local saves/backups/sync; old
clients may drop unsupported style when rewriting the note. This is not an automatic nested merge.
Physical two-device style retention and non-native rendering/editing remain separate acceptance.

## Wire and conflict rules

Read `supabase/(C) Sync Protocol.md` and use the explicit DTOs in `ios/Praelude/Core/SyncDTO*.swift`
and `SyncPreferences.swift` as the current wire reference. SQL keys are snake_case; nested JSON
objects use the explicit Codable names of their models. Dates are ISO8601 UTC, binary ink is bytea
hex, and UUID Storage path components are lowercase. Do not rely on automatic acronym conversion.

`sync_upsert` uses an atomic owner-checked last-write-wins record clock. Send all fields the client
owns, including explicit JSON null for a nullable value being cleared. An absent SQL key retains
an existing value or an insertion default, so an older client cannot erase new columns it does not
know. An explicit empty array clears the represented collection. Never turn every absent future
key into null; the native queue has a manifest of only nullable fields it actually understands.
For `account_preferences` only, the server shallow-merges represented preference keys into the existing object after the same row-clock check; unknown future keys survive older-client edits. Other nested arrays remain explicit versioned model contracts. Read the returned winning row and persist it before acknowledging the queue. Profile extras and
server preference clocks must survive this adoption without triggering a write/pull echo loop.
Before a first profile push, native sync reads the account profile and hydrates its privacy and
performance cache. Local defaults adopt account identity; nonempty guest identity fills blank
account fields, and explicit edits staged during the read are retained. Signing in alone does not
advance the profile edit clock. The guest practice library keeps its existing records and files.
Profile Save stages core and privacy edits together before committing the local profile. A staging
or library-save failure keeps the editor's draft and reports the error; pending durable intent is
recoverable on retry rather than silently replaced by the first cloud read.

Goals, routines and deleted score parents retain tombstones. Deleting a never-uploaded piece must
still upload the parent tombstone before dependent records, preventing FK failures and revival.
Append-only events use `sync_append`, reading-position and Undo have dedicated RPCs. Paginated
reconciliation includes late offline events and remote Undo; a client timestamp cursor alone is
not a complete ingestion history. New clients must implement the practice graph atomically and
preserve historical conditions rather than recomputing old achievements under new rules.

Future migrations are additive. Maintain explicit JSON schemas for array-contained models; an
older client must not edit/reencode an unsupported nested structure. Version native backups and
refuse unsupported schema payloads. Native schema5 retains exact originals; backup version4
cannot be safely restored by old readers. Pencil strokes currently retain PencilKit drawing bytes. Future platforms must preserve those opaque bytes and provide a rendering/editing adapter or an explicitly versioned portable representation; sharing the record alone does not establish editable ink parity. The Mac SQLite schema21 is a separate format, requiring
an explicit adapter and data-preservation acceptance rather than a shared database file.

## Acceptance and expansion

Core/fake two-device tests cover deterministic convergence, deletion, account isolation and
nullable clears. Hosted rollback-only SQL checks cover owner isolation and the actual RPC schema.
These do not establish a musician's account/PDF/ink history on two physical devices. Real-account
sign-in, round-trip edits/files/Undo and offline recovery remain required before declaring live
cross-device continuity accepted. The personal iPad has build10/schema5 after a guarded in-place update with complete file preservation. The requested friend’s build11 installation remains pending and does not authorize importing personal data. Neither a second-device install nor one-device test results establish account convergence.

**Next steps:** accept a real two-device account flow using the installed candidate,
then implement each future platform adapter against this contract with migration and fixture tests.
