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
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::audio::{
    Clicks, ClickPattern, Engine, EngineConfig, EngineHandle, MAX_BPM, MAX_SUBDIVISION, MIN_BPM,
};
use crate::store::Store;
use crate::sysvol::BoostGuard;

// `MAX_SUBDIVISION`, `MIN_BPM`, and `MAX_BPM` are the audio engine's own honored
// bounds (`audio::clock`), re-exported here so the user-facing clamps below share a
// single source of truth with the scheduler instead of duplicating the literals.

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

/// Injectable engine-start seam. Production is [`Engine::start`]; tests inject a
/// closure that returns `Err` or a device-free [`EngineHandle::test_handle`], so the
/// restart / rollback logic is unit-testable with no audio device (same pattern as
/// [`BoostGuard::engage_with`]).
type EngineStartFn = Box<dyn Fn(EngineConfig) -> Result<EngineHandle, String> + Send + Sync>;
/// Injectable boost-engage seam. Production is [`BoostGuard::engage`] (real
/// osascript); tests inject a recording closure so a rollback's boost release can be
/// asserted without touching the real system volume.
type BoostEngageFn = Box<dyn Fn(u8) -> BoostGuard + Send + Sync>;

/// How a restart of the engine failed. The two variants have very different
/// post-conditions, so callers must roll back differently (see [`Metronome::do_start`]
/// / [`Metronome::do_set`]).
enum StartFailure {
    /// The TTS-drop guard refused the restart: the existing engine was **not
    /// touched** and is still running. `state.running` must stay `true`.
    Busy(String),
    /// The old engine was stopped but the new one failed to start: there is now
    /// **no live engine**, so `state.running` must be rolled back to `false`.
    Dead(String),
}

/// Managed Tauri state: loaded click sounds, the boost target, and the mutable
/// running state (engine handle + boost guard) behind a control-path mutex.
pub struct Metronome {
    /// Click sounds loaded once at startup (name -> samples). Empty if assets
    /// failed to load (metronome then runs silent).
    sounds: HashMap<String, Clicks>,
    /// System volume the boost raises to.
    boost_level: u8,
    /// Seam for starting the audio engine (see [`EngineStartFn`]).
    engine_start: EngineStartFn,
    /// Seam for engaging the boost guard (see [`BoostEngageFn`]).
    boost_engage: BoostEngageFn,
    /// Test-only seam: when set, the NEXT [`Self::start_engine`] returns
    /// [`StartFailure::Busy`] regardless of `pcm_done`, and clears itself. This is
    /// the only way to deterministically reach `do_set`'s Busy arm — that arm is
    /// otherwise a TOCTOU-only path (the pre-check and `start_engine` read the same
    /// `pcm_done` atomic with no interleaving point, so a single thread can never
    /// make one pass and the other fail).
    #[cfg(test)]
    force_restart_busy: std::sync::atomic::AtomicBool,
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
    /// Build the managed state from loaded sounds and the persisted initial state,
    /// wired to the real [`Engine::start`] and [`BoostGuard::engage`].
    pub fn new(sounds: HashMap<String, Clicks>, state: MetroState, boost_level: u8) -> Self {
        Metronome {
            sounds,
            boost_level,
            engine_start: Box::new(Engine::start),
            boost_engage: Box::new(BoostGuard::engage),
            #[cfg(test)]
            force_restart_busy: std::sync::atomic::AtomicBool::new(false),
            inner: Mutex::new(Inner {
                state,
                handle: None,
                guard: None,
            }),
        }
    }

    /// Test constructor: same as [`Self::new`] but with injectable engine-start and
    /// boost-engage seams, so the restart / rollback / busy-guard logic can be
    /// exercised with mock closures and no audio device or real system volume.
    #[cfg(test)]
    pub(crate) fn with_seams(
        sounds: HashMap<String, Clicks>,
        state: MetroState,
        boost_level: u8,
        engine_start: impl Fn(EngineConfig) -> Result<EngineHandle, String> + Send + Sync + 'static,
        boost_engage: impl Fn(u8) -> BoostGuard + Send + Sync + 'static,
    ) -> Self {
        Metronome {
            sounds,
            boost_level,
            engine_start: Box::new(engine_start),
            boost_engage: Box::new(boost_engage),
            force_restart_busy: std::sync::atomic::AtomicBool::new(false),
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

    /// Stop audio and restore the system volume. Called on the window-close / exit
    /// path so a boosted volume is never left behind.
    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.guard = None; // drop restores the pre-boost volume
        inner.handle = None; // drop stops the audio stream
        inner.state.running = false;
    }

    /// (Re)build the engine for the current state. Any prior handle is dropped
    /// first (stopping its stream) so there is only ever one live engine.
    ///
    /// **TTS-drop contract (enforced, not documented):** a restart allocates fresh
    /// PCM queues, so any buffered-but-unplayed TTS would be silently discarded even
    /// though `enqueue_pcm` returned `Ok`. Therefore, if an existing engine still has
    /// speech playing (`!pcm_done()`), this refuses with [`StartFailure::Busy`]
    /// **without touching the running engine or state** — the caller must surface the
    /// error and leave the current audio alone. (The TTS producer lands in Task 11;
    /// this makes the contract mechanical now.)
    fn start_engine(&self, inner: &mut Inner) -> Result<(), StartFailure> {
        #[cfg(test)]
        if self
            .force_restart_busy
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(StartFailure::Busy("forced busy (test seam)".to_string()));
        }
        if let Some(h) = &inner.handle {
            if !h.pcm_done() {
                return Err(StartFailure::Busy(
                    "audio busy: speech playing — retry after".to_string(),
                ));
            }
        }
        let clicks = self
            .sounds
            .get(&inner.state.sound)
            .or_else(|| self.sounds.get(DEFAULT_SOUND))
            .cloned();
        inner.handle = None; // stop any existing stream before opening a new one
        let handle = (self.engine_start)(EngineConfig {
            pattern: inner.state.pattern(),
            clicks,
            click_gain: inner.state.gain,
        })
        .map_err(StartFailure::Dead)?;
        inner.handle = Some(handle);
        Ok(())
    }

    /// Engage/release the boost guard to match `inner.state.boost`.
    fn sync_boost(&self, inner: &mut Inner) {
        if inner.state.boost && inner.guard.is_none() {
            inner.guard = Some((self.boost_engage)(self.boost_level));
        } else if !inner.state.boost {
            inner.guard = None; // drop restores volume
        }
    }

    /// Core of `metro_start`: apply an optional bpm, mark running, sync boost, and
    /// (re)start the engine — with rollback on failure. Returns the state to emit
    /// (post-rollback on failure) plus the outcome. Does no I/O beyond the engine /
    /// boost seams, so it runs inside `spawn_blocking` and is directly unit-testable.
    fn do_start(&self, bpm: Option<f64>) -> (MetroState, Result<(), String>) {
        let mut inner = self.lock();
        let prev = inner.state.clone();
        // Whether boost was already engaged *before* this call, so a rollback releases
        // only the boost this call raised (never one a prior call left engaged).
        let boosted_before = inner.guard.is_some();

        if let Some(b) = bpm {
            inner.state.set_bpm(b);
        }
        inner.state.running = true;
        self.sync_boost(&mut inner);

        match self.start_engine(&mut inner) {
            Ok(()) => {
                let state = inner.state.clone();
                (state, Ok(()))
            }
            Err(StartFailure::Busy(msg)) => {
                // Old engine untouched & still running: restore the pre-call state
                // exactly (it already matches the live engine).
                inner.state = prev;
                if !boosted_before {
                    inner.guard = None; // release boost this call engaged
                }
                let state = inner.state.clone();
                (state, Err(msg))
            }
            Err(StartFailure::Dead(msg)) => {
                // Engine was stopped and failed to restart: no live engine, so state
                // must NOT claim running.
                inner.state = prev;
                inner.state.running = false;
                if !boosted_before {
                    inner.guard = None; // release boost this call engaged
                }
                let state = inner.state.clone();
                (state, Err(msg))
            }
        }
    }

    /// Core of `metro_stop`: drop the engine and boost guard and mark stopped.
    fn do_stop(&self) -> MetroState {
        let mut inner = self.lock();
        inner.handle = None; // stop audio (joins the audio thread)
        inner.guard = None; // restore the pre-boost volume
        inner.state.running = false;
        inner.state.clone()
    }

    /// Core of `metro_set`: validate + apply the settings, live-apply to a running
    /// engine (gain/pattern lock-free; sound via restart), sync boost, and persist.
    /// Returns the state to emit plus the outcome. Persist happens here (inside the
    /// blocking section) so the six SQLite writes never run on the UI thread.
    #[allow(clippy::too_many_arguments)]
    fn do_set(
        &self,
        store: &Store,
        bpm: Option<f64>,
        beats_per_bar: Option<u8>,
        subdivision: Option<u8>,
        accent: Option<bool>,
        sound: Option<String>,
        gain: Option<f32>,
        boost: Option<bool>,
    ) -> (MetroState, Result<(), String>) {
        let mut inner = self.lock();

        // Reject an unknown sound up front (before mutating anything). Skip the
        // check when no click set is loaded (assets failed => metronome runs silent,
        // any name is acceptable).
        if let Some(s) = &sound {
            if !self.sounds.is_empty() && !self.sounds.contains_key(s) {
                let state = inner.state.clone();
                return (state, Err(format!("unknown metronome sound '{s}'")));
            }
        }

        // A sound change on a running engine forces a restart, which discards
        // buffered TTS. Enforce the TTS-drop contract BEFORE mutating any state or
        // the live engine, so a busy refusal leaves everything untouched.
        let sound_changing = sound.as_ref().is_some_and(|s| *s != inner.state.sound);
        // Remember the sound in effect before we mutate it, so a Busy refusal from
        // the restart (only reachable via a concurrent TTS producer, Task 11) can
        // roll it back — the engine keeps playing the old sound and the store is
        // not rewritten, so the emitted state must not claim the new one.
        let prev_sound = inner.state.sound.clone();
        if inner.state.running && sound_changing {
            if let Some(h) = &inner.handle {
                if !h.pcm_done() {
                    let state = inner.state.clone();
                    return (
                        state,
                        Err("audio busy: speech playing — retry after".to_string()),
                    );
                }
            }
        }

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
            if sound_changing {
                match self.start_engine(&mut inner) {
                    Ok(()) => {}
                    Err(StartFailure::Dead(msg)) => {
                        // Engine stopped and failed to restart: it is now dead, so
                        // state must not claim running. Persist the rolled-back state
                        // so the store and the emit stay consistent.
                        inner.state.running = false;
                        let state = inner.state.clone();
                        drop(inner);
                        persist(store, &state);
                        return (state, Err(msg));
                    }
                    Err(StartFailure::Busy(msg)) => {
                        // Pre-checked above; only reachable via a concurrent TTS
                        // producer (Task 11). Engine untouched & still running the
                        // OLD sound, and persist is skipped — so roll the sound
                        // field back (the other, lock-free changes DID apply) so
                        // the emitted state matches reality instead of lying.
                        inner.state.sound = prev_sound;
                        let state = inner.state.clone();
                        return (state, Err(msg));
                    }
                }
            }
            // Boost can be toggled mid-run.
            self.sync_boost(&mut inner);
        }

        let state = inner.state.clone();
        drop(inner);
        persist(store, &state);
        (state, Ok(()))
    }
}

/// Load the persisted metronome defaults, falling back to [`MetroState::default`]
/// for any missing / unparseable key.
pub fn load_state(store: &Store) -> MetroState {
    let mut s = MetroState::default();
    if let Ok(Some(v)) = store.get_setting("metronome.bpm") {
        match v.parse::<f64>() {
            Ok(b) => s.set_bpm(b),
            Err(e) => eprintln!("metronome: ignoring unparseable metronome.bpm {v:?}: {e}"),
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.sound") {
        if !v.is_empty() {
            s.sound = v;
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.gain") {
        match v.parse::<f32>() {
            Ok(g) => s.set_gain(g),
            Err(e) => eprintln!("metronome: ignoring unparseable metronome.gain {v:?}: {e}"),
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.boost") {
        s.boost = v == "true";
    }
    if let Ok(Some(v)) = store.get_setting("metronome.beats_per_bar") {
        match v.parse::<u8>() {
            Ok(b) => s.set_beats_per_bar(b),
            Err(e) => {
                eprintln!("metronome: ignoring unparseable metronome.beats_per_bar {v:?}: {e}")
            }
        }
    }
    if let Ok(Some(v)) = store.get_setting("metronome.subdivision") {
        match v.parse::<u8>() {
            Ok(sub) => s.set_subdivision(sub),
            Err(e) => {
                eprintln!("metronome: ignoring unparseable metronome.subdivision {v:?}: {e}")
            }
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

/// Persist every metronome setting (write-through on `metro_set`) in a single
/// transaction, so the six writes commit atomically and take the store lock once.
/// Best-effort: a failed commit is logged, not fatal.
fn persist(store: &Store, s: &MetroState) {
    let writes = [
        ("metronome.bpm", s.bpm.to_string()),
        ("metronome.sound", s.sound.clone()),
        ("metronome.gain", s.gain.to_string()),
        ("metronome.boost", s.boost.to_string()),
        ("metronome.beats_per_bar", s.beats_per_bar.to_string()),
        ("metronome.subdivision", s.subdivision.to_string()),
    ];
    if let Err(e) = store.set_settings(&writes) {
        eprintln!("metronome: failed to persist settings: {e}");
    }
}

/// Emit the state event to the frontend. Best-effort.
fn emit(app: &AppHandle, s: &MetroState) {
    if let Err(e) = app.emit("metro://state", s) {
        eprintln!("metronome: failed to emit metro://state: {e}");
    }
}

/// Start (or restart) the metronome. Optional `bpm` updates the tempo first.
///
/// `async` + `spawn_blocking`: the blocking work — spawning `osascript` for the
/// boost, joining the audio thread + reopening the output device on an engine
/// (re)start — must not run on Tauri's main thread (it would freeze the UI). The
/// control mutex is taken only inside the blocking closure, never across an
/// `.await`.
#[tauri::command]
pub async fn metro_start(
    bpm: Option<f64>,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || metro.do_start(bpm))
        .await
        .map_err(|e| format!("metro_start task failed: {e}"))?;
    emit(&app, &state);
    result.map(|()| state)
}

/// Stop the metronome and restore the system volume. `async` + `spawn_blocking`:
/// dropping the guard spawns `osascript` and dropping the handle joins the audio
/// thread — blocking work kept off the main thread.
#[tauri::command]
pub async fn metro_stop(
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let state = tauri::async_runtime::spawn_blocking(move || metro.do_stop())
        .await
        .map_err(|e| format!("metro_stop task failed: {e}"))?;
    emit(&app, &state);
    Ok(state)
}

/// Update one or more settings. Live-applies to a running engine where possible
/// (gain + pattern via lock-free hand-off; sound via restart), toggles boost,
/// writes the new settings through to the store, and emits the new state.
///
/// `async` + `spawn_blocking`: boost `osascript`, a possible engine restart, and
/// the six-key persist transaction are all blocking and must not run on the main
/// thread.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn metro_set(
    bpm: Option<f64>,
    beats_per_bar: Option<u8>,
    subdivision: Option<u8>,
    accent: Option<bool>,
    sound: Option<String>,
    gain: Option<f32>,
    boost: Option<bool>,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.do_set(
            &store,
            bpm,
            beats_per_bar,
            subdivision,
            accent,
            sound,
            gain,
            boost,
        )
    })
    .await
    .map_err(|e| format!("metro_set task failed: {e}"))?;
    emit(&app, &state);
    result.map(|()| state)
}

/// Return the current metronome state (no side effects). Stays synchronous: it
/// only takes the mutex briefly to clone the state (no blocking I/O).
#[tauri::command]
pub fn metro_state(metro: State<'_, Arc<Metronome>>) -> MetroState {
    metro.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// A loaded click set with the given names (empty `Clicks`, enough to exercise
    /// sound validation / lookup).
    fn sounds_with(names: &[&str]) -> HashMap<String, Clicks> {
        names
            .iter()
            .map(|n| (n.to_string(), Clicks::default()))
            .collect()
    }

    /// A boost-engage seam that records every volume the guard sets (no real
    /// system volume touched). Returns the seam closure + the shared record.
    fn recording_boost() -> (
        impl Fn(u8) -> BoostGuard + Send + Sync + 'static,
        Arc<StdMutex<Vec<u8>>>,
    ) {
        let calls: Arc<StdMutex<Vec<u8>>> = Arc::new(StdMutex::new(Vec::new()));
        let rec = calls.clone();
        let seam = move |level: u8| {
            let rec = rec.clone();
            BoostGuard::engage_with(level, || 40, move |v| rec.lock().unwrap().push(v))
        };
        (seam, calls)
    }

    // (a) Engine start failure must roll `running` back to false AND release the
    //     boost this call engaged (both via mock closures — no device, no real
    //     system volume) while surfacing a descriptive error.
    #[test]
    fn start_failure_rolls_back_running_and_releases_boost() {
        let (boost_seam, vol_calls) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState {
                boost: true,
                ..MetroState::default()
            },
            85,
            |_cfg| Err("no audio device".to_string()),
            boost_seam,
        );

        let (state, result) = metro.do_start(None);

        assert!(result.is_err(), "start must fail when the engine can't start");
        assert!(
            !state.running,
            "running rolled back to false on a dead engine"
        );
        // Boost was raised to 85 by this call, then restored to the saved 40 on
        // rollback — engaged then released, exactly once each.
        assert_eq!(
            &*vol_calls.lock().unwrap(),
            &[85, 40],
            "boost engaged then released on rollback"
        );
        assert!(
            metro.lock().guard.is_none(),
            "boost guard cleared after rollback"
        );
        assert!(metro.lock().handle.is_none(), "no live engine after failure");
    }

    // (b) A sound-change restart must be REFUSED while a fake handle reports PCM
    //     not done (speech playing): engine untouched, state unchanged, no restart.
    #[test]
    fn sound_change_refused_while_speech_playing() {
        let started = Arc::new(StdMutex::new(0u32));
        let s = started.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock", "cowbell"]),
            MetroState {
                running: true,
                sound: "woodblock".to_string(),
                ..MetroState::default()
            },
            85,
            move |_cfg| {
                *s.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        // Simulate a running engine with speech still buffered (pcm not done).
        metro.lock().handle = Some(EngineHandle::test_handle(48_000, 4096));

        let store = Store::open(":memory:").expect("in-memory store");
        let (state, result) =
            metro.do_set(&store, None, None, None, None, Some("cowbell".into()), None, None);

        let err = result.expect_err("sound change must be refused while speech plays");
        assert!(err.contains("busy"), "descriptive busy error, got: {err}");
        assert_eq!(state.sound, "woodblock", "sound NOT changed while busy");
        assert!(state.running, "engine left running and untouched");
        assert_eq!(*started.lock().unwrap(), 0, "engine was not restarted");
        assert!(
            metro.lock().handle.is_some(),
            "existing engine handle left in place"
        );
    }

    // (b2) The do_set Busy ARM (distinct from the pre-check in (b)): reachable only
    //      via a concurrent-producer TOCTOU, forced here with the `force_restart_busy`
    //      test seam. The pre-check passes (pcm_done true), the sound field is mutated,
    //      then start_engine reports Busy — and the arm must roll the sound back so the
    //      emitted state does not lie (engine keeps the old sound; persist is skipped).
    #[test]
    fn do_set_busy_arm_rolls_back_unapplied_sound() {
        use std::sync::atomic::Ordering;
        let started = Arc::new(StdMutex::new(0u32));
        let s = started.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock", "cowbell"]),
            MetroState {
                running: true,
                sound: "woodblock".to_string(),
                ..MetroState::default()
            },
            85,
            move |_cfg| {
                *s.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        // Running engine, speech DONE (pcm_done true) so the pre-check passes.
        metro.lock().handle = Some(EngineHandle::test_handle(48_000, 0));
        // Force the restart to report Busy (models a TOCTOU concurrent producer).
        metro.force_restart_busy.store(true, Ordering::SeqCst);

        let store = Store::open(":memory:").expect("in-memory store");
        let (state, result) =
            metro.do_set(&store, None, None, None, None, Some("cowbell".into()), None, None);

        let err = result.expect_err("do_set Busy arm must surface the error");
        assert!(err.contains("busy"), "descriptive busy error, got: {err}");
        assert_eq!(
            state.sound, "woodblock",
            "Busy arm must roll the unapplied sound back (emitted state must not lie)"
        );
        assert!(state.running, "engine left running");
        assert_eq!(
            metro.lock().state.sound,
            "woodblock",
            "in-memory state also rolled back, matching the still-running engine"
        );
        // Persist was skipped, so the store must NOT have the new sound.
        assert_ne!(
            store.get_setting("metronome.sound").unwrap().as_deref(),
            Some("cowbell"),
            "the refused sound must not have been persisted"
        );
    }

    // (c) A sound-change restart on a running engine with speech finished must
    //     succeed: engine restarted once, new sound applied + persisted, still
    //     running.
    #[test]
    fn sound_change_restarts_when_speech_done() {
        let started = Arc::new(StdMutex::new(0u32));
        let s = started.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock", "cowbell"]),
            MetroState {
                running: true,
                sound: "woodblock".to_string(),
                ..MetroState::default()
            },
            85,
            move |_cfg| {
                *s.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        // Running engine, speech finished (pcm_done true).
        metro.lock().handle = Some(EngineHandle::test_handle(48_000, 0));

        let store = Store::open(":memory:").expect("in-memory store");
        let (state, result) =
            metro.do_set(&store, None, None, None, None, Some("cowbell".into()), None, None);

        assert!(result.is_ok(), "restart succeeds when speech is done");
        assert_eq!(state.sound, "cowbell", "new sound applied");
        assert!(state.running, "still running after a clean restart");
        assert_eq!(*started.lock().unwrap(), 1, "engine restarted exactly once");
        assert!(metro.lock().handle.is_some(), "new engine handle installed");
        assert_eq!(
            store.get_setting("metronome.sound").unwrap().as_deref(),
            Some("cowbell"),
            "new sound persisted"
        );
    }

    // Minor: an unknown sound name is rejected with a descriptive error and leaves
    // the state unchanged (rather than silently playing the default).
    #[test]
    fn set_rejects_unknown_sound() {
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            |_cfg| Ok(EngineHandle::test_handle(48_000, 0)),
            boost_seam,
        );
        let store = Store::open(":memory:").expect("in-memory store");
        let (state, result) = metro.do_set(
            &store,
            None,
            None,
            None,
            None,
            Some("does-not-exist".into()),
            None,
            None,
        );
        assert!(result.is_err(), "unknown sound must be rejected");
        assert_eq!(state.sound, "woodblock", "state unchanged on rejection");
    }

    // A successful start transitions running -> true and installs a live handle.
    #[test]
    fn start_succeeds_and_installs_handle() {
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            |_cfg| Ok(EngineHandle::test_handle(48_000, 0)),
            boost_seam,
        );
        let (state, result) = metro.do_start(Some(150.0));
        assert!(result.is_ok(), "start succeeds with a working engine seam");
        assert!(state.running, "running after a successful start");
        assert_eq!(state.bpm, 150.0, "bpm applied");
        assert!(metro.lock().handle.is_some(), "live engine handle installed");
    }

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
