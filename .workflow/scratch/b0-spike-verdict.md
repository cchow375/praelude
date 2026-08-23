# B0 mic-coexistence spike — verdict

Run 2026-08-23, on the 8 GB M2 Air, autonomously (no human speaking into the mic — driven by
looped `say` through the Mac speakers, per the plan's autonomous-adaptation note). Two attempts:
the first failed to launch the spike binary (wrong path — `target/release/...` instead of
`src-tauri/target/release/...`, since `Cargo.toml` lives in `src-tauri/`) and was discarded
before any data was recorded; the second attempt is the one reported below and is a clean,
complete run of the full 60s procedure.

## Procedure actually run

1. Built `cargo build --release --example mic_coexist_spike --manifest-path src-tauri/Cargo.toml`.
2. Started `src-tauri/target/release/examples/mic_coexist_spike` in the background (PID 44740).
3. One second later, started the vendored binary directly:
   `~/codakiller/vendor/bin/hear -d -l en-US` (PID 44746) — flags taken verbatim from
   `SttConfig::hear` at `src-tauri/src/stt/supervisor.rs:94-107` (`["-d", "-l", "en-US"]`).
4. Started a `say` loop reading the plan's sentence continuously into the Mac speakers, to
   drive real audio into the room mic (no human present):
   `while :; do say "the quick brown fox jumps over the lazy dog and practices the piano
every single morning"; done` (PID 44752).
5. Ran `.workflow/scratch/sample-spike-resources.sh` against both the spike PID and the hear
   PID concurrently, sampling %CPU/RSS once per second for 62s each.
6. Waited for both samplers to finish, then killed the `say` loop and the `hear` process (the
   spike exits on its own after 60s).

## Observed numbers

**Spike (`cpal` input stream), PID 44740, 57 samples before it exited on its own at t=60s:**

- CPU: avg 0.01%, max 0.10%
- RSS: avg ~16,978 KB, max 17,008 KB
- Printed 60 `input_dbfs` lines (one per second, full run), values ranging roughly -50.7 to
  +3.1 dBFS, clearly tracking the on/off rhythm of the `say` loop's speech bursts (loud during
  a spoken sentence, quieter dips during the brief silence between `say` invocations) — proves
  the input stream was live and reading real audio for the entire 60s, not stuck at the -90
  dBFS floor.

**`hear` STT, PID 44746, 62 samples (ran ~2s longer than the spike, started 1s earlier and
killed 1s later than the spike's exit):**

- CPU: avg 0.52%, max 1.10%
- RSS: avg ~38,423 KB, max 38,592 KB
- stdout grew continuously for the entire run: 217 output lines total, the transcript growing
  from "The" to a multi-repetition run-on transcription of the spoken sentence, still actively
  appending new partial lines up to the last sample taken before it was killed — proves `hear`
  was never starved of the mic by the spike opening it concurrently.

**No device-steal, no permission dialog, no error text in either process's stdout/stderr.**
Both processes ran the full 60+s concurrently reading the same default input device
(`MacBook Air Microphone`), each producing continuous live output the whole time.

## Verdict

**PASS — coexistence confirmed.** Both `cpal` input and `hear` STT ran concurrently for 60s+
with live, continuous output from both and no device-steal. CPU/RSS for both processes stayed
far below anything that would compete with the realtime audio output callback's budget (spike:
≤0.1% CPU / ~17 MB RSS; hear: ≤1.1% CPU / ~38 MB RSS — combined well under 1% CPU on the M2
Air, negligible against the 8 GB memory budget). Plan B's live-meter design (B1 streams input
alongside STT) proceeds as scoped; no push-to-measure fallback is needed on these numbers.
