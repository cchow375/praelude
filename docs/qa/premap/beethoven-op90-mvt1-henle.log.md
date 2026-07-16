# Pre-map log — Beethoven Piano Sonata No.27 Op.90, Mvt.1 (Allegro/"Mit Lebhaftigkeit..."), Henle Urtext (Wallner)

PDF: `Beethoven Op.90 - Henle Urtext (Wallner).pdf`, 15 pages total, 626.76 x 874.92 pt (scanned/image PDF,
Adobe Acrobat Image Conversion Plug-in — no text layer). Printed page numbers 196-210 (Henle collected-sonatas
volume pagination).

**This piece_id (4) covers movement 1 ONLY.** Movement 1 = PDF pages 1-6 (printed 196-201), measures 1-245.
Movement 2 ("Nicht zu geschwind und sehr singbar vorgetragen", Rondo, 2/4, key signature change to E major)
begins on PDF page 7 (printed 202) and runs through PDF page 15. Pages 7-15 are zero-anchored per the task's
movement-boundary rule — confirmed visually (page 7 opens with a new tempo heading, new time signature, new
key signature, and restarts local measure numbering "1, 5, 10, 15...").

No separate front-matter/title page: PDF page 1 carries both the "Sonate" title block (dedication, "Komponiert
1814", "Opus 90", "27.") AND the first system of movement 1 music on the same page. So all 6 mvt1 pages are
music pages; 0 pages are pure front matter within the movement-1 range.

## Method

Rendered all 15 pages at 150dpi (visual read of every page, all 15 read to find the mvt-boundary and confirm
page 1 has no separate title page) plus 200dpi grayscale renders of all 15 pages for programmatic staff-line
detection (only pages 1-6 needed for output, since mvt2 is zero-anchored).

- Staff-line detection: for each page, computed the fraction of dark pixels per row within the central
  20%-85% width band (avoiding clefs/braces/margins), thresholded at >55% dark to flag "staff-line rows",
  then clustered consecutive rows into line centers. Line centers were grouped into 5-line staves (gap
  <=25px) and staves into systems/grand-staves (gap <=106px between the two staves of one system; gaps
  > 106px separate consecutive systems). All 36 systems across pages 1-6 yielded a clean detectable
  > grand staff (2 x 5 lines = 10 lines/system).
- yTopPct = top line of the system's upper (treble) staff, as a fraction of full page height (2431px at
  200dpi for every page — uniform page size).
- yCenterPct = midpoint between the top line of the upper staff and the bottom line of the lower (bass)
  staff.
- Henle prints a circled measure number at the start of every system EXCEPT the very first system of the
  movement (page 1, top system), which starts at m1 by convention (implicit — obvious first measure, not
  printed). All other 35 anchors are read directly from Henle's printed circled numbers, not counted.

## Detector artifacts (found and corrected)

Four of the 36 systems had spurious extra near-full-width dark rows merged into the automated upper-staff
detection, all confirmed and corrected via zoomed pixel crops before finalizing y-values:

- **page 1, system 1 (m1)**: a spurious singleton line ~46.5px above the true staff top, caused by the bold
  tempo heading "Mit Lebhaftigkeit und durchaus mit Empfindung und Ausdruck" sitting close above the first
  system. True staff top identified as the next (5-line, evenly ~13.5px-spaced) cluster below it.
- **page 4, system 1 (m118)**: 1 spurious line above the true 5-line staff, caused by the beam of a fast,
  high running-16th-note passage (stems up, beam sits above the noteheads which are near the staff). Visually
  confirmed via `page04_cluster0_zoom.png` — the beam is clearly a full staff-height above the true clef/staff.
- **page 4, system 3 (m126)**: same artifact, 1 spurious beam-line above the true staff
  (`page04_cluster4_zoom.png`).
- **page 4, system 4 (m130)**: same artifact, 3 spurious beam-lines above the true staff (a longer, higher
  16th-note run) (`page04_cluster6_zoom.png`).

In every case the correction was to keep the lowest 5 detected lines in the contaminated cluster as the true
staff (visually verified, not assumed) — the bass staff of each of these systems was never affected. These
four yTopPct/yCenterPct values carry an estimated +/-0.02 uncertainty band from the visual-correction step;
not flagged `low_confidence: true` on the anchor itself since the measure number and general position are
unambiguous, but noted in `low_confidence_pages` in the JSON per the honesty rule.

One additional near-miss on page 4, system 2 (m122): the upper-staff cluster there had 2 extra closely-spaced
lines _below_ the clean 5-line staff (an unrelated small artifact, likely a dynamic-mark descender in the
inter-staff gap) — this did not affect the reported top (already the first of the clean 5) so no correction
was needed.

## Per-page notes (PDF page / printed page: system start measures)

- p1 /196: (1)[implicit], 8, 19, 29, 34, 39 -> bars 7,11,10,5,5,(8). Title block ("Sonate", dedication,
  "Komponiert 1814", tempo heading, "Opus 90", "27.") sits above system 1 on the same page. m1 starts with a
  2-eighth-note pickup (anacrusis) before the first full (numbered) measure.
- p2 /197: 47, 53, 57, 61, 65, 72 -> bars 6,4,4,4,7,(12).
- p3 /198: 84, 90, 96, 101, 107, 114 -> bars 6,6,5,6,7,(4). Footnote at bottom ("Wariant"/variant-source note
  re: m.144, printed across p.198-199) — text only.
- p4 /199: 118, 122, 126, 130, 135, 144 -> bars 4,4,4,5,9,(8). Fast, high 16th-note passages throughout
  (development-like figuration) — source of the 3 beam-artifact corrections above.
- p5 /200: 152, 163, 173, 178, 185, 192 -> bars 11,10,5,7,7,(6). m152 landmark verified here (sys1 bar1).
- p6 /201: 198, 202, 206, 211, 223, 235 -> bars 4,4,5,12,12,(11). Final system (m235) ends the movement with
  a fermata over a rest (matches XML's final `<fermata type="inverted"/>` on a quarter rest) and a light-light
  final barline. 235+11-1 = 245 ✓ (the only counted, unprinted span on the page/movement).
- p7 /202 onward: movement 2 ("Nicht zu geschwind und sehr singbar vorgetragen", 2/4, key sig changes to
  4 sharps/E major, local numbering restarts 1,5,10,15,20,25...). Zero-anchored, out of scope for piece_id 4
  mvt1.

## Validation

1. **Continuity chain**: monotonic; every system-start printed number equals the previous start plus the
   implied bar count of the previous system; chain closes at exactly 245 (final system m235 + 11 bars).
   PASS (checked programmatically over all 36 anchors: sum of the 35 gaps = 234, + final system's own
   11-measure span = 245).
2. **MusicXML cross-check**: `grep -c '<measure'` over the RH `<part>` (`P4a13fd1f154347a3c1c775a0a84fb8cb`)
   = 246 measures, numbered 0-245. Measure 0 has total note duration = 1 quarter note (two eighth notes,
   10080 divisions each at divisions=10080/quarter) against a 3/4 (30240-division) measure — i.e. a 2-eighth
   pickup/anacrusis, not a full measure. Measures 1-245 are therefore the 245 full, Henle-numbered measures.
   xml_offset_note: **offset = 0** (XML measure N = Henle printed measure N for all N, 1:1, no shift) —
   confirmed both by the pickup-measure duration analysis and by the printed-anchor chain summing exactly
   to 245 with zero discrepancy. PASS.
   - Caveat: the LH `<part>` (`P1c1cd703f15735a2420e39ab69d292d8`) only contains 161 `<measure>` tags
     (numbered 0-160), i.e. it is truncated partway through the movement — almost certainly an incomplete
     Kern-to-MusicXML conversion for that part (movement-title/key/time signature all confirm this XML is
     genuinely mvt.1, "Allegro", E minor, 3/4, matching the printed score's "Mit Lebhaftigkeit..." heading and
     1-sharp key signature — this is not a wrong-file issue, just a partial encoding of the LH staff). This
     was not relied on for the offset determination (done from the complete RH part) or for the printed-number
     anchor chain (which needs no XML measure content at all), so it does not affect this pre-map's output,
     but it is worth flagging for anyone doing note-level XML/PDF alignment work later on this file.
3. **Landmark m8** (page 1, system 2, bar 1): XML RH part measure 8 = B4, D5, D5 (with 1 rest in the bar).
   Printed score: p1 sys2 (labeled "8") bar 1 shows a dotted note with a turn-like ornament tied over, a
   quarter rest, then two further note-onsets — consistent onset/rest count (crop:
   `page01_sys2_zoom2.png`). PASS.
4. **Landmark m152** (page 5, system 1, bar 1): XML LH part measure 152 = G4, A3, E4, Eb4 (contains a flat).
   Printed score: p5 sys1 (labeled "152") bar 1 bass clef shows a small chord with a flat accidental directly
   preceding one of the lower notes, matching the Eb4 (crop: `page05_sys1_zoom.png`). PASS.

## Ambiguities / caveats

- m1's exact top-of-system y-value required discarding one spurious detector line (title-text artifact); see
  "Detector artifacts" above. The measure number itself (m1) is not ambiguous.
- Three systems on page 4 (m118, m126, m130) required discarding 1-3 spurious beam-artifact lines each from
  fast/high 16th-note passages; see "Detector artifacts" above. All four corrected values (m1, m118, m126,
  m130) carry an estimated +/-0.02 yTopPct/yCenterPct uncertainty band, listed under `low_confidence_pages`
  in the JSON, though the corrections were visually verified rather than guessed.
- The only genuinely counted (not printed) quantity in the whole movement is the final system's 11-bar span
  (m235-245); every other anchor-to-anchor gap is printed-number-to-printed-number.
- Editorial footnotes (variant readings at mm.144, 204, etc., printed at the bottom of pp.197-199) are
  text-only and were excluded from staff-line detection by restricting the detection band to the top ~90%
  central-width region per system; none interfered with system boundaries.
- Movement 2 (pages 7-15) was visually skimmed only far enough to confirm the movement boundary and was not
  otherwise anchored, per the task's scope (piece_id 4 = movement 1 only).
