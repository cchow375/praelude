# CodaKiller repository entry point

The binding project context and operating manual live in the Obsidian vault:

`/Users/c3/Desktop/christian's universe/Piano Practice/CodaKiller/AGENTS.md`

Read that file completely, then open `(C) CodaKiller Command Center.md`. Code and engineering docs
stay in this repository; product truth, Roadmap, Flaws, Changelog, tutorial, and version records
stay in the vault. After **every** code/doc/decision change, obey the vault UPDATE PROTOCOL before
reporting completion.

Current boundary: `/Applications/CodaKiller.app` is **v7.2.0**, installed 2026-08-27 on unchanged
schema 16. Its source gates are green (frontend 2,499 pass / 1 skip; native 1,049 pass / 19
ignored; TypeScript and strict clippy clean; five narrated corpora at zero false mutations), all
eight release-script gates passed, the installed bundle/signature/DMG were verified and the live
database was identical before/after. Tag `v7.2.0` points to release commit
`7a5061d57fc6197b53e2601ca788f186d1fc7c83`. Christian's native/at-piano acceptance verdict remains owed.
Assistant work remains out of scope:
it stays switched off and gated until Christian explicitly resumes it. See:

- `docs/superpowers/specs/2026-08-24-aug8-practice-overhaul-design.md`
- `docs/superpowers/plans/2026-08-26-p2-micro-targets-v2-and-set-completion.md`
- `docs/qa/v7.2.0/README.md`
- `NOTES.md` (newest decision block first)

Preserve the user-as-sensor boundary: speech may describe practice; the app never interprets piano
audio as musical evidence. Preserve Christian's live history and rehearse schema changes only on
verified disposable copies before touching the installed database. v7.2.0 keeps schema 16, so no
migration rehearsal is required; that does not remove the pre-install backup, rollback, integrity
or before/after count checks required by the vault release protocol.
