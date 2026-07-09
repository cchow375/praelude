mod audio;
mod store;

use store::Store;
use tauri::{Manager, State};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Read a persisted setting. Returns `null` when the key has never been set.
#[tauri::command]
fn get_setting(key: String, store: State<'_, Store>) -> Result<Option<String>, String> {
    store.get_setting(&key).map_err(|e| e.to_string())
}

/// Persist a setting value (insert or overwrite).
#[tauri::command]
fn set_setting(key: String, value: String, store: State<'_, Store>) -> Result<(), String> {
    store.set_setting(&key, &value).map_err(|e| e.to_string())
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
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_setting, set_setting])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
