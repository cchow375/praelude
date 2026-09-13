# CodaKiller v0.1.0 — Version Record (immutable)

**Shipped:** 2026-07-09 · **Git tag:** `p2-done` · **Phases:** P0–P2 ·
**Installed:** `/Applications/CodaKiller.app` · Hub: [[(C) CodaKiller Command Center]]

> This record is frozen. It captures what v0.1.0 *was* at ship. New work lives in
> [[(C) Changelog]] and future version records.
>
> **Version scheme:** app semver ↔ phases (P0–P2 → v0.1.0 · P3 → v0.2.0 · P4 → v0.3.0 ·
> P5 → v0.4.0 · P6 → v1.0.0). The living codebase is the git repo `~/codakiller`; old code is
> preserved as **git tags**, never duplicate folders. Each version gets one record note in
> `versions/`, ending with explicit NEXT STEPS.

## What this version is

The **foundation**: a native macOS Tauri v2 app that runs a professional metronome and a
hands-free voice loop. You can say "metronome ninety-six," "bump it up four," "accent every 3,"
"stop" and it obeys, speaking a short confirmation — and it never triggers on its own voice or on
the piano. It is **not yet** the practice/rep tracker the project is for (that is P3+); it is the
correct base to build it on.

## What shipped

- **P0 — skeleton:** Tauri v2 scaffold, dark/light theme system, settings store, rusqlite schema
  v1, toolchain (Rust 1.96 via brew, vendored `hear` 0.8).
- **P1 — metronome:** sample-accurate cpal audio engine (fractional-sample clock + mixer, lock-free
  RT thread — no mutex/alloc/free on the audio callback), 6 synthesized limiter-maximized click
  sounds, accents/subdivisions/gain, boost mode (crash-safe system-volume restore on
  stop/close/quit/Drop), popover UI.
- **P2 — voice loop:** `hear` supervisor (auto-restart + storm cap + SIGTERM-group teardown +
  async-signal-safe termination handler), half-duplex gate (STT dropped while TTS plays +300 ms),
  deterministic intent router (regex/number grammar, mode-scoped, ignores non-commands), Gemini TTS
  (`v1beta/interactions`, `gemini-3.1-flash-tts-preview`) + system `say` fallback, Keychain key.

## How it was verified

- **Automated:** cargo 105 lib + 12 integration tests, clippy clean, npm 36/36; release `.app`
  bundles `hear` + click assets with both TCC usage strings present.
- **Live (controller-run):** spoken commands (via `say` through room speakers) drove persisted bpm
  96→100→144→100→120 and "stop"; 60 s of a real piano + narration recording produced **zero**
  intents / state changes; TTS produced zero self-transcripts; SIGTERM → exit 143, zero zombie
  `hear`; Gemini key in Keychain, no secret in repo.
- **Process:** every task gate-reviewed by a fresh-context adversarial verifier with fix rounds;
  final whole-branch review by an independent top-tier pass: **0 Critical, 0 Important**. Evidence:
  `~/codakiller/docs/qa/p2-acceptance.md`, `docs/qa/task-13-live-verification.md`, ledger
  `~/codakiller/.superpowers/sdd/progress.md`.

## Honest gaps at ship (see [[(C) Flaws]] for the living list)

- **The at-piano acceptance run is PENDING** — the −34 dB speaker→mic loopback makes unattended
  acoustic testing impossible, so real-room robustness with the actual user is unproven. "Verified"
  here means verified by proxy (`say`-through-speakers + recordings).
- **Runtime Gemini→`say` TTS fallback** (after N mid-session failures) not implemented.
- **Mic-permission-denied** shows generic guidance, not actionable steps.
- **Progressive-revision artifact:** metronome can briefly start at 90 then correct to 96.
- `kill -9` can orphan `hear` / strand boost volume (Drop can't run).
- The 2.5 s ASR re-send dedup is safe only because every ack closes the STT gate.

## Next steps (what v0.2.0 / P3 should do)

1. **Christian runs the at-piano acceptance checklist** (`~/codakiller/docs/qa/p2-acceptance.md`) —
   the real-world signal that validates or challenges the whole thesis.
2. **Set up an off-disk git remote** (the repo is local-only).
3. **Build P3 (pieces + rep engine) → v0.2.0:** vault piece ingest, intake interview, rep
   blocks/ladders/variants, verbal check-off, sessions + vault markdown export. Fold in the two
   carried debts (runtime TTS fallback, mic-denied guidance).

## Reference

Design spec (canonical vision): `~/codakiller/docs/superpowers/specs/2026-07-09-codakiller-design.md`
· Execution plan: `~/codakiller/docs/superpowers/plans/2026-07-09-codakiller-p0-p2.md` ·
Engineering log: `~/codakiller/NOTES.md`.
