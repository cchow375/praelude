# (C) Praelude iPad Design System

Build spec §3a–3d and the banned list §3b, implemented. Scope: `ios/Praelude/Design/` (new tokens
and components) plus view-styling changes across the existing screens. Data models and `Core/` are
untouched — a parallel agent owns that surface.

## Palette

Monochrome ink/paper/gray, with exactly one rare accent reserved for live states. Light and dark
are each designed on their own rather than one being an inversion of the other.

- **Light — "Paper and ink."** Warm paper background, near-black warm ink for content and
  controls, a whiter "surface" tone for raised cards, a warm light-gray hairline.
- **Dark — "Stage."** Black lacquer background (the color of a piano case, not a flat `#000000`
  inversion of the paper), warm parchment ink for content, a slightly raised near-black surface
  tone, a warm dark hairline.
- **Score paper** is pinned to the same paper-white value in both appearances — the music itself
  never goes dark.
- **The one accent** is a warm stage-light amber (`PraeludeColor.live`), never purple, indigo,
  violet or blue. It appears in exactly two places: the practice dock's progress fill while a set
  is actively running, and the microphone indicator while hands-free listening is on. Everywhere
  else — buttons, selection states, charts, toggles — uses the monochrome ink/paper/gray family.
- The global app tint (`AccentColor` asset and `.tint(PraeludeColor.ink)` at the window root) is
  ink, so native controls that read the environment tint (toggles, sliders, segmented pickers,
  system buttons) follow the palette instead of system blue.

Tokens live in `ios/Praelude/Design/DesignColor.swift`.

## Typography

- **Headings / numerals:** system SF typography. Interactive tempo/progress numbers use the
  rounded system design with tabular digits; headings use the standard system face. The
  `.praeludeDisplay` / `.praeludeNumeral` modifiers scale using Dynamic Type. Bravura is the
  musical notation face; Bodoni remains a licensed legacy bundled resource, not the current UI face.
- **UI text:** native system text for forms, lists, controls and body copy. Labels remain readable
  at the bench and honor accessibility text sizes.
- **Music glyphs:** Bravura (the reference SMuFL font) is bundled for musical iconography —
  `PraeludeMusicGlyph` renders a single glyph by SMuFL codepoint (e.g. the quarter note next to
  the Settings footer line).

Tokens live in `ios/Praelude/Design/DesignTypography.swift`.

## Iconography

A small, consistent-stroke icon set drawn once for this app's core musical actions — metronome,
passage box, verdict clean/sloppy/again, tempo, mic, recording, warmup — replacing SF Symbols for
those specific glyphs. No emoji anywhere. Each glyph is a `Shape` built from straight lines, a
single near-full-circle arc, and a couple of built-in primitives (`Capsule`, `Circle`) on a shared
24-unit grid, stroked at one consistent weight (`PraeludeIcon`). Overflow-menu rows and generic
chrome (nav icons, undo/redo, page turn) keep SF Symbols, which is the idiomatic choice for
system-rendered menu chrome.

Lives in `ios/Praelude/Design/DesignIcons.swift`.

## Components

- **Buttons** (`DesignButtonStyles.swift`): `praeludePrimary` (solid ink fill, paper label — the
  one primary action on a screen), `praeludeQuiet` (ink text on a faint fill, for secondary
  actions), `praeludeVerdict(emphasis:)` (the large Clean/Sloppy/Again buttons, always ≥72pt
  tall — `PraeludeMetric.verdictHeight`), `praeludeEdgeControl` (large round icon buttons for
  transport/undo/tempo, reachable from the bench). Every style responds to press with a quick,
  interruptible scale rather than the system default highlight.
- **Surfaces** (`DesignSurfaces.swift`): ordinary forms/cards retain an opaque tonal surface.
  `praeludeScoreChrome` uses the native bar material, with an opaque Reduce Transparency fallback.
  `praeludeFloatingControls` supplies one rounded control layer: real Liquid Glass on iOS26+,
  regular system material on older supported iPads, opaque boundaries for Reduce Transparency or
  increased contrast. Keep score paper opaque and avoid glass on nested parent/child surfaces.
- **Layout** (`DesignLayout.swift`): five deliberately different corner radii, one per component
  role (`tight` 8pt for chips/thumbnails, `control` 12pt for buttons/fields, `card` 18pt,
  `verdict` 22pt, `panel` 27pt for the floating HUD/dock) instead of one radius everywhere.
- Grouped `List`/`Form` screens (Today, Pieces, Progress, Settings, Metronome, set composer) use
  `.scrollContentBackground(.hidden)` plus `PraeludeColor.paper`, so the page itself reads as
  paper/stage rather than the system's default gray grouped background.

## Motion

`DesignMotion.swift` defines three spring presets — `entrance` (a sheet arriving, a passage
expanding), `tap` (a button press, a beat pulse), `settle` (a completed set, a page turn) — each
with a Reduce Motion alternative (a short `easeOut`, same end state, no movement) selected via
`PraeludeMotion.entrance(reduceMotion:)` etc. SwiftUI springs are interruptible by default
(they retarget from the in-flight velocity), so no extra bookkeeping is needed for that half of
the requirement.

`PraeludeHaptic` (`.toggle()`, `.confirm()`, `.celebrate()`) is the shared primitive for UI
moments that aren't already wired for feedback. Verdict, set-completion and chain celebrations
already run through the existing practice event pipeline (`FeedbackService`) — that pipeline was
left untouched (it is a `Services/` behavior surface, not styling) — so `PraeludeHaptic` is not
re-wired onto the same events to avoid double-firing haptics; it is used for the toggles and
confirmations that didn't previously have any.

## Fonts: sourcing and licensing

Both fonts are SIL Open Font License 1.1, fetched only from their official GitHub repositories and
verified before bundling:

| Font        | Source                                                     | Bundled as                                    | Verification                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bodoni Moda | `google/fonts`, `ofl/bodonimoda/BodoniModa[opsz,wght].ttf` | `ios/Praelude/Resources/Fonts/BodoniModa.ttf` | Downloaded file size and SHA match the GitHub API blob; `fontTools` confirms `GSUB` carries `tnum`; family/PostScript names confirmed (`Bodoni Moda` / `BodoniModa-Regular`)                  |
| Bravura     | `steinbergmedia/bravura`, `redist/otf/Bravura.otf`         | `ios/Praelude/Resources/Fonts/Bravura.otf`    | Downloaded file size matches the GitHub API blob; `fontTools` confirms the expected SMuFL codepoints (e.g. U+E040 `gClef`, U+E1D5 `noteQuarterUp`) resolve; OTF magic bytes (`OTTO`) verified |

License text for each (`BodoniModa-OFL.txt`, `Bravura-OFL.txt`) is bundled alongside the font
binaries and reproduced in full in the repository root's `THIRD_PARTY_NOTICES.txt`. Only the
`.ttf`/`.otf` binaries are Xcode "Copy Bundle Resources" members (see
`scripts/generate-project.py`); the license text files are not bundled into the app, only shipped
in the repo for compliance. Both fonts are registered via `UIAppFonts` in `Info.plist`.

## Applying it

Restyled: Today (empty state, active-set card), the sidebar/tabs and app-wide tint, the library
list (including the swipe-action `.indigo` removal), the score workspace chrome and practice dock
(including the verdict buttons, the practice-feedback acknowledgement mark, the passage picker's
`.indigo` removal, and the on-score passage boxes' `.systemIndigo`/`.systemTeal` removal in
`ScorePageOverlay`, which a case-sensitive `.indigo` grep had missed), the set composer, the
metronome, progress, and settings. Every `.indigo`/`.systemIndigo`/`.systemTeal`, decorative
`Color.accentColor`, `.buttonStyle(.bordered/.borderedProminent)`, and default `.regularMaterial`
card in `ios/Praelude/Views/` was removed or replaced — verified by a case-insensitive grep, not
just by eye.

## Evidence

Light and dark screenshots of Today, Pieces and Settings, captured on the "iPad Pro 11-inch (M5)"
simulator, are in `ios/docs/qa-design/`.
