# v7.0.1 QA record — 720×520

All shots captured with `npm run qa:shots -- <name>` against `npm run dev:mock`
(http://localhost:1420) at exactly **720×520**, which is the app's configured minimum window
size (`src-tauri/tauri.conf.json`: `minWidth: 720, minHeight: 520`). Spec §8.2 requires
dense-fixture screenshots at this size; §4b requires that the shot show **the affordance**, not
just the feature in use.

**These are mock-data shots.** They prove layout, affordance and reachability. They do not prove
anything about Christian's real library — the owed v7.0.0 acceptance QA on the installed app with
the live database is a separate, still-outstanding item.

## Before

| Shot                                           | What it shows                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before-today-720x520.png`                     | v7.0.0 baseline. No mic control anywhere in the rail; the dock pill row carries no label; the rep HUD is auto-collapsed.                                                                       |
| `B82-verdicts-hidden-by-default-720x520.png`   | **B82.** Default state at the floor size — Clean / Sloppy / Again are not rendered at all (measured 0×0).                                                                                      |
| `B82-verdicts-after-manual-expand-720x520.png` | The same window after clicking "Expand set": the buttons are 131×52 / 117×52 / 117×52, `bottom: 365` in a 520px viewport — **155px of headroom**. The collapse was not buying space it needed. |

## After

| Shot                                     | What it shows                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B82-fixed-verdicts-visible-720x520.png` | **B82 fixed.** Verdict buttons present with zero interaction.                                                                                                                               |
| `C3-mic-toggle-rail-720x520.png`         | **Three fixes in one frame:** the labelled **Mic** control in the rail (C3), the verdict buttons visible by default (B82), and the **"Tools"** label on the pill row (§4b visibility pass). |
| `v7-galaxy-clear-720x520.png`            | Universe/Practice Universe at the floor size with panels minimized — renders cleanly; a minimized Rep Counter correctly becomes a labelled pill.                                            |
| `v7-galaxy-scrolled-720x520.png`         | The composer-grouped repertoire index below it.                                                                                                                                             |
| `B1-subsection-hint-720x520.png` | **B1 unlocked.** Selecting a section shows a hint naming the section and the gesture: *"Drag inside **Opening theme** on the score to isolate a spot — a 2-beat or 5-note micro-target inside this section."* The order note underneath repeats the rule. |
| `B1-add-defaults-to-subsection-720x520.png` | **"+ Add" repaired.** With a section selected the form opens with **☑ Sub-section of Opening theme** checked — the default is now the child, and the checkbox is the visible way to opt out. |

### The B1 gesture was not merely undocumented — it was broken

Worth recording separately, because it changes what B1 actually was. `RegionOverlay.tsx:287`
called `event.stopPropagation()` on every box's `onPointerDown` unconditionally, so a drag that
**started inside a selected section's box** never reached the overlay handler that arms the
create-drag. The intuitive gesture — select the box, then drag inside it — therefore did nothing.
Sub-sections could only ever be created by dragging somewhere *not* covered by a box while a
parent happened to be selected. That is very likely why the live database shows no evidence of a
single sub-section ever being made: the documented mental model and the only working gesture were
different things. Fixed by stopping propagation only when the box is **not** selected, pinned by
two `RegionOverlay.test.tsx` tests.

## Observations recorded rather than fixed

1. **The Rep Counter occludes most of the workspace at 720×520** (`v7-galaxy-720x520.png`). It is
   a floating dock panel, draggable and minimizable, and while practising it is the thing you want
   in front — so this is working as designed. But note the B82 fix makes the panel taller than the
   old auto-collapsed state, so it occludes _more_ than before at the floor. The trade is correct
   (the verdict buttons must be visible), and the user can minimize it to a pill in one click.
2. **Opening the Dynamics panel overlaps the Rep Counter** at the floor size
   (`v7-galaxy-panel-minimized-720x520.png` — the filename is a misnomer; the click landed on the
   Dynamics pill). Its default position is clamped upward into the rep panel and it covers the
   attempt-note field and clips the bottom of the verdict row. This is the **B78** dock-residual
   class, now with a concrete reproduction at the floor. Recorded against B78 rather than opened as
   a new flaw.
3. **The Dynamics panel's empty state is already exemplary** and worth copying elsewhere: _"NOT
   CALIBRATED — No calibration for this piano yet, so there is no band to place this level on. The
   raw level is honest; a band would be a guess."_ That is precisely the §4b teaching empty state.
4. **A large blank band sits between the Universe header and the repertoire index** in the mock
   fixture. This may be the sparse low-data galaxy state the spec flagged under E3 ("can read as
   broken rather than sparse-on-purpose"), or simply mock data. **Not diagnosable from mock data**
   — recheck on the installed app against the real library.
5. **No streak zero-state shot exists.** The mock fixture computes a non-zero streak from seeded
   session data that is not reachable via a URL hash and survives clearing localStorage, so the
   zero state could not be produced in the browser without deeper devMock changes. The behaviour is
   pinned by unit tests in `src/features/streak/StreakLine.test.tsx`; there is no screenshot, and
   this note exists so nobody assumes there was one.

6. **The B4 fix's wide-window behaviour was reasoned about, not visually confirmed.** The fix
   changes `.region-canonical-fields` from a fixed two-column grid to
   `repeat(auto-fit, minmax(9rem, 1fr))`, which in principle could yield more than two columns in a
   wide container and move "Save section" away from the right edge. I could not expand the section
   inspector under the headless browser to measure it. By arithmetic it stays at two columns for
   any container narrower than ~470px, and the sections aside is 340–420px
   (`--score-sidebar-width`), so the wide layout should be unchanged; and even at three columns the
   result is trailing empty space, not the overlap B4 describes. **Recheck by eye on the installed
   app** — this is reasoning, not a measurement.
