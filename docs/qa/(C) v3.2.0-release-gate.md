# CodaKiller v3.2.0 — Release Gate

**Date:** 2026-07-20
**Implementation commit:** `853f440`
**Installed:** `/Applications/CodaKiller.app`
**Schema:** 10 (unchanged)

## Result

**PASS.** v3.2.0 is installed, ad-hoc sealed, packaged, launch-verified, and closed.

## Why this gate exists

Christian asked for an adversarial, hours-long pianist workflow rather than another narrow patch.
The gate therefore combined a stateful native endurance run, a full interactive workspace journey,
all automated suites, a fresh-context review that was allowed to block the release, a disposable
real-database rehearsal, and a packaged launch/quit audit.

## Practice-loop endurance

- 220 attempts across linked sets.
- Clean, flawed, and failed verdicts; notes and variants.
- Duplicate/idempotent retries and exact command receipts.
- Tempo steps, manual/practice metronome ownership, pause/resume, checkpoint, correction, undo,
  restart, recovery, retention, close, relaunch, and export.
- Three-minute simulated relaunch gap excluded from focused time.
- Final truth: exactly 220 immutable attempts, one session, 180 focused seconds.

## Interactive mock journey

- Today plan, reviewed multi-item routine, Calendar destination, Score/Pieces/Ledger/Brain/Universe,
  Settings return, selected Region/edit state, and exact cross-workspace piece deep links.
- Ledger Pieces → Brain showed the exact White Peacock/page 1/Score context.
- Plain-English Brain answer returned grounded history with a citation.
- 24 rapid Clean writes remained usable; routine receipt cards bounded and disappeared after 1.5 s.
- Universe nodes were keyboard-activatable and exposed the same Score/Ledger actions as pointer use.
- Hidden cached Score ignored PageDown; a repeated identical Universe deep link reselected the exact
  piece after a manual Score selection changed it.

## Automated gates

- Frontend: **99 files, 1,025 passed, 0 failed, 0 todo**.
- TypeScript: `tsc --noEmit` passed.
- Production Vite build passed.
- Rust library: **495 passed, 11 ignored**.
- Rust integrations: **34 passed, 2 ignored**; **529 passed / 13 ignored total**.
- Strict clippy: warnings denied, passed.
- Fresh-context verifier: initially blocked release on cross-workspace targeting, plan lifetime,
  stale Brain context, hidden Score key capture, repeat deep links, sticky-receipt eviction, and a
  no-PDF feedback race. Every issue was fixed and regression-tested; final verdict **Ship**.

## Live-data and package gate

- Backup: `(C) pre-v3.2.0-install-2026-07-20-014755.db`.
- Backup SHA-256: `9b82ceee860cb772a0fb1ea7a1ec99291d6dd598589c29fd104c5e913a00745a`.
- Disposable production reopen rehearsal: schema 10, integrity `ok`, zero FK violations, exactly
  **6 pieces / 63 sets / 559 attempts / 14 sessions**.
- Installed Info.plist: identifier `com.christian.codakiller`, version `3.2.0`.
- Signature: valid ad-hoc local seal; not Developer ID signed or notarized.
- DMG: `releases/v3.2.0/CodaKiller-3.2.0.dmg`.
- DMG SHA-256: `0492a63cc6807a5d4ac239ab427242941148ec179d60a65564fc128a4ea5891d`.
- Filesystem/Spotlight: exactly one active app at `/Applications/CodaKiller.app`.
- Packaged app launched once and quit normally. Post-launch database remained schema 10, integrity
  `ok`, zero FK violations, and exactly 6 / 63 / 559 / 14. The app was left closed.

## Honest acceptance boundary

This proves state-machine, persistence, UI-routing, release, and database behavior. It does not
prove how macOS Speech Recognition hears `done` or `metronome stop` over Christian's live Steinway,
nor real audio-device/TTS contention. Those require the next at-piano session. The 2.5-second
identical-final dedup can still suppress a genuinely repeated rapid `done`; changing it safely
requires utterance identity, not a smaller timer.
