# CodaKiller — Project Context & Operating Manual

> A voice-first piano **practice & rep tracker** for a serious pianist, built native
> for macOS (Tauri v2). Not a coach that listens to the piano — the last app tried
> that and it was the fatal flaw. **The user is the sensor; the app is the memory.**
> He speaks what happened (tempo changes, reps, mistakes); CodaKiller counts, times,
> remembers, structures, runs the metronome, and knows things — hands-free.

**This file is the entry point for every coding session.** Read it, then jump to
`docs/COMMAND-CENTER.md` for the live map. If you only read one other doc, read
`docs/CodaKiller.md` (the whole project in one page).

---

## The one-sentence thesis

> The old app failed because it tried to *hear* piano on hardware that can't
> (MacBook mic ⇒ 35–52% accuracy, timing error in whole seconds). CodaKiller
> **never interprets audio as music.** It removes an entire family of bugs by
> design — and spends its effort on what computers are actually good at: counting,
> timing, memory, structure, and knowledge.

## Lineage — how this "merges" with the old piano coach

CodaKiller is the **successor** to PianoCoach (`~/piano-coach`, "that abomination").
It is merged with it **in mission and in lessons, never in code or UI:**

- **Same mission:** help Christian master real repertoire on his **Steinway acoustic
  baby grand** (NEC-prep; his teacher says pulse is his #1 problem).
- **Inherits the hard-won lessons, not the code.** The old app's entire v1→v4 arc
  (documented in its own repo + vault) taught one thing the expensive way: *the mic
  can't grade an acoustic piano, so stop grading and start tracking.* CodaKiller is
  that lesson, built clean. See `docs/MOTIVATION.md` for the full story.
- **Zero UI inspiration. Zero shared code.** New stack (Tauri v2 / Rust + React), new
  design language (apple.com-grade, dark+light), small testable modules instead of the
  old 2,406-line `server.py` god object. Do **not** port the old app's UI, its web
  server model, its cache-bust versioning, or its perception-first architecture.
- **Family tree:** PianoCoach (dead-end architecture, live-on lessons) → **CodaKiller**
  (the focused piano tool, done right) and → Cadencify (the generalized AI tutor; the
  old coach is also *its* "grounding seed"). CodaKiller and Cadencify are cousins.

## Design stance (non-negotiable)

- **User-as-sensor.** The app never judges playing it cannot hear. He gives every verdict.
- **Deterministic in the hot loop.** Rep check-offs and metronome control are instant,
  offline, regex-routed. The LLM ("brain") is for open questions only, never in the loop.
- **Suggest, never dictate.** No auto-imposed drills or plans (the old app's v4 lesson).
- **Small, testable modules.** One purpose each, unit-tested. No god objects.
- **Honest over impressive.** If something is unproven, unbuilt, or broken, the docs say
  so plainly. Christian explicitly values this. Never dress up a gap as "done."
- **Build for the one user first.** Christian is user #1 and the only user that matters yet.

---

## 🔒 THE UPDATE PROTOCOL (binding — run after EVERY change, EVERY session)

**This is the most important rule in this file.** Any time anything changes — code,
docs, a decision, a fix, a discovered flaw, processed feedback — before you report
the work done, you MUST:

1. **Log it in `docs/CHANGELOG.md`.** Date · what changed · why / what drove it · files
   or modules touched. Newest first. No change is too small. Big rounds of work = a new
   **version** (see the version system below); small fixes = entries under the current
   version. This is the full, permanent history.
2. **Refresh `docs/CodaKiller.md`** — the portable one-page summary. It must ALWAYS
   reflect current truth (what it is, how it works, current state, honest flaws,
   roadmap, version digest) and its `Last updated:` line. Keep it fully self-contained
   (no repo-relative links an outside AI can't follow) — Christian pastes it into other
   AIs for outside opinions.
3. **Update every affected living doc:**
   - phase/status/next-steps changed → `docs/ROADMAP.md` **and** the status + open-threads
     in `docs/COMMAND-CENTER.md`.
   - a flaw was found / fixed / newly understood → `docs/FLAWS.md` (add, or move to
     "Resolved" with the fixing commit). **Never delete a flaw silently.**
   - an engineering decision, gotcha, or hard-won empirical fact → `NOTES.md` (the
     engineering log — keep the existing style).
   - the `Status` section at the bottom of THIS file.
4. **Version records are immutable once shipped** (`versions/*`) — touch them only for
   factual corrections, never to log new work.
5. **Commit in git** with a descriptive message; **tag on a version bump** (e.g.
   `git tag v0.2.0`). Update the memory file `~/.claude/.../memory/codakiller-v2-app.md`
   if a durable fact changed.

**If a session ends without steps 1–3 done, the session is not done.** A future you
(or a future model) will re-enter cold and must be able to trust these docs completely.

---

## 🏷️ The version system (so "what's next" is always clear)

Three layers, deliberately simple:

- **App version (semver-ish)** = a shipped milestone of the `.app`. Currently
  **`0.1.0`** (P0–P2: metronome + voice loop). Each shipped milestone bumps it. When the
  full vision (P6) ships it becomes `1.0.0`.
- **Phases `P0`–`P6`** = the build plan (see `docs/ROADMAP.md`). A version spans phases:
  P0–P2 → `v0.1.0`; P3 → `v0.2.0`; P4 → `v0.3.0`; P5 → `v0.4.0`; P6 → `v1.0.0`. Adjust
  if scope shifts, but always keep the mapping written down.
- **`versions/` folder** = one immutable sub-folder per shipped version (e.g.
  `versions/v0.1.0/`) holding that version's record: what it is, what shipped, what was
  verified, honest gaps, and **explicit NEXT STEPS**. The living codebase is the git
  repo; old code lives as **git tags** (`p2-done` exists), never as duplicate folders.

**Every version record and every roadmap phase MUST end with a clear "Next steps" block**
so the next session never has to reverse-engineer where to pick up.

---

## 📁 Repo & doc map

```
codakiller/
├── CLAUDE.md                    ← you are here (operating manual + update protocol)
├── README.md                    ← user-facing quickstart (build/run/first-launch)
├── NOTES.md                     ← engineering log: decisions, gotchas, empirical facts
├── docs/
│   ├── COMMAND-CENTER.md        ← the live hub/map — START HERE each session
│   ├── CodaKiller.md            ← THE portable one-page summary (paste into any AI)
│   ├── MOTIVATION.md            ← why this exists (the honest origin story)
│   ├── ROADMAP.md               ← phases P0–P6, status, and the P3–P6 next steps
│   ├── FLAWS.md                 ← honest flaws / risks / limits / tech-debt register
│   ├── CHANGELOG.md             ← full version history, every change, newest first
│   ├── superpowers/
│   │   ├── specs/…-codakiller-design.md   ← the approved design spec (canonical vision)
│   │   └── plans/…-p0-p2.md               ← the P0–P2 execution plan (done)
│   └── qa/                      ← acceptance records + screenshots (p2-acceptance.md etc.)
├── versions/
│   ├── README.md                ← the versioning scheme
│   └── v0.1.0/                  ← immutable record of the P0–P2 shipped version
├── src/                         ← React/TS frontend (Vite)
├── src-tauri/                   ← Rust core (audio, stt, intent, tts, metronome, store…)
├── vendor/bin/hear              ← vendored on-device STT CLI (Apple SFSpeech)
└── .superpowers/sdd/progress.md ← per-task execution ledger + carry-notes
```

Which docs move fast vs. slow:
- **Living (edit constantly):** `CHANGELOG`, `CodaKiller.md`, `ROADMAP`, `FLAWS`,
  `COMMAND-CENTER`, `NOTES`.
- **Stable (change on a real pivot):** `MOTIVATION`, the design spec.
- **Immutable once shipped:** `versions/*`, past `qa/` acceptance records.

---

## How to work here (the process that worked for P0–P2)

- **Subagent-driven with per-task review gates.** The orchestrator plans; executors
  implement one task at a time; a **fresh-context verifier adversarially tests every
  non-trivial change** (live app, not just unit tests) before it counts as done;
  security-executor handles anything touching keys/Keychain. This caught real bugs
  (e.g. a verifier found `+inf` bpm would infinite-loop the audio callback). Keep it.
- **Verification bar per phase:** executor → adversarial verifier → live smoke on the
  Mac. Substitute evidence only when hardware blocks a check, and say so explicitly
  (see `docs/qa/p2-acceptance.md` for how the −34 dB loopback forced substitutions).
- **Build/run/test:**
  ```
  npm install
  npm run tauri dev                       # dev run
  npm run tauri build -- --bundles app    # build ONLY the .app (the dmg step deletes the .app dir — see NOTES)
  cd src-tauri && cargo test               # Rust suite
  npm test                                 # frontend (vitest)
  ```
- **Before trusting any change on the real app: he must quit + relaunch** the installed
  `.app` (a running instance serves old code). Approve mic + Speech Recognition on first
  launch; Dictation must be ON (`kLSRErrorDomain Code=201` means it's off).

## ⚠️ Known project-level risks (full list in `docs/FLAWS.md` — read it)

- **The core product is NOT built yet.** Only the metronome + voice loop exist (P0–P2).
  The rep tracker, pieces, sessions, score, brain, and knowledge library (P3–P6) — i.e.
  the actual reason the app exists — are unbuilt.
- **The thesis is unproven with the real user at his real piano.** P0–P2 is verified by
  automated tests + `say`-through-speakers, but Christian has **not** used it at his
  Steinway (the −34 dB loopback makes unattended acoustic testing impossible). The human
  at-piano acceptance checklist (`docs/qa/p2-acceptance.md`) is **pending**.
- **No off-disk backup.** The repo is local-only (`git remote` empty). Disk loss = total
  loss. Set up a private remote (`gh repo create`) — this is a standing to-do.

## Status

**Phase: P0–P2 shipped (`v0.1.0`, tag `p2-done`, 2026-07-09). App at
`/Applications/CodaKiller.app`.** Metronome + voice loop work end-to-end (spoken command
→ metronome; never hears itself; piano/noise never triggers input) per automated + live
`say`-driven tests. **Next gate:** (1) Christian's real at-piano acceptance run; (2) write
the P3–P6 plan and build **P3 (pieces + rep engine)** — the first piece of the actual
product. P3 also owes: runtime Gemini→`say` TTS fallback, mic-permission-denied guidance.

## Claude's job here

Build the versions Christian's feedback asks for; keep every document current per the
update protocol above; stay blunt about difficulty and gaps. The old app died of
optimism about what the mic could do — do not repeat that. Ambitious target + honest
attack plan is the format for everything here.
