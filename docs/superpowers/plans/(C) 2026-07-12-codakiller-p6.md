# CodaKiller P6 — Home, Practice Universe + v1 Finish

> **Status:** shipped 2026-07-12 · **Target:** v1.0.0 · **Branch:** `p6-universe`
> **Goal:** make accumulated real work visible, finish the daily product surface, and produce one
> honest, repeatable Mac release without turning self-reported quality into a gameable score.

## 🧭 Quick nav

[Locked rules](#-locked-universe-rules) · [Checklist](#-execution-checklist) ·
[Contracts](#-runtime-contracts) · [Release](#-release-gate) · [Non-goals](#-non-goals)

## 🔒 Locked Universe rules

1. Historical work is not erased. Before Universe UI, idempotently map reconstructable legacy
   `session_event` rows into canonical `event` with exact original timestamps/session/piece links.
2. A migration ledger makes backfill one-time and crash-atomic. Existing canonical rows are never
   rewritten, guessed, or double-counted.
3. Star radius = focused time. Orbit continuity = distinct active days in the last 28 local days.
   Planets = Regions with recorded work. Halo = Regions revisited on 2+ distinct dates.
4. Quality affects subtle brightness only. No quality score, red failure state, broken streak,
   penalty, leaderboard, XP, or reward for claiming “clean.”
5. Every visual signal has a visible text equivalent and definition. Stars are keyboard-focusable;
   motion obeys `prefers-reduced-motion`; the Universe remains usable in light/dark and narrow UI.
6. The Universe is SVG/semantic HTML/CSS—not WebGL and not a canvas-only accessibility wall.
7. References are explicit Spotify/YouTube search handoffs using fixed HTTPS origins and encoded
   query parameters. No shell interpolation, arbitrary URL, scraping, downloading, or autoplay.
8. API keys are native write-only inputs. React receives configured/not-configured status only;
   secrets never enter SQLite, DOM state after save, errors, logs, or release artifacts.
9. Settings are typed and bounded. Invalid stored values fall back visibly and safely.
10. Packaging is one scripted path: build → install/seal → verify → staged DMG → checksum →
    exact-one-app audit. This Mac has no Developer ID identity, so v1 is honestly ad-hoc local,
    not notarized.

## ✅ Execution checklist

- [x] **P6.1 — Schema v6 historical ledger/backfill.** Preserve exact legacy timestamps and links;
  reconstruct only typed rows with valid canonical ownership; idempotence/crash/real-copy gates.
- [x] **P6.2 — Honest Universe snapshot.** Pure aggregation for focused time, 28-day active days,
  Region breadth, 2+ day revisits, gentle quality brightness, and explicit definitions/traces.
- [x] **P6.3 — Home + Universe UI.** Calm space home, all-piece system, accessible SVG stars/
  orbits/planets, text list, empty/error/loading states, keyboard drill-in to piece/Region.
- [x] **P6.4 — Navigation finish.** Home becomes intentional landing; Practice/Calendar/Brain stay
  one click away; remove the redundant top-level Metronome placeholder while keeping its tool.
- [x] **P6.5 — References.** Per-piece Spotify/YouTube search handoff, quiet-mode explanation,
  fixed allowlisted URLs, correct encoding, failure feedback, no provider automation claims.
- [x] **P6.6 — Deep typed Settings.** Theme, voice/TTS/wake behavior, metronome/ladder defaults,
  aliases with collision validation, brain preference + native key status/write-only save.
- [x] **P6.7 — Final icon/design pass.** Repo-native icon source + complete macOS sizes; coherent
  calm hierarchy, reduced motion, contrast, focus order, narrow layout, no decorative clutter.
- [x] **P6.8 — Automated release path.** Fail-fast script for app/DMG, ad-hoc seal, identifier/
  version checks, staged DMG contents, checksum, LaunchServices cleanup, duplicate rejection.
- [x] **P6.9 — Adversarial + real-copy gate.** Fresh security/data/accessibility reviews, full
  suites/build/clippy, migration on fresh v0.6 DB backup, installed launch/relaunch/data checks.
- [x] **P6.10 — Ship v1.0.0.** Tutorial/flaws/changelog/portable summary/version record, one sealed
  app + verified DMG, schema integrity/FKs, checksum, tag, fast-forward `main`.

## 🔌 Runtime contracts

```text
universe_snapshot() -> {
  generated_at, definitions,
  totals:{focused_seconds,active_days_28,regions_practiced,regions_revisited},
  pieces:[{piece_id,title,composer,focused_seconds,active_days_28,
           regions_total,regions_practiced,regions_revisited,quality_brightness,
           last_practiced,region_signals[]}]
}
reference_open({piece_id,provider:spotify|youtube}) -> {provider,url,opened}
settings_snapshot() -> typed public values + api_key_status only
settings_update({patch}) -> settings_snapshot()
api_key_save({provider,key}) -> api_key_status
api_key_clear({provider}) -> api_key_status
```

## 🧪 Release gate

- Fresh v0.6 real DB copy: 249 legacy session events map once; second open maps zero; original
  tables/counts remain; exact timestamps and valid piece/session links survive; integrity/FKs pass.
- Universe totals equal independent SQL/fixture calculations and do not change when Calendar cards
  are completed/dismissed or admin events are appended.
- Dark/light, 1024/1280/narrow, keyboard-only, screen-reader names, reduced-motion, empty and
  one-piece/extreme-data snapshots pass. Every visual has text parity.
- Reference URLs are fixed-origin/encoded; settings reject aliases that collide with deterministic
  command grammar; secrets never cross IPC reads or persist in SQLite.
- Release script creates one sealed `/Applications/CodaKiller.app` plus a staged DMG containing
  only CodaKiller.app + Applications link; checksum reproducible; unexpected duplicates fail.

## 🚫 Non-goals

No social/leaderboard layer, XP, streak punishment, audio grading, automatic reference playback,
Spotify OAuth, YouTube scraping/downloads, arbitrary URL opener, cloud sync, updater, Store release,
Developer ID/notarization claim, WebGL, or Universe physics simulator.

## Next action

Run Christian's complete v1 at-piano acceptance session, record friction immediately, and tune
only what that real use proves. Then create the private off-disk git remote.
