# 🎹 CodaKiller — Command Center

> The map. Not a doc to read once — the hub you re-enter at the start of every session.
> Don't read top-to-bottom; jump to the live thread. **Last updated: 2026-07-10.**

---

## 🧭 Quick nav

| Doc | What it answers | Status |
|---|---|---|
| `../CLAUDE.md` | **How to proceed** — operating manual + the after-every-change update protocol + version system | 🟢 binding |
| `CodaKiller.md` | **THE portable summary** — the whole project in one page; paste into any AI for outside opinions | 🟢 auto-kept current |
| `CHANGELOG.md` | *What changed, when, why* — full version history, every session | 🟢 living |
| `ROADMAP.md` | *What's built and what's next* — phases P0–P6, version map, next steps | 🟢 living |
| `FLAWS.md` | *What's honestly weak, unproven, or unbuilt* — the no-faking register | 🟢 living |
| `MOTIVATION.md` | *Why this exists* — the origin story & the founding lesson | 🟢 stable |
| `superpowers/specs/2026-07-09-codakiller-design.md` | *The approved design* — full vision & architecture | 🟢 canonical |
| `superpowers/plans/2026-07-09-codakiller-p0-p2.md` | *How P0–P2 got built* — the execution plan | 🔵 done |
| `../NOTES.md` | *Engineering decisions, gotchas, empirical facts* — read before touching audio/stt/tts | 🟢 living |
| `../.superpowers/sdd/progress.md` | *Per-task ledger + carry-notes* into future tasks | 🔵 P0–P2 |
| `qa/p2-acceptance.md` | *What's verified vs. pending* — incl. the human at-piano checklist | 🟡 checklist pending |
| `../versions/` | *Immutable per-version records* — v0.1.0 filed | 🟢 v0.1.0 |

---

## 💡 The thesis (memorize this)

> **The user is the sensor; the app is the memory.**
> The old app died trying to *hear* piano on a mic that can't. CodaKiller never interprets
> audio as music — the human gives every verdict; the app counts, times, remembers,
> structures, and knows. That one move removes a whole family of bugs by design.

## 🏛️ What it is in one breath

A voice-first piano **practice & rep tracker**, native macOS (Tauri v2, Rust + React/TS).
Successor to PianoCoach in **mission and lessons, zero code/UI**. See `CodaKiller.md`.

## ✅ Open threads (tick as we resolve)

- [ ] **🔴 At-piano acceptance run of v0.1.0** (Christian, ~10 min, `qa/p2-acceptance.md`).
      The first real-world test of the entire thesis — nothing about "P0–P2 verified" is
      trustworthy for *his* room until this is done. Highest priority.
- [ ] **🟠 Off-disk git backup** — repo is local-only (`git remote` empty). One command:
      `gh repo create codakiller --private --source=. --push`. (`FLAWS.md` C1.)
- [ ] **🔴 Build P3 (pieces + rep engine) → v0.2.0** — the actual product. Write the P3
      task-level plan first, then build data-model → rep engine → intake → sessions/export.
      Fold in the two P3 debts: runtime TTS fallback, mic-denied guidance.
- [ ] **🟠 The reframe is still a bet** — confirm with real use that hands-free verbal
      tracking is what he wants before over-investing in P4–P6. (`FLAWS.md` A3.)
- [ ] Keep P4–P6 plans unwritten-until-needed, but the phase intents are locked in `ROADMAP`.

## 🗺️ How to use this vault section

- **Reference (stable):** `MOTIVATION`, the design spec — change slowly.
- **Operational (moves fast):** this Command Center's open threads, `ROADMAP`, `FLAWS`,
  `CHANGELOG`.
- **Re-enter here first every session.** Then obey `../CLAUDE.md`'s update protocol before
  calling any work done.

## Current status (one line)

**v0.1.0 shipped (P0–P2): metronome + voice loop work end-to-end; the real product (P3–P6)
is unbuilt and the at-piano acceptance test is pending.**
