# CodaKiller P3 Implementation Plan (Pieces · Rep Engine · Sessions) → v0.2.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task numbering continues the P0–P2 ledger (`.superpowers/sdd/progress.md`).

**Goal:** The actual product begins: pieces seeded from the vault, an intake interview, the rep tracker (blocks / ladders / variants / verbal check-off), practice sessions with vault export — plus the two P2 debts (runtime TTS fallback, mic-permission guidance). Ships as **v0.2.0**, usable at the piano tonight.

**Architecture:** Rust core gains three modules — `vault/` (read-only piece scan), `rep/` (pure ladder logic + a `RepEngine` service that is the single source of truth for the active block), `sessions/` (auto-started session timeline + markdown export appended to the vault). The intent router grows a rep-block grammar; the voice-loop action thread consumes `RepEngine` outcomes and speaks them. React gains a Pieces panel, intake form, rep HUD, and session bar. Spec: `docs/superpowers/specs/2026-07-09-codakiller-design.md` §4–5.

**Tech Stack:** unchanged (Tauri v2, Rust, rusqlite bundled, Vite+React+TS, vitest). **No new Rust deps unless already in `Cargo.lock` transitively** (8 GB rule; check before adding — `chrono`/`time`: use whichever is already locked, else format timestamps via sqlite `datetime('now','localtime')`).

## Global Constraints

- 8 GB M2 Air; no ML runtimes; app resident memory < ~400 MB.
- The app NEVER interprets audio as music; deterministic hot loop, no LLM (spec §1).
- Old app + human-authored vault docs are read-only. Vault WRITES only `(C) codakiller-*` files inside piece folders — additive appends, never edits, never deletes.
- Pieces dir (setting `vault.pieces_dir`, default): `/Users/c3/Desktop/christian's universe/Piano Practice/Pieces`.
- Repo `/Users/c3/codakiller`, branch `main`, commit per task; **read `NOTES.md` before touching audio/stt/tts/voice_loop** (hard-won facts: half-duplex gate ordering, 2.5 s dedup, single-producer `enqueue_pcm`).
- Every ack MUST still close the STT gate (the dedup safety note in `voice_loop.rs` depends on it) — no silent acks.
- All Rust logic unit-tested without an audio device (use the existing seam patterns: `Metronome::with_seams`, `Store::open(":memory:")`, `RecConfirm`/`RecEmitter` in voice_loop tests).
- Temp files → the session scratchpad, never the repo.

## Execution lanes (orchestrator note)

- **Lane R (sequential):** Task 15 → 16 → 17 → 18 (shared files: `store/`, `lib.rs`, `rep/`, `sessions/`, `intent/`, `voice_loop.rs`).
- **Lane D (parallel from start):** Task 19 (debts — only `tts/mod.rs`, `tts/gemini.rs`, `stt/supervisor.rs`, `src/features/voice/*`).
- **Lane F (parallel from start):** Task 20 (frontend — only `src/**`, builds against the command contracts below with mocked `invoke`).
- **Task 21 (ship)** after all lanes merge.

## Command + event contract (all lanes build against THIS)

Tauri commands (camelCase args from JS; `Result<_, String>` errors):

| Command | Args | Returns |
|---|---|---|
| `pieces_scan` | — | `Vec<PieceSummary>` (rescans vault dir, upserts, returns all) |
| `pieces_list` | — | `Vec<PieceSummary>` |
| `piece_get` | `id: i64` | `PieceDetail` |
| `piece_intake_save` | `id: i64, intake: Intake` | `PieceDetail` (sets `intake_done`) |
| `piece_select` | `id: i64` | `()` (persists setting `ui.current_piece`) |
| `rep_open` | `args: RepOpenArgs` | `RepSnapshot` |
| `rep_check` | `verdict: String ("clean"/"flawed"/"failed"), note: Option<String>` | `CheckOutcome` |
| `rep_close` | — | `Option<RepSnapshot>` |
| `rep_state` | — | `Option<RepSnapshot>` |
| `rep_blocks_for_piece` | `pieceId: i64` | `Vec<BlockHistory>` (block + rep counts by verdict) |
| `session_current` | — | `Option<SessionView>` |
| `session_end` | — | `Option<ExportResult>` (ends, writes summary, appends to vault) |

Serde types (defined in Task 15/17, consumed by frontend):

```rust
PieceSummary { id, title, composer: Option<String>, has_xml: bool, has_pdf: bool, intake_done: bool }
PieceDetail  { ...PieceSummary fields, folder_path, xml_path, pdf_path, goals: Vec<String>, deadline: Option<String>, target_tempo: Option<f64>, hard_spots: Vec<HardSpot>, current_state: Option<String>, notes: Option<String> }
HardSpot     { measures: String, note: String }
Intake       { goals: Vec<String>, deadline: Option<String>, target_tempo: Option<f64>, hard_spots: Vec<HardSpot>, current_state: Option<String> }
RepOpenArgs  { piece_id: i64, m_start: u32, m_end: u32, label: Option<String>, start_bpm: f64, target_bpm: Option<f64>, planned_reps: Option<u32>, increment: Option<IncrementRule>, variants: Vec<VariantSpec> }
VariantSpec  { name: String, reps: u32 }
IncrementRule{ clean_needed: u32, bpm_step: f64 }   // stored resolved; "auto" resolves at open
RepSnapshot  { block_id, piece_id, piece_title, m_start, m_end, label: Option<String>, bpm: f64, start_bpm, target_bpm: Option<f64>, planned_reps: u32, reps_done: u32, cleans_at_step: u32, rule: IncrementRule, variant: Option<String>, variants: Vec<VariantSpec>, verdicts: VerdictCounts, last: Option<LastRep>, status: String }
VerdictCounts{ clean: u32, flawed: u32, failed: u32 }
LastRep      { verdict: String, note: Option<String>, bpm: f64 }
CheckOutcome { snap: RepSnapshot, new_bpm: Option<f64>, block_done: bool, say: String }
SessionView  { id, started_at, events: Vec<SessionEventView> }   // events newest-first, capped 200
SessionEventView { ts, kind, payload: serde_json::Value }
ExportResult { session_id, files: Vec<String>, pieces: u32, reps: u32 }
```

Events: `rep://state` (payload `Option<RepSnapshot>`, emitted on every open/check/close), `session://event` (payload `SessionEventView`, emitted on every log), existing `voice://*`, `metro://state` unchanged.

---

## Task 15: Schema v2 + store CRUD (the data layer)

**Files:**
- Modify: `src-tauri/src/store/migrations.rs` (add v2), `src-tauri/src/store/mod.rs` (CRUD)
- Create: `src-tauri/src/store/model.rs` (the serde types above)

**Interfaces — Produces:** `migrate` takes schema 1→2; `Store` methods:
`upsert_piece(&ScanPiece) -> i64` (keyed on `folder_path`; refreshes title/composer/xml/pdf, PRESERVES intake fields), `list_pieces() -> Vec<PieceSummary>`, `get_piece(i64) -> Option<PieceDetail>`, `save_intake(i64, &Intake)`, `insert_rep_block(...) -> i64`, `update_block_status(i64, &str)`, `insert_rep(block_id, bpm, variant, verdict, note) -> i64`, `block_history(piece_id) -> Vec<BlockHistory>`, `open_session() -> i64`, `insert_session_event(session_id, kind, &Value)`, `end_session(id, summary_md)`, `session_events(id) -> Vec<SessionEventView>`, `latest_open_session() -> Option<i64>`.

- [ ] **Step 1: failing tests first** (`store` test module): migrate v1→v2 idempotent; upsert twice = one row, intake preserved across rescans; rep round-trip; session open→events→end.
- [ ] **Step 2: schema v2 migration** — exactly:

```sql
CREATE TABLE piece (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, composer TEXT,
  folder_path TEXT NOT NULL UNIQUE, xml_path TEXT, pdf_path TEXT,
  goals TEXT NOT NULL DEFAULT '[]', deadline TEXT, target_tempo REAL,
  hard_spots TEXT NOT NULL DEFAULT '[]', current_state TEXT,
  intake_done INTEGER NOT NULL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rep_block (
  id INTEGER PRIMARY KEY, piece_id INTEGER NOT NULL REFERENCES piece(id),
  m_start INTEGER NOT NULL, m_end INTEGER NOT NULL, label TEXT,
  start_bpm REAL NOT NULL, target_bpm REAL,
  increment_rule TEXT NOT NULL, planned_reps INTEGER NOT NULL,
  variants TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','abandoned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rep (
  id INTEGER PRIMARY KEY, block_id INTEGER NOT NULL REFERENCES rep_block(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')), bpm REAL NOT NULL, variant TEXT,
  verdict TEXT NOT NULL CHECK(verdict IN ('clean','flawed','failed')), note TEXT
);
CREATE TABLE session (
  id INTEGER PRIMARY KEY, started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT, summary_md TEXT
);
CREATE TABLE session_event (
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES session(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')), kind TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE spot_review (
  piece_id INTEGER NOT NULL REFERENCES piece(id), spot TEXT NOT NULL,
  last_seen TEXT, interval_days REAL NOT NULL DEFAULT 1.0, ease REAL NOT NULL DEFAULT 2.5,
  PRIMARY KEY (piece_id, spot)
);
```

(`spot_review` is created now per spec §5; no logic until P5.)
- [ ] **Step 3:** implement CRUD; JSON columns (de)serialize through the `model.rs` types; timestamps are sqlite `datetime('now')` UTC.
- [ ] **Step 4:** `cargo test` green. Commit `feat(store): schema v2 — pieces, rep blocks, reps, sessions`.

### Task 16: Vault piece ingest

**Files:**
- Create: `src-tauri/src/vault/mod.rs` (+ tests with a tempdir fixture)
- Modify: `src-tauri/src/lib.rs` (commands `pieces_scan`, `pieces_list`, `piece_get`, `piece_intake_save`, `piece_select`)

**Interfaces — Consumes:** Task 15 Store. **Produces:** `vault::scan_pieces(dir: &Path) -> Vec<ScanPiece>`; `ScanPiece { folder_path, title, composer: Option<String>, xml_path: Option<PathBuf>, pdf_path: Option<PathBuf> }`.

- [ ] **Step 1: tests** on a tempdir fixture: folder `"Chopin - Scherzo No.2 Op.31"` → composer `Chopin`, title `Scherzo No.2 Op.31`; folder without `" - "` → title only; picks first `score/*.musicxml`/`*.mxl` and `score/*.pdf` (also accept score files at the folder root); missing dir → `Ok(vec![])`, never an error toast at startup; non-piece entries (files, `_piece-template`, dot-dirs) skipped.
- [ ] **Step 2:** implement scan (read-only, no writes to the vault, ever) + `pieces_scan` command = scan → `upsert_piece` each → `list_pieces`. `piece_select` writes setting `ui.current_piece`. Startup (`lib.rs` setup): run one scan in a background thread so first paint isn't blocked.
- [ ] **Step 3:** `cargo test`; manual: `pieces_scan` against the REAL vault returns 5 pieces, Scherzo + Op.90 with `has_xml: true`. Commit `feat(vault): piece ingest from the vault + piece commands`.

### Task 17: Rep engine + sessions core

**Files:**
- Create: `src-tauri/src/rep/mod.rs` (service), `src-tauri/src/rep/ladder.rs` (PURE logic + heavy tests), `src-tauri/src/sessions/mod.rs`
- Modify: `src-tauri/src/lib.rs` (commands `rep_open/rep_check/rep_close/rep_state/rep_blocks_for_piece/session_current`, manage `Arc<RepEngine>`, `Arc<SessionService>`)

**Interfaces — Consumes:** Task 15. **Produces:**
- `ladder.rs`: `resolve_auto(start, target: Option<f64>, planned: Option<u32>, variants: &[VariantSpec]) -> (IncrementRule, u32 /*planned_reps*/)` — defaults: no variants+no planned → 30 reps; variants → planned = Σ variant reps; rule: `bpm_step = 4`, rungs `K = ceil((target-start)/4)` (K=1 when no target), `clean_needed = clamp(round(planned/K), 1, 5)`; no target → `clean_needed = 3` and bpm never steps past `target_bpm` (None = no ceiling ⇒ NO stepping — a ladder needs a target; rule still stored for display).
- `step(rule, cleans_at_step, bpm, target) -> Option<f64>` (new bpm capped at target; `None` = stay).
- `RepEngine::open(&self, RepOpenArgs) -> Result<RepSnapshot, String>` (closes any prior open block as `abandoned`… unless it's the same block args? No — plain: opening while one is active returns Err("close the current block first") for voice safety; UI offers close-then-open),
  `check(&self, verdict: RepVerdict, note: Option<String>) -> Result<CheckOutcome, String>` (no active block → Err), `close(&self) -> Option<RepSnapshot>` (status `done` if `reps_done ≥ planned_reps` else `abandoned`), `snapshot() -> Option<RepSnapshot>`, `active() -> bool`, `set_emitter(...)` following the `VoiceEmitter` seam pattern.
- Variant lane = order of `variants` by cumulative reps (reps 1–10 → variant[0]…). Verdict `failed`/`flawed` still advances `reps_done` (an attempt is a rep); ONLY `clean` increments `cleans_at_step`; a step resets `cleans_at_step`.
- `CheckOutcome.say` composed HERE (single source for voice + UI): normal → `"{n} of {planned}."`; step → `"{n} of {planned}. Up to {bpm}."`; variant change → append `"{Name} next."`; block done → `"Block done: {planned} reps, {clean} clean, topped out at {bpm}."`
- `SessionService::log(&self, kind: &str, payload: Value)` — auto-opens a session on first log (reuses `latest_open_session()` if the app restarted mid-session), inserts event, emits `session://event`; `current() -> Option<SessionView>`; `end_raw(&self) -> Option<i64>` (marks ended, returns id — export lands in Task 18). RepEngine logs `rep_open`/`rep`/`rep_close` events; `piece_intake_save` logs `intake`; metronome voice actions will log in Task 18.
- `RepEngine` emits `rep://state` after every mutation.

- [ ] **Step 1:** ladder tests FIRST (pure): auto-resolve 80→120/30 reps → step 4, clean_needed 3; stepping caps at target; no-target never steps; variant lane boundaries; done at planned.
- [ ] **Step 2:** engine tests with `:memory:` store + recording emitter: open→check×N persists reps w/ correct bpm+variant; close status logic; double-open rejected; check with no block errs.
- [ ] **Step 3:** implement, wire commands + managed state. `rep_check` from UI takes the same path as voice will (RepEngine only). `cargo test` green. Commit `feat(rep): rep engine + ladders + sessions core`.

### Task 18: Voice wiring — rep grammar + spoken outcomes + session events

**Files:**
- Modify: `src-tauri/src/intent/mod.rs` (grammar + `Verdict` → three-way), `src-tauri/src/voice_loop.rs` (ActionCtx gains `rep: Arc<RepEngine>`, `sessions: Arc<SessionService>`), `src-tauri/src/lib.rs` (pass the Arcs into `VoiceLoop::start`), `src-tauri/src/sessions/mod.rs` (+`end_and_export`), create `src-tauri/src/sessions/export.rs`

**Interfaces — Consumes:** Tasks 15/17. **Produces:** router additions (rep-mode vocab STAYS mode-scoped per spec §2):

| Utterance (examples) | Intent |
|---|---|
| `open a rep tracker measures 40 to 56 start at 80 target 120` / `rep block measures 12 to 16 at 60` / `tracker measures 40 through 56 start at 80 target 120 twenty reps` | `RepOpen{ m_start, m_end, start_bpm: Option, target_bpm: Option, reps: Option }` (any mode; requires the word `measures?` + range; piece = `ui.current_piece` setting, none selected → spoken "Pick a piece first.") |
| rep mode: `done` `clean` `got it` `nailed it` `yes` `yep` | `RepCheck(Pass, None)` |
| rep mode: `sloppy` `rough` `shaky` `almost` | `RepCheck(Flawed, None)` |
| rep mode: `again` `nope` `no` `messed up` `failed` | `RepCheck(Fail, None)` |
| rep mode: `nope missed the left hand jump` / `again fingering fell apart` | `RepCheck(Fail, Some("missed the left hand jump"))` — leading verdict word + trailing note captured |
| rep mode: `where are we` `how many left` `status` | `RepStatus` |
| rep mode: `close the block` `end the block` `close the tracker` | `RepClose` |
| any mode: `end the session` `end session` | `SessionEnd` |

Guards: numbers via the existing `numbers.rs` homophone rules; `measures 40 to 56` must parse BOTH numbers or `Ignored`; note capture only after a leading fail/flawed token, ≤ 12 words, never contains a bare number reinterpretation. Ambient firewall intact: extend the rejection test battery (`"I stopped by the store"`, `"that was so clean of him"` in NON-rep mode, etc.).
- ActionCtx: `Mode.rep_block_active = self.rep.active()` (live, not the removed field); `RepCheck` → `rep.check(...)` → speak `outcome.say`; apply `outcome.new_bpm` to the metronome via `set_bpm_only` **only if running** (else it's persisted by the engine for the block, spoken anyway); `RepOpen` → resolve piece → `rep.open` → speak `"Measures {a} to {b} at {bpm}. Go."` + start metronome at `start_bpm` if not running; `RepStatus` → speak `"{n} of {planned}, at {bpm}."`; `RepClose` → speak close summary; `SessionEnd` → `sessions.end_and_export()` → speak `"Session saved. {reps} reps across {pieces} pieces."`. Voice metronome actions now also `sessions.log("metro", …)`.
- `export.rs`: `write_session_md(store, session_id, pieces_dir) -> ExportResult` — per piece touched in the session, append to `<piece folder>/(C) codakiller-sessions.md`: a `## {date} {start}–{end}` section, blocks table (measures, bpm ladder start→top, reps `clean/flawed/failed`), bulleted verdict notes, metronome summary line. APPEND-ONLY, create file with a one-line header if missing. Session with zero piece events → no vault write, still ends. `session_end` command + **app-exit hook** (`RunEvent::ExitRequested`) both call `end_and_export`.
- ⚠️ Every new spoken ack goes through `self.speaker.say` (gate-closing) — no exceptions, per the dedup safety invariant.

- [ ] **Step 1:** router tests first — the full table above + rejection battery (≥ 10 new negative cases).
- [ ] **Step 2:** ActionCtx tests via the existing `test_ctx` seam (recording speaker): rep open→3 cleans→step announcement; note captured to store; status/close/session-end paths; metronome follows a step only when running.
- [ ] **Step 3:** export test on a tempdir vault: two blocks two pieces → two files appended, correct tables, append twice → both sections present, human files untouched.
- [ ] **Step 4:** `cargo test` green; live `npm run tauri dev` smoke: speak the hero phrase end-to-end. Commit `feat(voice): rep grammar, spoken rep outcomes, session export`.

### Task 19 (parallel lane D): P2 debts — TTS runtime fallback + mic-permission guidance

**Files:**
- Modify: `src-tauri/src/tts/mod.rs` (fallback wrapper), `src-tauri/src/stt/supervisor.rs` (+`DownReason::MicDenied`), `src-tauri/src/voice_loop.rs` — ONLY the `DownReason` match arm (coordinate: Task 18 owns the rest of the file; this is a 6-line arm addition, land it as its own commit), `src/features/voice/useVoice.ts` + `VoiceToast.tsx` (persistent guidance banner)

**Interfaces — Produces:** `FallbackTts { primary, fallback, fails: AtomicU32, threshold: 2 }` implementing `TtsProvider`: per-utterance, primary error → try fallback immediately (utterance never silently dropped); after 2 CONSECUTIVE primary failures, stop trying primary for the process lifetime (log once). `select_provider` returns the wrapper whenever Gemini is chosen. `DownReason::MicDenied` detected from `hear` stderr/exit patterns — **first run `strings vendor/bin/hear | grep -iE 'denied|authoriz|permission'` and read the hear GitHub source's error strings; pattern-match those, don't guess**; map → guidance `"Microphone or Speech Recognition permission is off. System Settings ▸ Privacy & Security ▸ Microphone (and Speech Recognition) → allow CodaKiller, then relaunch."`. Enrich the restart-storm guidance to name mic permission as a likely cause. UI: a `voice://status` `down` event renders a PERSISTENT dismissible banner (not the transient toast), showing `guidance`.

- [ ] **Step 1:** `FallbackTts` unit tests (fake providers): primary fails once → fallback used, counter 1; success resets counter; 2 fails → primary never called again.
- [ ] **Step 2:** supervisor test: fake hear script printing the real denied-string → `Down(MicDenied)` emitted (pattern the REAL strings found above).
- [ ] **Step 3:** vitest: banner renders + persists on `down`, clears on `live`.
- [ ] **Step 4:** suites green; commit `fix(tts,stt): runtime say-fallback after failures + mic-permission guidance` (Flaws B1+B2).

### Task 20 (parallel lane F): Frontend — pieces, intake, rep HUD, session bar

**Files:**
- Create: `src/features/pieces/PiecesPanel.tsx` (+`.test.tsx`), `src/features/pieces/PieceDetail.tsx`, `src/features/pieces/IntakeForm.tsx`, `src/features/rep/RepHud.tsx` (+`.test.tsx`), `src/features/rep/BlockForm.tsx`, `src/features/rep/useRep.ts` (+`.test.ts`), `src/features/session/SessionBar.tsx`, `src/features/session/useSession.ts`
- Modify: `src/App.tsx` (nav: Practice view ↔ metronome stays as-is), `src/components/Shell.tsx` (nav slot only)

**Interfaces — Consumes:** ONLY the command/event contract table above (mock `@tauri-apps/api` in tests exactly like `useMetronome.test.ts` does). **Produces:** the UI.

- [ ] **Step 1:** `useRep.ts` — state from `rep_state` + `rep://state` subscription; actions `open/check/close`. `useSession.ts` — `session_current` + `session://event`, `endSession()`. Tests: event updates state; check calls invoke with verdict.
- [ ] **Step 2:** PiecesPanel: list from `pieces_list` (scan button ↻ calls `pieces_scan`), badges (XML/PDF/“needs intake”); select → `piece_select` + detail. PieceDetail: intake_done=false → IntakeForm (goals list editor, deadline date, target tempo, hard spots rows (measures+note), current state textarea) → `piece_intake_save`; else summary card + block history (`rep_blocks_for_piece`) + BlockForm (measures, start/target bpm, reps, +variant rows, auto/manual increment [default auto]) → `rep_open`.
- [ ] **Step 3:** RepHud — visible whenever `rep://state` is non-null, ABOVE whatever view: piece · m.range · big `n / planned` · current bpm · variant chip · verdict buttons (Clean / Sloppy / Again — same `rep_check` path as voice) · note quick-field · last-verdict feed (last 5) · close button. Session bar: dot + elapsed + event count, expandable timeline (newest first), End session button.
- [ ] **Step 4:** Match the existing design system (`theme.ts` tokens, Popover/Shell idioms, dark+light). No new UI deps. vitest green. Commit `feat(ui): pieces + intake + rep HUD + session bar`.
- [ ] **Step 5 (after Lane R merges):** live wire-up pass in `npm run tauri dev` — fix any contract drift (this step is the integration gate; a real click-through: scan → intake → open block → 3 checks → close → end session).

### Task 21: Ship v0.2.0

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (version → 0.2.0), docs (below).

- [ ] **Step 1:** full suites: `cargo test` (all, including new), `cargo clippy -- -D warnings`, `npm test`. All green — no skips.
- [ ] **Step 2:** integration smoke (dev app): the Task 20 Step 5 click-through PLUS voice: hero phrase → block opens, metronome starts; "done"×3 → "Three of thirty. Up to eighty-four."; "end the session" → vault file appended (verify the actual file content; then `git -C` NOTHING — the vault is not a repo, just read the file).
- [ ] **Step 3:** version bump 0.2.0; `npm run tauri build -- --bundles app`; quit the running app (`osascript -e 'quit app "CodaKiller"'`); `ditto` the new .app to `/Applications/CodaKiller.app`; relaunch; one real voice smoke on the installed app.
- [ ] **Step 4: UPDATE PROTOCOL (binding):** vault `(C) Changelog.md` (v0.2.0 entry), `CodaKiller.md` (portable summary + Last updated), `(C) Roadmap.md` (P3 🟢 + next steps → P4), `(C) Flaws.md` (B1, B2 → Resolved w/ commit; add any new honest flaws — e.g. verbal intake deferred, planner/spot_review dormant), `(C) CodaKiller Command Center.md` (status + open threads), `versions/(C) v0.2.0 — Version Record.md` (what shipped, verified, gaps, NEXT STEPS), repo `NOTES.md` (decisions: ladder semantics, export namespacing supersedes spec's `CodaKiller 2/`, mic-denied strings found), `.superpowers/sdd/progress.md` (Tasks 15–21).
- [ ] **Step 5:** `git add -A && git commit && git tag v0.2.0`.

## Self-review notes (spec §4–5 coverage)

- Pieces seeded from vault ✅ (T16) · intake interview ✅ typed (T16/T20; **verbal intake deferred to P5 brain** — record in Flaws/Roadmap) · rep blocks/ladders/variants ✅ (T17) · verbal check-off w/ tempo/variant/verdict/note ✅ (T18) · minimal speak-back ✅ (`say` strings) · metronome follows ladder ✅ (T18) · blocks persist per piece + history ✅ (`rep_blocks_for_piece`; auto-resume offer deferred — history list covers reopening manually) · session timeline ✅ (T17) · vault export ✅ (T18) · schema §5 ✅ incl. dormant `spot_review` · debts B1/B2 ✅ (T19) · HUD ✅ (T20). Score-range highlighting is P4 (needs OSMD).
