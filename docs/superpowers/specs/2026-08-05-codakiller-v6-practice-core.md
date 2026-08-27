# CodaKiller v6.0 — Practice Core (approved design)

> **Status:** Historical/as built. Approved 2026-08-05 and shipped in v6.0.0; later v8.1.0
> source is the current installed boundary. Unproven real-provider measure mapping and
> voice/Steinway acceptance remain external gaps rather than unfinished v6 implementation.
> **Source:** Christian's July 31 goal dump (quoted in `(C) Changelog` on processing), the
> fifth real-use feedback round. **Sibling decision:** v7.0 "Motivation Layer" scope is
> agreed-deferred (see Non-goals) — do not build any of it in v6.

## Why (the feedback, interpreted)

The July 31 dump splits into four themes. v6.0 takes the first three plus the broken-basics
half of the fourth:

1. **The score should know where measures are** — auto measure mapping, per-bar numbers,
   instant selection boxes, sub-sections, 2-beat micro-targets.
2. **Tracking should be a small window, not the whole screen** — floating rep counter,
   paused sets out of the top strip, pause across days, clock/stopwatch popup.
3. **Plans and history should respect time** — yesterday's plan + carry-forward, per-set
   time estimates, plan total time, organized History, Calendar showing real practice,
   sessions end per day, goals banner on the score.
4. **Fix what's broken** — voice/metronome command latency and rigidity, robot voice,
   Brain's misleading status + rambling style. (The _make-practice-addictive_ half of
   theme 4 — galaxy, streaks, photos, dynamics meter, Brain usefulness — is v7.)

Decisions made with Christian 2026-08-05:

- **Universe** → living galaxy, earned-only (v7).
- **Order** → practice core first (this spec), motivation layer second.
- **Popups** → in-app floating panels, not separate OS windows.
- **Dynamics checker** → full version (calibration + live readout + target mode), in v7.

## Constraints (unchanged, binding)

- User-as-sensor: the app never interprets audio as music. (The v7 dynamics meter is
  loudness-only and was explicitly approved as the first mic-judges-loudness feature;
  nothing in v6 listens to playing.)
- Deterministic hot loop; LLM never in the rep/metronome path.
- 8 GB M2 Air: no local ML runtimes, ever (D1). Cloud vision is the only OMR path.
- Live DB is never opened/migrated from dev code; migrations rehearse on a fresh copy via
  `CODAKILLER_MIGRATION_COPY=<copy> cargo test --lib rehearse_migration_on_real_database_copy -- --ignored`.
- Every voice-router change must re-pass the 1,309-segment narrated-corpus replay with
  zero false mutations.
- All 85+ legacy CSS token names preserved (deleting one renders a surface transparent).

---

## S1 — Automatic measure mapping

**What.** Opt-in, per piece per edition: a small **Map measures** button in the Score
toolbar and on the piece's Plan surface. Produces a reviewed, user-applied map of every
barline on every page; after Apply, tiny grey measure numbers render at each barline
(toggleable) and selection boxes snap to bars with measures auto-filled.

**Pipeline.**

1. Render each page via the existing fast decoder (`score/page_image.rs`) at a vision-
   friendly resolution.
2. Send page images to a cloud vision model (Claude preferred, Gemini fallback — the
   provider chain and keys already exist in `brain/provider.rs`). Structured output per
   page: systems (y-band, x-extents), bars per system (x-positions of barlines), printed
   measure numbers seen (value, location, confidence).
3. **Reconciliation layer (deterministic Rust):** continuity check across systems/pages;
   total-bar reconciliation against MusicXML via the existing `score_xml_measure_facts`
   command (pickup-aware — a pickup bar may shift numbering by one and must be surfaced,
   not guessed); printed numbers act as anchors; existing wizard calibration anchors are
   honored as constraints. Repeats/voltas don't change numbering (printed numbering is
   linear); da-capo structures are out of scope for numbering (numbers follow print order).
4. **Review overlay:** proposed numbers render on the score; conflicts (continuity breaks,
   MusicXML disagreement, low confidence) highlighted. User drags/edits any barline or
   number; edits re-interpolate the neighbors. **Apply** commits; **Cancel** discards.
   Nothing is stored as truth until Apply.
5. Multi-staff systems (full-score Bach, chamber): a system = one vertical band regardless
   of staff count; the model is prompted with examples of grand-staff, multi-instrument,
   and single-line systems.

**Storage.** New `measure_map` table (schema v14), anchored exactly like pencil marks:
`piece_id, edition_id, edition_fingerprint, page, systems_json` where `systems_json`
holds normalized (0–1, top-left origin) system bands and barline x-positions with the
measure number at each bar. Re-scanned file (fingerprint change) ⇒ map goes stale and the
UI says so plainly (do not repeat the B48 mistake of gating the stale notice behind a mode).

**Failure honesty.** Mapping needs network (one-time per edition). If the model's page
output fails reconciliation and the user doesn't fix it, that page stays unmapped —
partial maps are legal; unmapped pages simply keep today's behavior.

**Acceptance.** The Scherzo (real printed measure numbers + MusicXML): the applied map's
numbers match the printed numbers on every sampled page, respecting the known landmark
checks (m.67 LH = C♭, m.95 LH = F♮ verification habit from the practice vault). A second
test on one chamber/multi-staff edition exercises the system-detection path.

## S2 — Sub-sections (micro-targets)

- **Reuse the existing `target_meta.parent_region_id`** (schema v8, one-to-one region
  extension with a same-piece trigger and self-reference CHECK already in place — defined
  since v8 but never read or written by any code until now). No new column. One nesting
  level only, enforced in the write path (a child's `parent_region_id` must point at a
  region that itself has none).
- Child regions render only while their parent is selected; parent view shows a small
  count badge ("3 sub-sections").
- Creation with a map applied: drag inside the parent → child gets measures auto-filled
  from the map. Without a map: geometry + typed measures (today's flow) still works.
- Below-bar targets (e.g. 2 beats): the child stores its drawn box + bar range; the beat
  qualifier is a free-text label ("beats 3–4"). The map knows bars, not beats — honest.
- One-gesture set start on a child; default child-set contract `required_success = 3`
  (3-in-a-row), with **Come back later** re-queuing the child through the existing
  retention queue for the interleaved return pass. Failure mid-return resets that child's
  streak (existing contract semantics; no new engine).
- Deleting a parent asks about children (cascade or promote to top level).

## S3 — Floating panels ("Practice Dock")

A small in-app floating panel system (new `src/features/dock/`): draggable, snap-to-edge,
minimize-to-pill, z-managed, positions + open/minimized state persisted per panel, fully
keyboard-accessible, usable at the 720×520 minimum window. Panels in v6:

1. **Rep Counter** — the RepHud contents (verdict buttons, streak, BPM, ladder) move
   here; the docked strip at the foot of Today's Practice is removed. The panel is
   minimizable because Christian maps with the score, he doesn't read it while playing.
2. **Paused Sets tray** — all paused sets across pieces; resume is one click; the old
   top-strip placement is removed entirely.
3. **Clock / Timer** — clock, stopwatch, and countdown break timers (25-min preset +
   custom); timers keep running while minimized; a finished break timer chimes (audio via
   the existing output engine, never the mic path).

Panels are plain React in the single window — no Tauri multi-window (decision above).
Voice/receipt surfaces are untouched.

## S4 — Pause across days + sessions end per day

- `set_contract.set_state = 'paused'` already exists; v6 adds the missing surfaces:
  a Pause action on the active set (button; voice deferred to the existing draft-confirm
  lane later), the Paused Sets tray, and resume-across-relaunch (state is already
  durable; the UI finally exposes it).
- Paused sets do not appear on other pieces' surfaces (tray only).
- **Sessions end per day:** a session now auto-closes at local-midnight rollover (first
  event after midnight opens a fresh session; the old one is closed retroactively at its
  last event time — no phantom overnight focused time). "End my day" (button; the
  existing "end the session" voice command keeps working) closes it explicitly. A set
  still active at rollover auto-pauses. Manual pause/resume within a day is unchanged.
  The lazy-open/adopt pattern in `sessions/mod.rs` stays; only the adoption rule gains
  the same-calendar-day condition.

## S5 — Plans that respect time

- **Date navigator** on the day sheet: previous/next day + date picker; past sheets are
  read-only. **Carry forward** on any unchecked Item/Block line copies it to today
  (provenance noted in the line, e.g. "· from Aug 4"). No auto-carry — his choice each day.
- **Plan total time:** live sum of all minute-labeled lines, shown at the top of the sheet.
  Lines without minutes are listed as unestimated (count shown) — the total is honest
  about what it excludes.
- **Set time estimates:** optional small field in the set composer — "one pass at this
  tempo ≈ N seconds" (nullable `set_contract.pass_seconds`, schema v14). Estimate = Σ over ladder rungs of (reps required × pass time scaled
  by tempo ratio) + a fixed per-rep reset allowance; displayed as a range (e.g. "≈ 12–18
  min"), clearly an estimate. Flows into the day-sheet Block line minutes when the set is
  planned from the sheet.

## S6 — History reorganized (retires B25's history half)

- Default view: **day timeline** — one collapsed card per practice day, newest first
  ("Tue Aug 4 · 42 min · Scherzo · 3 sets · 2 mastered"), expanding to that day's sets →
  attempts (disclosure-first, loaded on expand like the current Ledger pattern).
- Alternate groupings preserved: by piece, by section; existing filters kept.
- List virtualization so 800+ reps / years of days stay fast; dense-fixture test at
  720×520.
- Append-only evidence semantics unchanged — this is presentation only.

## S7 — Calendar shows real practice

- Day cells merge **planned** (that date's day sheet items) and **done** (sessions,
  focused minutes, sets touched — from existing tables) with a small planned-vs-done
  visual. Today stops showing empty.
- `daily_work` scheduling stays as-is; this adds read-model queries, no schema change
  beyond indexes if needed.
- The day-cell layout deliberately leaves a slot for the v7 streak/photo layer.

## S8 — Goals banner on the score

- One editable line of large text pinned above the score view, per piece
  (nullable `piece.banner_text` column, schema v14; text ≤ 140 chars).
- Set in place, or promote a ⚑ goal line from the day sheet; edit/delete in place;
  dismissible for the session (hidden, not deleted).
- It is a cue card ("don't stop until it sings") — no metrics, no buttons beyond edit ×.

## S9 — Voice & metronome command overhaul

Grounded in the scouted causes (settle 600 ms + dedup 2.5 s + spoken-ack cycle ≈ the
"5-second delay"; strict fixed-phrase router = "Siri 2015"; silent `say` fallback =
"robot voice"):

- **Fast path for exact commands.** A short allowlist ("metronome off", "metronome stop",
  "stop", "done"…) finalizes on the partial when matched with high confidence, skipping
  the settle wait. The half-duplex gate ordering and the metronome speak-before-stop
  engine-alive rule are preserved.
- **Chime acks for routine actions.** Metronome start/stop/tempo and rep check-offs get a
  short click/chime instead of synthesized speech (existing output engine). Speech
  remains for content that needs words (questions, receipts that carry information).
  Perceived latency target: < 1 s from end of utterance to metronome state change on the
  fast path.
- **Looser matching, same firewall.** Normalized fuzzy/variant matching on command tokens
  (ASR mangles like "metranome"; natural forms like "turn the metronome on", "can you
  stop the metronome", "slower"/"faster" = ±default step). The 12-word ambient cap,
  conversational exclusions, and note fallback stay. **Gate:** the full narrated corpus
  replays with zero false mutations, plus new fixtures built from Christian's July 31
  complaints (each reported miss becomes a test case).
- **Visible hearing.** A live heard-text pill + mic-level indicator near the Rep Counter
  panel: every final (even Ignored) flashes what was heard, so a miss is visible
  instantly. Honest limit, stated in-app help: quiet-speech sensitivity belongs to the OS
  speech engine; the app can show what it heard, not hear better.
- **TTS dignity.** Pick a better default cloud voice; auto-retry the primary provider
  after cooldown instead of session-lifetime lockout to `say`; visible "voice degraded —
  using system voice" state instead of a silent downgrade.

## S10 — Brain quick fixes (full overhaul deferred to v7)

- Replace the misleading knowledge-status copy: `knowledge_shared_with_provider:false`
  must render as "no book excerpts matched this question", never as "content is hidden".
- System-prompt style pass: answer first, no author/AI-logistics preambles, ≤ 2 sentences
  default stays; citations become a compact suffix, not a spoken preamble.
- Brain speech uses the improved TTS path from S9; Brain answers render text-first with
  speech optional.

---

## Non-goals (v7.0 "Motivation Layer" — agreed-deferred, do not build)

Living earned-only galaxy (animated, physics-free, everything visual earned from real
focused time/mastery) · practice streaks with the end-of-day **photo calendar**
(camera capture, Liftoff-style) and streak-loss rules · completion animations / reward
layer · **volume/dynamics checker** (per-piano pp→ff calibration profiles, live dynamic
readout panel, target mode with screen tint; loudness-only) · Brain usefulness overhaul ·
any voice authority expansion (Goals/Calendar/session-plan voice actions remain on the
existing roadmap thread).

## Schema & migration

One migration, **v13 → v14**: `measure_map` table, `piece.banner_text`,
`set_contract.pass_seconds`, any History/Calendar read-model indexes. (Sub-sections need
no schema change — `target_meta.parent_region_id` has existed unused since v8.) Rehearsed on a fresh live-DB copy (rule above) before any packaged
build; pre-install backup per standing protocol.

## Testing & gates

- Existing suites extended (vitest ≥ current 1643, cargo ≥ 668, tsc + clippy clean).
- Narrated-corpus replay: zero false mutations (S9 gate).
- Mapping acceptance: Scherzo printed-number match + one multi-staff edition (S1).
- Migration rehearsal green on a copy of the real DB; integrity + FK checks.
- Dense fixtures: History timeline and panels at 720×520.
- Fresh-context adversarial verification per phase (the process that has caught real bugs
  every round).
- Update protocol on ship: Changelog, CodaKiller.md, Roadmap, Flaws (B25 history half,
  B43 → resolved-by-S1 when proven, B53 unaffected), How To Use (panels, mapping, voice
  changes are all user-facing), NOTES.md, version record, tag.

## Build order (suggested for the plan, not binding)

1. S3 dock system (unblocks S2/S4 UI) · 2. S4 pause/day-close · 3. S5 plans/time ·
2. S6 history · 5. S7 calendar · 6. S8 banner · 7. S1 mapping · 8. S2 sub-sections ·
3. S9 voice · 10. S10 brain fixes. S1 is the riskiest and S9 the most safety-gated;
   neither blocks the others.
