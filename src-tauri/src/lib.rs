pub mod audio;
pub mod intent;
mod keys;
mod metronome;
pub mod stt;
mod store;
mod sysvol;
pub mod tts;
mod voice_loop;

use std::path::PathBuf;
use std::sync::Arc;

use metronome::Metronome;
use stt::SttConfig;
use store::Store;
use tauri::path::BaseDirectory;
use tauri::{Manager, State, WindowEvent};
use voice_loop::{VoiceLoop, VoiceStatus};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Read a persisted setting. Returns `null` when the key has never been set.
#[tauri::command]
fn get_setting(key: String, store: State<'_, Arc<Store>>) -> Result<Option<String>, String> {
    store.get_setting(&key).map_err(|e| e.to_string())
}

/// Persist a setting value (insert or overwrite).
#[tauri::command]
fn set_setting(key: String, value: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.set_setting(&key, &value).map_err(|e| e.to_string())
}

/// Resolve the click-assets directory, working in BOTH dev and the bundled `.app`.
///
/// In a bundled app the WAVs are copied into the app's `Resources` dir by the
/// `bundle.resources` glob, so `BaseDirectory::Resource` finds them. In dev
/// (`npm run tauri dev`) Tauri does not stage resources, so that path won't
/// exist; we fall back to the crate's compile-time `assets/clicks` dir (which is
/// exactly where the source WAVs live). Whichever directory actually exists wins.
fn resolve_clicks_dir(app: &tauri::App) -> PathBuf {
    if let Ok(p) = app.path().resolve("assets/clicks", BaseDirectory::Resource) {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/clicks")
}

/// Resolve the vendored `hear` STT binary, working in BOTH dev and the bundled
/// `.app` (same dev/Resource strategy as [`resolve_clicks_dir`]). In a bundle the
/// `bundle.resources` glob stages it into `Resources/`; in dev it lives at
/// `vendor/bin/hear` beside the crate.
fn resolve_hear_bin(app: &tauri::App) -> PathBuf {
    for candidate in ["hear", "vendor/bin/hear", "_up_/vendor/bin/hear"] {
        if let Ok(p) = app.path().resolve(candidate, BaseDirectory::Resource) {
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/bin/hear")
}

/// Build the STT config, honoring a fake-`hear` test seam. Setting
/// `CODAKILLER_HEAR_BIN` (and optionally `CODAKILLER_HEAR_ARGS`) points the
/// supervisor at a scripted stand-in for end-to-end verification without a mic.
fn resolve_stt_config(app: &tauri::App) -> SttConfig {
    if let Ok(bin) = std::env::var("CODAKILLER_HEAR_BIN") {
        let mut cfg = SttConfig::hear(PathBuf::from(bin));
        cfg.args = std::env::var("CODAKILLER_HEAR_ARGS")
            .ok()
            .map(|s| s.split_whitespace().map(String::from).collect())
            .unwrap_or_default();
        cfg.use_stdbuf = false; // the fake is a plain script, not the real binary
        return cfg;
    }
    SttConfig::hear(resolve_hear_bin(app))
}

/// Mute (`true`) or unmute the mic. Gates STT and blocks any action while muted.
#[tauri::command]
fn voice_mute(muted: bool, voice: State<'_, Arc<VoiceLoop>>) {
    voice.set_muted(muted);
}

/// Current mic status (muted / down reason) for the top-bar glyph.
#[tauri::command]
fn voice_state(voice: State<'_, Arc<VoiceLoop>>) -> VoiceStatus {
    voice.state()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // DB lives under Tauri's per-app data dir; parent dirs may not exist
            // on first launch, so create them before opening.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Store::open(dir.join("codakiller.db"))?;

            // Load click sounds (dev + bundled paths). A load failure is
            // non-fatal: the metronome then runs silent rather than crashing.
            let clicks_dir = resolve_clicks_dir(app);
            let sounds = audio::mixer::load_clicks(&clicks_dir).unwrap_or_else(|e| {
                eprintln!("metronome: failed to load clicks from {clicks_dir:?}: {e}");
                Default::default()
            });
            let state = metronome::load_state(&store);
            let boost_level = metronome::load_boost_level(&store);
            let wake_word = store
                .get_setting("voice.wake_word")
                .ok()
                .flatten()
                .filter(|w| !w.trim().is_empty());
            // Managed behind `Arc` so the async commands can clone a `'static`
            // handle into `spawn_blocking` (the blocking work runs off the main
            // thread). The voice loop shares these same Arcs.
            let metro = Arc::new(Metronome::new(sounds, state, boost_level));
            let store = Arc::new(store);
            app.manage(metro.clone());
            app.manage(store.clone());

            // Start the end-to-end voice loop (STT → intent → metronome + spoken
            // confirmation). Managed so `voice_mute`/`voice_state` reach it and so
            // it is torn down on exit. It gates itself; a missing `hear` binary or
            // disabled Dictation surfaces as a `voice://status` down event, never a
            // crash.
            let stt_config = resolve_stt_config(app);
            let voice = VoiceLoop::start(&app.handle().clone(), metro, store, stt_config, wake_word);
            app.manage(voice);
            Ok(())
        })
        // Restore the system volume on window close: a boosted volume must never
        // outlive the app. (BoostGuard::Drop is the in-process backstop; a hard
        // `kill -9` is the one path we cannot cover — see sysvol docs.)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(voice) = window.try_state::<Arc<VoiceLoop>>() {
                    voice.shutdown();
                }
                if let Some(metro) = window.try_state::<Arc<Metronome>>() {
                    metro.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_setting,
            set_setting,
            metronome::metro_start,
            metronome::metro_stop,
            metronome::metro_set,
            metronome::metro_state,
            voice_mute,
            voice_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Restore the system volume on app exit too. `on_window_event`'s
        // `CloseRequested` covers the red-button / window close, but a macOS
        // Cmd-Q terminates via `RunEvent::ExitRequested` WITHOUT firing a
        // per-window close — and `process::exit` there would skip `BoostGuard`'s
        // `Drop`. Handling `ExitRequested` closes that gap so a graceful quit
        // never strands the Mac at boost volume. (A hard `kill -9` is still the
        // one path we cannot cover — see `sysvol` docs.)
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(voice) = app_handle.try_state::<Arc<VoiceLoop>>() {
                    voice.shutdown();
                }
                if let Some(metro) = app_handle.try_state::<Arc<Metronome>>() {
                    metro.shutdown();
                }
            }
        });
}
