# Pre-map log — Griffes, The Lake at Evening Op.5 No.1 (Griffes_Three_Tone_Pictures_Op5_IMSLP.pdf)

## Method

Rendered all 8 PDF pages at 150dpi (full-page visual read) plus 300dpi crops of pages 3-5
(the only music pages) for close inspection, split into overlapping thirds per system and
further zoomed on specific bar-line/clef regions. y-values are fractions of full page height
(2150px at 150dpi).

Critical difference from the Chopin/Ekier pilot: **this IMSLP scan carries no printed measure
numbers anywhere** (Schirmer's 1915 house style for this title omits them entirely - no numbers
at system starts, no rehearsal numbers). So instead of reading printed numbers, every system's
starting measure was obtained by:

1. Extracting a full measure-by-measure signature table from the companion MusicXML (Soundslice
   export) - for each of the 67 measures: RH/LH rhythm (attack sequence: Q/E/H/dotted markers/
   rests/grace notes), clef-change events, and dynamic markings.
2. Matching distinctive signatures (clef changes, rests, unique rhythmic shapes, grace-note
   figures) against what is visually printed at specific points in each system.
3. Counting bar-by-bar between two confirmed landmarks to fix the exact measure count of a
   system when its internal content is visually ambiguous (e.g. repeated ostinato figures).
4. Cross-checking with a small Python column-darkness barline detector (finds vertical runs
   spanning a system's full grand-staff height) as a secondary sanity check on pages 4-5;
   this occasionally over-counted (one spurious "barline" from a thick chord/stem coincidentally
   spanning full staff height), so content/landmark matching was treated as primary evidence
   and the detector as corroboration only.

yTopPct = top staff line of the system's upper (treble) staff. yCenterPct = midpoint between
top line of upper staff and bottom line of lower (bass) staff. For pages 4-5 these came from
clean 150dpi row-darkness clustering (full 5-line-staff clusters detected at a consistent
threshold for every system). For page 3 the same detector returned only partial/noisy clusters
(possibly lighter print density where system 1 has two RH whole-bar rests, or slight scan skew)
so page-3 y-values are careful visual crop-based estimates instead (±0.02-0.03), flagged
low_confidence.

## Which pages hold "The Lake at Evening"

- p1: title page - "Charles T. Griffes / Op.5 / Three Tone-Pictures / For the Piano" with the
  contents list (I. The Lake at Evening .50, II. The Vale of Dreams .60, III. The Night Winds
  .75) and the G. Schirmer imprint. 0 anchors.
- p2: front-matter epigraph for No.1 only - a Yeats quotation ("...I hear lake water lapping
  with low sounds by the shore. WILLIAM BUTLER YEATS.") with plate number 25624. 0 anchors.
- **p3-p5: "The Lake at Evening" music, complete (67 measures, 12 systems, 4 per page).**
  Plate 25624c, copyright 1915 by G. Schirmer, printed at the foot of p3.
- p6: Schirmer house advertisement page ("FOUR INTERESTING PIANO PIECES", four unrelated pieces
  by Sternberg/Huss/Grainger/Granados). 0 anchors.
- p7: blank page (just the top scan-crop line, no content). 0 anchors.
- p8: another Schirmer house ad ("FOUR PIANO PIECES by PAOLO CONTE"). 0 anchors.

**Important finding: Nos. 2 "The Vale of Dreams" and 3 "The Night Winds" are NOT present
anywhere in this PDF at all**, despite the title page (p1) listing all three Tone-Pictures.
This IMSLP scan reproduces only No.1's music pages plus front/back matter - it is not simply
that Nos. 2-3 are on unscanned pages elsewhere; the 8-page file is complete in itself and
genuinely only contains No.1.

## Per-page notes

- p3 (printed p.3): title "The Lake at Evening", dedication "To Leslie Hodgson", composer
  credit "Charles T. Griffes. Op.5, No.1", tempo "Tranquillo e dolce", 3/4, key sig 3 sharps.
  4 systems, m1-23 (implied bars 5,6,6,6). System 1 opens with two RH whole-bar rests over a
  LH "una corda" eighth-note ostinato (verified against XML: m1 duration sums to 720 = full
  3/4 bar, RH rest type="whole" dur=960 is a common MusicXML whole-rest-duration quirk, not an
  actual 4/4 bar or pickup). m3 is the "pp ma espressivo" dotted-half chord entrance (verified
  via zoomed crop that a real barline separates the dotted-half chord from the following 3
  quarter chords, i.e. m3|m4 - initial visual read had these looking adjacent). System 4 ends
  with m22 (chord + 2 rests) then m23 (RH whole-bar rest, LH clef returns to treble G2) -
  directly confirmed visually (chord | rest rest | blank whole-rest bar) and matches the XML
  clef-change/rest landmark exactly, anchoring the p3/p4 boundary at m23/m24.
- p4 (printed p.4): "più espressivo, mp, tre corde" continues directly from p3's last chord.
  4 systems, m24-47 (implied bars 6,6,4,8).
  - System1 (m24-29): opens with the dotted-half "più espressivo" chord (dyn mp), ends with
    m28 (dyn p + LH clef->bass F4) then m29 (Q Q. E pattern) - both landmark-confirmed.
  - System2 (m30-35): opens with a grace-note+dotted-half chord (matches XML m30 exactly:
    grace-eighth + dotted-half), ends around the RH ascending-run measure (m34, RH clef
    change back to treble G2 after a one-measure RH excursion into bass clef at m33, dyn mf
    at m32 - all three landmarks visually confirmed in sequence in this system).
  - System3 (m36-39): begins exactly at the "poco agitato" text (visually unambiguous - the
    marking sits directly under the system's first measure), continues through the densest
    16th-note/tuplet/double-sharp ("sempre cresc.") passage in the piece. Only 4 measures fit
    here due to the note density - both ends of this system are landmark-bounded (start =
    "poco agitato" text, end = m40 landmark below), so the _count_ of 4 is solid even though
    I did not individually verify each of m36/37/38/39's exact position.
  - System4 (m40-47): begins with dyn f + RH quarter-then-2-rests (directly matches m40's
    XML signature Q R R), continues through "più tranquillo" (p, m41), "dim. molto", and
    "poco rit." to the page's last system - a long, calmer 8-bar system (plausible given the
    simpler H./Q rhythms use much less horizontal space than system3's texture). End confirmed
    by the page5 "Tempo I°" landmark below (m48).
- p5 (printed p.5): "Tempo Iº, pp, una corda" - a full return of the opening material
  (grace-note + dotted-half chord, identical shape to m3/m9/m30). 4 systems, m48-67
  (implied bars 6,5,4,5) - the piece's coda/ending.
  - System1 (m48-53): high confidence start (Tempo I° text + thematic return, unmistakable).
  - System2 (m54-58): ends with an "8...pp" ottava-line + eighth-note figure that matches
    m58's XML signature (E E Q E E) and coincides with the LH clef returning to treble (G2,
    confirmed XML clef-change landmark at m58) - both occur together right at the end of this
    system's crop.
  - System3 (m59-62): the ottava "8" line and "p" dynamic visibly _restart_ fresh at this
    system's first measure (engraving convention - 8va lines restart each system), matching
    the clef-change/ottava landmark just noted at the m58/59 seam. Internal boundary with
    system4 (m62/63) is the weakest link in the chain: measures 54-67 are a long passage of
    a repeating "E E Q E E" / "Q E E Q" ostinato alternating between hands over sustained
    LH dotted-half chords, visually near-identical from bar to bar.
  - System4 (m63-67): begins with a fresh "8...più calmato" ottava/text marking (matches the
    system-restart pattern seen at m59), and the "ppp" dynamic (XML: m64) is visually the
    _second_ measure of this system - used to back out the system's start as m63. Ends with
    "morendo" and the final sustained chord (m67, matches XML: H. alone, the only remaining
    measure) at the closing double barline. If the ppp-is-2nd-measure assumption is off by
    one, the system3/system4 seam could actually fall at m61/62 or m63/64 instead of m62/63 -
    flagged low_confidence accordingly, though the total (4+5=9 measures for the last two
    systems, matching 67-58=9) is closed and correct either way.

## Validation

1. **Continuity chain**: 1, 6, 12, 18, 24, 30, 36, 40, 48, 54, 59, 63 with implied per-system
   bar counts 5, 6, 6, 6, 6, 6, 4, 8, 6, 5, 4, 5. Sum = 67. Chain closes exactly: last anchor
   (m63) + 5 bars - 1 = m67 = final measure. PASS.
2. **MusicXML cross-check**: `grep -c '<measure number='` = 67 in the single `<part id="P1">`
   (RH+LH combined in one part, unlike the Ekier Chopin's split-hands convention). Measures
   numbered 1-67 with no `implicit="yes"` attribute anywhere and no pickup (m1 duration sums
   confirmed = a full 720-division 3/4 bar). Only one `<time>` element in the entire file
   (3/4 at m1) - **no time-signature changes anywhere in the piece**. PASS.
3. **Landmark m15/m23/m28/m33-34/m57-58**: LH (and briefly RH) clef changes between treble
   (G2) and bass (F4) clefs are visually unambiguous in the scan and were matched 1:1 against
   the XML `<clef>` change list: m15 LH->bass, m23 LH->treble (RH also has its only other
   whole-bar rest here), m28 LH->bass again, m33 RH->bass (one-measure excursion) / m34
   RH->treble, m57(transition)/m58 LH->treble. All confirmed visually. PASS.
4. **Landmark m24/m32/m40/m41/m64**: dynamic markings (mp, mf, f, p, ppp) read directly off
   the score text and matched against the XML `<dynamics>` elements at the corresponding
   measures. All confirmed. PASS.
5. **Landmark m48 "Tempo I°"**: the grace-note + dotted-half chord shape at the start of page
   5 is visually identical to the piece's opening idea (m3/m9/m30), consistent with a printed
   "Tempo I°" tempo-marking return. PASS (thematic/textual, not XML-checkable since this
   Soundslice XML export carries no `<words>` text directions).

## Ambiguities / caveats (honesty rule)

- **Page 3 y-positions (all 4 anchors) - low_confidence: true.** Programmatic staff-line
  row-detection, which worked cleanly on pages 4-5 (full 5-line clusters at a consistent
  threshold), returned only partial/noisy row clusters on page 3 (possibly lighter print in
  that scan region, or slight page skew). The measure-NUMBER assignments for page 3 are high
  confidence (each system boundary is independently confirmed via a clef-change, rest, or
  distinctive rhythmic-shape landmark cross-checked against the MusicXML) - only the yTopPct/
  yCenterPct pixel estimates are lower precision (±0.02-0.03, visual crop-based rather than
  detected).
- **Page 5, systems 2-4 (measures 54, 59, 63) - low_confidence: true on the measure field.**
  The coda (m54-67) is a long passage of near-identical repeating ostinato shapes, which makes
  it hard to fix sub-system measure identity from shape alone. The system2/3 seam (m58/59) is
  reasonably well anchored (ottava-line restart + LH clef-change landmark coincide there). The
  system3/4 seam (m62/63) is the weakest point in the whole chain, inferred from the "ppp"
  dynamic (XML m64) being visually the second measure of the final system - if that reading is
  off by one, the seam could shift to m61/62 or m63/64. This does not affect the closure of
  the total (still 9 measures across the last two systems either way).
- **Page 4 system 3 (4 measures, m36-39) and system 4 (8 measures, m40-47)** are unusually
  short/long relative to the piece's ~5-6 bar average, but both counts are solidly
  landmark-bounded on _both_ ends (system3: "poco agitato" text start + m40 "f + rests" end;
  system4: m40 start + page5 "Tempo I°" end), so despite the asymmetry these two counts are
  trusted at normal confidence, not flagged.
- No repeats, voltas, ossia staves, or unmetered bars anywhere in the piece; no time-signature
  changes (constant 3/4 throughout, single `<time>` element in the XML). Editorial fingering
  numbers (1-5) and ornament markings visible in the "poco agitato" section (p4 system3) were
  correctly identified as fingerings/ornaments, not measure numbers (there are no printed
  measure numbers anywhere in this scan to confuse with fingerings in the first place).
