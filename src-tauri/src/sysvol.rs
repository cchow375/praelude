//! macOS system output-volume control and a crash-safe "boost" guard.
//!
//! Reading and setting the system output volume go through `osascript`
//! (`get volume settings` / `set volume output volume N`) via
//! [`std::process::Command`]. Every osascript invocation is best-effort: a
//! failure is logged, never panicked on — a broken `osascript` must not take the
//! app down, and (crucially) must not leave the user's Mac stuck at boost volume.
//!
//! [`BoostGuard`] captures the current volume on [`BoostGuard::engage`], raises it
//! to a target, and restores the captured value on `Drop` (and on an explicit
//! [`BoostGuard::release`]). The guard is the single mechanism that returns the
//! volume on *every in-process exit path* — metro stop, window close
//! (`on_window_event` `CloseRequested`), app quit (`RunEvent::ExitRequested`,
//! e.g. macOS Cmd-Q), and normal `Drop`. A hard `kill -9` can't run any of these,
//! so a SIGKILL'd process is the one case we cannot cover; that is an OS-level
//! limitation, documented honestly.

use std::process::Command;
use std::sync::atomic::{AtomicI32, Ordering};

/// The pre-boost volume to restore if the process exits while a boost is still
/// engaged, or `-1` when none is. Mirrors [`BoostGuard::saved`] into a lock-free
/// global so the `atexit` backstop in `lib.rs` can restore it on quit paths that
/// never deliver Tauri's events (verified live 2026-07-10: an AppleEvent quit —
/// `osascript 'quit app'` — terminates the NSApp without firing
/// `RunEvent::ExitRequested`, stranding the Mac at boost volume). One metronome
/// ⇒ at most one engaged boost per process, so a single global is sufficient.
static STRANDED_SAVED: AtomicI32 = AtomicI32::new(-1);

/// Restore the pre-boost volume if a [`BoostGuard`] is still engaged at process
/// exit; no-op otherwise. Called from the `atexit` backstop (a normal-exit
/// context, so spawning `osascript` is fine — this is NOT a signal handler).
/// Idempotent: the swap clears the marker, so a second call does nothing.
pub fn restore_stranded_boost() {
    let saved = STRANDED_SAVED.swap(-1, Ordering::AcqRel);
    if saved >= 0 {
        set(saved as u8);
    }
}

/// Parse the `output volume` field out of the text `osascript -e "get volume
/// settings"` prints, e.g. `"output volume:64, input volume:83, alert
/// volume:100, output muted:false"` -> `Some(64)`. Falls back to parsing the
/// whole trimmed string as a bare integer (what `output volume of (get volume
/// settings)` prints). Any parsed value is clamped to `0..=100`. Returns `None`
/// when no integer volume can be found.
pub fn parse_output_volume(s: &str) -> Option<u8> {
    let digits = if let Some(idx) = s.find("output volume:") {
        s[idx + "output volume:".len()..]
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
    } else {
        s.trim().to_string()
    };
    digits.parse::<u16>().ok().map(|v| v.min(100) as u8)
}

/// Read the current system output volume (`0..=100`). Best-effort: on any
/// osascript failure or unparseable output, logs and returns a safe mid-scale
/// default (50) rather than panicking.
pub fn current() -> u8 {
    match Command::new("osascript")
        .arg("-e")
        .arg("get volume settings")
        .output()
    {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            parse_output_volume(&text).unwrap_or(50)
        }
        Err(e) => {
            eprintln!("sysvol: `osascript get volume settings` failed: {e}");
            50
        }
    }
}

/// Set the system output volume (clamped to `0..=100`). Non-fatal on failure:
/// logs and returns. A failed restore must never panic the process.
pub fn set(v: u8) {
    let v = v.min(100);
    if let Err(e) = Command::new("osascript")
        .arg("-e")
        .arg(format!("set volume output volume {v}"))
        .status()
    {
        eprintln!("sysvol: `osascript set volume output volume {v}` failed: {e}");
    }
}

/// RAII guard that raises the system output volume to a boost target and
/// restores the pre-boost volume when dropped (or explicitly released).
///
/// Restore runs exactly once — whichever of [`BoostGuard::release`] or `Drop`
/// fires first. The setter is stored as a boxed closure so the real guard drives
/// [`set`] while tests inject a recording closure (see [`BoostGuard::engage_with`]).
pub struct BoostGuard {
    saved: u8,
    setter: Box<dyn Fn(u8) + Send>,
    active: bool,
}

impl BoostGuard {
    /// Save the current system volume, raise it to `target`, and return a guard
    /// that restores the saved value on drop. Uses the real [`current`]/[`set`].
    pub fn engage(target: u8) -> Self {
        Self::engage_with(target, current, set)
    }

    /// Testable core of [`engage`]: `getter` reads the volume to save, `setter`
    /// applies both the boost and (on drop) the restore. Keeping the effectful
    /// osascript calls behind these closures lets the restore-on-drop contract be
    /// unit-tested with no audio device or real system volume involved.
    pub fn engage_with(
        target: u8,
        getter: impl FnOnce() -> u8,
        setter: impl Fn(u8) + Send + 'static,
    ) -> Self {
        let saved = getter();
        setter(target);
        // Mirror for the atexit backstop (see STRANDED_SAVED). Tests that inject
        // fake setters also write this global; harmless — restore_stranded_boost
        // is only registered (and the global only consumed) in the real app.
        STRANDED_SAVED.store(saved as i32, Ordering::Release);
        BoostGuard {
            saved,
            setter: Box::new(setter),
            active: true,
        }
    }

    /// The volume captured at engage time (restored on drop). Exposed for tests.
    #[allow(dead_code)]
    pub fn saved(&self) -> u8 {
        self.saved
    }

    /// Restore the saved volume now, if not already restored. Idempotent: a
    /// subsequent `Drop` (or second call) does nothing.
    pub fn release(&mut self) {
        if self.active {
            (self.setter)(self.saved);
            self.active = false;
            // The boost is no longer engaged; the atexit backstop has nothing
            // to restore.
            STRANDED_SAVED.store(-1, Ordering::Release);
        }
    }
}

impl Drop for BoostGuard {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn parses_output_volume_from_get_volume_settings() {
        assert_eq!(
            parse_output_volume("output volume:64, input volume:83, alert volume:100, output muted:false"),
            Some(64)
        );
        assert_eq!(parse_output_volume("output volume:0, input volume:0"), Some(0));
        assert_eq!(parse_output_volume("output volume:100, output muted:true"), Some(100));
    }

    #[test]
    fn parses_bare_integer_form() {
        // `output volume of (get volume settings)` prints just the number.
        assert_eq!(parse_output_volume("42\n"), Some(42));
        assert_eq!(parse_output_volume("  7 "), Some(7));
    }

    #[test]
    fn clamps_and_rejects_garbage() {
        assert_eq!(parse_output_volume("output volume:250"), Some(100), "clamped to 100");
        assert_eq!(parse_output_volume("nonsense"), None);
        assert_eq!(parse_output_volume(""), None);
    }

    // BoostGuard restore-on-drop: engage saves the mocked current volume, sets
    // the target, and on drop restores the saved value — verified through a
    // recording setter closure (no real system volume touched).
    #[test]
    fn boost_guard_restores_saved_volume_on_drop() {
        let calls: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let rec = calls.clone();
            let guard = BoostGuard::engage_with(90, || 35, move |v| rec.lock().unwrap().push(v));
            assert_eq!(guard.saved(), 35, "saved the pre-boost volume");
            // Boost applied immediately.
            assert_eq!(&*calls.lock().unwrap(), &[90], "engage raised to target");
        } // guard dropped here -> restore
        assert_eq!(
            &*calls.lock().unwrap(),
            &[90, 35],
            "drop restored the saved volume exactly once"
        );
    }

    // Explicit release restores immediately, and the subsequent Drop is a no-op
    // (restore happens exactly once).
    #[test]
    fn boost_guard_release_is_idempotent() {
        let calls: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let rec = calls.clone();
            let mut guard = BoostGuard::engage_with(80, || 20, move |v| rec.lock().unwrap().push(v));
            guard.release();
            assert_eq!(&*calls.lock().unwrap(), &[80, 20], "release restored once");
            guard.release();
        } // Drop must NOT restore again.
        assert_eq!(
            &*calls.lock().unwrap(),
            &[80, 20],
            "restore ran exactly once across release + drop"
        );
    }
}
