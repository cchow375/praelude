# CodaKiller v1.3.0 — Compact Workspace + Contextual Practice Brain

**Date:** 2026-07-13  
**Status:** Shipped as v1.3.0 after fresh adversarial SHIP and native release gates.  
**Builds on:** the P0–P6 architecture and v1.2.0 actionable score workflow.

## Problem

The installed app wastes working area at exactly the moment the pianist needs the score. The native
window cannot shrink below 980 px, an active Rep panel reserves 390–430 px even when it is moved or
collapsed, and the score reserves another fixed 400 px for sections. The existing Brain is also a
separate full workspace, forgets prior turns at the provider boundary, retrieves only 38 small
curated cards, and never reads Christian's three-book knowledge library or the selected MusicXML.

## Product decisions

- **Compact by default, adjustable by Christian.** A typed 75–125% interface-scale setting uses
  native WebView zoom so rem and hard-coded pixel controls scale together. The default is 90%.
- **Every major practice surface can get out of the way.** Rep and Session retain their persisted
  collapse controls; the score section rail gets an edge chevron and responsive overlay behavior;
  the Brain becomes a persistent right drawer that collapses to the side instead of a top-level
  workspace. Floating panels no longer reserve a permanent blank gutter.
- **One Brain, not a second score chatbot.** The same `BrainWorkspace` renderer serves the global
  drawer, wake-word questions, and score context. Closing the drawer hides rather than unmounts it,
  so the current conversation survives while the app stays open.
- **Relevant complete context, not a database dump.** A turn may include the selected piece and
  Region (including its human note), selected measures, bounded MusicXML facts, current open block,
  recent self-reported reps/notes, goals, current session, and deterministic Next work. It excludes
  unrelated pieces, filesystem paths, API keys, settings, raw PDFs, and arbitrary tools.
- **The model advises; it never acts.** It may explain a likely mechanism and propose an editable
  tempo/repetition experiment. It cannot hear piano, assign a new verdict, start/retune the
  metronome, navigate, schedule, mutate the graph, or claim that it did any of those things.

## Local knowledge retrieval

The external folder `Piano Practice/Knowledge and Resources/` remains the source. CodaKiller reads
only the three known Markdown books:

1. Penelope Roskell, *The Complete Pianist* — piano-specific technique/health/artistry.
2. Molly Gebrian, *Learn Faster, Perform Better* — learning, error correction, memory, spacing,
   rhythm, and speed.
3. Nancy O'Neill Breth, *The Piano Student's Guide to Effective Practicing* — concrete drill menu.

The PDFs remain external references for layout/illustrations and are never indexed or bundled. A
bounded native loader cleans EPUB/HTML conversion markup, chunks by heading/paragraph, keeps source
and section locators, marks chunks that depend on missing images, and builds a cached deterministic
lexical index. Retrieval combines term weighting, reviewed synonym expansion, source priors, and
source diversity; it sends only the best few passages to the provider. The existing validated
28-method graph remains the safety/router/offline fallback.

Book text is untrusted evidence, never prompt instructions. Provider citation IDs are joined back
to the exact retrieved allowlist. Unknown IDs are discarded. The app does not copy the books into
the repo, `.app`, DMG, or practice database. Settings visibly disclose whether bounded retrieved
passages may leave the Mac for Claude/Gemini.

## MusicXML boundary

- Resolve the XML path only from the selected database Piece, canonicalize it under that Piece's
  folder, reject symlinks/escape/non-files/oversize input, and never resolve DTDs or entities.
- Accept `.musicxml`; compressed `.mxl` may report an explicit unsupported status unless a bounded
  archive reader ships. Plain `.xml` is discovered only after a bounded root-element sniff proves
  it is `score-partwise` or `score-timewise`.
- Extract notated facts only: printed measure, pitch/rest/chord, duration/type/dots, voice/staff,
  ties, dynamics/text, time/key, and notated tempo. Cap measures/events/bytes.
- Never infer fingering, hand assignment, tension, correctness, printed PDF geometry, or an
  authoritative technical diagnosis. The UI states when XML is missing, truncated, suspicious, or
  may differ from the selected PDF edition.

## Conversation and privacy

Each request carries a strict bounded window of prior user/assistant turns. Follow-ups such as
“that did not work” therefore have the same practice context and can produce a cited alternative.
The thread is intentionally process/UI-session state in v1.3.0 unless a separately reviewed schema
migration ships; losing it at relaunch is preferable to silently persisting sensitive prose.

Typed questions stay silent. Voice questions reuse the existing gated TTS owner. Network work stays
on Tauri's blocking pool and remains outside the deterministic rep/metronome command loop.

## Release gates

- Golden retrieval queries: reinforced wrong version, ineffective slow repetition, speed plateau,
  leap, rhythm, voicing, and pain/stop rule.
- Synthetic and real MusicXML tests: two parts, chords/rests/voices/dynamics, range cap, DTD safety,
  path escape, Scherzo, Beethoven, and verified Griffes `.xml` discovery.
- Provider fake transports: conversation included, secrets/paths absent, invented citations
  dropped, Claude→Gemini→offline fallback preserved, useful tempo advice allowed, hearing/verdict/
  app-action claims still rejected.
- Frontend: drawer remains mounted, exact Region context crosses IPC, section/Brain chevrons work,
  75/90/100/125% zoom, narrow native window, keyboard focus, and no permanent Rep gutter.
- Native: real Scherzo Region question cites a local book section and reports MusicXML grounding;
  a follow-up disagreement keeps context; no app state changes without Christian's explicit action.

## Next steps

1. Christian runs the contextual Brain beside a real Scherzo section at the Steinway and checks the
   grounding receipt before acting on advice.
2. Tune retrieval/drawer/scale only from observed friction.
3. Keep the three-book/MusicXML boundaries explicit; do not infer performance from notation.
