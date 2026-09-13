# CodaKiller v5.0.0 — Version Record

**Shipped:** 2026-07-31 (tag commit `3de140c`, 15:04 EDT)
**Tag:** `v5.0.0`
**Installed:** `/Applications/CodaKiller.app` (superseded by v6.0.0 on 2026-08-18)
**Rollback preserved:** `~/Library/CodaKiller-rollbacks/CodaKiller-v5.0.0-rollback.app.tar.gz`
**Database schema:** 11 → 13 (day-sheet/plan schema, then the pencil-marks table)

> **Written late — 2026-08-20, during a documentation-accuracy audit.** This record did not
> exist when v5.0.0 shipped; the release was covered in [[(C) Changelog]] and [[(C) Roadmap]]
> but never got its own `versions/` note, which the update protocol requires for every
> minor/major release. It is reconstructed here from the Changelog entry, the git history, and
> the actual on-disk install artifacts, all of which were re-verified rather than copied. Where
> a fact could not be verified from an artifact, it says so.
>
> The audit also corrected this release's **ship date**: several documents said 2026-07-30. The
> tag is dated **2026-07-31** and that is what this record uses. (2026-07-30 is when v4.0.0 and
> v4.0.1 shipped, and when Christian's feedback that drove v5 was given.)

## What this release is

v5.0.0 is the release that admitted v4's performance work was wrong and fixed the real problem.
It was driven directly by Christian's hands-on feedback on 2026-07-30, quoted verbatim and in
full in [[(C) Changelog]] — the app was _laggier_ after the release that was meant to make it
faster, the UI read as a form rather than a notebook, IMSLP search was dead from the UI, the two
Tanglewood chamber pieces were fused into one, the quotes made no point, and there was no way to
draw on the score.

Offered a choice on three of the fixes, Christian picked: **full paper aesthetic** (not a partial
retheme), **Universe as a static view** (drop the physics simulation entirely), and **freehand
pencil only** (he explicitly declined highlighter, sticky notes, and a per-stroke eraser).

## What shipped

- **The real performance fix — colour-depth-aware image decoding** (`da366dc`, `771e7d3`). v4's
  theory that bytes and megapixels predict lag was wrong, and acting on it made the app slower.
  The actual driver is **pixel colour depth**. A new Rust path (`score/scanned_page.rs`,
  `score/page_image.rs`) recognizes a page that is one scanned image stretched over the page box
  and decodes it straight to screen resolution, with PDF.js kept as the fallback
  (`src/features/score/pageImage.ts`). Result: **87 ms cold / 15 ms warm**, peak RSS 374 → 159 MB.
  The full measurement table and the corrected model are in `~/codakiller/NOTES.md`.
- **Paper design system, shell-wide** (`da366dc`, `771e7d3`). The whole app reverses direction
  from the v3/v4 monochrome-dark theme to a warm paper aesthetic — Today, Score, Universe and the
  shell rail all repainted. All 85 legacy token names were preserved deliberately: deleting one
  renders a surface transparent, a trap the project has hit twice.
- **Today rebuilt as a notebook, not a form** (`771e7d3`, hardened by `ccd35f8`). The day-sheet
  editor reads as an actual notebook page — ruled lines, margin rule, serif date. `ccd35f8` also
  fixed Today's Practice rendering as a modal that dimmed the whole app; it is a page
  (`role="region"`, not `dialog`).
- **Universe made static** (`771e7d3`). The d3-force physics simulation is gone, replaced by a
  deterministic composer-grouped repertoire index. Christian's objection was that it read "like a
  computer game."
- **Freehand pencil on the score — new feature** (`35c9572`, schema v13). Pencil toggle in the
  Score toolbar, Undo (Cmd/Ctrl+Z), Clear-page with confirm, Escape to put the pencil down. Marks
  are stored in normalized 0–1 page coordinates per piece + edition + page and tied to the file's
  fingerprint: a re-scanned score's old marks stop matching but are **never deleted** — they
  reappear if the original file returns. Measured drift ≤0.0006 across a 2.85× page-box range;
  p50 latency 16.7 ms, one frame.
- **IMSLP UI fix** (`da366dc`). In-app IMSLP search works from the UI again, and the request
  pattern went from 14 requests / ≥13 s to 1 request / 775 ms. The API had always been healthy —
  the failure was UI dead air.
- **Quotes curated** (`da366dc`). v4's 182-quote set replaced by **134 verbatim, verified quotes
  from 4 pedagogues**, theme-weighted with an honest connector line.
- **Chamber-piece split: Barber / Copland** (`da366dc`, schema v12). "Chamber Pieces Tanglewood"
  split into its two real pieces — **Barber, Pas de Deux** (piece 6, no history, keeps calibration
  1. and **Copland, Cowboys with Lassos (Billy the Kid)** (piece 7, which owns all 5 regions,
     2 blocks, 14 reps and 135 events). Before the split the Barber — which Christian had never
     practised — displayed focused time and a streak that belonged to the Copland.

## Verification

Gates at ship, as recorded in [[(C) Changelog]]:

- `tsc` clean
- vitest **1,643 passed / 1 skipped** (up from 1,270 at v4.0.0)
- cargo **668 passed / 14 ignored** (up from 580)
- `cargo clippy --all-targets -- -D warnings` clean

Install artifacts, **re-verified on disk 2026-08-20** (these are the numbers this record is
confident about, because they were measured, not copied):

- Pre-install backup: `(C) pre-v5.0.0-install-2026-07-31-144859.db`, SHA-256
  `271c2fdae7b2245ed328c5d75050068bbcf1160a36a3cb7d11575f3bc95a29a1` — present in
  `~/Library/Application Support/com.christian.codakiller/backups/`.
- That backup's own contents: `user_version` **11**, **6 pieces / 98 rep_blocks / 803 reps /
  21 sessions** — i.e. the pre-migration, pre-chamber-split state, exactly as expected. (After
  install the live DB was schema 13 with **7** pieces, the split having created the seventh.)
- An earlier same-round backup also survives: `(C) pre-v5.0.0-session-2026-07-30-204238.db`.
- Rollback app archived at `~/Library/CodaKiller-rollbacks/CodaKiller-v5.0.0-rollback.app.tar.gz`.
  It is stored as a **tarball, not an unpacked `.app`**, because Spotlight indexes `~/Library`
  and a second unpacked bundle there fails the project's one-copy rule.
- 7 commits between `v4.0.1` and `v5.0.0`; merge commit `3de140c`.

**Not verified, and not claimed:** no at-piano or design acceptance of v5.0.0 was ever recorded.
See below.

## Honest gaps

Nine known-open gaps went out with this release, tracked as [[(C) Flaws]] **B47–B55**:

1. The image fast path had never had a real browser QA run — every QA pass went through the PDF
   fallback, because the dev mock returns empty for `score_page_image` (B47).
2. `stale_marks` notices only surface while pencil mode is on, so someone who never picks up the
   pencil never learns their marks were hidden (B48).
3. A rare chamber-split migration residual: a collision that forces the migration to decline still
   stamps `user_version` 12 and never retries, silently (B49). Cannot fire on Christian's data.
4. The fast-path refusal costs ~8 ms/page, uncached in Rust — the vector edition re-parses on
   every page turn (B50).
5. The Map-this-score wizard's page pane still renders through PDF.js, deliberately (B51).
6. `.anomalies-badge-warning` measures 4.47:1 at 11 px — below AA, pre-existing (B52).
7. Today's screen still duplicates the shell nav rail (B53).
8. Off-disk backup absent — the repo is local-only (B54).
9. **Christian's at-piano and design acceptance of the whole v5 UI direction was owed and never
   given** (B55).

**Operating gotcha, recorded because it bit:** `scripts/split-tanglewood-folders.sh --apply
--hide-original` must be run **BEFORE** installing. The script's own header says the opposite;
installing first leaves a phantom piece. The v12 guard reads DB fields only, never the disk.

## Next steps

These were the next steps _from this release_. Recording what actually became of them:

1. **At-piano + design acceptance of v5 (B55)** — **never happened.** v6.0.0 shipped over it on
   2026-08-18. The same item is now open against v6.0.0, and no release of this app has ever had
   a recorded at-piano verdict.
2. **A real at-piano check of the image fast path (B47)** — still not done; B47 remains open.
3. **Off-disk private git remote** — **still not done** as of 2026-08-20. It is now the oldest
   unfixed risk in the project (B54/C1).
4. **Goals/Calendar/session voice capability registry** — carried forward; still not built.
5. **History-at-scale reflow** — substantially addressed by v6.0.0 Plan B's day-timeline read
   models, though B64's 400-day reach ceiling was introduced there.

Successor release: **v6.0.0 "Practice Core"**, shipped 2026-08-18 — see
`(C) v6.0.0 — Version Record`.
