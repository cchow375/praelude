# Second-Mac native iOS setup — November 13, 2026

Christian asks to recheck GitHub after the missing mobile source is published. This Mac receives
`origin/main` `00cf2b01e9473644ec2e1b92a1027cf3d6bfc1fc`, with 348 iOS files/303 Swift files,
all 18 iOS checkpoint tags, backend contracts/migrations and the previously unavailable `124707d`.
The current native source is 2.0.0/build21/schema5; iPhone/iPad is the primary product.

## Source integration

- Merge the updated `origin/main`, preserving the earlier local setup/priority commits on
  `archive/pre-ios-update-20261113` and in the merge history.
- Resolve documentation conflicts against the newer published mobile handoff, then reconcile it
  into the editable vault before syncing. Prior vault Markdown stays in ignored local logs.
- Preserve upstream finding IDs B116–B118. Renumber the older local source/advisory/contrast setup
  findings to B175–B177; B175 is resolved by `708ef97`/`00cf2b0` publication.
- GitHub visibility is PUBLIC, read back through the GitHub API. No visibility/sharing change here.
- No local application feature edits. Swift source, generator, generated Xcode project and pinned
  dependency files match the published source. No signing configuration or private files copied.

## This Mac's verification

Environment: macOS 26.6.2/arm64, Xcode 26.6 (17F113), iOS Simulator SDK 26.5, installed iOS 26.5 runtime.
Node/Rust from earlier Mac setup are not needed for iOS-only development.

| Check | Result |
| --- | --- |
| `python3 ios/scripts/generate-project.py` | Pass; generated project remains byte-identical to `origin/main` |
| `bash ios/scripts/check.sh` | Pass: 556 core tests executed/1 optional skip/0 failures; 2,340 deterministic service assertions; ordinary unsigned generic simulator BUILD SUCCEEDED |
| `python3 -m unittest discover -s ios/scripts -p 'test_*.py'` | Independent pass: 57 tests/0 failures, fake-device operations only |
| Independent selected native runtime | 2 passed / 0 failed / 0 skipped on a fresh disposable iPad simulator: hosted PDF import/copy/reopen 0.022s, card/Score/Counter/Clean/Undo flow 87.177s; operation 148.548s |
| Root docs/project checks | `docs:sync`, `docs:check`, `project:check` pass; 32 version records/18 lineage documents |
| Personal Mac app data | Original filenames, byte counts and SHA-256 still match the pre-setup snapshot |

Native verification is intentionally serialized after the core/build checks. The source-handoff
record retained an earlier timing-sensitive heartbeat failure under contention; this Mac's serial
core run passes on its first attempt. No private-library optional test or live-account test is
converted into a pass. Existing no-AppIntents metadata warning is non-fatal.

## Limits and next steps

The source-availability blocker is resolved. No physical-device installation, signature renewal,
real-account sync, cloud mutation, private score access or Mac database migration occurs here.
Device records in the received handoff are dated: phone Build21, personal iPad Build20/friend12;
Build21 phone opening/catch-up and iPad active-practice readiness remain separate until freshly
verified. This setup does not close real-account two-device convergence or physical Pencil,
camera, gesture, voice/audio and latency acceptance.

Continue from `ios/Praelude.xcodeproj` or the
focused mobile editor workspace. Preserve real practice libraries and follow the guarded device
procedure for any separately requested installation.

## Independent native runtime evidence

The selected iPad UI test displays the synthetic PDF, switches the same passage to Counter,
records Clean1/5, undoes to0/5 and pauses without fabricating review dates or first-attempt grades.
The hosted test proves original PDF bytes copy into the sandbox and reopen through a relative
filename. The independent verifier inspects actual native screenshot attachments. This is two
selected tests, not an all-green hosted/UI suite or physical-device acceptance. The upstream
Supabase initial-session behavior warning appears without an assertion failure.

Original runtime evidence is `/tmp/praelude-setup-native-smoke-20261113.log`, the matching
`.xcresult`, and `/tmp/praelude-setup-native-smoke-attachments-20261113/`; retained copies are in
ignored `logs/new-mac-2026-11-13/native-smoke/`. The verifier removed only its disposable simulator after evidence collection and verified cleanup. Existing simulators and personal/physical app libraries stay untouched.
