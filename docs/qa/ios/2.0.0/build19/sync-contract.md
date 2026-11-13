# Build19 native sync contract

Implementation checkpoint October 16, 2026: the user reported neither device signed in; the hosted score
table contained **0 rows**. Later iPhone installation/readback has matching local profile/sync ownership;
this does not verify a live session or convergence. The additive schema is deployed and deterministic checks pass. This
does **not** establish that the existing local iPad library is already in the cloud, or prove
real-account iPhone↔iPad convergence. See [exact verification](sync-verification.json).

This is a **personal sync acceptance gate**, not a blocked backend deployment. The user must sign
in locally to the same account on iPhone and iPad before their libraries can upload and be compared.
No additional backend migration is pending for that flow. Candidate verification can complete
while this separate personal roundtrip remains unaccepted. “Synced” in the table below describes
the implemented signed-in data contract; it does not claim the user's local library has
already uploaded.

| Data | Classification | Behavior and boundary |
| --- | --- | --- |
| Imported score PDFs and cropped-photo passage PDFs | Synced | Private owner-prefixed `scores` objects; local metadata and bytes reconcile separately. Missing files retry on a future foreground/network/manual sync. A metadata row alone does not prove its file is uploaded. |
| Photo origin and passage image identity | Synced | Nullable `pieces.is_photo_passage`, immutable PDF filename and normal passage regions; origin survives filename remapping and folder renaming. Each folder uses a normal UUID. The card preview is derived locally from the synchronized PDF and first region. |
| Passage boxes, titles, measures, focus, review due date/interval/step, parking and learning state | Synced | `passages` whole-record LWW, including tombstones; first-region cover does not add a separate image to synchronize. |
| Piece full tempo and practice coverage goals | Synced | Build19 adds nullable `full_tempo_bpm` and `practice_balance_plan`. Zero-valued plan fields clear goals; explicit null clears full tempo. Missing legacy keys preserve current local fields and existing server columns. |
| Library organization, score sections, measure anchors, default practice tempo, last page | Synced | Pieces/tags/folders/setlists/bookmarks/page edits/links; last page has its separate update clock. |
| Ink, stamps, sticky text and text style | Synced | Native iPhone/iPad render the synchronized annotation bytes, per-stroke rows and deletion clocks. iPhone has no Pencil hardware; its existing finger-markup setting remains available. Older annotation writers can omit nested optional text styling; all editing clients should be current. Mac/Windows continuous ink-editing adapters are not implemented. |
| Practice sessions, sets, verdicts, Undo and history | Synced | Durable parent-first queue, atomic practice-graph application and append IDs; remote Undo is repulled. Set reference tempo/hands remain captured in existing versioned `tempo_step` JSON. Whole-record conflicts use edit clocks, not a simultaneous-session collaboration model. |
| Calendar and recorded streak | Derived from synced records | Recomputed from actual recorded sessions/repetitions on each device, using its calendar/timezone. A blank opened session is not practice. Different timezones can assign activity to different calendar days. |
| Goals, routines, instruments, warmups, notebook, rules, rewards and supported account preferences | Synced | Existing native DTO/table contracts; clocked offline records and append-only logs. Preference choices do not grant hardware permissions or start audio remotely. |
| Recordings and custom covers | Synced | Private owner storage with transfer receipts. Before local publication, downloads validate readable audio, bounded decodable cover pixels, or unlocked PDFs with 1–2,000 pages. A corrupt remote asset remains pending rather than becoming a permanent local file. |
| Account profile, privacy and server-managed social data | Synced/server authoritative | Existing profile cache/DTO and dedicated social RPCs. Failed avatar/social uploads still require user retry. |
| Original imported Mac archive | Snapshot-only | Retained by native backup/import; no continuous replay into Mac SQLite. |
| Phone/tablet Counter vs Score choice, counter awake option, camera calibration/mappings, live metronome/recording state, current dialogs, permissions and local file URLs | Local-only | Each device retains its own presentation, capabilities and permission state. Counter mode on a phone does not switch the iPad out of its score. |
| Installed Tauri Mac/Windows continuous account library sync | Unsupported | Those clients still need explicit adapters and their own migration/data-preservation acceptance. Native Supabase support does not create this automatically. |

Sync runs after local edits, on sign-in/foreground, network recovery and explicit retry. The queue
persists before acknowledgment and retains original IDs. It is eventually reconciled while online;
there is no claim of instantaneous live editing across devices. A corrupt account-state file blocks
sync and preserves its bytes and queued changes. Requests reject a refreshed token for another
owner. File downloads stage and validate away from the UI actor, then recheck ownership and publish
without replacing a file that became local while the request was running.

When a verified file first becomes local, the service posts an in-process, URL-scoped
`praeludeLibraryAssetAvailable` event so an already-visible card or image preview can retry without
waiting for metadata to change. It posts after publication and before transfer-receipt persistence:
the image must display even if receipt storage later fails. This event means **local availability**,
not “Synced,” and is neither persisted nor transmitted. Existing/rejected publications and invalid
staged assets do not emit it.

The storage regression includes receipt-write failure explicitly: complete newly published bytes
still emit the availability event, while the receipt error remains a transfer failure. It also
checks that existing/rejected destinations and malformed staging emit no event. Final serial
`phone-final6` verification passes all 11 storage tests (0 failures, 0.047 seconds), including the
availability case (0.007 seconds), and the delayed-PDF card/zoom pixel case (0.602 seconds). The full
hosted run passes 360 tests with 1 live-account skip and 0 failures in 16.159 seconds (16.265 suite).
Logs/result: `/tmp/praelude-build19-phone-final6.log` and the matching `.xcresult`. These tests do
not replace the personal sign-in/roundtrip gate.

The previous `phone-final5` run retains seven failed assertions in the one new storage-notification
test. Its observer compared URL directory syntax: the derived parent ended in a slash while the
constructed fixture directory did not, so it filtered out the actual notifications. A small
Foundation reproduction confirmed that mismatch. The repair changes only the test to compare
normalized filesystem paths; all publication-order and receipt-failure assertions remain. The
final run verifies the correction without a production-code change for that fixture issue.

The new database columns have **no defaults or backfill**. Old server rows remain null until an
updated owner client publishes its values. The deployed generic upsert updates only supplied
columns, so older native clients cannot erase these new SQL columns merely by omitting them.
Updated native readers preserve local planning/origin when the server omits the fields; a present
null full tempo is an explicit clear, while a null legacy plan/origin is unpublished. Older app
backups do not understand newly added local fields, so use a current client for export/restore.

Before accepting real-account continuity: sign into the **same account on both devices**, let the
existing library finish uploading, then verify score/photo appearance and cropped card identity on
the other device. Check renamed passages, annotations, a completed set, calendar/streak totals,
remote Undo, and an offline edit followed by relaunch/reconnect. Keep each device's local library
and backup until those comparisons pass. No personal account credentials, sign-in or live personal
library mutations were used during this verification.

**Next steps:** complete both-device sign-in and the physical roundtrip above; retain its separate
pass/fail evidence. Package, simulator and SQL-fixture results alone cannot close that gate.
