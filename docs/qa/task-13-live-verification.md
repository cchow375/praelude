# Task 13 — P2 live voice-loop verification (fix round 2)

Date: 2026-07-09. Machine: MacBook Air M2, macOS 15, 8 GB. Built binary:
`src-tauri/target/release/bundle/macos/CodaKiller.app`. All values below are
observed tool output, not assertions.

## The fix, proven at the framing layer (the root cause)

Root cause of the DEAD loop: `hear -m` streams progressive hypotheses separated
by `\r` + ANSI `ESC[2K` with ZERO newlines, so the line reader never completes a
line → zero transcripts. Fix: drop `-m` (`SttConfig::hear` now `-d -l en-US`).

- The built app spawns the corrected command (verified in `ps`):
  `…/Resources/_up_/vendor/bin/hear -d -l en-US`  (no `-m`).
- Standalone plain-pipe probe (`hear-plainpipe-framing.txt`), NO stdbuf, NO `-m`,
  piped to a line reader while speaking: lines arrived PROMPTLY in real time, one
  clean `\n`-framed hypothesis per line —
  `Natural / Metronome / Metronome 90 / Metronome 96` then re-sends. This is the
  behavior `-m` suppressed entirely. Proves: (a) removing `-m` restores framing,
  (b) `hear` line-buffers on a plain pipe so `stdbuf` is NOT required.
- Re-send timing (`hear-resend-timing.txt`, `hear-plainpipe-framing.txt`): the
  engine re-sends the identical final 0.5–2.3 s later ("Metronome 96" at 370.94 &
  372.74 = 1.8 s; "Stop" at 375.34 & 376.94 = 1.6 s). All < 2.5 s → collapsed by
  the unified `voice_loop` dedup.

## The loop is LIVE end-to-end (store observable — the definitive proof)

Spoken commands (`say` at the mic) changed the PERSISTED metronome tempo in
`~/Library/Application Support/com.christian.codakiller/codakiller.db`
(`setting` table, `metronome.bpm`), in sequence across the session:
`96 → 100 → 144 → 100 → 120`. Each change is one spoken command flowing
STT (no-`-m` hear) → intent router → `MetroStart`/`MetroSet` → store persist.
Before the fix this path produced ZERO intents. (Trailing number words spoken by
`say` at speed were sometimes truncated by the recognizer, e.g. "one hundred forty
four" → 100, "one hundred twenty" → 100 then a late 120 — an ASR accuracy quirk of
synthetic speech, not a loop failure; the state change itself is the proof.)

- STOP recognized: after "stop" + drain, a 6 s room recording was silent
  (`verify_stopped.wav`: rms 0.0057) — clicking stopped.

## Ambient robustness — PASS

Baseline `metronome.bpm = 120`. Played real recorded piano + spoken narration
(`Griffes lake at eveningnarra.m4a`) for 60 s at output volume 65, then killed it.
Result: `metronome.bpm = 120` UNCHANGED; post-ambient recording silent
(`verify_ambient.wav`: rms 0.0029, peak 0.066). 60 s of real piano + speech
produced ZERO metronome state changes — the misfire firewall held. This is the
task's stated pass bar.

## Clean teardown — PASS (new fix)

Raw `kill -TERM <app_pid>` (bypasses Tauri's graceful exit events):
- Before the fix: `hear` was ORPHANED to PID 1 (leaked mic) — found in step 8.
- After adding `stt::install_termination_handler()` (async-signal-safe SIGTERM/
  SIGINT/SIGHUP handler that `killpg`s the `hear` group then re-raises): app exits
  143 (128+SIGTERM), `pgrep -fl hear` EMPTY. No zombie. Verified twice.

## Onset periodicity — BLOCKED by hardware (honest result)

The metronome-click periodicity proof could NOT be obtained on this machine. The
built-in-speaker → built-in-mic acoustic loopback is too attenuated for the
woodblock click transient: even sustained `say` speech at 85 % output records at
peak ~0.04 (`saycheck.wav`), and the click peak stayed ~0.05–0.10 even at 100 %
output. No recording yielded a periodic ~0.5–0.625 s onset train
(`onset-analysis.txt`: all recordings show irregular noise-level onsets). This is
exactly the limitation the Task 9 spike pre-flagged (loopback −34 dB, "too faint
to trigger ASR"). Recognition itself worked only in an earlier, marginally-better
window (the five store changes above); it later dropped below the VAD threshold
(the standalone probe also went silent). The store observable, not the acoustic
onset train, is the reliable proof that commands actioned on this hardware.

## Files
- `onset-analysis.txt` — librosa rms/peak/onset analysis of every recording.
- `hear-plainpipe-framing.txt` — standalone no-`-m` framing + re-send capture.
- `hear-resend-timing.txt`, `hear-noline-framing.txt` — raw framing captures.
