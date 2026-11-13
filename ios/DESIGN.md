# Praelude for iPhone and iPad

**Current source: iOS2.0.0/build4 DEVELOPMENT CANDIDATE · 2026-10-02.** Native SwiftUI for
 iOS/iPadOS17+, with schema4 local storage and configured Supabase support for native records.
The pianist supplies every verdict. New installations are blank; the Mac schema21 database is
separate. A reviewed Mac snapshot can be imported while retaining all original history, without
inventing native mastery. Current scope and hardware gates live in [the mobile roadmap](docs/ROADMAP.md)
and [current QA](../docs/qa/ios/2.0.0/README.md). The older acceptance matrix below is historical
1.0 evidence, not proof of current-feature or physical acceptance.

## Design direction

The score and the next useful action deserve the most space. Use large titles, native lists, and
generous spacing. Color and type follow the monochrome design system in
[`(C) Design System.md`](docs/%28C%29%20Design%20System.md) — paper/ink in light, stage
(black lacquer) in dark, with one rare warm accent reserved for live states (a listening
microphone, a set being practiced now), never a decorative indigo/blue action tint. There are no
decorative gradients, glowing backgrounds, hero slogans, dashboard cards inside cards, or
fabricated activity. Musical titles, composer names, and the actual score are the visual identity.

Materials belong to the controls above the content. Prefer the system's presentation, tab bar,
toolbar, and sheet materials. Keep the score paper opaque and legible. Custom glass is limited
to the small practice controls; disabling transparency must preserve clear boundaries.
This follows [Apple's material guidance](https://developer.apple.com/design/human-interface-guidelines/materials),
which reserves Liquid Glass for a distinct controls/navigation layer and recommends restrained use.

## Navigation and hierarchy

- **iPhone:** a small set of labeled bottom tabs leads to Today, Pieces, Warmups, Progress, and a deliberate More list. Settings is
  a toolbar action. Each tab preserves its position. A score opens as a focused reading/practice
  destination with a clear return path. The active set remains resumable from Today.
- **iPad:** use native navigation suited to the available width, with a collapsible sidebar and
  a generous content area. When the window is narrow, collapse to compact navigation. At
  accessibility text sizes, use full-width tabs to keep navigation labels readable.
- **Today:** one prominent Resume/Start action, recent pieces, and a small summary of recorded work.
  An empty Today explains how to import a score; it contains no sample progress.
- **Pieces:** a searchable, sortable library with title, composer, page count, and last practice.
  Opening a piece leads directly to its score. Editing metadata and resting a piece belong to
  contextual actions. Resting is reversible and keeps the history.
- **Progress:** recorded sessions and effort totals, with modest commitment feedback. An explicit
  explanation says progress reflects practice recorded, not musical ability.

Apple recommends few, stable, labeled navigation destinations, avoiding overflow tabs; actions
belong in toolbars rather than navigation tabs. The native iPad tab bar can adapt to a sidebar.
See [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and
[Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars).

## Score and practice

1. Open the piece and immediately show a fit-page score. Preserve page and zoom. Single-page is
   the default; next/previous page controls remain explicit. Support pinch zoom and natural paging.
2. Before a set starts, show only passage identity, tempo, and Start set. A focused setup sheet
   contains the optional practice focus, clean-streak/total-plays target, tempo ladder, and variants.
3. During a set, show the current goal count and three large, labeled verdict controls: Clean,
   Sloppy, Again. Undo stays reachable. Recording a verdict must commit locally before celebration.
4. A tempo control opens the metronome controls. BPM, +/- adjustment, Tap tempo, and Start/Stop are
   immediate; meter, subdivision, accents, and sound configuration live below the essentials.
5. Completion is a brief, earned response that leaves the score stable. Optional audio/haptics
   are independent of the save operation. No rank overlay blocks the next repetition.
6. A deliberate reading/focus mode may hide practice controls while retaining page turns and
   a visible exit. Editing and passage-selection gestures must not be active in this mode.

The score interaction direction is consistent with established musician tools: forScore documents
[tap/swipe page turns](https://forscore.co/kb/turning-pages/) and a
[performance mode](https://forscore.co/kb/performance-mode/) that disables unrelated gestures and
enlarges the next-page area. Its [audible and visible metronome modes](https://forscore.co/kb/metronome/)
also illustrate how timekeeping can coexist with an unobstructed score. These are precedents for
our design decisions, not claims that Praelude implements every forScore feature.

## Sheets, inspectors, and windows

Use one focused presentation at a time. iPhone uses a medium/large sheet for short contextual
tasks and a full-height form for longer editing. iPad uses a native form sheet for metadata and
an anchored popover or optional trailing inspector when the score must remain interactive.
Cancel is leading; Save/Done is trailing when the task commits a draft. Errors stay in the active
presentation. A dismissed draft must not silently save or destroy a live set.

Separate windows are useful for an explicitly opened second score or reference. They must use
system window chrome and adapt to resizing. Do not automatically create a window for each tool
or imitate draggable desktop windows inside an iPhone screen. All windows share the same practice
state; they must never create competing active metronomes or duplicate repetitions.

This follows [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets),
[Windows](https://developer.apple.com/design/human-interface-guidelines/windows), and
[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados):
retain context, minimize unnecessary modal transitions on the larger display, and avoid clutter
from excessive windows.

## Pencil and annotation direction for the next milestone

Keep an explicit annotation mode with a small native tool surface. Default to Pencil input while
fingers retain reading/zoom behavior; offer a clearly labeled finger-drawing option for musicians
without a Pencil. Undo for marks belongs to that editing context; practice Undo continues to mean
the latest verdict. A page change, background transition, or window closing must not discard marks.

forScore demonstrates useful details: optional automatic Pencil entry/exit, prevention of finger
drawing, separate annotation layers, and symbols/text as distinct tools. Adopt these selectively;
each adds interaction and persistence obligations. A compact Pencil/eraser workflow does not imply
layers, stamps, text tools, document editing, or complete forScore parity.
[forScore's annotation guide](https://forscore.co/documentation/annotation/).

Use public `PDFPageOverlayViewProvider` with PencilKit for page overlays. Apple supplies overlay
layout and rotation handling and documents the view lifecycle. Store drawing data outside the
ephemeral overlay, keyed to stable piece/page identity, and persist edits through the same durable
store boundary. Reopening must rebuild the canvas from stored data. Do not depend on PDFKit's
private view hierarchy for placement or retain the canvas as the only copy.
[Apple's PDFKit overlay presentation](https://developer.apple.com/videos/play/wwdc2022/10089/).

Editable PencilKit data and a portable annotated PDF are separate artifacts. Apple describes PDF
annotation appearances and optional burn-in when exporting. The 1.1 candidate now renders a new
sharing/printing PDF with flattened ink, keeping the source and editable drawing unchanged. Passage
boxes stay out of that exported copy. Verify marks on rotated/cropped pages and at different zoom
levels using actual Pencil input and native tests; three iPad hosted export tests now cover render alignment, while share/Print UI and physical output
acceptance remain pending. Recorded practice also opens a read-only original-target view, so later passage edits
do not rewrite what a session meant. See [the candidate usage guide](docs/USING_MOBILE.md).

## Accessibility and musician ergonomics

- Native Dynamic Type, VoiceOver names and values, predictable focus, and system contrast colors.
- At least 44 × 44 pt for every interactive target; primary rep and transport controls should be
  about 60–72 pt high so they can be reached from the piano bench. The larger size is our ergonomic
  design choice above [Apple's minimum target guidance](https://developer.apple.com/design/tips/).
- Prefer 17 pt body text and clear tabular numbers. At accessibility sizes, stack controls and let
  sheets scroll instead of clipping or shrinking type.
- Respect Reduce Motion, Reduce Transparency, and Increase Contrast. Do not convey a verdict
  exclusively by color, audio, motion, or vibration. See
  [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- Keep the display awake only during score reading or active practice, restore normal behavior
  on departure, and preserve a set across interruptions. Handle audio interruption and route change.
- Support portrait, landscape, compact iPad windows, hardware keyboard, and touch. Pencil drawing,
  external page-turn pedals, and speech must be described according to verified implementation.

## Native scope and desktop differences

This matrix is the implementation/acceptance contract. A checked-in feature still needs the
corresponding simulator or hardware evidence before it can be described as accepted.

| Area                | iPhone/iPad contract                                                                                                                                 | Difference or acceptance boundary                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Library             | Local pieces, imported PDF, metadata, reversible resting                                                                                             | App sandbox owns imported copies; no absolute Mac file paths                                        |
| Score               | Native PDF reading, page controls, zoom, retained position                                                                                           | PDFKit replaces desktop PDF.js/custom protocol                                                      |
| Practice            | User-supplied verdicts, durable history, resumable sets, undo                                                                                        | Native store is independent; no automatic Mac database migration                                    |
| Targets             | Clean streak and fixed total plays                                                                                                                   | Must preserve the meaning of each verdict; no invented musical judgment                             |
| Tempo/variants      | 1–100 count targets,20–300 BPM, fixed/percentage ascent, ordered stage targets, saved editable routines                                              | No desktop demotion/mastery-proof policies or multi-set parking; one running/paused set at a time   |
| Metronome           | Offline timekeeping and interruption handling                                                                                                        | Native audio implementation; hardware output remains a device check                                 |
| Progress            | Recorded effort and history, commitment-based recognition                                                                                            | Desktop furnished Studio and coin inventory are not automatically migrated                          |
| Goals/calendar      | Optional goals with piece/date/completion; browse sessions by date                                                                                   | No imposed plan, reminders, or scheduled notifications; daily records group sessions by start date  |
| Voice               | Explicit opt-in on-device US English final-phrase commands; no server fallback                                                                       | Narrower vocabulary than Mac; microphone/acoustic reliability needs device acceptance               |
| Score markup        | PDF reading and measure-range passage records                                                                                                        | PDF ink/Pencil editing, geometric score marks and mapping tools are unimplemented in this candidate |
| History and warmups | Native current-set Undo plus session/attempt inspection                                                                                              | Full historical repair UI, desktop warmup library and teaching tools are unported                   |
| Mapping/Assistant   | Do not imply unavailable capability                                                                                                                  | Assistant remains off/on hold; cloud mapping is a separate feature boundary                         |
| Backup              | Explicit validated export/import; read-only recovery copies and byte-verifies the original before replacement; unreadable fallback export is refused | Files sharing is not account sync; no implied iCloud multi-device sync or Mac migration             |
| Distribution        | Xcode simulator/device target; candidate1.0.0/build1                                                                                                 | App Store/TestFlight require signing and distribution work plus device QA; candidate is not shipped |

## Acceptance checklist

Current simulator evidence is bounded: all eight distinct iPad UI scenarios and seven of eight
iPhone scenarios pass across runs, including corrected large-text checks on both. The complete
iPhone backup UI scenario remains open; iPad backup UI is accepted. The final unsigned Release
build passes on the exact current source. No all-green full-suite or physical-device acceptance
is claimed.
See [the native guide](README.md#verification-and-remaining-acceptance) for current evidence.

Verify blank first launch; Files import and cancel; long composer/title; score return and page
restoration; both target modes; Sloppy/Again/Undo; set completion; interruption and relaunch;
backup validation; dark/light appearance; largest Dynamic Type; VoiceOver; 320 pt compact width;
phone landscape; iPad full screen and resized windows. Use only disposable fixture data during QA.
Real-device audio, speech, keyboard-style pedals, and signed distribution are separate claims
requiring separate evidence. PDF ink/Pencil editing requires implementation before acceptance.
