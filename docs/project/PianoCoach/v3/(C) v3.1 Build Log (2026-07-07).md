---
type: reference
tags: [piano, coach, app, buildlog, v3.1, changelog]
doc_updated: 2026-07-07
---

# 🧾 PianoCoach v3.1 — Full Build Log (2026-07-07)

> The complete blow-by-blow of the **v3.1 interface pass** — what you asked for,
> every slice, every file, every bug, every check. The high-level story lives in
> [[(C) PianoCoach — Version History#🎚️ v3.1 — the first-real-use pass (2026-07-07)|Version History §v3.1]];
> current state is [[(C) PianoCoach — State & Roadmap]]; how it works now is
> [[(C) Coach App — How It Works]]. This doc is the *record of the session that built it.*

**One line:** after v3 shipped and you used it, the coaching landed but the
interface got in the way. This session reworked the interface around one
principle you stated — *"less time interacting with the interface, more time
playing"* — in **6 slices, ~910 lines across 12 source files, 6 commits**, each
verified live before the next. `validate_v3.py` **48/48** + `selftest.py`
**41/41** stayed green throughout.

---

## 🧭 Quick nav
- [§1 · What you asked for](#asked) · [§2 · The 6 slices](#slices)
- [§3 · Every file changed](#files) · [§4 · Bugs hit & fixed](#bugs)
- [§5 · Gotchas discovered](#gotchas) · [§6 · Validation & QA evidence](#qa)
- [§7 · The commits](#commits) · [§8 · Still open](#open)

---

## <a name="asked"></a>§1 · 🎯 What you asked for → what shipped

| Your words | What it became |
|---|---|
| *"there is no start lesson button so i can't even start it"* | Rail overflowed the 940 px window and pushed the dock off-screen → `main` grid row set to `minmax(0,1fr)` + rail `min-height:0; overflow:hidden`. Button back in view. *(pre-slice fix, commit `cde599f`)* |
| *"it shouldn't lock me to the specific chunk… load the entire score so I can go where it's saying"* | **Slice 1** — whole piece renders once + scrolls freely; the bars-input box is deleted. |
| *"show the real score, not the XML you made… toggleable side by side… model reads the PDF on demand"* | **Slice 2** — score ⇄ PDF toggle, edition picker, coach reads pages on demand. |
| *"individually link every note… type my fingerings easily or tell the model and it writes them and saves"* | **Slice 3** — link + fingering tools. |
| *"the annotation UI is crammed"* | **Slice 3** — clean floating labeled palette. |
| *"'session' → a history thing; 'today' → 'today's session', volatile, a doc I can fix and type; model asks reflections, writes it, keeps history"* | **Slice 4** — Today's Session (editable, live) + History (rolling). |
| *"the model should have full understanding of the whole interface and know exactly what I'm looking at"* | **Slice 5** — `[SCREEN NOW]` awareness. |
| *"the 'press start lesson' font is an AI signature font I do not like"* | **Slice 1** — status text → normal sans. |
| *"less time interacting with the interface, more time playing… when I do interact, make it highly easy"* | The meta-principle behind all 6 slices — voice-first, one-gesture. |

---

## <a name="slices"></a>§2 · 🧱 The 6 slices

### Slice 1 — full scrollable score + font fix `97ead60`
- **`renderScore()`** now draws the WHOLE piece once (`drawUpToMeasureNumber = last measure`), not a chunk locked to a bars box.
- **Killed the bars-input box** entirely. Navigation is now: **click a bar to jump, drag to select a range** (`bindScoreSelect` → `Annotate.measureAt` hit-testing). `setRange` no longer re-renders — it just highlights + scrolls.
- **Font fix:** `#posText` dropped `var(--mono)` → the normal sans face.
- **Verified:** 1550 staff-measures render (~46 k px canvas), scroll-to-measure lands near (m.53) and far (m.500); 0 console errors.

### Slice 2 — score ⇄ PDF toggle `23758b4`
- **`coach/config.py`** — `piece_pdfs()` / `piece_pdf()` (globs `*.pdf`, ranks fingered/ekier/henle/urtext first).
- **`server.py`** — `/pdfs`, `/pdf`, `/pdf-info` (poppler `pdfinfo` page count), `/pdf-page` (poppler `pdftoppm` → PNG). `show_pdf` tool → renders the page + `send_image` to the model so it reads your **real edition** on demand.
- **`web/`** — a **scrollable stack of page images** (not an `<iframe>` — the webview has no PDF plugin), an edition picker, score/PDF segmented toggle.
- **Verified:** 25 pages render; toggle swaps cleanly; coach can be handed a page image.

### Slice 3 — annotation palette + link + fingering `3b27bda`
- **Palette redesign:** the cramped emoji strip → a floating, labeled palette pinned top-right of the score (draw · circle · link · finger · hard · align · erase · clear all).
- **link tool:** tap note A, tap note B → arrow drawn between the real noteheads + the coach is told *"he's linking X in m.A to Y in m.B."*
- **finger tool:** tap a note, press 1–5 → the number is written on the staff (overlay) **and** saved via `memory.add_fingering`.
- **Verified LIVE:** wrote finger 4 on m.32 → coach said *"Got it, finger four on that E five in measure thirty-two"* → persisted to coach-memory as one clean entry.

### Slice 4 — Today's Session + History `29a487d`
- **New `coach/session.py`** owns two real `(C)` vault files per piece:
  - **`(C) today-session.md`** — the concise plan + goal seeded at top (from yesterday's resume point + due spots), a **Log** the coach fills in live (opening-reflection goal, every take, drill, and mark). **User-editable, saves on blur.** Fresh each day; yesterday's rolls into history first.
  - **`(C) practice-history.md`** — every finished day, newest-first.
- **Tabs renamed:** Today → **"Today's Session"**, Session → **"History"**. Killed the manual "log to practice-log.md" form (the session auto-logs now) and the redundant recall card.
- **`server.py`** — `/api/session/today` (GET/PUT) + `/api/session/history` (GET); goal/take/drill/mark handlers append to the doc.
- **Verified:** lifecycle unit test (seed → goal → append → user-edit → **day-roll to history**) passed; browser edit+blur showed *"saved ✓"* and persisted; History renders.

### Slice 5 — the coach knows the whole screen `422db5d`
- **Client** streams `{type:'viewport'}` on scroll (debounced) + on tab/tool/view/selection change: visible measures (hit-tested at the scroll viewport's top & bottom), score-vs-PDF, open panel, tool in hand, selection.
- **`server.on_viewport`** folds it into a silent **`[SCREEN NOW]`** note handed to the live voice via new **`gemini_live.send_context`** (a `turnComplete:false` turn → context, no spoken response). Persona taught a KNOW-HIS-SCREEN rule.
- **Verified END-TO-END:** sent a viewport of mm.33–41, asked *"what measures am I looking at right now?"* → coach: **"You're looking at measures thirty-three to forty-one right now."**

### Slice 6 — QA + validation + docs `d500f61`
- `validate_v3.py` **48/48**, `selftest.py` **41/41**.
- Full browser QA of every feature; native **PianoCoach.app relaunched** and serving the v3.1 interface (v=11) with 0 console errors.
- Docs: Version History §v3.1, State & Roadmap status box, How It Works interface delta, repo NOTES.md + README.md.

---

## <a name="files"></a>§3 · 📁 Every source file changed

| File | Δ | What |
|---|---|---|
| `coach/session.py` | **NEW +148** | Today's Session + History docs (seed / load / save / append / day-roll). |
| `server.py` | **+239** | PDF endpoints + `show_pdf`; session endpoints + goal/take/drill/mark log hooks; `on_viewport` + `_screen_line`; mark handler branches (fingering/connect). |
| `web/app.js` | **+296** | Full-piece render, click-jump/drag-select, PDF picker + image stack, Today's Session editable doc, History render, viewport reporting. |
| `web/annotate.js` | **+112** | `measureAt` hit-test, `select` range band, connect + fingering tools, ink redraw for arrows/fingerings. |
| `web/index.html` | **~61** | Killed bars box; floating palette; PDF toggle; renamed tabs; editable textarea; cache-bust → **v=11**. |
| `web/style.css` | **+48** | Floating palette, PDF image stack, selection band, the editable-doc textarea, the sans font fix. |
| `coach/config.py` | **+27** | `piece_pdfs()` / `piece_pdf()`. |
| `coach/prompts.py` | **+12** | `show_pdf` voice tool + the KNOW-HIS-SCREEN persona rule. |
| `coach/realtime/gemini_live.py` | **+17** | `send_image` (PDF page → model) + `send_context` (silent `[SCREEN NOW]`). |
| `coach/realtime/base.py` | **+10** | `send_image` / `send_context` no-op defaults. |
| `NOTES.md` | **+33** | v3.1 slice log + new gotchas. |
| `README.md` | **~2** | UI row updated. |

*(~910 insertions total. A handful of `data/corpus/*.jsonl` + `data/schedule.json` test-session logs also rode along in the slice commits — harmless training-corpus entries, not code.)*

---

## <a name="bugs"></a>§4 · 🐛 Bugs hit & fixed this session

1. **"No Start lesson button."** The rail rendered 1245 px in a 940 px window; the dock scrolled off-screen. → `main{grid-template-rows:minmax(0,1fr)}` + `#rail{min-height:0;overflow:hidden}`. Verified rail=889 px, button visible.
2. **`Annotate.measureAt` returned null.** `marks.width.baseVal.value` threw on the overlay `<svg>`. → switched to `getBoundingClientRect()` + `getAttribute('width')` scale factors. Clicks map to bars correctly.
3. **PDF `<iframe>` was blank.** Headless Chromium (and the WKWebView) have no PDF viewer plugin. → replaced with a scrollable **`<img>` stack** of poppler-rendered pages.
4. **False re-locate on repetitive material** *(carried from v3)* — a messy-but-correct take jumped to distant similar bars. → the live mid-take jump stays disabled; only the conservative finalize-time re-anchor (≥70% at a disjoint window) runs.
5. **Fingering "double entry" scare.** A live test showed two memory rows → proved to be **stale test data**, not a bug: with clean memory, `add_fingering` writes exactly one well-formed row.

---

## <a name="gotchas"></a>§5 · ⚠️ Gotchas discovered (now in NOTES.md)

- **`python server.py` does NOT start a server** — it's just the ASGI module. `app.py` is the launcher (`uvicorn.run("server:app", …)` via `_free_port` 8765→8766→…). Headless test: `venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8765`. Running the module directly imports + exits — don't mistake that for a crash.
- **The WKWebView / headless Chromium has no PDF plugin** → an `<iframe src=*.pdf>` is blank. Render to PNG (poppler) and show an `<img>` stack.
- **Bump the cache-bust** (`?v=N` in `index.html`) whenever you touch `style.css` / `annotate.js` / `app.js`, or the webview serves the stale cached copy. Currently **v=11**.
- **`send_context` vs `inject`:** `send_context(text)` is a silent context turn (`turnComplete:false`) for ambient state like what's on screen; `inject(…speak=False)` carries the *"COACH EVENT verdict is final"* header — wrong framing for non-verdict context.
- **The Today's Session doc's `date:` frontmatter is load-bearing** — `session._doc_date` reads it to decide the day-roll. Deleting it makes the next load treat the doc as stale (rolls to history + re-seeds) — safe, not data loss.
- *(still true from v3)* **`osascript quit app "PianoCoach"` does NOT kill the Python server child** — a stale server on :8765 serves OLD code. Always `lsof -ti:8765 | xargs kill -9` before trusting a server test.

---

## <a name="qa"></a>§6 · ✅ Validation & QA evidence

- **`test_assets/validate_v3.py` → 48/48** (18 cycles: pause-never-graded, warm-up, re-locate, leniency, under-tempo→slow, negotiated drills, hands-separate, pain+fatigue, sync detection, believe-me, a real 217-note recording segment…).
- **`test_assets/selftest.py` → 41/41** (incl. live-server cycles reaching Yukiko "pulse isn't counted" + Jeanie wrong-clef LH).
- **Browser QA** (headless Chromium via `/browse`), all passing:
  - Interface asserts: `v=11`, no bars input, sans posText font, floating palette, tools `[pen,circle,connect,fingering,hard,align,erase]`, tabs `[Lesson, Today's Session, Progress, History]`, PDF button + todayDoc + history all present.
  - Full score renders (14 k-px canvas) and scrolls; PDF toggle renders 15 page images; toggle-back works.
  - Fingering mark → coach speech + memory persist (live).
  - Today's Session edit → *"saved ✓"* → persisted to vault; History renders; day-roll unit test passed.
  - Screen awareness end-to-end (mm.33–41 answer).
  - All 4 tabs switch; **0 console errors**.
- **Native `PianoCoach.app`** relaunched, its own server up on :8765, serving v=11 with renamed tabs + no bars box.

---

## <a name="commits"></a>§7 · 🗂️ The commits (local `main`)

| Time | Hash | Slice |
|---|---|---|
| 16:33 | `97ead60` | full scrollable score, no more chunk-lock + font fix |
| 16:44 | `23758b4` | PDF toggle + coach reads your real edition on demand |
| 16:50 | `3b27bda` | roomier annotation palette + connect & fingering tools |
| 17:04 | `29a487d` | Today's Session (live, editable) + History (rolling archive) |
| 17:11 | `422db5d` | the coach knows the whole interface |
| 17:18 | `d500f61` | docs + validation pass |

*(preceded by `8f6f5ca` — the approved v3.1 design spec, and `cde599f` — the Start-lesson-button fix.)*

---

## <a name="open"></a>§8 · 🚧 Still open

- **Off-disk git remote (needs you).** The repo is safe on local `main` with a commit per slice, but there's **no remote** and `gh` isn't installed. To back it up off-disk:
  `brew install gh && gh auth login` *(your account)*, then
  `gh repo create piano-coach --private --source=. --push`.
  Until then, losing the disk loses the history.
- **Deferred by design** (the reframe: "deep diagnosis comes later"): fingering-suggestion engine, musical-pattern detector, section-type classifier. Full note-level PDF pixel-mapping — you said "not needed for now."
