# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

**v8.2.1 is a frontend-only source candidate; v8.2.0 remains installed until packaging.** The
candidate corrects the form-density regression exposed by Christian's first installed v8.2
screenshot: From/To and Start/Target BPM now stay paired, Focus shares a compact row with
Metronome, target mode shares a row with its count, **Start set** is pinned in the form header, and
the custom-variant input opens only after **+ Custom**. Tricky Sections remains the sole scroll
owner. Live browser QA at 720x520 passed without horizontal overflow; frontend is **2,680 passed /
1 skipped / 0 failed**, and TypeScript/build are clean. Schema stays 20. Package/install/tag and
native WKWebView evidence are pending; see `docs/qa/v8.2.1/README.md`.

**v8.2.0 / schema 20 shipped and was installed on 2026-08-27.** Christian's visual-cleanse round
is frozen at source commit `afe65f3b176a1c5da81eca6d2f65bd721726ee40`: Score is now a continuous,
virtualized reader instead of a one-page canvas with dead space; the PDF and Tricky Sections rail
scroll independently; opening a section reveals its composer; and the toolbar, bottom dock,
variant editor and composer have been compressed around the actions used during practice.

The composer also gains an explicit **Clean streak / Total plays** choice. Total plays offers
5 / 10 / 15 / 25 / Custom, stays at one fixed tempo, hides ladder/variant controls, counts every
effective Clean/Sloppy/Again and lets Undo remove one. Reaching the count completes the set but
does **not** become mastery evidence, a mastery badge, or a mastery completion animation. Existing
clean-streak and variant-chain semantics are unchanged. Schema 20 widens the saved contract basis
to represent `total_attempts`; a disposable copy of the pre-install schema-19 data migrated with 242
blocks/contracts, 2,184 reps, 47 sessions and 8,283 events preserved, integrity OK and zero
foreign-key violations.

The final corrective edges are installed too: verdict-hotkey remaps apply to the live HUD after
Save; every set can override tempo demotion; the running HUD has a quick subdivision control; and
`score_micro_target_create` uses a durable command identity plus one bounded same-identity retry,
so a lost reply replays the original spot instead of duplicating it. The Assistant remains
switched off and fully gated as the accepted cleanup; its off-state Settings guide now teaches
only the hands-free practice lane, hides Books/provider-only furniture, and leaves the settle
control under Voice plus the enable switch discoverable. Piece folders remain deliberately
deferred in favor of archive + recent-first sort.

At the supported 720×520 floor, the cleaned Score/composer/variant layouts passed browser QA; the
same Score reader also passed at 1462×919. Warmups still shrinks within the effective 480px stage and tucks only
the expanded Rep Counter into Tools without touching the active set; Rotation clamps an unsafe
restored/collision position to `y=164`, leaving a 56px Tools reserve. Browser/devMock evidence
and installed-native evidence remain labelled separately in `docs/qa/v8.1.0/README.md`. The final
installed-native pass accepted both Universe and Warmups: the Rep Counter tucks into Tools without
ending or changing the active set, and both views remain clear of overlay and clipping.

**v8.2 release evidence:** frontend **2,678 passed / 1 skipped / 0 failed** (212 files passed / 1
skipped); native **1,109
passed / 19 ignored / 0 failed**; TypeScript, production build, format and strict Clippy are
clean; five narrated corpora produced zero false mutations; all eight release-script gates passed.
The installed app at `/Applications/CodaKiller.app` reports version/build 8.2.0, bundle id
`com.christian.codakiller`, strict ad-hoc signature PASS and CDHash
`4f4a8e3947efc00e4845ee085564f2724ff378a6`. DMG
`releases/v8.2.0/CodaKiller-8.2.0.dmg` is 10,903,545 bytes, SHA-256
`1139ad6ed3452b2c004db3f4e8c22849eacb27e72fcbb0ddc93638d6720998eb`; the one-copy rule passed.
Browser QA is recorded in `docs/qa/v8.2.0/README.md`. Fresh packaged launch succeeded, but macOS
presented a Desktop-folder access prompt and that sensitive permission was not granted, so a
packaged-native Score screenshot behind the file permission is honestly not claimed.

Fresh installed launch migrated schema 19→20 with integrity/FKs clean and preserved exactly 11
pieces (10 repertoire + hidden Warm-ups), 242 blocks/contracts, 2,184 reps, 47 sessions and 8,283
events; zero sessions/contracts were open, and movement/routine/replay tables plus `measure_map`
remain empty. Pre-install backup: 23,146,496 bytes, SHA-256
`e2ba204263a9413b073ea5cab3b8fc2192ea7dcb42fda90012a0c0d08b660d0e`. The v8.1 rollback archive
is 10,041,913 bytes, SHA-256
`2960fd90cda9e24583a4661d7ad2672041e896f533d2b979c0cf3897291c751b`. Release tag `v8.2.0` is a
pushed lightweight tag at `5de8bf9e1e9bced09c3d5091acd4b42241edae28`. Private `origin/main` advanced
after the tag through documentation-only corrections; verify the exact current ref from Git. The
immutable tag and runtime source
`afe65f3b176a1c5da81eca6d2f65bd721726ee40` remain the release identities. Real-provider measure mapping is still
unproven on Christian's live scores (no Anthropic key and zero live `measure_map` rows at the last
audit), and Listen Back/voice still require packaged-native microphone and Steinway acceptance.
Those inherited external gaps are unchanged by this frontend-focused release.

Next: package/install the v8.2.1 density correction, then deliberately handle Desktop-folder
access and complete installed-native Score/composer/Total-plays acceptance; then run real
WKWebView microphone/Listen Back/Steinway acceptance, one
explicitly authorized provider map, and sustained-use motivation judgment—in that order.

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
data (including Warmups, Rotation, Listen Back and the evidence-based Universe; the Assistant
surface remains hidden while its off switch is active). This is a
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

When you open an external score PDF stored in **Desktop**, macOS may separately ask whether
CodaKiller may access that folder. This is conditional, not a blanket first-launch requirement:
grant it only if you want the app to read scores from that location. Declining is valid and leaves
the rest of the app usable, but that score cannot render until you choose a permitted location or
allow access.

Voice input relies on macOS Dictation. If it's disabled, voice commands
will report `dictation-disabled`. Enable it under **System Settings →
Keyboard → Dictation**.

The labelled mic control in the left rail reflects live status:

- **live** — listening normally.
- **muted** — you've manually muted the mic.
- **down** — voice input isn't available (e.g. dictation disabled, or the
  STT process isn't running).
