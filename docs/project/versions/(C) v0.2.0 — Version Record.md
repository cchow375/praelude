# (C) v0.2.0 — Version Record

> **Immutable once filed** (factual corrections only). Shipped **2026-07-10**, git tag
> `v0.2.0`, installed to `/Applications/CodaKiller.app`. Phase **P3 — Pieces + rep engine**.
> Predecessor: [[(C) v0.1.0 — Version Record]] · Hub: [[(C) CodaKiller Command Center]].

## What this version IS

The version where CodaKiller becomes the product it exists to be. v0.1.0 was a
voice-controlled metronome; v0.2.0 is a **voice-driven practice & rep tracker**:
pieces from the vault, an intake interview, rep blocks with ladders/variants and verbal
check-off, auto-tracked sessions exported back to the vault — plus the two debts P2 left
(runtime TTS fallback, mic-permission guidance).

## What shipped

- **Pieces:** startup + on-demand scan of `Piano Practice/Pieces/` (read-only; setting
  `vault.pieces_dir`); "Composer - Title" folder parsing; MusicXML/PDF detection; typed
  **intake interview** on first open (goals, deadline, target tempo, hard spots, current
  state) stored per piece. Rescans never clobber intake data.
- **Rep engine (Rust `rep/`):** blocks over a measure range; auto ladders (bpm step 4,
  cleans-per-rung derived from planned reps and the start→target span, capped at target;
  no target ⇒ no stepping) or manual rules; ordered variant lanes; three-way verdicts
  `clean / flawed / failed` (an attempt is always a rep; only cleans advance the ladder);
  one composed speak-back line shared by voice and UI ("Twelve of thirty. Up to
  eighty-four."). Blocks close `done` at planned reps or `abandoned` early.
- **Voice grammar (mode-scoped, deterministic, firewall-tested):** "open a rep tracker,
  measures 40 to 56, start at 80, target 120" (any mode, piece = current UI selection);
  in rep mode: "done/clean/got it" · "sloppy/rough/shaky" · "again/nope/missed …" with
  trailing-note capture; "where are we"; "close the block"; "end the session" (any mode).
  Metronome follows ladder steps while running. Every ack still closes the STT gate.
- **Sessions:** auto-open on first activity (reused across an app restart); every
  rep/intake/voice-metronome event on the timeline; end via voice, session bar, or app
  exit → summary markdown (blocks, ladders start→top, verdict tallies, notes) **appended**
  to `(C) codakiller-sessions.md` in each practiced piece's folder. Append-only; human
  docs untouched; zero-piece sessions write nothing.
- **Frontend:** Practice/Metronome two-view shell; pieces panel (scan, badges, select);
  intake form; block form (auto/manual ladder, variants); **rep HUD** pinned above every
  view (count, bpm, variant, Clean/Sloppy/Again buttons on the same engine path as voice,
  note field, last-5 feed); session bar with expandable timeline + end button; persistent
  dismissible voice-guidance banner.
- **P2 debts:** `FallbackTts` — per-utterance Gemini→`say` retry, Gemini dropped for the
  session after 2 consecutive failures (never a silent coach); `DownReason::MicDenied`
  matched from `hear`'s real error strings with an actionable System Settings banner;
  restart-storm guidance now names mic permission as a likely cause.
- **Data:** schema v2 (`piece`, `rep_block`, `rep`, `session`, `session_event`,
  `spot_review` [dormant until P5], `setting`); v1→v2 migration preserves settings
  (replay-tested against a real v0.1.0 database).

## How it was verified

- **Suites at ship:** cargo **176 lib + 13 integration** tests, `clippy --all-targets
  -D warnings` clean; npm **12 files / 90 tests**; `tsc --noEmit` clean.
- **End-to-end (no mic needed):** `e2e_fake_hear_rep_tracker_hero_flow` drives the hero
  phrase + spaced "done"s through the **real STT supervisor** → block opened on the
  selected piece, metronome at 80, reps persisted, exact acks spoken.
- **Process:** subagent-driven, per-task fresh-context adversarial gates (they caught and
  fixed a real RepOpen misfire hazard on ambient measure-talk, and verified the frontend's
  63-test contract compliance line-by-line), then a whole-branch final review on the full
  P3 diff. Real-vault scan probe: all 5 pieces found, XML flags correct.
- **Installed smoke (live, spoken):** v0.2.0 `.app` installed and driven by real speech
  through the speakers — "metronome ninety six" changed the persisted tempo (60→96) and
  the new session pipeline logged it. The smoke also CAUGHT a real ship-blocker: AppleEvent
  quits bypassed all Tauri cleanup (orphaned `hear` holding the mic, stranded boost volume,
  no session export). Fixed in the same session with a `libc::atexit` backstop + window-close
  export, then re-verified live: post-fix quits kill `hear` immediately and restore the
  volume. Empirical facts recorded in `NOTES.md` (incl. the TCC re-sign gotcha and the
  volume-marginal `say` harness).

## Honest gaps (known, deliberate, or open — full register in [[(C) Flaws]])

- **The at-piano acceptance run is still pending** — now for v0.2.0's rep flow, not just
  the metronome. Automated evidence ≠ his room, his Steinway, his voice over the piano.
- **Verbal intake deferred to P5** (typed form only) — an intake is a conversation; that's
  the brain's job. **Score-range highlighting** waits for P4 (OSMD). **Planner/spot_review
  dormant** until P5.
- **UI rep buttons don't speak** (voice checks do) — deliberate: if you click, you're
  looking at the HUD. Revisit if real use disagrees.
- **Block auto-resume** on reopening a piece is a manual "open from history" for now.
- Repo still **local-only** (no off-disk backup) — standing to-do, needs `gh` install+auth.

## NEXT STEPS (in order)

1. **Christian: real at-piano session with v0.2.0 tonight** — launch the app and **click
   Allow on the two permission prompts** (Microphone + Speech Recognition — they were reset
   at ship, see D7), then: open a piece, run the intake, voice-open a rep block on a real
   hard spot ("open a rep tracker, measures 40 to 56, start at 80, target 120"), check off
   reps hands-free ("done" / "sloppy" / "nope, missed the jump"), say "end the session",
   and read the exported markdown in the piece folder. This is the acceptance run for the
   entire product thesis, superseding the v0.1.0 checklist.
2. Feed tonight's friction into [[(C) Flaws]] / fix round (expect vocab/ladder tuning).
3. Off-disk backup (`brew install gh; gh auth login; gh repo create codakiller --private
   --source=. --push`).
4. Plan + build **P4 (score viewer)** → v0.3.0; spike OSMD perf on the big Scherzo XML first.
