# CodaKiller v0.3.0 Foundation QA

> Date: 2026-07-12  
> Branch: `foundation`  
> Scope: Foundation Tasks 1–21

## Automated gate

| Gate | Result |
|---|---|
| Frontend tests | 24 files / 127 tests passed |
| Rust tests | 216 passed / 3 ignored |
| Rust lint | `cargo clippy --all-targets -- -D warnings` passed |
| Production web build | `npm run build` passed |

## Visual gate

The representative full application was exercised in dark mode with seeded Regions,
blocks, reps, goals, editable fields, and both floating panels. This caught and fixed:

- default Rep/Session panels covering the main practice surface;
- clipped context inside the active Rep HUD.

The corrected layout reserves a right gutter while a rep is active, starts Session collapsed
inside the top bar, and reflows the Rep HUD at narrow widths.

The in-app browser bridge disconnected after that pass and before a light-theme screenshot
could be saved. No screenshot or light-theme visual pass is claimed. Dark/light styling still
has automated token coverage; the honest remaining manual gate is a light-theme glance and a
real at-piano v0.3.0 session.

## Review fixes

- Preserve raised z-order on the final drag geometry commit.
- Start/stop the audio metronome when the block toggle says to use it.
- Retune a running metronome when the ladder advances.
- Catch UI event/invoke rejections instead of leaking unhandled promises.

## Next action

Run one real practice block at the Steinway in light mode: open a non-tempo focus with the
metronome off, record verdicts by voice, edit one rep, move both panels, then relaunch and
confirm the layout and history survived.
