//! STT supervisor implementation. See the module docs in `stt/mod.rs` for the
//! design and the transcript-framing policy.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// One transcript line from `hear`. `is_final` follows the framing policy
/// documented in the module docs; `at` is when the supervisor produced it.
#[derive(Debug, Clone)]
pub struct Transcript {
    pub text: String,
    pub is_final: bool,
    pub at: Instant,
}

/// Why the STT pipeline went down and stopped. Surfaced to the app so the UI can
/// react (e.g. tell the user to enable Dictation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownReason {
    /// `hear` reported `kLSRErrorDomain Code=201` — macOS Dictation is disabled.
    /// No amount of restarting fixes this; it needs a System Settings change.
    DictationDisabled,
    /// `hear` was denied Microphone or Speech-Recognition permission (macOS TCC).
    /// Like [`DictationDisabled`](DownReason::DictationDisabled) this is a permanent
    /// setup error — restarting cannot grant permission, so the supervisor stops
    /// and surfaces actionable guidance (grant it in System Settings, then relaunch).
    MicDenied,
    /// The child kept dying: more than `max_restarts` within `restart_window`.
    RestartStorm,
}

/// Everything the supervisor delivers to the caller's sink.
#[derive(Debug, Clone)]
pub enum SttEvent {
    /// A (partial or final) transcript line.
    Transcript(Transcript),
    /// The pipeline stopped and will not restart itself. Terminal.
    Down(DownReason),
}

/// Configuration for a supervised `hear`-like process.
///
/// [`SttConfig::hear`] builds the real production config; tests construct it
/// directly to point at a fake script with compressed timings. The `env`,
/// `use_stdbuf`, and timing fields are the injectable seams that keep the
/// supervisor testable without the real binary or a microphone.
#[derive(Debug, Clone)]
pub struct SttConfig {
    /// Path to the binary to spawn (real `hear`, or a fake in tests).
    pub binary: PathBuf,
    /// Arguments passed to the binary.
    pub args: Vec<String>,
    /// Extra environment variables for the child (used by the test fake).
    pub env: HashMap<String, String>,
    /// Request wrapping the spawn in `stdbuf -oL` to force line-buffered stdout
    /// when piped. Best-effort: if `stdbuf` is not on PATH the supervisor spawns
    /// the binary directly instead (a missing `stdbuf` must never surface as a
    /// restart storm).
    pub use_stdbuf: bool,
    /// Quiet gap after which a pending utterance is finalized.
    pub settle: Duration,
    /// Delay before respawning a dead child.
    pub backoff: Duration,
    /// Max restarts allowed within `restart_window` before giving up.
    pub max_restarts: usize,
    /// Sliding window over which `max_restarts` is counted.
    pub restart_window: Duration,
}

impl SttConfig {
    /// Production config for the vendored `hear` binary.
    ///
    /// Flags: `-d` on-device (offline + private), `-l en-US` locale. **`-m` is
    /// deliberately OMITTED** — the Task 13 live acceptance run proved `-m`
    /// ("single-line output mode") is fatal: it streams progressive hypotheses
    /// separated by `\r` + ANSI `ESC[2K` with ZERO newlines, so the line-based
    /// reader never completes a line and NO transcript is ever delivered. Without
    /// `-m`, `hear` frames one hypothesis per line with clean `\n` newlines (the
    /// settler collapses the progressive chain into finals). See NOTES "hear CLI
    /// facts". `use_stdbuf` *requests* wrapping in `stdbuf -oL` as insurance
    /// against block-buffered stdout when piped — but it is optional: `stdbuf` is
    /// a Homebrew (coreutils) binary that may be absent, so the supervisor probes
    /// for it once and degrades to a direct `hear` spawn if it is missing (see
    /// [`run_manager`] / [`spawn_child`]). `stdbuf` execs the target so, when
    /// used, the child pid is still `hear` and SIGTERM stays clean.
    pub fn hear(binary: PathBuf) -> Self {
        SttConfig {
            binary,
            args: ["-d", "-l", "en-US"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            env: HashMap::new(),
            use_stdbuf: true,
            settle: Duration::from_millis(600),
            backoff: Duration::from_secs(1),
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
        }
    }
}

type Sink = Arc<dyn Fn(SttEvent) + Send + Sync + 'static>;

/// The process-group id of the currently-live `hear` child, mirrored into a
/// lock-free atomic so an async-signal-safe termination handler can reach it
/// WITHOUT taking the `SttHandle`'s mutex (forbidden in a signal handler). `0`
/// means "no live child". There is exactly one voice loop / one supervisor per
/// process, so a single global mirror is sufficient. Written by [`run_manager`]
/// on every spawn/reap; read by [`term_signal_handler`].
static CURRENT_HEAR_PGID: AtomicI32 = AtomicI32::new(0);

/// Install an async-signal-safe handler for SIGTERM/SIGINT/SIGHUP that kills the
/// live `hear` process group before the process dies.
///
/// The graceful teardown paths ([`SttHandle::shutdown`] via Tauri's
/// `CloseRequested`/`ExitRequested`) already SIGTERM the `hear` group and reap it.
/// But a *raw POSIX signal* to the app (e.g. `kill <pid>`, a supervisor stopping
/// the service, a terminal SIGINT) bypasses the Tauri event loop entirely, so
/// those handlers never run and `hear` — which lives in its OWN process group —
/// is orphaned to `launchd`, leaking a process that holds the microphone. This
/// handler closes that gap: it `killpg`s the mirrored `hear` pgid, restores the
/// signal's default disposition, and re-raises so the process still dies with the
/// correct exit status. Everything it does (atomic load, `killpg`, `signal`,
/// `raise`) is async-signal-safe — no locks, no allocation. A `kill -9` (SIGKILL,
/// uncatchable) remains the one path that still orphans `hear`; documented, and
/// no worse than before.
pub fn install_termination_handler() {
    // future crates installing SIGTERM/SIGINT/SIGHUP handlers will silently
    // replace this one — the hear-leak returns
    for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        // Safe: registering a plain `extern "C"` handler for a catchable signal.
        unsafe {
            libc::signal(sig, term_signal_handler as *const () as libc::sighandler_t);
        }
    }
}

/// SIGTERM the live `hear` process group, if any. Async-signal-safe (one atomic
/// load + `killpg`, no locks, no allocation), so it is shared by BOTH backstops:
/// the POSIX signal handler below AND the `atexit` hook in `lib.rs` (which covers
/// quit paths that deliver neither a signal nor a Tauri event — verified live
/// 2026-07-10: an AppleEvent quit skips `RunEvent::ExitRequested` entirely,
/// orphaning `hear` with the microphone held until a SIGPIPE eventually kills it).
pub fn kill_current_hear_group() {
    let pgid = CURRENT_HEAR_PGID.load(Ordering::Acquire);
    if pgid != 0 {
        // SIGTERM the hear group (hear ignores SIGINT but exits on SIGTERM).
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
    }
}

/// The signal handler itself. MUST stay async-signal-safe.
extern "C" fn term_signal_handler(sig: libc::c_int) {
    kill_current_hear_group();
    // Restore default disposition and re-raise so the process dies normally.
    unsafe {
        libc::signal(sig, libc::SIG_DFL);
        libc::raise(sig);
    }
}

/// Handle to a running supervisor: toggle the gate, or shut it all down.
pub struct SttHandle {
    gate: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    /// Process-group id of the currently-running child (the child's own pgid,
    /// established via `setpgid` in `pre_exec`). `None` between children.
    pgid: Arc<Mutex<Option<i32>>>,
    /// Wakes the manager thread if it is sleeping through a restart backoff.
    stop_tx: mpsc::Sender<()>,
    manager: Option<JoinHandle<()>>,
    active: bool,
}

impl SttHandle {
    /// Open (`true`) or close (`false`) the half-duplex gate. While closed, lines
    /// read from `hear` are dropped at the supervisor — never buffered, never
    /// delivered late. Cheap: a single atomic store.
    pub fn set_gate(&self, open: bool) {
        self.gate.store(open, Ordering::Release);
    }

    /// A clone of the shared half-duplex gate flag. Lets the TTS [`Speaker`] drive
    /// the *same* atomic the reader thread checks (a `Send + Sync` seam), so the
    /// mic is muted during speech without the Speaker holding the whole
    /// (non-`Sync`) `SttHandle`. See `crate::voice_loop`.
    ///
    /// [`Speaker`]: crate::tts::Speaker
    pub fn gate_flag(&self) -> Arc<AtomicBool> {
        self.gate.clone()
    }

    /// Stop the pipeline: SIGTERM the child's process group, reap it, and join
    /// the supervisor threads. Idempotent — a second call (or `Drop`) is a no-op.
    ///
    /// Caveat: the caller's sink is invoked from the settler thread, which the
    /// manager joins during teardown. The sink must therefore neither panic nor
    /// BLOCK — either one wedges the settler and hangs this join chain (and hence
    /// `shutdown`/`Drop`) forever.
    pub fn shutdown(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        // Tell the manager not to respawn, then make the current child exit.
        self.shutdown.store(true, Ordering::Release);
        if let Some(pgid) = *self.pgid.lock().unwrap() {
            term_group(pgid);
        }
        // Wake the manager if it is mid-backoff.
        let _ = self.stop_tx.send(());
        if let Some(h) = self.manager.take() {
            let _ = h.join();
        }
    }
}

impl Drop for SttHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Entry point for spawning a supervised STT process.
pub struct SttSupervisor;

impl SttSupervisor {
    /// Spawn the real `hear` binary and stream events to `on_event`.
    pub fn spawn<F>(binary: PathBuf, on_event: F) -> SttHandle
    where
        F: Fn(SttEvent) + Send + Sync + 'static,
    {
        Self::spawn_with_config(SttConfig::hear(binary), on_event)
    }

    /// Spawn with an explicit config (used by tests). Returns immediately; the
    /// supervisor runs on its own threads.
    pub fn spawn_with_config<F>(config: SttConfig, on_event: F) -> SttHandle
    where
        F: Fn(SttEvent) + Send + Sync + 'static,
    {
        let sink: Sink = Arc::new(on_event);
        let gate = Arc::new(AtomicBool::new(true));
        let shutdown = Arc::new(AtomicBool::new(false));
        let pgid = Arc::new(Mutex::new(None));
        let (stop_tx, stop_rx) = mpsc::channel::<()>();

        let manager = thread::spawn({
            let sink = sink.clone();
            let gate = gate.clone();
            let shutdown = shutdown.clone();
            let pgid = pgid.clone();
            move || run_manager(config, sink, gate, shutdown, pgid, stop_rx)
        });

        SttHandle {
            gate,
            shutdown,
            pgid,
            stop_tx,
            manager: Some(manager),
            active: true,
        }
    }
}

/// The supervisor loop: (re)spawn the child, pump its output, decide whether to
/// restart. Owns one long-lived "settler" thread that turns the line stream into
/// partial/final transcripts (so framing state survives across respawns).
fn run_manager(
    config: SttConfig,
    sink: Sink,
    gate: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    pgid_slot: Arc<Mutex<Option<i32>>>,
    stop_rx: mpsc::Receiver<()>,
) {
    // Channel carrying raw (gate-passed) lines from each child's reader thread to
    // the single settler thread.
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let settler = thread::spawn({
        let sink = sink.clone();
        let gate = gate.clone();
        let settle = config.settle;
        move || run_settler(line_rx, sink, gate, settle)
    });

    let mut restarts: Vec<Instant> = Vec::new();

    // Probe for `stdbuf` ONCE (it is a Homebrew-only binary that may be absent).
    // If requested but missing, degrade to a direct spawn rather than ever letting
    // a missing `stdbuf` masquerade as a restart storm.
    let use_stdbuf = if config.use_stdbuf {
        if stdbuf_available() {
            true
        } else {
            eprintln!(
                "stt: stdbuf not found on PATH; spawning {:?} directly (stdout may \
                 block-buffer when piped — pty via /usr/bin/script is the documented \
                 escalation, see NOTES)",
                config.binary
            );
            false
        }
    } else {
        false
    };

    loop {
        if shutdown.load(Ordering::Acquire) {
            break;
        }

        // Spawn the child. A spawn failure is treated like a death so a broken
        // binary trips the restart-storm cap instead of looping instantly.
        let mut child = match spawn_child(&config, use_stdbuf) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("stt: failed to spawn {:?}: {e}", config.binary);
                if should_give_up(&mut restarts, &config, &sink, "") {
                    break;
                }
                if backoff_or_stop(&stop_rx, config.backoff, &shutdown) {
                    break;
                }
                continue;
            }
        };

        let child_pgid = child.id() as i32;
        *pgid_slot.lock().unwrap() = Some(child_pgid);
        // Mirror into the lock-free global so the signal handler can reach it.
        CURRENT_HEAR_PGID.store(child_pgid, Ordering::Release);
        // Close the shutdown race: if shutdown was requested after our top-of-loop
        // check but before we published the pgid, signal ourselves so wait()
        // returns instead of blocking forever.
        if shutdown.load(Ordering::Acquire) {
            term_group(child_pgid);
        }

        // Reader thread: stdout -> gate check -> settler channel.
        let reader = {
            let stdout = child.stdout.take().expect("piped stdout");
            let gate = gate.clone();
            let line_tx = line_tx.clone();
            thread::spawn(move || read_lines(stdout, gate, line_tx))
        };
        // Stderr reader: buffer the HEAD of stderr for config-error classification.
        // Cap the retained bytes (the `Code=201` marker appears at the very start)
        // so a chatty or wedged child can't grow this buffer unboundedly; keep
        // draining the pipe past the cap so the child never blocks on a full pipe.
        let stderr_reader = {
            let stderr = child.stderr.take().expect("piped stderr");
            thread::spawn(move || read_stderr_head(stderr))
        };

        let _status = child.wait(); // reaps the child (no zombie)
        // Death-path group kill: SIGTERM the whole group BEFORE joining the reader
        // and stderr threads. A grandchild that inherited the child's stdout/stderr
        // fds would otherwise keep those pipes open, wedging `reader.join()` /
        // `stderr_reader.join()` forever and silently killing auto-restart. On the
        // shutdown path the group was already signaled; a second SIGTERM is harmless
        // (ESRCH on an already-dead group is ignored).
        term_group(child_pgid);
        // Forget the pgid the instant the child is reaped, shrinking the window in
        // which shutdown could signal a pgid the OS has recycled onto a new process.
        *pgid_slot.lock().unwrap() = None;
        // Only clear the global mirror if it still points at THIS child (a fresh
        // spawn in a racing iteration may already have overwritten it).
        let _ = CURRENT_HEAR_PGID.compare_exchange(
            child_pgid,
            0,
            Ordering::AcqRel,
            Ordering::Relaxed,
        );
        let _ = reader.join();
        let stderr_text = stderr_reader.join().unwrap_or_default();

        if shutdown.load(Ordering::Acquire) {
            break;
        }

        // Config error (dictation disabled) never restarts — it needs a settings
        // change, not a respawn.
        if is_config_error(&stderr_text) {
            eprintln!("stt: dictation disabled (Code=201); stopping. stderr: {stderr_text:?}");
            sink(SttEvent::Down(DownReason::DictationDisabled));
            break;
        }

        // Permission denial (Microphone / Speech Recognition TCC) is likewise a
        // permanent setup error — restarting cannot grant permission, so stop and
        // surface actionable guidance instead of hot-looping into a restart storm.
        if is_mic_denied(&stderr_text) {
            eprintln!("stt: microphone / speech-recognition permission denied; stopping. stderr: {stderr_text:?}");
            sink(SttEvent::Down(DownReason::MicDenied));
            break;
        }

        eprintln!("stt: child exited ({_status:?}); considering restart");
        if should_give_up(&mut restarts, &config, &sink, &stderr_text) {
            break;
        }

        if backoff_or_stop(&stop_rx, config.backoff, &shutdown) {
            break;
        }
    }

    // Drop our sender so the settler disconnects and drains, then join it.
    drop(line_tx);
    let _ = settler.join();
}

/// Record this restart and decide whether the storm cap is tripped. Emits the
/// `RestartStorm` down event when giving up. Returns `true` to stop the loop.
fn should_give_up(
    restarts: &mut Vec<Instant>,
    config: &SttConfig,
    sink: &Sink,
    _stderr: &str,
) -> bool {
    let now = Instant::now();
    restarts.retain(|t| now.duration_since(*t) < config.restart_window);
    if restarts.len() >= config.max_restarts {
        eprintln!(
            "stt: restart storm ({} restarts within {:?}); giving up",
            restarts.len(),
            config.restart_window
        );
        sink(SttEvent::Down(DownReason::RestartStorm));
        return true;
    }
    restarts.push(now);
    false
}

/// Sleep the backoff, but wake early (and return `true`) if shutdown is
/// requested. Returns `true` to stop the loop.
fn backoff_or_stop(
    stop_rx: &mpsc::Receiver<()>,
    backoff: Duration,
    shutdown: &AtomicBool,
) -> bool {
    match stop_rx.recv_timeout(backoff) {
        Ok(()) | Err(RecvTimeoutError::Disconnected) => true,
        Err(RecvTimeoutError::Timeout) => shutdown.load(Ordering::Acquire),
    }
}

/// Probe (once, at manager start) whether `stdbuf` is runnable. `stdbuf` is a
/// Homebrew (coreutils) binary that is not present on a stock macOS, so this is
/// best-effort: `false` simply means "spawn `hear` directly".
fn stdbuf_available() -> bool {
    Command::new("stdbuf")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Build and spawn the child in its own process group (so shutdown can SIGTERM
/// the whole group). When `use_stdbuf` is set the spawn is wrapped in
/// `stdbuf -oL`; if that wrapper turns out to be missing at exec time (ENOENT),
/// we transparently fall back to a direct spawn — a missing `stdbuf` must never
/// surface as a spawn failure (which would trip the restart-storm cap).
fn spawn_child(config: &SttConfig, use_stdbuf: bool) -> std::io::Result<Child> {
    if use_stdbuf {
        match spawn_inner(config, true) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                eprintln!(
                    "stt: stdbuf vanished between probe and spawn (ENOENT); \
                     spawning {:?} directly",
                    config.binary
                );
                spawn_inner(config, false)
            }
            other => other,
        }
    } else {
        spawn_inner(config, false)
    }
}

/// Construct and spawn the command, optionally wrapped in `stdbuf -oL`.
fn spawn_inner(config: &SttConfig, wrap_stdbuf: bool) -> std::io::Result<Child> {
    let mut cmd = if wrap_stdbuf {
        let mut c = Command::new("stdbuf");
        c.arg("-oL").arg(&config.binary).args(&config.args);
        c
    } else {
        let mut c = Command::new(&config.binary);
        c.args(&config.args);
        c
    };
    cmd.envs(&config.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Put the child in its own process group (pgid == child pid) so shutdown can
    // signal the whole group, catching any grandchildren too.
    unsafe {
        cmd.pre_exec(|| {
            // setpgid(0, 0): make this process the leader of a new group.
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn()
}

/// Strip ANSI CSI escape sequences (`ESC [ … final-byte`) and carriage returns
/// from a raw line, then trim. Defensive/future-proof: without `-m` the framing
/// is clean `\n`-terminated lines, but a stray `\r` (progressive rewrite) or an
/// `ESC[2K` erase sequence must never leak into a transcript or the router. Cheap
/// — a single pass, allocates only the cleaned string.
fn sanitize_line(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // ESC: consume a CSI sequence — optional '[' then bytes up to and
            // including the first final byte in 0x40..=0x7e.
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&nc) = chars.peek() {
                    chars.next();
                    if ('\u{40}'..='\u{7e}').contains(&nc) {
                        break;
                    }
                }
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

/// Read stdout line by line. Each non-empty line, when the gate is open, is
/// forwarded to the settler. When the gate is closed the line is DROPPED here —
/// the hot-path check is a single `Acquire` atomic load, no lock.
fn read_lines(stdout: impl Read, gate: Arc<AtomicBool>, line_tx: mpsc::Sender<String>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF: child closed stdout / exited
            Ok(_) => {
                let text = sanitize_line(&line);
                if text.is_empty() {
                    continue;
                }
                if !gate.load(Ordering::Acquire) {
                    continue; // gate closed: drop, do not buffer
                }
                if line_tx.send(text).is_err() {
                    break; // settler gone
                }
            }
            Err(e) => {
                eprintln!("stt: stdout read error: {e}");
                break;
            }
        }
    }
}

/// Read stderr, retaining only the first [`STDERR_HEAD_CAP`] bytes (where the
/// `Code=201` marker lives) while still draining the rest so the child never
/// blocks on a full stderr pipe.
fn read_stderr_head(stderr: impl Read) -> String {
    const STDERR_HEAD_CAP: usize = 4096;
    let mut reader = BufReader::new(stderr);
    let mut head: Vec<u8> = Vec::with_capacity(STDERR_HEAD_CAP);
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break, // EOF
            Ok(n) => {
                if head.len() < STDERR_HEAD_CAP {
                    let take = (STDERR_HEAD_CAP - head.len()).min(n);
                    head.extend_from_slice(&chunk[..take]);
                }
                // Past the cap we keep looping to drain (and discard) the rest.
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&head).into_owned()
}

/// Turn the raw line stream into partial/final transcripts per the framing
/// policy (see module docs). Runs for the supervisor's whole lifetime so
/// utterance state survives child respawns. Gate is re-checked at emit time so
/// a settle-timer final can never leak into a closed-gate window.
fn run_settler(
    line_rx: mpsc::Receiver<String>,
    sink: Sink,
    gate: Arc<AtomicBool>,
    settle: Duration,
) {
    let emit = |text: String, is_final: bool| {
        if gate.load(Ordering::Acquire) {
            sink(SttEvent::Transcript(Transcript {
                text,
                is_final,
                at: Instant::now(),
            }));
        }
    };

    let mut pending: Option<String> = None;
    loop {
        match line_rx.recv_timeout(settle) {
            Ok(text) => {
                // A distinct new utterance finalizes the previous pending one; a
                // strict prefix-EXTENSION supersedes it silently (progressive
                // partial). An EXACTLY-EQUAL repeat is a *new* utterance (saying
                // "done" twice = two reps) and must finalize the previous one — it
                // must NOT collapse into a single final. This is product-critical
                // for Task 13 rep counting.
                if let Some(prev) = pending.take() {
                    let is_extension = text != prev && text.starts_with(&prev);
                    if !is_extension {
                        emit(prev, true);
                    }
                }
                emit(text.clone(), false);
                pending = Some(text);
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(text) = pending.take() {
                    emit(text, true); // settle: finalize the last utterance
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                if let Some(text) = pending.take() {
                    emit(text, true); // flush on teardown
                }
                break;
            }
        }
    }
}

/// True if `hear`'s stderr indicates the dictation-disabled setup error. Matches
/// `Code=201` specifically — a bare `kLSRErrorDomain` covers other, *recoverable*
/// LSR errors that must not be latched into a permanent `DictationDisabled`.
fn is_config_error(stderr: &str) -> bool {
    stderr.contains("Code=201")
}

/// True if `hear`'s stderr indicates a Microphone / Speech-Recognition permission
/// denial (macOS TCC). Distinct from [`is_config_error`] (Dictation *disabled*,
/// Code=201): here the user must GRANT permission in System Settings.
///
/// The matched substrings are the *verbatim* messages `hear` prints via its
/// `die:` helper (`fprintf(stderr, ...)`), read directly from the upstream source
/// `sveinbjornt/hear` (`src/Hear.m`, `requestSpeechRecognitionPermission` +
/// `startListening`) and cross-checked against `strings vendor/bin/hear`:
///
/// * `Speech recognition authorization denied`
/// * `Speech recognition authorization restricted on this device`
/// * `Speech recognition authorization not determined`
/// * `Failed to start audio engine: …` (AVAudioEngine start fails when the
///   Microphone TCC grant is missing)
///
/// We match on the stable, distinctive fragments (`authorization denied`,
/// `authorization restricted`, `authorization not determined`,
/// `Failed to start audio engine`) so a minor upstream wording tweak still
/// classifies. None overlaps the recoverable `kAFAssistantErrorDomain` /
/// `Code=1110` (no-speech) noise, and none overlaps the `Code=201`
/// dictation-disabled marker, so the two terminal conditions stay disjoint.
fn is_mic_denied(stderr: &str) -> bool {
    const NEEDLES: [&str; 4] = [
        "authorization denied",
        "authorization restricted",
        "authorization not determined",
        "Failed to start audio engine",
    ];
    NEEDLES.iter().any(|n| stderr.contains(n))
}

/// SIGTERM an entire process group. `hear` ignores SIGINT but exits cleanly on
/// SIGTERM (Task 9 spike); signaling the group also catches any grandchildren.
fn term_group(pgid: i32) {
    // Safe: killpg with a valid pgid; ESRCH (already gone) is harmless.
    unsafe {
        libc::killpg(pgid, libc::SIGTERM);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn sink_collecting() -> (Sink, Arc<StdMutex<Vec<SttEvent>>>) {
        let log: Arc<StdMutex<Vec<SttEvent>>> = Arc::new(StdMutex::new(Vec::new()));
        let l = log.clone();
        let sink: Sink = Arc::new(move |e| l.lock().unwrap().push(e));
        (sink, log)
    }

    // Config-error classification matches the real Code=201 string.
    #[test]
    fn is_config_error_matches_201() {
        assert!(is_config_error(
            "Error Domain=kLSRErrorDomain Code=201 \"Siri and Dictation are disabled\""
        ));
        assert!(is_config_error("... Code=201 ..."));
        assert!(!is_config_error("kAFAssistantErrorDomain Code=1110 No speech"));
        assert!(!is_config_error(""));
    }

    // Restart-storm accounting: the (max+1)-th death within the window gives up.
    #[test]
    fn storm_cap_trips_after_max_restarts() {
        let (sink, log) = sink_collecting();
        let cfg = SttConfig {
            binary: PathBuf::from("/nonexistent"),
            args: vec![],
            env: HashMap::new(),
            use_stdbuf: false,
            settle: Duration::from_millis(50),
            backoff: Duration::from_millis(1),
            max_restarts: 3,
            restart_window: Duration::from_secs(60),
        };
        let mut restarts = Vec::new();
        // 3 deaths are absorbed as restarts...
        for _ in 0..3 {
            assert!(!should_give_up(&mut restarts, &cfg, &sink, ""));
        }
        // ...the 4th trips the cap.
        assert!(should_give_up(&mut restarts, &cfg, &sink, ""));
        let downs = log
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, SttEvent::Down(DownReason::RestartStorm)))
            .count();
        assert_eq!(downs, 1);
    }

    // Old restarts fall out of the window, so a slow trickle never trips the cap.
    #[test]
    fn storm_window_prunes_old_restarts() {
        let (sink, _log) = sink_collecting();
        let cfg = SttConfig {
            binary: PathBuf::from("/nonexistent"),
            args: vec![],
            env: HashMap::new(),
            use_stdbuf: false,
            settle: Duration::from_millis(50),
            backoff: Duration::from_millis(1),
            max_restarts: 3,
            restart_window: Duration::from_millis(30),
        };
        let mut restarts = Vec::new();
        for _ in 0..10 {
            assert!(!should_give_up(&mut restarts, &cfg, &sink, ""));
            thread::sleep(Duration::from_millis(40)); // each restart ages out
        }
    }

    // The framing policy: distinct lines each finalize; a prefix-growth collapses
    // to a single final on settle.
    #[test]
    fn settler_finalizes_distinct_and_growing_utterances() {
        let (sink, log) = sink_collecting();
        let gate = Arc::new(AtomicBool::new(true));
        let (tx, rx) = mpsc::channel::<String>();
        let settle = Duration::from_millis(120);
        let s = thread::spawn({
            let sink = sink.clone();
            let gate = gate.clone();
            move || run_settler(rx, sink, gate, settle)
        });

        // Distinct utterances: each should produce its own final.
        tx.send("stop".into()).unwrap();
        thread::sleep(Duration::from_millis(20));
        tx.send("tempo 120".into()).unwrap(); // distinct -> finalizes "stop"
        thread::sleep(Duration::from_millis(200)); // settle -> finalizes "tempo 120"

        // Progressive partials for one utterance: only one final on settle.
        tx.send("play".into()).unwrap();
        thread::sleep(Duration::from_millis(20));
        tx.send("play louder".into()).unwrap(); // growth -> no final for "play"
        drop(tx); // disconnect -> flush "play louder" as final
        let _ = s.join();

        let finals: Vec<String> = log
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SttEvent::Transcript(t) if t.is_final => Some(t.text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(finals, vec!["stop", "tempo 120", "play louder"]);
    }

    // Repeated-command policy: two IDENTICAL lines that arrive WITHIN the settle
    // window must NOT collapse — each is a distinct rep (e.g. saying "done" twice
    // = two reps). Product-critical for Task 13 rep counting.
    #[test]
    fn settler_equal_repeat_within_window_yields_two_finals() {
        let (sink, log) = sink_collecting();
        let gate = Arc::new(AtomicBool::new(true));
        let (tx, rx) = mpsc::channel::<String>();
        // Settle is 500ms; the two lines land 200ms apart, so they are WITHIN the
        // window — this exercises the equal-repeat path, not the settle timeout.
        let settle = Duration::from_millis(500);
        let s = thread::spawn({
            let sink = sink.clone();
            let gate = gate.clone();
            move || run_settler(rx, sink, gate, settle)
        });

        tx.send("done".into()).unwrap();
        thread::sleep(Duration::from_millis(200));
        tx.send("done".into()).unwrap(); // equal repeat -> finalizes the first "done"
        drop(tx); // disconnect -> flush the second "done" as final
        let _ = s.join();

        let finals: Vec<String> = log
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                SttEvent::Transcript(t) if t.is_final => Some(t.text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(finals, vec!["done", "done"]);
    }

    // Defensive line sanitization: strip CR and ANSI CSI, keep the text.
    #[test]
    fn sanitize_strips_cr_and_ansi_csi() {
        assert_eq!(sanitize_line("Bumped it up for\r\n"), "Bumped it up for");
        assert_eq!(sanitize_line("\u{1b}[2KMetronome 120"), "Metronome 120");
        assert_eq!(
            sanitize_line("\rDone\u{1b}[2K"),
            "Done",
            "leading CR + trailing erase both stripped"
        );
        assert_eq!(sanitize_line("plain"), "plain");
        assert_eq!(sanitize_line("  \r\u{1b}[2K  "), "", "control-only line collapses to empty");
    }

    // is_config_error latches ONLY on Code=201, not on other kLSR errors.
    #[test]
    fn is_config_error_ignores_non_201_lsr() {
        assert!(!is_config_error(
            "Error Domain=kLSRErrorDomain Code=203 \"Some other recoverable error\""
        ));
    }

    // MicDenied classification matches the REAL `hear` permission-denial strings
    // (verbatim from sveinbjornt/hear src/Hear.m), across every denial variant.
    #[test]
    fn is_mic_denied_matches_real_hear_strings() {
        assert!(is_mic_denied("Speech recognition authorization denied"));
        assert!(is_mic_denied(
            "Speech recognition authorization restricted on this device"
        ));
        assert!(is_mic_denied("Speech recognition authorization not determined"));
        assert!(is_mic_denied(
            "Failed to start audio engine: The operation couldn’t be completed."
        ));
    }

    // MicDenied must NOT latch on unrelated / recoverable stderr, and must stay
    // disjoint from the Code=201 dictation-disabled and Code=1110 no-speech cases.
    #[test]
    fn is_mic_denied_ignores_unrelated_stderr() {
        assert!(!is_mic_denied(""));
        assert!(!is_mic_denied(
            "Error Domain=kLSRErrorDomain Code=201 \"Siri and Dictation are disabled\""
        ));
        assert!(!is_mic_denied(
            "kAFAssistantErrorDomain Code=1110 No speech detected"
        ));
        assert!(!is_mic_denied("Metronome 96"));
        // The two terminal classifiers never fire on the same input.
        assert!(!is_config_error("Speech recognition authorization denied"));
    }

    // Gate closed at emit time suppresses a settle-timer final.
    #[test]
    fn settler_respects_gate_at_emit() {
        let (sink, log) = sink_collecting();
        let gate = Arc::new(AtomicBool::new(false)); // closed
        let (tx, rx) = mpsc::channel::<String>();
        let s = thread::spawn({
            let sink = sink.clone();
            let gate = gate.clone();
            move || run_settler(rx, sink, gate, Duration::from_millis(60))
        });
        tx.send("secret".into()).unwrap();
        drop(tx);
        let _ = s.join();
        assert!(
            log.lock().unwrap().is_empty(),
            "closed gate must suppress all transcript emission"
        );
    }
}
