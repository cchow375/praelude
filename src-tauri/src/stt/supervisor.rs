//! STT supervisor implementation. See the module docs in `stt/mod.rs` for the
//! design and the transcript-framing policy.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Wrap the spawn in `stdbuf -oL` to force line-buffered stdout when piped.
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
    /// Flags mirror the Task 9 spike recommendation: `-d` on-device (offline +
    /// private), `-l en-US` locale, `-m` single-line mic mode (one line per
    /// settled utterance). `use_stdbuf` is on as insurance against block-buffered
    /// stdout when piped — `stdbuf` execs the target so the child pid is still
    /// `hear` and SIGTERM stays clean.
    pub fn hear(binary: PathBuf) -> Self {
        SttConfig {
            binary,
            args: ["-d", "-l", "en-US", "-m"]
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

    /// Stop the pipeline: SIGTERM the child's process group, reap it, and join
    /// the supervisor threads. Idempotent — a second call (or `Drop`) is a no-op.
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

    loop {
        if shutdown.load(Ordering::Acquire) {
            break;
        }

        // Spawn the child. A spawn failure is treated like a death so a broken
        // binary trips the restart-storm cap instead of looping instantly.
        let mut child = match spawn_child(&config) {
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
        // Stderr reader: buffer stderr for config-error classification.
        let stderr_reader = {
            let stderr = child.stderr.take().expect("piped stderr");
            thread::spawn(move || {
                let mut buf = String::new();
                let _ = BufReader::new(stderr).read_to_string(&mut buf);
                buf
            })
        };

        let _status = child.wait(); // reaps the child (no zombie)
        let _ = reader.join();
        let stderr_text = stderr_reader.join().unwrap_or_default();
        *pgid_slot.lock().unwrap() = None;

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

/// Build and spawn the child in its own process group (so shutdown can SIGTERM
/// the whole group). Optionally wraps in `stdbuf -oL`.
fn spawn_child(config: &SttConfig) -> std::io::Result<Child> {
    let mut cmd = if config.use_stdbuf {
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

/// Read stdout line by line. Each non-empty line, when the gate is open, is
/// forwarded to the settler. When the gate is closed the line is DROPPED here —
/// the hot-path check is a single relaxed atomic load, no lock.
fn read_lines(stdout: impl Read, gate: Arc<AtomicBool>, line_tx: mpsc::Sender<String>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break, // EOF: child closed stdout / exited
            Ok(_) => {
                let text = line.trim();
                if text.is_empty() {
                    continue;
                }
                if !gate.load(Ordering::Acquire) {
                    continue; // gate closed: drop, do not buffer
                }
                if line_tx.send(text.to_string()).is_err() {
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
                // A distinct new utterance finalizes the previous pending one;
                // a prefix-extension supersedes it silently (progressive partial).
                if let Some(prev) = pending.take() {
                    if !text.starts_with(&prev) {
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

/// True if `hear`'s stderr indicates the dictation-disabled setup error.
fn is_config_error(stderr: &str) -> bool {
    stderr.contains("Code=201") || stderr.contains("kLSRErrorDomain")
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
