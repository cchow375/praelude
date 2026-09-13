# (C) v0.3.1 — Version Record

> **Immutable once filed.** Shipped **2026-07-12**, commit `28940ab`, git tag `v0.3.1`, installed at
> `/Applications/CodaKiller.app`. Patch to [[(C) v0.3.0 — Version Record]].

## What this version IS

The release-identity hotfix. v0.3.0 contained the Foundation code, but its unchanged first screen
and an indexed build artifact made the update look ambiguous. v0.3.1 makes the running release
obvious and leaves macOS with one discoverable app.

## What changed

- Top-left **v0.3.1** badge sourced from the package version.
- Practice landing marker: **Foundation installed**, with the new entry points named.
- Generated Tauri `.app` unregistered and removed after installation; `/Applications` explicitly
  registered as the single launch target.

## Verification

- Filesystem search and Spotlight each return exactly `/Applications/CodaKiller.app`.
- Running installed bundle reports 0.3.1.
- Dark visual pass confirms the badge and Foundation marker are clear without blocking the list.
- Frontend **24 files / 127 tests passed**; TypeScript/Vite production build passed.
- Rust **216 unit + 13 integration tests passed**, 5 live/hardware tests ignored; strict clippy passed.
- Real database remains schema v3 with `integrity_check = ok` and no FK violations.

## Honest gaps

- This fixes release ambiguity; it does not replace the pending real at-piano acceptance run.
- Rebuilding will recreate the target bundle, so every future install must repeat the documented
  unregister/delete/register cleanup.

## NEXT STEPS

1. Christian opens the only Spotlight result and confirms the top-left badge says **v0.3.1**.
2. Run the real at-piano acceptance block.
3. Log friction, tune, then plan P4.
