# B0 mic-coexistence spike — verdict (re-measured 2026-08-23, evidence retained)

> First measurement run (commit 7079008) reported PASS but retained no raw artifacts; a
> fresh-context verification refuted it on evidence grounds. This is the re-run, with every
> artifact retained in this directory. The verdict is unchanged; the numbers below are the
> ones that count.

**Question:** can a `cpal` input stream and the vendored `hear` STT binary (`-d -l en-US`)
read the default mic (`MacBook Air Microphone`) concurrently on the 8 GB M2 Air, both live,
without device-steal or a resource footprint that competes with the realtime audio output
callback?

**Procedure (autonomous):** release-build spike + `hear` + a looping `say` phrase driving
speech through the Mac speakers into the room mic, with `ps`-based 1 Hz CPU/RSS samplers on
both PIDs for 60 s. Artifacts: `b0-spike-stdout.txt` (60 dBFS lines), `b0-hear-transcript.txt`
(157 lines of live transcription), `b0-hear-err.txt` (empty), `b0-spike-cpu.csv` (58 samples),
`b0-hear-cpu.csv` (60 samples).

**Measured:**

| process | avg CPU | max CPU | avg RSS | max RSS |
|---|---|---|---|---|
| cpal spike | 0.03 % | 0.40 % | 14.7 MB | 15.4 MB |
| hear STT | 0.52 % | 2.60 % | 32.4 MB | 36.8 MB |

- Spike dBFS tracked the speech bursts for all 60 lines: quiet floor ≈ −51…−55 dBFS between
  utterances, −27…−9 dBFS during speech, with two brief positive excursions (+0.04, +0.28) —
  Core Audio float input is not hard-clipped at ±1.0, so >0 dBFS at loud moments is expected,
  not an artifact. (First line prints −9.00: the init constant is −9000 millidB, a cosmetic
  bug in the throwaway — the comment says −90.0 floor; ignore t=0.)
- `hear` transcribed continuously for the whole window (the `say` phrase, including
  "96 bpm", appears repeatedly through the final line) — no starvation, no device-steal, no
  permission dialog, empty stderr.

**PASS — coexistence confirmed.** Combined worst-case footprint (≈3 % CPU, ≈52 MB RSS) is
negligible against the realtime audio budget and the 8 GB ceiling. Plan B's live-meter design
(B1 streams input alongside STT) proceeds as scoped; no push-to-measure fallback needed.
