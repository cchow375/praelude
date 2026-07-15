# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

The installed release is **v1.3.0**: a working local Tauri app with score/PDF workspace, pieces,
practice history, metronome, voice loop, Goals/Calendar, contextual Brain, and Practice Universe.

**v2.0.0 / P7 is in implementation, not shipped.** Christian's July 15 real use produced 481
attempts and exposed a core semantic/UI transformation: rigorous consecutive-clean/recovery /
retention protocols, exact reversible history, selection-first Score Atlas, safer natural voice
actions, concise durable Brain, scalable navigation, a handcrafted shell, and earned interactive
Universe. Canonical status and contracts live in the Obsidian vault; start at
`~/Desktop/christian's universe/Piano Practice/CodaKiller/(C) CodaKiller Command Center.md`.

The current verified v2 checkpoint has landed in the working tree: additive schema-v8 sidecars
plus the schema-v9 one-live-set invariant; one transactional PracticeContract RepEngine/store/IPC
path; exact typed HUD/history/metrics/planner/export/Brain projections; append-only undo/correct /
reverse/restart; global React receipts and metronome/state race guards; a four-book corpus manifest;
and the first deterministic voice-firewall fixture. Disposable copies of the preserved schema-v7
backup migrate and reopen cleanly with every source row/hash preserved. **Pause-aware focus,
safety/recovery/retention, durable backend receipts, the full narrated voice cutover, later v2
systems, native packaging, and live migration are still open. Christian's live database remains
untouched and the installed app remains v1.3.0.**

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
