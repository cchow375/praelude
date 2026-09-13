# CodaKiller v0.6.0 — Version Record

> **Shipped:** 2026-07-12 · **Phase:** P5.5 · **Commit:** `256f16e` · **Tag:** `v0.6.0`
> **Installed:** `/Applications/CodaKiller.app`

## 🧭 Quick nav

[What shipped](#-what-shipped) · [Recovery](#-recovery-boundary) ·
[Verification](#-verification) · [Honest gaps](#-honest-gaps) · [Next](#-next-steps)

## 📅 What shipped

- Strict two-level big Goals → subgoals, editable dates/order/completion, safe ownership/delete,
  and summaries for both subgoal completion and linked Calendar work.
- A top-level Monday–Sunday Calendar with visible daily capacity, Goal path, piece, minutes,
  previous/next week, and explicit create/edit/move/done/dismiss/delete controls.
- Explicit **Schedule** forms on deterministic Goal suggestions. Provider output cannot schedule;
  suggestions without canonical Goal ownership remain read-only.
- Schema v5 `daily_work`: strict Gregorian dates/minutes/status/source, immutable `origin_date`,
  exact `reschedule_count`, optimistic write tokens, Goal ownership, and append-only admin events.

## 🔒 Recovery boundary

- Missed means only planned daily work scheduled before backend-local today.
- Preview is deterministic and writes nothing. Priority: earliest applicable parent/subgoal
  deadline → oldest miss → Goal order → work id.
- Every card requires Move, Done—I did it, Dismiss, or Leave unresolved. One explicit Apply
  revalidates all tokens/dates/deadlines/capacity and commits atomically or writes nothing.
- Moves keep the original date, increment provenance exactly once, stay within today + six days,
  never exceed daily capacity, and use at most half of a day's capacity.
- Calendar/admin actions never create practice time, active days, reps, verdicts, or Goal completion.

## ✅ Verification

- Frontend: **31 files / 165 tests**; production TypeScript/Vite build passed.
- Rust: **285 unit + 22 integration passed**, 5 hardware/live ignored; strict clippy passed.
- Real v4 database-copy rehearsal reached schema 5 idempotently, preserved all core counts,
  returned `integrity_check=ok`, and had zero foreign-key violations.
- Two adversarial review rounds plus a focused final review found and closed: wrong effective
  deadline, >half recovery, missing Goal work summary, Calendar/Goal draft loss, and incomplete
  move provenance. Final result: **APPROVED**.
- Installed bundle reports 0.6.0, is ad-hoc sealed, relaunches on schema 5, runs one process, and
  is the only filesystem/Spotlight copy.

## ⚠️ Honest gaps

- Christian reported the installed Calendar working, but the full Steinway acceptance run remains
  open. Terminal lacked macOS Accessibility permission, so native clicks were not falsely claimed.
- Old exact session history lives mostly in `session_event`; canonical `event` has only three admin
  rows. P6 must backfill reconstructable history idempotently before Universe metrics are honest.
- Home/Practice Universe, references, deep settings, final icon, and automated sealed DMG remain P6.
- No Developer ID certificate exists. v0.6.0 is honestly ad-hoc signed for this Mac, not notarized.

## ⏭️ Next steps

1. Lock and execute the P6 plan, starting with canonical historical-event backfill.
2. Build the honest Home/Practice Universe, references, settings, icon, and packaging pipeline.
3. Ship v1.0.0 only after one-app, migration, accessibility, visual, and end-to-end gates pass.

## Parent

- [[(C) CodaKiller Command Center]] · [[(C) Roadmap]] · [[(C) Changelog]]
