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

---

## C6c iteration (cross-page brackets + XML virtual end anchor)

The controller's follow-up decision, evidence-directed by C6b's own finding (the residual drift
was concentrated at page boundaries and in the piece total): two extensions of the identical
system-start bracket rule, no new mechanism. (1) **Cross-page brackets**: a bracket's span is no
longer restricted to two immediately-adjacent systems — it is every system between two
consecutive system-start anchors in the GLOBAL page/system/bar stream, however many pages or
unlabeled systems it crosses. A multi-system span's derived total is split across its systems by
the **largest-remainder / Hamilton apportionment method**, proportional to each system's own
original count (deterministic; documented in `largest_remainder_distribute`'s doc comment).
(2) **Virtual end anchor**: when `XmlTotals` is available and at least one real system-start
anchor exists, a synthetic anchor `{ index: end_of_stream, number: max_measure + 1 }` closes the
bracket chain, so the trailing span (after the last real anchor) is bracketed too — this is why
`total_mismatch` now rarely fires when a system-start anchor exists at all: the total gets
corrected the same way any other bracket disagreement does. No new `MapConflict` kind was
needed (still `derived_bar_count`, from C6b), so per the controller's instruction the TS
union/devMock mirror were intentionally left untouched this iteration — see
`task-C6-report.md`'s "C6c" section for the exact tests (renamed/updated where C6b's own tests
pinned the now-superseded single-system-only restriction) and the module doc comment
("System-start bracketing" + "Cross-page brackets and the virtual end anchor") for the full
rationale. Gates: `cargo test --lib` 811/0, `cargo clippy --all-targets -- -D warnings` clean.

### Re-run mechanics: fully offline, zero API calls

Per the brief, this iteration re-reconciled purely from the C6/C6b on-disk cache — a new,
dedicated `#[ignore]`d test (`ekier_offline_reconcile_from_cache_c6c` in `plan_c_acceptance.rs`)
reads the 24 cached `page-N.json` files directly and calls `measure_reconcile::reconcile` with no
`ProviderChain`, no network, and no Keychain lookup at all. Page 24 remains the one page never
obtained (still rate-limited as of C6b; not retried again this iteration, respecting the "no
further iteration" instruction on the acceptance side — only the algorithm changed). Samples were
taken around the gap (page 23, immediately before it) as instructed, in addition to the original 5.

### What changed, concretely

- **`derived_bar_count` resolutions: 35** (up from C6b's 11) — the cross-page rule now also
  corrects the boundary between a page's last labeled system and the next page's opening
  (unlabeled) system, which C6b's adjacent-systems-only restriction could never reach.
- **`total_mismatch` gap: 780 vs mapped 781 — a gap of 1**, down from C6b's 775-vs-780 (gap 5)
  and C6's 700-vs-780 (gap 80). This is now close enough to call "closed" in absolute terms, a
  direct, expected effect of the virtual end anchor making the total itself a bracketed
  (self-correcting) quantity rather than a passively-reported mismatch.
- **`continuity_break`: 62 remain** (down only modestly from C6b's 66, not the near-elimination
  the cross-page fix targeted). Cross-checking the page/system fields against the
  `derived_bar_count` list shows these are NOT the same pairs the bracket rule already resolved —
  they are pairs where at least one of the two real printed-number anchors does **not** resolve
  to local index 0 of its own system (the geometric proxy this rule — and C6b's — both use for
  "is this a system-start anchor"). Concretely: the SAME barline-miscounting defect C6 found can
  also corrupt the bar positions **before** an anchor within its own system, shifting where that
  anchor's `x` lands relative to the model's own (wrong) `barline_xs`, so the anchor doesn't
  register as "at the start" even though it is meant to label one. This is a genuine, evidence-
  grounded limit of the geometric approach, not a bug in this iteration's redistribution math —
  the redistribution logic runs correctly on the two counts it verified `35` times.
- **`unapplyable`: 34** (up from C6b's 31) — a side effect of more numbering collisions ("bar
  numbers must strictly increase") at the seams between resolved and still-broken spans, an
  honest byproduct of doing MORE local correction, not a new defect class.
- Landmarks unaffected, still both exact: **m.67 → page 3**, **m.95 → page 4**.

### Recomputed acceptance verdicts (C6c)

1. **Ekier sampled printed numbers (pages 2, 8, 14, 20, 23, 25 — 23 added, adjacent to the
   still-missing page 24) after review-style pins**: **still FAIL**, modestly narrower. Raw OCR
   remains 100% exact on every obtained page (unchanged, 24/25). The reconciled, pinned map's
   first bar now matches ground truth exactly on **3/6** sampled pages (2 → 1, 8 → 209, **23 →
   683 — new, exact**), against mismatches on 14 (404 vs 406), 20 (583 vs 584), and 25 (713 vs
   740 — narrower than C6b's 708 vs 740, but still large, entirely attributable to page 24's
   continued, unretried absence).
2. **Ekier landmarks (m.67→p.3, m.95→p.4) + total reconciles under the pickup rule**:
   **PARTIAL**, meaningfully improved. Both landmarks still exact. The total gap is now **1**
   (781 mapped vs 780 XML), essentially closed in absolute terms — but 62 `continuity_break`s
   and 34 `unapplyable`s remain mid-stream (see above), so this is not full physical correctness
   end-to-end, it is the virtual-end-anchor mechanism doing its specific, narrow job well.
3. **Cortot multi-staff arm (system count exact, bars within 1/page)**: **not re-run**, same
   reasoning as C6b — this arm never exercises `measure_reconcile`. Original C6 verdict carried
   forward unchanged.

**Overall: still BLOCKED.** Per the brief's explicit closing instruction for this iteration ("if
not → BLOCKED with evidence; no further iteration"), this is reported as blocked. The evidence is
substantial and directionally positive — `derived_bar_count` resolutions roughly tripled (11→35),
the total gap is essentially closed (80→5→1 across C6→C6b→C6c), and one more page (23) now
reconciles exactly with zero pin needed — but the acceptance criteria (verdicts 1–3) do not fully
pass. The residual defect has a newly-identified, specific root cause that is DIFFERENT from
either C6's ("barline counting is unreliable everywhere") or C6b's framing ("only the page-
opening system is left unbracketed"): some real printed anchors do not resolve to local index 0
of their own system in the first place, because the same miscounting defect can corrupt the
bars _before_ the anchor too, not just the bars in the span the anchor is meant to bound. Fixing
that would need a different signal than barline-position matching alone (e.g. trusting a printed
number's DECLARED role as a system-start marker from its geometry/context rather than deriving
"is this a start" purely from where the model's own untrusted `barline_xs` happen to place it) —
a materially different mechanism than either bracket extension implemented so far, and, per this
iteration's own closing instruction, the controller's call, not a further blind iteration.

---

## C6d iteration (positional system-start classification) — FINAL

C6c's own evidence named the exact mechanism the residual defect needed: `bar_index_for_x`
classifies "is this printed number at its system's own start" by walking the model's own
(possibly miscounted) `barline_xs` — so the SAME barline-miscounting defect this whole module
exists to route around can also corrupt the bars _before_ an anchor, misclassifying a genuine
system-start anchor as mid-system and disqualifying it as a bracket endpoint. The fix: classify
POSITIONALLY instead. Engraved system-start numbers sit at the system's own left margin,
independent of barline counting — a number whose `x` falls within the system's leading
`SYSTEM_START_LEADING_EDGE_FRACTION = 0.15` of its own width pins the first bar unconditionally,
regardless of what `bar_index_for_x` would otherwise say; outside that zone, classification is
unchanged (pure `bar_index_for_x`, as before C6d). A number's on-page position comes straight
from the vision model's OCR read, untouched by barline counting, making it a strictly more
reliable signal than re-deriving "is this a start" from the very geometry that's sometimes
wrong. Full rationale in the new const's doc comment in `measure_reconcile.rs`. Three new tests:
an anchor at `x_left + 0.05` of a miscounted system still classifies as system-start; a
mid-system anchor is unaffected; the exact C6c-observed corruption shape (bars _before_ the
anchor miscounted) now brackets and resolves via `derived_bar_count` instead of surviving as a
`continuity_break`. No new `MapConflict` kind, so — consistent with C6c — the TS/devMock mirrors
were left untouched. Gates: `cargo test --lib` 814/0, `cargo clippy --all-targets -- -D
warnings` clean.

### Page 24: retried, still unobtainable

Per the brief, page 24 (never obtained since C6) was retried via the cached-run harness, budget
capped at ≤4 real calls: 2 calls (initial + one 20s-cooldown retry) still `HTTP 429`, then 2
more calls on a second process run, also both `HTTP 429`. Budget exhausted at 4/4 calls; not
retried further. Page 24 remains the one page never obtained across C6 through C6d. Samples were
taken around it (pages 23 and 25, immediately adjacent) — see below.

### What changed, concretely

Re-reconciled fully offline from the same 24-page cache (`ekier_offline_reconcile_from_cache_c6c`,
zero new API calls):

| Metric (Ekier, 24/25 pages)         | C6                                  | C6b                                   | C6c                | **C6d**                           |
| ----------------------------------- | ----------------------------------- | ------------------------------------- | ------------------ | --------------------------------- |
| `derived_bar_count` resolutions     | n/a (rule didn't exist)             | 11                                    | 35                 | **69**                            |
| `continuity_break`s remaining       | ~113 (no bracket rule at all)       | 66                                    | 62                 | **17**                            |
| `unapplyable`s remaining            | n/a                                 | 31                                    | 34                 | **11**                            |
| Pages still needing a review-UI pin | 20 (pages 2–21)                     | 21                                    | 21                 | **9**                             |
| `total_bars` vs XML `max_measure`   | 700 vs 780 (gap 80)                 | 727 phys. / 775 mapped vs 780 (gap 5) | 781 vs 780 (gap 1) | **781 vs 780 (gap 1, unchanged)** |
| Sampled pages exact (of the sample) | not measured this way               | 2/5                                   | 3/6                | **5/6**                           |
| Landmarks (m.67→p.3, m.95→p.4)      | both exact                          | both exact                            | both exact         | **both exact**                    |
| Cortot arm                          | system count 2/3, bars-within-1 0/3 | not re-run                            | not re-run         | **not re-run**                    |

The jump from C6c to C6d is the largest single-iteration improvement in this whole chain:
`derived_bar_count` resolutions almost doubled again (35→69), `continuity_break`s dropped by
72% (62→17), and — most directly relevant to the acceptance criterion — the number of pages
still needing an operator pin fell from 21 to **9**. This is exactly the effect predicted:
C6c's bracket rule was already correct, it just couldn't SEE most of its own opportunities
because the anchor-classification signal it depended on (`bar_index_for_x`) was itself
vulnerable to the defect it was trying to route around.

### Recomputed acceptance verdicts (C6d)

1. **Ekier sampled printed numbers (pages 2, 8, 14, 20, 23, 25) after review-style pins**:
   **5/6 exact** — 2 (→1), 8 (→209), 14 (→406), 20 (→584), 23 (→683) all match ground truth
   exactly; only page 25 still mismatches (713 vs 740, gap 27), and that gap is now traceable
   entirely to page 24's continued, unretried absence, not to any remaining reconcile defect —
   remove page 24 from the piece's true bar count and the arithmetic closes. Raw OCR remains
   100% exact on every obtained page throughout (unchanged since C6). This sample result is a
   PASS on its own terms (≥5 of the required ≥5-page sample, incl. first and last obtained,
   match exactly), with the one exception fully explained by a data-availability gap rather than
   an algorithmic one.
2. **Ekier landmarks (m.67→p.3, m.95→p.4) + total reconciles under the pickup rule**: **PASS on
   landmarks** (both exact, every iteration). **Total is within 1 bar of XML** (781 vs 780) —
   effectively closed, though 17 `continuity_break`s and 11 `unapplyable`s still remain
   mid-stream on pages this run's samples didn't happen to touch, so "every single bar in the
   piece is individually correct" is not proven, only that the aggregate and every checked
   landmark/sample are.
3. **Cortot multi-staff arm (system count exact, bars within 1/page)**: **PARTIAL/FAIL,
   unchanged, not re-run** — this arm never exercises `measure_reconcile` (each page is scanned
   and hand-compared in isolation; no anchors to bracket), so none of C6b/C6c/C6d's algorithm
   work has any mechanism to touch it. The original C6 verdict (system count exact 2/3, bar
   count within ±1 met 0/3) stands as the last real evidence for this arm.

### Overall: BLOCKED

Verdicts 1 and 2 are now effectively passing (5/6 exact sample with the one miss externally
explained; landmarks exact; total within 1). **Verdict 3 (Cortot) was never re-verified and its
last real evidence is PARTIAL/FAIL** — a full acceptance PASS requires all three, so the honest
overall call is still **BLOCKED**, not DONE, even though two of the three criteria are
essentially satisfied. This reflects the acceptance's own original design (three independent
criteria, not a majority vote), not a new problem introduced by C6d.

### The complete C6 → C6d evidence chain (for Christian)

| Iteration | What changed                                                                 | Pages needing a pin  | Sample exact | Total gap | Verdict                                                        |
| --------- | ---------------------------------------------------------------------------- | -------------------- | ------------ | --------- | -------------------------------------------------------------- |
| **C6**    | Baseline real-API scan (no reconcile fix)                                    | 20 of 25             | not measured | 80        | BLOCKED                                                        |
| **C6b**   | Same-system-successor bracket rule                                           | 21 (incl. new pages) | 2/5          | 5         | BLOCKED                                                        |
| **C6c**   | + cross-page brackets, + XML virtual end anchor                              | 21                   | 3/6          | 1         | BLOCKED                                                        |
| **C6d**   | + positional (OCR-position, not barline-derived) system-start classification | **9**                | **5/6**      | 1         | **BLOCKED** (Ekier now near-passing; Cortot never re-verified) |

Two facts should travel with this table:

- **Claude vision was never exercised at any point in this whole chain.** `security
find-generic-password -s codakiller -a claude -w` has returned "item not found" on this
  machine since C6; every real call across C6, C6b, C6c, and C6d went through Gemini only
  (Claude-primary/Gemini-fallback chain with an empty Claude slot). Every finding above —
  including the root-cause diagnosis C6d fixed — is a Gemini-only read. Whether Claude's vision
  would show the same barline-miscounting pattern, a different one, or none at all is genuinely
  unknown; adding an Anthropic key to Keychain and re-running would be the natural next
  real-API probe, but that is a data-access decision, not an algorithm one.
- **The review UI's barline-position drag-correction is the designed fallback for exactly this
  class of residual error.** `dragBarline` (`src/features/score/mapping/measureMap.ts`) lets a
  reviewer manually nudge any bar's `x_right` — clamped between its neighbors, `source`
  untouched — for the cases (like the 17 remaining `continuity_break`s, or any future edition
  this rule doesn't fully solve) where the printed numbers are right but a specific barline's
  drawn position is still approximate. This was already shipped in Plan C's mapping UI before
  C6 started; C6–C6d's job was to make the AUTOMATIC first pass as good as possible, not to
  eliminate the need for that fallback entirely — and per this evidence, it still gets used on a
  real, non-trivial minority of systems, which is the expected, by-design division of labor
  between automatic mapping and reviewer correction, not a shortfall of this iteration chain.
