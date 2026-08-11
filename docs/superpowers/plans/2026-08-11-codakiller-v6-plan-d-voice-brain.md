# v6 Plan D — Voice & Brain (S9 + S10) + ship gate repair

> **Status:** Executing 2026-08-11. The last plan before v6.0.0 ships. Spec:
> `docs/superpowers/specs/2026-08-05-codakiller-v6-practice-core.md` §S9 + §S10.
> Schema: **unchanged** (stays v14).

## Why (Christian, July 31, verbatim)

- "metronome commands are terrible… 'metronome off' barely works, metronome on is like
  delayed by 5 seconds… I shouldnt have to speak to like how you would need to speak to
  Siri in 2015"
- "Brain is completely useless rn… robot voice… says the content is hidden from the AI"

Scouted causes: settle 600 ms (`stt/supervisor.rs:103`) + dedup 2.5 s
(`voice_loop.rs:103` `DEDUP_WINDOW`) + spoken-ack full gate cycle
(close→play→drain→300 ms tail→reopen) ≈ the "5-second delay". Strict fixed-phrase
router (`tierAIntent.ts:212-392`, `intent/mod.rs`) = "Siri 2015". Session-lifetime
TTS lockout to `say` after 2 consecutive failures (`tts/mod.rs:155-223`,
`primary_disabled: AtomicBool`) with zero UI signal = "robot voice".

## Lanes (parallel worktrees, merge order H → B → T → V)

### Lane H — B58 harness repair (`lane/d-harness`)

`store/mod.rs` tests only. Diagnosis (2026-08-11, reproduced + queried): the 118
"wrongly attributed" rows are exactly the July v12 merged→Copland move
(100 rep_checkpoint + 14 rep + 2 rep_open + 2 rep_close, all 2026-07-27,
piece 6→7). `merged_id` resolves via title `'Chamber Pieces Tanglewood'` which is 0 on
every post-split DB, so the exception clause matches nothing.

- Make the exception split-aware: when `merged_id == 0` and a
  `'Cowboys with Lassos (Billy the Kid)'` piece exists, resolve the historical merged id
  as the `'Pas de Deux'` (Barber) row id (the split kept the merged row's id) and snapshot
  the pre-migration exception count; assert the mapping is **byte-identical** before vs
  after (v13→v14 must move nothing).
- Keep the strict pre-split behavior intact (synthetic fixtures still exercise it).
- Add the `com.christian.codakiller` path-component guard that
  `premap_injection_on_database_copy` already has (mod.rs:2245) — the rehearsal test
  reads `CODAKILLER_MIGRATION_COPY` unguarded.
- Done: rehearsal test green on a fresh live-DB copy; still green on synthetic fixtures.

### Lane B — S10 Brain quick fixes (`lane/d-brain`)

- Grounding copy (`BrainWorkspace.tsx:685-690`, `brain/context.rs:362`):
  `knowledge_shared_with_provider:false` must render **"No book excerpts matched this
  question"** when retrieval simply found nothing, and honest distinct copy when sharing
  is disabled by the privacy setting — never "content is hidden". Backend should expose
  the cause (no-hits vs sharing-off vs offline) so the frontend doesn't guess.
- System-prompt style pass (`brain/provider.rs:38-54` `SYSTEM_POLICY`): answer first, no
  author/AI-logistics preambles, ≤2-sentence default stays; citations become a compact
  suffix; the spoken path must not read citation ids aloud.
- Brain speech already routes `lib.rs:1794 speak_brain_answer` → S9/T TTS path; keep
  text-first render, speech only for Voice-sourced asks (already true — pin with a test).
- Update pinned prompt/copy tests (`provider.rs:1182-1200`, `brain/mod.rs:1619/1837/1917`).
- Terms firewall: user-facing copy says **Assistant** (`src/shell/terms.ts`), never Brain.

### Lane T — S9 TTS dignity (`lane/d-tts`)

- Cooldown retry (`tts/mod.rs` `FallbackTts`): replace session-lifetime
  `primary_disabled` with a cooldown (disable primary ~60 s after the failure threshold,
  then re-try; back off doubling to a ~10 min cap; any success resets). No behavior
  change for the success path.
- Degraded-state signal: emit a status event when falling back to `say` and when the
  primary recovers; frontend shows a quiet **"voice degraded — using system voice"**
  pill (Settings voice section + wherever voice status already surfaces), clears on
  recovery. No new noisy toasts.
- Better default cloud voice: current default `Kore` (`tts/gemini.rs:30`); pick a warmer
  conversational default from the supported 8 with a one-line rationale; leave any
  explicitly saved user setting untouched.
- Done: unit tests for cooldown/backoff/reset; degraded event fires exactly on
  transitions (not per failure); tsc + focused suites green.

### Lane V — S9 voice command core (`lane/d-voice`) — the big one

1. **Fast path for exact commands.** Short allowlist ("metronome off", "metronome stop",
   "stop", "done", …) finalizes on a high-confidence partial, skipping the 600 ms
   settle. Half-duplex gate ordering and the metronome speak-before-stop engine-alive
   rule are preserved verbatim. Target: <1 s utterance-end → metronome state change.
2. **Chime acks.** Metronome start/stop/tempo + rep check-offs play a short chime
   (through the existing output engine — mixer one-shot via the TTS PCM path so it works
   with the metronome running or stopped) instead of synthesized speech. Speech stays
   for content that carries words (questions, receipts, action drafts). Errors still
   speak.
3. **Looser matching, same firewall.** Normalized fuzzy/variant matching in BOTH routers
   (TS `tierAIntent.ts` + Rust `intent/mod.rs`, kept in parity): ASR mangles
   ("metranome", "metrodome"), natural forms ("turn the metronome on", "can you stop the
   metronome", "turn it off" after metronome context is NOT included — no context
   memory), "slower"/"faster" = ±default step (already exist — keep). The 12-word
   ambient cap, conversational exclusions, and note fallback stay byte-for-byte.
4. **Visible hearing.** Live heard-text pill near the Rep Counter panel: every final —
   even Ignored — flashes what was heard (extend `VoiceToast`/new pill; `SILENT_KINDS`
   no longer silently drops the heard text, only the toast). Mic-level indicator only if
   it can ride an existing signal cheaply; do NOT add a second audio input stream on the
   8 GB budget — if no cheap signal exists, ship the pill + the honest in-app help line
   ("quiet-speech sensitivity belongs to the macOS speech engine").

- **Gates (binding):** the full narrated-corpus replay
  (`src-tauri/tests/narrated_session_replay.rs` + `scherzo1/2/3.rs`, 1,309 segments)
  passes with **zero false mutations**; new fixtures added from each July 31 complaint
  (fast-path phrases, mangles, natural forms) in both `tierAReplay.ts` and the Rust
  corpus tests; every existing voice/metronome test green.

## Merge + ship sequence

1. Merge H → run rehearsal on a FRESH live-DB copy (must be green — this is the gate B58
   was blocking).
2. Merge B, T, V (conflict resolution on `voice_loop.rs`/`tts` seams is the
   orchestrator's job, not a lane's).
3. Full gates on main: `tsc`, vitest (≥2027), `cargo test` (≥831), `cargo clippy
--all-targets -- -D warnings`, narrated corpus zero false mutations.
4. Fresh-context verifier pass over the merged diff.
5. Live smoke QA via devMock (app boots, dock/pill/brain copy render, no console
   errors) — jsdom-green ≠ app-works.
6. Ship v6.0.0: bump `package.json` + `tauri.conf.json` 5.0.0→6.0.0; release-gate grep
   (CLAUDE.md Status stale check); pre-install live-DB backup with SHA-256 into the
   vault `backups/`; fresh migration rehearsal immediately before install;
   `npm run tauri build`; preserve `~/CodaKiller-v5.0.0-rollback.app`; install;
   `codesign --force --deep --sign -`; tag `v6.0.0`; vault docs per binding protocol
   (Changelog, CodaKiller.md, Roadmap, Flaws — B58 resolved, B67 stays open, How To Use,
   Command Center) + repo `NOTES.md` + CLAUDE.md Status.

## Non-goals

Everything in spec "Non-goals" (v7 Motivation Layer), any voice authority expansion,
Brain overhaul beyond the three S10 fixes, schema changes.
