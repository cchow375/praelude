# Praelude for iPhone and iPad

**iOS1.0.0 DEVELOPMENT CANDIDATE · 2026-09-14.** This is a native SwiftUI implementation for
iOS/iPadOS17+ with its own local, device-private store. Its
contract is the same as the Mac app: **the pianist supplies the verdict; Praelude records it**.
It never estimates musical quality from microphone audio. A new installation starts blank.
Native data uses a sandbox-relative schema1 JSON store and owned PDFs; the separate installed Mac
v11.1.0/schema21 SQLite database is outside this target.

## Design direction

The score and the next useful action deserve the most space. Use the system font, large titles,
plain grouped surfaces, native lists, semantic colors, a single indigo action tint, and generous
spacing. There are no decorative gradients, glowing backgrounds, hero slogans, dashboard cards
inside cards, or fabricated activity. Musical titles, composer names, and the actual score are
the visual identity.

Materials belong to the controls above the content. Prefer the system's presentation, tab bar,
toolbar, and sheet materials. Keep the score paper opaque and legible. Custom glass is limited
to the small practice controls; disabling transparency must preserve clear boundaries.
This follows [Apple's material guidance](https://developer.apple.com/design/human-interface-guidelines/materials),
which reserves Liquid Glass for a distinct controls/navigation layer and recommends restrained use.

## Navigation and hierarchy

- **iPhone:** a small set of labeled bottom tabs leads to Today, Pieces, and Progress. Settings is
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

| Area | iPhone/iPad contract | Difference or acceptance boundary |
| --- | --- | --- |
| Library | Local pieces, imported PDF, metadata, reversible resting | App sandbox owns imported copies; no absolute Mac file paths |
| Score | Native PDF reading, page controls, zoom, retained position | PDFKit replaces desktop PDF.js/custom protocol |
| Practice | User-supplied verdicts, durable history, resumable sets, undo | Native store is independent; no automatic Mac database migration |
| Targets | Clean streak and fixed total plays | Must preserve the meaning of each verdict; no invented musical judgment |
| Tempo/variants | 1–100 count targets,20–300 BPM, fixed/percentage ascent, ordered stage targets, saved editable routines | No desktop demotion/mastery-proof policies or multi-set parking; one running/paused set at a time |
| Metronome | Offline timekeeping and interruption handling | Native audio implementation; hardware output remains a device check |
| Progress | Recorded effort and history, commitment-based recognition | Desktop furnished Studio and coin inventory are not automatically migrated |
| Goals/calendar | Optional goals with piece/date/completion; browse sessions by date | No imposed plan, reminders, or scheduled notifications; daily records group sessions by start date |
| Voice | Explicit opt-in on-device US English final-phrase commands; no server fallback | Narrower vocabulary than Mac; microphone/acoustic reliability needs device acceptance |
| Score markup | PDF reading and measure-range passage records | PDF ink/Pencil editing, geometric score marks and mapping tools are unimplemented in this candidate |
| History and warmups | Native current-set Undo plus session/attempt inspection | Full historical repair UI, desktop warmup library and teaching tools are unported |
| Mapping/Assistant | Do not imply unavailable capability | Assistant remains off/on hold; cloud mapping is a separate feature boundary |
| Backup | Explicit validated export/import; read-only recovery copies and byte-verifies the original before replacement; unreadable fallback export is refused | Files sharing is not account sync; no implied iCloud multi-device sync or Mac migration |
| Distribution | Xcode simulator/device target; candidate1.0.0/build1 | App Store/TestFlight require signing and distribution work plus device QA; candidate is not shipped |

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
