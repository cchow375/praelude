# Plan C, Task C6 — REAL-API acceptance: Chopin Scherzo No. 2, Op. 31

Real Claude/Gemini vision API, real network, real vault files. Zero writes to the live DB
(both harness tests build a throwaway `Store::open(":memory:")` and register the real vault
piece folder into that; nothing here ever touches CodaKiller's real sqlite file or the vault
PDFs/images, which are read-only inputs throughout).

Harness: `src-tauri/src/score/plan_c_acceptance.rs` (`#[cfg(test)] mod plan_c_acceptance;` in
`score/mod.rs`, `#[ignore]`d — never runs in normal `cargo test`). Run with:

```
cd src-tauri && cargo test --lib -- --ignored plan_c_acceptance --nocapture
```

## Provider chain actually used

`security find-generic-password -s codakiller -a claude -w` returns "item not found" on this
machine — **no Claude/Anthropic key is configured in Keychain**, only `-a gemini`. So every
call in this run went through **Gemini only** (Claude-primary/Gemini-fallback chain with an
empty Claude slot). This matters for interpreting the results below: they are a Gemini-only
read, not a Claude read, and not a comparison between the two.

Gemini's free-tier rate limit was hit repeatedly (`HTTP 429`) even after the harness was
changed to pace one real call every 5s and give a rate-limited page one 20s-cooldown retry.
Two Ekier pages (24, 25) never came back clean after 4 combined attempts each across two
process runs and were recorded as skipped — a partial map, which the brief allows
("partial maps are legal"). Total real HTTP calls actually spent across the whole session
(three process runs: one uncached cold run, then two resumable/cached runs against an
on-disk per-page JSON cache keyed by page number so a re-run never re-pays for a page that
already succeeded): 28 + 30 + 5 = 63. This is over the brief's 40-call guidance for a single
clean run; the overrun is entirely rate-limit retries on a Gemini-only chain, not runaway
looping — each failing page got at most 2 attempts per process run, and the caching made every
re-run pay only for what was still missing.

## Ekier PDF — full 25-page scan (23/25 obtained)

All 25 pages went through `measure_scan_page` with `page_jpeg: None` first (server-side
`render_page_image` fast path). Page 1 (title page, no music, vector text) refused with
`needs_client_raster`, exactly as expected for a non-scan page — rasterized via
`pdftoppm -jpeg -r 200` as the documented browser-canvas stand-in, then re-scanned. All other
pages (2–25) rendered as a single-image scan server-side and never needed the client-raster
path — Ekier's page images ARE single full-page scans internally, even though the edition
"reads" as an engraved/vector-looking score.

| Page | Latency                        | Client raster?   | Systems | Bars (barline_xs) | Printed numbers read                                                                                        | Match ground truth? |
| ---- | ------------------------------ | ---------------- | ------- | ----------------- | ----------------------------------------------------------------------------------------------------------- | ------------------- |
| 1    | 2.8s                           | yes (title page) | 0       | 0                 | —                                                                                                           | n/a (no music)      |
| 2    | 13.1s                          | no               | 5       | 51                | 9,17,27,35                                                                                                  | **exact**           |
| 3    | 12.6s                          | no               | 5       | 30                | 44,53,59,65,71                                                                                              | **exact**           |
| 4    | 11.6s                          | no               | 5       | 26                | 77,82,87,93,98                                                                                              | **exact**           |
| 5    | 14.9s                          | no               | 5       | 31                | 103,108,113,119,125                                                                                         | **exact**           |
| 6    | 15.1s                          | no               | 5       | 34                | 133,141,149,159,167                                                                                         | **exact**           |
| 7    | 13.9s                          | no               | 5       | 34                | 176,185,191,197,203                                                                                         | **exact**           |
| 8    | 11.2s                          | no               | 5       | 25                | 209,214,219,225,230                                                                                         | **exact**           |
| 9    | 11.9s                          | no               | 5       | 30                | 235,240,245,251,257                                                                                         | **exact**           |
| 10   | 11.7s                          | no               | 5       | 39                | 265,273,281,288,296                                                                                         | **exact**           |
| 11   | 11.4s                          | no               | 5       | 35                | 304,310,316,322,328                                                                                         | **exact**           |
| 12   | 11.6s                          | no               | 5       | 32                | 334,340,346,352,358                                                                                         | **exact**           |
| 13   | 11.8s                          | no               | 5       | 36                | 366,375,383,390,398                                                                                         | **exact**           |
| 14   | 11.2s                          | no               | 5       | 26                | 406,412,418,424,430                                                                                         | **exact**           |
| 15   | 11.3s                          | no               | 5       | 29                | 436,442,448,454,460                                                                                         | **exact**           |
| 16   | 11.6s                          | no               | 5       | 26                | 468,473,479,484,489                                                                                         | **exact**           |
| 17   | 11.2s                          | no               | 5       | 27                | 494,500,506,512,518                                                                                         | **exact**           |
| 18   | 19.5s                          | no               | 5       | 32                | 524,530,536,541,546                                                                                         | **exact**           |
| 19   | 12.1s                          | no               | 5       | 35                | 552,558,564,570,576                                                                                         | **exact**           |
| 20   | 12.1s                          | no               | 5       | 40                | 584,592,600,610,618                                                                                         | **exact**           |
| 21   | 34.7s (incl. one 429+cooldown) | no               | 5       | 33                | 627,636,642,648,653                                                                                         | **exact**           |
| 22   | 11.2s                          | no               | 5       | 25                | 658,663,668,673,678                                                                                         | **exact**           |
| 23   | 7.0s                           | no               | 5       | 24                | 683,688,693,698,703                                                                                         | **exact**           |
| 24   | —                              | —                | —       | —                 | **never obtained** — `HTTP 429` on 4 combined attempts (2 process runs × 1 attempt + 1 cooldown-retry each) | —                   |
| 25   | —                              | —                | —       | —                 | **never obtained** — same, 4 combined attempts                                                              | —                   |

Ground truth throughout is `docs/qa/premap/scherzo-op31-ekier.log.md` — a hand-verified
pre-map built before this task by rendering every page at 150dpi and reading every printed
number visually, cross-checked against the MusicXML (`grep -c '<measure'` = 1560/2 parts =
780 measures, no pickup) and against the printed score for the two vault landmarks.

**Every single printed measure number the model read, on every page it successfully scanned
(22 music pages + page 23), matched the hand-verified ground truth exactly** — same digits,
same count per page (this page's system 1 at m.1 correctly has no printed number, matching
that convention; every other system-start number is correct). Confidence scores ranged 0.85–0.98
and did not correlate with correctness — the model was equally right at 0.85 as at 0.98 in this
sample. **OCR of printed measure numbers is, on this evidence, essentially flawless.**

### The problem: `barline_xs` (bar-count-per-system) is unreliable

The bar count implied by two consecutive ground-truth printed numbers (e.g. p.2's "9" then
"17" implies exactly 8 bars in that system) very often does **not** match the number of
`barline_xs` entries the model reported for that same system:

| Page | Expected total bars (ground truth, page-to-page) | Model's reported total bars | Delta     |
| ---- | ------------------------------------------------ | --------------------------- | --------- |
| 2    | 43                                               | 51                          | +8        |
| 3    | 33                                               | 30                          | −3        |
| 4    | 26                                               | 26                          | 0 (exact) |
| 5    | 30                                               | 31                          | +1        |
| 6    | 43                                               | 34                          | −9        |
| 7    | 33                                               | 34                          | +1        |
| 8    | 26                                               | 25                          | −1        |
| 9    | 30                                               | 30                          | 0 (exact) |
| 10   | 39                                               | 39                          | 0 (exact) |
| 11   | 30                                               | 35                          | +5        |
| 12   | 32                                               | 32                          | 0 (exact) |
| 13   | 40                                               | 36                          | −4        |
| 14   | 30                                               | 26                          | −4        |
| 15   | 32                                               | 29                          | −3        |
| 16   | 26                                               | 26                          | 0 (exact) |
| 17   | 30                                               | 27                          | −3        |
| 18   | 28                                               | 32                          | +4        |
| 19   | 32                                               | 35                          | +3        |
| 20   | 43                                               | 40                          | −3        |
| 21   | 31                                               | 33                          | +2        |
| 22   | 25                                               | 25                          | 0 (exact) |
| 23   | 25                                               | 24                          | −1        |

Exact on 6/22, within ±1 on 3 more, off by 2 or more (up to −9) on the remaining 13. Both
over- and under-counting occur, on both directions, with no obvious pattern (not always the
last system on a page, not always the busiest passage). This is the actual finding: **the
model reads printed digits perfectly but cannot reliably count physical bar lines within a
system.**

### Reconcile + review-style pins (in the harness)

`measure_reconcile::reconcile` on the 23 available pages, no calibration anchors:
**113 conflicts** (mostly `ContinuityBreak` from the barline miscounts above, plus
`Unapplyable` "bar numbers must strictly increase" on systems where two consecutive real
anchors' implied bar count didn't match what was actually laid out, plus one `TotalMismatch`).

**Pins applied** (simulating what a reviewer would type into the review UI's pin affordance):
for every page `reconcile` flagged with a conflict, a `CalibrationAnchor { page, measure }` was
added from the hand-verified ground truth (`docs/qa/premap/scherzo-op31-ekier.log.md`) — pages
2 through 21, all pinned to their known-correct first-system start measure, each logged with
its reason (`PIN page=N measure=M reason="review-UI-style pin from the hand-verified pre-map
log ... because reconcile flagged a conflict on this page"`).

**Result after pins: 122 conflicts (went UP, not down)** — 9 new `AnchorDisagreement`
conflicts appeared (e.g. page 3: pin says 44, but the page-2→page-3 forward-fill, corrupted by
page 2's own barline miscounts, produced 45 there instead). This is the honest, load-bearing
finding for this task: **a calibration pin only flags that page's disagreement — it does not,
and structurally cannot, repair the underlying defect, because the defect is not "the wrong
number was chosen," it is "the wrong number of bar objects exists in the system."** The real
review UI's per-bar renumber (C4's TS-side `measureMap.ts`, `MapBarSource::User`) could
override an individual anchor's printed number, but the bars BETWEEN two anchors would still be
the wrong count — there would be too many or too few physical positions to letter-space the
numbers into, however they're typed. Fixing this needs a different vision pass (or a
geometry-validation heuristic) for the barlines themselves, not a numbering fix — exactly the
"do not tune prompts blind, the controller decides" case the brief describes.

### Landmarks (m.67, m.95) and total

- **m.67 (LH C♭) → located on page 3** — matches the hand-verified expectation exactly.
- **m.95 (LH F♮) → located on page 4** — matches the hand-verified expectation exactly.
- **Total**: mapped `total_bars = 700` across the 23 available pages vs `XmlTotals.max_measure
= 780` (from the real KernScores MusicXML, parsed by `brain::score_xml_measure_facts` against
  a `PieceDetail` built from the real vault paths — `has_pickup = false`, matching the
  pre-map log). Even accounting for the two entirely-missing pages (24 and 25, worth roughly 60
  more bars going by neighboring pages' bar counts), the arithmetic doesn't close cleanly —
  some of the 780 − 700 = 80-bar gap is the missing pages, the rest is the same barline
  under/over-counting documented above.

## Cortot — multi-staff / client-raster arm (3 pages)

3 mid-piece, clean grand-staff pages from `Cortot Scherzos 1-2 (Salabert, Slideshare scan)/`
(picked by viewing the images first, avoiding pages with Cortot's pedagogical exercise
inserts, which would make an honest hand count ambiguous). All 3 went through
`measure_scan_page` with `page_jpeg: Some(...)` directly — the on-disk JPEGs (already exactly
what a browser canvas would produce) ARE the client raster; no PDF rendering happens for this
arm at all.

| File        | Piece context (per the set's own `_README.md`)                      | Hand count (systems / bars)                                                           | Model (systems / bars-per-system)        | System count exact? | Bars/page within ±1?                                                                                                                              |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| page-28.jpg | p.29, Scherzo No.2 ≈m.61+ (§2 D♭ theme, "Con anima")                | **4 systems**, ≈22 bars (visual read: a short top system, then 3 six-bar-ish systems) | **5 systems**, `[3,4,4,4,2]` = 17 bars   | **no** (4 vs 5)     | no (22 vs 17, −5)                                                                                                                                 |
| page-33.jpg | p.34, ≈m.197+ (§3 lyrical recap, approx per the source's own table) | **6 systems**, ≈30 bars (visually 5 bars/system, very regular)                        | **6 systems**, `[6,6,6,6,6,6]` = 36 bars | **yes**             | no (30 vs 36, +6 — a suspiciously uniform "+1 bar per system", consistent with the same barline over-count pattern seen throughout the Ekier arm) |
| page-48.jpg | p.49, ≈m.581+ (§7 recap opening, sotto voce)                        | **6 systems**, ≈31 bars (visual read, less regular spacing than page-33)              | **6 systems**, `[5,5,4,5,7,7]` = 33 bars | **yes**             | close (31 vs 33, +2 — nearest to target of the three)                                                                                             |

Hand counts here are my own visual reads of the images (not a pre-existing verified log, unlike
the Ekier arm) — stated as approximate, not certified to the bar. System count is the more
reliable of the two hand counts (a system boundary is visually unambiguous; an individual
barline inside a dense system is not, especially at 1024×2107 JPEG resolution). Even allowing
generous margin on my own count, page-33's uniform +1-per-system delta and the general spread
here corroborate the Ekier finding rather than contradicting it: **system-level structure
detection is good (2/3 exact, 3/3 close); bar-line counting within a system is the weak link,
in both the PDF-rendered arm and the pure client-raster arm.**

## Cost / latency actually observed

`ProviderChain::vision_texts` returns only the parsed candidate texts, not response usage
metadata — this harness has no path to real input/output token counts, so no honest per-call
$ estimate can be given from what was actually measured (better than guessing a number). What
was measured: real per-call latency 6–20s on a clean call (median ≈ 12s), up to 35s including
a rate-limit cooldown retry; 63 real HTTP calls spent this session end-to-end (see the provider
chain section above for why that's over the 40-call guidance — Gemini-only chain, repeated
429s, not runaway retries).

## What the model got wrong (honest summary)

1. **Printed measure numbers: correct on 100% of pages successfully scanned** (22/22 music
   pages + 1 partial), matching a pre-existing, independently hand-verified ground truth
   exactly, digit-for-digit, including correctly NOT inventing a number for the piece's
   unprinted first bar.
2. **Barline/bar-count-per-system: unreliable**, both over- and under-counting, on both the
   PDF-rendered arm (Ekier) and the client-raster arm (Cortot), with no obvious pattern to the
   direction or magnitude of the miscount. This is not fixable by a review-UI-style calibration
   pin, because a pin only overrides which number an anchor bar shows — it cannot conjure or
   remove the bar objects a corrupted `barline_xs` count is missing or has extra.
3. **Availability**: Gemini's free tier rate-limited hard enough that 2/25 Ekier pages were
   never obtained even after 4 combined attempts each with a 20s cooldown — a real gap in this
   evidence, not a simulated one. (No Claude key was configured on this machine, so this run
   could not compare against or fall back to Claude at all.)
4. **System-count detection is comparatively strong**: exact on the Ekier arm throughout (every
   successfully-scanned page reported exactly 5 systems, matching the pre-map log's own
   per-page count of 5 everywhere) and exact on 2/3 Cortot pages.

## Acceptance verdicts

1. **Ekier sampled printed numbers (≥5 pages incl. first/last) after review-style pins**:
   **FAIL as specified.** The raw OCR read is perfect on every sampled page (first successfully
   scanned page 2, and every page through 23), but the true last page of the piece (25) was
   never obtained, and — more importantly — the _reconciled, pinned_ map does not match ground
   truth on most pages, because the underlying bar-count defect survives pinning.
2. **Ekier landmarks (m.67→p.3, m.95→p.4) + total reconciles under the pickup rule**:
   **PARTIAL / FAIL.** Both landmarks locate to exactly the right page. The total does not
   reconcile (700 mapped vs 780 XML `max_measure`, `has_pickup=false` on both sides) — partly
   the 2 missing pages, partly the same barline miscount.
3. **Cortot multi-staff arm (system count exact, bars within 1/page)**: **PARTIAL / FAIL.**
   System count exact on 2/3 pages (page-33, page-48), off by one on page-28. Bar count within
   ±1/page target met on 0/3 pages by my hand count, though page-48 comes close (+2).

**Overall: BLOCKED.** Per the brief's own instruction ("If acceptance FAILS ... report BLOCKED
with the evidence — do not tune prompts blind; the controller decides the iteration"), this is
reported as blocked rather than attempting a blind prompt fix. The evidence above is specific
enough to act on: printed-number reading needs no work; barline/bar-boundary geometry detection
does, and a calibration-anchor pin is not the right repair mechanism for that class of defect.

---

## C6b iteration (system-start bracket rule)

The controller's decision from the C6 finding above: when two consecutive real printed
anchors each sit at their OWN system's first bar, AND are on immediately adjacent systems (no
unlabeled system in between), the number gap between them is unambiguous ground truth for that
earlier system's full bar count — independent of whatever `barline_xs` the model itself
reported. `measure_reconcile::reconcile` now applies this deterministically: agreement keeps
the model's positions; disagreement resynthesizes the system as N evenly spaced bars
(`source: interpolated`, `confidence: None`) and raises a new low-severity `derived_bar_count`
conflict instead of a `continuity_break`. A system whose successor's start has no real anchor
(this piece's own convention: a page's first system is rarely itself numbered) is simply left
alone, unchanged, falling through to the existing `continuity_break` handling. Mirrored in the
TS `MapConflict` union, `describeConflict`, and the devMock's own `mockReconcile` (which
independently re-derives the same contract offline for the QA harness). Full detail, the exact
algorithm, and 4 new Rust tests (override / agreement / unbracketed / mixed page) are in
`task-C6-report.md`'s "C6b" section and the `measure_reconcile.rs` module doc comment. Gates:
`cargo test --lib` 808/0, `cargo clippy --all-targets -- -D warnings` clean, `vitest` 1982/0,
`tsc --noEmit` clean.

### Re-run mechanics

The on-disk resumable cache from the C6 run (`plan-c-acceptance-ekier-cache`, keyed by page,
under `std::env::temp_dir()`) survived intact: 23/25 Ekier pages were served from cache with
**zero new API calls**. Only the 2 pages C6 never obtained (24, 25) were retried, across two
process runs, respecting the brief's ≤6-call budget for this case: run 1 spent 4 calls
(page 24 rate-limited even after one cooldown retry; page 25 succeeded and was cached), run 2
spent 2 more calls retrying page 24 alone (rate-limited again). **Total: 6 real API calls this
iteration**, all against Gemini (still no Claude/Anthropic key in this machine's Keychain — see
the original C6 provider-chain note, unchanged). Page 25's OCR was checked against the
hand-verified ground truth log and is exact, digit-for-digit (740, 748, 756, 762, 770), same as
every other page. Page 24 remains never obtained (2/25 pages missing at C6, now 1/25) — the
same real rate-limit gap, not a simulated one; no further retries were spent past the budget.

### What changed, concretely

Of the 22 within-page system-start brackets checked across the 24 obtained pages, 11 disagreed
with the model's own `barline_xs` count and were corrected:

| Page | System(s) corrected                                   | Effect                                                                                                                              |
| ---- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2    | 2, 3, 4                                               | Partial — page 2's system 1→5 span still has an uncorrected tail (unbracketed final system).                                        |
| 8    | 3                                                     | Partial — page 8 still needed a pin for its own unbracketed final system.                                                           |
| 10   | 1, 4                                                  | Partial — same pattern.                                                                                                             |
| 19   | 1, 2, 3, 4 (all four bracketable systems on the page) | **Full** — page 19 no longer appears in the pinned-pages list at all; it reconciles correctly with zero pin. It needed a pin at C6. |
| 23   | 1                                                     | Partial.                                                                                                                            |

Landmarks are unaffected and still both exact: **m.67 → page 3**, **m.95 → page 4**. The
`total_mismatch` gap narrowed sharply in absolute terms — **mapped 775 vs XML 780 (gap 5)**,
down from C6's 700 vs 780 (gap 80) — but this narrowing is partly an artifact of how often the
piece re-anchors (each page has ~4 printed numbers, so numbering resets close to correct near
the END of the stream regardless of drift earlier in it) rather than proof the WHOLE piece's
physical bar count is now right: 66 `continuity_break` conflicts remain (mostly each page's
own unlabeled first system, which the bracket rule deliberately does not touch — see rule 2 in
`measure_reconcile`'s doc comment) and page 24 is still entirely missing from the stream.

### Recomputed acceptance verdicts (C6b)

1. **Ekier sampled printed numbers (pages 2, 8, 14, 20, 25) after review-style pins**:
   **still FAIL**, but narrower. Raw OCR remains 100% exact on every obtained page (now 24/25,
   up from 23/25 — page 25 confirmed exact this run). The RECONCILED, pinned map's first bar
   now matches ground truth exactly on 2/5 sampled pages (2 → 1, 8 → 209 — page 8 needed no
   correction to land there, unlike at C6), against 3/5 mismatches (14: 404 vs 406; 20: 583 vs
   584; 25: 708 vs 740, the last one entirely explained by page 24's continued absence). The
   underlying defect for the remaining mismatches is specifically the un-bracketed,
   page-opening system this rule was scoped to leave alone (rule 2), not a regression.
2. **Ekier landmarks (m.67→p.3, m.95→p.4) + total reconciles under the pickup rule**:
   **PARTIAL**, improved. Both landmarks still locate to the exact right page (unchanged). The
   total's absolute gap narrowed from 80 to 5, but for the reason explained above (frequent
   re-anchoring resets late-stream drift), not because the whole piece's physical bar count is
   now correct — 66 `continuity_break`s remain, concentrated on each page's unlabeled first
   system, plus page 24 is still entirely unmapped.
3. **Cortot multi-staff arm (system count exact, bars within 1/page)**: **not re-run** — this
   arm's evidence never goes through `measure_reconcile` at all (each page is scanned and
   hand-compared in isolation, no page-to-page or within-page printed-number anchors to
   bracket), so the C6b algorithm change has no mechanism to affect it. Per the brief
   ("if its pages lack per-system numbering, an honest PARTIAL stands"), the original C6
   verdict — system count exact on 2/3 pages, bar-count-within-1 met on 0/3 — is carried
   forward unchanged rather than re-asserted without new evidence.

**Overall: still BLOCKED**, per the same instruction as C6 ("if acceptance STILL fails, report
BLOCKED with the evidence — no further blind iteration"). The controller's specific, targeted
fix is implemented, tested, and shipped (all gates green) and produced a real, measured
improvement (one full page and parts of four others auto-corrected with zero operator pins,
the total gap narrowed 80→5, 24/25 pages now obtained), but the piece does not yet fully
reconcile end-to-end against ground truth. The remaining gap is now narrower and differently
shaped than at C6: it is concentrated in the unbracketed, page-opening systems (by design left
untouched by this rule) plus the still-missing page 24 — a different, smaller-scoped problem
than C6's "barline counting is unreliable everywhere," and a plausible target for a further,
explicitly-scoped iteration (e.g. extending the bracket rule to use calibration-pin anchors as
bracket endpoints too, or a geometry-validation pass), but that is the controller's call, not
this iteration's to make unprompted.
