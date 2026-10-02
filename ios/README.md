# Praelude Mobile

**2.0.0/build3 · schema3 · DEVELOPMENT CANDIDATE · updated 2026-10-02.**
Native SwiftUI/PDFKit/PencilKit for iPhone/iPad on iOS17+. Source now includes Supabase accounts,
private PDF/recording storage and supported native-record sync, multi-instrument practice,
passage learning rules, warmups, score organization/annotation, notebook, history, rewards and social views.
The installed Mac remains v11.1.0/schema21. These source features are not a physical-device acceptance claim.

The pianist supplies every verdict; Praelude never interprets piano audio as musical performance.
Score reading remains page-based; feedback must follow durable practice saves. Touch/offline guest use
works without an account. Optional voice uses the on-device command vocabulary.

## Bring your Mac library

From the repo root, export a consistent read-only snapshot to a private path outside Git:

```sh
python3 ios/scripts/export_desktop.py --database '/absolute/path/codakiller.db' --output '/private/path/Mac-practice.json'
```

Finish Mac practice first. The helper refuses active sessions/sets, corrupt snapshots, overwrites,
unsafe/missing scores and exports inside Git. `--allow-missing-scores` explicitly permits unavailable
score bytes while retaining every original record/reference and reporting warnings. Available editions
under current score folders are included, without following directory symlinks. Related unsupported
files (such as tutorial videos) are reported; this is not a full filesystem backup.

Copy the reviewed JSON to Files/AirDrop. **Settings → Import from Mac → Choose Mac transfer** previews
counts/warnings. **Import library** adds compatible pieces, score editions, passages, goals and matching
pencil marks without replacing mobile records/preferences. Original history/contracts/corrections and
all Mac table records remain in **Progress → Mac practice record**. Original Mac sets do not grant native
rewards or fabricate mobile mastery. The archived database is private/local and travels in native backups;
it is not uploaded through Supabase. Supported native records and PDFs can sync after account sign-in.
This is a snapshot import, not continuous Mac↔iOS synchronization; goals/routines and custom cover bytes are not cloud-wired.

## Current practice navigation

Phone: Today, Pieces, Warmups, Progress and More. iPad: adaptive sidebar. More exposes Friends,
History, Calendar, Notebook, Data and Rewards. Score controls adapt to width; saved-verdict feedback
stays within the existing dock so notation does not resize. Automatic passage turns after verdicts
are opt-in in Score options. Today plans launch their first warmup. Performance mode explains its
exit gesture. First hands-free enable checks recognition then starts the requested listening.

## Development and evidence

- [Agent context](AGENTS.md), [module/check guide](docs/DEVELOPMENT.md), [workflow guide](docs/USING_MOBILE.md).
- [Install/renewal](docs/INSTALL_ON_IPAD.md), [roadmap](docs/ROADMAP.md), [changes](docs/CHANGELOG.md).
- [Current review and QA](../docs/qa/ios/2.0.0/README.md), [historical 1.1 QA](../docs/qa/ios/1.1.0/README.md).
- Current broader specification: `ios/docs/(C) Build Spec v2.md`; backend contract: `supabase/(C) Backend.md`.

```sh
python3 ios/scripts/generate-project.py
bash ios/scripts/check.sh
python3 -m unittest discover -s ios/scripts -p 'test_*.py'
open ios/Praelude.xcodeproj
```

Core uses Foundation and deterministic tests. The native target also uses pinned `supabase-swift`;
full Xcode and compatible simulator runtime are required. Normal launches remain blank; DEBUG test
fixtures/private transfer probes use a separate test store and are excluded from Release.

## Preservation and remaining gates

Native JSON, owned scores/ink/recordings and Mac archives remain independent of the live Mac database.
Backup now includes recording bytes and Mac archives. Combined payload is bounded to210 MB and encoded
JSON to280 MB; missing/corrupt files refuse backup/restore rather than silently dropping user data.
A repeat import preserves edits and validates/repairs missing identical score files. Very large or
repeated full Mac snapshots can exceed these limits and are refused before ledger replacement.

Sync reads all pages, preserves failed queues/pulls, catches up guest content, merges remote Undo and
retries files. Account switching is blocked when this device's library belongs to a different account.
Actual hosted/two-device convergence, backend independent page clocks, file-version invalidation,
cloud goals/routines, integrated original-history analytics and ongoing desktop sync remain open.

October2 device status found no connected hardware. The last documented physical install is
September14 1.1/build2 with complete file preservation and a pending controlled launch/trust boundary.
Use `npm run ios:status` to recheck and `npm run ios:refresh -- --device "YOUR IPAD NAME"` for the guarded
same-bundle update once connected. Never uninstall/reset to make an update or import easier.

**Next steps:** guarded physical update/import, then score/ink/voice/hardware and real-account
second-device synchronization acceptance. Do not label the candidate shipped.
