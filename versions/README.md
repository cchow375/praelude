# versions/ — immutable per-version records

Each shipped version of CodaKiller gets one sub-folder here holding its **immutable
record**: what that version was, what actually shipped, how it was verified, its honest
gaps, and its next steps. Once a version ships, its folder is **frozen** — touch it only
for factual corrections, never to log new work (new work goes in `docs/CHANGELOG.md` and,
when it ships, a *new* version folder).

## The version scheme (also in `../CLAUDE.md`)

- **App version** = a shipped milestone of the `.app` (semver-ish). Current: **v0.1.0**.
- **Phase ↔ version map:** P0–P2 → v0.1.0 · P3 → v0.2.0 · P4 → v0.3.0 · P5 → v0.4.0 ·
  P6 → v1.0.0. (Full roadmap: `docs/ROADMAP.md`.)
- **The living codebase is the git repo.** Old code is preserved as **git tags**
  (`p2-done` = v0.1.0), never as duplicate copies of the source (avoids gigabyte
  `target/`/`node_modules` clones — git is the archive).
- **Every version record ends with explicit NEXT STEPS**, so re-entry is always clear.

## Records on file

| Version | Phases | Git tag | Folder | Status |
|---|---|---|---|---|
| v0.1.0 | P0–P2 | `p2-done` | `v0.1.0/` | 🟢 shipped 2026-07-09 |

## How to file a new version (when the next milestone ships)

1. `git tag vX.Y.Z` at the shipped commit.
2. Create `versions/vX.Y.Z/README.md` from the v0.1.0 record as a template: what it is,
   what shipped, verification evidence (link `docs/qa/*`), honest gaps, next steps.
3. Add the row to the table above.
4. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
5. Run the full `CLAUDE.md` update protocol (changelog, portable summary, roadmap, flaws).
