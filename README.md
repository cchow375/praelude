# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

The installed release is **v7.2.0** (2026-08-27, schema 16 unchanged). It resolves B85–B87:
parent-scoped micro-targets are created by one contained drag with no form, practice starts or
resumes from the score, variant chains govern mastery and completed sets close after a visible
six-second pause, and spoken deterministic acknowledgements are opt-in while the short chime
remains. It also unifies the score overlay (B3), teaches the earned-only Universe at low data (E3),
exposes global demotion settings and exposes per-set beat value / beats-per-bar / subdivision
controls.

All source and release gates passed; the installed plist/version and identifier are correct,
codesign verifies, the DMG checksum matches, a fresh installed process launched, and the live
database stayed schema 16 with integrity OK and identical before/after counts. The release did
not require a migration or migration rehearsal. Honest residuals: the composer still has no
per-set demotion override, the running HUD has no quick-subdivision control, and the browser QA
does not substitute for Christian's native/at-piano acceptance verdict. Release tag `v7.2.0`
points to commit `7a5061d57fc6197b53e2601ca788f186d1fc7c83`.

The Assistant remains switched off and gated at Christian's request. Canonical product truth
lives in the Obsidian vault; start at
`~/Desktop/christian's universe/Piano Practice/CodaKiller/(C) CodaKiller Command Center.md`.

## Build / run

```
npm install
npm run tauri dev      # run the app in dev mode
npm test               # frontend suite
cd src-tauri && cargo test
cd .. && npm run build
npm run tauri build -- --bundles app  # build only the .app; see NOTES.md
```

For a versioned install/DMG release, use `npm run release:mac` only after the release plan, vault
update protocol, complete gates and (when the schema changes) a real-data migration rehearsal are
ready. The script verifies version agreement, runs its test/build gates, signs and installs the
bundle, creates the DMG/checksum and audits app copies. It does **not** make the pre-install
database backup or outgoing-app rollback tarball, relaunch the installed app, tag the commit or
push the release; the release operator must perform and record those steps separately.

## Dev mock (browser design-review harness)

```
npm run dev:mock       # VITE_DEV_MOCK=1 vite — then open the printed localhost URL
```

`dev:mock` runs the frontend in a plain browser with a flag-gated, backend-free
Tauri mock (`src/devMock/tauriDevMock.ts`). It intercepts the single
`window.__TAURI_INTERNALS__` seam so the current workspaces mount and render with coherent sample
data (the Assistant surface remains hidden while its off switch is active). This is a
**DEV-ONLY visual/design-review harness, not native functional acceptance**: it simulates the
bounded reads/writes needed by checked-in UI scenarios, while real audio, speech recognition,
Keychain, SQLite, and native event behavior still require Tauri/native gates. The mock activates
**only** under `VITE_DEV_MOCK`; a normal
`npm run dev` and the real Tauri app never load it. Objective mount coverage
lives in `src/devMock/tauriDevMock.smoke.test.tsx` (part of `npm test`).

## First launch

On first launch macOS will prompt for two permissions — grant both:

- **Microphone** — required to hear you during practice.
- **Speech Recognition** — required to transcribe what you say.

Voice input relies on macOS Dictation. If it's disabled, voice commands
will report `dictation-disabled`. Enable it under **System Settings →
Keyboard → Dictation**.

The mic glyph in the top bar reflects live status:

- **live** — listening normally.
- **muted** — you've manually muted the mic.
- **down** — voice input isn't available (e.g. dictation disabled, or the
  STT process isn't running).
