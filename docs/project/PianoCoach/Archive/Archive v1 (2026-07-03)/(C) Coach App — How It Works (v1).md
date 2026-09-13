---
type: reference
tags: [piano, coach, app, reference]
updated: 2026-07-03
---

# 🎹 PianoCoach — How It Works (Full Reference)

> The complete map of the live-listening practice coach after the 2026-07-03
> rebuild: real-time streaming ears, native app, two brains, the Engine-driven
> rep loop. The short "how do I use it" hub is [[(C) Coach App]]; this is the
> deep reference.

## 🧭 Quick nav
- [What it is (one paragraph)](#what-it-is)
- [The streaming loop](#the-streaming-loop) · [Drill mode (the rep loop)](#drill-mode) · [The voice loop](#the-voice-loop)
- [The two brains](#two-brains) · [The voice/text split](#voice-text-split)
- [What it measures](#what-it-measures) · [Securing vs Polish](#securing-vs-polish)
- [Where everything lives](#where-everything-lives) (files + folders)
- [How it reads & writes your vault](#vault-io)
- [✅ What it does right now](#what-it-does) · [❌ What it does NOT have](#what-it-doesnt)
- [Piece status](#piece-status) · [Run / troubleshoot](#run)

---

## <a name="what-it-is"></a>What it is Right Now
A **native macOS app** (PianoCoach.app — WKWebView shell over a local Python
backend in `~/piano-coach/`). You sit at the piano, press **Listen**, and play.
It analyzes **while you play** — live per-bar chart, score cursor following you —
and **speaks a verdict about a second after you stop**. A Strategy-Engine drill
is matched instantly and one click starts a hands-free **rep loop** with a
metronome and spoken counts. Claude adds the deep "why" in the text pane; a
local LLM handles quick turns for free. Everything logs back into this vault.

Nothing is cloud-hosted except Claude calls (and those are optional — the
instant verdict, drills, rep counting, voice, and charts are all local).

---

## <a name="the-streaming-loop"></a>🔁 The streaming loop (press Listen → verdict)
```
you play →  mic PCM streams over a WebSocket, continuously
         →  DSP layer (spectral-flux onsets + chroma + RMS) runs AS YOU PLAY:
              live tempo, evenness, score position (cursor follows), dynamics
         →  ByteDance transcription chews 6-second segments IN THE BACKGROUND:
              exact per-bar missed/wrong verdicts backfill the chart ~6s behind you
         →  when you trail off, the client warns the server ("closing") and the
              tail is transcribed DURING the auto-stop countdown
         →  you stop → verdict is already computed → the coach SPEAKS it (~1s)
         →  chart finalizes (per-bar table, tempo curve, dynamic arc, climax)
         →  Engine prescription + [Start drill] button
         →  Claude's debrief streams in behind it (voice speaks only its SPOKEN line)
```
Auto-stops after ~2.5s of silence (2 min cap). Alignment is **by pitch**
(Needleman-Wunsch on onset groups), so rubato and pauses don't break it. The
metronome's own clicks are time-stamped by the client and ignored by the listener.

## <a name="drill-mode"></a>🥁 Drill mode — the Engine §5 rep loop, hands-free
Start from a verdict card ([Start drill]) — then just play. Between reps, ~1.5s
of silence is the rep boundary; no buttons.
```
PRESCRIBE → spoken: "dotted, m.494–499, ♩=72, 3 clean in a row. Watch: …"
LISTEN    → you play one rep
VERIFY    → acoustic method-check: are you ACTUALLY doing the method?
             straight rep of a dotted task → "hold the first of each pair
             twice as long" — NOT counted (manner before accuracy)
GRADE     → clean → "clean — two more." · miss → count resets, names the bar
ADAPT     → same bar breaks twice → escalates (Engine fail_debug: smaller cell,
             slower, or a different method) · wandering misses → drops 4 bpm
GATE      → 3 clean → metronome +4, spoken "locked — up to seventy-six."
```
Callouts are **templates spoken instantly — zero tokens, zero LLM latency.**
Method checks that need exact notes land ~2s after each rep (segment-sized
transcription). Drill summary offers to prefill the vault practice-log row.

## <a name="the-voice-loop"></a>🎙 The voice loop (press Voice → hands-free)
Same as before, all local, but faster and no longer verbatim:
```
mic → Silero VAD → whisper.cpp small.en (kept warm, ~6× faster than turbo)
    → coach brain (local or Claude, routed) → SPOKEN line only → Kokoro TTS
```
**Barge-in:** speak or play while the coach talks — its audio cuts instantly.
Number speech follows Engine §6: "measure four ninety-two to four ninety-nine",
"quarter equals seventy-two", "right hand", never "em dot".

## <a name="two-brains"></a>🧠 The two brains (header toggle: Auto / Local / Claude)
| | Who | Cost | Used for |
|---|---|---|---|
| **Reflexes** | templates (no LLM) | zero | instant verdicts, all rep-loop callouts |
| **Quick** | gemma3:1b via Ollama, on-device | zero | short conversational turns, drill lookups |
| **Deep** | Claude (CLI login or API key) | tokens | take debriefs, interpretation, the "why" — anchored to the piece's sourced docs |
**Auto** routes by content: short practical turns → local; "why / interpretation
/ phrasing / debrief" → Claude. No Claude configured → everything falls back local.

## <a name="voice-text-split"></a>🗣 The voice/text split (the contract)
Every coach reply has two channels:
- **SPOKEN** (≤2 sentences) → TTS + a dark highlighted bubble. The one method,
  the measure numbers, the tempo, the why — said like a teacher.
- **DETAIL** (markdown) → the text pane. Everything the voice said PLUS depth.
- **The chart** carries the per-bar numbers — neither channel recites data.
They are never identical. Rep callouts are SPOKEN-only.

---

## <a name="what-it-measures"></a>📊 What it measures (every take)
| Metric | How | Trust |
|---|---|---|
| **Tempo** (♩ bpm) | Theil-Sen robust slope, plus a live estimate while playing | 🟢 |
| **Note accuracy** | matched/missed/wrong/extra per bar, live-backfilled to the chart | 🟢 clusters, 🟡 single notes in fast ff |
| **Timing σ (ms)** | per-onset deviation from a local tempo fit; rushing/dragging per bar | 🟢 |
| **Uneven runs** | CoV of note-to-note gaps in even passagework (+ live estimate) | 🟢 |
| **Chord voicing** | top-note velocity vs inner-note velocity | 🟡 (velocity is relative) |
| **Method manner** | acoustic signatures: dotted ratio, staccato duty-cycle, blocking spread, accent periodicity, chunk stops, HT simultaneity… | 🟢 for the rhythm ones, 🟡 velocity-based |
| **— polish layer —** | legato gaps, melody projection, hand balance | 🟡 |
| **— shape proxies —** | dynamic arc per bar, tempo/rubato curve, climax placement vs the score's loudest marking | 🟡 **evidence, not verdicts** |

> **Velocity is relative** (mic distance) — within-take differences are
> meaningful, absolute numbers aren't. Shape proxies are labeled approximate;
> interpretation questions still resolve to sourced docs (Ohlsson, editions…).

**Gatekeeping:** 3 clean in a row at the mark → +4 bpm. Tracked per range, across days.
**History → trouble zones:** bars that fail repeatedly surface as chronic trouble zones (clickable).

## <a name="securing-vs-polish"></a>🎚 Securing vs Polish (per-piece behavior)
Unchanged in spirit: each piece's `(C) coach-profile.md` sets its **phase** —
**securing** headlines notes/memory/sync/pulse; **polish** headlines voicing,
legato, balance, evenness. The profile carries **sourced tempo targets**; the
coach never invents a metronome number. The Engine prescription is phase-aware
too (polish ranks voicing first).

---

## <a name="where-everything-lives"></a>📁 Where everything lives

### App code — `~/piano-coach/` (OUTSIDE the vault)
| Path | What it does |
|---|---|
| `PianoCoach.app` → /Applications | the native shell (compiled launcher → venv python → `app.py`) |
| `app.py` | starts the server + opens the native window (grants webview mic) |
| `build_app.py` | rebuilds the .app (icon, Info.plist, codesign, install) |
| `run.sh` | browser fallback launcher |
| `server.py` | FastAPI: routes + `/ws/voice` + **`/ws/listen`** (the streaming ear) |
| `coach/engine.py` | **parses the Strategy Engine from the vault** — methods, routing, backbone |
| `coach/stream.py` | the real-time listener: live DSP + incremental transcription + eager tail |
| `coach/methods.py` | acoustic method-checks (Engine §4 signatures + corrections) |
| `coach/reploop.py` | the drill state machine (Engine §5: verify→grade→adapt→gate) |
| `coach/coachtalk.py` | instant template verdicts (the reflexes) |
| `coach/llm.py` | brain routing: Claude (api/cli) + Ollama local + auto picker |
| `coach/prompts.py` | personas, SPOKEN/DETAIL contract, split-stream parser |
| `coach/voice.py` | Silero VAD + whisper small.en + Kokoro TTS + §6 number speech |
| `coach/score.py` | MusicXML → note matrix (KernScores 2-part + generic 2-staff + measure-rest fix) |
| `coach/transcribe.py` | ByteDance model (dynamic segment sizing: short jobs cost less) |
| `coach/align.py` / `analyze.py` / `history.py` / `vault.py` | locate/align · metrics + shape proxies · takes/gates/zones · vault I/O |
| `web/` | UI (vendored OSMD + marked — works offline) |
| `test_assets/` | fluidsynth + soundfont test rig (`make_take.py`, `test_stream.py`, `test_ws.py`) |

### App data — `~/piano-coach/data/`
`history/<piece>.jsonl` (durable take record) · `scores/*.json` (parse cache) ·
`takes/` (still unused — raw audio not retained)

### Shared local models
`~/.piano-lesson-tools/models/ggml-small.en.bin` (voice STT — new) + the old
large-v3-turbo · ByteDance checkpoint in `~/piano_transcription_inference_data/` ·
Kokoro in the HF cache · **Ollama: gemma3:1b** (`ollama pull gemma3:1b`)

---

## <a name="vault-io"></a>🔗 How it reads & writes your vault
**Reads:** `(C) Strategy Engine (AI).md` (**live-parsed — the app's brain**),
`(C) Daily Practice.md`, `(C) Drill Library.md`, and per piece: overview,
score-map, practice-plan, interpretation, coach-profile, practice-log, score/.
**Writes** (only `(C)`-prefixed files): practice-log rows, `(C) coach-session`
notes, Daily Practice checkbox toggles. Never your own notes.

---

## <a name="what-it-does"></a>✅ What it does right now
- **Verified against real lesson audio (2026-07-03):** segments of Christian's actual
  playing from the Jun 12 Yukiko lesson were run through the app and the verdicts
  compared to what Yukiko actually said. On the Scherzo opening the app independently
  reached her exact diagnosis ("the pulse isn't being counted") AND her prescription
  (count subdivisions, first triplet note anchored, others lighter) — plus measured
  evidence she couldn't have (the −4s pause at m.8, chronic-zone history across takes).
  On the Griffes sight-read it caught the left-hand-dominant errors (the wrong-clef
  lesson) acoustically.
- **Grades only what you played:** ranges are trimmed to the bars you actually
  played (density + duration bounded) — no more phantom "missed" bars from a
  too-big auto-locate window or an over-wide manual range.
- **Restart-aware:** stop and start again mid-take (or drill with a clicking
  metronome that defeats auto-stop) and it grades your LAST run — "you stopped
  and restarted — I'm grading the last run."
- **Names the failing hand** when errors concentrate ≥70% in one hand.
- **Severity tiers:** a rough take gets called rough; a destroyed pulse is
  called out as the disease ahead of the note-count (below ~♩=40 it grades
  notes, not pulse — sight-reading isn't "uncounted rhythm").
- **Listens in real time** — live per-bar chart, score cursor following, verdict
  spoken ~1s after you stop (measured 0.13–3.3s on synthetic full-pipeline tests).
- **Native app** with dock icon; browser fallback intact.
- **Hands-free drill loop** with manner-verification, spoken counts, escalation,
  tempo gating, and a built-in metronome the listener ignores.
- **Two brains + reflexes** — most of a session costs zero tokens.
- **Voice/text split** with musician number-speech.
- **Shape evidence** — dynamic arc, tempo curve, climax placement, labeled approximate.
- Auto-locate, rubato-proof alignment, polish analytics, chronic trouble zones,
  clickable measures, vault logging — all carried over.
- **Verified end-to-end** on fluidsynth-rendered synthetic takes (99.1% note
  accuracy, tempo exact, method-checks discriminating correctly).

## <a name="what-it-doesnt"></a>❌ What it does NOT have (yet / by design)
- **No camera / hand biometrics** (stage-2 MediaPipe idea, unbuilt).
- **Audio only — no MIDI-keyboard input.**
- **Raw takes aren't saved** (only analysis rows survive).
- **Transcription still imperfect on very fast/dense ff** through a laptop mic —
  clusters real, single flags 🟡. USB mic helps.
- **Reference-recording comparison** (Ohlsson arc overlay) — future; shape
  proxies currently compare to the score's own markings.
- **Live wrong-note naming mid-passage is coarse** (chroma suspicion flags);
  exact verdicts land with the ~6s transcription backfill.
- **8 GB RAM reality:** models load staggered over ~30s after launch; don't run
  it beside heavy apps. The 3B local model OOMs — 1b is the right size here.
- Single-user, local, one piece at a time.

---

## <a name="piece-status"></a>🎼 Piece status (2026-07-03)
| Piece | Score | Phase | Ready? |
|---|---|---|---|
| Chopin Scherzo No. 2, Op. 31 | ✅ MusicXML | securing | ✅ |
| Beethoven Sonata Op. 90, mvt 1 | ✅ MusicXML | polish | ✅ |
| **Griffes — The Lake at Evening** | ✅ **MusicXML (installed 7/3)** | securing | ✅ **+ coach-profile (LH clef!)** |
| Prokofiev Sonata No. 1, Op. 1 | ⏳ PDFs only | polish | needs the 2-min MusicXML download |
| Étude 10/4 · Rorem | no score yet | — | add a MusicXML |

---

## <a name="run"></a>▶️ Run / troubleshoot
- **Start:** open **PianoCoach.app**. Logs: `~/Library/Logs/PianoCoach.log`.
  Browser fallback: `~/piano-coach/run.sh` → http://localhost:8765 (Chrome).
- **Rebuild the app** after code changes to `app.py`/icon/plist:
  `cd ~/piano-coach && venv/bin/python build_app.py` (server/web changes need no rebuild — just relaunch).
- **Mic silent in the native window?** macOS Settings → Privacy → Microphone →
  PianoCoach ON, then relaunch. Worst case use run.sh + Chrome.
- **No local brain?** `ollama serve` + `ollama pull gemma3:1b` (the app
  auto-starts ollama if installed). No Claude? It still coaches locally.
- **Sluggish right after launch** = models still loading (staggered ~30s).
- **New piece:** drop a MusicXML in its `score/` → ↻. Add a `(C) coach-profile.md`.
- **Engine edits apply live** — save the vault file, next take uses it.
- **Pain rule still applies:** anything hurts → the coach stops you. Listen to it.
