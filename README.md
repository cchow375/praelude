# CodaKiller

A voice-first practice and rep tracker for pianists, built on the
"user-is-the-sensor" principle: you speak what happened during practice
(tempo changes, reps, mistakes) instead of stopping to tap a UI, and
CodaKiller listens, tracks, and responds — including running the
metronome — hands-free.

## Status

**v8.1.0 / schema 19 shipped and was installed on 2026-08-27.** The complete Aug 8
overhaul is now in the installed app: P3 voice reliability and counted voice adjustments; P4
PDF movements and honest measure-map activation; P5 visual warmup catalog/routines on the real
rep engine; and P6 Listen Back, timed section rotation, reversible archive/recent-first pieces,
and visible Sound targets. The old galaxy has been replaced by an evidence dashboard with one
Practice XP per completed focused minute, deterministic levels, earned badges, exact next-badge
rails, a 28-day cadence and repertoire/technique progress. Quality verdicts never award XP.

The final corrective edges are installed too: verdict-hotkey remaps apply to the live HUD after
Save; every set can override tempo demotion; the running HUD has a quick subdivision control; and
`score_micro_target_create` uses a durable command identity plus one bounded same-identity retry,
so a lost reply replays the original spot instead of duplicating it. The Assistant remains
switched off and fully gated as the accepted cleanup; its off-state Settings guide now teaches
only the hands-free practice lane, hides Books/provider-only furniture, and leaves the settle
control under Voice plus the enable switch discoverable. Piece folders remain deliberately
deferred in favor of archive + recent-first sort.

At the supported 720×520 floor, Warmups shrinks within the effective 480px stage and tucks only
the expanded Rep Counter into Tools without touching the active set; Rotation clamps an unsafe
restored/collision position to `y=164`, leaving a 56px Tools reserve. Browser/devMock evidence
and installed-native evidence remain labelled separately in `docs/qa/v8.1.0/README.md`. The final
installed-native pass accepted both Universe and Warmups: the Rep Counter tucks into Tools without
ending or changing the active set, and both views remain clear of overlay and clipping.

**Release evidence:** final source HEAD
`1a1e38bb7a3757cf90ee6ea814e93d5971c595d6` (the `9a4aeba…` release commit plus compact-Warmups
corrections); frontend **2,650 passed / 1 skipped / 0 failed** (209 files passed / 1 skipped);
native **1,100 passed / 19 ignored / 0 failed**; TypeScript, format, strict Clippy, production build, five
narrated corpora and all eight release-script gates passed. The installed ad-hoc locally signed
app at `/Applications/CodaKiller.app` has version/build 8.1.0, bundle id
`com.christian.codakiller`, strict signature PASS and CDHash
`8655e9a45d83b7bb56e83a9d14bb477da7da39a9`; it is not Developer ID signed or notarized.
DMG `releases/v8.1.0/CodaKiller-8.1.0.dmg` is 10,892,054 bytes, SHA-256
`e828b861b31d771fde66cd66d48987eb66110f0fd455306a6a12c2f80eb0a271`.

Fresh launch migrated schema 16→19 with integrity/FKs clean. Pieces changed 10→11 only for hidden
`id=0` Warm-ups; 230 blocks / 2,034 reps / 46 sessions / 7,873 events / 1 open session were
preserved, and movement/routine/replay tables plus `measure_map` remain empty. Release tag
`v8.1.0` points to `0a3d6a5d339955fd7e7318299eaa6c3063674415` and is pushed; private
`origin/main` is current through the post-tag documentation correction. Real-provider measure mapping is still
unproven on Christian's live scores (no Anthropic key and zero live `measure_map` rows at the last
audit), and Listen Back/voice still require packaged-native microphone and Steinway acceptance.

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

Voice input relies on macOS Dictation. If it's disabled, voice commands
will report `dictation-disabled`. Enable it under **System Settings →
Keyboard → Dictation**.

The mic glyph in the top bar reflects live status:

- **live** — listening normally.
- **muted** — you've manually muted the mic.
- **down** — voice input isn't available (e.g. dictation disabled, or the
  STT process isn't running).
