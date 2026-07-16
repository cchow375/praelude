# Pre-map log — Barber, Pas de Deux (III, from Souvenirs), PRIMO part

(Christian_C_Barber_Pas_de_Deux_Primo.pdf, piece_id 6, "Chamber Pieces Tanglewood")

## Method

Rendered all 4 PDF pages at 72dpi (pages are unusually large, 2876x3940pt /
~40x55in, so 150dpi would have produced 6000x8200px files; 72dpi kept files
readable while preserving every detail needed). Each page was visually read in
full, then every system was re-examined via tight, full-resolution crops
(often split into overlapping left/right halves for higher effective zoom).

yTopPct / yCenterPct were obtained programmatically: for each page, converted
to grayscale, thresholded to find rows where a high fraction of pixels in the
central width band are dark (staff lines span nearly the full system width).
Contiguous dark rows were clustered; every system yielded two 5-line clusters
(upper primo staff, lower staff), confirmed by an even count of clusters per
page (8 for the two 4-system pages, 10 for the 5-system page, 8 for the last
4-system page). yTopPct = top line of the upper staff's cluster; yCenterPct =
midpoint between that line and the bottom line of the lower staff's cluster.
One page (4, system 4) had unusually faint bottom-staff ink (mostly rests)
requiring a lower detection threshold (0.15-0.2 instead of the usual 0.35);
resolved and cross-checked against this page's otherwise uniform
system-to-system spacing (~0.205 of page height).

Critically, **this part prints NO measure numbers per system** (unlike the
Ekier pilot). It has only boxed rehearsal numbers [23]-[27], which per
instructions are landmarks, not measure numbers, and (being placed at
irregular intervals: 21, 19, 13, 15 measures apart) clearly continue the
numbering from earlier movements of the Souvenirs suite rather than marking
anything local to this excerpt. So every system's bar count had to be
determined by counting barlines directly:

- Visual count from crops (often re-cropped narrower/split for certainty).
- Cross-checked with a small programmatic vertical-barline detector: for each
  system's y-band, computed each column's dark-pixel fraction across the full
  staff height; columns exceeding ~0.6 are barlines (the engraving draws
  through-barlines connecting both staves).
  The two methods agreed for 14 of 17 systems immediately. Three disagreed
  (auto-detector over-counted by one measure) because of false-positive
  "barline" columns:
  - p.3 system 5: a thick rolled/dotted LH chord (~2/3 through the system)
    created a tall dark column. Re-crop confirmed 5 real measures, not 6.
  - p.4 system 2: a tremolo/triplet cross-hatch figure (marked "3") in bar 1
    created a diagonal dark run mistaken for a barline. Re-crop confirmed 5
    measures, not 6.
  - p.4 system 4 (the final system of the piece): needed the opposite kind of
    care — this is the trickiest system on the page, ending in a thick final
    double barline that the detector counted as two separate barlines close
    together. After discounting that duplicate, the auto-count (2 real
    interior barlines) and a careful re-crop both agree on exactly **3**
    measures for this final system (two bars of ascending 16th-note runs,
    then a bar of final chords + rests + double barline) — NOT 4 or 5 as a
    quick first look at the page thumbnail suggested.

## Per-page notes

- p1 (printed p.29): "III. Pas de deux / PRIMO", rehearsal box [23], "Adagio
  quarter-dotted=48". 4 systems, 5 measures each (20 total, m1-20). System 1
  opens with a full bar of 6/8 rest (rehearsal 23 sits above it) — treated as
  measure 1 (see Ambiguities below). A bare "1" appears directly on/under the
  first melody note after that rest (m2, "mp espr."); read as a piano
  fingering (finger 1/thumb) for the re-entrance note, not a measure number —
  it sits mid-measure on the entrance note, not at a system start where a
  measure number would be printed.
- p2 (printed p.31): 4 systems, 5 measures each (20 total, m21-40). Rehearsal
  box [24] sits over m22 (system 1, bar 2).
- p3 (printed p.33): 5 systems (this page is laid out tighter — system
  spacing ~0.17 of page height vs ~0.20-0.21 on the other 3 pages — fitting
  a 5th system on). Bar counts 4,4,5,5,5 (23 total, m41-63). Rehearsal [25]
  at system 1 start (m41); rehearsal [26] at system 4 start (m54, "(in
  tempo)"). Second bare "1" appears in system 3 (over a short rest measure,
  m51, right before "mp") — same fingering reading as p1's "1".
- p4 (printed p.35): 4 systems. Bar counts 5,5,5,3 (18 total, m64-81).
  Rehearsal [27] at system 2 start (m69). Final system (m79-81) ends the
  piece: two bars of ascending 16th-note figuration under an 8va dashed line,
  then a final bar of block chords marked pp with "Ped." and a thick double
  barline — clearly the movement's ending (matches the "4:20" performance
  timing printed at the bottom of the page, a duration marking, not a measure
  number).

## Validation

1. Continuity chain: every system-start measure equals the previous system's
   start + that system's counted bar total; monotonic across all 17 systems,
   all 4 pages. PASS. Closes at measure 81 (page4 system4: 79 + 3 - 1 = 81).
2. Cross-page checks: page1 ends at m20, page2 starts at m21 (PASS); page2
   ends at m40, page3 starts at m41 (PASS); page3 ends at m63, page4 starts
   at m64 (PASS).
3. No MusicXML exists for this piece/edition — validation is the internal
   continuity chain only, as instructed.
4. Rehearsal-number spacing sanity check (not a hard validation, just
   plausibility): 23->24 = 21 measures, 24->25 = 19, 25->26 = 13, 26->27 = 15.
   Irregular but not wildly so — consistent with rehearsal marks placed at
   phrase/section boundaries rather than fixed intervals.

## Ambiguities / caveats (honesty notes)

- **low_confidence: true on the very first anchor (page 1, measure 1).** The
  piece opens with a full bar of 6/8 rest under rehearsal box [23]. I treated
  that rest bar as measure 1 of this piece/PDF (i.e., numbering resets to 1
  for this excerpt, matching how the app treats it as a standalone "Chamber
  Piece" entry). But the original edition's rehearsal-letter sequence
  (23-27, clearly continuing from earlier movements of the Souvenirs suite)
  strongly implies the underlying print's true bar numbers also continue
  from earlier movements rather than reset here — that absolute number is
  simply unrecoverable from this 4-page excerpt alone. Every other anchor's
  measure number is only as certain as this starting assumption (all are
  internally consistent with each other, but the whole chain could be
  offset by some unknown constant if the app's convention differs).
- Editorial fingering "1" (finger 1/thumb) appears twice, both times right
  at a rest-to-entrance transition (p.1 sys.1 m2, p.3 sys.3 m51); identified
  and excluded from measure-number readings, per the same caveat pattern as
  the Ekier pilot's fingering false-positives.
- Three systems (p.3 sys.5, p.4 sys.2, p.4 sys.4) had an initial disagreement
  between visual count and the automatic barline detector, caused by thick
  chords/tremolo figures creating false-positive "barline" columns; all
  three were resolved via closer re-cropping and re-reading, cross-checked
  against the automatic detector's true (de-duplicated) interior-barline
  count. None marked low_confidence in the JSON since both methods agreed
  after the false positives were identified — logged here for transparency.
- Time signature changes appear on p.4 system 3 (implicit 6/8 -> 9/8 -> 6/8
  mid-system) but did not affect the bar count method (barlines still
  delimit one measure per bar regardless of meter).
