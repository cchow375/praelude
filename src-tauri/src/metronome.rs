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
    ClickPattern, Clicks, Engine, EngineConfig, EngineHandle, PcmError, MAX_BPM, MAX_SUBDIVISION,
    MIN_BPM,
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
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MetroOwner {
    Manual,
    Practice { set_id: i64 },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MetroState {
    pub running: bool,
    /// The domain that currently owns lifecycle decisions for the click. This
    /// is intentionally process-local: relaunch starts stopped and unowned.
    pub owner: Option<MetroOwner>,
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
            owner: None,
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
    /// Serializes the complete command boundary: mutate, persist, publish, and
    /// choose the state returned to the caller. The inner lock protects the
    /// engine itself; this outer lock prevents a slower earlier command from
    /// persisting or publishing after a newer one has already won.
    command: Mutex<()>,
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
            command: Mutex::new(()),
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
            command: Mutex::new(()),
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

    /// Run one complete app-facing command in issue order. Production callers
    /// include their persistence, event publication, and returned snapshot in
    /// this boundary. Core `do_*` methods remain independently unit-testable.
    pub(crate) fn serialized<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _command = self.command.lock().unwrap_or_else(|p| p.into_inner());
        operation()
    }

    /// A snapshot of the current state (for `metro_state`).
    pub fn snapshot(&self) -> MetroState {
        self.lock().state.clone()
    }

    // --- TTS PCM bridge (Task 13) -----------------------------------------
    //
    // The TTS `Speaker` plays voice confirmations through the *same* audio engine
    // the metronome owns (single output stream, single PCM producer). But that
    // `EngineHandle` is not stable: a sound-change restart REPLACES it, and a stop
    // drops it entirely. So the Speaker must never capture a handle — it reaches
    // the *current* one through these methods on every chunk, under the same
    // control lock the metronome uses. Consequences, by design:
    //
    // * **Restart-safe:** each `tts_enqueue` reads `inner.handle` fresh, so a
    //   replacement between chunks is transparent. The metronome's Busy guard
    //   refuses a restart while `!pcm_done()`, so a restart never races an
    //   in-flight utterance out from under the Speaker.
    // * **Stopped == silent drop:** with no engine (`handle == None`) there is
    //   nowhere to play, so enqueue is a no-op and `tts_done()` is vacuously true.
    //   The voice loop therefore speaks a stop confirmation BEFORE calling
    //   `do_stop`, while the engine is still alive (see `voice_loop`).
    // * **Cheap under lock:** enqueue is a lock-free queue push and `pcm_done` an
    //   atomic load, so holding the control `Mutex` across them is negligible and
    //   cannot deadlock (they call back into nothing that locks).

    /// Enqueue one chunk of TTS PCM into the current engine, if one is running.
    /// Restart-safe: always targets the live handle. A no-op (Ok) when stopped.
    pub fn tts_enqueue(&self, samples: &[f32], src_rate: u32) -> Result<(), PcmError> {
        match &self.lock().handle {
            Some(h) => h.enqueue_pcm(samples, src_rate),
            None => Ok(()),
        }
    }

    /// `true` once all enqueued TTS PCM has been output (or when stopped, since
    /// there is then nothing buffered anywhere).
    pub fn tts_done(&self) -> bool {
        self.lock().handle.as_ref().is_none_or(|h| h.pcm_done())
    }

    /// Stop audio and restore the system volume. Called on the window-close / exit
    /// path so a boosted volume is never left behind.
    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.guard = None; // drop restores the pre-boost volume
        inner.handle = None; // drop stops the audio stream
        inner.state.running = false;
        inner.state.owner = None;
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
    #[cfg(test)]
    pub(crate) fn do_start(&self, bpm: Option<f64>) -> (MetroState, Result<(), String>) {
        let mut inner = self.lock();
        self.start_locked(&mut inner, bpm)
    }

    fn start_locked(
        &self,
        inner: &mut Inner,
        bpm: Option<f64>,
    ) -> (MetroState, Result<(), String>) {
        let prev = inner.state.clone();
        // Whether boost was already engaged *before* this call, so a rollback releases
        // only the boost this call raised (never one a prior call left engaged).
        let boosted_before = inner.guard.is_some();

        if let Some(b) = bpm {
            inner.state.set_bpm(b);
        }
        inner.state.running = true;
        self.sync_boost(inner);

        match self.start_engine(inner) {
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

    /// Put the metronome in the requested running state without rebuilding an
    /// engine that is already playing. A changed tempo is handed to the live
    /// audio pattern and persisted; an equal tempo (or bare resume) is a true
    /// no-op. The state decision and live handoff share the control lock, so UI
    /// and voice callers cannot race a check-then-restart sequence.
    pub(crate) fn do_ensure_running(
        &self,
        store: &Store,
        bpm: Option<f64>,
    ) -> (MetroState, Result<(), String>) {
        let mut inner = self.lock();
        if !inner.state.running {
            let (state, result) = self.start_locked(&mut inner, bpm);
            drop(inner);
            // A start with an explicit tempo is also a settings mutation.  The
            // old path only persisted live retunes, so "start at 96" sounded at
            // 96 for the current process but a relaunch restored the previous
            // persisted BPM.  Persist only after the engine has started
            // successfully so failed audio starts retain the rollback contract.
            if result.is_ok() && bpm.is_some() {
                persist(store, &state);
            }
            return (state, result);
        }

        let prior_bpm = inner.state.bpm;
        if let Some(value) = bpm {
            inner.state.set_bpm(value);
        }
        let bpm_changed = inner.state.bpm != prior_bpm;
        if bpm_changed {
            let pattern = inner.state.pattern();
            if let Some(handle) = &inner.handle {
                handle.set_pattern(pattern);
            }
        }
        let state = inner.state.clone();
        drop(inner);
        if bpm_changed {
            persist(store, &state);
        }
        (state, Ok(()))
    }

    /// Core of `metro_stop`: drop the engine and boost guard and mark stopped.
    pub(crate) fn do_stop(&self) -> MetroState {
        let mut inner = self.lock();
        inner.handle = None; // stop audio (joins the audio thread)
        inner.guard = None; // restore the pre-boost volume
        inner.state.running = false;
        inner.state.clone()
    }

    /// Mark the latest successful lifecycle/settings command as manual. Manual
    /// ownership prevents a later practice pause/close from stopping a click
    /// the pianist deliberately controls.
    pub(crate) fn claim_manual(&self) -> MetroState {
        let mut inner = self.lock();
        inner.state.owner = Some(MetroOwner::Manual);
        inner.state.clone()
    }

    /// Re-associate a restored metronome-enabled set without starting audio on
    /// app launch. This preserves safe silent relaunch while allowing an
    /// explicit pause/resume/close to retain the same ownership semantics.
    pub(crate) fn restore_practice_owner(&self, set_id: i64) -> MetroState {
        let mut inner = self.lock();
        if !inner.state.running && inner.state.owner.is_none() {
            inner.state.owner = Some(MetroOwner::Practice { set_id });
        }
        inner.state.clone()
    }

    /// Start or retune for a newly opened practice set. Starting a stopped click
    /// claims practice ownership; retuning an already-running click preserves
    /// its existing owner (notably `manual`).
    pub(crate) fn do_practice_start(
        &self,
        store: &Store,
        set_id: i64,
        bpm: f64,
    ) -> (MetroState, Result<(), String>) {
        let was_running = self.snapshot().running;
        let (_, result) = self.do_ensure_running(store, Some(bpm));
        if result.is_ok() && !was_running {
            self.lock().state.owner = Some(MetroOwner::Practice { set_id });
        }
        (self.snapshot(), result)
    }

    /// Restart replaces one set id with another. A click owned by the old set
    /// transfers to the replacement; a manual running click remains manual. A
    /// stopped click is started and claimed by the replacement set.
    pub(crate) fn do_practice_restart(
        &self,
        store: &Store,
        old_set_id: i64,
        new_set_id: i64,
        bpm: f64,
    ) -> (MetroState, Result<(), String>) {
        let before = self.snapshot();
        let (_, result) = self.do_ensure_running(store, Some(bpm));
        if result.is_ok() {
            let mut inner = self.lock();
            if !before.running || before.owner == Some(MetroOwner::Practice { set_id: old_set_id })
            {
                inner.state.owner = Some(MetroOwner::Practice { set_id: new_set_id });
            }
        }
        (self.snapshot(), result)
    }

    /// Pause only a click owned by this exact set. Ownership remains associated
    /// while stopped so a matching resume can restart it; manual ownership is a
    /// strict no-op.
    pub(crate) fn do_practice_pause(&self, set_id: i64) -> MetroState {
        let mut inner = self.lock();
        if inner.state.owner == Some(MetroOwner::Practice { set_id }) && inner.state.running {
            inner.handle = None;
            inner.guard = None;
            inner.state.running = false;
        }
        inner.state.clone()
    }

    /// Resume only when this set still owns the click. A manual command issued
    /// during the pause changes ownership and therefore wins.
    pub(crate) fn do_practice_resume(
        &self,
        store: &Store,
        set_id: i64,
        bpm: f64,
    ) -> (MetroState, Result<(), String>) {
        if self.snapshot().owner != Some(MetroOwner::Practice { set_id }) {
            return (self.snapshot(), Ok(()));
        }
        self.do_ensure_running(store, Some(bpm))
    }

    /// Apply a ladder/adjustment retune without stealing manual ownership. A
    /// delayed command from an older practice-owned set is rejected.
    pub(crate) fn do_practice_retune(
        &self,
        store: &Store,
        set_id: i64,
        bpm: f64,
    ) -> (MetroState, Result<(), String>) {
        if let Some(MetroOwner::Practice { set_id: owner }) = self.snapshot().owner {
            if owner != set_id {
                return (
                    self.snapshot(),
                    Err("practice metronome ownership changed".into()),
                );
            }
        }
        self.do_set(store, Some(bpm), None, None, None, None, None, None)
    }

    /// Close only stops a click owned by the closing set, then releases that
    /// association. A manual click continues uninterrupted.
    pub(crate) fn do_practice_close(&self, set_id: i64) -> MetroState {
        let mut inner = self.lock();
        if inner.state.owner == Some(MetroOwner::Practice { set_id }) {
            inner.handle = None;
            inner.guard = None;
            inner.state.running = false;
            inner.state.owner = None;
        }
        inner.state.clone()
    }

    /// Safety ignores normal ownership and leaves no automatic resume lease.
    pub(crate) fn do_safety_stop(&self) -> MetroState {
        let mut inner = self.lock();
        inner.handle = None;
        inner.guard = None;
        inner.state.running = false;
        inner.state.owner = None;
        inner.state.clone()
    }

    /// Core of `metro_set`: validate + apply the settings, live-apply to a running
    /// engine (gain/pattern lock-free; sound via restart), sync boost, and persist.
    /// Returns the state to emit plus the outcome. Persist happens here (inside the
    /// blocking section) so the six SQLite writes never run on the UI thread.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn do_set(
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
                        // OLD sound, so roll the sound field back (the other,
                        // lock-free changes DID apply) so the emitted state matches
                        // reality instead of lying. Those already-applied fields
                        // (bpm/gain/pattern/etc) DID take effect live, so persist
                        // them here too — otherwise the store and the in-memory
                        // state would diverge on a Busy refusal.
                        inner.state.sound = prev_sound;
                        let state = inner.state.clone();
                        drop(inner);
                        persist(store, &state);
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
pub(crate) fn emit(app: &AppHandle, s: &MetroState) {
    if let Err(e) = app.emit("metro://state", s) {
        eprintln!("metronome: failed to emit metro://state: {e}");
    }
}

/// Ensure the metronome is running. Optional `bpm` updates the tempo first.
/// Repeated starts are idempotent; a changed tempo is applied live without an
/// engine restart.
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
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (_, result) = metro.do_ensure_running(&store, bpm);
            if result.is_ok() {
                metro.claim_manual();
            }
            let state = metro.snapshot();
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|e| format!("metro_start task failed: {e}"))?;
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
    let state = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let _ = metro.do_stop();
            metro.claim_manual();
            let state = metro.snapshot();
            emit(&app, &state);
            state
        })
    })
    .await
    .map_err(|e| format!("metro_stop task failed: {e}"))?;
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
        metro.serialized(|| {
            let (_, result) = metro.do_set(
                &store,
                bpm,
                beats_per_bar,
                subdivision,
                accent,
                sound,
                gain,
                boost,
            );
            if result.is_ok() {
                metro.claim_manual();
            }
            let state = metro.snapshot();
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|e| format!("metro_set task failed: {e}"))?;
    result.map(|()| state)
}

/// Practice-owned start/retune used by the rep state machine. Unlike the manual
/// command, a live click retains its prior owner.
#[tauri::command]
pub async fn metro_practice_start(
    set_id: i64,
    bpm: f64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (state, result) = metro.do_practice_start(&store, set_id, bpm);
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|error| format!("metro_practice_start task failed: {error}"))?;
    result.map(|()| state)
}

#[tauri::command]
pub async fn metro_practice_restart(
    old_set_id: i64,
    new_set_id: i64,
    bpm: f64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (state, result) = metro.do_practice_restart(&store, old_set_id, new_set_id, bpm);
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|error| format!("metro_practice_restart task failed: {error}"))?;
    result.map(|()| state)
}

#[tauri::command]
pub async fn metro_practice_pause(
    set_id: i64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let state = metro.do_practice_pause(set_id);
            emit(&app, &state);
            state
        })
    })
    .await
    .map_err(|error| format!("metro_practice_pause task failed: {error}"))
}

#[tauri::command]
pub async fn metro_practice_resume(
    set_id: i64,
    bpm: f64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (state, result) = metro.do_practice_resume(&store, set_id, bpm);
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|error| format!("metro_practice_resume task failed: {error}"))?;
    result.map(|()| state)
}

#[tauri::command]
pub async fn metro_practice_retune(
    set_id: i64,
    bpm: f64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
    store: State<'_, Arc<Store>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    let store = Arc::clone(&store);
    let (state, result) = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (state, result) = metro.do_practice_retune(&store, set_id, bpm);
            emit(&app, &state);
            (state, result)
        })
    })
    .await
    .map_err(|error| format!("metro_practice_retune task failed: {error}"))?;
    result.map(|()| state)
}

#[tauri::command]
pub async fn metro_practice_close(
    set_id: i64,
    app: AppHandle,
    metro: State<'_, Arc<Metronome>>,
) -> Result<MetroState, String> {
    let metro = Arc::clone(&metro);
    tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let state = metro.do_practice_close(set_id);
            emit(&app, &state);
            state
        })
    })
    .await
    .map_err(|error| format!("metro_practice_close task failed: {error}"))
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
    use std::sync::{mpsc, Mutex as StdMutex};
    use std::time::Duration;

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

        assert!(
            result.is_err(),
            "start must fail when the engine can't start"
        );
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
        assert!(
            metro.lock().handle.is_none(),
            "no live engine after failure"
        );
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
        let (state, result) = metro.do_set(
            &store,
            None,
            None,
            None,
            None,
            Some("cowbell".into()),
            None,
            None,
        );

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
        let (state, result) = metro.do_set(
            &store,
            Some(140.0),
            None,
            None,
            None,
            Some("cowbell".into()),
            None,
            None,
        );

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
        // Persist was skipped for sound, so the store must NOT have the new sound.
        assert_ne!(
            store.get_setting("metronome.sound").unwrap().as_deref(),
            Some("cowbell"),
            "the refused sound must not have been persisted"
        );
        // But the lock-free bpm change WAS applied live, so it must have been
        // persisted too — otherwise the store and in-memory state diverge.
        assert_eq!(
            state.bpm, 140.0,
            "bpm was applied live despite the Busy refusal"
        );
        assert_eq!(
            store.get_setting("metronome.bpm").unwrap().as_deref(),
            Some("140"),
            "the applied bpm must be persisted even on a Busy refusal"
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
        let (state, result) = metro.do_set(
            &store,
            None,
            None,
            None,
            None,
            Some("cowbell".into()),
            None,
            None,
        );

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
        assert!(
            metro.lock().handle.is_some(),
            "live engine handle installed"
        );
    }

    #[test]
    fn ensure_running_starts_once_then_live_retunes_without_restart() {
        let starts = Arc::new(StdMutex::new(0u32));
        let recorded_starts = starts.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            move |_cfg| {
                *recorded_starts.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        let store = Store::open(":memory:").expect("in-memory store");

        let (started, start_result) = metro.do_ensure_running(&store, Some(96.0));
        assert!(start_result.is_ok());
        assert!(started.running);
        assert_eq!(started.bpm, 96.0);
        assert_eq!(
            *starts.lock().unwrap(),
            1,
            "stopped state starts one engine"
        );
        assert_eq!(
            store.get_setting("metronome.bpm").unwrap().as_deref(),
            Some("96"),
            "an explicit stopped-state start persists the authoritative tempo"
        );
        assert_eq!(
            load_state(&store).bpm,
            96.0,
            "relaunch restores the tempo that actually started"
        );

        let (retuned, retune_result) = metro.do_ensure_running(&store, Some(72.0));
        assert!(retune_result.is_ok());
        assert_eq!(retuned.bpm, 72.0);
        assert_eq!(*starts.lock().unwrap(), 1, "live retune keeps the engine");
        assert_eq!(
            store.get_setting("metronome.bpm").unwrap().as_deref(),
            Some("72"),
            "live retune persists the authoritative tempo"
        );

        let (_, same_result) = metro.do_ensure_running(&store, Some(72.0));
        let (_, resume_result) = metro.do_ensure_running(&store, None);
        assert!(same_result.is_ok());
        assert!(resume_result.is_ok());
        assert_eq!(
            *starts.lock().unwrap(),
            1,
            "same-tempo and bare starts are true no-ops while running"
        );
    }

    #[test]
    fn ownership_coordinates_manual_and_practice_lifecycle_without_stealing_clicks() {
        let starts = Arc::new(StdMutex::new(0u32));
        let recorded_starts = starts.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            move |_cfg| {
                *recorded_starts.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        let store = Store::open(":memory:").expect("in-memory store");

        // A manual start owns the running click. Opening a set may retune it but
        // must not steal lifecycle ownership, so pause/close are no-ops.
        metro.serialized(|| {
            let (_, result) = metro.do_ensure_running(&store, Some(90.0));
            assert!(result.is_ok());
            metro.claim_manual();
        });
        let (manual_retune, result) =
            metro.serialized(|| metro.do_practice_start(&store, 41, 72.0));
        assert!(result.is_ok());
        assert_eq!(manual_retune.owner, Some(MetroOwner::Manual));
        assert_eq!(manual_retune.bpm, 72.0);
        assert!(metro.serialized(|| metro.do_practice_pause(41)).running);
        assert!(metro.serialized(|| metro.do_practice_close(41)).running);

        // A fresh stopped-state practice start claims the set. Pause retains the
        // association, only the matching set can resume, and restart transfers
        // the lease atomically to the replacement set id.
        metro.serialized(|| {
            metro.do_stop();
            metro.claim_manual();
        });
        let (owned, result) = metro.serialized(|| metro.do_practice_start(&store, 41, 64.0));
        assert!(result.is_ok());
        assert_eq!(owned.owner, Some(MetroOwner::Practice { set_id: 41 }));
        let paused = metro.serialized(|| metro.do_practice_pause(41));
        assert!(!paused.running);
        assert_eq!(paused.owner, Some(MetroOwner::Practice { set_id: 41 }));

        let (wrong_resume, result) =
            metro.serialized(|| metro.do_practice_resume(&store, 99, 68.0));
        assert!(result.is_ok());
        assert!(!wrong_resume.running);
        let (resumed, result) = metro.serialized(|| metro.do_practice_resume(&store, 41, 68.0));
        assert!(result.is_ok());
        assert!(resumed.running);
        assert_eq!(resumed.bpm, 68.0);
        assert_eq!(
            store.get_setting("metronome.bpm").unwrap().as_deref(),
            Some("68")
        );

        let (restarted, result) =
            metro.serialized(|| metro.do_practice_restart(&store, 41, 42, 60.0));
        assert!(result.is_ok());
        assert_eq!(restarted.owner, Some(MetroOwner::Practice { set_id: 42 }));
        assert!(metro.serialized(|| metro.do_practice_pause(41)).running);
        let closed = metro.serialized(|| metro.do_practice_close(42));
        assert!(!closed.running);
        assert_eq!(closed.owner, None);

        // Manual intervention revokes the practice lease; safety stops every
        // owner and deliberately leaves no automatic-resume association.
        let (owned_again, result) = metro.serialized(|| metro.do_practice_start(&store, 50, 80.0));
        assert!(result.is_ok());
        assert_eq!(owned_again.owner, Some(MetroOwner::Practice { set_id: 50 }));
        metro.serialized(|| {
            let (_, result) = metro.do_set(&store, Some(82.0), None, None, None, None, None, None);
            assert!(result.is_ok());
            metro.claim_manual();
        });
        assert_eq!(metro.snapshot().owner, Some(MetroOwner::Manual));
        assert!(metro.serialized(|| metro.do_practice_close(50)).running);
        let safe = metro.serialized(|| metro.do_safety_stop());
        assert!(!safe.running);
        assert_eq!(safe.owner, None);
        assert_eq!(
            *starts.lock().unwrap(),
            4,
            "one manual and three practice starts"
        );
    }

    #[test]
    fn relaunch_restores_a_silent_practice_lease_and_only_explicit_resume_starts_audio() {
        let starts = Arc::new(StdMutex::new(0u32));
        let recorded_starts = starts.clone();
        let (boost_seam, _vol) = recording_boost();
        let metro = Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            move |_cfg| {
                *recorded_starts.lock().unwrap() += 1;
                Ok(EngineHandle::test_handle(48_000, 0))
            },
            boost_seam,
        );
        let store = Store::open(":memory:").unwrap();

        let restored = metro.serialized(|| metro.restore_practice_owner(88));
        assert!(!restored.running, "relaunch never starts audio by itself");
        assert_eq!(restored.owner, Some(MetroOwner::Practice { set_id: 88 }));
        assert_eq!(*starts.lock().unwrap(), 0);

        let (resumed, result) =
            metro.serialized(|| metro.do_practice_resume(&store, 88, 76.0));
        assert!(result.is_ok());
        assert!(resumed.running);
        assert_eq!(resumed.bpm, 76.0);
        assert_eq!(resumed.owner, Some(MetroOwner::Practice { set_id: 88 }));
        assert_eq!(*starts.lock().unwrap(), 1);
    }

    #[test]
    fn ownership_transition_is_ordered_with_the_complete_command_boundary() {
        let (boost_seam, _vol) = recording_boost();
        let metro = Arc::new(Metronome::with_seams(
            sounds_with(&["woodblock"]),
            MetroState::default(),
            85,
            |_cfg| Ok(EngineHandle::test_handle(48_000, 0)),
            boost_seam,
        ));
        let store = Arc::new(Store::open(":memory:").expect("in-memory store"));
        metro.serialized(|| {
            let (_, result) = metro.do_practice_start(&store, 7, 72.0);
            assert!(result.is_ok());
        });

        let (paused_tx, paused_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (manual_done_tx, manual_done_rx) = mpsc::channel();
        let pause_metro = metro.clone();
        let pause_thread = std::thread::spawn(move || {
            pause_metro.serialized(|| {
                let state = pause_metro.do_practice_pause(7);
                paused_tx.send(state).unwrap();
                release_rx.recv().unwrap();
            });
        });
        let paused = paused_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(!paused.running);
        assert_eq!(paused.owner, Some(MetroOwner::Practice { set_id: 7 }));

        let manual_metro = metro.clone();
        let manual_store = store.clone();
        let manual_thread = std::thread::spawn(move || {
            manual_metro.serialized(|| {
                let (_, result) = manual_metro.do_ensure_running(&manual_store, Some(96.0));
                assert!(result.is_ok());
                let state = manual_metro.claim_manual();
                manual_done_tx.send(state).unwrap();
            });
        });
        assert!(
            manual_done_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "manual ownership cannot overtake an in-flight practice publication"
        );
        release_tx.send(()).unwrap();
        let final_state = manual_done_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        pause_thread.join().unwrap();
        manual_thread.join().unwrap();

        assert!(final_state.running);
        assert_eq!(final_state.bpm, 96.0);
        assert_eq!(final_state.owner, Some(MetroOwner::Manual));
        assert_eq!(metro.snapshot(), final_state);
    }

    #[test]
    fn app_command_boundary_orders_mutation_persistence_and_publication() {
        let initial = MetroState {
            running: true,
            ..MetroState::default()
        };
        let (boost_seam, _vol) = recording_boost();
        let metro = Arc::new(Metronome::with_seams(
            sounds_with(&["woodblock"]),
            initial,
            85,
            |_cfg| Ok(EngineHandle::test_handle(48_000, 0)),
            boost_seam,
        ));
        let store = Arc::new(Store::open(":memory:").expect("in-memory store"));
        let (first_ready_tx, first_ready_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (second_done_tx, second_done_rx) = mpsc::channel();

        let first_metro = Arc::clone(&metro);
        let first_store = Arc::clone(&store);
        let first = std::thread::spawn(move || {
            first_metro.serialized(|| {
                let _ = first_metro.do_ensure_running(&first_store, Some(60.0));
                first_ready_tx
                    .send(first_metro.snapshot())
                    .expect("publish first state");
                release_rx.recv().expect("release first command");
            });
        });

        let first_state = first_ready_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first command reached publication boundary");
        assert_eq!(first_state.bpm, 60.0);

        let second_metro = Arc::clone(&metro);
        let second_store = Arc::clone(&store);
        let second = std::thread::spawn(move || {
            second_metro.serialized(|| {
                let _ = second_metro.do_set(
                    &second_store,
                    Some(80.0),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                second_done_tx
                    .send(second_metro.snapshot())
                    .expect("publish second state");
            });
        });

        assert!(
            second_done_rx
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "the newer command cannot overtake an earlier publication"
        );
        release_tx.send(()).expect("release first command");
        let second_state = second_done_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second command completes after release");
        first.join().expect("first command thread");
        second.join().expect("second command thread");

        assert_eq!(second_state.bpm, 80.0);
        assert_eq!(metro.snapshot().bpm, 80.0);
        assert_eq!(
            store.get_setting("metronome.bpm").unwrap().as_deref(),
            Some("80"),
            "the last published command is also the last persisted command"
        );
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
