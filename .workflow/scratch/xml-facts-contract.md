# score_xml_measure_facts contract (merged, commit 04220aa)

invoke('score_xml_measure_facts', { pieceId }) → {
measures: [{ number /* u32, always _/, key?, time?, tempo?, rehearsal?, section? /_ reserved, absent */ }],
max_measure?: number, // omitted only when zero numeric measures
has_pickup: boolean // measures may include number:0 (anacrusis) — strip renders it before bar 1
}
key = "-2 fifths" style; time = "3/4"; tempo = "quarter ≈ 92 BPM".
Errors: rejected string ("This piece has no MusicXML file…", ">10000 measures…", parse errors).
Async (spawn_blocking) — safe to call on wizard open.

WIRING SLICE TODO (after Phase C merges; ScoreView.tsx call site ~line 2133):

1. Pass renderPage to <MapScoreWizard> (reuse PdfPage at wizard scale) — the pane is a
   placeholder today and always was (the root of the mapping pain).
2. Fetch score_xml_measure_facts on wizard open → pass xmlMaxMeasure / hasPickup /
   xmlLandmarks (MeasureLandmark seam already in strip.ts).
3. Assistant citation source markers → open ReaderWindow (exported ReaderQuoteRef seam).
4. Purge visible "Score Atlas"/"atlas" strings (PiecesPanel header etc.) via terms.ts.
