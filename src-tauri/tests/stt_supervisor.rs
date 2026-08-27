//! Integration tests for the STT supervisor, driven by `tests/fixtures/fake_hear.sh`.
//!
//! The fake stands in for the real `hear` CLI: it emits scripted lines, can exit
//! to force a respawn, can fail instantly with a Code=201 (dictation-disabled)
//! error, and can fork a grandchild to prove the whole process group is killed on
//! shutdown. These tests never touch the real binary or the microphone.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use codakiller_lib::stt::{DownReason, SttConfig, SttEvent, SttSupervisor};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_hear.sh")
}

/// A test config pointed at the fake, with timings compressed so the restart /
/// storm behavior is exercised in well under a second. `env` is applied to the
/// spawned fake via extra fields on the config.
fn test_config(env: Vec<(&str, String)>) -> SttConfig {
    SttConfig {
        binary: fixture(),
        args: vec![],
        env: env
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect::<HashMap<_, _>>(),
        use_stdbuf: false,
        settle: Duration::from_millis(200),
        settle_control: None,
        backoff: Duration::from_millis(80),
        max_restarts: 5,
        restart_window: Duration::from_secs(3),
    }
}

/// Collect SttEvents into a shared vector; returns the sink + a clone of the log.
fn collector() -> (
    impl Fn(SttEvent) + Send + Sync + 'static,
    Arc<Mutex<Vec<SttEvent>>>,
) {
    let log: Arc<Mutex<Vec<SttEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = log.clone();
    let f = move |ev: SttEvent| sink.lock().unwrap().push(ev);
    (f, log)
}

fn finals(log: &Arc<Mutex<Vec<SttEvent>>>) -> Vec<String> {
    log.lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            SttEvent::Transcript(t) if t.is_final => Some(t.text.clone()),
            _ => None,
        })
        .collect()
}

fn transcript_texts(log: &Arc<Mutex<Vec<SttEvent>>>) -> Vec<String> {
    log.lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            SttEvent::Transcript(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect()
}

fn downs(log: &Arc<Mutex<Vec<SttEvent>>>) -> Vec<DownReason> {
    log.lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            SttEvent::Down(r) => Some(*r),
            _ => None,
        })
        .collect()
}

fn wait_until<F: Fn() -> bool>(timeout: Duration, cond: F) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    cond()
}

// (a) Scripted lines arrive as Transcripts, and a final eventually fires.
#[test]
fn lines_arrive_as_transcripts() {
    let (sink, log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-stay".into()),
        ("FAKE_LINES", "hello world|testing one two".into()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    // Both lines should show up as transcripts.
    assert!(
        wait_until(Duration::from_secs(3), || {
            let t = transcript_texts(&log);
            t.iter().any(|s| s == "hello world") && t.iter().any(|s| s == "testing one two")
        }),
        "expected both scripted lines as transcripts, got {:?}",
        transcript_texts(&log)
    );

    // And a final must eventually fire (settle timer) so Task 13 routing works.
    assert!(
        wait_until(Duration::from_secs(2), || finals(&log)
            .iter()
            .any(|s| s == "testing one two")),
        "expected a final for the last utterance, finals={:?}",
        finals(&log)
    );

    handle.shutdown();
}

// (b) Gate closed => lines are dropped at the supervisor. Nothing is delivered
// while the gate is closed (not buffered and delivered late).
#[test]
fn gate_closed_drops_lines() {
    let dir = std::env::temp_dir();
    let emit_file = dir.join(format!("fake_hear_gate_emit_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&emit_file);

    let (sink, log) = collector();
    // Slow the fake down so the gate is provably closed across the whole emit
    // window, and delay the first line so we can close the gate before it fires.
    // FAKE_EMIT_FILE records every line the fake actually printed, so we can prove
    // this test isn't passing vacuously (i.e. the fake really did emit lines that
    // the closed gate then dropped).
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-stay".into()),
        ("FAKE_LINES", "one|two|three".into()),
        ("FAKE_LINE_DELAY", "0.15".into()),
        ("FAKE_EMIT_FILE", emit_file.to_string_lossy().into_owned()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    // Close the gate immediately, before any line is emitted.
    handle.set_gate(false);

    // Let the fake run through its entire scripted emission (3 * 150ms) plus the
    // settle window, all with the gate closed.
    std::thread::sleep(Duration::from_millis(900));

    // The fixture MUST have actually emitted lines, else the empty-transcript
    // assertion below would be vacuously true.
    let emitted = std::fs::read_to_string(&emit_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    let got = transcript_texts(&log);
    let _ = std::fs::remove_file(&emit_file);
    assert!(
        emitted >= 1,
        "fixture never emitted any lines; the drop assertion would be vacuous"
    );
    assert!(
        got.is_empty(),
        "gate closed => no transcripts should be delivered, got {got:?} (fixture emitted {emitted} lines)"
    );

    handle.shutdown();
}

// (b') Reopening the gate lets subsequent lines through (gate is a live toggle).
#[test]
fn gate_reopen_delivers_again() {
    let (sink, log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-stay".into()),
        ("FAKE_LINES", "alpha|beta|gamma|delta|epsilon".into()),
        ("FAKE_LINE_DELAY", "0.15".into()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    handle.set_gate(false);
    std::thread::sleep(Duration::from_millis(250)); // drop the first ~1-2 lines
    handle.set_gate(true);

    assert!(
        wait_until(Duration::from_secs(3), || !transcript_texts(&log)
            .is_empty()),
        "expected some transcripts after reopening the gate"
    );

    handle.shutdown();
}

// (c) Child death triggers a respawn (fixture bumps a spawn-count file).
#[test]
fn child_death_triggers_respawn() {
    let dir = std::env::temp_dir();
    let count_file = dir.join(format!("fake_hear_count_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&count_file);

    let (sink, _log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-exit".into()), // emit then exit -> respawn
        ("FAKE_LINES", "x".into()),
        ("FAKE_COUNT_FILE", count_file.to_string_lossy().into_owned()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    // With an 80ms backoff, several respawns should happen quickly.
    let got_respawn = wait_until(Duration::from_secs(3), || {
        std::fs::read_to_string(&count_file)
            .map(|s| s.lines().count() >= 2)
            .unwrap_or(false)
    });

    handle.shutdown();
    let count = std::fs::read_to_string(&count_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    let _ = std::fs::remove_file(&count_file);
    assert!(
        got_respawn,
        "expected at least 2 spawns (respawn on death), saw {count}"
    );
}

// (d) Shutdown terminates the whole process GROUP: a grandchild forked by the
// fake must be dead after shutdown.
#[test]
fn shutdown_terminates_process_group() {
    let dir = std::env::temp_dir();
    let child_pid_file = dir.join(format!("fake_hear_gchild_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&child_pid_file);

    let (sink, _log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-stay".into()),
        ("FAKE_LINES", "x".into()),
        (
            "FAKE_CHILD_PID_FILE",
            child_pid_file.to_string_lossy().into_owned(),
        ),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    // Wait for the grandchild pid to be recorded.
    assert!(
        wait_until(Duration::from_secs(3), || child_pid_file.exists()),
        "fake never recorded its grandchild pid"
    );
    let gchild: i32 = std::fs::read_to_string(&child_pid_file)
        .unwrap()
        .trim()
        .parse()
        .expect("grandchild pid");
    // Sanity: grandchild is alive before shutdown.
    assert!(pid_alive(gchild), "grandchild should be alive pre-shutdown");

    handle.shutdown();

    // After shutdown the whole group (including the grandchild) must be gone.
    assert!(
        wait_until(Duration::from_secs(3), || !pid_alive(gchild)),
        "grandchild {gchild} still alive after shutdown => group not killed"
    );
    let _ = std::fs::remove_file(&child_pid_file);
}

// (e) Config error (Code=201, dictation disabled) => a single Down event, NO
// restart hot-loop.
#[test]
fn config_error_emits_down_no_hotloop() {
    let dir = std::env::temp_dir();
    let count_file = dir.join(format!("fake_hear_cfg_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&count_file);

    let (sink, log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "config-error".into()),
        ("FAKE_COUNT_FILE", count_file.to_string_lossy().into_owned()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    assert!(
        wait_until(Duration::from_secs(3), || downs(&log)
            .contains(&DownReason::DictationDisabled)),
        "expected a DictationDisabled down event, downs={:?}",
        downs(&log)
    );

    // It must NOT hot-loop: give it time and confirm the fake was spawned only
    // once (config error => stop, don't restart).
    std::thread::sleep(Duration::from_millis(500));
    let spawns = std::fs::read_to_string(&count_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    handle.shutdown();
    let _ = std::fs::remove_file(&count_file);
    assert_eq!(spawns, 1, "config error must not hot-loop restarts");
}

// (e2) Permission denial: a fixture that prints the REAL `hear` speech-recognition
// denial string and exits => a single Down(MicDenied), NO restart hot-loop.
#[test]
fn mic_denied_emits_down_no_hotloop() {
    let dir = std::env::temp_dir();
    let count_file = dir.join(format!("fake_hear_mic_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&count_file);

    let (sink, log) = collector();
    let cfg = test_config(vec![
        ("FAKE_MODE", "mic-denied".into()),
        ("FAKE_COUNT_FILE", count_file.to_string_lossy().into_owned()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    assert!(
        wait_until(Duration::from_secs(3), || downs(&log)
            .contains(&DownReason::MicDenied)),
        "expected a MicDenied down event, downs={:?}",
        downs(&log)
    );

    // It must NOT hot-loop: permission won't change by restarting, so the fake
    // must have been spawned exactly once.
    std::thread::sleep(Duration::from_millis(500));
    let spawns = std::fs::read_to_string(&count_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    handle.shutdown();
    let _ = std::fs::remove_file(&count_file);
    assert_eq!(spawns, 1, "mic-denied must not hot-loop restarts");
}

// (f) Restart storm: a fixture that always exits instantly should trip the
// max-restarts cap and emit a RestartStorm down event, then stop.
#[test]
fn restart_storm_emits_down() {
    let dir = std::env::temp_dir();
    let count_file = dir.join(format!("fake_hear_storm_{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&count_file);

    let (sink, log) = collector();
    // emit-exit with no lines + tiny delay => the child dies almost instantly,
    // over and over, until the cap trips.
    let cfg = test_config(vec![
        ("FAKE_MODE", "emit-exit".into()),
        ("FAKE_LINES", "".into()),
        ("FAKE_LINE_DELAY", "0".into()),
        ("FAKE_COUNT_FILE", count_file.to_string_lossy().into_owned()),
    ]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);

    assert!(
        wait_until(Duration::from_secs(5), || downs(&log)
            .contains(&DownReason::RestartStorm)),
        "expected a RestartStorm down event, downs={:?}",
        downs(&log)
    );

    // After the storm down, it must stop restarting. Record the count, wait,
    // and confirm it did not grow.
    let after_down = std::fs::read_to_string(&count_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    std::thread::sleep(Duration::from_millis(500));
    let later = std::fs::read_to_string(&count_file)
        .map(|s| s.lines().count())
        .unwrap_or(0);
    handle.shutdown();
    let _ = std::fs::remove_file(&count_file);
    assert_eq!(
        after_down, later,
        "supervisor kept restarting after the storm down event"
    );
    // Cap is 5 restarts => 6 total spawns before giving up.
    assert!(
        after_down <= 6,
        "expected the cap to stop things around 6 spawns, saw {after_down}"
    );
}

// Idempotent shutdown: calling shutdown twice must not panic or hang.
#[test]
fn shutdown_is_idempotent() {
    let (sink, _log) = collector();
    let cfg = test_config(vec![("FAKE_MODE", "emit-stay".into())]);
    let mut handle = SttSupervisor::spawn_with_config(cfg, sink);
    handle.shutdown();
    handle.shutdown();
}

// Local helper: is a pid still alive? (kill -0 semantics via a channel-free probe)
fn pid_alive(pid: i32) -> bool {
    // `kill -0` returns success if the process exists and we can signal it.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let alive = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        let _ = tx.send(alive);
    });
    rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
}
