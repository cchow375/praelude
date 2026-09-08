# Praelude v10.0.5 — practice bar

Status: v10.0.5 shipped and installed. Full source/browser/release/data gates pass. Native Score visual acceptance awaits renewed Desktop-folder permission.

Requested: shrink passage identity, show Start set / Goal (practice focus) / Metronome / starting and target tempo / Variants / Settings, and eliminate overlap in ordinary windows. No schema change.

The existing set state and Rust submission contract remain authoritative. Total plays keeps its fixed-tempo semantics; non-tempo goals can opt into a metronome. Passage tools remains reachable in the identity. Responsive width is measured from the Score workspace; no CSS containment changes fixed-dialog positioning.

Focused frontend: 116 tests passed. Full frontend: 205 files / 2,543 passed, one file/test skipped. TypeScript and production build pass. Native: 1,083 passed / 17 ignored, plus integration and narrated-corpus suites. Fresh-context review caught active-notice grid placement and fixed-dialog containment risks; both corrected before release.

Independent rendered review: SHIP for scoped UI. Passed 720×520, 1000×700, 1280×720, 1440×900 and 2048×390, plus 739/741 and 999/1001 workspace-width edges. Settings and Variants fit at minimum size. Goal Notes disables the click/hides tempo; re-enabling the metronome and returning to Tempo work. A mock 40→60 set submitted correctly, active notices remain below all controls, and a synthetic long identity truncates without covering measures/tools/close. Evidence: `verify-*.png`. Mock interactions never touched live practice data.

Gate environment findings: a cached Tauri permission path retained the pre-rename `/Users/c3/codakiller` root; `cargo clean -p tauri` regenerated debug artifacts; the production build exposed the separate stale release cache and `cargo clean --release -p tauri` regenerated that too. The sandboxed system `say` test returned no audio, causing one failed native run (1,082 passed). Rerunning native gates with macOS access passed all 1,083 tests including that test; it was not disabled or skipped.

Release gates: all eight canonical gates pass. The script was split without changing its gate bodies so tests/build ran before installation approval; failed environment-dependent stages alone were rerun. Rust format and strict Clippy pass. Implementation `58b0413`; installed plist v10.0.5. DMG 10,594,194 bytes, SHA-256 `06e979cd7d390e6373bb8358f8a4099d58f32c75d3fb5b6e7444d7d64ee766f5`, ad-hoc CDHash `1d668dc99c9ea554e3454f133393915e268fe3dc`.

Exact pre/post-install and post-launch database file and logical hashes match; see `data-preservation.json`. No real practice was created. Fresh installed launch and Today→Score navigation succeed, but `score::discover` waits in filesystem `read_dir`; TCC logs at 2026-09-07 21:55:50 identify `AUTHREQ_PROMPTING` for `kTCCServiceSystemPolicyDesktopFolder`. The app also requested Speech Recognition. The computer-use tool explicitly refuses the OS permission app, so the agent cannot accept the Desktop prompt. Native bar screenshots are therefore **not** claimed.

Next steps: Christian accepts the renewed Desktop-folder permission; finish real-score/native bar visual verification and real-use verdict. Windows and microphone/Steinway acceptance remain separate.
