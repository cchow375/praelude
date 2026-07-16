# Pre-map log — Chopin Scherzo No.2 Op.31, Ekier (ekierscherzochopin2.pdf)

Method: rendered all 25 pages at 150dpi (visual read of every page), plus 100dpi grayscale
renders for programmatic staff-line detection. y-values are fractions of full page height.

- yTopPct = top staff line of the system's upper staff (staff-line cluster detection;
  every music page yielded exactly 10 staves = 5 grand-staff systems, no ambiguity).
- yCenterPct = midpoint between top line of upper staff and bottom line of lower staff.
- Slurs, 8va dashes, "con anima"/dynamics text can extend ~0.02–0.05 above yTopPct.

Ekier prints a measure number at the start of every system, so all 120 anchor measures
are read from printed numbers, not counted. Implied per-system bar counts (from
consecutive printed numbers) are listed below and were sanity-checked against the bar
content seen on each page. No repeats, voltas, ossia staves, incipits, or unmetered
bars anywhere in the piece; numbering is strictly linear 1..780.

## Per-page notes (PDF page / printed page: system start measures -> implied bars/system)

- p1 (title): front matter, "Scherzo No. 2 in B-flat minor Op. 31, Ekier Edition". 0 anchors.
- p2 /30: 1, 9, 17, 27, 35 -> 8,8,10,8,(9). "Scherzo" heading + dedication at top; first
  system carries big "2" and Presto marking; numbering starts at 1 (no pickup).
- p3 /31: 44, 53, 59, 65, 71 -> 9,6,6,6,(6). Footnote at bottom (cresc./ff source note for
  t.114/246) — text only. m67 landmark verified here (sys4 bar 3, see below).
- p4 /32: 77, 82, 87, 93, 98 -> 5,5,6,5,(5). Fingering-style "243" trill note over sys4 bar 2
  (m94) is an editorial cross-reference, not a measure number. m95 landmark here (sys4 bar 3).
- p5 /33: 103, 108, 113, 119, 125 -> 5,5,6,6,(8).
- p6 /34: 133, 141, 149, 159, 167 -> 8,8,10,8,(9). Scherzo reprise.
- p7 /35: 176, 185, 191, 197, 203 -> 9,6,6,6,(6). Systems 1–2 nearly touch (LH trill under
  sys1 vs 8va over sys2); gap located programmatically at y≈0.204.
- p8 /36: 209, 214, 219, 225, 230 -> 5,5,6,5,(5).
- p9 /37: 235, 240, 245, 251, 257 -> 5,5,6,6,(8). Two source-commentary footnotes at bottom
  (excluded from band detection). Key change to A major (###) at end of sys5.
- p10 /38: 265, 273, 281, 288, 296 -> 8,8,7,8,(8). Trio, sostenuto. "45/23" over sys2 is
  fingering, not a number. "1." bracket over m293 (sys4) is fingering.
- p11 /39: 304, 310, 316, 322, 328 -> 6,6,6,6,(6). "35" over sys5 bar 1 is fingering.
- p12 /40: 334, 340, 346, 352, 358 -> 6,6,6,6,(8). leggiero section.
- p13 /41: 366, 375, 383, 390, 398 -> 9,8,7,8,(8). Trio repeat written out.
- p14 /42: 406, 412, 418, 424, 430 -> 6,6,6,6,(6).
- p15 /43: 436, 442, 448, 454, 460 -> 6,6,6,6,(8).
- p16 /44: 468, 473, 479, 484, 489 -> 5,6,5,5,(5). Development; agitato at end of sys5.
- p17 /45: 494, 500, 506, 512, 518 -> 6,6,6,6,(6).
- p18 /46: 524, 530, 536, 541, 546 -> 6,6,5,5,(6). Key returns to 5 flats mid-sys2 (m534/535);
  sempre con fuoco. Footnote "Wariant/A variant possibly by Chopin" at bottom — text only.
- p19 /47: 552, 558, 564, 570, 576 -> 6,6,6,6,(8). calando/smorzando; sys5 treble staff is
  mostly rests (light ink) — staff-line detection used, so anchor y is reliable.
- p20 /48: 584, 592, 600, 610, 618 -> 8,8,10,8,(9). Reprise, sotto voce.
- p21 /49: 627, 636, 642, 648, 653 -> 9,6,6,5,(5). Systems 1–2 nearly touch; gap found at
  y≈0.208. Footnote "* Wariant jak w t. 240" — text only.
- p22 /50: 658, 663, 668, 673, 678 -> 5,5,5,5,(5).
- p23 /51: 683, 688, 693, 698, 703 -> 5,5,5,5,(5). cresc. buildup.
- p24 /52: 708, 714, 720, 726, 732 -> 6,6,6,6,(8). Key changes A major (m716ff) then back to
  5 flats (m724); più mosso at m733.
- p25 /53: 740, 748, 756, 762, 770 -> 8,8,6,8,(11). Final system m770–m780: counted 11 bars
  incl. final fermata chord; 770+11-1 = 780 ✓ (the only counted, unprinted total on the page).

## Validation

1. Continuity chain: monotonic; every system-start printed number equals previous start +
   implied bar count; chain closes at 780. PASS (checked programmatically over all 120 anchors).
2. MusicXML cross-check: `grep -c '<measure'` = 1560 total over 2 <part> elements (KernScores
   splits hands into separate parts) = 780 measures per part, numbered 1..780, no pickup,
   no offset vs printed numbers. PASS.
3. Landmark m67: XML LH part measure 67 = [Cb4, Db4, Gb4, Db4, Cb4, Gb3, Gb3] — contains
   C-flat. Printed score: p3 sys4 (starts m65, con anima) bar 3 LH shows the flat accidental
   on the C in the eighth-note figure (200dpi crop inspected). PASS.
4. Landmark m95: XML LH part measure 95 = [Ab3, Db4, F4(natural), Db4, Bb3, Db3, Db3] —
   contains F-natural. Position: p4 sys4 (starts m93) bar 3, consistent with anchor table
   (F is unaltered in the 5-flat signature, so no printed accidental expected in LH). PASS.

## Ambiguities / caveats

- None marked low_confidence. The only genuinely counted quantity was the final system's
  11 bars (m770–780); everything else is printed-number-to-printed-number.
- Editorial fingerings/cross-references that could be mistaken for measure numbers
  ("35" p2 sys1 8va note, "243" p4, "45/23" p10, "35" p11) were identified and ignored.
- yTopPct is the staff top, not the ink top: systems with high 8va passages (e.g. p2 sys1,
  p20) have notation up to ~0.05 above yTopPct. If the consumer needs ink-extent boxes
  rather than staff boxes, re-derive from the band data in /tmp/premap-scherzo/bands.json.
