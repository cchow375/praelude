# Build11 — readable and resizable sticky notes

Updated October 10, 2026. Native2.0.0/build11/schema5 is first-installed on the friend’s exact
`iPad (6)` (iPad8,5, iOS18.7.8), source `646fd6cd26fd6fe6ef81df0dd22da9cdd59fb2d9`, tag
`ios-v2.0.0-build11-candidate`. Christian’s personal iPad remains10; Macv11.1.0/schema21 is unchanged.
Prior app absence is verified: no previous owned inventory exists for comparison and no personal
data was copied. Guarded helper install/version checks and independent actual post-helper signing
pass. Automatic launch is denied; readback confirms installed11 but no running process. User opening/
trust and initial-library readback remain pending. [Install record](friend-ipad-install.json) and
[actual signed artifact](friend-signed-release.json) retain the separate results.

## Feedback and acceptance boundary

Christian replies “good it works better” after the build10 Prokofiev/Beethoven selection and Cancel
comparison. Record that as qualified improvement, not acceptance of every score, measured latency,
zero defects or a week-long trial. Build10 evidence remains in
[selection consistency](../build10/selection-consistency.md), including earlier failed runs.

The new request is B148: make sticky-note text readable and adjustable, support box resizing and
put formatting below the writing area. This is separate from the earlier selection repair.

## Candidate implementation

- `TextAnnotationStyle` stores size20 by default (12–48), system/serif/rounded/monospaced font,
  bold, italic, black/blue/red/green/purple text and leading/center/trailing alignment.
- Text size uses a canonical 595-point page-width basis, scaled against the original source page.
  A PDF with thousands of media-box points must not shrink a readable note into tiny text.
  `TextAnnotationRenderer` is shared by the overlay and vector-text PDF export. It lays out fonts
  in canonical595-point space and scales the CGContext, keeping layout independent of source units.
- The overlay work makes note text visible and adds eight-screen-point corner resize handles.
  Moves/resizes must change only the chosen annotation region and preserve its text/style/layer/ID.
  Opposite corners, page-edge bounds, crop/rotation and ordinary/oversized pages require checks.
- The note editor retains text/dictation/error handling and puts scrollable formatting controls
  under the writing area, with a live preview. Save commits; Cancel leaves saved content unchanged.
- `TextBoxAnnotation.style` is optional on decode. Legacy notes receive readable defaults, with no
  schema bump or eager rewrite on opening. Store validation rejects nonfinite/out-of-range size
  before publishing or rewriting the library. Backups carry the same style and geometry.
- Sync keeps the existing SQL column set. `annotations.region` remains an object with original
  x/y/width/height and nested `textStyle`; no undeployed SQL column or migration is required.
  Old `NormalizedRect` readers still decode geometry, while stamp payloads remain unchanged.
  An older client can discard unsupported style when rewriting a note; updated clients are
  required for style-preserving edits. Real-account two-device behavior is a separate gate.

## Evidence ledger

| Gate | Result / evidence |
| --- | --- |
| Core model/persistence/sync | PASS: all420 core tests,0 failures; `core.log`, reported by root runner October10. Eight new `TextAnnotationStyleTests` are included. |
| Legacy opening | Core test proves existing schema5 file bytes, revision, note text/geometry/clocks remain unchanged on opening. |
| Save/reload/backup/restore | Core test preserves style and resized region; invalid size rejects atomically; synced tombstone/remote timestamps survive. |
| Wire shape | Core test checks exact existing top-level column names, optional nested `textStyle`, old geometry decoding and unchanged stamp region shape. SQL contract inspected at `20260926220003_library_sync_tables.sql`; no new backend deployment claimed. |
| Native attempt1 | Compilation stopped while an overlay edit was incomplete (`updateNoteHandles` / `fullPageWidth` undefined). No tests executed; retained separately from native2 below. |
| Native2, before latest editor follow-up | PASS:63 tests,0 failures in11.176s. AnnotationInteraction14, NoteOverlay6, PassageSelection6, ScoreExport7, ScoreMarkup28, TextAnnotationRendering2. Evidence: `/tmp/praelude-build11-native2.xcresult` and `/tmp/praelude-build11-native2.log`. Includes panel overlap, styled vector export and strict ordinary/oversized glyph-mask comparison. |
| iPad4 native, before authoritative move receipt | PASS:63 selected tests,0 failures in11.223s. The later saved-note receipt callback and seventh note interaction regression are not included; iPad5 below verifies the later fix. |
| Final-source iPad5 native | PASS:64 tests,0 failures in5.446s (5.821s selected-suite wall time). Includes NoteOverlay7 with the authoritative saved-note receipt regression. Evidence: `/tmp/praelude-build11-ipad5.xcresult` and `/tmp/praelude-build11-ipad5.log`. |
| Final-source actual note UI | Mixed: oversized full create/resize/format/save/relaunch PASS1131.493s; ordinary FAIL184.170s before note interaction at `openScore` line19, UI query timeout. Overall command ends `TEST FAILED`. Observed host load144 does not prove the sole cause or establish app responsiveness. |
| Editor ordinary/accessibility layouts | Final oversized flow passes. Earlier iPad4 ordinary Save/reopen size24 is partial evidence on earlier source. Current ordinary complete flow, broader accessibility and optional phone checks remain unaccepted; they are not called passed to expedite delivery. |
| Independent source/visual review | Fresh review accepts the final renderer, routing, editor and saved-note receipt fixes. Final native regression passes. Screenshots are retained below; source review does not establish physical note acceptance. |
| Device Release/signing | PASS on clean targeted Release and independently on actual post-helper artifact. Initial incremental sealed-resource failure retained below. Actual executable SHA-256 `ce2373e0e3a61116072ddddbd8e9e219f6faa8d025a528f7683a577d12daf0cd`; profile expires2026-10-17T16:14:24Z (12:14 PM EDT). |
| Requested installation | PASS: guarded `ios:install` verifies build11 on exact friend’s `iPad (6)`. First generic empty install; prior app absence verified, no prior inventory comparison, no copied personal data. Personal iPad remains10. |
| Launch/readback | Automatic launch denied. Fresh device readback confirms installed11, process false. User asked to open/trust; confirmed launch and initial-library inspection pending. |
| Physical note acceptance | Pending. |

## Retained attempts and source follow-up

- **Native attempt1:** compilation stopped during a partial overlay edit; `updateNoteHandles` and
  `fullPageWidth` were not yet defined. No tests executed. This remains separate from the next
  source-frozen run.
- **iPad1, original binary:** both actual UI cases create notes and resize corners, then fail to
  reveal formatting after the row-center tap lands in plain-label whitespace.
  `increaseNoteTextSize` never appears; the recorded assertion at test line64 fails. Root adds
  `contentShape(Rectangle())` to the full44-point row. iPad1 uses the original binary and cannot
  validate the repair. Later attempts are recorded below.
- **iPad1 native subset:**62 tests execute;61 pass and1 fails. Ordinary/oversized glyph-mask overlap
  is0.169 against a strict greater-than0.95 requirement. The renderer now lays out text with fixed
  canonical595-point fonts/rectangles and scales the CGContext, rather than changing font/layout
  size with the source page. The same strict glyph test passes in native2; no threshold was relaxed.
- **Fresh source review:** a note corner can overlap the floating panel. Touch routing now gives the
  panel priority, with a sixth `NoteOverlayInteractionTests` regression. Reviewer `undo_review`
  accepts this, the full-row hit target and final renderer fixes. Native2 passes all63 selected
  checks on that source. This pass precedes the later editor follow-up and is not a physical note result.

- **iPad2:** the command reports `TEST SUCCEEDED` but executes **zero tests**. It supplies no
  actual UI acceptance and is not counted as a passing rerun.
- **iPad3:**2 actual UI cases execute. Ordinary-page create/resize/format/save/relaunch passes in
  59.990s. The oversized-page case fails after relaunch: expected font size24, actual20. Save had
  not dismissed the sheet or committed the draft; do not describe the unsaved draft as saved data
  being lost. The follow-up resolves the durable note before editing, pins the exact save error and
  retains the compare-and-swap guard. Subsequent iPad4/5 evidence is recorded separately below;
  the earlier core420/native63 results remain scoped to their tested sources.

- **iPad4, before authoritative move receipt:**63 selected native tests pass in11.223s;2 actual UI
  cases fail. Ordinary-page Save commits and dismisses, and the reopened collapsed formatting row
  displays size24. The next formatting-row tap does not expand it, so the full case fails. The
  oversized-page case misses the entry Draw tap and never obtains a text tool. The cause of these
  UI misses is not proved; do not attribute them to a specific note defect or dismiss them as flaky.
- **iPad4 simulator observation:** the disposable simulator temporarily shows a blank app during
  relaunch. Read-only sample `/tmp/praelude-build11-ipad4-launch-sample.txt` mainly contains
  UIKit/SwiftUI focus/layout work. Fresh review identifies no specific note cause from that sample.
  The disposable simulator is restarted before the next frozen-source run; this does not
  change or reinstall the user's iPad, which remains on build10.
- **Saved-note receipt race:** fresh review finds that consecutive drag gestures can reuse an older
  timestamp while waiting for view reconciliation. The move callback now returns the authoritative
  saved note immediately so the next gesture uses its current timestamp. Fresh source review accepts
  the fix; its seventh `NoteOverlayInteractionTests` regression passes in iPad5.
  iPad4 predates this callback change and cannot validate it.

- **iPad5, final frozen source:**64 native checks pass in5.446s (selected-suite wall time5.821s).
  The oversized actual UI flow passes1131.493s. Ordinary UI fails184.170s at pre-note `openScore`
  line19 with “Timed out while evaluating UI query.” Overall xcodebuild reports `TEST FAILED`.
  Host load144 is observed during this run; it is context, not proof that all UI failures are
  environmental. These unusually long simulator durations cannot support a responsiveness claim.

## Retained screenshots

- [Oversized note selected](screenshots/build11-large-note-selected.png),
  [resized](screenshots/build11-large-note-resized.png) and
  [formatting](screenshots/build11-large-note-formatting.png): final iPad5.
- [Ordinary note selected](screenshots/build11-ordinary-note-selected.png): earlier iPad4.

Screenshots show their named states, not an additional passing workflow or physical-device verdict.

## Requested delivery target and installation

Christian explicitly requests immediate build11 delivery to the most recently connected friend's
`iPad (6)`. Developer Mode/DDI are ready. Prior app absence is verified, so the guarded helper performs
a fresh generic empty first install and verifies version/build11 on that exact target. No scores,
practice history, account or personal backups are copied. This supplies no prior-data preservation
comparison. Christian’s personal iPad remains10 and unchanged. Optional phone/layout checks are
deferred without claiming they passed.

Independent pre-install review passes, including only13 expected code/signing/art/font/privacy
bundle files and no personal resources. The helper rebuild changes the executable, so the actual
post-helper artifact is independently reverified and privately archived. Strict signature, profile/
target, signer trust, Release fixture/debug exclusions and app/dSYM checks pass. Its executable
SHA-256 is `ce2373e0e3a61116072ddddbd8e9e219f6faa8d025a528f7683a577d12daf0cd`; profile expiry is
October17 at16:14:24 UTC (12:14 PM EDT). Exact sanitized evidence is in
[friend-signed-release.json](friend-signed-release.json).

Automatic launch is denied. Fresh device readback finds build11 installed with no running process.
The user has been asked to open/trust the app. Successful opening, initial-library inspection and
physical note acceptance remain pending in [friend-ipad-install.json](friend-ipad-install.json).

### Retained target packaging attempt

The first targeted Release build succeeds, but strict signature verification fails sealed-resource
checks for `Assets.car` and `embedded.mobileprovision`. Independent review finds that Xcode's
incremental build did not execute CodeSign. The invalid artifact is archived privately; a clean
targeted Release rebuild resolves the failure before installation. No certificate, key or profile
bypass is used. Both pre-install checks and independent checks of the actual helper-built artifact
pass afterward; the failed attempt is retained rather than replaced by the successful result.

## Scoped verification plan and remaining acceptance

- Native tests cover the shared renderer/export and geometry contracts, including all resize corners,
  crop/rotation, bounds and locked notes. Source/vector and pixel checks do not establish visual PDF
  export acceptance.
- Two actual UI cases exercise ordinary and oversized pages: create a note, resize, format, save and
  relaunch. Record their exact assertions and results; do not infer every possible interaction passed.
- A short-landscape phone check can establish formatting and Save/Cancel reachability for the tested
  layout. Broader accessibility, keyboard-visible layouts and visual PDF comparison remain separate
  acceptance checks unless actually performed.
- Independent source review and final target-specific signed-device checks precede delivery.
  The verified fresh-install baseline replaces a personal-device same-bundle inventory comparison
  for this friend target. Post-launch readback and physical note acceptance remain separate.
  Retain failed or zero-test attempts instead of replacing their record.

**Next steps:** confirm the friend opens/trusts the installed app, then inspect the initial library
and obtain the physical note verdict. B148 and unmatched UI/accessibility acceptance remain open.
No full-app, zero-defect, responsiveness or week-long reliability claim is supported.
