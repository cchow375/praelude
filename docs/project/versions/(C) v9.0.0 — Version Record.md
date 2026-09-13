# CodaKiller v9.0.0 — Portable Pieces Library + Share-Clean Build

> **DRAFT PACKAGED-CANDIDATE RECORD — NOT YET IMMUTABLE.** Created 2026-08-30. **v9.0.0 /
> schema 21 is a packaged shareable candidate; it is not installed and clean-recipient acceptance
> is pending.** Source/build, independent cleanliness, isolated fresh-store, exact-copy migration,
> browser visual and final package gates pass. The installed/published app remains **v8.2.1 /
> schema 20**; one live open session and block intentionally prevented replacement. Package
> implementation and release/docs identities are fixed, and the tag/private pushes succeeded,
> but this record remains a draft and becomes immutable only after safe install plus
> clean-recipient acceptance.

## Release identity

| Fact | Value |
| --- | --- |
| Product | CodaKiller |
| Candidate version | 9.0.0 |
| Candidate database schema | 21 |
| Installed version before release | 8.2.1 / schema 20 |
| Implementation commit | `709542023b3e3bf0c9e72189d145e5fd524eaacd` |
| Release/docs commit | `6a560eeae328e7cb44019058c319f0617aa5372e` |
| Package-boundary/tag target | `6a560eeae328e7cb44019058c319f0617aa5372e` |
| Tag | lightweight `v9.0.0` → `6a560eeae328e7cb44019058c319f0617aa5372e`; pushed successfully |
| Remote publication | private `origin/main` → `6a560eeae328e7cb44019058c319f0617aa5372e`; `v9.0.0` pushed successfully; this is package publication, not install/recipient acceptance |
| App path | **PENDING — `/Applications/CodaKiller.app` still contains v8.2.1** |
| DMG path | `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg` |
| DMG bytes | **10,736,628** |
| DMG SHA-256 | `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06` |
| Checksum sidecar | basename-only, 87 bytes |
| Packaged app identity | 9.0.0 · `com.christian.codakiller` · arm64 · minimum macOS 13 |
| App CDHash/signature result | strict codesign PASS · ad-hoc CDHash `33ffc5fade7ecb090c5fd7b08818ae82164cbc21` · not Developer ID/notarized |
| Release date | **PENDING** |

## Why this version exists

Christian wants to send CodaKiller to another pianist now, using the same normal product he uses.
His voice feedback identified three connected failures:

1. Pieces was buried behind History and did not feel like an editable repertoire library.
2. Adding sheet music was organized around a long IMSLP-first search/edition/download/import flow,
   even when the user already had a PDF.
3. A sendable app should not carry preloaded copyrighted book quotations or practice-method
   content, Christian's pieces or his history.

v9 treats this as one product correction, not a “friend edition.” The shareable build and the
normal build are identical.

## Candidate product contract

### Pieces is the primary workspace

- The top-level repertoire destination is **Pieces**.
- It opens to **Library | History | Calendar**, in that order.
- History remains complete and close by, but it no longer defines the main tab.
- The Library heading and Add Piece action make the repertoire surface discoverable.

### The Library is editable

- Pieces may remain **Unfiled**.
- Users may create arbitrarily nested logical folders/subfolders, rename/reparent/delete them and
  move pieces among them.
- Folder membership is SQLite metadata only. Organizing the Library never moves score files or
  invalidates edition paths, score marks, Regions or practice history.
- Deleting a logical folder promotes its direct pieces and child folders one level; it does not
  delete their content. A colliding promoted child-folder name receives a numeric suffix.
- Status projections are **Active**, **Completed** and **Archived**.
- Right-clicking a piece or using its visible ellipsis exposes Open, Move, Mark complete/Return to
  active, Archive/Restore and Remove.
- Completion and archive are reversible metadata.
- Remove is stronger but still recoverable: for an eligible app-owned piece, its folder moves to
  the configured Pieces root's `.trash`, the DB row is retained/re-pointed and practice history
  remains joinable. It is not a hard delete.

### Add a local PDF directly

- **Add Piece** asks for title, optional composer, optional logical folder and a local PDF.
- The PDF may be chosen or dragged onto the window.
- The backend accepts only a regular non-symlink `.pdf` with real `%PDF-` magic.
- It copies the source into a collision-safe `<Pieces>/<piece>/score/` home and leaves the user's
  original file in place.
- A failed DB insert quarantines the incomplete directory under `.trash`; a partial piece cannot
  silently appear on the next scan.
- IMSLP remains available only as **Find a public-domain score on IMSLP ↗**. The user downloads in
  the system browser, clears any IMSLP bot check there, then returns and chooses the PDF. The app
  never bypasses IMSLP CAPTCHA.

## Fresh install and upgrade contract

There is one binary with two data-safe initialization paths:

- **Fresh first-ever install:** create and persist an empty app-owned Pieces root under the app's
  data directory. The user-visible Library has no repertoire or history. Internal schema setup may
  still own the hidden system Warm-ups row and a generic protocol template; neither is a user
  piece, score or practice record. No personal piece row or source path is seeded.
- **Upgrade with saved path:** the existing `vault.pieces_dir` setting wins unchanged.
- **Older upgrade with rows but no setting:** infer a root only when all active repertoire piece
  folders share one absolute parent, then persist it.
- **Ambiguous/no legacy root:** do not guess a Christian path. Use the safe fresh-app-owned path.
- Schema 21 additions are nullable/defaulted so existing piece rows, physical paths and historical
  foreign-key relationships remain intact.

The release still owes an exact disposable-copy schema-20→21 rehearsal against the current live
database and a before/after installed audit. Source unit tests are not a substitute.

## Share-clean and copyright scope

The candidate removes from the distributable source/bundle:

- the quote JSON/rotation/matching surfaces;
- the scholarly Reader window;
- Settings Books management;
- the passage-helper strategy surface;
- the embedded practice-method payload and its Knowledge module/test;
- user-facing copy that promises a bundled book/method library.

The build privacy gate must reject personal or content files in `dist` or the app bundle,
including databases, SQLite files, PDFs, MusicXML/MXL, quote/book payloads, old method IDs and
Christian-specific Knowledge/Pieces source paths. The bundle must contain the third-party notices.

This scope is deliberately non-destructive:

- Christian's external `Knowledge and Resources` directory is not deleted or edited.
- Historical `brain_thread`/`brain_turn` rows are not purged; they may contain old citations or
  excerpts from earlier use.
- Existing user PDFs, notes, recordings, photos and history are not bundled into the candidate and
  are not removed from an upgrade.

Deleting external source material or historical DB text would require separate explicit approval,
a backup and its own migration/verification plan.

## Schema 21

Schema 21 adds:

- `piece_folder(id, name, parent_id, created_at, updated_at)` with sibling-name uniqueness and a
  cycle-prevention trigger;
- nullable `piece.folder_id` with `ON DELETE SET NULL`;
- nullable `piece.completed_at`;
- `piece.metadata_source` (`scan` or `user`, default `scan`), which protects user-entered title/
  composer metadata from later scanner refreshes; it is not an IMSLP URL field;
- an index over repertoire/library state.

The migration does not delete or rewrite practice evidence. The exact disposable schema-20 copy
rehearsal passes: 11 pieces, 255 blocks, 2,315 reps, 51 sessions and 9,173 events remain exact;
integrity stays OK/FK0 and new folders/assignments/completed pieces remain zero.

## Candidate source inventory

Primary implementation areas:

- `src/features/pieces/{PiecesPanel,PieceLibrary,AddPiece,PieceDetail,ConfirmArchive}*`
- `src/features/ledger/LedgerCalendarWorkspace*`
- Shell/Today/Settings/Assistant cleanup and matching devMock/tests
- `src-tauri/src/pieces.rs`
- `src-tauri/src/store/{piece_library,migrations,model,mod}.rs`
- `src-tauri/src/{lib,settings,universe}.rs` and Assistant corpus/provider cleanup
- version manifests, `START_HERE.txt`, `THIRD_PARTY_NOTICES.txt`
- `scripts/check-share-clean.sh`, `scripts/package-macos.sh`, `npm run package:mac` and release integration
- repository plan and `docs/qa/v9.0.0/README.md`

## Distribution boundary

- Supported candidate target: **Apple-silicon Mac (M1 or newer), macOS 13 or newer**.
- This project has no paid Apple Developer ID. The app is locally/ad-hoc signed and is not
  notarized.
- A recipient must drag the app to Applications, Control-click it, choose **Open**, and may need
  **System Settings → Privacy & Security → Open Anyway**.
- Intel macOS, Windows, automatic updating, notarized/public-store distribution and a warning-free
  first launch are not claimed.
- Microphone/Speech Recognition/Dictation are needed only for hands-free voice; manual Library and
  practice use should remain available without them.

## Verified package-only evidence

- **Frontend:** 204 files passed / 1 skipped; **2,525 tests passed / 1 skipped**. TypeScript and
  production build pass.
- **Native:** library **1,077 passed / 17 ignored / 0 failed**, plus integration suites. Five
  narrated corpora pass with zero failures. Rust format, strict Clippy and native app build pass.
- **Cleanliness:** independent review, production `.app` scan and mounted final-DMG scan pass.
  No DB/SQLite/sidecar, PDF, MusicXML/MXL, book/quote/method, devMock or personal path/name is
  present. The scanner detects disguised SQLite by magic bytes.
- **Fresh store twice:** real on-disk initialization reaches schema 21/integrity OK/FK0; active/
  all Library and folders are blank; repertoire/blocks/reps/sessions/events/Brain turns are zero.
  Only hidden Warm-ups and one generic protocol with `source_refs_json='[]'` exist. Disk holds
  only the DB and empty `Pieces/`; no Knowledge setting/directory exists. Reopen is idempotent.
- **Exact disposable migration:** before schema 20 integrity OK/FK0, 11 pieces / 255 blocks /
  2,315 reps / 51 sessions / 9,173 events, SHA-256
  `8bd284b80f1e675966a88f6ac5feb7585226ca2f8c09b9e8d33145a3f714dab8`; after schema 21,
  integrity OK/FK0 and exact counts preserved, with zero folders/folder assignments/completed
  pieces, SHA-256 `35860ff9d2e9912ef7bd100a6dbb6795408b24cbd5c5a4175bd2a684043ef41b`.
- **720×520 devMock:** Pieces top nav/Library default/History/Calendar, Add PDF, nested folders,
  actions/lifecycle/remove/blank state and no horizontal overflow pass. One clipped folder menu
  was found, fixed and retested 4/4. Browser mock does not prove native picker/drop/persistence;
  a Today→Calendar automation click timed out, while exact deep links remain test-covered.
- **Final DMG:** `hdiutil verify`, strict mounted codesign and mounted scan pass. Top level is
  exactly the Applications symlink, `CodaKiller.app`, `START HERE.txt` and
  `Third-Party Notices.txt`. Full `hear` BSD, React/Tauri MIT and PDF.js Apache notices are
  top-level and byte-identical inside the app; the scanner asserts them. The package-only script
  never touches `/Applications`. The old pre-fix DMG was deleted; only the corrected final remains.

## Install/session safety

The release script can quit the running app and replace `/Applications/CodaKiller.app`. Before
using it:

1. Confirm whether a practice set/session is open.
2. Deliberately close or preserve/export the work; never interrupt it implicitly.
3. Take a fresh backup of the exact current schema-20 DB.
4. Archive the outgoing installed v8.2.1 app for rollback.
5. Rehearse schema 20→21 on a disposable copy of that exact DB.
6. Build/package/share-clean scan without touching the installed copy first.
7. Install only after those gates pass; then audit the same data before/after and launch fresh.

The **2026-08-30 19:25 EDT** live read-only audit found schema 20, integrity OK/FK0, **11 pieces /
255 blocks / 2,327 reps / 51 sessions / 9,241 events / 1 open session / 1 open block**. The
zero-open precondition was not met, so the installing release script was intentionally not run.
Installed v8.2.1 and live data remain untouched. No fresh pre-install backup, rollback archive,
one-copy audit, installed before/after migration or installed-native launch is claimed.

## Verification matrix

| Gate | Candidate result |
| --- | --- |
| Frontend tests | **PASS — 204 files / 2,525 tests; 1 file / 1 test skipped** |
| Native tests | **PASS — lib 1,077 / 17 ignored / 0 failed + integration suites** |
| TypeScript | **PASS** |
| Rust formatting | **PASS** |
| Strict Clippy | **PASS** |
| Production frontend build | **PASS** |
| Native app build | **PASS** |
| Five narrated/voice corpora | **PASS — zero failures** |
| Share-clean production app + mounted final DMG | **PASS** |
| Independent/fresh-context cleanliness review | **PASS** |
| 720×520 Library visual/interaction QA | **PASS in browser/devMock; native limits above** |
| Isolated on-disk fresh-store contract twice | **PASS; packaged launch remains separate** |
| Disposable exact schema 20→21 rehearsal | **PASS — exact counts/integrity/FK0** |
| Existing root/DB/history preservation contract | **PASS in source/disposable copy; installed proof pending** |
| No open session/set before install | **NOT MET — 1 open session + 1 open block; install stopped** |
| Pre-install DB backup | **PENDING — deliberately not taken before zero-open gate** |
| v8.2.1 rollback archive | **PENDING — deliberately not taken before zero-open gate** |
| Bundle version/ID/architecture/signature/notices | **PASS for final packaged app** |
| DMG size/SHA-256/verify/mounted scan | **PASS — exact identity above** |
| One-copy audit | **PENDING** |
| Exact installed before/after counts, integrity and FKs | **PENDING** |
| Fresh installed launch | **PENDING** |
| Clean recipient Gatekeeper + first-piece walkthrough | **PENDING** |
| Package commit/tag/private push | **PASS — exact identity above** |

## Honest open limits

- v9's package can be complete while installed and recipient usability remain unproven.
- The ad-hoc/not-notarized opening sequence is real friction and may be too much for a nontechnical
  recipient; only the clean-Mac test can judge it.
- Remove can only move a real direct-child folder under the configured Pieces root. An external or
  malformed legacy path is refused rather than guessed/deleted.
- Direct PDF import does not download from IMSLP automatically and does not accept arbitrary file
  types.
- Existing open native Score, microphone/Listen Back/Steinway, provider mapping and sustained-
  motivation acceptance threads are not closed by this release.
- The app remains Mac-only and self-distributed.

## Historical decision corrections

- **v8.1 “archive + recent-first, no folders”** was true for that release and remains in its
  immutable record. Christian explicitly reversed it on 2026-08-30; v9 adds logical folders.
- **v4/v5 IMSLP-first add-a-score** remains historical. v9 makes local PDF intake primary and IMSLP
  optional external discovery.
- Prior quote/book/method releases remain factual historical records. v9 removes that payload and
  UI prospectively; it does not rewrite what earlier versions shipped.

## Next steps

1. Christian safely closes or deliberately preserves the live open session/block; repeat the
   zero-open audit, then make the current DB backup and v8.2.1 rollback.
2. Install only after that gate; record exact before/after data, one-copy, fresh native launch and
   native Library/file-picker/drop/persistence evidence.
3. Run the exact final DMG's Control-click/Open Anyway and first-piece flow on a clean
   Apple-silicon macOS 13+
   recipient environment.
4. Freeze this record as immutable only after install and clean-recipient acceptance; packaged
   implementation `709542023b3e3bf0c9e72189d145e5fd524eaacd` is fixed, and release/docs commit
   `6a560eeae328e7cb44019058c319f0617aa5372e` is already the pushed `v9.0.0`/`origin/main` target.
