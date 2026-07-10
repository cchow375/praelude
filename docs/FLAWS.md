# CodaKiller — Flaws, Risks & Honest Limits

> The no-faking register. Christian explicitly values honesty here over polish. If
> something is unproven, unbuilt, fragile, or a bet, it is listed below — nothing is
> hidden to make the project look further along than it is.
> **Rule:** never delete a flaw silently. When one is fixed, move it to **§Resolved**
> with the fixing commit. When a new one is found, add it. Refresh after every change.
> **Last updated: 2026-07-10 (v0.1.0).**

Severity legend: 🔴 fundamental / could invalidate the approach · 🟠 serious / limits
real-world use · 🟡 minor / known and bounded · ⚪ hard constraint (not a bug — a fact
of the environment we design around).

---

## A. Product-level (the ones that matter most)

**🔴 A1 — The whole thesis is unproven with the real user at his real piano.**
Everything in v0.1.0 is verified by automated tests and by `say`-through-speakers. But
Christian has **never actually used it at his Steinway.** We literally *cannot* test the
real acoustic path unattended: the MacBook speaker→built-in-mic loopback peaks at −34 dB,
too faint to drive the recognizer. So the product-critical questions are all still open:
- Does his real playing on a loud grand, plus his speaking voice, produce **zero** false
  intents in his actual room? (60 s of a *recording* passed; his real room hasn't.)
- Does his voice get transcribed reliably **over** an acoustic grand at practice volume?
- Does the metronome cut through the piano loudly enough to be useful?
- Is the half-duplex gate's 300 ms margin right for his room's acoustics?
The human at-piano acceptance checklist exists (`docs/qa/p2-acceptance.md`) but is
**PENDING**. Until he runs it, "P0–P2 verified" means "verified by proxy," not "works for
him." This is the single most important open risk.

**🔴 A2 — Most of the actual product is not built.** v0.1.0 is a voice-controlled
metronome. The reason the app exists — the **rep tracker, pieces, intake, sessions, score,
brain, knowledge library** — is P3–P6 and unbuilt. The foundation is excellent; the house
isn't up. Don't let "P0–P2 shipped" read as "the app is done."

**🟠 A3 — The reframe is a bet.** "Track, don't grade" is well-reasoned (it's the distilled
lesson of four PianoCoach versions) but it's still a hypothesis about what Christian
*wants*. He validated it in conversation about the old app; he hasn't lived with the new
one. It's possible he'll miss some form of listening feedback, or that hands-free verbal
tracking has friction we haven't hit yet. First real use is the test.

**🟠 A4 — P3–P6 plans don't exist yet.** Only the P0–P2 execution plan is written. The
roadmap names the phases, but the detailed, task-level plans for the real product (rep
engine, sessions, score, brain) are unwritten. "Next steps" are clear at the phase level,
not yet at the task level.

## B. Technical debt & latent issues (written down, none shipping-blocking)

**🟠 B1 — No runtime TTS fallback.** Provider selection (Gemini vs `say`) happens once at
startup. If Gemini TTS starts failing *mid-session* (network drop, quota, API change),
there is no automatic fallback-after-N-failures to `say`. Deferred to P3; until then a
mid-session TTS outage leaves the coach silent. (`docs/qa/p2-acceptance.md`, `NOTES.md`.)

**🟠 B2 — Mic-permission-denied guidance is generic.** A denied mic/speech permission
currently surfaces as a generic "voice input stopped," not actionable steps. Distinct from
the Dictation-off case (Code 201), which *is* handled. P3 debt.

**🟡 B3 — Progressive-revision metronome artifact.** If `hear` emits a fast non-prefix
revision (`Metronome 90` → `Metronome 96`, 213 ms apart, faster than the 600 ms settle),
the settler finalizes the intermediate `90` first, so the metronome briefly starts at 90
then corrects to 96. Final tempo is correct; the blip is visible/audible. Left as-is
because safely collapsing fast revisions risks merging genuine back-to-back commands.
(`NOTES.md`, Task 13.)

**🟡 B4 — The ASR re-send dedup is a coupling, not an invariant.** `hear` re-sends
identical finals 0.5–2.3 s later; we dedup on a 2.5 s window keyed on transcript time.
This is **only safe because every ack closes the STT gate** — if a command ever acks
*silently* (no TTS), a real fast repeat could be swallowed or a re-send could leak. Must
be revisited whenever a silent-ack command is added. (`NOTES.md`, memory.)

**🟡 B5 — Homophone / ASR-ism folding is heuristic.** "bump it up four" → `Bumped it up
for`; handled by verb-folding + number-slot homophone maps (`for`→4, `to`/`too`→2), gated
on a confirmed command shape. It's a curated list, not a general model — new ASR-isms in
real use will need adding. Over-eager folding is guarded against ("up to 100" must not
become +100) but the guard is rule-based.

**🟡 B6 — `kill -9` can orphan `hear` and strand boost volume.** SIGTERM/close/quit/Drop
all clean up (signal handler kills the `hear` process group; boost volume restores). But
an uncatchable `SIGKILL` skips all of it: a leaked `hear` can hold the mic, and system
volume can stay raised. Documented limitation, same class for both. (`NOTES.md`.)

**🟡 B7 — `say`-fallback test is non-hermetic; Gemini key held as a plain `String`
(not zeroized).** Minor security/robustness notes from review; logged for a later pass.

## C. Infrastructure & process

**🟠 C1 — No off-disk backup.** `git remote` is empty; the repo is **local-only** on
`main`. A disk failure loses the entire project (the exact gap the old app also had for a
while). Fix: `brew install gh && gh auth login`, then
`gh repo create codakiller --private --source=. --push`. Standing to-do.

**🟡 C2 — Single user, single machine.** Only ever run/tested on Christian's 8 GB M2 Air,
macOS 15. No claim holds on other hardware/OS. First-launch TCC prompts (mic + speech) and
the Dictation requirement mean it isn't friend-shareable the way a normal app is.

## D. Hard constraints (⚪ — not bugs; facts we design around)

- **⚪ D1 — 8 GB M2 Air.** No local ML runtimes, ever. `hear` uses the OS's own on-device
  engine precisely because we can't host a model. This constraint shaped the entire
  user-as-sensor design; loading heavy models froze the old app's Mac.
- **⚪ D2 — MacBook mic can't grade an acoustic piano** (35–52% note accuracy, timing σ in
  seconds). This is *why* the app doesn't listen to music — the founding fact, not a bug.
- **⚪ D3 — API TTS needs network.** Offline practice falls back to the system voice
  automatically (quality drop, but never silent — modulo B1's mid-session case).
- **⚪ D4 — Metronome can't exceed hardware max loudness.** Boost mode + limiter-maximized
  samples is the physical ceiling against a loud grand.
- **⚪ D5 — Preview-API rot.** Gemini TTS uses preview endpoints/models; the real response
  shape had to be reverse-engineered against the live API (the docs were wrong). These can
  change without notice — re-verify before touching `tts/`.
- **⚪ D6 — Swift toolchain is broken on this Mac** (no full Xcode; SwiftBridging modulemap
  + SPM link failures). Native SwiftUI is not buildable here — a hard reason the stack is
  Tauri, not native.
- **⚪ D7 — TCC + Dictation prerequisites.** First launch needs one Allow each for
  Microphone and Speech Recognition, and macOS Dictation must be ON (`Code 201` otherwise).

---

## Resolved (kept for the honest record)

- **✅ `-m` flag starved the line reader** (`\r`+ANSI, zero newlines → no transcript ever
  delivered → the voice loop was dead). Root-caused and removed in Task 13; plain pipe
  line-buffers promptly, no `stdbuf` needed. (commit `14d4dd2`.)
- **✅ Engine re-send double-fire** — identical finals re-sent 0.5–2.3 s later fired
  intents twice. Fixed with the unified 2.5 s time-keyed dedup; regression test proven to
  fail under the buggy version. (`14d4dd2`.)
- **✅ Zombie `hear` on raw SIGTERM/SIGINT** — a POSIX kill of the app didn't fire Tauri's
  close/exit events, orphaning the `hear` process group to launchd (holding the mic). Fixed
  with an async-signal-safe termination handler that kills the group then re-raises.
  (Task 13.)
- **✅ `+inf`/negative bpm infinite-loop** in the audio callback — a fresh-context verifier
  found a garbage tempo would stall the real-time loop; bpm now clamped to `[1,1000]` before
  use, regression-tested. (Task 5.)
- **✅ `do_set` Busy-arm state lie** — a refused sound-change left `state.sound` claiming the
  new sound while the engine kept the old; now reverted in that arm, seam-tested. (Task 11.)
- **✅ DMG bundler deletes the `.app`** — the default build's dmg step cleans the `.app`
  output; documented, and we build with `--bundles app` when the `.app` must persist.

## How to use this doc

Add every new flaw the moment it's understood (even mid-task). Give it a severity and,
where possible, a file/`NOTES.md` reference. When you fix one, move it to **Resolved** with
the commit — don't just delete it; the fix history is itself valuable. A flaw with no plan
is still worth listing: honesty first, plan second.
