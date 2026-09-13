---
type: hub
tags: [piano, coach, app, v2, START-HERE]
app_version: "2.0"
doc_updated: 2026-07-06
status: built, in daily use, known rough edges
---

# 🎹 PianoCoach — START HERE (aka CodaKiller)

> **This is the map.** One page that tells you what the app is, what state it's
> *actually* in, and where to read more. If you (or an AI helping in this vault)
> only read one file about the coach, read this one.
>
> 🔭 **[[(C) PianoCoach — v3 Vision & Coaching Spec]]** — where it's going + the behavior contract from your recordings **(read this — the direction changed 2026-07-06)**
> · 📖 **[[(C) Coach App — How It Works]]** — the accurate deep technical reference
> · 🩺 **[[(C) PianoCoach — State & Roadmap]]** — what works, what's broken, what's next
> · 🕰️ **[[(C) PianoCoach — Version History]]** — v1 → v2 → now, and what went wrong
> · 🗄️ [[(C) README — what's in here|v1 archive]]
> · 🎯 **[[(C) v4 — Design, Plan & Build Prompt]]** — **THE ACTIVE DOC (2026-07-08):** the approved v4 reframe design + phased plan + master build prompt
> · 🚀 [[(C) Fable 5 Rebuild Prompt v3]] — the master prompt for the v3 rebuild (historical)
> · 📜 [[(C) Fable 5 Rebuild Prompt]] (the spec v2 was built to — frozen)

---

## ⏱️ 30-second truth box (read this first)

| Question | Real answer (as of 2026-07-06) |
|---|---|
| **What is it?** | A native macOS app that *listens while you play* and coaches you like a teacher on a Zoom lesson. |
| **Where's the app?** | `/Applications/PianoCoach.app` (v2.0). It's a tiny launcher — the real code is `~/piano-coach/`. |
| **What's it built from?** | Python (FastAPI) backend + a local web UI in a native window. ~6,700 lines Python + a JS frontend. |
| **Voice you're using now** | **Gemini Live** (cloud). Only `GEMINI_API_KEY` is set. |
| **Brain you're using now** | **`claude-sonnet-4-6`** via your Claude Code login (no API key). |
| **Is the code backed up?** | ✅ **Now under git** (local `main`, first commit 2026-07-06 — code + docs + practice data; secret & venv excluded). ⚠️ **No remote yet** — add a private GitHub for off-disk backup. |
| **Does it fully work?** | Core loop works. But the "smart" scheduling/progress layer is mostly **dormant in real use**, and the [[v2 issues]] (silence/wrong-measure/too-rigid) are **real and unfixed**. See [[(C) PianoCoach — State & Roadmap]]. |

> ⚠️ **The old docs oversold it.** The previous "How It Works" described the v2
> *spec as-built* — a lot of features are coded but don't actually fire in
> practice (clean-rep gate too strict, sleep-anchoring never triggers). These
> rewritten docs describe **what the code really does**, not what it was meant to.

---

## 🧭 Where everything lives

### 📁 The docs (this folder, `Piano Practice/CodaKiller/`)
| File | What it's for | Type |
|---|---|---|
| **(C) Coach App.md** ← you are here | The hub / map | 🟢 stable |
| [[(C) PianoCoach — v3 Vision & Coaching Spec]] | **Where it's going** + the behavior contract from your recordings | 🔭 direction |
| [[(C) Coach App — How It Works]] | Accurate deep technical reference | 🟢 stable |
| [[(C) PianoCoach — State & Roadmap]] | Strengths, weaknesses, bug root-causes, next steps | 🟡 changes often |
| [[(C) PianoCoach — Version History]] | Timeline + what went wrong at each stage | 🟢 stable |
| [[v2 issues]] | **Your** raw notes on what's still wrong (don't let AI overwrite) | ✍️ yours |
| [[(C) Fable 5 Rebuild Prompt v3]] | **The master prompt for the v3 rebuild** — paste into a Fable 5 session | 🚀 active |
| [[(C) Fable 5 Rebuild Prompt]] | The prompt that built v2 (historical record) | 📜 frozen |
| [[classicalpianodumpknowledge]] | Pedagogy knowledge dump the app parses for named-source advice | 📚 data |
| `Archive v1 (2026-07-03)/` | Frozen v1 docs (the only record of v1 — its code is gone) | 🗄️ archive |

**Also feeding the project (outside this folder):**
- 🎙️ `~/Desktop/piano narration train samples/` — **~3 hrs of you narrating real practice** (4 recordings + session logs). The behavior spec + validation set for v3.
- 🧩 `03 Projects/Cadencify/` — the general-tutor project **PianoCoach is the grounding seed for**. v3's annotated-score + memory = Cadencify's moat.

### 💻 The code (`~/piano-coach/`, OUTSIDE the vault)
`server.py` (the spine) · `app.py` (native launcher) · `coach/` (26 modules — the brain) ·
`web/` (the UI) · `data/` (your history, settings, keys, training corpus) ·
`README.md` / `NOTES.md` / `REBUILD_CHECKLIST.md` (in-repo build notes).
Full file map in [[(C) Coach App — How It Works#-file-map|How It Works → File map]].

---

## ▶️ How to run it

1. **Open `PianoCoach.app`** (in `/Applications`). First mic use asks permission once.
2. Pick a piece (top-left dropdown). Press **Start lesson**. Play — or talk to it.
3. Browser fallback if the native window misbehaves: `~/piano-coach/run.sh` → http://localhost:8765 (use Chrome).
4. Logs: `~/Library/Logs/PianoCoach.log`.

**To get the spoken voice:** ⚙ Settings → pick a provider (Gemini Live is on now) →
paste its key → **Test**. Without a key it still works as **text + chart**, just silent.

---

## 🎹 What it does (one line each)

- **Hears you the whole time** — MIDI-exact if a keyboard is plugged in 🟢, else the mic (ByteDance transcription) 🟡 on dense/loud passages.
- **Speaks one verdict** ~1s after you stop — the method + measure + why, said like a musician.
- **Runs drills hands-free** — silence segments your reps; it counts, resets on a miss, and gates the tempo up.
- **Writes back to your vault** — practice-log rows + `(C) coach-session` notes (only ever touches `(C)` files).

---

## ✅ Which pieces actually work

The app only sees pieces with a **MusicXML** in their `score/` folder.

| Piece | In app? | Why |
|---|---|---|
| Beethoven — Sonata Op.90 mvt 1 | ✅ | has `.musicxml` |
| Chopin — Scherzo No.2 Op.31 | ✅ | has `.musicxml` |
| Griffes — The Lake at Evening | ✅ | has `.xml` |
| Chopin — Étude Op.10 No.4 | ❌ | **PDF only** — drop a MusicXML in `score/` to enable |
| Prokofiev — Sonata No.1 Op.1 | ❌ | **PDF only** — same |

---

## 🚦 What to do next (short version)

1. ✅ **Git is done** (2026-07-06). Next foundation step: add a private GitHub remote for off-disk backup.
2. **Read [[(C) PianoCoach — v3 Vision & Coaching Spec]] first** — the direction changed on 2026-07-06 from "fix v2" to a reframe: the coach should be a **verbal, interactive, lenient rep-tracker**, not a diagnostician. That doc holds the behavior contract pulled from your own recordings.
3. Then [[(C) PianoCoach — State & Roadmap]] for the honest state + the fix list, now reordered around the reframe.
4. The three big real bugs still stand: **silence/noise recognition**, **wrong-measure lock-on**, **too rigid / calls things wrong too fast** — all with code root-causes in the Roadmap.

*Every practice decision still traces to [[(C) Strategy Engine (AI)]] (parsed live) — edit the Engine, the coaching changes.*
