# CodaKiller P5 — Grounded Brain + Practice Library

> **Status:** active · **Target:** v0.5.0 · **Branch:** `p5-brain`
> **Goal:** answer practice questions from the selected piece, real history, and a cited method
> graph—without putting an LLM in verdicts, navigation, or scheduling authority.

## Quick nav

[Decisions](#locked-decisions) · [Checklist](#execution-checklist) ·
[Contracts](#runtime-contracts) · [Security](#security-invariants) · [Next](#next-action)

## Locked decisions

| Question | Decision |
|---|---|
| Hot loop | Deterministic forever. Brain cannot emit rep verdicts, BPM commands, or score navigation. |
| Providers | Anthropic native API when an API key exists; Gemini native API fallback; no Claude Code subscription/CLI dependency. |
| Offline | Retrieval still returns cited local method cards; it says provider unavailable instead of inventing prose. |
| Grounding | Selected piece metadata + bounded canonical history + retrieved library methods only. Human/vault text is quoted as untrusted context. |
| Knowledge | Stable symptom → method → dose → watch-for → source graph; old PianoCoach content is mined for lessons, never code/UI copied. |
| Planning | Deterministic ranking owns the work list. The brain may explain it but cannot secretly reschedule it. |
| Intake | Conversational review proposes a visible diff; Christian explicitly saves each accepted change. Never overwrite personal writing. |
| Voice | Wake-word questions open the Brain and answer asynchronously. Spoken playback must reuse the half-duplex TTS gate before P5 ships. |

## Execution checklist

- [ ] **P5.1 — Provider + answer contract.** Typed/voice request, structured answer/citations/
  method cards/provider state; Anthropic-first/Gemini fallback; fake transports and no-secret logs.
- [ ] **P5.2 — Cited method graph.** Port and rewrite the useful Drill Library/Strategy Engine
  methods; add primary-source psychology methods; validate ids, symptoms, dose, cautions, sources.
- [ ] **P5.3 — Deterministic retrieval.** Normalize symptoms, score/rank method matches, cap context,
  and return an honest offline answer from retrieved cards.
- [ ] **P5.4 — Context builder.** Selected piece, Regions, goals, recent blocks/reps/notes, and
  current score location; strict byte/item budgets; no whole-vault or secret access.
- [ ] **P5.5 — Prompt-injection boundary.** System policy cannot be displaced by piece titles,
  notes, method text, or provider output; output allowlist rejects verdict/action instructions.
- [ ] **P5.6 — Brain workspace.** Compact typed Q&A, provider/offline/error state, citations,
  method cards, history, keyboard/accessibility, dark/light visual gate.
- [ ] **P5.7 — Voice Q&A.** `Intent::Question` opens/sends once, network runs off the command loop,
  final answer returns to UI and TTS through the existing half-duplex gate.
- [ ] **P5.8 — Conversational intake review.** Brain proposes field-level changes; visible review
  and explicit Apply; canonical Goal rows stay aligned with legacy intake summary.
- [ ] **P5.9 — Deterministic next-work preview.** Rank overdue goals, open blocks, weak/recently
  missed Regions, and spaced revisits with an explanation trace; brain narrates only.
- [ ] **P5.10 — Data-integrity gate.** Goal parent same-piece/no-cycle validation; intake→Goal
  synchronization; practice metrics ignore admin-only events; historical graph limitations stated.
- [ ] **P5.11 — Whole-diff + live gate.** Injection/adversarial tests, provider failure/fallback,
  offline retrieval, voice nonblocking, full suites/build, real key smoke without logging output.
- [ ] **P5.12 — Ship v0.5.0.** Install one sealed app, migrate real DB, docs/tutorial/flaws/
  version record, tag, fast-forward `main`.

## Runtime contracts

```text
brain_ask({ request: { question, source: "typed" | "voice", piece_id? } })
  -> { id, answer, provider, citations[], methods[], intake_review? }

brain_intake_apply({ request: { answer_id, piece_id, changes[] } })
  -> { piece_id, saved_at }
```

Every citation has a stable source id/title/locator. Every method card exposes when to use it,
the exact dose, and what failure/overuse to watch for. “Offline” is a provider state, not a license
to fabricate.

## Security invariants

- No API key in arguments, events, logs, errors, SQLite, provider prompts, or frontend state.
- No provider can request tools, filesystem reads, commands, or network destinations.
- User/vault text is data inside explicit delimiters, never instructions.
- Output cannot mark a rep clean/failed, modify data, start/stop tempo, or claim to hear playing.
- Intake/planner changes require a separate typed command with validated ids and explicit UI action.

## Next action

Land the provider, knowledge, and frontend seams independently; then integrate retrieval/context,
voice-gated playback, deterministic planner preview, and the real-key/offline adversarial gate.
