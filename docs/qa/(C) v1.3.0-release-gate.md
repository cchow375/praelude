# CodaKiller v1.3.0 — Release Gate

> **Result: PASS · 2026-07-13**  
> Compact-workspace/contextual-Brain release installed at `/Applications/CodaKiller.app`.

## What was gated

- 75–125% native interface scale, compact layout, 720×520 minimum, collapsible score rail, and
  persistent overlay Brain drawer with focus/Escape behavior.
- Canonical selected-piece/Region/rep/session/goal context with no stale persisted-piece fallback.
- Strict external three-book read-only retrieval, privacy-controlled excerpt sharing, path-free
  allowlisted citations, and offline-to-online conversation privacy.
- Bounded selected-range MusicXML parsing, real `.musicxml`/validated `.xml`, no DTD resolution,
  path escape, symlink, event/depth/part/list growth, or score-timewise false rejection.
- Provider output boundary: no hearing/verdict/action/state claims; advice/disagreement remains useful.

## Results

| Gate | Result |
|---|---|
| Frontend | **36 files / 217 tests passed** |
| TypeScript + Vite production build | **Passed** |
| Rust library | **358 passed / 9 ignored** |
| Rust integrations | **9 + 9 + 4 passed; 2 live-TTS ignored** |
| Strict clippy | **Passed** |
| Diff hygiene | `git diff --check` **passed** |
| Fresh adversarial verifier | **SHIP; no P0–P2 findings** |
| Real three-book retrieval | **Passed** |
| Real Scherzo selected MusicXML | **Passed** |
| Real Griffes plain-XML discovery | **Passed** |
| Live configured provider + external citation | **Passed; key/answer not printed** |
| Responsive browser QA | **1280 + 720 widths, drawer/rail collapse, no body overflow passed** |
| Native release | **Build, stage, seal, install, DMG, checksum, one-copy audit passed** |

The first release attempt exposed a Spotlight indexing race after the app was already installed and
sealed. The release script now requests a metadata import and polls for at most five seconds. The
entire gate was rerun and ended PASS.

## Data safety

- Backup: `~/Library/Application Support/com.christian.codakiller/backups/(C)
  pre-v1.3.0-2026-07-13.db`.
- Schema 7, `quick_check=ok`, zero FK rows.
- Preserved: **5 pieces / 24 Regions / 21 blocks / 169 reps / 9 Goals / 9 Daily Work /
  1 tutorial video / 11 chapters / 13 links**.
- External books, PDFs, MusicXML, and tutorial video bytes remain read-only and outside SQLite.

## Artifacts

| Item | Value |
|---|---|
| Installed app | `/Applications/CodaKiller.app` |
| Version / bundle | `1.3.0` / `com.christian.codakiller` |
| DMG | `releases/v1.3.0/CodaKiller-1.3.0.dmg` |
| DMG bytes | `8,813,450` |
| SHA-256 | `9ac4346b43a1bfff6f4977768980a754842308d4abd24dacf86ec9fd1866d82b` |
| Signature | Valid ad-hoc local seal; not Developer ID signed/notarized |
| Duplicate audit | Exactly `/Applications/CodaKiller.app` |

## Honest limits

- The complete installed drawer + real-PDF + real-answer interaction was not automated inside the
  packaged WKWebView; local responsive browser QA and installed launch/version paint passed.
- Christian has not tested the result at the Steinway.
- Retrieval is lexical across three external converted books, not universal semantic search.
- MusicXML is notation context, not audio/performance understanding; `.mxl` analysis is unsupported.
- Provider prose can remain wrong even when cited; conversation is session-only.

## Next action

Use a real Scherzo section at the piano: scale/narrow the app, collapse the score rail, ask why a
reported failure persists, inspect the source/MusicXML receipt, disagree once, and manually record
the experiment Christian actually chooses.

