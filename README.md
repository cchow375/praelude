# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

The installed release is **v3.1.0**: the schema-10 PracticeContract backend and five-workspace v3
shell plus the July 20 hands-free stabilization. Routine receipts clear in 1.5 seconds;
metronome/set transitions are state-aware and serialized; the compact HUD stays in page flow;
Today has a plan box; Settings has the current guide; and Brain receives the visible Score context,
accepts clearly assistant-directed no-wake questions, and can turn one selected-Region set request
into an editable spoken draft requiring `confirm` or `cancel`.

This is the first safe Practice Operator slice, not arbitrary AI control. Page-only targeting,
Goals/Calendar/session-plan voice actions, durable unfinished drafts, and real recognition over the
Steinway remain open. Canonical status and contracts live in the Obsidian vault; start at
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
update protocol, real-data migration rehearsal, and complete gates are ready. The script enforces
version agreement, tests, seal, rollback-safe install, checksum, and one-copy audit.

## Dev mock (browser design-review harness)

```
npm run dev:mock       # VITE_DEV_MOCK=1 vite — then open the printed localhost URL
```

`dev:mock` runs the frontend in a plain browser with a flag-gated, backend-free
Tauri mock (`src/devMock/tauriDevMock.ts`). It intercepts the single
`window.__TAURI_INTERNALS__` seam so the five v3 workspaces (Today, Score, Brain,
Ledger/Calendar, Universe) mount and render with coherent sample data. This is a
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
