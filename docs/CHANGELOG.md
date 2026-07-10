# 📜 CodaKiller — Changelog

> The full version history. **Every session and every change gets an entry here** —
> newest first, no exceptions (enforced by `CLAUDE.md`'s update protocol). Big rounds of
> work = a new version (with a `versions/vX/` record); small fixes = entries under the
> current version. Engineering-level decisions & gotchas also go in `NOTES.md`; this file
> is the human-readable "what changed, when, why" history.
>
> **Format:** date · what changed · why / driven by what · files or docs touched.

---

## v0.1.0 (current) — shipped 2026-07-09 (tag `p2-done`)

### 2026-07-10 · Project documentation system established
- Created the living-doc system in the repo, modeled on Christian's Cadencify vault
  structure: `CLAUDE.md` (operating manual + the binding after-every-change **update
  protocol** + version system), `docs/CodaKiller.md` (the portable one-page summary),
  `docs/COMMAND-CENTER.md` (the hub), `docs/MOTIVATION.md`, `docs/ROADMAP.md`,
  `docs/FLAWS.md` (the honest register), this changelog, and `versions/` (immutable
  per-version records, starting with `v0.1.0`).
- Driven by Christian's request to "log everything after every change, keep a constantly
  refreshed doc set, and a clear version-history system so next steps are always clear,"
  and to frame CodaKiller as the successor to PianoCoach in mission/lessons but with zero
  shared code or UI. Recorded the honest state: P0–P2 shipped but the real product (P3–P6)
  is unbuilt and the at-piano acceptance test is still pending.
- Docs touched: all of the above (new). No code changed.

### 2026-07-09 · P0–P2 shipped — metronome + voice loop (the big one)
- Built the entire foundation across ~36 commits, every task gate-reviewed by a fresh-
  context adversarial verifier with fix rounds; final whole-branch review: **0 Critical /
  0 Important**. Tagged `p2-done`; installed to `/Applications/CodaKiller.app`.
- **P0 (skeleton):** Tauri v2 scaffold, dark/light shell + theme system, settings store,
  rusqlite schema v1, toolchain (Rust via brew, vendored `hear` 0.8). (Tasks 1–4.)
- **P1 (metronome):** sample-accurate cpal audio engine (fractional-sample clock + mixer,
  lock-free real-time thread), 6 synthesized limiter-maximized click sounds,
  accents/subdivisions/gain, boost mode (raises + crash-safely restores system volume),
  popover UI. (Tasks 5–8.)
- **P2 (voice loop):** `hear` STT supervisor (auto-restart + storm cap + SIGTERM-group
  teardown + async-signal-safe termination handler), half-duplex gate (never hears itself),
  deterministic intent router (regex/number grammar, mode-scoped, ignores non-commands),
  Gemini TTS (`v1beta/interactions`, `gemini-3.1-flash-tts-preview`, decoded from
  `steps[].content[].data`) with system `say` fallback, Keychain key handling (svc
  `codakiller`). (Tasks 9–14.)
- **Verified:** spoken commands drove persisted bpm (96→100→144→100→120) and "stop";
  60 s real-piano-plus-narration → **zero** false intents; gate produced zero self-
  transcripts; clean SIGTERM → zero zombie `hear`. Gates: cargo 105 lib + 12 integration,
  clippy clean, npm 36/36. Evidence: `docs/qa/p2-acceptance.md`, `docs/qa/task-13-live-
  verification.md`.
- **Hard-won empirical facts** (full detail in `NOTES.md`): `hear -m` is fatal for a line
  reader (`\r`+ANSI, no newlines) — use plain `-d -l en-US`; the ASR engine re-sends
  identical finals 0.5–2.3 s later → unified 2.5 s time-keyed dedup; a garbage `+inf` bpm
  would infinite-loop the audio callback (found by a verifier) → clamped; DMG bundler
  deletes the `.app` → build with `--bundles app`.
- **Consciously NOT done:** the human at-piano acceptance run (hardware-blocked from
  unattended testing — −34 dB loopback); runtime TTS fallback + mic-denied guidance
  (deferred to P3). See `FLAWS.md`.
- Docs touched: `NOTES.md`, design spec, P0–P2 plan, `.superpowers/sdd/progress.md`,
  `docs/qa/*`, `README.md`.

---

## Pre-history (context)

CodaKiller was approved by Christian on 2026-07-09 as the ground-up replacement for
**PianoCoach** (`~/piano-coach`), whose four-version arc established the founding lesson
("the mic can't grade an acoustic piano — track, don't grade"). The old app's own history
lives in its repo/vault and is intentionally **not** merged here. See `docs/MOTIVATION.md`.

## Parent
- Hub: `docs/COMMAND-CENTER.md`
