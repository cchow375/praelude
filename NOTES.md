# NOTES

## Decisions

- **Wake-cue conversational draft layer — first cut, verified SHIP (2026-07-16, Opus):**
  - **The trigger decision was Christian's (he chose WAKE-CUE).** The corpus proved conversational
    intent is too varied for regex and that ambient narration must never mutate. Three trigger
    models were possible (wake-cue / proactive-on-ignored-finals / manual); Christian picked
    wake-cue — deterministic, zero ambient API cost, cleanly inside the "LLM never in the hot loop"
    rule. On "Coda, ..." the Brain may propose a typed action; ambient speech never reaches the
    draft path, so the 1,309-segment corpus (zero "coda" tokens) stays zero-draft by construction.
  - **Architecture: the Brain PROPOSES a typed action; strict validation gates; explicit confirm
    is the backstop; existing commands execute.** No new command, no lib.rs edit — confirm reuses
    rep_check / metro_set / rep_undo / rep_restart. Four draft types: verdict, tempo, undo,
    restart. Session-goal DEFERRED (no backend home; do not build a session-goal concept blind).
  - **Backend (brain/{mod,provider}.rs):** `BrainAnswer` gained `proposed_action:
Option<ProposedAction>` (closed tagged enum Verdict/Tempo/Undo/Restart + a DETERMINISTICALLY
    generated `summary` — never provider text, so card copy can't be an injection vector). The
    vendor JSON's action is held as `Option<Value>` in `RawAnswer` (so a malformed action can
    NEVER fail the whole answer parse), then `from_value().ok()` + `.validate()` into a
    `deny_unknown_fields` input: bpm finite + within `audio::clock::MIN_BPM..=MAX_BPM` (1.0–1000),
    note trimmed/≤200, restart streak 1..=100, verdict closed enum, cross-kind fields rejected.
    Invalid → `None` (answer still returned). Voice-only gate: `match request.source { Voice =>
action, Typed => None }`.
  - **Frontend:** `proposedAction.ts` mirrors the union + re-narrows the IPC payload with the same
    bounds (defense in depth, fail-closed). `ActionDraftCard` became a router: the existing
    start_practice_set form is extracted verbatim (prior tests unchanged); the 4 new kinds get a
    SLIM card (summary + Confirm/Cancel, no heavy form). `BrainWorkspace` fires onProposedAction
    only when `source === "voice"`. `Shell.confirmBrainAction` is the ONLY command site; verdict/
    undo/restart need an active block (dual guard: hidden Confirm + early-return re-checked against
    live rep.snap), tempo is metronome-wide so stays confirmable with no open set.
  - **The one real design call (flagged + verified benign):** a validated action rides the
    citation-grounding FALLBACK answer too (for Voice), so tempo/undo/restart surface even when
    the prose has no book citation. Verified: it attaches ONLY after a real provider returned Ok;
    the two truly-offline exits (empty chain / ProviderUnavailable) hardcode `None`. The note is
    bounded and flows only to rep_check as the recorded note, never rendered as card copy.
  - **SAFETY BOUNDARY verified by orchestrator (grep) AND an independent fresh-context verifier:**
    intent/ (hot-loop) = 0 changed lines, metronome.rs = 0, lib.rs = 0; `proposed_action` appears
    nowhere outside brain/. No auto-confirm path (single Confirm-gated site). Malformed-drop bite
    proven on a `cargo clean -p` fresh recompile (12 bad cases → None), closing the stale-binary
    false-pass hazard (mtime-preserving `sed -i.bak`+`mv` edits make cargo reuse a stale test
    binary — always `touch` the source or `cargo clean -p` before trusting a bite-check).
  - **Gates:** cargo lib 465/0/10 ignored (+7); strict clippy; vitest 615 (+11); build green.
  - **FIRST CUT — the confirm-card FEEL is Christian's to tune at the piano** (how it reads back,
    hands-free confirm); this landed the LAYER, not the tuned UX. When v2 ships, [[(C) How To Use]]
    needs the "Coda, ..." conversational grammar (installed app still v1.3.0, so no tutorial change
    yet).

- **Dev-mock browser harness — the v2 UI renders in a plain browser now (2026-07-16, Opus):**
  - **Why:** the whole v2 UI had only ever been jsdom-tested; no real-browser render existed, so
    visual/design QA was impossible (flagged in the Universe audit). Built a flag-gated dev-mock so
    `npm run dev:mock` serves all five workspaces in a browser with realistic sample data — a
    permanent design-review/QA affordance and a release-matrix precursor. Frontend-only; the
    subjective aesthetic pass is deliberately left to Christian's eye.
  - **Interception seam = `window.__TAURI_INTERNALS__`** (src/devMock/tauriDevMock.ts). Both
    `@tauri-apps/api` surfaces bottom out there: `invoke(cmd,args)` → `__TAURI_INTERNALS__.invoke`,
    and `listen` → `transformCallback` + `invoke('plugin:event|listen')`. Mocking that one object
    intercepts every command AND every event subscription in one place — cleaner than wrapping
    per-feature call sites (there is no central invoke wrapper; `services/command.ts` only
    normalizes errors around the raw invoke). `isTauri()` checks `window.isTauri` (unset in
    browser → stays falsy), and nothing on the load paths gates on it.
  - **The stall lesson (first attempt died on the event surface):** for a STATIC render harness,
    events must be a BENIGN NO-OP — `plugin:event|listen` returns a valid unlisten fn and fires
    NOTHING; initial render comes entirely from the invoke load calls. The first executor
    rabbit-holed trying to simulate live event pushes and stalled (600s watchdog, wrote nothing);
    the retry with events no-op'd + only the 5 workspaces' load-path commands mocked completed
    cleanly. General rule: a render harness needs mount, not live behavior — no-op the push
    channels.
  - **Real path provably untouched:** activation is `if (import.meta.env.VITE_DEV_MOCK)` +
    dynamic import in main.tsx `bootstrap()`, so Vite tree-shakes the whole `devMock` chunk when
    the flag is off. Verified: a flag-OFF `npm run build` dist contains no `installTauriDevMock`/
    `devMock` string. No `src-tauri` file touched. Gates: vitest 604 (+5 smoke), both builds green.

- **P7 Brain answer-quality checkpoint + the Tier B deferral decision (2026-07-16, Opus takeover):**
  - **The corpus reframed the voice roadmap.** Scouting the Tier B slice against the 1,309-segment
    corpus surfaced that Tier A (deterministic hot-loop) ALREADY handles verdicts/undo/restart/
    tempo in command grammar; the real gap is CONVERSATIONAL phrasing ("forget the last one" vs
    "undo last rep"). The contract's answer for conversational intent is Brain-proposed typed
    drafts the user confirms (Tier B/C) — NOT more regex (regex overfits; the corpus proves
    conversational speech is unboundedly varied). Building regex for the 5 escalated corpus
    moments would be overfitting. **DECISION: the conversational voice-mutation draft/confirm
    FEEL is deferred to a piano session with Christian** — tests prove the firewall never
    false-fires but fundamentally cannot tell whether a confirm card mid-practice helps or annoys;
    only his ear at the Steinway can, and it touches the "LLM never in the hot loop" golden rule.
    The Brain's typed action tools fold into the same deferred surface. See [[codakiller-v2-app]].
  - **What WAS safe to build (this checkpoint, B26 answer-quality — no practice mutation):**
    - One-glance output: one edit to the shared `SYSTEM_POLICY` (brain/provider.rs:31-34) — 1–2
      sentence default, expand only when asked — covering both Claude (:338) and Gemini (:356) in
      one place. `MAX_ANSWER_CHARS=4000` stays the ceiling; one-glance is the default.
    - Durable per-piece memory: wired the previously-dead `brain_thread`/`brain_turn` v8 tables.
      CRUD in store/crud.rs (resume-or-create most-recent non-cleared thread, append turn, bounded
      load `MAX_THREAD_TURNS_LOADED=20`); commands `brain_thread_resume`/`brain_thread_clear`;
      `brain_ask` gained optional `thread_id` and appends the user+assistant turns after a
      successful answer (offline answers persist too, tagged `provider="offline"`; append is
      best-effort `let _=` so a persistence failure never becomes an answer error). Clear sets
      `cleared_ts` — never DELETE (turns preserved). Frontend BrainWorkspace resumes on piece
      open with a piece-switch-safe guard + one "Clear / new conversation" control; no
      thread-switcher UI (follow-up).
    - Retention + ledger grounding: read-only `retention_due_for_piece` (practice_loop.rs, SELECT)
      - `recovery_actions_for_piece` (crud.rs, SELECT) inject `retention_checks_due` +
        `recent_recovery_actions` into context.rs, capped `MAX_RETENTION_CHECKS/RECOVERY_ACTIONS=8`
        under the existing 64k budget. Region NAME + measures exposed, NO raw DB ids leaked.
  - **The practice-mutation boundary held — independently verified by the orchestrator, not just
    the executor's self-check.** A diff-wide grep for INSERT/UPDATE/DELETE showed the ONLY
    production writes added are `brain_thread`/`brain_turn` (the Brain's own conversation); the
    three practice-table INSERTs the diff added (retention_check/practice_operation/
    practice_recovery_action) are ALL inside a `#[cfg(test)] impl Store` block (crud.rs:2197) —
    test seed helpers, compiled out of production (same pattern as the anomaly slice's
    `exec_for_test`). practice_loop.rs added only a read-only SELECT. **Method note for future
    checkpoints: grep the diff's added write-SQL yourself; a whole-file grep conflates
    pre-existing production writes with new test-only seeds — disambiguate with per-file `git
diff --numstat` + the `@@` hunk headers.**
  - **Gates:** cargo lib 458/0/10 ignored (+9), strict clippy --all-targets clean; vitest 599
    (+3); build green. Independent adversarial verifier targeted the correctness edges (frontend
    piece-switch race, offline/failed-append integrity, memory bounding/isolation, clear
    semantics, context caps/no-id-leak).

- **P7 anomaly disclosure UI + FULL narrated corpus (1,309 segments) checkpoint (2026-07-16):**
  - **The complete narrated corpus now replays deterministically — 1,309/1,309 segments, zero
    false mutations.** All four real Whisper-transcribed sessions are stateful replay fixtures
    driven through the production `Router` via the shared `tests/replay_common` harness:
    griffes 79, scherzo1 721, scherzo2 201, scherzo3 308. Verbatim fidelity independently
    machine-checked against the source `*_narration.json` (`raw_text` + `at_ms` byte-identical,
    monotonic, counts exact) — the fixtures did not alter text to force outcomes; the harness
    asserts `routed == expected` against the real router, so a mislabeled command fails the test.
  - **Every one of the 1,309 segments routes to `Intent::Ignored`, and that is contract-correct.**
    These recordings are Christian NARRATING to a future coach while the app was not running —
    he speaks conversationally ("So I'm gonna go from measure 516"), never in the deterministic
    command grammar ("go to measure 516"). Buried command tokens ("turn my metronome on",
    "tempo 55", "stop", "Start, 473"), ASR-corrupted numbers (colon `5:23`, lost-hundred
    `from 43`), verdict words ("done", "again", "no shoot I got it wrong"), and self-corrections
    all correctly stay inert. This is the strongest possible firewall regression guard.
  - **THE LOAD-BEARING FINDING (all four converters converged on it independently):** the
    deterministic hot-loop firewall is rock-solid, but it is ALSO why almost none of Christian's
    real conversational practice becomes tracked state. The genuine leverage gap is the **Tier B
    natural-language draft/confirm path** — today it only covers rep-opens (ActionDraft →
    `rep_open`); it does NOT cover verdicts, tempo changes, session goals ("492 all the way to
    516"), undo ("forget the last one"), or restart ("restart from 484"). scherzo2/scherzo3
    escalated 6 such moments to the fixture `review` bucket rather than faking them. This is the
    spec input for the Brain/voice slice: broaden Tier B grammar + confirm flow, do NOT loosen
    the Tier A hot-loop (loosening it would reintroduce false mutations the corpus proves are
    currently zero).
  - **Batch conversion was a clean fan-out:** three concurrent executors, one per scherzo
    session, each owning only its own `tests/narrated_session_scherzoN.{rs,json}`, all sharing
    the verified `replay_common` module (zero harness edits). Converter pattern preserved at
    `scripts/gen_narrated_session_fixture.py`.
  - **Anomaly disclosure UI is read-only by construction.** New `anomalies_list` command
    (lib.rs; reader `src/anomalies.rs`; `Store::list_anomalies` SELECT-only) → `AnomalyReport`
    grouped by kind, severity-ordered (error→warning→info), with `parse_detail` degrading
    malformed `observed_facts_json` to `{"raw": text}` (now covered by a dedicated test). The
    only write literal in the module is `#[cfg(test)] exec_for_test`, gated out of production.
    Panel lives in the Ledger workspace as `<details>/<summary>` disclosure — no write
    affordances, honest empty state, per-kind "what it means / why it is disclosed, not
    repaired" copy that stays strictly on the data-shape side of the authority boundary (a
    hostile verifier read every string: nothing implies the app judged playing). The 9 explained
    kinds exactly match what `v8_backfill::insert_anomaly` writes, with a generic fallback for
    any unknown kind. Anomalies stay PROJECTED, never silently repaired; the audited
    archive/correction (write) flow is deferred future work.
  - **Flaws B22 does NOT move to Resolved** — the register's discipline (cf. B27) is that
    nothing resolves until the INSTALLED app + user-facing copy agree; this is source-only, so
    B22 gets a source-progress annotation and stays Open.
  - **Gates (settled tree, orchestrator-run):** cargo lib 449/0/10 ignored; narrated suites
    replay 5 / scherzo1 2 / scherzo2 2 / scherzo3 1 / firewall 2; knowledge 9 / STT 9 / TTS 4;
    strict clippy --all-targets clean; vitest 596; production build green. Both completed lanes
    (anomaly UI, harness refactor) passed fresh-context adversarial review (SHIP); corpus
    fidelity re-proven by the orchestrator's own script.
  - **Opus 4.8 takeover (this checkpoint):** Fable 5 was switched out mid-edit (right after
    adding the malformed-JSON test); Opus completed the checkpoint per the takeover protocol —
    independent fidelity re-verification, consolidated gates, docs, commit.

- **P7 Composer plan-start + narrated replay harness checkpoint (2026-07-16, later same day):**
  - **`action_draft` cannot hold session plans — by design, not accident.** Its CHECK constraint
    (`source IN ('voice_draft','brain_draft')`, migrations.rs:645) and column shape model a
    natural-language edit awaiting confirmation. The durable plan record is the start command's
    OWN receipt: `practice_operation.value_json` carries the full `SessionPlanStartOutcome`
    (plan + started item + snapshot). Receipt-as-record is the pattern for reviewed UI handoffs;
    no schema change (v10 untouched).
  - **`session_plan_start`** (lib.rs:600/:1226; engine rep/mod.rs:539; store
    store/session_plan.rs) opens item 1 through the EXTRACTED `open_set_in_tx`
    (practice_v2.rs:823; `v2_open_set` now wraps it — verified verbatim-identical by line diff).
    Progression is per-item explicit start (`command_id` = `{planId}:{seq}`, namespaced
    `session-plan-start:`); one-live-set enforced store-level and surfaced in Today; goal-only
    items get no Start button (no measure target) — no dead buttons.
  - **Known-benign edge (documented, not fixed):** replaying an already-closed item's command
    re-projects that block and momentarily sets it as the in-memory active snapshot. Unreachable
    via the UI (started items lose their button; busy-gating), and durable state is hard-guarded
    (`v2_record_attempt` rejects non-active sets; `active_exists` blocks second opens). Worst
    case is transient cosmetic HUD state until the next emission.
  - **The narrated replay harness** (tests/narrated_session_replay.rs) mirrors `handle_final`
    exactly — independently verified on the two subtle points: ambient finals do NOT seed the
    dedup ledger (production returns on Ignored before `self.last =`), and the 2.5s window
    slides on suppressed re-sends (set before the suppress-return). Rep verdicts fold through
    the public pure `ledger::derive` + `PracticeContract` — no private-module reach-ins, no
    lib.rs coupling.
  - **Griffes replays 79/79 segments → all Ignored, zero mutations — honest and correct** (a
    note-hunting session; buried "turn the metronome on" and ambiguous number runs correctly
    firewalled). Fixture pins verbatim text + at_ms + WAV SHA. Self-proof tests cover what a
    quiet session can't: identical-"done" resend collapse (3 sends → 1 rep), streak reset on
    "again", mastery on the 5th consecutive clean BY CONTRACT, live-Mode threading. Progressive
    `90→96` single-action collapse remains an explicitly open Lane A/C item — deferred, not
    faked.
  - **Batch recipe for scherzo1/2/3 (721/201/308 segments):**
    scripts/gen_narrated_session_fixture.py (preserved from the lane's /tmp — /tmp files die;
    always move build artifacts into the repo) + per-session adjudication overrides; the harness
    needs zero new code. Scherzo sessions DO open blocks, so they exercise the rep paths. If a
    segment exposes a real defect: keep the contract-correct expectation and let the harness
    fail loudly — never bend the fixture.
  - **Gates:** cargo 445/0/10 ignored (+9), all five gate suites (incl. narrated_session_replay
    5/5), strict clippy; vitest 592 (+5); build green. Fresh verifier: SHIP (zero extraction
    drift; harness mirroring faithful; edge benign).

- **P7 / v2.0.0 practice-loop stabilization — recovered night build, verified SHIP (2026-07-16):**
  - **Trust nothing an interrupted fixer claims; verify per blocker.** The July 15 Codex night
    build died at its 21:28 vendor lockout mid-edit (84 uncommitted files, non-compiling, its own
    verifier's NO-SHIP list of eight semantic blockers, fix pass half-applied). Per-blocker
    adversarial verification found 7/8 production fixes correct but proven by zero tests; the 8th
    was live: `v2_adjust` omitted `mastered` from `preserves_terminal_lineage`, so undo/correct/
    reverse flipped a mastered set back to `active` (reachable — `correct`/`v2_undo`/
    `v2_reverse_adjustment` all hardcode `keep_open=true`). One-token fix; `v2_restart`/`v2_close`
    already reject terminal states, so it was the only leak.
  - **Every blocker now has regression proof (11 new tests), three proven to bite** by
    temporarily re-breaking production and watching them fail: safety-stop replay never repeats
    the physical stop (and threaded resume can't overtake it — the active mutex holds across the
    stop); an idempotent retry that implicitly opens a session creates exactly one `session` row;
    recovery anchors on physical `MAX(id)` even when the latest attempt is voided (effective
    anchoring would cascade into a wrong mastery retune, bpm 70→80); live gaps >60s cap at +60s
    with `end_reason='suspension'` and a backward clock is rejected; `MutationReceipt` JSON
    exposes `command_id`/`replayed`/`committed_ts`, never `session_id`; retention rejects
    impossible dates (`2026-02-30`, non-leap `02-29`) and mismatched/incomplete evidence at every
    entry point with zero rows written.
  - **Score Atlas target save is real now.** New `store/score_atlas.rs` +
    `score_atlas_target_save` registration: one transaction creates Region + `target_meta` +
    `region_change`, reusing `begin_operation` idempotency with `command_id =
score-atlas-target:{draft id}` carried from the frontend (`savePayload.ts` /
    `TargetDraftEditor`). Replay returns the committed Region; a reused id with different
    geometry rejects. NO schema change (v10 untouched). Sidebar-on-piece-switch fixed via
    `sectionsStashedRef` — restores only a draft-hidden sidebar, preserving manual collapse.
    `calibration/hierarchy/fingerprint` atlas modules stay deliberately staged-unintegrated
    (ScoreView still uses local `mappingFromRegionAnchors`).
  - **Voice set-opening has one owner.** `voice://transcript` now carries an authoritative
    `handled: bool` (classify → emit → act inside `handle_final`; interims stay `handled=false`);
    Shell's Lane-B draft gate short-circuits `handled === true`, killing the cross-lane
    double-open ("start a rep tracker measures 40 to 56 at 80" previously opened via the hot loop
    AND drafted). The 2.5s dedup + half-duplex invariants are unchanged. Dead hook outputs
    removed (`submitTyped`/`transcript`/`downReason` — no plan item schedules consumers);
    `deliveryDisposition` wired into VoiceToast for duplicate/stale feedback.
  - **SessionComposer stays unmounted deliberately.** Component + candidates hook complete, 38
    tests green, all five candidate commands real — but NO backend command starts a reviewed
    session plan (only per-block `rep_open` and `session_current`/`session_end` exist). An honest
    Start needs that backend decision first (new plan-start receipt command vs UI-orchestrated
    `rep_open` of item 1). Do not mount before then; do not rediscover this.
  - **Universe/Shell confirmed real, not placeholder** (fresh audit): `universe_snapshot`-fed;
    anti-gaming holds — star size from `focused_seconds` only, maturity excludes raw clean
    counts, mastery ring = verified contracts, admin events firewalled. Browser visual QA still
    unrun (needs a packaged/dev run).
  - **Rehearsal 7→10 exact + idempotent reopen** on fresh copies of backup `4b21549…`:
    user_version 10, quick/integrity ok, FK 0, counts 6/27/48/481/21/8/628/670 preserved, 127
    `bpm=0.0` sentinels intact, backfill 27/48/481/628, 792 anomalies. Live DB and installed
    v1.3.0 never touched.
  - **Gates at this commit:** Rust lib 436 passed / 0 failed / 10 ignored + knowledge 9 +
    narrated firewall 2 + STT 9 + TTS gate 4, strict clippy clean; vitest 587 across 63 files;
    production build green. Fresh whole-tree adversarial verdict: SHIP (all 56 invoked commands
    registered, zero duplicates; no bite-check residue; composer unmounted).
  - **Multi-agent-on-one-tree gotchas:** a concurrent full-suite run can catch another lane's
    TDD window red — judge only the settled tree; NEVER `git stash` on the big uncommitted slice
    (one lane's stash/pop nearly reverted it; recovered intact); disjoint file ownership per lane
    is what made three concurrent executors safe.

- **P7 / v2.0.0 authoritative practice-truth cutover (2026-07-15; exact-tree source, not
  installed):**
  - **One Rust projection now owns practice meaning.** `RepEngine` coordinates schema-v9
    `set_contract`, immutable `rep`, provenance, append-only adjustments, canonical/session events,
    and the typed snapshot in one store transaction. React, voice verdicts, history, metrics,
    planner, export, and Brain context consume that projection; none may infer mastery from
    `planned_reps` or raw row counts.
  - **Schema 9 adds only the one-live-set invariant.** The v8 sidecars remain the compatibility
    model; v9's partial unique index covers native `active|paused` states and deliberately excludes
    legacy states. Restore of a malformed multiple-live database returns a durable recovery error
    from both `rep_state` and `rep_open`; it must never masquerade as an empty engine. The installed
    app/live DB remain v1.3.0/schema 7.
  - **Practice contracts and corrections are captured facts.** New sets default to five
    consecutive cleans through the bounded Settings value; attempt ceilings are review prompts,
    not mastery. Undo is a void adjustment, correction distinguishes omitted note from explicit
    clear, reversal restores prior effective state, and restart preserves/links the old set. Never
    update/delete source attempt rows or historical set metadata. Correcting an explicitly
    restarted/abandoned/closed-unresolved set preserves that exact terminal lineage.
  - **Tempo condition is explicit.** Tempo focus alone may ladder/master. Metronome-on non-tempo
    work keeps factual positive BPM but never earns tempo progress; metronome-free non-tempo writes
    use the physical v1 `0.0` compatibility sentinel and immediately project it as `None`. Only that
    exact case is nullable—negative, missing, nonfinite, tempo-zero, and metronome-on-zero evidence
    is a visible projection error. Corrections/reversals replay tempo from effective attempts.
  - **Frontend async ownership is part of data truth.** Returned command snapshots are only an
    eventless fallback; revision guards prevent late open/check/close replies from resurrecting or
    overwriting newer voice state. HUD verdicts serialize, manual metronome commands hold a shared
    intent lease until their native event, initial metronome readiness is awaited only after the
    ledger commit, rejected notes are restored, and stale/partial history never mixes pieces,
    hides attempts, or exposes database IDs.
  - **Exact checkpoint gate:** frontend 39 files / 283 tests plus production build; Rust library
    406 passed / 10 ignored, RepEngine 47, metrics 11, planner 6, export 4, `cargo check --tests`,
    strict `clippy -D warnings`, and diff checks. Fresh independent Rust and frontend reviewers
    found no remaining P0–P2 issue in this cutover. Remaining practice-loop work is durable outer
    receipts/idempotency, pause/focus/safety/recovery/retention, and complete deterministic voice /
    narrated replay; Score Atlas and the visual transformation still follow.

- **P7 / v2.0.0 verified foundation checkpoint (2026-07-15; exact-tree code, not installed):**
  - **The release boundary has not moved.** `/Applications/CodaKiller.app` is still v1.3.0 and
    Christian's live database is still schema 7. No v2 process opened or migrated the live path.
    Every real-data rehearsal used a disposable copy of the verified pre-v2 backup; do not let a
    development launch reach the live app-data directory before the paired app/database release
    gate is ready.
  - **Schema v8 is an additive compatibility foundation, not a switched practice engine.** The
    migration adds `score_section`, `target_meta`, `score_edition_calibration`,
    `protocol_template`, `set_contract`, `attempt_provenance`, `attempt_adjustment`,
    `retention_check`, `data_anomaly`, `action_draft`, `brain_thread`, and `brain_turn`, plus
    structured event links. The v7→v8 step runs under one `BEGIN IMMEDIATE` transaction, preserves
    the v1 physical rows/IDs and score-anchor bytes, rejects a newer schema, and is idempotent.
    Historical blocks receive `legacy_attempt_count` / mastery-`unverified` contracts; historical
    reps receive `migration_legacy` provenance. Sidecar repositories, IPC, RepEngine writes, and
    React projections are still unwired, so current runtime practice semantics remain v1 behavior.
  - **The real-backup migration rehearsal is exact and repeatable.** A disposable copy of backup
    SHA-256 `4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`
    migrated 7→8, reopened without additions, passed `quick_check` / `integrity_check`, and had
    zero FK violations. It preserved exact source counts: 6 pieces, 27 Regions, 48 blocks, 481
    reps, 8 sessions, 628 session events, 670 canonical events, 21 Goals, and 11 Daily Work rows.
    Backfill produced 27 target metadata rows, 48 legacy contracts (25 `legacy_closed`, 23
    `abandoned`), 481 attempt-provenance rows, and 628 reconciliation-ledger rows. Legacy-column
    content hashing remained exact; the physical `event` table changed only by the additive v8
    provenance/link columns.
  - **Anomalies are projected, never silently repaired.** The rehearsal recorded exactly 792
    review rows: 670 incomplete legacy event-provenance facts, 43 same-second attempt bursts, 30
    duplicate-looking set pairs, 23 abandoned legacy sets, 13 empty sets, 11 attempt overruns, one
    nonpositive Region range (Region 24, 0–0), and one reversed set range (set 45, 452–449).
    Fresh review hardened signed legacy ordering, deterministic burst attempt-ID arrays, actual
    nullable provenance facts, and negative/nonpositive input detection.
  - **Legacy non-tempo attempts use `0.0` as an exact v1 sentinel.** A read-only query of the
    verified backup found 127/481 reps with `bpm=0.0`; every one belongs to one of seven
    `focus='notes'`, `use_metronome=0`, NULL-start-tempo blocks (IDs 30, 33, 44, 45, 46, 49, 50).
    Do not rewrite those physical rows and do not feed `Some(0.0)` into the strict v2 ledger.
    The v2 repository projection must map only migration-legacy non-tempo sentinel values to
    `None`; every new tempo attempt still rejects nonfinite/nonpositive BPM.
  - **Practice truth exists as pure code only.** `protocol` evaluates consecutive-clean,
    total-clean, timed-exposure, exploratory, and legacy contracts; `ledger` folds original
    attempts plus append-only void/restore/correction/reversal records into tries, verdict totals,
    current/best streak, resets, accuracy, source mix, tempo path, recovery, and mastery. Durable
    SQLite IDs define fold order. Self/future/cross-attempt reversals reject, and adaptive recovery
    activates only after an error. The verifier reproduced `C,C,F → current 0 / best 2`, mastery
    only on the fifth following clean, 10 failures never mastering, 50% remaining 50%, and legacy
    completion staying unverified. RepEngine is not yet a coordinator over this projection.
  - **Visible mutation ownership now has a frontend foundation.** A typed command wrapper
    normalizes native failures; the application Receipt Center owns visible dismissible committed,
    undone, and error messages with polite/assertive live regions. Rep-open/session-end/settings
    failures preserve prior state and remain visible; setting writes roll back; a successful rep
    says `Attempt N saved — verdict.`; delayed open/check responses cannot resurrect a closed set
    or retune its metronome. These are process-local legacy adapters—backend operation IDs,
    durable receipts, and real undo commands remain later work.
  - **The first narrated firewall fixture is a seed, not the narrated replay.** Deterministic tests
    now keep `5:16` colon/time forms from becoming measure/tempo mutations and keep `no thanks` or
    conversational `again ...` from recording failures, while preserving explicit commands such
    as `again`, `again fingering fell apart`, and `no, shoot, I got it wrong`. Fresh review caught
    and fixed both a `bump it up 5:16` → `+16` hazard and an over-broad `again` suppression. Delivery
    identity, progressive `90→96`, all 1,309 raw segments, four stateful sessions, and installed
    audio/Steinway acceptance remain open.
  - **The local Brain corpus manifest now recognizes all four actual books.** The exact allowlist
    adds `gieseking-leimer-piano-technique.md` as `gieseking-leimer-technique`, with mental/
    concentration/score-study retrieval priority, visual-dependency metadata, and a historical-
    pedagogy caveat. The ignored real-corpus test passed with four files. The installed v1.3.0 app
    still exposes its three-book behavior until v2 is packaged.
  - **Verified exact-tree checkpoint:** frontend 39 files / 236 tests; Rust library 376 passed / 9
    ignored plus knowledge 9, narrated firewall 2, STT 9, TTS gate 4, and 2 ignored live-TTS tests;
    production build and strict `clippy -D warnings` passed. The real four-book corpus and Scherzo /
    Griffes MusicXML ignored gates passed explicitly. This proves the foundation, not V2.4–V2.12.
  - **Whole-crate `cargo fmt --check` is not a usable current gate.** The pre-existing Rust tree
    contains thousands of rustfmt differences outside P7-owned lines even though strict clippy and
    all tests pass. Do not bulk-format them inside a semantic feature commit; keep new/touched code
    locally formatted and schedule any full-tree format as its own reviewable mechanical commit.

- **P7 / v2.0.0 Practice OS transformation boundary (2026-07-15; implementation in progress,
  not shipped):**
  - **Real use replaces the stale “never used” assumption.** A consistent July 15 schema-v7
    snapshot contains 6 pieces / 27 Regions / 48 blocks / 481 reps / 8 sessions / 670 events / 21
    Goals / 11 Daily Work rows. It passes `quick_check` and has zero FK violations. Preserve it at
    `~/Library/Application Support/com.christian.codakiller/backups/(C)
pre-v2.0.0-feedback-2026-07-15-163528.db` (442,368 bytes; SHA-256
    `4b21549237b6f70de7399444151063bcb3ea35a9067a0ce363ce07d14f8b1aee`). Never rehearse a
    migration against the live database; copy this backup again for each destructive rehearsal.
  - **The v1 completion model is semantically invalid for Christian's goal.** Every verdict
    increments `reps_done`; flawed/failed do not reset `cleans_at_step`; planned attempts can be
    exhausted with zero clean reps; variants also advance by attempts. v2 stores immutable attempt
    evidence and derives attempts, clean totals, current/best consecutive streak, resets, recovery
    target, accuracy, and completion. Undo/correct/restart are compensating/audited events, never
    invisible history deletion. “100%” means satisfying the chosen consecutive-clean contract,
    not rewriting prior errors or claiming global perfection.
  - **Book mechanics are stage-specific, never one magic rule.** The shared model is
    `Decode → Stabilize → Retrieve → Perform → Retain`, with safety, explicit focus, self-judgment,
    and journaling across every stage. Five consecutive cleans is an evidence-aligned default, not
    a universal law. Support configurable fixed/adaptive recovery, down-step/reset ladders,
    blocked→serial→random work, variable practice after stabilization, sparse-click pulse modes,
    cold retention checks, microbreaks, and user-selected safety stops. Suggested, never imposed.
  - **The supported corpus must account for all four actual files.** v1's strict three-file
    allowlist omits `gieseking-leimer-piano-technique.md`. v2 may add it only through the existing
    canonical-file/read-only/capped retrieval boundary and must label historical pedagogy rather
    than treating every assertion as modern evidence. Update corpus code, protocol, UI copy,
    tests, specs, and every “three-book” claim together.
  - **Score identity has two honest lanes.** A compatible structured MusicXML-rendered/linked
    surface can provide exact measures. A scanned PDF or mismatched edition cannot become
    “perfectly mapped” by assertion: it needs edition calibration, a visible confidence state,
    correction before low-confidence save, and persistent normalized geometry. Drag-first target
    creation is required in both lanes; exactness claims are conditional on source compatibility.
  - **Voice has three authority tiers.** Tier A deterministic hot-loop actions (verdict, status,
    undo/restart, pause/resume, tempo/metronome, close) remain local and terse. Tier B natural
    structured requests produce typed validated drafts and require concise confirmation when
    ambiguous/risky. Tier C coaching questions remain read-only until an explicit typed action is
    previewed/confirmed. The model never writes SQLite or enters the rep loop directly.
  - **Narrated PianoCoach WAVs are state-machine evidence, never music evidence.** The four files
    total 3:23:24.885 / 1,309 Whisper segments; long segments and repeated hallucinations make raw
    transcript bounds unreliable. Use a raw firewall replay, curated semantic moments, ASR
    corruption matrix, four stateful session fixtures, mastery/property tests, and a separate
    installed-STT audio lane. Piano, looping, searching, page turns, phones, and silence must be
    inert. Never infer notes, hands, range, tempo, or quality from audio.
  - **Observed voice hazards now have production evidence.** Christian reports missed `done` over
    the piano. Three failed-rep notes contain ambient phrases. Current leading-fail grammar makes
    `no thanks` / `again, ...` dangerous; 2.5-second identical-final dedup can swallow genuine
    rapid micro-drill verdicts; colon/time ASR such as `5:16` can become the wrong range. Ambiguous
    numbers never mutate without confirmation. User correction always wins.
  - **Every mutation needs one global receipt/error surface.** `useRep.open` and
    `useSession.end` currently catch errors that can have no visible renderer; lightweight setting
    writes optimistically update memory and suppress failure. Callers must not advance query
    revisions after failed writes. The new shell owns concise saved/failed/undone receipts with
    operation IDs and an undo path where defined.
  - **Brain memory/actions are constrained systems, not “full control.”** Default answers fit one
    glance: hypothesis, one action, dose, stop condition, sources. Per-piece bounded threads may
    persist and clear. Context joins selected score/MusicXML, explicit symptom, ledger/retention,
    and four-book retrieval. Tools are an allowlist of typed drafts with validate → preview →
    confirm → transaction → receipt → undo/audit. On the 8 GB M2 Air, offline baseline means local
    retrieval/structured memory/protocol routing/templates—not an always-resident local LLM.
  - **Interface direction is a locked product constraint.** Operational UI uses Cloud Dancer
    off-white, ink, one deep-terracotta action accent, editorial serif + structured utility face,
    asymmetrical negative space, matte filled artifacts, one staggered workspace reveal, and fast
    physical micro-responses. No violet/purple gradient, generic three-card symmetry, glow/
    glassmorphism, ambient loops, or component-library collage. Color is primarily score marks /
    earned Universe. `prefers-reduced-motion`, 720×520, keyboard, screen reader, and 75–125% scale
    remain release gates.
  - **Current live anomalies are evidence, not cleanup permission.** Snapshot includes one reversed
    range (452–449), 11 overrun blocks, repeated range/label groups, 13 empty abandoned blocks, and
    same-second bursts up to seven attempts. Future writes must reject invalid ranges and record
    input provenance. Migration retains every row and produces an anomaly report; archival or
    correction requires Christian-visible audited action.
  - **Baseline before v2 edits:** clean `main` at `fb7125c` / tag `v1.3.0`; npm 36 files / 217
    passed; Rust 380 normal tests passed with 11 hardware/network/real-data ignores; the three safe
    real-data gates passed explicitly; strict clippy and production build passed. No git remote.
    Vite warns that the 1.24 MB PDF worker would benefit from code splitting.

- **P6 intelligence/workspace / v1.3.0 contextual Practice Brain (2026-07-13):**
  - **Context must be explicit and canonical.** A Brain question with no frontend piece selection
    receives no piece, even if `ui.current_piece` is persisted. A selected Region with zero blocks
    receives zero unrelated reps. Active Rep state crosses from the native RepEngine only when its
    piece matches. The frontend's title/page/edition are hints for identity display; Rust re-reads
    ownership by IDs. The same rule applies to deterministic plan preview.
  - **The external book corpus is a strict read-only allowlist, not a generic folder crawler.** Open
    only the three exact converted Markdown filenames directly under the configured absolute
    directory; require regular non-symlink canonical files; cap 5 MB/book and 12 MB total; clean
    HTML and Markdown link/image targets; chunk by headings; cache by canonical root + length +
    mtime. Retrieval is bounded BM25-like lexical ranking with reviewed aliases/source priors,
    max six hits and two/source. Citations expose source/heading/line locator, never local paths.
  - **Privacy applies across time, not just one request.** Retrieval always runs locally. The share
    toggle controls whether retrieved bodies enter provider context and citation authorization.
    Offline responses name/cite a book section but never embed raw book body, because that answer
    becomes assistant history if a later turn goes online. Conversation is six exchanges, 2,000
    characters/turn, process-session-only.
  - **MusicXML is bounded notation evidence.** Resolve only the canonical DB piece path under its
    piece folder; reject symlink/escape/invalid root and never resolve DTDs. `.musicxml` and plain
    `.xml` with a true first root of `score-partwise`/`score-timewise` are accepted; `.mxl` is an
    honest unsupported status. Caps: 16 MB, 24 selected measures, 1,000,000 events, depth 128,
    64 distinct parts, 256-character text/attributes, 16 values per fact field and note tokens.
    Timewise part caps count distinct IDs, not each measure's repeated `<part>` element.
  - **The Brain advises and may be disagreed with; it has no tools.** Provider output can explain a
    mechanism and propose optional drills/tempo experiments, but policy rejects claimed hearing,
    verdicts, navigation, graph mutation, tempo control/state, paths, secrets, and direct UI
    control. Provider citations join only against the exact current embedded/retrieved allowlist;
    unsafe, uncited, or ungrounded output falls back offline. A visible grounding receipt exposes
    piece/Region/mm., MusicXML status, rep count, book hits, sharing, and warnings per answer.
  - **Compactness uses native zoom plus layout escape hatches.** `interface_scale` is typed 75–125
    (default 90) and calls Tauri WebView zoom after settings load/save. Native minimum is 720×520.
    Brain is a mounted overlay drawer, not a route or reserved column; Score rail collapses to zero
    and overlays below 800 px; active Rep no longer creates a permanent 390–430 px gutter. Drawer
    collapse/Escape restores focus to its top-bar trigger.
  - **Release Spotlight registration is asynchronous.** Replacing/registering a sealed app can
    make an immediate `mdfind` return none even though the bundle is valid and appears moments
    later. The release gate now calls `mdimport` and polls 20×250 ms before failing; the full
    v1.3.0 gate was rerun and passed. Pre-release backup: `~/Library/Application Support/
com.christian.codakiller/backups/(C) pre-v1.3.0-2026-07-13.db`; schema 7 and counts 5/24/21/
    169/9/9 plus tutorial 1/11/13 were preserved.

- **P6 workflow / v1.2.0 actionable Score and tutorial chapters (2026-07-13):**
  - **A Region's title and notes are different data.** `region.name` is the concise visible header;
    `region.notes` is longer practice guidance. Score and Details edit the same row. Score renders
    Regions in measure order as one-open-at-a-time accordions with local Practice/Edit/Score marks/
    Tutorial tabs; the Region-linked block form does not ask for another copy of its label.
  - **Nullable patch fields need custom serde.** Rust `Option<Option<T>>` with derived
    `Deserialize` collapses both an absent JSON key and explicit `null` to outer `None`. The shared
    `deserialize_nullable_patch` helper makes absent → unchanged and explicit `null` → clear.
    Apply it to every nullable patch seam, not just Region notes: score anchors/color, tutorial
    notes/duration, block optional values, rep notes, Goals, Daily Work links, and piece fields.
  - **Tutorial media stays a file; the database stores a graph.** Schema 7 normalizes
    `tutorial_video` → reusable `tutorial_chapter` → many-to-many `tutorial_clip` Region links.
    This avoids copying a 111 MB video into SQLite and lets overlapping Regions share one chapter.
    A shared chapter edit is explicitly global and transactional; unlink is Region-local.
  - **Tutorial paths use the same distrust boundary as scores.** Scanning canonicalizes regular,
    non-symlink `.mp4/.mov/.m4v/.webm` files under `<piece>/tutorials` and rejects escape. Tauri's
    static asset scope stays empty; the parent directory is authorized dynamically only after a
    validated DB path is loaded. Finder reveal accepts a video ID and executes `open -R` with an
    argument, never a caller-controlled shell/path string.
  - **Region graph mutations include tutorial ownership.** Merge transfers and deduplicates clip
    links. Delete removes Region links and orphan chapters. Shared chapter update and link mutation
    are one transaction; injected failures prove rollback. A stale/renamed media path is not
    recoverable by wishful Rescan, so the player exposes a confirmed **Forget broken video** action
    that removes the DB graph but never the source file.
  - **Score density is a workflow feature.** The 25–200% slider plus Fit page, Fit width, 2-page,
    and Hide sections controls are explicit state, not CSS-only tricks. Unsaved mark edits block a
    section switch; saved marks are clickable. Details uses the same measure ordering.
  - **Scherzo source facts.** `/Users/c3/Desktop/scherzo tut.mp4` is H.264/AAC 1280×720/25 fps,
    2397.019 s, 111,336,990 bytes, SHA-256
    `b83c5a2e1c100caa5f0172ad5d6442fa541b64a98cfe6b76330da04bff2ff8a1`. It has no embedded
    chapters/title/source. Twenty title-card sections were identified; 11 stored chapters + 13
    links cover all 12 live Scherzo Regions. The presenter says Paul only; do not invent a surname.
  - **Release/data facts.** Pre-release backup is
    `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.2.0-2026-07-13.db`.
    Installed launch migrated schema 6→7 with integrity/FKs clean and preserved 5 pieces, 24
    Regions, 20 blocks, 165 reps, 9 Goals, and 9 Daily Work rows; tutorial graph is 1/11/13.

- **P6 coherence / v1.1.0 unified editing and navigation (2026-07-13):**
  - **Region is the canonical Tricky Section record.** Intake hard spots are converted into Regions
    once and deduplicated; Score, Details, history, practice forms, Brain context, PDF marks, and
    Calendar links all use the same Region ID. The legacy intake JSON is retained only as historical
    source data and is no longer presented as a second editable truth.
  - **Score-started practice uses explicit ownership.** Opening a practice block from a selected
    Tricky Section sends its Region ID, so later edits to the block's measure range do not silently
    disconnect it. General/voice-created blocks still use the deterministic smallest-containing-
    Region rule.
  - **PDF annotations are persistent, edition-specific overlays, not destructive PDF rewrites.** A
    Region may own box, highlight, and text-note marks; existing marks can be moved, resized,
    retyped, recolored through the Region, or deleted. The source PDF bytes stay immutable because
    rewriting them would invalidate the fingerprint and risk Christian's score file.
  - **Region graph mutations are transaction-safe.** Split is one backend transaction and clears
    geometry on both resulting Regions because division is ambiguous. Delete preserves rep blocks
    and Calendar work while nulling their Region link; merge reassigns both. Goal deletion explicitly
    cascades its linked Calendar rows after confirmation. Injected-failure and FK tests cover these
    promises.
  - **Calendar text has one owner.** Goal names are read by join, so renaming a Big Goal updates its
    Calendar display; a Daily Work title remains a deliberately separate exact work step. Big Goals
    with target dates render as milestones even when no work card exists.
  - **Async navigation rejects stale responses.** Direct constellation selection fetches and selects
    the requested piece, and both piece and score loaders use request generations so slower earlier
    responses cannot replace the latest selection.
  - **Release/data facts.** Schema stays v6. Before release, the live database was copied to
    `~/Library/Application Support/com.christian.codakiller/backups/(C) pre-v1.1.0-2026-07-13.db`.
    After installed-app launch it passed integrity/FKs with 5 pieces, 24 Regions, 20 blocks, 165 reps,
    9 Goals, and 9 Daily Work rows.

- **P6 patch / v1.0.2 scanned-PDF paint repair (2026-07-13):**
  - **v1.0.1 fixed startup but its acceptance gate was incomplete.** Page count and a fulfilled
    `render()` promise do not prove that a PDF page painted visible pixels. The native smoke used
    Scherzo page 1, a vector cover; Christian's real score pages are scanned images. Inspection
    found CCITT pages in Beethoven/Griffes, JBIG2 pages in the Scherzo, and JPEG + ICC content in
    Prokofiev. Those image paths require PDF.js's version-matched external runtime assets.
  - **All decoder inputs are now packaged and explicitly addressed.** The exact `pdfjs-dist`
    6.1.200 `wasm/`, `cmaps/`, `standard_fonts/`, and `iccs/` trees are vendored byte-for-byte
    under `public/pdfjs/`. `getDocument()` receives same-origin URLs for every tree, enables WASM
    and worker-side fetching, and disables WebKit's less-reliable OffscreenCanvas/ImageDecoder
    paths. The restrictive CSP adds only same-origin fetches and WebAssembly compilation
    (`'wasm-unsafe-eval'`), not general `'unsafe-eval'`.
  - **The release gate now tests painted pixels from real scores.** An isolated packaged WKWebView
    used the production adapter, native Tauri byte IPC, custom app protocol, and bundled assets.
    Scherzo page 2 (JBIG2) painted 1,971 sampled ink pixels; Prokofiev page 1 (JPEG/ICC) painted
    10,726; Beethoven page 3 (CCITT) painted 2,078. All three pages were visibly inspected. The
    temporary diagnostic UI/data override was removed. Schema remains v6 and Christian's database
    was never used by that diagnostic run.

- **P6 patch / v1.0.1 PDF viewer repair (2026-07-13):**
  - **The hang was the renderer bootstrap, not the score file or SQLite.** On this Mac's
    macOS 15 WKWebView, PDF.js 6's modern display build waited indefinitely for an ES-module
    worker launched from Tauri's custom app protocol. The real Scherzo file itself is a valid
    25-page PDF. CodaKiller now imports PDF.js's matching `legacy` display + worker modules;
    loading the worker module in-process registers `WorkerMessageHandler`, so PDF.js uses its
    loopback worker and no custom-protocol worker handshake can strand the UI.
  - **PDF loading is now bounded and cross-realm safe.** Both the native byte read and renderer
    startup have 30-second deadlines with a visible retry action. Bytes are copied with
    `new Uint8Array(bytes).slice()` rather than `instanceof ArrayBuffer`, which is unreliable
    across WKWebView/Tauri JS realms. Timed-out/failed loading tasks are destroyed, including a
    task created after a dynamic-import deadline.
  - **Proof used the real native path without touching Christian's data.** A temporary isolated
    app-data/Pieces fixture opened Practice → Scherzo → Score in the installed WKWebView and
    rendered page 1 of 25 at 1664 × 2314. The temporary instrumentation was removed. Regression
    tests cover a never-resolving byte read and an actual minimal PDF parsed through the legacy
    loopback worker. Schema remains v6; there is no user-data migration.

- **P6 / v1.0.0 finish (2026-07-12):**
  - **Schema v6 backfills history without inventing it.** `session_event_backfill` is the
    one-row-per-legacy-event ledger. The v5→v6 migration maps only typed `rep` and `rep_open`
    rows whose canonical ownership can be proven, preserving the exact timestamp, session,
    piece, kind, and payload. Unsupported or orphaned rows are ledgered with a skip reason;
    the entire migration, including `PRAGMA user_version`, is one transaction. A fresh copy
    of the real v0.6 database preserved 5 pieces / 24 Regions / 20 blocks / 165 reps / 4 Goals,
    ledgered all 249 source rows, mapped 190, explicitly skipped 59, reached 193 total canonical
    events, passed integrity/FKs, and added zero rows on a second open.
    New block-open and rep writes go further: the authoritative `rep_block`/`rep` row, live
    `session_event`, canonical `event`, reconciliation ledger, and any simultaneous tempo step
    share one SQLite transaction. Injected ledger-failure tests prove every source/history row
    rolls back together, and in-memory Rep state changes only after commit.
  - **The Practice Universe visualizes only defensible signals.** Star radius is focused time;
    continuity is distinct active days in an inclusive 28-local-day window; planets are Regions
    with recorded work; halos require work on 2+ distinct dates. Self-reported verdict quality
    changes brightness only inside a deliberately narrow 0.92–1.00 band. The same values and
    definitions are rendered as visible text; admin Calendar/Goal/recovery events are excluded.
  - **Settings have a typed native boundary.** Theme, TTS/voice, Brain provider, wake word,
    metronome, ladder defaults, Calendar capacity, vault path, and verdict aliases are bounded
    before one atomic settings write. Verdict aliases are normalized, unique across verdicts,
    limited to 12 per group, and cannot steal built-in deterministic commands. React can read
    API-key configured/source status only. Key values are piped to `/usr/bin/security` through
    stdin and cleared from the UI immediately when save begins; they never enter SQLite.
  - **Reference buttons are explicit handoffs, not media integrations.** Spotify and YouTube
    origins are compiled in; the piece/composer query is UTF-8 percent-encoded and passed to
    `/usr/bin/open` as an argument. There is no arbitrary URL, shell interpolation, scraping,
    download, autoplay, or OAuth claim.
  - **The Mac release is one fail-fast script.** `npm run release:mac` checks version agreement,
    runs frontend/Rust/build/strict-clippy gates, builds the `.app`, installs and ad-hoc seals the
    canonical `/Applications/CodaKiller.app`, creates a staged drag-to-Applications DMG + SHA-256,
    cleans LaunchServices/build copies, and rejects duplicates. This machine has no Developer ID;
    the v1 artifact is local ad-hoc signed and is not notarized.

- **Foundation T8/T9/T18 (2026-07-12, Opus 4.8 takeover):**
  - **Export reads the canonical graph, not frozen event payloads (T8).**
    `sessions/export.rs::write_session_md` now enumerates a session's blocks from the
    durable `event` log's `rep_open` events (the ONLY session→piece→block linkage —
    blocks carry no `session_id`), taking piece_id/block_id from each event's payload,
    then renders every block from `block_history` + `reps_for_block` (current label /
    measures / tempo / verdict tallies). Rep COUNT and top-tempo are also derived
    canonically (a block belongs to exactly one open, so `reps_for_block` == that
    session's reps). Result: a block edited after its reps were logged exports with the
    edited values, and export survives a relaunch. Added a trailing **Label** column to
    the table (the old renderer emitted no label at all) — appended at the end so the
    existing `| 40–56 | 80→84 |` substring assertions still hold. Metro tally + time
    window still come from the live `session_event` feed (the durable log carries no
    `metro` rows) — a pragmatic mix, not worth a schema change.
  - **Metrics are pure functions over (events, graph); zero IO inside them (T9).**
    `metrics/mod.rs` — `focused_seconds`, `streak`, `best_tempo_reached`,
    `per_region_mastery`, `time_by_focus` take already-loaded slices. `progress_summary(
&Store, piece_id)` is the one impure assembler (loads via Store readers `blocks_meta`
    / `reps_for_piece`, then calls the pure fns). **`focused_seconds` gotcha:** the
    brief's "locked reference impl" (`.clamp(0, IDLE)` then `if g <= IDLE {g} else {0}`)
    is self-contradicting — the clamp makes a 600 s idle gap count as 120, but the brief's
    own test expects it to count as **0**. The TEST is authoritative, so the gap heuristic
    is `if (0..=120).contains(&g) { g } else { 0 }` (idle gaps contribute 0). No date crate
    (chrono absent, 8 GB ethos): timestamps parse via a hand-rolled Hinnant `days_from_civil`;
    `parse_ts_secs` also accepts a bare integer string so tests can pass epoch seconds directly.
  - **Tempo ladder decoupled from the metronome + gated on focus (T18).** `RepSnapshot`
    and `RepOpenArgs` gained `focus: String` / `use_metronome: bool` with **serde
    defaults** (`"tempo"` / `true`, via `default_focus`/`default_use_metronome` fns) so
    every existing caller and JS payload is unchanged. `insert_rep_block` persists both
    (so `resync_active_if` can reload them via the new `block_focus_metronome` reader —
    chose a dedicated reader over widening `BlockHistory`, to avoid touching that frontend
    contract). `check()` gates the ladder on `snap.focus == "tempo"` (a non-tempo block
    counts verdicts, never advances BPM) and, when it steps, ALWAYS updates `snap.bpm` and
    appends a durable `tempo_change` event regardless of the metronome. **The rep engine
    holds no metronome handle** — the actual retune lives in `voice_loop::act_rep`, now
    gated on `outcome.snap.use_metronome && running` (was `running` only). Test-helper
    note: the briefs' test snippets reference `out.snapshot` but `CheckOutcome`'s field is
    `.snap` — used `.snap` so it compiles.

- **Task 17/18 (rep engine + sessions + voice wiring):**
  - **Ladder math (`rep/ladder.rs`, pure).** `resolve_auto(start, target, planned,
variants)`: planned = Σ variant reps if variants present, else planned, else 30.
    `bpm_step` always 4. Rungs `K = ceil((target-start)/4)` (≥1); `clean_needed =
clamp(round(planned/K), 1, 5)`, EXCEPT no-target → fixed 3 (a ladder needs a
    ceiling to climb). `step()` returns `Some(new_bpm)` capped at target only when
    `cleans_at_step ≥ clean_needed` AND `bpm < target`; no target ⇒ always `None`.
  - **`check()` ordering is load-bearing:** the rep is recorded at the block's
    CURRENT (pre-step) bpm and the current variant lane (lane of rep `reps_done+1`);
    THEN reps_done increments; only a `clean` advances `cleans_at_step` and can step;
    a step sets bpm and resets `cleans_at_step`. `snapshot.variant` tracks the
    UPCOMING rep's lane. `say` composed once in the engine (single source for voice +
    UI): block-done wins over step wins over plain; variant change appends "{Name}
    next." Block-done = `reps_done ≥ planned_reps`.
  - **`open` rejects a double-open** (`Err("close the current block first")`) rather
    than auto-abandoning — voice safety (a mis-heard open must not nuke a live block).
  - **Session ↔ block linkage lives ONLY in the event log** (rep_block has no
    session_id in the schema), so `export::write_session_md` reconstructs everything
    from `rep_open`/`rep`/`rep_close`/`metro` events. `rep_open` logs the whole
    RepSnapshot as its payload so export has piece_id/title/measures/start_bpm without
    extra queries; the piece folder is resolved via `get_piece(piece_id).folder_path`.
    Append-only: create with a one-line header, never edit. Tempdir-only in tests.
  - **RFC3339 at the boundary, native in SQLite.** `sqlite_ts_to_rfc3339` (space→T,
    append Z, idempotent) is applied in `SessionService::current()` and the
    `session://event` emit; the store keeps `datetime('now')` native. `BlockHistory`
    was reshaped to the frozen wire contract (`block_id` not `id`, drop `piece_id`,
    add `bpm` = latest rep bpm via correlated subquery, else `start_bpm`).
  - **Voice note capture is intentionally eager in rep mode:** a leading
    fail/flawed token (`no`/`nope`/`again`/`sloppy`/…) + a ≤12-word trailing clause
    becomes `RepCheck(Fail|Flawed, Some(note))`. So while a block is open, "no thanks"
    to someone in the room WOULD log a failed rep with note "thanks". This is the
    brief's designed behavior (you're actively practicing); the firewall battery for
    rep mode therefore only covers utterances that do NOT lead with a verdict word.
    A >12-word trailing clause reject the whole utterance (ambient ramble).
  - **RepOpen firewall (hardened after adversarial review):** beyond the brief's
    "measures + range", RepOpen requires (a) a rep-open cue (`tracker`/`rep`/`block`)
    AND (b) a command-SHAPE gate — every word must be rep-open vocabulary or a number
    (mirrors `is_explicit_metro_stop`). This matters because the app is ALL about
    measures: "the block measures 40 to 56 are hard" / "that rep in measures 12 to 16
    was rough" carry a cue + a range but the stray words ("are"/"hard"/"in"/"was")
    fall out of vocab, so ambient measure-talk never opens a block. Number parsing
    keeps a bare digit literal (`120`) as its own run so adjacent `target 120 twenty
reps` splits cleanly (a literal is never merged with a following number-word into
    an unparseable `"120 twenty"`).
  - **Every new spoken ack goes through `self.speaker.say` (gate-closing)** — reps,
    open/status/close, session-end, "Pick a piece first." — preserving the 2.5 s
    `t.at`-keyed dedup safety invariant (no silent acks). The metronome follows a
    ladder step via `set_bpm_only` ONLY when running; when stopped, the engine has
    already persisted the new block bpm and the step is still spoken.
  - **App-exit export hook** on `RunEvent::ExitRequested` calls `end_and_export`
    (best-effort: only reads the event log + appends a small markdown file; a second
    call after `session_end` is a no-op because `current_id()` is then `None`).

- **Task 11 (tts:: — Gemini TTS + `say` fallback + half-duplex gate):**
  - **VERIFIED Gemini TTS API (2026-07, docs win over brief's generateContent guess).**
    Sources: WebFetch of https://ai.google.dev/gemini-api/docs/speech-generation AND
    context7 `/websites/ai_google_dev_gemini-api` (independent) — both agree. The current
    API is the NEW `interactions` endpoint, NOT the older `generateContent`+`inlineData`
    shape the brief guessed:
    - **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/interactions`
    - **Auth header:** `x-goog-api-key: <key>` (never logged)
    - **Model:** `gemini-3.1-flash-tts-preview` (single-speaker TTS; overridable via
      `tts.model` setting)
    - **Request body:** `{ "model": <m>, "input": <text>, "response_format": {"type":
"audio"}, "generation_config": {"speech_config": [{"voice": <voice>}]} }`
    - **Voice:** default `Kore` (overridable via `tts.voice`). 30 prebuilt voices
      (Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, ...).
    - **Response (VERIFIED against the LIVE API — the docs' summarized
      `output_audio.data` field is WRONG / hallucinated):** audio lives at
      `steps[].content[].{mime_type,data}`, `mime_type = "audio/l16"`, `data =
base64 s16le`. We concatenate every audio chunk across all steps, decode, and
      read `rate=NNNN` from the mime_type if present (else default 24 kHz). The live
      probe returned `{"id":..,"status":"completed","steps":[{"content":[{"mime_type":
"audio/l16","data":"<b64>"}]}],...}`. (The classic `generateContent` endpoint
      also works and returns `candidates[0].content.parts[0].inlineData.data` with
      `mimeType: audio/L16;codec=pcm;rate=24000` — kept `interactions` as the current
      documented endpoint but fixed the parser to the real shape.)
    - **Audio format:** raw headerless PCM, mono, **24000 Hz, s16le** (channels=1,
      rate=24000, sample_width=2 — the Python sample writes the base64-decoded bytes
      straight into a wave file via `writeframes`). Decode: base64 → i16 LE → f32
      (`/32768`) → `Pcm{rate:24000, mono_f32}`; `EngineHandle::enqueue_pcm` resamples
      24k→stream rate off the audio thread.
  - **`say` fallback (verified on THIS Mac):** `say -o x.wav --data-format=LEI16@22050
<text>` writes a standard 16-bit PCM mono WAVE (fmt tag 1, 1 ch, 22050 Hz, with a
    leading JUNK chunk hound skips fine). hound reads it as i16 → f32. AIFF path rejected
    (hound cannot read AIFF-C). Tempfile in the OS temp dir, removed after decode.
  - **Deps (zero-new-compilation on 8GB):** `reqwest` 0.13, `base64` 0.22 are BOTH already
    in `Cargo.lock` transitively via tauri. `reqwest` was pulled with `default-features=
false` (no TLS backend), so we add it directly with `default-features=false, features=
["blocking","json","native-tls"]` — native-tls on macOS = Security.framework (already
    linked), NO openssl/ring, the lean choice per brief. Pinned to `0.13` to reuse the
    exact locked 0.13.4 (no second reqwest copy). `base64 = "0.22"` reuses 0.22.1.
  - **Speaker = single owning TTS thread (enforces `enqueue_pcm` single-producer).**
    `Speaker::speak(text)` sends the text over an mpsc channel to ONE dedicated worker
    thread which is the sole caller of `enqueue_pcm` — the audio engine's single-producer
    contract is thus structurally guaranteed (metronome never enqueues PCM; it only sets
    pattern/gain and reads `pcm_done`). Requests are processed strictly serially, so two
    concurrent `speak()` calls never overlap (double-speak serialization) and never
    interleave gate cycles.
  - **Half-duplex gate ordering (the safety invariant — app NEVER hears itself):** per
    utterance the worker does, in order: (1) `synth(text)` with the gate still OPEN — a
    synth failure/timeout returns early and NEVER closes the gate (mic stays live while we
    "think"); (2) `gate.set_gate(false)` — close BEFORE any sample is enqueued; (3) chunk
    the PCM and `enqueue_pcm` each chunk with backpressure retry (QueueFull/CapExceeded →
    short sleep + retry the SAME chunk, never drop); (4) poll `pcm_done()` until true
    (drain — reserve-first semantics from Task 5 guarantee it stays false until every
    sample has passed the render callback); (5) sleep `reopen_delay` (300 ms); (6)
    `gate.set_gate(true)`. Steps 4–6 run in an ` always-reopen` guard so any error after
    step 2 still drains+reopens (the gate can never get stuck closed).
  - **Why 300 ms reopen margin:** `pcm_done()==true` means all samples left the cpal
    render callback, but the physical tail is still in flight — CoreAudio output buffer +
    DAC + speaker→air→mic acoustic path + the STT engine's own input buffering. 300 ms
    comfortably covers device output latency (~tens of ms) plus a short room-acoustic
    tail, so `hear` never captures the fading end of our own TTS. Configurable via
    `SpeakerConfig.reopen_delay` for tests.
  - **Provider selection:** `tts.provider` setting overrides ("gemini" | "say"). Else:
    Gemini if a key is present (`keys::gemini_key`) AND a network probe succeeds, else
    `say`. Key resolution: Keychain `security find-generic-password -s codakiller -a
gemini -w` first, then `GEMINI_API_KEY` env. Key is never logged.
  - **do_set Busy-arm fix (carried from Task 7 review):** metronome `do_set`'s
    `StartFailure::Busy` arm mutated `inner.state.sound` before the refused restart but
    did not roll it back (unlike `do_start`'s Busy arm), so the emitted state lied
    (claimed the new sound while the engine/store kept the old). Fixed by capturing the
    prior sound and reverting it in that arm; a new seam test asserts `state.sound`
    unchanged after a concurrent-producer Busy refusal.

- **Task 10 (STT supervisor `stt::SttSupervisor`):** New module `src-tauri/src/stt/`
  (`mod.rs` docs + `supervisor.rs`). `SttSupervisor::spawn(binary, on_event)` launches
  `hear` and returns an `SttHandle{set_gate(open), shutdown()}`. Design:
  - **`on_event` takes `SttEvent`, not just `Transcript`** — a small, necessary widening
    of the brief's `Fn(Transcript)` signature: the brief _itself_ requires a `stt://down`
    lifecycle event that a Transcript-only sink literally cannot carry. `SttEvent` =
    `Transcript(Transcript)` | `Down(DownReason::{DictationDisabled,RestartStorm})`. One
    sink, both streams. Task 13 filters `is_final` transcripts and reacts to `Down`.
  - **SIGTERM the process GROUP, never SIGINT** (Task 9: `hear` ignores SIGINT, exits
    clean on SIGTERM ~22ms). Child is placed in its own process group via
    `libc::setpgid(0,0)` in `Command::pre_exec` (pgid == child pid); `shutdown()` calls
    `libc::killpg(pgid, SIGTERM)`. Group-kill catches any grandchildren (verified by the
    `shutdown_terminates_process_group` test forking a `sleep` grandchild). Reaping is
    `Child::wait()` on the manager thread → no zombies. **New dep `libc` 0.2** — justified
    in Cargo.toml: `std::process` can only SIGKILL a single child, not SIGTERM a group;
    `libc` is already transitive (cpal/rusqlite) so zero new compilation.
  - **stdbuf decision (Task 10 fix round 1): stdbuf is OPTIONAL, not a hard dep.**
    Production config still _requests_ `stdbuf -oL <hear>` as insurance against
    block-buffered stdout when piped (Task 9 flagged this UNCONFIRMED), but `stdbuf` is a
    Homebrew (coreutils) binary absent from stock macOS and the spec bans hardcoded Homebrew
    deps. So the supervisor probes ONCE at manager start (`stdbuf --version` succeeds) and,
    if absent, degrades to a direct `hear` spawn and logs it; an ENOENT at spawn time also
    falls back. **A missing `stdbuf` never trips RestartStorm.** When used, `stdbuf` execs
    the target so the child pid _is_ `hear` and SIGTERM/pgid semantics are unaffected.
    Real-binary smoke (silent, 3s): 0 bytes stdout/stderr (no Code=201 → Dictation still
    enabled; no garbage on silence), SIGTERM-to-group killed it fast. Escalation path if
    Task 13's live test shows block-buffering WITHOUT stdbuf: a pty via stock
    `/usr/bin/script` (documented, NOT built now).
  - **is_final framing policy (defensive, correct for both plausible framings):** every
    non-empty line → immediate partial (`is_final=false`); the _previous_ pending utterance
    is finalized (`is_final=true`) the moment a line arrives that is NOT a prefix-extension
    of it (a distinct new utterance — what `-m` single-line mode is expected to emit, so
    back-to-back commands never merge/drop); a prefix-growth supersedes silently
    (progressive partials, as non-`-m` might stream); and a `settle` gap (default 600ms of
    quiet) finalizes whatever is pending. This _guarantees a final always eventually fires_
    (Task 13 routes only finals) for either framing, with no command loss. TASK 13 TODO:
    once live framing is known, if `-m` lines are already final you may drop the settle
    latency by treating each line as final directly.
  - **Gate = `AtomicBool`, checked with no lock in the reader hot path** (Acquire load per
    line; closed ⇒ line DROPPED at the reader, not buffered). Re-checked at emit time in
    the settler too, so a 600ms settle-timer final can't leak into a closed-gate window
    (half-duplex contract Task 11 depends on). Set via `set_gate(open)` (Release store).
  - **Auto-restart:** on child death, respawn after `backoff` (1s). Restart timestamps are
    kept in a sliding `restart_window` (60s); the (max+1)-th death within the window
    (`max_restarts`=5) emits `Down(RestartStorm)` and stops instead of hot-looping. A
    spawn _failure_ (bad binary) counts as a death so it too trips the cap. A
    `kLSRErrorDomain Code=201` on stderr is classified as `Down(DictationDisabled)` and
    stops immediately (no restart — it needs a System Settings change, not a respawn).
  - **Threads & teardown:** one manager thread (spawn/restart loop, owns `Child`), a
    per-child stdout reader thread and stderr-buffer thread (both end on EOF when the child
    dies, joined before the next iteration), and one long-lived settler thread (framing
    state survives respawns; disconnects & drains when the manager drops its `line_tx`).
    `shutdown()` sets a flag (so no respawn), SIGTERMs the current group, wakes the manager
    if mid-backoff via a stop channel, and joins the manager (which joins the rest).
    Idempotent (guarded by an `active` flag) and also runs on `Drop` as a backstop
    (mirrors `BoostGuard`). A publish-then-recheck of the shutdown flag after setting the
    child pgid closes the spawn/shutdown race (no wait()-forever hang).
  - **Testability seams:** `SttConfig{binary,args,env,use_stdbuf,settle,backoff,
max_restarts,restart_window}` (`SttConfig::hear()` = production). Tests use
    `spawn_with_config` against `tests/fixtures/fake_hear.sh` (POSIX-sh, env-driven:
    scripted lines/sleeps, spawn-count file, emit-exit for respawn, config-error for 201,
    grandchild fork for group-kill) with compressed timings. Coverage: 8 integration tests
    (a–f from the brief + gate-reopen + idempotent shutdown) & 5 lib unit tests (201
    classification, storm cap + window pruning, framing policy, emit-gate). RED verified by
    mutation (removing BOTH gate checks makes the closed-gate test fail with leaked lines).

- **Task 7 (metronome commands + boost):** Commands `metro_start/metro_stop/metro_set/
metro_state` on a managed `Metronome { sounds, boost_level, Mutex<Inner{state,handle,
guard}> }`. The mutex guards ONLY the control path (command handlers), never the audio
  callback — the engine's lock-free discipline is intact. Change-flow into a running
  engine: **bpm/beats/subdivision/accent** → `EngineHandle::set_pattern` (existing
  lock-free pattern queue, adopted at next beat); **gain** → new `EngineHandle::
set_click_gain`, a single `AtomicU32` (f32 bits, Relaxed) the callback reads each
  buffer — this _extends_ the existing atomics design (no Mutex bolted onto the callback,
  no restart, smooth for slider drags); **sound** → engine RESTART, because the click
  samples are `Arc<Vec<f32>>` owned by the callback and swapping them cross-thread would
  force a _free_ on the audio thread (forbidden by the RT contract). Sound changes are
  rare + user-initiated; the restart gap is one buffer. `EngineConfig` gained a
  `click_gain` field (manual `Default`=1.0) so a fresh engine starts at the right level
  with no unity-gain blip.
- **Boost / crash-safe volume restore:** `sysvol::{parse_output_volume,current,set}` via
  `osascript` (`get volume settings` / `set volume output volume N`); every osascript
  call is best-effort (log, never panic — a broken osascript must not strand the Mac at
  boost volume). `BoostGuard::engage(target)` saves current vol, raises to target,
  restores on `Drop` AND explicit `release` (idempotent — restore runs exactly once).
  Restore fires on FOUR in-process paths: `metro_stop`, window `CloseRequested`
  (`on_window_event` → `Metronome::shutdown`), app quit `RunEvent::ExitRequested`
  (macOS Cmd-Q — which does NOT fire a per-window close, and whose `process::exit`
  would skip `Drop`; caught via `.build(...).run(|_, event| ...)`), and `Drop`
  (backstop). Honest limitation:
  a hard `kill -9` cannot run `Drop`, so a SIGKILL'd process is the one path we cannot
  cover — documented in `sysvol.rs`. `BoostGuard` is unit-tested with injected
  getter/setter closures (no real system volume touched).
- **Click-assets dual path (dev + bundled) — VERIFIED BOTH WAYS.** `resolve_clicks_dir`
  tries `app.path().resolve("assets/clicks", BaseDirectory::Resource)` first (bundled
  `.app`), falling back to `CARGO_MANIFEST_DIR/assets/clicks` (dev, where Tauri does NOT
  stage resources). Added `bundle.resources: ["assets/clicks/*.wav"]` to tauri.conf.json.
  Verified: `npm run tauri build -- --bundles app` stages the six WAVs at
  `CodaKiller.app/Contents/Resources/assets/clicks/*.wav` — exactly where the Resource
  base dir resolves. Dev path is exercised by the `load_clicks` unit test (reads from the
  manifest `assets/clicks`). A clicks-load failure is non-fatal (metronome runs silent).
- **Persisted settings:** `metronome.{bpm,sound,gain,boost,beats_per_bar,subdivision}`
  (+ optional `metronome.boost_level`, default 85). Loaded on startup via
  `metronome::load_state`, written through on every `metro_set`.
- **Deferred to Task 8:** interactive command invocation from the running app
  (`metro://state` event round-trip, live audio through the commands). Static coverage
  is strong (state-machine + parser + guard unit tests, clean build, bundle staging
  verified), but driving the JS console needs the frontend glue that Task 8 builds.

- **Task 7 fix round 1 — async commands, restart rollback, TTS-drop guard, layer tests:**
  - **Blocking work off the main thread.** `metro_start/stop/set` are now `async fn` that
    do all blocking work (boost `osascript` spawns, audio-thread join + device reopen on
    engine (re)start, the 6-key persist) inside `tauri::async_runtime::spawn_blocking`.
    `Metronome` and `Store` are managed behind `Arc` so a `'static` clone can move into
    the closure. The control mutex is taken **only inside** the blocking closure, never
    across an `.await` (clippy `await_holding_lock` clean). `metro_state` stays sync (a
    brief mutex read). Command logic lives in pure `Metronome::do_start/do_stop/do_set`
    methods (no `AppHandle`/emit), which is what the new tests drive directly.
  - **TTS-drop contract, enforced not documented.** A sound change restarts the engine,
    which allocates fresh PCM queues and would silently discard buffered-but-unplayed TTS
    even though `enqueue_pcm` returned `Ok`. So `start_engine` now refuses with
    `StartFailure::Busy("audio busy: speech playing — retry after")` when an existing
    handle reports `!pcm_done()`, **without touching the running engine or state**. The
    TTS producer lands in Task 11; this makes the contract mechanical now. `metro_set`
    also pre-checks the guard before mutating anything so a busy refusal is a clean no-op.
  - **Restart-failure rollback.** `start_engine` returns a typed `StartFailure`: `Busy`
    (engine untouched, still running → keep `running=true`) vs `Dead` (old engine stopped,
    new one failed → force `running=false`). `do_start` restores the pre-call state and
    releases only the boost _this call_ engaged; `do_set`'s sound-change `Dead` path forces
    `running=false` and persists the rolled-back state so store + emit stay consistent.
    State can never claim `running` with a dead engine.
  - **Injectable engine-start seam** (mirrors sysvol's `engage_with`): `Metronome` holds
    `engine_start: Box<dyn Fn(EngineConfig)->Result<EngineHandle,String>>` and
    `boost_engage: Box<dyn Fn(u8)->BoostGuard>` (real `Engine::start`/`BoostGuard::engage`
    in `new`; mock closures via `with_seams` in tests). A `#[cfg(test)]`
    `EngineHandle::test_handle(sample_rate, pcm_pending)` builds a device-free handle whose
    `pcm_done()` reflects `pcm_pending`. Tests: (a) start failure → running false + boost
    released; (b) sound change refused while a fake handle reports PCM not done; (c) clean
    restart transitions correctly + persists; plus unknown-sound rejection + start success.
  - **Minors:** `metro_set` rejects unknown sound names (`unknown metronome sound '…'`)
    validated against the loaded click set (skipped when no clicks loaded → silent mode);
    `MAX_SUBDIVISION`/`MIN_BPM`/`MAX_BPM` are now `pub` in `audio::clock` and re-exported —
    `metronome.rs` uses those instead of duplicating the literals; `persist` writes all six
    keys in one `Store::set_settings` transaction; `load_state` logs (not swallows) parse
    failures.

- **Task 5 fix round 1 — `crossbeam-queue` dependency APPROVED by controller.** The
  lock-free `ArrayQueue` is the mechanism the real-time callback uses to receive
  pattern changes, TTS PCM chunks, and (new this round) recycled empty `Vec`s
  without ever locking, allocating, or freeing on the audio thread. A hand-rolled
  SPSC ring would duplicate a small, well-audited, widely-used primitive; the
  controller approved keeping `crossbeam-queue 0.3` rather than reinventing it.

- **Task 5 (audio engine):** cpal callback owns `ClickClock`+`Mixer`; cross-thread
  input is lock-free via `crossbeam_queue::ArrayQueue` (pattern changes + resampled
  PCM chunks) — no mutex in the callback. TTS is resampled at enqueue time
  (linear interp), never in the callback. `pcm_done()` uses an `AtomicUsize` counted
  at enqueue / decremented at output, so it is never false-done while samples are
  buffered anywhere (Task 11 half-duplex gate depends on this). Drift uses an f64
  fractional accumulator (`samples_per_beat`, remainder carried; floored only for the
  in-buffer offset) — verified 0-frame error over a 1-hour sim. `bpm` is clamped to a
  finite `[1,1000]` before use so a garbage tempo can't stall the RT loop (a fresh-
  context verifier found `+inf`/negative bpm would infinite-loop the callback; fixed +
  regression-tested). Device negotiated 48 kHz f32 on this Mac (engine is sample-rate-
  agnostic). Deps added: `cpal 0.18`, `hound 3.5`, `crossbeam-queue 0.3`.

- Installed Rust via `brew install rust` (not rustup) per the brief. This installed
  rust 1.96.1 as a Homebrew-managed toolchain (not rustup-managed). `cargo` and `rustc`
  are on PATH via Homebrew's shim (`/opt/homebrew/bin`). No `rustup` toolchain link was
  set up since the brief only required `cargo --version` to work and satisfy the
  ≥1.77 requirement — it does (1.96.1).
- No deviation needed for the `hear` archive layout — the brief's `find ... -exec cp`
  command worked verbatim. Actual archive layout (documented below) matched closely
  enough that the `find -name hear -type f -perm +111` pattern located the binary
  without modification.

## Gotchas

- **Task 2 (Tauri v2 scaffold):** `npm create tauri-app@latest` does not accept
  `--yes`/`--template`/`--manager` flags the way the brief guessed in isolation, but
  it did accept them combined: the real invocation used was
  `npm create tauri-app@latest codakiller-scaffold -- --template react-ts --manager npm --identifier com.christian.codakiller --yes`.
  The CLI also exposes `--identifier` directly, so the correct `com.christian.codakiller`
  identifier was set at scaffold time (no post-hoc edit needed for that field).
- create-tauri-app requires an empty target dir, so it was scaffolded into
  `$SCRATCHPAD/codakiller-scaffold` then merged in with
  `rsync -a --ignore-existing --exclude .git`. This left `.gitignore` and `NOTES.md`
  untouched (already existed) — new files only (`git status` showed only new,
  untracked scaffold paths). The scaffold's `.gitignore` entries (logs, `.vscode/*`,
  `.idea`, etc.) were hand-merged into ours; ours already had `node_modules/`,
  `target/`, `dist/`, `.DS_Store`, `*.local`, `.superpowers/` covered.
- Tauri v2 **does** have a `bundle > macOS > infoPlist` config key (a path that merges
  with the default Info.plist) per official docs; this project instead uses the equally-
  documented same-directory `Info.plist` auto-merge approach. Verified by inspecting
  the built `.app`'s `Contents/Info.plist` with `plutil -p`: both
  `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` were
  present with the exact strings from `src-tauri/Info.plist`.
- `npm run tauri build` (all default bundle targets, which include `dmg`) intermittently
  failed on the DMG step (`bundle_dmg.sh` / `hdiutil` — likely a transient Finder/AppleScript
  race, common on first-run `create-dmg` invocations) but always produced the app bundle
  first (`Bundling CodaKiller.app` succeeds before `Bundling ...dmg` runs). One retry of
  the full build succeeded end-to-end and produced both the `.app` and the `.dmg`.
  However, the DMG bundler step **deletes/cleans the `.app` output dir** after packaging
  it into the DMG (`Cleaning .../CodaKiller.app`), so if you need `CodaKiller.app` to
  persist on disk, run `npm run tauri build -- --bundles app` to build only the macOS
  `.app` target and skip the DMG step entirely — this is what verification used.
- This is a CLT-only Mac (no full Xcode install) — `cargo build`, `npm run build`, and
  `npm run tauri build -- --bundles app` all succeeded without any Xcode-only tool
  being required; no CLT-specific build quirks were hit for the app bundle itself.

- The `hear-0.8.zip` release archive extracts to a subdirectory `hear-0.8/` containing
  three files: `hear` (the universal Mach-O binary), `hear.1` (man page), and
  `install.sh` (installer script). The brief's brief `find`/`cp` one-liner handled this
  fine since it searches recursively for a file literally named `hear`.
- `vendor/bin/hear` is a universal Mach-O binary (x86_64 + arm64), so it runs natively
  on this M2 Mac without translation.
- `./vendor/bin/hear --help` exits with code 0 and prints full usage text (not a
  non-zero "crash" exit as the task brief warned might happen) — no adaptation needed.
- No Tauri v2 / cargo-tauri CLI setup step was actually present in this brief's
  checklist (Steps 1-4 only cover rust install + hear vendoring); only `cargo`/`rustc`
  verification was required and completed.

## hear CLI facts

```
hear version 0.8 by Sveinbjorn Thordarson <sveinbjorn@sveinbjorn.org>

hear [-vhmsdpa] [-l lang] [-i file] [-x word] [-t seconds] [-n device_id]

Options:

    -s --supported           Print list of supported locales

    -l --locale              Specify speech recognition locale
    -i --input [file_path]   Specify audio file to process
    -d --device              Only use on-device speech recognition
    -m --mode                Enable single-line output mode (mic only)
    -p --punctuation         Add punctuation to speech recognition results (macOS 13+)
    -x --exit-word           Set exit word that causes program to quit
    -t --timeout             Set silence timeout (in seconds)
    -T --timestamps          Write timestamps as transcription occurs (file input only)
    -S --subtitle            Enable subtitle mode, producing .srt output (file input only)
    -a --audio-input-devices List available audio input devices
    -n --input-device-id     Specify ID of audio input device

    -h --help                Prints help
    -v --version              Prints program name and version

For further details, see 'man hear'.
```

(Captured via `./vendor/bin/hear --help 2>&1`, exit code 0.)

### Task 9 empirical spike — VERIFIED behavior (macOS 15.0, MacBook Air M2, 8GB)

Full command log + raw outputs: `.superpowers/sdd/task-9-report.md`.

**GO/NO-GO RECOMMENDATION: GO.** On-device recognition is accurate on clean audio,
CPU/RAM are trivial, control (SIGTERM) is clean, and non-speech audio is rejected (no
garbage). The remaining unknowns (real acoustic ambient-piano robustness; live
partial-vs-final streaming framing) could not be reproduced unattended because the
speaker→built-in-mic acoustic path is too attenuated (peak −34 dB at 100% volume) to
drive the recognizer — they are deferred to Task 13 live QA with a human speaking, NOT
hear defects. Nothing found triggers the whisper.cpp fallback.

**CRITICAL PREREQUISITE — Dictation must be enabled.** On a fresh machine Dictation was
OFF and _every_ recognition (even file input) failed instantly with
`Error Domain=kLSRErrorDomain Code=201 "Siri and Dictation are disabled"`. Enabling it
via `defaults write com.apple.assistant.support "Dictation Enabled" -bool true` made
recognition work immediately (this spike set it). **No model download** was needed for
en-US on-device — it worked with zero latency after the flag flipped. Tasks 10-13 must
treat Code 201 as an actionable "enable Dictation" setup error (document as a setup step
and/or detect the string and instruct the user); do not confuse it with a mic-permission
error.

**1. Continuous mic invocation.** `./vendor/bin/hear -d -l en-US -m` (add `-p` only if
you want punctuation — for command parsing you probably want it OFF so words aren't
returned as e.g. `stop.`). Flags: `-d` = on-device only (REQUIRED — offline + private),
`-l en-US` = locale, `-m` = single-line output mode (mic only). Omitting `-m` = default
multi-line mode. Framing detail (does non-`-m` stream evolving partials line-by-line vs
`-m` collapsing to one final line per utterance, and how utterance boundaries/newlines
are marked) needs live speech — **DEFERRED to Task 13**. Data point from FILE mode: the
whole file's transcript is emitted as ONE line, finals concatenated, no per-sentence
newline even across periods (`"metronome ninety six. done. stop. tempo one hundred
twenty."` → single line `Metronome 96 done stop tempo 120`).

**2. Silence behavior / max-duration.** With no `-t`, hear ran a full **67 s continuous
mic session through silence without exiting** — it keeps listening indefinitely. It did
NOT die at the ~60 s mark (Apple's historical 1-minute recognizer limit is handled
internally / not hit on the on-device path). `-t seconds` sets a silence timeout that
quits; leave it unset (or high) for always-on. (>5 min soak still worth a live check,
but the 60 s barrier is cleared.) In FILE mode, pure silence / non-speech instead errors
with `kAFAssistantErrorDomain Code=1110 "No speech detected"`.

**3. stdout buffering when piped.** File-mode output reaches a pipe fine (flushed on
exit). Live streaming line-buffering when piped is **UNCONFIRMED** (no live transcript
was produced to observe). If Tasks 10-13 find it block-buffers when piped, the workaround
is `stdbuf -oL ./vendor/bin/hear ...` (`stdbuf` is present) or a pty via `script`. FLAG
for Task 13.

**4. Signals.** `SIGTERM` → clean, instant exit (measured 0.022 s), process gone.
`SIGINT` (Ctrl-C) → **IGNORED, hear survives it** (verified twice). The supervisor MUST
kill/restart with SIGTERM, never SIGINT. SIGTERM flushes no pending transcript (fine).

**5. CPU / RSS (60 s continuous listening).** CPU held **0.2–0.7%** throughout; RSS
**~27 MB, stable** (grew 26.9 → 27.5 MB over 65 s, no leak). Negligible on 8 GB. Sampled
`ps -o rss,pcpu` every 3 s.

**6. Recognition quality — product-critical.**

- _Clean speech (file input, on-device):_ EXCELLENT. `"metronome ninety six. done.
stop. tempo one hundred twenty."` → `Metronome 96 done stop tempo 120`. Command words
  recognized; spoken numbers returned as digits (`ninety six`→`96`).
- _Non-speech / harmonic "music" (synthetic C-major arpeggio chords, 15 s file):_ →
  `kAFAssistantErrorDomain Code=1110 "No speech detected"` — **NO garbage transcript**
  (same result as a silence file). Encouraging that the on-device VAD/recognizer gates
  out instrumental content. CAVEAT: this was synthetic sine-chord audio, not a real
  recorded piano timbre with room noise — the real ambient-piano test still needs a
  live YouTube-clip run at the mic in **Task 13**.
- _Live mic recognition (human phrases + real ambient piano):_ NOT obtained. Verified
  the built-in mic captures real audio (ffmpeg avfoundation got a genuine −60 dB noise
  floor, not digital silence → mic + speech-recognition TCC effectively granted for the
  terminal session, no prompt hang), but speaker→mic loopback peaks only −34 dB even at
  100% volume — too faint to trigger ASR, and CPU stayed flat during playback confirming
  no speech was detected. This is an unattended-environment limit. **DEFERRED to Task 13**
  (the Tauri app also carries a different bundle id, so it will trigger its OWN mic +
  speech-recognition TCC prompts on first launch regardless).

**7. Locale / model.** `-s` lists 13 en locales incl `en-US`. en-US on-device required NO
model download (worked instantly once Dictation was enabled).

**Error-code catalogue for Tasks 10-13 to handle:**

- `kLSRErrorDomain Code=201 "Siri and Dictation are disabled"` → Dictation OFF; enable it.
- `kAFAssistantErrorDomain Code=1110 "No speech detected"` → silence/non-speech (file
  mode; mic mode keeps listening instead of erroring).

**Available audio input:** `1. MacBook Air Microphone (ID: BuiltInMicrophoneDevice)`
(via `-a`; pass to `-n` if selecting a specific device).

### Task 13 fix round 2 — LIVE mic framing VERIFIED (corrects the Task 9 `-m` guidance)

The Task 9 spike deferred live streaming framing; Task 13 obtained it with a human/`say`
voice at the mic. **Ground-truth findings on this Mac (macOS 15, M2):**

- **DO NOT pass `-m`.** `-m` ("single-line output mode") streams progressive hypotheses
  separated by `\r` + ANSI `ESC[2K` with **ZERO newlines**, so a line-based reader never
  completes a line and **no transcript is ever delivered** — the voice loop is DEAD with
  `-m`. Task 9's recommendation to use `-m` was wrong for a piped line reader; it is
  removed from `SttConfig::hear` (now just `-d -l en-US`). Raw capture:
  `scratchpad/hear-noline.txt` (without -m) vs the `-m` single-line stream.
- **Without `-m`: clean `\n`-framed lines, one progressive hypothesis per line.** e.g.
  `Natural\nMetronome\nMetronome 90\nMetronome 96\n`. Spoken numbers come back as digits
  ("ninety six" → `Metronome 96`). The settler collapses the prefix-growth chain and
  finalizes the last hypothesis on the 600 ms settle gap.
- **stdout line-buffers PROMPTLY even on a plain pipe (no `stdbuf`).** Empirically probed
  `hear -d -l en-US | while read` (NO stdbuf, NO `-m`): lines arrived in real time DURING
  the session (timestamps ~200 ms apart as the hypothesis grew), NOT withheld until exit.
  So `stdbuf` is **not required**. `use_stdbuf` is left `true` as harmless insurance
  (stdbuf is present here at `/opt/homebrew/bin/stdbuf` and execs `hear`, so pid/SIGTERM
  semantics are unchanged); the probe-and-degrade path already covers its absence.
- **The engine RE-SENDS the final hypothesis 0.5–2.3 s later** (measured: `Metronome 96`
  at t=370.942 and again 372.741 = 1.8 s; `Stop` at 375.342 and 376.943 = 1.6 s;
  `scratchpad/hear-timed.txt` shows `Done` re-sent at 5.441/5.939/7.838). Byte-identical to
  the original, indistinguishable from a fast human repeat → handled by the unified 2.5 s
  dedup in `voice_loop` (keyed on `Transcript::at`, sliding). See `voice_loop.rs` module docs.
- **ASR-isms:** "bump it up four" → `Bumped it up for` (past-tense verb + number homophone);
  handled by verb folding (`bumped`→`bump`) + number-slot homophone mapping (`for`→4,
  `to`/`too`→2) in `intent::route_delta`, gated on a confirmed command shape so the firewall
  is unweakened.
- **Zombie-`hear`-on-signal fix (found by Task 13 step 8).** A raw POSIX SIGTERM to the
  app (e.g. `kill <pid>`, a service manager stopping it, terminal SIGINT) terminates the
  Tauri process WITHOUT firing `CloseRequested`/`ExitRequested`, so `VoiceLoop::shutdown`
  never runs and the `hear` child — deliberately in its OWN process group — is orphaned to
  `launchd`, leaking a process that holds the mic (verified: after `kill <app>`, `hear`
  survived with PPID 1). Fixed with `stt::install_termination_handler()`: an
  async-signal-safe handler for SIGTERM/SIGINT/SIGHUP that reads a lock-free global mirror
  of the live `hear` pgid (`CURRENT_HEAR_PGID`, written by the manager on spawn/reap),
  `killpg`s it, then restores SIG_DFL and re-raises so the app dies normally. `kill -9`
  (uncatchable) is the one remaining path that can orphan `hear` — same limitation class as
  the boost-volume `Drop` caveat.
- **Observed minor framing artifact (documented, not fixed):** a non-prefix revision in the
  progressive chain (`Metronome 90` → `Metronome 96`, 213 ms apart, faster than the 600 ms
  settle) makes the settler finalize the intermediate `Metronome 90` as its own final before
  `Metronome 96`. The metronome briefly starts at 90 then corrects to 96 (final tempo is
  correct). This is the progressive-revision case, DISTINCT from re-sends (different text, so
  dedup does not and should not collapse it). Settle policy left as-is per the Task 13 brief
  ("prefer leaving equal-repeat two-finals since voice_loop now suppresses"); collapsing
  fast revisions safely would risk merging genuine back-to-back distinct commands, so it was
  judged out of scope for this fix.

- **Ship-smoke discoveries (v0.2.0, 2026-07-10, controller live-tested):**
  - **AppleEvent quit (`osascript 'quit app'`) does NOT deliver `RunEvent::ExitRequested`**
    (nor any POSIX signal) on this Tauri v2 / macOS 15 setup — the run-loop cleanup arm
    never fires on that path. Verified by direct stderr capture: no panic, no output, hear
    orphaned (held the mic until an eventual SIGPIPE), boosted volume stranded at 85, open
    session left unended. Fix: `libc::atexit` backstop (runs on every normal exit incl.
    NSApp terminate) that kills the hear process group (shared fn with the signal handler,
    async-signal-safe) + restores the pre-boost volume via a lock-free mirrored global
    (`sysvol::STRANDED_SAVED`). Sessions are deliberately left open on that path — the
    next launch adopts them (`latest_open_session`) and exports on the next graceful end.
    Window-close (`CloseRequested`) now also runs `end_and_export` (it was shutdown-only).
  - **Rebuild/reinstall invalidates TCC** (ad-hoc signing → new cdhash): after a ditto
    reinstall, `open -a` launches got silent mic denial (hear alive, zero transcripts, no
    error), while terminal-launched instances inherited the terminal's grant and worked —
    diagnose exactly this way before blaming the pipeline. Resolution: `tccutil reset
Microphone com.christian.codakiller` + `tccutil reset SpeechRecognition …` → the app
    freshly prompts on next launch (user clicks Allow twice). Expect this after EVERY
    rebuild that gets installed.
  - **`say`-through-speakers recognition is volume-marginal** (the −34 dB loopback): at
    output volume 50 commands land intermittently; the earlier P2-era harness runs
    coincidentally benefited from a stranded boost volume of 85. For future self-tests,
    set output volume ≥75 before driving the app with `say`, and expect flakiness — a
    human voice at the piano is a far stronger signal than this harness.

## Foundation / schema v3 (v0.3.0, 2026-07-12)

- **The `rep_block` v3 rebuild is deliberate and crash-atomic.** SQLite cannot relax a
  `NOT NULL` column or add the new FK shape in place, so migration disables FK enforcement,
  begins one transaction, creates `rep_block_v3`, copies every id/column, swaps the table,
  back-fills, stamps `user_version=3`, and commits before re-enabling FKs. The version stamp
  belongs inside the transaction; otherwise a crash can wedge a half-migrated real DB.
- **Nullable patches use `Option<Option<T>>`.** Outer `None` = field absent/leave unchanged;
  `Some(None)` = write SQL NULL; `Some(Some(value))` = replace. JS omits a key to leave it and
  sends `null` to clear it. Do not flatten this convention in block/region/goal/piece patches.
- **Canonical `event` is not `session_event`.** `event` is the durable append-only graph log
  used by metrics/rewards/replay; `session_event` remains the capped live UI timeline. Exports
  enumerate block ids from canonical events, then render the CURRENT block/rep graph, so edits
  after logging and relaunch are reflected.
- **Focused time is an idle-gap heuristic, not a timer.** Sort canonical event timestamps; gaps
  of 0–120 s count, gaps >120 s count as zero. It intentionally rewards focused presence without
  pretending an open app equals practice.
- **Region migration is geometric, not musical intelligence.** Overlapping/touching block ranges
  cluster into a Region; users clean the guess with rename/merge/split/reassign. `pdf_anchor` is
  reserved opaque JSON for P4's real-PDF light mapping.
- **Non-tempo block tempo contract.** Frontend sends `start_bpm: null`; serde maps that to an
  internal 0 sentinel for the live rep engine, while SQLite stores NULL and exports “—”. If the
  independent metronome toggle is on, a real click BPM is stored even though focus still gates
  ladder advancement.
- **Panel z-order gotcha.** Drag begins with `raise()`, but the floating component's transient
  geometry still has its old z. `usePanels.update` must preserve `max(incoming.z,current.z)` or
  the final drag commit silently undoes focus-to-front.
- **Visual QA finding:** movable overlays are not enough if defaults still cover content. While
  an active Rep window exists, the main Practice view reserves a right gutter; Session defaults
  collapsed inside the top bar. This fixed title/history overlap and clipped HUD context.

## v0.3.1 release identity / duplicate-app hygiene (2026-07-12)

- `tauri build --bundles app` necessarily creates a runnable bundle under
  `src-tauri/target/release/bundle/macos/`. Spotlight indexes that bundle as well as the installed
  `/Applications` copy, so leaving it behind creates two CodaKiller search results even when the
  executables are identical. After `ditto` install: unregister the generated bundle with
  `lsregister -u`, delete that generated directory, then `lsregister -f` the Applications copy.
- A correct invisible update is still a release failure. The top bar now derives its version from
  `package.json`, and the Practice landing surface names the Foundation features. This gives a
  first-screen, user-verifiable signal that the expected build is running.

## P4 real-PDF workspace (v0.4.0, 2026-07-12)

- **The PDF is the visual authority; Regions are the musical authority.** PDF.js renders the
  user's actual edition. Region measure ranges remain canonical in SQLite; normalized page
  rectangles are navigation metadata only. Do not infer printed geometry from MusicXML.
- **PDF bytes cross Tauri IPC as raw binary.** Rust rediscovers and canonicalizes an edition under
  the selected piece on every request, rejects traversal/symlinks/cross-piece ids, and returns
  `tauri::ipc::Response`. Never expose a broad asset-protocol filesystem scope or JSON/base64 the
  file. The frontend bundles the PDF.js worker locally.
- **Large scores require persistent placeholders but disposable canvases.** All pages keep their
  layout boxes for continuous scrolling; only visible pages plus one neighbor own a rendered
  HiDPI canvas. Eviction cancels the render task, calls page cleanup, and sets both canvas backing
  dimensions to zero. The real fixtures are a 20.3 MB / 28-page Scherzo edition and an 85-page
  Cortot volume on the 8 GB M2 Air.
- **Anchors are edition-specific and fingerprinted.** Contract: `{v:1, editions:{id:{fingerprint,
rects:[{page,x,y,w,h}]}}}` with 0..1 coordinates. A changed fingerprint is shown as `remap`,
  never at stale coordinates. Region merge deduplicates compatible rectangles and drops a
  conflicting edition; split clears the old geometry because both new ranges must be remapped.
- **Do not use `scrollIntoView` inside the score workspace.** It can scroll outer ancestors and
  hide the toolbar. Navigate by setting the score pane's own `scrollTop`/`scrollTo` target.
- **Voice score navigation is intentionally silent.** `go to/show page N` and `go to/show measure
N` emit `score://navigate` without TTS over the pianist. This is a deliberate exception to the
  older assumption that every command acknowledgment closes the STT gate; the 2.5 s duplicate
  window can therefore suppress an immediate identical repeat.
- **Tauri's P4 `.app` emerged linker-signed, not bundle-sealed.** `codesign --verify --deep
--strict` reported “code has no resources but signature indicates they must be present” and
  `codesign -d` showed the hash-like linker identifier with `Info.plist=not bound`. After `ditto`,
  run `codesign --force --deep --sign - --identifier com.christian.codakiller
/Applications/CodaKiller.app`, then strict-verify. v0.4.0's installed bundle is sealed and uses
  the correct identifier; P6 packaging must automate this instead of relying on release memory.

## P5 grounded brain provider boundary (2026-07-12)

- **The API boundary is native keys, never a Claude Code login.** Brain secrets resolve from the
  macOS Keychain (`codakiller` service, `claude` / `gemini` accounts), then the
  `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` environment fallbacks. The provider, model, fixed URL,
  and headers are assembled in Rust; no secret enters IPC, SQLite, prompts, errors, or logs.
- **Provider order is Claude → Gemini → cited offline library.** `CODAKILLER_BRAIN_PROVIDER`
  supports `auto`, `claude`, or `gemini`; model overrides are explicit env vars. Defaults were
  verified 2026-07-12 against Anthropic's official
  [model IDs](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) and
  [Messages API](https://platform.claude.com/docs/en/api/messages/create), plus Google's official
  [Gemini 3.5 model guide](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5)
  and [generateContent reference](https://ai.google.dev/api/generate-content):
  `claude-sonnet-4-6` and `gemini-3.5-flash`.
- **Grounding is an allowlist join, not a prompt promise.** Only a bounded selected-piece/session
  projection and deterministic method cards cross the provider boundary. Provider citation ids
  are joined back to the validated local library; unknown ids never become frontend citations.
  When providers fail, the same retrieved method cards remain useful as a cited offline answer.
- **The brain has no hot-loop authority.** Output is rejected if it assigns a rep verdict, claims
  app control, proposes graph mutations, or requests secrets/filesystem/terminal access. It has no
  tools and cannot start a metronome, navigate a score, save intake, or schedule work.
- **Gemini 3.5 thinking tokens count against `maxOutputTokens`.** The first real-key smoke used
  900 tokens and ended `MAX_TOKENS` with only a thought part—no structured answer. For this short
  grounded JSON task, use `generationConfig.thinkingConfig.thinkingLevel = minimal`, remove the
  no-longer-recommended temperature override, allow 4096 output tokens, and parse the first text
  part that satisfies the strict JSON schema (thought parts may precede it). Official reference:
  [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking). The corrected
  real Keychain Gemini smoke passed without printing the key or answer.
- **Voice brain answers reuse the owning TTS path.** Network work stays on Tauri's blocking pool;
  after a voice-sourced answer returns, only the bounded policy-checked text is queued to the
  VoiceLoop action owner. Its existing `Speaker` closes/reopens the STT gate around playback. Do
  not add Web Speech synthesis or a second ungated TTS path.
- **The deterministic planner is read-only and traceable.** It ranks unfinished/due goals, open
  blocks, and spaced Region revisits; every score component appears in `reasons`, output is capped,
  and the local date comes from SQLite `date('now','localtime')` instead of slicing UTC timestamps.
  The brain receives this plan as context but cannot mutate or reorder it.
- **P5 review hardened the write and prose boundaries.** Intake drafts are registered in a
  process-local 15-minute ledger and can be applied once only, against the exact answer, piece,
  and fields that were proposed. Piece deadlines update only canonical root Goals that still
  match the previous inherited default; custom per-Goal dates survive. Provider prose is rejected
  across verb/object families for verdicts, piano-hearing claims, score/tempo control, graph
  mutation, tools, and secrets. This remains deliberately conservative: a blocked provider answer
  is safer than text that appears to control the deterministic app.
- **P5 planning uses both history and recency.** Region ranking combines whole-history clean ratio,
  flawed/failed count across the latest five persisted reps, and spaced age. The same reason trace
  is visible directly in Brain, independent of provider availability; it is not hidden inside the
  prompt or owned by the model.

## P5.5 Goals, Calendar, and recovery (v0.6.0, 2026-07-12)

- **Calendar work is planning metadata, never practice evidence.** `daily_work_change` and
  `recovery_apply` are administrative events. They do not create focused time, active practice
  days, reps, verdicts, or Goal completion. Marking “Done—I did it” means only that the planned
  card was handled.
- **Recovery preview and Apply are separate trust boundaries.** Preview is pure/read-only and
  ranks by earliest applicable deadline, oldest missed date, Goal order, then work id. Apply
  re-reads every row and validates optimistic tokens, strict dates, the seven-day horizon, the
  earliest parent/subgoal deadline, total capacity, and the exact half-capacity recovery ceiling
  in one SQLite transaction. One stale or invalid decision rolls back the whole batch.
- **Origin is provenance.** `origin_date` is protected by a database trigger and never changes;
  each recovery Move increments `reschedule_count`. The UI never moves missed cards until the
  user explicitly chooses Move/Done/Dismiss/Leave and presses Apply.
- **Schema v5 was rehearsed on a SQLite backup of the installed v4 database.** The real-copy gate
  preserved 5 pieces, 24 Regions, 20 blocks, 165 reps, 4 Goals, 3 canonical events, and 249
  session events; `integrity_check` returned `ok` and `foreign_key_check` returned zero rows.
- **Deterministic suggestions can schedule only canonical Goals.** The explicit Brain “Schedule”
  form writes a `source=planner` card only when a suggestion already has Goal ownership. Block
  and Region suggestions remain read-only instead of silently inventing a Goal relationship.

## Brain online fix — root cause + fix (2026-07-16)

- **A code comment claiming a model id was "verified" was wrong — trust ListModels, not a
  comment.** The Brain default Gemini model was `gemini-3.5-flash`. Diagnosed live against the
  real v1beta API for this account: that id is NOT in the account's listed models, so every
  request 404/failed and every session silently fell back to offline. Lesson: before hardcoding
  or trusting a default model id, verify it against `v1beta/models` (ListModels) for the actual
  account/key in use — a prior "verified" comment in the code is not evidence, model
  availability changes and differs per account/region. Fixed by defaulting to
  `gemini-flash-latest`, a listed stable id.
- **The stored Keychain key had silently become empty.** The `codakiller`/`gemini` Keychain
  entry was found holding an EMPTY value — no provider was ever actually configured, independent
  of the model bug. Re-stored from the user's existing real key (54 bytes), whose durable
  recovery source is `~/piano-coach/data/secrets.env`. `api_key_save` now rejects an
  empty/whitespace key so a blank can never be silently stored again.
- **Transient 5xx/transport errors were swallowed with no retry.** `ProviderChain::ask` only
  `eprintln!`'d a failed request and fell through to the next provider (eventually offline) with
  no retry, so a single transient 503 permanently dropped the session to offline for the rest of
  its life. Fixed: `ProviderChain::ask` now retries the _same_ provider once on a transport-error
  or 5xx response before falling through to the next provider or offline; 4xx errors are never
  retried (they're not transient). Offline failures now carry a truthful `OfflineCause`/`reason()`
  instead of being swallowed.
- **Fix shape (commits `550af13`, `c3b5271`, `3028d3e`, `92dbed1`):** default model →
  `gemini-flash-latest`; retry-once-on-5xx/transport-error in `ProviderChain::ask`; truthful
  offline reason via `OfflineCause`/`reason()`; `api_key_save` empty/whitespace guard; new IPC
  `brain_status` and `brain_test_connection` so the UI can show `● online — <provider>` /
  `○ offline — <reason>` and run a real round-trip test instead of guessing from a config file.
  Verified: full Rust suite 473/0 (backend-freeze held — only brain code + the `api_key_save`
  guard changed); a live round-trip with the corrected model returned a valid answer (attempt 1
  hit a 503, attempt 2 succeeded — exactly the case the retry now absorbs); fresh-context
  adversarial verifier returned CONFIRMED.
- **Source-only, honestly.** This fixes the Brain in the git source tree. The installed `.app`
  is still v1.3.0/v2.0.0-in-progress with the old model baked in; restoring the Keychain key
  alone does not fix the installed app — it only takes effect once a v3 build is packaged and
  installed.

## v3 Phase 2 — design system, shell, Settings (2026-07-16)

- **Token-discipline test pattern:** `tokens.test.ts` greps the actual CSS file for banned
  serif/hex values, so the monochrome rule is enforced structurally, not just by convention. This
  caught a real slip mid-build: the plan's own `--font-sans` value ended in the generic word the
  test bans (a serif-family fallback term), so the ban fired against the plan's own token. Fix
  was to drop the generic keyword from the value rather than loosen the guard — the guard was
  right and the plan's literal wording was wrong. Lesson: when a token-discipline test fails
  against your own plan text, trust the test and fix the value; don't widen the regex to let a
  stray word through.
- **`src/components/Shell.test.tsx` is orphaned and pre-existing-broken, not a Phase 2
  regression.** It asserts a stale "Version 1.3.0" string and belongs to the superseded v2 shell
  — the only thing still importing it is `BrainNavigation.test.tsx`. Flagged, deliberately NOT
  fixed in this phase (out of scope for a design-system slice); it predates Phase 2 and is the 1
  failure in the 629/630 test run. Whoever eventually retires the old v2 shell should delete both
  files together.
- **`npm run dev:mock` defaults to port 1420, which may already be occupied** by a long-running
  dev server from an earlier session. The Phase 2 verifier worked around this by running on 5199
  instead of assuming 1420 is free — check for a listener before trusting a "port in use" failure
  is a real bug.
