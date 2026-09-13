# CodaKiller v0.5.0 — Version Record

> **Shipped:** 2026-07-12 · **Phase:** P5 · **Commit:** `df5d5fa` · **Tag:** `v0.5.0`
> **Installed:** `/Applications/CodaKiller.app`

## 🧭 Quick nav

[What shipped](#-what-shipped) · [Safety](#-safety-boundary) ·
[Verification](#-verification) · [Honest gaps](#-honest-gaps) · [Next](#-next-steps)

## 🧠 What shipped

- A top-level **Brain** workspace for typed questions and wake-word questions beginning with
  **“Coda …”**. Voice answers return visually and through the existing half-duplex TTS owner.
- Claude native API first when its API key exists, Gemini native API fallback, then a cited local
  offline answer. Claude Code/Claude Max is never treated as an API credential.
- A bundled, validated knowledge graph: **28 practice methods, 13 symptom routes, 10 practice-
  psychology principles, and 18 primary/authoritative sources**.
- Bounded grounding from the selected piece, canonical goals/Regions, recent blocks/reps/session,
  current score location, and deterministic next-work trace. Filesystem paths, vault-wide text,
  credentials, and tools never enter the prompt.
- A visible deterministic **Next work** ranking: unfinished/due goals, resumable open blocks,
  weak Regions, latest-five flawed/failed signals, and spaced revisits. Every item shows its
  reasons; the model may explain the order but cannot change it.
- Conversational intake drafts for current state, deadline, target tempo, and notes. A visible diff
  and explicit Save are required. Draft authorizations expire after 15 minutes, apply once, and
  are bound to the exact answer, piece, and proposed fields.
- Data hardening: canonical Goal deadline inheritance stays aligned without overwriting custom
  per-Goal dates; goal parents remain same-piece/root-only; admin edits cannot fabricate focused
  practice time.

## 🔒 Safety boundary

- The Brain has no tools and no route to verdicts, metronome control, score navigation, scheduling,
  filesystem access, or arbitrary graph mutation.
- Provider citations are allowlisted against retrieved local sources. Uncited or invalid provider
  prose falls back to the grounded offline card.
- Output filters reject verdict/performance claims, piano-hearing claims, score/tempo commands,
  graph mutations, and secret/tool requests, including adversarial paraphrases found in review.
- API keys remain native Keychain/environment inputs and never cross into React, SQLite, prompts,
  errors, or logs.

## ✅ Verification

- Frontend: **30 files / 152 tests passed**; production TypeScript/Vite build passed.
- Rust: **260 unit tests passed**, 4 live/hardware tests ignored; **22 integration tests passed**;
  strict `cargo clippy --all-targets -- -D warnings` passed.
- Real configured Gemini key smoke passed after the final safety hardening, with a non-offline,
  non-empty, cited answer. Neither key nor answer was printed.
- Three fresh adversarial review rounds found and fixed: literal policy bypasses, fake intake IDs,
  cross-piece/field intake writes, stale inherited goal dates, hidden/incomplete planner signals,
  and further semantic paraphrases.
- Installed bundle is ad-hoc sealed with identifier `com.christian.codakiller`; strict signature,
  launch, database integrity, version, and exact-one-app checks passed.

## ⚠️ Honest gaps

- Christian has a Gemini API key configured but no Claude API key; normal online Brain answers use
  Gemini fallback. Claude Max/Claude Code usage is unrelated to native API billing/credentials.
- The Brain can still be wrong. Citations and bounded context constrain it; they do not prove every
  sentence. The output boundary is a conservative semantic heuristic, not formal verification.
- The method graph is curated and broad, not exhaustive. Symptom routing is deterministic keyword
  matching and will need tuning from real questions.
- Wake-word Brain Q&A passed automated and live-provider gates, but the complete Steinway session
  remains the standing human acceptance run.
- Goal calendar/recovery is P5.5; Practice Universe, references, deep settings, icon, and automated
  DMG/install packaging remain P6.

## ⏭️ Next steps

1. Ship P5.5/v0.6.0: nested goals, seven-day work calendar, and explicit non-punitive missed-day
   recovery with zero automatic writes.
2. Backfill reconstructable historical practice events before P6 metrics; otherwise the Universe
   would dishonestly erase old work.
3. Ship P6/v1.0.0: Home + Practice Universe, references, deep settings, final icon/design, and one
   automated sealed app/DMG release path.

## Parent

- [[(C) CodaKiller Command Center]] · [[(C) Roadmap]] · [[(C) Changelog]]
