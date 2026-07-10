# P0–P2 Acceptance Record — 2026-07-09

## Verdict
**Code-complete and verified.** All 14 plan tasks done, each gate-reviewed with fix rounds; final whole-branch review (independent, top-tier): **zero Critical, zero Important code defects**. Full gates at HEAD: cargo 105 lib + 12 integration green, clippy clean, npm 36/36, release .app builds with hear + click assets bundled and both usage strings present.

## Automated / controller-run evidence
| Check | Result | Evidence |
|---|---|---|
| Voice loop end-to-end (spoken command → metronome) | PASS | Spoken (via `say` through room speakers) commands drove persisted bpm 96→100→144→100→120; "stop" halted clicking. `docs/qa/task-13-live-verification.md` |
| Ambient robustness (real piano + narration, 60 s) | PASS | Zero intents, zero state changes (Griffes narrated practice recording, volume 65) |
| Self-hearing (gate) | PASS (unit/integration + live TTS) | Gate-order tests (close-before-enqueue, reopen 300 ms post-drain, RAII reopen); live Gemini + say utterances produced zero self-transcripts/actions |
| hear framing root-cause | FIXED + verified | `-m` flag starved the line reader (\r/ANSI, no newlines); dropped; plain pipe line-buffers promptly (`docs/qa/hear-plainpipe-framing.txt`) |
| Engine re-send double-fire | FIXED + verified | Unified 2.5 s t.at-keyed dedup, all intents; regression test proven to FAIL under the buggy implementation |
| Metronome timing | PASS (simulated) | Fractional-sample clock; 10-min non-integer-bpm (137) drift test: bounded, non-growing; change-at-next-beat semantics tested |
| Clean shutdown | PASS | SIGTERM → exit 143, zero zombie `hear` (incl. new async-signal-safe handler); boost restore on stop/close/quit/Drop |
| Keys | PASS | GEMINI key in Keychain (svc `codakiller`), tty-independent write path, no secret in repo/reports |

## Hardware-blocked substitutions (owner sign-off requested)
The MacBook's speaker→built-in-mic loopback is too faint (−34 dB) for unattended acoustic checks, so two plan items carry substitute evidence:
- **Live 10-min drift-vs-reference-timer** → substituted by the committed 10-minute simulated drift test (sample-exact, stricter than an acoustic check).
- **Live gate-window self-transcript log during long TTS** → substituted by gate ordering unit/integration tests + live runs showing zero self-triggered actions.

## Human checklist (Christian, at the piano — ~10 minutes)
1. Launch `/Users/c3/codakiller/src-tauri/target/release/bundle/macos/CodaKiller.app` (or ask Claude to reinstall it to /Applications). Approve the **Microphone** and **Speech Recognition** prompts (one-time).
2. Say: **"metronome ninety six"** → clicks at 96 + spoken "Ninety-six." Confirm its own voice doesn't retrigger anything.
3. Say: **"bump it up four"**, **"accent every 3"**, **"stop"** — verify each actions once, with one short confirmation.
4. Open the metronome popover (top bar): try sounds, gain, **boost** (system volume must rise while running and restore after stop).
5. Play the piano hard for 2–3 minutes with the app listening — the pass bar is **zero** metronome/state changes.
6. Talk to someone / sing near the mic — same pass bar.
7. Optional stress: metronome at your practice tempo for 10+ minutes — clicks must stay glitch-free and steady.
If anything misfires, note the exact words + time; the transcript log (`voice://transcript` toasts) identifies what was heard.

## Deferred to P3 (queued, from final review)
Runtime Gemini→say fallback after N failures; mic-permission-denied → actionable guidance (currently generic "voice input stopped"); minor polish items per ledger.
