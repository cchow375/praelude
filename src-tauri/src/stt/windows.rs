//! Honest Windows speech-to-text boundary.
//!
//! The vendored `hear` executable is a Mach-O binary backed by macOS Speech and
//! AVAudioEngine. Trying to start it on Windows would create a restart storm and
//! present a broken microphone as a recoverable setup problem. This module keeps
//! the platform-neutral voice-loop API intact while emitting one terminal,
//! explicit unsupported-platform event and owning no child process.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Transcript {
    pub text: String,
    pub is_final: bool,
    pub at: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownReason {
    UnsupportedPlatform,
    DictationDisabled,
    MicDenied,
    RestartStorm,
}

#[derive(Debug, Clone)]
pub enum SttEvent {
    Transcript(Transcript),
    Down(DownReason),
}

/// API-compatible configuration retained so the platform-neutral voice loop can
/// keep one construction path. No field is interpreted by the Windows stub.
#[derive(Debug, Clone)]
pub struct SttConfig {
    pub binary: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub use_stdbuf: bool,
    pub settle: Duration,
    pub settle_control: Option<Arc<AtomicU64>>,
    pub backoff: Duration,
    pub max_restarts: usize,
    pub restart_window: Duration,
}

impl SttConfig {
    pub fn hear(binary: PathBuf) -> Self {
        Self {
            binary,
            args: ["-d", "-l", "en-US"]
                .iter()
                .map(|value| value.to_string())
                .collect(),
            env: HashMap::new(),
            use_stdbuf: false,
            settle: Duration::from_millis(600),
            settle_control: None,
            backoff: Duration::from_secs(1),
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
        }
    }
}

pub struct SttHandle {
    gate: Arc<AtomicBool>,
    notifier: Option<JoinHandle<()>>,
}

impl SttHandle {
    pub fn set_gate(&self, open: bool) {
        self.gate.store(open, Ordering::Release);
    }

    pub fn gate_flag(&self) -> Arc<AtomicBool> {
        self.gate.clone()
    }

    pub fn shutdown(&mut self) {
        if let Some(notifier) = self.notifier.take() {
            let _ = notifier.join();
        }
    }
}

impl Drop for SttHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct SttSupervisor;

impl SttSupervisor {
    pub fn spawn<F>(binary: PathBuf, on_event: F) -> SttHandle
    where
        F: Fn(SttEvent) + Send + Sync + 'static,
    {
        Self::spawn_with_config(SttConfig::hear(binary), on_event)
    }

    pub fn spawn_with_config<F>(config: SttConfig, on_event: F) -> SttHandle
    where
        F: Fn(SttEvent) + Send + Sync + 'static,
    {
        Self::spawn_with_config_and_gate(config, on_event, Arc::new(AtomicBool::new(true)))
    }

    pub(crate) fn spawn_with_config_and_gate<F>(
        _config: SttConfig,
        on_event: F,
        gate: Arc<AtomicBool>,
    ) -> SttHandle
    where
        F: Fn(SttEvent) + Send + Sync + 'static,
    {
        let notifier = thread::spawn(move || {
            on_event(SttEvent::Down(DownReason::UnsupportedPlatform));
        });
        SttHandle {
            gate,
            notifier: Some(notifier),
        }
    }
}

/// Windows has no POSIX process-group or signal-handler cleanup to install.
pub fn install_termination_handler() {}

/// Windows owns no `hear` child, so abnormal-exit cleanup is a no-op.
pub fn kill_current_hear_group() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn emits_exactly_one_terminal_unsupported_event_and_owns_no_process() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let mut handle = SttSupervisor::spawn(PathBuf::from("hear"), move |event| {
            sink.lock().unwrap().push(event);
        });
        handle.shutdown();

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events.as_slice(),
            [SttEvent::Down(DownReason::UnsupportedPlatform)]
        ));
    }
}
