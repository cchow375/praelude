# Pre-map log — Chopin Étude Op.10 No.4, Cortot (Chopin_Etude_Op10_No4_Cortot.pdf)

Method: rendered all 7 PDF pages at 300dpi (pdftoppm). Read every page visually at full
resolution, then re-cropped ambiguous regions (per-system strips, and further narrow
crops with pixel gridlines overlaid on candidate barline x-positions) for definitive
measure counting. No XML exists for this piece — validation is the internal continuity
chain only (each system's first measure = previous system's first measure + previous
system's bar count), per instructions.

- yTopPct = top line of the system's treble staff, located by programmatic full-width
  dark-row (staff-line) detection at 300dpi (a horizontal run of pixels with >20-35%
  ink density across the row, ignoring L/R margins).
- yCenterPct = midpoint between the treble staff's top line and the bass staff's
  bottom line (same detection method), i.e. midpoint of the grand staff.
- Barlines (needed for measure counts) were found by a second, independent
  column-wise scan: for each system's tight y-band, columns whose dark-pixel
  fraction is ~0.8-1.0 (spans nearly the full staff height including the gap between
  staves) are true barlines; note stems, accidentals, accent/dynamic marks, and
  circled editorial numbers create narrower/lower-confidence columns (usually
  <=0.7) that were rejected. Every ambiguous or borderline case (listed below) was
  additionally confirmed by eye with a narrow, upscaled crop, and the trickiest
  cases with a red pixel-gridline overlay drawn exactly at the candidate x-position
  to see whether it truly falls on a barline stroke.

## Page-by-page notes

- p1 (printed 26): "STUDY N°4 (Op.10)" — Cortot's commentary/exercise page. Contains
  small preparatory-exercise staves (Nos. 1-5, and unnumbered fragments) illustrating
  fingering patterns, NOT the étude text itself. Text explicitly cites "bar 2" (plain,
  uncircled "(1)") and circled "② Bar 3" for two of the exercises. 0 anchors (commentary
  only, per instructions to mark exercise/commentary pages zero-anchor).
- p2 (printed 27): Commentary continues. Plain-text bar citations: "Bar 6 l.h.",
  "For bars 25 and 26, see Study N°2." Circled citations: "③ Bars 27 and 28",
  "④ ... Bars 29 and 30", "⑤ Bars 31 and 32", "⑥ Bars 33, 34, 37 and 38",
  "⑦ Bars 35, 36, 40 and 41", "⑧ Bar 47", "⑨ Bars 71 to 79", plain "(10) From bar 71
  to bar 75 ...", "⑪ Bars 75 to 78", "⑫ Bars 79 and 80." Signed "ALFRED CORTOT" at
  the foot of the page — end of commentary. 0 anchors.
- p3 (printed 28): Étude text begins. "STUDY N°4 (Op.10)", Presto. 6 systems, grand
  staff (treble+bass) throughout, no ossia/incipit. Measures 1-18 (3 measures/system,
  6 systems). System1 bar1 is the famous descending "f con fuoco" flourish (longer
  note values, not the perpetual 16ths) — counted as measure 1. Bar2 begins the
  16th-note moto perpetuo ("fp", cresc.). Bar3 is marked with the score's own circled
  "①". System2's first bar carries the score's circled "②" (one measure later, not at
  a large bar-number jump) — this establishes that the SCORE's circled numbers are a
  different, roughly-per-system sequential marker set, NOT the same numbering as the
  commentary's circled exercise numbers (see Ambiguities below); they were not used
  for measure validation.
  - System2: a real barline exists at x=1016 (of 2549) with only ~0.82 peak darkness
    (fainter than the ~0.95-1.0 typical elsewhere) — confirmed genuine by a tight
    zoomed crop (zoom_p3_sys2_boundary.png) showing an unmistakable single barline
    stroke there. 3 measures confirmed.
- p4 (printed 29): 6 systems, measures 19-36.
  - System1 and System3 each end with an unusually "thick" full-height dark column
    (~2x normal width) right at the system's final barline — visually confirmed
    (zoom_p4_sys1_tail.png, zoom_p4_sys3_tail.png) to be an ordinary single barline
    immediately followed by a KEY-SIGNATURE change (new sharps/flats crowd against
    the barline, inflating the column-darkness measurement, not a repeat sign or
    extra measure). 3 measures each, confirmed.
  - System6 (circled "⑥" and "⑦" visible) has several low-confidence candidate
    columns (0.6-0.75) from note-stem alignment; only x=155(start),977,1693,2380
    exceed 0.85 and are genuine. 3 measures confirmed.
- p5 (printed 30): 5 systems, measures 37-51. Overall scan contrast/ink density is
  slightly lower on this page than pp.28/29/31/32 (max column-darkness for true
  barlines runs ~0.7-0.85 here instead of ~0.95-1.0), so a fixed high threshold
  missed real barlines; per-system adaptive thresholding plus targeted checks
  (systems 4 and 5 specifically) confirmed 3 measures in every system.
- p6 (printed 31): 5 systems, measures 52-66. System4 produced many false-positive
  candidate columns (0.55-0.75, from dense chromatic note-stem alignment); only
  4 columns exceed 0.95 and those give 3 measures, confirmed visually.
- p7 (printed 32, final page): 5 systems, measures 67-83.
  - Systems 1-4: standard 3 measures each (67-69, 70-72, 73-75, 76-78). System2
    carries the score's circled "⑨" at the start of its 3rd measure (=74 by my
    count... actually measure 72, see Ambiguities) marking the "ff con più fuoco
    possibile" passage, and circled "⑩" shortly after.
  - System5 (the FINAL system) is structurally different: 5 measures, not 3
    (measures 79-83). Verified in detail with a red-pixel-gridline overlay
    (zoom_p7_sys5_gridlines.png) directly on top of the rendered notation:
    - m79: descending chromatic 16ths, accented (start of the system).
    - m80: ascending bravura flourish ("1,25,84,84...").
    - m81: continued flourish ("14,14,52,42...").
    - m82: short measure — treble has a rest, bass has a rest+entrance figure,
      then both hands play detached "ff" staccato chords for the remainder
      of the measure.
    - m83 (FINAL): whole-note chord with fermata, closed by the final double
      barline. Chain closes here: 83 measures total.
      One candidate column at x=2214 (0.83 confidence) was visually disproved by
      the gridline overlay — it falls in the middle of a staccato note, not on a
      barline stroke.

## Validation

1. Continuity chain: every system's first measure = previous system's first
   measure + previous system's measure count (3 for all systems except the
   final one, which has 5). Chain is monotonic and closes at measure 83.
   PASS (26 systems x 3 measures = 78, + final system's 5 = 83).
2. No MusicXML exists for this piece (per task instructions) — no XML
   cross-check is possible or expected.
3. Commentary cross-check (supplementary only, not primary validation):
   Cortot's own text says "⑫ Bars 79 and 80" for a practice exercise citing the
   final system's opening two measures. The independently-derived continuity
   chain places the final system's first two measures at EXACTLY 79 and 80 with
   no adjustment — strong corroboration that measure 1 = the piece's opening
   "f con fuoco" flourish bar (not a discounted pickup) and that the "3
   measures/system, final system=5" pattern is correct throughout.
4. Two earlier commentary citations ("⑨ Bars 71 to 79", "⑪ Bars 75 to 78") land
   approximately one measure later, per my count, than where the score's own
   circled editorial markers visually appear to sit (e.g. circled "⑨" appears
   to mark measure 72 rather than 71). This is a minor, unresolved 1-measure
   discrepancy in the supplementary commentary cross-check only; it does not
   affect the barline-counted continuity chain (which is self-consistent and
   does not rely on the circled numbers at all), and is far outweighed by the
   exact "79/80" match at the far end of the piece. Recorded here for honesty,
   not treated as a defect in the anchor data.

## Ambiguities / caveats

- No anchor is marked low_confidence. Every system's measure count is backed
  by either (a) >=4 clean, high-confidence (>=0.85 darkness fraction) full-height
  barline detections with no plausible false positives, or (b) for every system
  that did NOT cleanly clear that bar on first pass (page3 sys2; page4 sys1,
  sys3, sys6; page5 sys4, sys5; page6 sys4; page7 sys5), a targeted zoomed/
  gridlined visual crop that unambiguously confirmed the true barline count.
- The score prints its OWN small circled reference numbers (①…⑩ or so, seen at
  least in p3 sys1/sys2, p4 sys6, p7 sys2/sys4) at various points. These are
  visually similar to, but do NOT numerically align 1:1 with, the circled
  exercise numbers in Cortot's commentary (commentary's circled "②" = bar 3,
  but the score's own first circled mark "①" sits at bar 3 and its "②" sits at
  bar 4, only one measure later — inconsistent with jumping to bar 27 as
  commentary's "③" would imply). These score-internal circles were therefore
  treated as a separate, not-fully-understood editorial layer (possibly
  per-system or per-fragment rehearsal markers) and were NOT used to validate
  measure numbers; only direct barline counting + the continuity chain were used.
- This is a Cortot STUDY edition: pages 1-2 mix exercise staves with dense prose
  commentary. Both were correctly identified as non-etude content and excluded
  (zero anchors), per instructions.
- The piece is a 2/4 (or possibly notated in cut-time/common-time — the printed
  time signature glyph is a plain "C") moto perpetuo of continuous 16th notes,
  4 beamed groups of 4 sixteenths per measure, EXCEPT measure 1 (the opening
  flourish, longer note values) and the final system's measures 82-83 (rests /
  detached chords / whole-note fermata). This rhythmic regularity is what made
  barline detection reliable once true barlines were distinguished from
  accent-mark/note-stem false positives.
