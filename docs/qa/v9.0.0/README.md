# v9.0.0 — Pieces Library and share-clean QA ledger

> **Evidence state: v9.0.0/schema 21 PACKAGED SHAREABLE CANDIDATE; NOT INSTALLED;
> CLEAN-RECIPIENT ACCEPTANCE PENDING (2026-08-30).** Recorded source/test/build gates, two isolated blank
> profiles, exact-copy migration rehearsal, devMock visual QA and the notice-corrected package/
> mounted-DMG audit have evidence below. The installed app remains **v8.2.1 / schema 20**. Live
> installation is blocked by one open session and one open block. Packaging is not shipment,
> installation or recipient acceptance.

## Identity under test

| Item | Expected candidate | Proved value |
| --- | --- | --- |
| Product | CodaKiller | PASS — mounted `CodaKiller.app` |
| Version | 9.0.0 | PASS — bundle short version 9.0.0 |
| Schema | 21 | PASS — two fresh profiles and disposable migration |
| Bundle ID | `com.christian.codakiller` | PASS |
| Architecture / minimum OS | Apple silicon / macOS 13+ | PASS — arm64 / 13.0 |
| Implementation commit | committed source boundary | `709542023b3e3bf0c9e72189d145e5fd524eaacd` |
| Tag / private backup | `v9.0.0`; private `main` + tag | PASS — lightweight package-boundary tag and private push |
| Signing | local/ad-hoc; not notarized | PASS — mounted strict verification; CDHash `33ffc5fade7ecb090c5fd7b08818ae82164cbc21` |
| DMG/archive path | versioned candidate | `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg` |
| Artifact bytes / SHA-256 | exact candidate | 10,736,628 bytes / `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06` |
| Checksum sidecar | basename-only | PASS — 87 bytes |

## Automated source gates

Record exact counts, skips and failures—not only a green/red summary.

| Gate | Intended command or check | Result |
| --- | --- | --- |
| Frontend tests | `npm test` | PASS — 204 files / 2,525 tests passed; 1 file / 1 test skipped; 0 failed |
| TypeScript | project type-check command | PASS |
| Production frontend build | `npm run build` | PASS |
| Rust tests | `cd src-tauri && cargo test` | PASS — library 1,077 passed / 17 ignored / 0 failed; all reported integration suites passed |
| Rust format | `cd src-tauri && cargo fmt --all -- --check` | PASS |
| Strict Clippy | `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | PASS |
| Native app build | `npm run tauri build -- --bundles app` | PASS |
| Five narrated corpora | project release/corpus gates; zero false mutations required | PASS — zero failures |
| Eight release gates | project release script | PENDING |
| Share-clean scan | source review plus `scripts/check-share-clean.sh` against production app and mounted final DMG | PASS |
| Non-installing package | `npm run package:mac` → `scripts/package-macos.sh` | PASS — does not quit/launch/replace installed app or touch live DB |

## Source and payload review

- [x] No runtime quote corpus, quote-matching/rotation code or quote UI remains.
- [x] No bundled book/method payload or native Knowledge library remains.
- [x] No Books/Knowledge/Resources navigation or Settings surface remains.
- [x] Source, production-app and mounted-final-DMG scans found no reintroduced payload.
- [x] Assistant open-question behavior still compiles and remains gated as before.
- [x] The external knowledge-source folder was not deleted or modified by this release.
- [x] Schema 21 adds library metadata; it does not purge or rewrite historical database turns.

The final scanner rejects database/SQLite/sidecar files, disguised SQLite magic, PDF/MusicXML/MXL,
book/quote/method/devMock markers, personal paths/names and missing notices. The mounted DMG's full
hear BSD, React/Tauri MIT and PDF.js Apache notices are byte-identical to the copies inside the app.

## Pieces Library interaction matrix

Capture native screenshots at 720×520 and at a normal desktop size. Browser/devMock frames may
support layout review but cannot substitute for packaged-native file picking, IPC or persistence.

| Scenario | Required observation | Result / evidence |
| --- | --- | --- |
| Entry point | Pieces Library is primary; Library/History/Calendar are clear | PASS — 720×520 devMock screenshots |
| Empty state | Blank profile explains Add Piece without seeded repertoire | PASS — devMock plus two blank on-disk profiles |
| Add Piece | Local PDF + title creates a usable piece without IMSLP | PARTIAL — devMock flow/tests pass; packaged-native picker/IPC pending |
| Optional discovery | External IMSLP link opens; no IMSLP URL is required or stored | PARTIAL — surface/tests pass; native external-open observation pending |
| Folders | Create nested folders, move a piece, rename, move a child folder | PASS in automated/devMock evidence; native persistence pending |
| Cycle safety | Moving a folder into itself/descendant is rejected | PASS in native tests |
| Folder removal | Child pieces/folders are promoted; no score file is deleted | PASS in native tests + confirmation screenshot |
| Status | Active → Completed → Archived → Active survives relaunch | PARTIAL — automated/devMock transitions pass; packaged relaunch pending |
| Actions | Right-click and ellipsis expose equivalent actions | PASS — both 720×520 screenshots retained |
| Remove | Managed piece folder moves to `.trash`; row/history remains recoverable | PASS in native tests; packaged-native filesystem exercise pending |
| History | Existing history remains reachable as a Pieces sub-tab | PASS — 720×520 screenshot |
| Calendar | Existing calendar remains reachable as a Pieces sub-tab | PASS — sub-tab screenshot; broader Today/Calendar batch timed out |
| Accessibility | Menus, dialogs, focus return and keyboard operation are usable | PARTIAL — automated/browser evidence only; native keyboard/focus pending |
| Small window | No clipped controls or document-level overflow at 720×520 | PASS — clipping correction passed 4/4 and screenshots retained |

These are browser/devMock layout and deterministic test results, not proof of a native file picker,
SQLite IPC, Finder behavior, Gatekeeper or on-disk persistence. The broader Today/Calendar batch
timed out and is not silently converted into a pass. Normal-size and packaged-native visual checks
remain PENDING.

Representative retained frames:

- `pieces-library-default-720x520.png`
- `add-piece-scrolled-720x520.png`
- `nested-folder-720x520.png`
- `piece-ellipsis-menu-720x520.png` and `piece-right-click-menu-720x520.png`
- `remove-confirmation-720x520.png`
- `history-subtab-720x520.png` and `calendar-subtab-720x520.png`
- `blank-library-720x520.png`
- `folder-actions-fixed-720x520.png` — accepted retest after the clipping repair;
  `folder-actions-720x520.png` remains the pre-fix failure evidence.

## File-safety matrix

Use disposable files and roots only.

- [x] Automated test: valid PDF copies into the managed root and leaves the source unchanged.
- [ ] Packaged-native check: upper/lower-case `.pdf` handling matches the documented contract.
- [x] Automated test: non-PDF content renamed `.pdf` is rejected.
- [x] Automated test: a non-`.pdf` extension is rejected.
- [ ] Packaged-native check: directory, missing path and symlink inputs all reject as documented
      (missing paths and unsafe symlinked piece folders already have passing native tests).
- [x] Automated test: duplicate names receive safe non-overwriting destinations.
- [ ] Packaged-native fault injection: a forced database failure quarantines the managed copy.
- [x] Automated test: Remove rejects a row/path outside the configured managed root.
- [x] Automated test: Remove rejects missing/path-escape targets rather than deleting broadly.
- [x] Automated tests: Remove changes only the managed copy and retains the database row/history.

## Fresh-profile proof

Use an isolated macOS account or isolated application-support container. Do not point this test at
Christian's live database or repertoire root.

Two independent isolated on-disk initializations passed. Each produced schema 21, integrity OK and
FK0; blank Library/folder state; zero repertoire pieces, blocks, reps, sessions, events and Brain
turns; only the hidden Warm-ups row and generic protocol with `source_refs=[]`; only the database
and an empty app-owned Pieces directory; and no Knowledge setting or directory. No personal path,
history, score or removed content appeared.

Still PENDING against the exact packaged app: native launch/file picker; import one disposable
PDF; create/move nested folders; status and relaunch persistence; recoverable remove; and the
recipient-account version of the same flow.

Result: **PARTIAL PASS — blank initialization proved twice; full packaged interaction pending**.

## Upgrade and schema-21 rehearsal

Rehearse on a copy of the current v8.2.1 database and a disposable mirror of any files needed for
the exercise. The live database is read-only until installation is explicitly authorized and
preflight is clean.

| Check | Before | After | Result |
| --- | --- | --- | --- |
| Database SHA-256 | `8bd284b80f1e675966a88f6ac5feb7585226ca2f8c09b9e8d33145a3f714dab8` | `35860ff9d2e9912ef7bd100a6dbb6795408b24cbd5c5a4175bd2a684043ef41b` | PASS — disposable copy only |
| `user_version` | 20 | 21 | PASS |
| Integrity | OK | OK | PASS |
| Foreign-key violations | 0 | 0 | PASS |
| Pieces | 11 | 11 | PASS |
| Rep blocks/contracts | 255 | 255 | PASS |
| Reps | 2,315 | 2,315 | PASS |
| Sessions | 51 | 51 | PASS |
| Events | 9,173 | 9,173 | PASS |
| Open sessions | PENDING | PENDING | PENDING |
| Active contracts | PENDING | PENDING | PENDING |
| New folders / assignments / completions | n/a | 0 / 0 / 0 | PASS — migration did not invent organization/state |
| Existing score paths | separate exact path audit not recorded | unchanged expected | PENDING |
| Configured/inferred Pieces root | PENDING | PENDING | PENDING |

Also prove:

- [x] Migration adds no folder assignment or completion state and performs no file move.
- [ ] A saved Pieces-root setting wins.
- [ ] Without that setting, legacy common-parent inference chooses the expected existing root.
- [ ] Ambiguous legacy paths fall back safely and visibly rather than moving files.
- [ ] Migration rollback/retry behavior is understood and recorded.

This proves the schema/data-count migration on the named disposable copy. It does not prove the
installed upgrade, score-path/root behavior, live backup or rollback.

## Open-session install preflight

No package replacement while an app instance, practice session or rep contract is active.

- [x] Read-only live audit captured at **2026-08-30 19:25 EDT**: schema 20, integrity OK/FK0;
      11 pieces, 255 blocks, 2,327 reps, 51 sessions and 9,241 events.
- [x] Safety gate correctly STOPPED: **1 open session and 1 open block**. Christian must close or
      deliberately preserve them in v8.2.1. Do not mutate the database from a release script.
- [ ] Quit CodaKiller and prove no app process remains.
- [ ] Create a pre-install database backup; record path, bytes and SHA-256: **PENDING**.
- [ ] Create a v8.2.1 rollback app archive; record path, bytes and SHA-256: **PENDING**.
- [ ] Re-run the read-only audit immediately before replacement.

Preflight verdict: **BLOCKED — no backup/rollback, one-copy audit, install or installed launch was
attempted while the session/block remained open**.

## Exact artifact and share-clean audit

Run the scan against the exact staged app and sendable container—not merely the source tree.

- [x] No `.db`, `.sqlite`, WAL/SHM, database backup or Application Support payload; disguised
      SQLite-magic detection also passed.
- [x] No repertoire `.pdf`, `.musicxml` or `.mxl` file.
- [x] No quote corpus, book/method payload or removed Knowledge resource.
- [x] No Christian-specific absolute path/name, practice history or provider key.
- [x] Mounted `START HERE.txt` (staged from `START_HERE.txt`) is present and states blank first
      launch, Apple silicon/macOS 13+, and the honest Gatekeeper path.
- [x] Full hear BSD, React/Tauri MIT and PDF.js Apache notices are present at DMG top level and
      byte-identical inside the app; the scanner asserts their presence.
- [x] Bundle version 9.0.0 and ID `com.christian.codakiller` agree with package metadata.
- [x] Mounted-app strict signature verification passes: ad-hoc CDHash
      `33ffc5fade7ecb090c5fd7b08818ae82164cbc21`; not notarized.
- [x] Mach-O architecture arm64 and minimum macOS 13.0 match the boundary.
- [ ] One-copy audit finds no stale CodaKiller app or mounted old image that could confuse launch.
- [x] DMG creation, checksum check, `hdiutil verify`, read-only mount and exact top-level audit pass.
- [ ] Installed copy/launch remains PENDING.

Exact candidate:

- `/Users/c3/codakiller/releases/v9.0.0/CodaKiller-9.0.0.dmg`
- **10,736,628 bytes**
- SHA-256 `e5f3c2265cd962791a8267fee6a4e4e0c42a9a70775bbcc5729623a7aa443f06`
- basename-only checksum sidecar: **87 bytes**
- mounted top level exactly: Applications symlink, `CodaKiller.app`, `START HERE.txt`, and
  `Third-Party Notices.txt`
- earlier incorrectly prefixed/superseded DMG deleted; only this corrected candidate remains

Artifact verdict: **PASS as a packaged shareable candidate; NOT installed, shipped or accepted**.

`npm run package:mac` invokes `scripts/package-macos.sh`. It is intentionally non-installing: it
packages and scans an already-built app without quitting or launching CodaKiller, replacing
`/Applications/CodaKiller.app`, touching the live database, creating install backups, tagging or
pushing. This is why package evidence can be valid while the live-session install gate remains
blocked.

## Installed before/after audit

| Item | v8.2.1 before | v9 installed after | Verdict |
| --- | --- | --- | --- |
| App identity/version | installed v8.2.1 / schema 20 | PENDING | PENDING |
| Database SHA-256 | PENDING | expected migration change | PENDING |
| Schema | 20 at 2026-08-30 19:25 EDT | 21 expected | BLOCKED/PENDING |
| Graph counts | 11 pieces / 255 blocks / 2,327 reps / 51 sessions / 9,241 events | exact preservation expected | BLOCKED/PENDING |
| Integrity / FK violations | OK / 0 | OK / 0 expected | BLOCKED/PENDING |
| Open sessions/blocks | **1 / 1** | 0 / 0 required before replacement | BLOCKED |
| Existing score paths | PENDING | unchanged expected | PENDING |
| Saved/inferred Pieces root | PENDING | preserved expected | PENDING |

After replacement, launch the installed app once, verify the upgraded Library against Christian's
existing repertoire without changing organization, quit cleanly, then perform the after audit.
Do not call the release installed from a build-bundle launch.

## Clean-recipient acceptance

Test the exact sendable artifact on a clean Apple-silicon Mac running macOS 13+ (or record the
precise isolated substitute and its limits).

- [ ] Transfer does not include Christian's data or a second friend-specific build.
- [ ] Record the exact Gatekeeper dialog and the successful Control-click/Open or Open Anyway
      route; do not imply notarization.
- [ ] First launch is blank and creates its own Pieces root.
- [ ] Recipient imports a PDF without an IMSLP URL and reaches Score/practice.
- [ ] Recipient creates one nested folder and changes the piece status by context action.
- [ ] Quit/relaunch persistence passes.
- [ ] Recipient reports whether the setup was understandable without developer help.

Recipient verdict: **PENDING**.

## Honest exclusions

This release ledger does not prove microphone/Listen Back acceptance, voice-over-Steinway use,
real-provider measure mapping, notarization, Intel support, lawful redistribution of any score,
or sustained-use motivation. Those remain separate evidence gates.

## Next steps

The source, disposable profile/migration, devMock and notice-corrected package gates now have the
evidence above. Christian must close or deliberately preserve the open v8.2.1 session/block. Only
after a repeated zero-open preflight: quit the app, take/hash the current DB backup and v8.2.1
rollback, perform the one-copy check, install, launch and audit v9. Finish with the exact-DMG clean-
recipient Gatekeeper/first-piece trial. The implementation, package-boundary tag and private
source backup are complete. Finalize the v9 version record only after the remaining install and
recipient gates; until then it remains a packaged candidate, not installed or accepted.
