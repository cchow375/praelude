# v8.1.0 — browser/devMock and installed-native visual QA

> **Evidence classes stay separate.** The first eight images were captured from the React
> source through the flag-gated `VITE_DEV_MOCK` browser harness. They prove the named UI rendered
> at the recorded viewport and was visually inspected. They do **not** prove a signed/package app,
> native IPC/SQLite, macOS microphone permission, physical STT suspension, MediaRecorder device
> ownership, kept-file storage/playback, CoreAudio, voice-over-Steinway behavior or Christian's
> at-piano acceptance. Installed-native evidence is listed separately and proves only what its
> exact screenshot/inspection says.

The main dev mock passes `assistantEnabled: false`, matching the shipped/default product decision:
Assistant is absent from the rail and Today in the installed release. This is not a
claim that browser hiding alone enforces the native provider gate; the Rust gate has separate
tests.

## Accepted frames

| Frame | Viewport | What was visually accepted | What it does not prove |
| --- | --- | --- | --- |
| `universe-momentum-720x520.png` | 720×520 | Practice level/XP and current progress are readable at the supported floor; entering Universe tucks the Rep Counter; no horizontal overflow. | Canonical live-DB totals, same-mount threshold announcement or native dock persistence. |
| `universe-momentum-1280x800.png` | 1280×800 | Full evidence dashboard hierarchy—level, XP, badge cabinet/next rails, cadence/progress—has room and is unobstructed. | Sustained motivation or any earned-state mutation. |
| `universe-shelf-720x520.png` | 720×520 | Repertoire shelf/progress presentation survives the compact viewport. | Real archived/deleted-file history aggregation. |
| `universe-empty-teaching-720x520.png` | 720×520 | Zero-evidence teaching is visible and explains the first completed focused minute without granting progress. | Native empty database or a real first XP transition. |
| `warmups-catalog-720x520.png` | 720×520 | Search/filter catalog, keyboard figures, paged cards and routine entry remain reachable at the supported floor. | Schema-18 storage, exact system-piece opening, hotkeys/voice, mastery advance or routine completion. |
| `listen-back-hud-720x520.png` | 720×520 | Review toggle/capture/review affordance fits inside the live Rep Counter and states that voice pauses for safety. | Any microphone permission, native capture lease, recording, playback, temp deletion or Steinway usefulness. |
| `score-movement-720x520.png` | 720×520 | Movement selector and score toolbar remain usable at the supported floor. | Schema-17 CRUD, actual PDF/page scoping or live Beethoven data. |
| `rotation-720x520.png` | 720×520 | The 360×160 Rotation setup panel is fully visible at `y=164`; its footer controls remain above the 56px Tools reserve, and the Tools row stays reachable. | Native dock persistence, an active timed cycle, chime, exact-block pause/switching or simultaneous fit with every other panel expanded. |

## Installed-native evidence

| Frame | Viewport | Accepted native fact | Still not proved |
| --- | --- | --- | --- |
| `universe-live-native-720x520.png` | Actual installed app at 720×520 | Live Universe rendered Level 7, 831 XP, 95% level progress, 9 XP to Level 8 and real current-record milestones without horizontal overflow. The active session remained safe and Rep Counter tucked into Tools. | Listen Back microphone hardware, voice-over-Steinway, other workspaces or every dock interaction. |
| `warmups-live-native-720x520.png` | Actual final installed app at 720×520 | Warmups rendered cleanly with no Rep Counter overlay or clipping. Tools exposed **Restore Rep Counter**; the active set remained unchanged while the panel was tucked. | Real routine execution, voice commands, microphone hardware, mastery advancement or at-piano usefulness. |

The earlier installed pass had exposed the open Rep Counter covering Warmups hero/search. The
first correction keyed compactness to zoom-scaled `innerWidth` and was refuted at the default 90%
interface scale; installed QA then refuted WebView outer bounds too. Final source HEAD
`1a1e38bb7a3757cf90ee6ea814e93d5971c595d6` uses Tauri native physical size/scale-factor logical
points, with native resize, stale-async cleanup and browser fallback. Only the final rebuilt frame
above is accepted release evidence; intermediate screenshots/builds remain diagnostic history.

## Interaction observations

- Universe deliberately tucks only the Rep Counter panel. It does not end or pause the active set;
  **Show Rep Counter** reverses the tuck.
- The 720×520 Universe and Warmups frames have no horizontal overflow. Warmups explicitly allows
  its layout/grid/heading children to shrink inside the effective 480px content stage instead of
  forcing preferred card widths past the canvas.
- Warmups renders the first 36 catalog cards and exposes **Show more**, keeping 118 entries from
  becoming one unbounded compact-window wall.
- Rotation's dense-floor contract reserves 56px above the bottom Tools band and clamps the unsafe
  generic restored/collision `y=360` to `y=164`. Drag and keyboard movement remain bounded inside
  the safe area. The frame proves the setup posture, not a running native cycle.
- Listen Back copy names the safety posture, but the browser mock cannot exercise native capture
  ownership. That acceptance remains in the release checklist.
- Movement scope is a toolbar filter; the source design does not cut or rewrite the PDF.
- With `assistantEnabled: false`, Settings keeps the Assistant enable switch discoverable but its
  default-open guide teaches only the hands-free practice lane; Assistant confirmation copy,
  provider furniture and Books are hidden, while **Voice settle delay** lives under Voice. This
  state is pinned by focused component tests; no dedicated Settings screenshot is claimed here.

## Release QA and remaining external acceptance

- [x] Final source-freeze frontend: 2,650 passed / 1 skipped / 0 failed (209 files passed / 1
      skipped). Native: 1,100 passed / 19 ignored / 0 failed. TypeScript, format, strict Clippy,
      production build, five narrated corpora and all eight release-script gates passed.
- [x] Installed-native Universe at 720×520.
- [x] Rebuilt installed-native Warmups at 720×520 after the recorded overlap correction.
- [ ] Remaining packaged-native interaction walkthroughs beyond the two accepted release frames;
      this is follow-up evidence, not a claim that Universe or Warmups remain unaccepted.
- [ ] Native Listen Back permission/capture/record/review/keep/delete/relaunch playback.
- [ ] Voice-over-Steinway and piano-useful playback verdict from Christian.
- [x] Live schema-19 graph verified after backup/install: integrity/FKs clean; only hidden Warm-ups
      piece added; blocks/reps/sessions/events/open-session unchanged; new feature tables empty.
- [ ] One real measure-map Apply remains separate and externally blocked by provider/live use.

## Next steps

Keep the two evidence classes distinct. Next, run Listen Back and the voice path at the Steinway;
with explicit score-upload authorization and a configured provider, review and Apply one real
current-edition mapping; then record a sustained-use motivation verdict. Extend installed/native
evidence only with exact observed facts—never upgrade these frames into microphone, Steinway,
provider-mapping or sustained-use evidence they cannot provide.
