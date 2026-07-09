//! Metronome orchestration: a pure state machine ([`MetroState`]) plus a managed
//! [`Metronome`] that drives the [`crate::audio`] engine and the [`BoostGuard`],
//! exposed to the frontend as Tauri commands (`metro_start`, `metro_stop`,
//! `metro_set`, `metro_state`) that emit a `metro://state` event on every change.
//!
//! # How changes reach the running engine
//!
//! The audio callback owns the `Mixer` outright; the *only* lock-free inputs into
//! it are the pattern queue and the click-gain atomic (see [`crate::audio`]). So:
//!
//! * **bpm / beats_per_bar / subdivision / accent** — rebuilt into a [`ClickPattern`]
//!   and handed over with [`EngineHandle::set_pattern`] (adopted at the next beat).
//! * **gain** — [`EngineHandle::set_click_gain`], a single atomic store the callback
//!   reads next buffer. Smooth for slider drags; no restart, no lock.
//! * **sound** — the click samples are `Arc<Vec<f32>>` owned by the callback and
//!   can't be swapped across the thread boundary without *freeing* on the audio
//!   thread (forbidden by the engine's real-time contract). Changing the sound
//!   therefore **restarts the engine** with a fresh `EngineConfig`. Sound changes
//!   are rare, user-initiated, and the restart gap is a single buffer — an
//!   acceptable trade to keep the callback allocation/free-free.
//!
//! The [`Mutex`] here guards the *control* path (command handlers serialize
//! through it, exactly like [`crate::store::Store`]). It never touches the audio
//! callback, so the engine's lock-free discipline is preserved.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::audio::{Clicks, ClickPattern, Engine, EngineConfig, EngineHandle};
use crate::store::Store;
use crate::sysvol::BoostGuard;

/// Hard cap on subdivisions (mirrors the audio clock's `MAX_SUBDIVISION`).
const MAX_SUBDIVISION: u8 = 16;
/// Musically-sane bpm bounds (mirror the clock's `safe_bpm`).
const MIN_BPM: f64 = 1.0;
const MAX_BPM: f64 = 1000.0;
/// Upper bound on click gain (the mixer clamps the summed output anyway; this just
/// keeps the stored setting sane).
const MAX_GAIN: f32 = 4.0;
/// Click sound used when none is persisted / the persisted one is missing.
const DEFAULT_SOUND: &str = "woodblock";
/// System output volume the boost raises to when engaged.
const DEFAULT_BOOST_LEVEL: u8 = 85;

/// Persisted, serde-serialized metronome state. Emitted verbatim as the
/// `metro://state` event payload and returned by every command.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MetroState {
    pub running: bool,
    pub bpm: f64,
    pub beats_per_bar: u8,
    pub subdivision: u8,
    pub accent_first: bool,
    pub sound: String,
    pub gain: f32,
    pub boost: bool,
}

impl Default for MetroState {
    fn default() -> Self {
        MetroState {
            running: false,
            bpm: 120.0,
            beats_per_bar: 4,
            subdivision: 1,
            accent_first: true,
            sound: DEFAULT_SOUND.to_string(),
            gain: 1.0,
            boost: false,
        }
    }
}

impl MetroState {
    /// The audio-engine pattern implied by the current settings (fields clamped
    /// to the engine's honored ranges).
    fn pattern(&self) -> ClickPattern {
        ClickPattern {
            bpm: self.bpm,
            beats_per_bar: self.beats_per_bar.max(1),
            accent_first: self.accent_first,
            subdivision: self.subdivision.clamp(1, MAX_SUBDIVISION),
        }
    }

    fn set_bpm(&mut self, bpm: f64) {
        if bpm.is_finite() {
            self.bpm = bpm.clamp(MIN_BPM, MAX_BPM);
        }
    }

    fn set_gain(&mut self, gain: f32) {
        if gain.is_finite() {
            self.gain = gain.clamp(0.0, MAX_GAIN);
        }
    }

    fn set_subdivision(&mut self, sub: u8) {
        self.subdivision = sub.clamp(1, MAX_SUBDIVISION);
    }

    fn set_beats_per_bar(&mut self, beats: u8) {
        self.beats_per_bar = beats.max(1);
    }
}

/// Managed Tauri state: loaded click sounds, the boost target, and the mutable
/// running state (engine handle + boost guard) behind a control-path mutex.
pub struct Metronome {
    /// Click sounds loaded once at startup (name -> samples). Empty if assets
    /// failed to load (metronome then runs silent).
    sounds: HashMap<String, Clicks>,
    /// System volume the boost raises to.
    boost_level: u8,
    inner: Mutex<Inner>,
}

struct Inner {
    state: MetroState,
    /// `Some` while the engine is running. Dropping it stops the audio.
    handle: Option<EngineHandle>,
    /// `Some` while boost is engaged. Dropping it restores the pre-boost volume.
    guard: Option<BoostGuard>,
}

impl Metronome {
    /// Build the managed state from loaded sounds and the persisted initial state.
    pub fn new(sounds: HashMap<String, Clicks>, state: MetroState, boost_level: u8) -> Self {
        Metronome {
            sounds,
            boost_level,
            inner: Mutex::new(Inner {
                state,
                handle: None,
                guard: None,
            }),
        }
    }

    /// Lock the control state, recovering from a poisoned lock rather than
    /// propagating (a panicked command must not brick the metronome).
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// A snapshot of the current state (for `metro_state`).
    pub fn snapshot(&self) -> MetroState {
        self.lock().state.clone()
    }

    /// Stop audio and restore the system volume. Called on `metro_stop` and on the
    /// window-close / exit path so a boosted volume is never left behind.
    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.guard = None; // drop restores the pre-boost volume
        inner.handle = None; // drop stops the audio stream
        inner.state.running = false;
    }

    /// (Re)build the engine for the current state. Any prior handle is dropped
    /// first (stopping its stream) so there is only ever one live engine.
    fn start_engine(&self, inner: &mut Inner) -> Result<(), String> {
        let clicks = self
            .sounds
            .get(&inner.state.sound)
            .or_else(|| self.sounds.get(DEFAULT_SOUND))
            .cloned();
        inner.handle = None; // stop any existing stream before opening a new one
        let handle = Engine::start(EngineConfig {
            pattern: inner.state.pattern(),
            clicks,
            click_gain: inner.state.gain,
        })?;
        inner.handle = Some(handle);
        Ok(())
    }

    /// Engage/release the boost guard to match `inner.state.boost`.
    fn sync_boost(&self, inner: &mut Inner) {
        if inner.state.boost && inner.guard.is_none() {
            inner.guard = Some(BoostGuard::engage(self.boost_level));
        } else if !inner.state.boost {
            inner.guard = None; // drop restores volume
        }
    }
}

/// Load the persisted metronome defaults, falling back to [`MetroState::default`]
/// for any missing / unparseable key.
pub fn load_state(store: &Store) -> MetroState {
    let mut s = MetroState::default();
    if let Ok(Some(v)) = store.get_setting("metronome.bpm") {
        if let Ok(b) = v.parse::<f64>() {
            s.set_bpm(b);
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.sound") {
        if !v.is_empty() {
            s.sound = v;
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.gain") {
        if let Ok(g) = v.parse::<f32>() {
            s.set_gain(g);
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.boost") {
        s.boost = v == "true";
    }
    if let Ok(Some(v)) = store.get_setting("metronome.beats_per_bar") {
        if let Ok(b) = v.parse::<u8>() {
            s.set_beats_per_bar(b);
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.subdivision") {
        if let Ok(sub) = v.parse::<u8>() {
            s.set_subdivision(sub);
        }
    }
    s
}

/// Load the persisted boost target level, defaulting to [`DEFAULT_BOOST_LEVEL`].
pub fn load_boost_level(store: &Store) -> u8 {
    store
        .get_setting("metronome.boost_level")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<u8>().ok())
        .map(|v| v.min(100))
        .unwrap_or(DEFAULT_BOOST_LEVEL)
}

/// Persist every metronome setting (write-through on `metro_set`). Best-effort:
/// a failed write is logged, not fatal.
fn persist(store: &Store, s: &MetroState) {
    let writes = [
        ("metronome.bpm", s.bpm.to_string()),
        ("metronome.sound", s.sound.clone()),
        ("metronome.gain", s.gain.to_string()),
        ("metronome.boost", s.boost.to_string()),
        ("metronome.beats_per_bar", s.beats_per_bar.to_string()),
        ("metronome.subdivision", s.subdivision.to_string()),
    ];
    for (key, value) in writes {
        if let Err(e) = store.set_setting(key, &value) {
            eprintln!("metronome: failed to persist {key}: {e}");
        }
    }
}

/// Emit the state event to the frontend. Best-effort.
fn emit(app: &AppHandle, s: &MetroState) {
    if let Err(e) = app.emit("metro://state", s) {
        eprintln!("metronome: failed to emit metro://state: {e}");
    }
}

/// Start (or restart) the metronome. Optional `bpm` updates the tempo first.
#[tauri::command]
pub fn metro_start(
    bpm: Option<f64>,
    app: AppHandle,
    metro: State<'_, Metronome>,
) -> Result<MetroState, String> {
    let mut inner = metro.lock();
    if let Some(b) = bpm {
        inner.state.set_bpm(b);
    }
    inner.state.running = true;
    metro.sync_boost(&mut inner);
    metro.start_engine(&mut inner)?;
    let state = inner.state.clone();
    drop(inner);
    emit(&app, &state);
    Ok(state)
}

/// Stop the metronome and restore the system volume.
#[tauri::command]
pub fn metro_stop(app: AppHandle, metro: State<'_, Metronome>) -> Result<MetroState, String> {
    let state = {
        let mut inner = metro.lock();
        inner.handle = None; // stop audio
        inner.guard = None; // restore volume
        inner.state.running = false;
        inner.state.clone()
    };
    emit(&app, &state);
    Ok(state)
}

/// Update one or more settings. Live-applies to a running engine where possible
/// (gain + pattern via lock-free hand-off; sound via restart), toggles boost,
/// writes the new settings through to the store, and emits the new state.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn metro_set(
    bpm: Option<f64>,
    beats_per_bar: Option<u8>,
    subdivision: Option<u8>,
    accent: Option<bool>,
    sound: Option<String>,
    gain: Option<f32>,
    boost: Option<bool>,
    app: AppHandle,
    metro: State<'_, Metronome>,
    store: State<'_, Store>,
) -> Result<MetroState, String> {
    let state = {
        let mut inner = metro.lock();
        let old_sound = inner.state.sound.clone();

        if let Some(v) = bpm {
            inner.state.set_bpm(v);
        }
        if let Some(v) = beats_per_bar {
            inner.state.set_beats_per_bar(v);
        }
        if let Some(v) = subdivision {
            inner.state.set_subdivision(v);
        }
        if let Some(v) = accent {
            inner.state.accent_first = v;
        }
        if let Some(v) = sound {
            inner.state.sound = v;
        }
        if let Some(v) = gain {
            inner.state.set_gain(v);
        }
        if let Some(v) = boost {
            inner.state.boost = v;
        }

        if inner.state.running {
            // Live-apply gain + pattern (lock-free) without a restart.
            let pattern = inner.state.pattern();
            let gain = inner.state.gain;
            if let Some(h) = &inner.handle {
                h.set_click_gain(gain);
                h.set_pattern(pattern);
            }
            // A sound change can't cross the audio-thread boundary lock-free;
            // rebuild the engine (carries the just-updated pattern + gain).
            if inner.state.sound != old_sound {
                metro.start_engine(&mut inner)?;
            }
            // Boost can be toggled mid-run.
            metro.sync_boost(&mut inner);
        }

        inner.state.clone()
    };

    persist(&store, &state);
    emit(&app, &state);
    Ok(state)
}

/// Return the current metronome state (no side effects).
#[tauri::command]
pub fn metro_state(metro: State<'_, Metronome>) -> MetroState {
    metro.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_set_stop_transitions() {
        let mut s = MetroState::default();
        assert!(!s.running);
        assert_eq!(s.bpm, 120.0, "sane default tempo");

        // start(bpm)
        s.set_bpm(140.0);
        s.running = true;
        assert!(s.running);
        assert_eq!(s.bpm, 140.0);

        // set bpm while running
        s.set_bpm(96.0);
        assert_eq!(s.bpm, 96.0);
        assert!(s.running, "set does not stop the metronome");

        // stop
        s.running = false;
        assert!(!s.running);
        assert_eq!(s.bpm, 96.0, "stop leaves the tempo setting intact");
    }

    #[test]
    fn clamps_out_of_range_inputs() {
        let mut s = MetroState::default();
        s.set_subdivision(99);
        assert_eq!(s.subdivision, 16, "subdivision hard-capped at 16");
        s.set_subdivision(0);
        assert_eq!(s.subdivision, 1, "subdivision floored at 1");

        s.set_gain(-2.0);
        assert_eq!(s.gain, 0.0, "gain floored at 0");

        s.set_beats_per_bar(0);
        assert_eq!(s.beats_per_bar, 1, "beats_per_bar floored at 1");

        s.set_bpm(f64::INFINITY);
        assert!(s.bpm.is_finite(), "non-finite bpm rejected");
        s.set_bpm(100000.0);
        assert!(s.bpm <= 1000.0, "bpm capped at 1000");
    }

    // The pattern handed to the engine reflects the clamped settings.
    #[test]
    fn pattern_reflects_clamped_settings() {
        let mut s = MetroState::default();
        s.set_subdivision(64);
        s.set_beats_per_bar(3);
        s.accent_first = false;
        s.set_bpm(-5.0); // clamped to MIN_BPM
        let p = s.pattern();
        assert_eq!(p.subdivision, 16);
        assert_eq!(p.beats_per_bar, 3);
        assert!(!p.accent_first);
        assert_eq!(p.bpm, MIN_BPM);
    }
}
