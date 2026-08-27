# CodaKiller v3.1 Hands-Free Stabilization — Implementation Plan

> **Status:** Historical/as built; v3.1.0 shipped and v3.2.0 followed. Unchecked boxes below are
> not current task state. Real voice-over-Steinway acceptance remains open at v8.1.0.

**Goal:** Repair the July 19 at-piano blockers and restore one safe,
screen-grounded, confirmation-gated hands-free path.

## Tasks

- [ ] Make routine mutation receipts transient and pointer-through; retain durable
  errors and confirmations. Add timer and interaction tests.
- [ ] Reconcile practice-set metronome starts: stopped → start, running/different →
  live set, running/same → no-op. Make UI and voice behavior identical and retain
  handled-command observability.
- [ ] Restore v3 shell wiring for voice Brain questions, exact visible Score
  context, proposed-action confirmation, and shared execution handlers.
- [ ] Resolve natural start-set drafts from current piece/Region/page context and
  accept deterministic spoken confirm/cancel without a write beforehand.
- [ ] Add a direct, date-scoped Today intention field and include it in Brain
  context.
- [ ] Add a prominent truthful guide in Settings with the golden flow, exact
  commands, natural-language behavior, confirmation safety, and known limits.
- [ ] Add system-integration tests covering question → Brain voice request,
  context parity, draft → confirm once, cancel → zero writes, and running
  metronome → drill retune without restart.
- [ ] Run focused suites, `npm test`, `npm run build`, and `cargo test`.
- [ ] Have a fresh-context verifier inspect code and exercise the built UI; fix all
  high/medium findings.
- [ ] Update every living document required by the vault UPDATE PROTOCOL.
- [ ] Bump to v3.1.0, build only the `.app`, back up the live database, quit the
  old process, install, relaunch, verify bundle/schema/data, commit, and tag.

## Follow-up Practice Operator track

- [ ] Implement the complete native capability registry and durable ActionDraft
  lifecycle with revision checks and relaunch recovery.
- [ ] Add voice/Brain tools for today's plan, week goals, Daily Work, calendar,
  session recap, and append-only correction.
- [ ] Add explicit diagnostic single-pass/observation semantics.
- [ ] Add native metronome ownership (`manual` vs `practice(set_id)`).
- [ ] Add provider-neutral local-model adapter only if latency/privacy testing
  proves it useful on Christian's hardware.
- [ ] Run packaged at-piano acceptance over Steinway noise before marking the
  Practice Operator complete.
