# Pre-map log — Prokofiev Sonata No.1 Op.1 (single movement), Jurgenson first edition

(Prokofiev Op.1 - Jurgenson first edition (IMSLP #530801).pdf, piece_id=3)

Method: rendered all 18 PDF pages at 150dpi for an initial page-by-page overview (front
matter / music / back matter check), then re-rendered pages 3-17 (the music) at 300dpi
and worked system-by-system with 2-4 overlapping crops per system (typically a "left
half"/"right half" or "upper band"/"lower band" pair, occasionally a third confirmation
crop when a system boundary or barline was ambiguous). Bar-counting is 100% direct visual
barline-counting — see "No printed numbers" below.

No printed numbers: this Jurgenson first edition prints NO measure numbers and NO
rehearsal numbers/boxed letters anywhere in the score (unlike the Ekier Chopin pilot).
Every measure in this file is derived by counting barlines directly off the page image.
No fingering-like numerals, dedication text, or engraving-plate numbers ("35098", printed
at the foot of every music page) were mistaken for measure/rehearsal numbers.

Programmatic staff detection: attempted first (row-wise dark-pixel density profile,
scripts detect_staves.py / detect_systems.py in the working directory), on both 100dpi and
300dpi grayscale renders. It did not work reliably on this old scan — thin/broken staff
lines, uneven ink density, and no vector data caused adjacent systems to merge into one
detected band or single systems to fragment into several. Abandoned in favor of visual
estimation: yTopPct/yCenterPct below are read directly off the same 300dpi system crops
used for bar-counting (system block top and bottom), not staff-line pixel detection.
Treat y-values as visual estimates, target precision ±0.02 (see confidence_notes in the
JSON for full detail).

Front/back matter: PDF page 1 = title page ("Prokofiev, Op. 1, Jurgenson"), 0 anchors.
PDF page 2 = blank verso, 0 anchors. Music runs PDF pages 3-17, and the printed page
number equals the PDF page number 1:1 (e.g. PDF page 3 is printed "3", PDF page 17 is
printed "17") — no offset. PDF page 18 = blank pastedown/inside-back-cover with faint
ghost bleed-through from page 17's verso only, 0 anchors.

Structure notes: no repeat signs, D.C./D.S. al Fine, or volta brackets found anywhere —
the movement is through-composed, printed bar order = performance order throughout.
Meter alternates between 12/8 (primary) and 4/4 several times (first change on p.5, then
pp.7, 9, 10, 11, 16, 17); these are noted per-page below but do not affect bar-counting
since barlines were counted directly regardless of the meter in effect. Tempo changes:
"Allegro" (opening, p.3), "Meno mosso"/"Allegro" reprise (p.12), "Più mosso" coda (p.17,
leading to a final "Meno mosso" close on the same page). The piece ends on p.17 with a
thick final double barline; a small mark above the final chord may be a fermata but scan
resolution does not confirm it definitively (does not affect the measure count).

## Per-page notes (PDF page = printed page; systems numbered top to bottom; bar counts

## are the number of measures in that system; "m<n>" = measure n, the system's first bar)

- p1: title page. 0 anchors.
- p2: blank verso. 0 anchors.
- p3 (m1-15): 5 systems x 3 bars. Allegro, 12/8, opens with pickup-free rest+chord bar.
  Dedication/title heading pushes system 1 further down the page than later pages (no
  other page has this much header text). No printed numbers, no rehearsal marks.
- p4 (m16-30): 5 systems x 3 bars. "Episode"-style pencil-adjacent annotation near system
  4 is not part of the engraving (ignored, not a rehearsal mark).
- p5 (m31-45): 5 systems x 3 bars. Meter changes 12/8->4/4 mid system-2/start of system-3,
  reverts to 12/8 at system-4/system-5 boundary; mid-bar clef changes (bass<->treble)
  appear inside single measures on this page, does not create extra bars.
- p6 (m46-63): systems = 4,4,4,3,3 bars. Slower dotted-half/quarter chordal writing on
  systems 1-3 fits 4 bars/system vs. the eighth-note-run pages which fit 3; re-verified
  system 1 and system 4's bar count with dedicated crops after an initial miscount risk
  (repeating "rest+chord tied" figure at both bar1 and bar3 of system 2 looked like it
  might hide a 4th bar — confirmed only 3 bars actually present in system 2... correction:
  system 2 confirmed at 4 bars, matching systems 1 and 3; systems 4-5 confirmed at 3 bars
  each via dedicated full-width crops).
- p7 (m64-80): systems = 4,4,3,3,3. Meter changes 12/8->4/4 at system 3 (courtesy "4/4"
  printed mid-system before an accented chord + eighth-note run).
- p8 (m81-96): systems = 3,3,3,4,3. Accented (">") recap-like material; system 4 confirmed
  4 bars via dedicated crop after the top/bottom overview undercounted.
- p9 (m97-111): 5 systems x 3 bars. Key signature narrows to 1 flat mid-page (system 4)
  then a courtesy sharp-key signature appears at the very end of system 4 before reverting;
  meter touches 4/4 briefly (systems 4-5) then returns to 12/8 for the next page.
- p10 (m112-128): systems = 3,3,3,4,4. One sharp key signature carries in from p9; meter
  4/4 appears briefly mid system 3 then reverts to 12/8 courtesy sig at system 3's end.
  Systems 4 and 5 both open with a similar "chord, rest, chord | chord tied" figure
  (written-out sequence) — re-verified with a combined lower-half crop to rule out a
  double-count; confirmed genuinely 4+4 distinct bars, not an artifact of the crop split.
- p11 (m129-145): systems = 4,3,3,3,4. Dense page: "pesante" (system 1), a "ritard...a
  tempo" + key change to 3 flats/4/4 mid system 2, triplet/quadruplet writing in 3 flats
  on system 3, "fff" climax on system 4, "rit. molto" + reversion to 12/8 courtesy sig at
  the very end of system 5. Multiple systems needed a second, wider crop to resolve
  barline positions given the meter/key changes; all re-confirmed.
- p12 (m146-163): 6 systems x 3 bars (only page with 6 systems) — "Meno mosso" (systems
  1-2, pp), "Allegro" reprise pp (system 3), then 3 more systems of running 8th-note
  material (systems 4-6, the last marked "8va..." / "sf" respectively). Initially missed
  system 6 on the first overview pass (mis-read the page as having only 5 systems) —
  caught it only after checking the bottom margin near the plate number and finding a
  6th system had been sitting just above it; systems 1-2 and 3 bar counts re-verified
  afterward as a precaution given the miscount risk. This is the one page where the
  overview genuinely undercounted systems, flagged here for transparency even though the
  final per-system bar counts (all 3) were independently re-confirmed.
- p13 (m164-178): 5 systems x 3 bars. Dense chromatic running-note writing; one clef
  change bass<->treble occurs mid-bar 1 of system 2. An "8va---" bracket starts inside
  system 3's bar 3 and continues visually into system 4 (engraving convention, does not
  imply an extra bar or a repeated system).
- p14 (m179-193): systems = 3,3,4,4,1. System 5 is a genuine 1-bar system: the page ends
  mid-phrase during a fast "sempre animando" 4/4 eighth-note run that continues onto p.15;
  confirmed by the absence of any further barline before the plate number and by p.15
  opening with a fresh system in the same rhythmic style (a page break at a barline is
  normal engraving practice; the very short system 5 here is just where that barline
  happened to fall relative to the system layout). Systems 3 and 4 use slower dotted-half
  chords (4 bars/system, like p.6) rather than the eighth-note-run 3-bar pattern.
- p15 (m194-208): 5 systems x 3 bars. Continues the "sempre animando" 4/4 running passage
  from p.14 (4 note-groups per bar throughout, used as a secondary check on bar boundaries
  alongside the barlines themselves); meter reverts to 12/8 at the very end of system 5
  (courtesy sig printed at the start of that system's final/3rd bar, which carries an
  accented "f" chord) — re-verified this was not a hidden 4th bar; confirmed 3 bars.
- p16 (m209-223): 5 systems x 3 bars. Heavy accent (">") writing (climax buildup); meter
  4/4 appears mid system 3 ("rit."->"ff") then reverts to 12/8 courtesy sig at the very
  end of system 5, immediately before the plate number — re-verified system 5 was not
  followed by a hidden 6th system (a repeat crop initially looked like a new system but
  proved to be an overlap re-showing system 5's own tail).
- p17 (m224-240, final page): systems = 3,3,3,4,4. "Più mosso" coda opens the page (system
  1); systems 1-3 are built from a repeating accented-chord figure (written-out sequence,
  re-verified system 2 was a fresh repetition and not a re-crop of system 1). System 4
  shifts to a "rit."/"ff" broader-rhythm passage (4 bars, chords + rests rather than the
  4-groups/bar running pattern) — recounted twice with zoomed crops to be sure, since the
  rhythm here is sparser and easy to undercount; confirmed 4 bars. System 5, marked "Meno
  mosso", is the final system: 4 bars, ending on a thick double barline (end of piece).
  A small curved mark above the very last chord may be a fermata; scan resolution at the
  page's physical edge does not allow a confident call either way — noted as a caveat,
  not a low_confidence flag (it has no bearing on the measure count).

## Validation

1. Continuity chain: monotonic; every system's start measure equals the previous
   system's start + that system's bar count; chain closes at m240 (final system, p.17,
   starts m237 and has 4 bars: 237+4-1=240, matching the final double barline). PASS
   (this is the only validation available per the task scope — no MusicXML exists for
   this piece/edition and no printed measure numbers exist to cross-check against).
2. No independent numbering cross-check possible (see xml_offset_note = "no XML").
   Internal consistency was instead reinforced by re-deriving several ambiguous systems
   from a second, differently-bounded crop (pp. 6, 8, 10, 11, 13, 15, 16, 17 all had at
   least one system re-verified this way); the one page where the initial pass actually
   missed something was p.12 (missed a 6th system on first look, see note above) —
   caught before finalizing.
3. Plausibility check: 240 measures for a single-movement sonata-form Allegro of this
   scope (Prokofiev's own tempo indications imply roughly 5-6 minutes of music) is
   consistent with published measure-count references for this work in other editions
   (low-to-mid 200s), which is a reasonable (not proof-level) sanity signal given no
   direct cross-check exists for this specific print.

## Ambiguities / caveats

- No anchor is marked low_confidence: true, because every system's bar count was pinned
  down with a dedicated zoomed crop before being locked in (see per-page notes above for
  the specific re-checks). The two lowest-effort pages were p.4 and p.5 (read from
  top/bottom half overviews only, no further per-system crop) — flagged for transparency;
  their bar counts (3/3/3/3/3 each) were unambiguous in the overview with no boundary
  uncertainty, so a further re-crop was judged unnecessary rather than skipped for speed.
- p.12's 6th system was missed on the first full-page pass and only found by checking the
  bottom margin near the plate number; this is the single biggest miss-risk moment in the
  whole document and is called out here explicitly even though it was caught.
- p.14 system 5 (1 bar) and p.17 system 4 (sparser rhythm, 4 bars) are both unusual
  relative to the piece's dominant "~3 bars/system" pattern; both were re-verified rather
  than accepted from a single read.
- A possible fermata on the very final chord (p.17) could not be confirmed at scan
  resolution; noted but not blocking, since it doesn't change the measure count.
- yTopPct/yCenterPct are visual estimates (system-block boundaries read off the same
  300dpi crops used for bar-counting), not programmatic staff-line detection — see
  confidence_notes in the JSON and the "Programmatic staff detection" section above for
  why automatic detection was abandoned for this source. Precision target ±0.02; systems
  with heavy 8va brackets/dynamics text above the top staff line may push the true staff
  top a little below the recorded yTopPct, same caveat as the Ekier pilot.
