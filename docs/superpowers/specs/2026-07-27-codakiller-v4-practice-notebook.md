# CodaKiller v4 — Practice Notebook OS (spec)

Date: 2026-07-27. Source: Christian's goal dump (ledger `.workflow/LEDGER.md`, items 1–33) + his answers:
bugs/perf first → then B/C/D; IMSLP = in-app search with link-paste fallback; **Brain → "Assistant"**,
**Ledger → "History"**. Design law: _frictionless — LESS to read, more to play_; monochrome dark; no
gradients, no outlined buttons, no explainer paragraphs. 8GB M2 Air budget. User-is-sensor firewall
untouched. This spec covers Phases B–D (Phase A bug/perf lanes are already running).

## Phase B — UI overhaul (ledger 22–26, 32–33)

**B1. Terminology purge (25).** New module `src/shell/terms.ts` exporting every user-facing product
noun (`ASSISTANT = "Assistant"`, `HISTORY = "History"`, plus rung/streak/receipt phrasing helpers).
All 32 files with "Brain"/"Ledger" UI strings switch to it. Voice wake word "Coda" and command grammar
unchanged (spoken vocabulary is a How-To-Use-doc surface, not renamed this round). No niche terms
anywhere a musician wouldn't instantly get: audit for "ledger", "brain", "atlas", "rung", "corpus",
"intake" in visible strings → plain words ("History", "Assistant", "score map", "step", "books",
"piece setup"). Rust command names/DB identifiers unchanged (internal).

**B2. Metronome quick controls + icon popover (23, 24).** A compact always-available quick bar
(Score + Today headers): metronome icon (click = full popover), play/stop toggle, live BPM number
that drags/scrolls to change, tap-tempo. Full popover rebuilt: no scrolling at default window size,
icon-labeled controls (beats-per-bar, subdivision, sound, volume) laid out on a fixed grid — every
icon self-evident, monochrome inline SVG (no emoji, no icon font dependency). Space-bar start/stop
stays. Settings side panel gets the same treatment: no misplaced text, no scroll at default size.

**B3. Simpler strategy options (22).** `BlockForm.tsx` collapses to: piece/section, target, one-line
defaults summary, and a single "More" disclosure holding streak N / tempo ladder / focus tag. Plain
words only. Defaults visible as editable text, not form salad.

**B4. Shell scale (32, 33).** Sidebar rail 200px → 148px, quiet icons + short labels; content area
gains the difference. Global text-fitting pass: History rows, piece boxes, candidate cards — rules:
min font size, `line-clamp` with full text on hover/expand, no mid-word truncation, whitespace
breathing room. One shared CSS utility, applied everywhere text currently crams.

**B5. Main menu (26).** Today becomes a real app menu, not a landing page: app mark, the day's date,
a small cycling quote (see D1), and quiet entries — Today's Practice (opens as a window/panel over
the menu), Score, Assistant, History, Universe, Settings. "Today's Practice" panel = the day sheet
(C1) + HUD/receipts. No hero sections, no marketing spacing.

## Phase C — Practice Notebook (ledger 1–15)

**C1. Day sheet.** One notebook page per calendar date. Feels like paper: a single column document,
cursor-first, minimal chrome. Content = typed lines, every one editable as text:

- **Piece line** — one click from a piece picker adds the piece as a heading.
- **Plan item** — checkbox line under a piece: free text (+ optional quick-buttons that insert
  structured text: section/measures chip, "learn:" tag, tempo). These are the day's specifics.
- **Timed block line** — "25 min" chip on any piece/plan line; sheet header totals the day.
- **Lesson notes** — a fold that opens/closes with one click/keystroke; plain text.
- **Lesson prep** — two quick lists: "bring to lesson" (piece picker) and "want from lesson" (text).
- **Goal line** — typing on a plan line + one keystroke (or the ⚑ button) promotes it to a real
  Goal/deadline via existing `goal_*` commands (13) — no separate form trek.
  Blank each morning (11): a new date = a new empty sheet (yesterday remains under its date in
  Calendar). No auto-carry-over — planning is deliberate; a quiet "copy yesterday" affordance exists
  but is never automatic.

**C2. Storage.** New tables (schema v11, migration rehearsed on a DB copy first — protocol):
`day_sheet(id, date UNIQUE, body_json, updated_at)` and `piece_plan(piece_id, body_text, updated_at)`
(the fully-editable long-term "arch" schedule per piece, 10). `body_json` = ordered typed lines
(text | piece | item{checked} | block{minutes} | lesson_notes | lesson_prep | goal_ref); everything
round-trips to visible editable text (9, 12). Replaces the 1200-char localStorage todayPlan (migrate
existing value into today's sheet once). Commands: `day_sheet_get(date)`, `day_sheet_save`,
`piece_plan_get/save`. Debounced saves + save receipts.

**C3. Score "Plan" tab (8).** Clicking a piece line on the day sheet opens the Score workspace on a
new **Plan** tab (alongside Practice/Edit/Marks/Tutorials): that piece's plan items for today as
checkboxes — check off, edit text inline, add items; two-way live sync with the day sheet (same
store). Checking an item is display state on the sheet, never a practice-truth mutation (attempt
history stays the only evidence).

**C4. Assistant passage-helper (15).** Inside the Plan tab and day sheet: "Stuck? Describe the
passage." One small chat card: he types what/where; backend `assistant_suggest` builds context from
the piece's MusicXML (selected region if any) + the book corpus retrieval, returns 2–4 one-line
strategies, each with Accept / No / More. Accept appends a checkbox plan item (that's the explicit
confirm); More expands that one suggestion. Reuses brain provider + corpus; no hot-loop authority;
offline → honest "Assistant offline" state.

**C5. Today overhaul (14, 1–2).** Today's-Practice window = day sheet first; composer/candidates
appear as one quiet "suggested from retention" row that inserts plan items (blocks with minutes) —
the good parts (receipts, HUD, recovery) unchanged underneath. Creating a timed block from a plan
line = one click (1–2).

## Phase D — Content systems (ledger 27–31)

**D1. Quotes (27).** Curate 120–200 verbatim quotes on structure/practice/consistency/focus from the
4-book corpus (each: text, source_id, author, book title, heading/locator). Ship as
`src/content/quotes.json`; machine-check at build/test time that every quote appears verbatim in its
source file (honesty gate). Home shows one per app open in a small neat serif-adjacent line —
rotation cycles deterministically (seeded by open count, no repeats until exhausted).

**D2. Excerpt reader (28).** Clicking the quote opens a Reader window: the book's section around the
quote (from the corpus markdown via its locator), scholarly layout (generous margins, source header:
author, title, section), Esc/× to close. Reader is reusable: Assistant citations may link into it.

**D3. Book library (30).** Corpus registry becomes data-driven: `corpus.rs` hardcoded 4-book spec →
a `books.json` manifest in the knowledge dir + Settings "Books" panel: add a book (pick .md file →
copied in, title/author/kind fields), remove (confirm), kind = practice-method | composer-life |
interpretation. Retrieval + quotes + reader all read the manifest. Non-md sources out of scope this
round (documented honestly).

**D4. Pieces manager + IMSLP (29).** Empirical constraint (verified 2026-07-27,
`.workflow/scratch/imslp-api-notes.md`): IMSLP's MediaWiki API serves search + per-work edition
metadata cleanly, but raw file downloads are CAPTCHA-gated (and robots.txt-disallowed) — the app
must NOT and will not bypass that. Design = **in-app search + browse, browser-assisted download**:
Rust `imslp.rs` client does `list=search` → `action=parse` (edition blocks) → `prop=imageinfo`
(direct URL/size); the pieces manager shows a searchable edition picker; choosing one opens the
file URL in the system browser (user clears IMSLP's one-time bot check; browser downloads
normally), and the app watches for the arriving PDF (Downloads folder match by name/size, or
drag-drop) and files it into vault `Pieces/<piece>/score/`. Paste-URL fallback covers parse
failures; both paths produce identical piece folders. Remove piece = typed-name deletion
confirmation, DB rows + files handled explicitly (files moved to a `.trash/` inside the vault,
never hard-deleted). MusicXML: IMSLP hosts none (verified) — .musicxml/.mxl arrives by drop-in or
pasted URL only, saved alongside (feeds D5/C4). Network failures → honest errors; no silent
retries into the void.

**D5. Score mapping (31).** Wizard upgrade: side-by-side layout — PDF page left, XML measure strip
right, aligned scrolling; clicking an XML measure highlights candidate systems; better interpolation
from existing anchors; import-MusicXML affordance surfaced in piece setup (pulls from piece folder,
prompts via D4 sources). Full auto-OMR stays out of scope (S2 honesty), stated in Flaws.

## Cross-cutting

- Every slice: targeted tests + tsc/clippy clean → fresh-context verifier gate → merge.
- Full suites on the settled tree per phase merge (not per lane — concurrent-cargo gotcha).
- Vault docs protocol at each phase close; version bump v4.0.0 at ship; DB backup + migration
  rehearsal before install; How To Use rewritten to match (terminology rename touches everything).
- Design screenshots for Christian's verdict before calling B/C aesthetics done (his eye decides).
