//! Speech-to-text supervision: spawn and babysit the `hear` CLI.
//!
//! [`SttSupervisor::spawn`] launches the vendored `hear` binary as a child
//! process, streams its stdout lines into [`Transcript`]s, and hands them to a
//! caller-supplied sink. The supervisor owns the full child lifecycle:
//!
//! * **Half-duplex gate** — [`SttHandle::set_gate`] toggles an atomic flag the
//!   reader thread checks on every line. When closed, lines are *dropped at the
//!   supervisor* (not buffered, not delivered late) so the app never "hears"
//!   its own TTS while speaking. Task 11 depends on this exact semantic.
//! * **Auto-restart** — if `hear` dies, it is respawned after a backoff. A
//!   restart storm (more than `max_restarts` within `restart_window`) trips a
//!   [`SttEvent::Down`]`(`[`DownReason::RestartStorm`]`)` and stops, rather than
//!   hot-looping forever.
//! * **Config-error detection** — `hear` fails instantly with
//!   `kLSRErrorDomain Code=201` when macOS Dictation is disabled (Task 9 spike).
//!   That is a setup problem no restart can fix, so it maps to
//!   [`DownReason::DictationDisabled`] and the supervisor stops immediately.
//! * **Clean teardown** — `hear` *ignores SIGINT* but exits cleanly on SIGTERM
//!   (Task 9 spike). [`SttHandle::shutdown`] SIGTERMs the child's whole process
//!   group and reaps it (via [`std::process::Child::wait`]) so no zombie is
//!   left behind. `shutdown` is idempotent and also runs on `Drop` as a
//!   backstop.
//!
//! ## Transcript framing policy (is_final)
//!
//! Mic-mode partial-vs-final framing from `hear` is UNVERIFIED (Task 9 could not
//! drive live speech); Task 13 confirms it. So the supervisor parses defensively
//! with a policy that is correct for *both* plausible framings and always
//! guarantees a final eventually fires (Task 13 routes only finals):
//!
//! * Every non-empty line is emitted immediately as a partial (`is_final =
//!   false`) for live UI feedback.
//! * The *previous* pending utterance is finalized (`is_final = true`) as soon as
//!   a line arrives that is NOT a prefix-extension of it — i.e. a new, distinct
//!   utterance. This means back-to-back distinct commands (as `hear -m` single-
//!   line mode is expected to produce) each get their own final with no loss.
//! * If a line *is* a prefix-extension of the pending text (progressive
//!   partials, as non-`-m` mode might stream), it supersedes it without a final;
//!   the utterance is finalized on settle instead.
//! * A `settle` gap (no new line for the configured duration, default 600ms)
//!   finalizes whatever is pending — the backstop that guarantees the last
//!   utterance of a burst always finalizes.
//!
//! See [`supervisor`] for the implementation and its inline tests.

mod supervisor;

pub use supervisor::{DownReason, SttConfig, SttEvent, SttHandle, SttSupervisor, Transcript};
