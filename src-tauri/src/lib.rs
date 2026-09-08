mod anomalies;
pub mod audio;
mod brain;
mod date;
mod dynamics;
pub mod imslp;
pub mod intent;
mod keys;
pub mod ledger;
mod metrics;
mod metronome;
mod pieces;
mod planner;
mod platform;
pub mod protocol;
mod recovery;
mod references;
mod rep;
mod score;
mod sessions;
mod settings;
mod store;
pub mod stt;
mod sysvol;
pub mod tts;
mod universe;
pub mod vault;
mod voice_loop;

use std::path::PathBuf;
use std::sync::Arc;

use dynamics::DynamicsMeter;
use metronome::Metronome;
use rep::{RepEngine, RepVerdict};
use sessions::{SessionService, StateEmitter};
use store::model::{
    BlockHistory, BlockPatch, CheckOutcome, DailyWorkCreate, DailyWorkPatch, DemotionOverride,
    ExportResult, Goal, GoalCreate, GoalPatch, Intake, MutationReceipt, PanelLayout, PausedSetRow,
    PieceDetail, PieceFieldPatch, PieceFolder, PieceMovement, PieceMovementCreate,
    PieceMovementPatch, PieceSummary, ProgressSummary, RecoveryActionRequest, Region, RegionCreate,
    RegionDeleteMode, RegionPatch, Rep, RepOpenArgs, RepPatch, RepSnapshot, RetentionCheckView,
    RetentionResult, SessionView, SetFocusContextInput, TutorialClip, TutorialClipCreate,
    TutorialClipPatch, TutorialVideo, TutorialVideoPatch, TutorialVideoUpsert,
};
use store::{
    RepReplayInsert, RepReplayMeta, RepReplaySaveInput, Store, WarmupRoutine,
    WarmupRoutineSaveInput, WarmupSystemPiece,
};
use stt::SttConfig;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use voice_loop::{VoiceLoop, VoiceStatus};

/// The production [`StateEmitter`]: forwards `rep://state` / `session://event`
/// through the Tauri `AppHandle`. Best-effort — a failed emit is logged.
struct AppEmitter(AppHandle);
impl StateEmitter for AppEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Err(e) = self.0.emit(event, payload) {
            eprintln!("app: failed to emit {event}: {e}");
        }
    }
}

/// Read a persisted setting. Returns `null` when the key has never been set.
#[tauri::command]
fn get_setting(key: String, store: State<'_, Arc<Store>>) -> Result<Option<String>, String> {
    if key != "theme" {
        return Err("Use the typed settings boundary for this setting.".into());
    }
    store.get_setting(&key).map_err(|e| e.to_string())
}

/// Persist a setting value (insert or overwrite).
#[tauri::command]
fn set_setting(key: String, value: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    if key != "theme" || !matches!(value.as_str(), "auto" | "dark" | "light") {
        return Err("Use the typed settings boundary for this setting.".into());
    }
    store.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn variant_library_get(store: State<'_, Arc<Store>>) -> Result<store::VariantLibrary, String> {
    store.variant_library_get()
}

#[tauri::command]
fn variant_library_save(
    library: store::VariantLibrary,
    store: State<'_, Arc<Store>>,
) -> Result<store::VariantLibrary, String> {
    store.variant_library_save(library)
}

#[tauri::command]
fn settings_snapshot(store: State<'_, Arc<Store>>) -> settings::SettingsSnapshot {
    settings::snapshot(&store)
}

#[tauri::command]
fn settings_update(
    patch: settings::SettingsPatch,
    store: State<'_, Arc<Store>>,
    voice: State<'_, Arc<VoiceLoop>>,
) -> Result<settings::SettingsSnapshot, String> {
    let next = settings::update(&store, patch)?;
    // Pushed from the saved snapshot rather than from the patch: the live loop
    // then agrees with the store no matter which write got us here, and the very
    // next command he speaks proves the toggle worked. Waiting for a relaunch
    // would leave him testing a mute he cannot hear take effect.
    voice.set_speech_muted(!next.speak_acks);
    voice.set_settle_ms(next.stt_settle_ms);
    Ok(next)
}

#[tauri::command]
fn api_key_save(provider: keys::ApiKeyProvider, key: String) -> Result<keys::ApiKeyStatus, String> {
    keys::save_api_key(provider, &key)
}

#[tauri::command]
fn api_key_clear(provider: keys::ApiKeyProvider) -> Result<keys::ApiKeyStatus, String> {
    keys::clear_api_key(provider)
}

/// Key-presence only (never values) for the explicit measure-mapping dialog.
/// Lets the UI explain the Claude-primary/Gemini-fallback state before any
/// score page is prepared for transfer.
#[tauri::command]
fn measure_mapping_status() -> Vec<keys::ApiKeyStatus> {
    vec![
        keys::api_key_status(keys::ApiKeyProvider::Claude),
        keys::api_key_status(keys::ApiKeyProvider::Gemini),
    ]
}

#[tauri::command]
fn reference_open(
    piece_id: i64,
    provider: references::ReferenceProvider,
    store: State<'_, Arc<Store>>,
) -> Result<references::ReferenceOpenResult, String> {
    references::open_reference(&store, piece_id, provider)
}

/// Run one blocking IMSLP call on the blocking pool.
///
/// WHY: Tauri executes a non-`async` command on the **main thread**, which on
/// macOS is the WKWebView's thread — a blocking network call there freezes the
/// whole UI until it returns (up to the client's 15s timeout). Every `imslp_*`
/// command is therefore `async` and hands its blocking work to this helper, so
/// the IPC thread is free and the panel can keep painting its "Searching…"
/// state. Do not "simplify" these back into sync commands.
async fn imslp_offthread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The IMSLP request could not be completed.".to_string())?
}

/// Search IMSLP for a work by title/composer. Returns up to 20 hits; an empty
/// list means "no results," not an error.
#[tauri::command]
async fn imslp_search(query: String) -> Result<Vec<imslp::WorkHit>, String> {
    imslp_offthread(move || imslp::ImslpClient::new().search(&query)).await
}

/// List the downloadable editions of an IMSLP work page. A work with no score
/// files returns an empty list (audio-only / misfiled), which the picker shows
/// as "no scores found" rather than treating as an error.
#[tauri::command]
async fn imslp_editions(page_title: String) -> Result<Vec<imslp::Edition>, String> {
    imslp_offthread(move || imslp::ImslpClient::new().editions(&page_title)).await
}

/// Resolve one edition file's direct URL (via `imageinfo`) and open it in the
/// user's system browser so THEY can clear IMSLP's one-time CAPTCHA and let the
/// browser download the PDF. The app never fetches the CAPTCHA-gated bytes
/// itself. Returns the resolved [`imslp::FileInfo`] so the UI can show size/mime.
#[tauri::command]
async fn imslp_open_download(file_name: String) -> Result<imslp::FileInfo, String> {
    // Both halves block (a network round trip, then waiting on `open` to exit),
    // so the whole body runs off the main thread — see `imslp_offthread`.
    imslp_offthread(move || {
        let info = imslp::ImslpClient::new().file_url(&file_name)?;
        // Defense in depth: only ever hand an https URL to the system browser.
        if !info.url.starts_with("https://") {
            return Err("IMSLP returned a non-https download URL; refusing to open it.".into());
        }
        platform::open_https(&info.url)?;
        Ok(info)
    })
    .await
}

/// Open an `https` URL in the user's system browser. Shared by the paste-URL
/// score-download fallback; refuses anything that is not `https`.
fn open_in_browser(url: &str) -> Result<(), String> {
    platform::open_https(url)
}

/// Import a browser-downloaded score PDF into a piece's vault `score/` folder.
/// Validates + COPIES the file (never moves the user's download). Returns the
/// piece folder path; the frontend then calls `pieces_scan` so it appears.
#[tauri::command]
fn piece_import_pdf(
    folder_name: String,
    source_path: String,
    store: State<'_, Arc<Store>>,
) -> Result<String, String> {
    let dir = pieces_dir(&store);
    pieces::import_pdf(&dir, &folder_name, std::path::Path::new(&source_path))
}

/// Reversibly archive or restore one piece. No files or practice history move.
#[tauri::command]
fn piece_archive_set(
    id: i64,
    archived: bool,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<PieceSummary>, String> {
    if !store
        .set_piece_archived(id, archived)
        .map_err(|error| error.to_string())?
    {
        return Err(format!("piece {id} not found"));
    }
    store
        .list_pieces_including_archived()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_folders_list(store: State<'_, Arc<Store>>) -> Result<Vec<PieceFolder>, String> {
    store.piece_folder_list().map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_folder_create(
    name: String,
    parent_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<PieceFolder, String> {
    store
        .piece_folder_create(&name, parent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_folder_rename(
    id: i64,
    name: String,
    store: State<'_, Arc<Store>>,
) -> Result<PieceFolder, String> {
    store
        .piece_folder_rename(id, &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_folder_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<Vec<PieceFolder>, String> {
    store
        .piece_folder_delete(id)
        .map_err(|error| error.to_string())?;
    store.piece_folder_list().map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_folder_reparent(
    id: i64,
    parent_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<PieceFolder, String> {
    store
        .piece_folder_reparent(id, parent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_move(
    id: i64,
    folder_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<PieceDetail, String> {
    store
        .piece_move(id, folder_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_complete_set(
    id: i64,
    completed: bool,
    store: State<'_, Arc<Store>>,
) -> Result<PieceDetail, String> {
    store
        .set_piece_completed(id, completed)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_create_from_pdf(
    title: String,
    composer: Option<String>,
    source_path: String,
    folder_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<PieceDetail, String> {
    let root = pieces_dir(&store);
    pieces::create_from_pdf(
        &root,
        &store,
        &title,
        composer.as_deref(),
        std::path::Path::new(&source_path),
        folder_id,
    )
}

#[tauri::command]
fn piece_remove(id: i64, store: State<'_, Arc<Store>>) -> Result<Vec<PieceSummary>, String> {
    let root = pieces_dir(&store);
    pieces::remove_to_trash(&root, &store, id)?;
    store
        .list_pieces_including_archived()
        .map_err(|error| error.to_string())
}

/// One regular file in `~/Downloads`, for the import step's arrival poll.
#[derive(serde::Serialize)]
struct DownloadEntry {
    name: String,
    path: String,
    modified_ms: i64,
}

/// List importable files (`.pdf`/`.musicxml`/`.mxl`) currently in `~/Downloads`
/// so the import panel can offer the arriving score. Read-only; a missing or
/// unreadable Downloads folder is an empty list, never an error.
#[tauri::command]
fn downloads_list(app: AppHandle) -> Result<Vec<DownloadEntry>, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|_| "The Downloads folder is unavailable.".to_string())?;
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        let importable = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                ext.eq_ignore_ascii_case("pdf")
                    || ext.eq_ignore_ascii_case("musicxml")
                    || ext.eq_ignore_ascii_case("mxl")
            });
        if !importable {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(DownloadEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            modified_ms,
        });
    }
    Ok(out)
}

/// Open a native macOS file picker for the manual-import fallback, returning the
/// chosen POSIX path (or `None` when the user cancels). Uses `osascript` so it
/// needs no extra plugin dependency.
#[tauri::command]
fn pick_import_file() -> Result<Option<String>, String> {
    platform::pick_pdf_file()
}

/// Open a pasted score-download URL in the system browser (paste-URL fallback
/// for IMSLP parse failures). Refuses anything that is not `https`.
#[tauri::command]
fn piece_open_source_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("Only https links can be opened.".into());
    }
    open_in_browser(url)
}

#[tauri::command]
fn layout_get(store: State<'_, Arc<Store>>) -> Result<Option<PanelLayout>, String> {
    store.layout_get().map_err(|e| e.to_string())
}

#[tauri::command]
fn layout_set(layout: PanelLayout, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.layout_set(&layout).map_err(|e| e.to_string())
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
    let working = std::env::current_dir().unwrap_or_default();
    for candidate in [
        working.join("src-tauri/assets/clicks"),
        working.join("assets/clicks"),
    ] {
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("assets/clicks")
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
    let working = std::env::current_dir().unwrap_or_default();
    for candidate in [
        working.join("vendor/bin/hear"),
        working.join("../vendor/bin/hear"),
    ] {
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("vendor/bin/hear")
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

/// Seed the app-owned Pieces root on first launch. Existing configured roots
/// win unchanged. For a pre-v21 install that relied on the old compiled-in
/// default, infer the common root from its existing piece rows so an upgrade
/// does not abandon that library, without shipping anyone's personal path.
fn initialize_pieces_dir(store: &Store, app_data_dir: &std::path::Path) -> Result<PathBuf, String> {
    if let Some(configured) = store
        .get_setting("vault.pieces_dir")
        .map_err(|error| error.to_string())?
        .filter(|path| !path.trim().is_empty())
    {
        return Ok(PathBuf::from(configured));
    }
    if let Some(inferred) = store
        .infer_legacy_pieces_dir()
        .map_err(|error| error.to_string())?
    {
        store
            .set_setting("vault.pieces_dir", &inferred.to_string_lossy())
            .map_err(|error| error.to_string())?;
        return Ok(inferred);
    }
    let directory = app_data_dir.join("Pieces");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create app Pieces folder: {error}"))?;
    store
        .set_setting("vault.pieces_dir", &directory.to_string_lossy())
        .map_err(|error| error.to_string())?;
    Ok(directory)
}

pub(crate) fn pieces_dir(store: &Store) -> PathBuf {
    store
        .get_setting("vault.pieces_dir")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[cfg(test)]
mod pieces_root_tests {
    use super::*;
    use crate::store::model::ScanPiece;

    #[test]
    fn fresh_install_seeds_an_app_owned_pieces_directory() {
        let app_data = tempfile::tempdir().unwrap();
        let store = Store::open(":memory:").unwrap();
        let root = initialize_pieces_dir(&store, app_data.path()).unwrap();
        assert_eq!(root, app_data.path().join("Pieces"));
        assert!(root.is_dir());
        assert_eq!(pieces_dir(&store), root);
    }

    #[test]
    fn configured_or_inferred_existing_roots_are_preserved() {
        let app_data = tempfile::tempdir().unwrap();
        let configured = tempfile::tempdir().unwrap();
        let store = Store::open(":memory:").unwrap();
        store
            .set_setting("vault.pieces_dir", &configured.path().to_string_lossy())
            .unwrap();
        assert_eq!(
            initialize_pieces_dir(&store, app_data.path()).unwrap(),
            configured.path()
        );

        let legacy_root = tempfile::tempdir().unwrap();
        let piece_folder = legacy_root.path().join("Composer - Piece");
        std::fs::create_dir(&piece_folder).unwrap();
        let legacy = Store::open(":memory:").unwrap();
        legacy
            .upsert_piece(&ScanPiece {
                folder_path: piece_folder.to_string_lossy().into_owned(),
                title: "Piece".into(),
                composer: Some("Composer".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert_eq!(
            initialize_pieces_dir(&legacy, app_data.path()).unwrap(),
            legacy_root.path()
        );
        assert_eq!(pieces_dir(&legacy), legacy_root.path());
    }
}

/// Ingest the vault into the store: scan (read-only) → upsert each piece →
/// return the refreshed list. Shared by the `pieces_scan` command and the
/// startup background scan.
fn ingest_pieces(store: &Store) -> Result<Vec<PieceSummary>, String> {
    let dir = pieces_dir(store);
    for piece in vault::scan_pieces(&dir) {
        store.upsert_piece(&piece).map_err(|e| e.to_string())?;
    }
    store.list_pieces().map_err(|e| e.to_string())
}

/// Rescan the vault dir, upsert every piece found, and return all pieces.
#[tauri::command]
fn pieces_scan(store: State<'_, Arc<Store>>) -> Result<Vec<PieceSummary>, String> {
    ingest_pieces(&store)
}

/// All known pieces, without rescanning the vault.
#[tauri::command]
fn pieces_list(
    include_archived: Option<bool>,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<PieceSummary>, String> {
    if include_archived.unwrap_or(false) {
        store
            .list_pieces_including_archived()
            .map_err(|error| error.to_string())
    } else {
        store.list_pieces().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn piece_movement_list(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<PieceMovement>, String> {
    store
        .piece_movement_list(piece_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_movement_create(
    input: PieceMovementCreate,
    store: State<'_, Arc<Store>>,
) -> Result<PieceMovement, String> {
    store
        .piece_movement_create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_movement_update(
    id: i64,
    patch: PieceMovementPatch,
    store: State<'_, Arc<Store>>,
) -> Result<PieceMovement, String> {
    store
        .piece_movement_update(id, patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn piece_movement_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    if store
        .piece_movement_delete(id)
        .map_err(|error| error.to_string())?
    {
        Ok(())
    } else {
        Err(format!("movement {id} not found"))
    }
}

/// Full detail for one piece.
#[tauri::command]
fn piece_get(id: i64, store: State<'_, Arc<Store>>) -> Result<PieceDetail, String> {
    store
        .get_piece(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("piece {id} not found"))
}

/// The most a score goals banner may hold. Mirrors the `piece.banner_text`
/// CHECK constraint added by schema v14 (A1).
pub const BANNER_MAX_CHARS: usize = 140;

/// Normalize + bound one banner edit BEFORE it can reach SQLite. Blank text is
/// a clear, not a stored empty banner; anything over [`BANNER_MAX_CHARS`] is
/// rejected here with a message the user can act on, so the column's CHECK
/// constraint is never the thing that fails an edit.
fn validate_banner_text(text: Option<String>) -> Result<Option<String>, String> {
    let Some(text) = text else { return Ok(None) };
    if text.trim().is_empty() {
        return Ok(None);
    }
    let length = text.chars().count();
    if length > BANNER_MAX_CHARS {
        return Err(format!(
            "A score banner is limited to {BANNER_MAX_CHARS} characters (that one is {length})."
        ));
    }
    Ok(Some(text))
}

/// Pin (or, with `text: None`, clear) the one goal sentence shown over a
/// piece's score. Returns the piece's refreshed detail.
#[tauri::command]
fn piece_banner_set(
    piece_id: i64,
    text: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<PieceDetail, String> {
    let text = validate_banner_text(text)?;
    store
        .piece_banner_set(piece_id, text.as_deref())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("piece {piece_id} not found"))
}

#[cfg(test)]
mod banner_text_tests {
    use super::*;

    #[test]
    fn a_banner_of_exactly_the_limit_is_accepted() {
        let at_limit = "x".repeat(BANNER_MAX_CHARS);
        assert_eq!(
            validate_banner_text(Some(at_limit.clone())),
            Ok(Some(at_limit))
        );
    }

    #[test]
    fn a_141_character_banner_is_rejected_before_sqlite_sees_it() {
        let too_long = "x".repeat(BANNER_MAX_CHARS + 1);
        let error = validate_banner_text(Some(too_long)).unwrap_err();
        assert!(
            error.contains("140") && error.contains("141"),
            "the rejection must name the limit and the overage: {error}"
        );
    }

    #[test]
    fn the_limit_counts_characters_not_bytes() {
        // 140 multi-byte characters is 420 bytes but a legal banner; a
        // byte-length check would wrongly reject it.
        let accented = "é".repeat(BANNER_MAX_CHARS);
        assert!(validate_banner_text(Some(accented)).is_ok());
        assert!(validate_banner_text(Some("é".repeat(BANNER_MAX_CHARS + 1))).is_err());
    }

    #[test]
    fn none_and_blank_text_both_mean_clear_the_banner() {
        assert_eq!(validate_banner_text(None), Ok(None));
        assert_eq!(validate_banner_text(Some("   ".into())), Ok(None));
        assert_eq!(validate_banner_text(Some(String::new())), Ok(None));
    }
}

/// Every real PDF edition directly inside this piece's `score/` folder or
/// piece root. Edition ids are stable piece-relative paths, never arbitrary
/// filesystem paths supplied by the frontend.
///
/// `async` on purpose: a plain `fn` command runs on the main thread, so this
/// directory scan used to stall the UI at exactly the moment the user asked to
/// open a score.
#[tauri::command]
async fn score_pdf_editions(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<score::PdfEdition>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || score::pdf_editions(&store, piece_id))
        .await
        .map_err(|e| format!("PDF edition scan worker failed: {e}"))?
}

/// Choose one of the securely re-discovered editions as this piece's default.
/// Off the main thread for the same reason as `score_pdf_editions`: selecting
/// re-runs the discovery scan before it writes the preference.
#[tauri::command]
async fn score_pdf_select(
    piece_id: i64,
    edition_id: String,
    store: State<'_, Arc<Store>>,
) -> Result<score::PdfEdition, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || score::select_pdf(&store, piece_id, &edition_id))
        .await
        .map_err(|e| format!("PDF edition select worker failed: {e}"))?
}

/// Return the selected edition's bytes over Tauri's raw binary response path.
/// The filesystem read runs off the main thread because real editions reach
/// tens of megabytes.
#[tauri::command]
async fn score_pdf_bytes(
    piece_id: i64,
    edition_id: String,
    store: State<'_, Arc<Store>>,
) -> Result<tauri::ipc::Response, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        score::pdf_bytes(&store, piece_id, &edition_id).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| format!("PDF read worker failed: {e}"))?
}

/// A screen-resolution JPEG of one page of one edition.
///
/// This is the fast path for scanned scores: instead of rasterizing a page whose
/// single image is 38 megapixels, the Rust side decodes that image straight to
/// the size the screen can show and caches the result. An EMPTY response means
/// "this page is not a single-image scan" and the webview renders it with PDF.js
/// as before — not an error.
///
/// Off the async runtime because a cold generation is tens to hundreds of
/// milliseconds of pure CPU.
#[tauri::command]
async fn score_page_image(
    piece_id: i64,
    edition_id: String,
    page: i64,
    target_long_edge: u32,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<tauri::ipc::Response, String> {
    let store = store.inner().clone();
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        score::page_image_bytes(&store, &root, piece_id, &edition_id, page, target_long_edge)
            .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| format!("page image worker failed: {e}"))?
}

/// Generate and cache a page image without shipping it across IPC — the
/// background warm used for pages the reader is about to turn to.
#[tauri::command]
async fn score_page_image_warm(
    piece_id: i64,
    edition_id: String,
    page: i64,
    target_long_edge: u32,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<(), String> {
    let store = store.inner().clone();
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        score::page_image_bytes(&store, &root, piece_id, &edition_id, page, target_long_edge)
            .map(|_| ())
    })
    .await
    .map_err(|e| format!("page image warm worker failed: {e}"))?
}

/// Load a cached fitted first-page snapshot for the piece-switch accelerator.
/// Returns the raw bytes (an empty response on a miss). Display-only and never
/// authoritative: the cache lives under the OS app-cache dir, never the vault or
/// the DB. A miss is not an error — the switch simply falls back to a live decode.
#[tauri::command]
async fn score_page_cache_load(
    piece_id: i64,
    edition_fingerprint: String,
    page: i64,
    bucket: String,
    app: AppHandle,
) -> Result<tauri::ipc::Response, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        score::page_cache::validate_components(&edition_fingerprint, &bucket)?;
        let key = score::page_cache::cache_key(piece_id, &edition_fingerprint, page, &bucket);
        score::page_cache::load(&root, &key).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| format!("page cache load worker failed: {e}"))?
}

/// Persist a fitted first-page snapshot (compressed WebP/JPEG bytes) for the
/// piece-switch accelerator. Bounded, LRU-evicted, off the main thread.
#[tauri::command]
async fn score_page_cache_save(
    piece_id: i64,
    edition_fingerprint: String,
    page: i64,
    bucket: String,
    bytes: Vec<u8>,
    app: AppHandle,
) -> Result<(), String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        score::page_cache::validate_components(&edition_fingerprint, &bucket)?;
        let key = score::page_cache::cache_key(piece_id, &edition_fingerprint, page, &bucket);
        score::page_cache::save(&root, &key, &bytes)
    })
    .await
    .map_err(|e| format!("page cache save worker failed: {e}"))?
}

/// Persist a piece's intake payload (sets `intake_done`) and return the updated
/// detail. Also logs an `intake` session event so the session summary reflects
/// piece setup done during the session.
#[tauri::command]
fn piece_intake_save(
    id: i64,
    intake: Intake,
    store: State<'_, Arc<Store>>,
    sessions: State<'_, Arc<SessionService>>,
) -> Result<PieceDetail, String> {
    store.save_intake(id, &intake).map_err(|e| e.to_string())?;
    let detail = store
        .get_piece(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("piece {id} not found"))?;
    sessions.log(
        "intake",
        serde_json::json!({ "piece_id": id, "piece_title": detail.title }),
    );
    Ok(detail)
}

/// Open a rep block (voice or UI). Resolves the ladder, persists the block, and
/// returns the fresh snapshot; the frontend applies it directly.
#[tauri::command]
fn rep_open(
    args: RepOpenArgs,
    context: Option<SetFocusContextInput>,
    demotion: Option<DemotionOverride>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<RepSnapshot, String> {
    match (demotion, context) {
        (Some(demotion), context) => rep.open_with_demotion(args, context, Some(demotion)),
        (None, Some(context)) => rep.open_with_context(args, Some(context)),
        (None, None) => rep.open(args),
    }
}

/// Record one rep against the active block. `verdict` is `"clean"`/`"flawed"`/
/// `"failed"`; `note` is optional. Takes the exact same engine path voice uses.
#[tauri::command]
fn rep_check(
    verdict: String,
    note: Option<String>,
    command_id: Option<String>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<CheckOutcome, String> {
    let v = RepVerdict::parse(&verdict).ok_or_else(|| format!("unknown verdict '{verdict}'"))?;
    match command_id {
        Some(command_id) => rep.check_idempotent(&command_id, v, note),
        None => rep.check(v, note),
    }
}

#[tauri::command]
fn rep_undo(rep: State<'_, Arc<RepEngine>>) -> Result<CheckOutcome, String> {
    rep.undo()
}

#[tauri::command]
fn rep_correct(
    attempt_id: Option<i64>,
    verdict: String,
    note: Option<String>,
    replace_note: bool,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<CheckOutcome, String> {
    let verdict =
        RepVerdict::parse(&verdict).ok_or_else(|| format!("unknown verdict '{verdict}'"))?;
    rep.correct(attempt_id, verdict, note, replace_note)
}

#[tauri::command]
fn rep_adjustment_reverse(
    adjustment_id: i64,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<CheckOutcome, String> {
    rep.reverse_adjustment(adjustment_id)
}

#[tauri::command]
fn rep_restart(
    required_clean_streak: Option<u32>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<RepSnapshot, String> {
    rep.restart(required_clean_streak)
}

/// Close the active set as contract-mastered or closed-unresolved. Persistence
/// failure rejects the command and leaves the active set intact.
#[tauri::command]
fn rep_close(rep: State<'_, Arc<RepEngine>>) -> Result<Option<RepSnapshot>, String> {
    rep.close()
}

/// The current active-block snapshot, or `null` when no block is open.
#[tauri::command]
fn rep_state(rep: State<'_, Arc<RepEngine>>) -> Result<Option<RepSnapshot>, String> {
    rep.state()
}

/// Task A4: every currently-paused set (the paused-sets tray), newest-paused
/// first. Read-only — resuming/pausing a row still goes through the existing
/// `rep_resume`/`rep_pause` commands.
#[tauri::command]
fn sets_paused_list(rep: State<'_, Arc<RepEngine>>) -> Result<Vec<PausedSetRow>, String> {
    rep.paused_sets_list()
}

fn rejected_snapshot(command_id: &str, error: String) -> MutationReceipt<RepSnapshot> {
    MutationReceipt::rejected(command_id, "practice_rejected", error)
}

fn rejected_retention(command_id: &str, error: String) -> MutationReceipt<RetentionCheckView> {
    MutationReceipt::rejected(command_id, "retention_rejected", error)
}

#[tauri::command]
fn rep_pause(
    command_id: String,
    expected_set_id: Option<i64>,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RepSnapshot> {
    let result = match expected_set_id {
        Some(set_id) => rep.pause_expected(&command_id, Some(set_id)),
        None => rep.pause(&command_id),
    };
    result.unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

/// Task A4b: `set_id` picks which paused set to resume (the paused-sets
/// tray's per-row Resume button passes it). `None` keeps the pre-A4b
/// behavior — resume the only paused set database-wide; rejects as
/// ambiguous if several are paused. If some other set is currently active,
/// it is auto-paused and the target activated atomically — see
/// `RepEngine::resume`.
#[tauri::command]
fn rep_resume(
    command_id: String,
    set_id: Option<i64>,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RepSnapshot> {
    rep.resume(&command_id, set_id)
        .unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

#[tauri::command]
fn rep_checkpoint(
    command_id: String,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RepSnapshot> {
    rep.checkpoint(&command_id)
        .unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

#[tauri::command]
fn rep_reflect(
    command_id: String,
    reflection: String,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RepSnapshot> {
    rep.reflect(&command_id, &reflection)
        .unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

#[tauri::command]
async fn rep_safety_stop(
    command_id: String,
    reason: Option<String>,
    app: AppHandle,
    rep: State<'_, Arc<RepEngine>>,
    metro: State<'_, Arc<Metronome>>,
) -> Result<MutationReceipt<RepSnapshot>, String> {
    let rep = Arc::clone(&rep);
    let metro = Arc::clone(&metro);
    let join_failure_metro = Arc::clone(&metro);
    let task_app = app.clone();
    let join_failure_app = app.clone();
    let rejected_command_id = command_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        metro.serialized(|| {
            let (receipt, stopped) =
                rep.execute_safety_stop(&command_id, reason.as_deref(), || metro.do_safety_stop());
            let state = stopped.map(|_| metro.snapshot());
            if let Some(state) = &state {
                metronome::emit(&task_app, state);
            }
            (receipt, state)
        })
    })
    .await;
    Ok(match result {
        Ok((receipt, _state)) => {
            receipt.unwrap_or_else(|error| rejected_snapshot(&rejected_command_id, error))
        }
        Err(error) => {
            let _ = tauri::async_runtime::spawn_blocking(move || {
                join_failure_metro.serialized(|| {
                    let _ = join_failure_metro.do_safety_stop();
                    let state = join_failure_metro.snapshot();
                    metronome::emit(&join_failure_app, &state);
                })
            })
            .await;
            rejected_snapshot(
                &rejected_command_id,
                format!("rep_safety_stop task failed: {error}"),
            )
        }
    })
}

#[tauri::command]
fn rep_recovery(
    command_id: String,
    action: RecoveryActionRequest,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RepSnapshot> {
    rep.recover(&command_id, &action)
        .unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

#[tauri::command]
fn retention_due(
    as_of_date: String,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<Vec<RetentionCheckView>, String> {
    rep.retention_due(&as_of_date)
}

#[tauri::command]
fn retention_snooze(
    command_id: String,
    check_id: i64,
    due_date: String,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RetentionCheckView> {
    rep.retention_snooze(&command_id, check_id, &due_date)
        .unwrap_or_else(|error| rejected_retention(&command_id, error))
}

#[tauri::command]
fn retention_confirm(
    command_id: String,
    check_id: i64,
    result: RetentionResult,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RetentionCheckView> {
    rep.retention_confirm(&command_id, check_id, &result)
        .unwrap_or_else(|error| rejected_retention(&command_id, error))
}

#[tauri::command]
fn retention_lower(
    command_id: String,
    check_id: i64,
    result: RetentionResult,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RetentionCheckView> {
    rep.retention_lower(&command_id, check_id, &result)
        .unwrap_or_else(|error| rejected_retention(&command_id, error))
}

#[tauri::command]
fn retention_reopen(
    command_id: String,
    check_id: i64,
    result: RetentionResult,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<RetentionCheckView> {
    rep.retention_reopen(&command_id, check_id, &result)
        .unwrap_or_else(|error| rejected_retention(&command_id, error))
}

/// Every rep block for a piece (newest first) with its per-verdict rep tallies.
#[tauri::command]
fn rep_blocks_for_piece(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<BlockHistory>, String> {
    store.block_history(piece_id).map_err(|e| e.to_string())
}

/// The current session and its event log (newest-first, capped), or `null`.
#[tauri::command]
fn session_current(sessions: State<'_, Arc<SessionService>>) -> Option<SessionView> {
    sessions.current()
}

/// End the current session: write its vault summary and mark it ended. Returns
/// the export result, or `null` when no session was open.
#[tauri::command]
fn session_end(
    store: State<'_, Arc<Store>>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<Option<ExportResult>, String> {
    let dir = pieces_dir(&store);
    rep.end_session_and_export(&dir)
}

/// Graceful app exit is an explicit practice boundary: close the live set first
/// and only then export/end its session. If the durable close fails, leave the
/// session open for relaunch recovery instead of silently splitting the set.
fn finalize_practice_on_exit(store: &Store, rep: &RepEngine) {
    if rep.close().is_err() {
        return;
    }
    let dir = pieces_dir(store);
    let _ = rep.end_session_and_export(&dir);
}

/// Remember the piece the user is working on (setting `ui.current_piece`). The
/// voice layer reads this later to scope commands to the active piece.
#[tauri::command]
fn piece_select(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .set_setting("ui.current_piece", &id.to_string())
        .map_err(|e| e.to_string())
}

// ── T3: Region CRUD commands ────────────────────────────────────────────────

/// All regions for a piece, ordered by their sort order.
#[tauri::command]
fn region_list(piece_id: i64, store: State<'_, Arc<Store>>) -> Result<Vec<Region>, String> {
    store.region_list(piece_id).map_err(|e| e.to_string())
}

/// Create a region, optionally as a sub-section of `parent_region_id`
/// (Task C5 — one level of nesting, same-piece only, friendly errors).
#[tauri::command]
fn region_create(
    args: RegionCreate,
    parent_region_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<Region, String> {
    store
        .region_create_with_parent(args, parent_region_id)
        .map_err(|e| e.to_string())
}

/// Apply a partial patch to a region.
#[tauri::command]
fn region_update(
    id: i64,
    patch: RegionPatch,
    store: State<'_, Arc<Store>>,
) -> Result<Region, String> {
    store.region_update(id, patch).map_err(|e| e.to_string())
}

/// Delete a region (member blocks are kept, unlinked). `mode` only matters
/// when the region has children (Task C5): `cascade` deletes them too,
/// `promote` clears their `parent_region_id` so they survive as top-level
/// regions. Defaults to `cascade` when omitted.
#[tauri::command]
fn region_delete(
    id: i64,
    mode: Option<RegionDeleteMode>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store
        .region_delete_mode(id, mode.unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// Merge `id_absorb` into `id_keep`.
#[tauri::command]
fn region_merge(
    id_keep: i64,
    id_absorb: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Region, String> {
    store
        .region_merge(id_keep, id_absorb)
        .map_err(|e| e.to_string())
}

/// Split one Region before a measure as one atomic graph mutation.
#[tauri::command]
fn region_split(
    id: i64,
    split_at: u32,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<Region>, String> {
    store.region_split(id, split_at).map_err(|e| e.to_string())
}

/// Persist one Score Atlas target as a Region (with edition-bound PDF geometry)
/// plus its `target_meta` sidecar, in a single transaction. A repeated
/// `command_id` replays the committed Region instead of creating a duplicate.
#[tauri::command]
fn score_atlas_target_save(
    payload: store::AtomicTargetSavePayload,
    store: State<'_, Arc<Store>>,
) -> Result<Region, String> {
    store
        .score_atlas_target_save(payload)
        .map_err(|e| e.to_string())
}

/// Persist a zero-form micro-target child, including its exact score box, in
/// one SQLite transaction.
#[tauri::command]
fn score_micro_target_create(
    args: store::AtomicMicroTargetCreate,
    store: State<'_, Arc<Store>>,
) -> Result<Region, String> {
    store
        .score_micro_target_create(args)
        .map_err(|error| error.to_string())
}

/// Persist one score edition's calibration (line anchors) so drawn boxes can be
/// interpolated to measures. Method is fixed to `user_confirmed` server-side and
/// `points_json` is validated before storage. UPSERTs on the unique
/// (piece, edition, fingerprint) key.
#[tauri::command]
fn score_calibration_save(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    points_json: String,
    user_verified: bool,
    store: State<'_, Arc<Store>>,
) -> Result<store::CalibrationView, String> {
    store
        .score_calibration_save(
            piece_id,
            &edition_id,
            &edition_fingerprint,
            &points_json,
            user_verified,
        )
        .map_err(|e| e.to_string())
}

/// Read one score edition's stored calibration, or `None` if it is unmapped.
#[tauri::command]
fn score_calibration_get(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    store: State<'_, Arc<Store>>,
) -> Result<Option<store::CalibrationView>, String> {
    store
        .score_calibration_get(piece_id, &edition_id, &edition_fingerprint)
        .map_err(|e| e.to_string())
}

// ── Pencil marks drawn on the score ────────────────────────────────────────

/// Every pencil stroke on one page of one edition, plus a count of strokes held
/// under a different fingerprint of the same edition file (drawn before it was
/// re-scanned; kept on disk, not shown over geometry they may no longer fit).
#[tauri::command]
fn score_marks_page(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    page: i64,
    store: State<'_, Arc<Store>>,
) -> Result<store::ScorePageMarks, String> {
    store
        .score_marks_page(piece_id, &edition_id, &edition_fingerprint, page)
        .map_err(|e| e.to_string())
}

/// Append one freehand stroke to a page. `points_json` is normalized 0–1
/// page-relative geometry; it is validated and canonically re-serialized before
/// storage. Returns the saved stroke with its id, which is also its undo order.
#[tauri::command]
fn score_mark_add(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    page: i64,
    width: f64,
    points_json: String,
    store: State<'_, Arc<Store>>,
) -> Result<store::ScoreMark, String> {
    store
        .score_mark_add(
            piece_id,
            &edition_id,
            &edition_fingerprint,
            page,
            width,
            &points_json,
        )
        .map_err(|e| e.to_string())
}

/// Remove the newest stroke on one page. Returns its id, or `null` when there
/// was nothing left to undo.
#[tauri::command]
fn score_mark_undo(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    page: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Option<i64>, String> {
    store
        .score_mark_undo(piece_id, &edition_id, &edition_fingerprint, page)
        .map_err(|e| e.to_string())
}

/// Remove every stroke on one page (destructive; the UI confirms first).
/// Returns how many were removed. Other pages and editions are untouched.
#[tauri::command]
fn score_marks_clear_page(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    page: i64,
    store: State<'_, Arc<Store>>,
) -> Result<i64, String> {
    store
        .score_marks_clear_page(piece_id, &edition_id, &edition_fingerprint, page)
        .map_err(|e| e.to_string())
}

// ── Measure mapping store CRUD (Plan C, task C1) ────────────────────────────
//
// Pure CRUD over schema v14's `measure_map` table plus the typed, versioned
// systems model — no vision, no reconciliation (later Plan C tasks). Off the
// main thread via `spawn_blocking`, the house idiom for store access here.

/// Every mapped page for one piece+edition fingerprint, page-ordered. An empty
/// vec means unmapped — the frontend then offers the scan-and-map flow.
#[tauri::command]
async fn measure_map_get(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<store::MeasureMapPageRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .measure_map_get(piece_id, &edition_id, &edition_fingerprint)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("measure map read worker failed: {e}"))?
}

/// Validate `pages` as a whole payload (cross-page bar-number continuity
/// enforced at every page boundary present in the payload) and, only if every
/// page is valid, atomically REPLACE ALL existing rows for
/// `(piece_id, edition_fingerprint)` — not just the pages given here — in one
/// transaction. A re-apply is therefore the new whole truth for that
/// fingerprint: a previously-mapped page absent from `pages` is dropped, not
/// preserved. A single invalid page rejects the whole call before the
/// transaction opens, so nothing is written. Returns the number of pages
/// written.
#[tauri::command]
async fn measure_map_apply(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    pages: Vec<store::MeasureMapPageRow>,
    store: State<'_, Arc<Store>>,
) -> Result<u32, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .measure_map_apply(piece_id, &edition_id, &edition_fingerprint, pages)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("measure map apply worker failed: {e}"))?
}

/// Delete every mapped page for one piece+edition fingerprint (destructive;
/// the UI confirms first). Rows under any OTHER fingerprint of the same piece
/// are untouched. Returns how many rows were removed.
#[tauri::command]
async fn measure_map_clear(
    piece_id: i64,
    edition_fingerprint: String,
    store: State<'_, Arc<Store>>,
) -> Result<u32, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .measure_map_clear(piece_id, &edition_fingerprint)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("measure map clear worker failed: {e}"))?
}

/// Vision-scan one page for its measure geometry (Plan C, task C2). Never
/// caches — every call is an explicit, user-triggered request through the
/// SAME Claude-primary/Gemini-fallback provider chain (and key resolution)
/// as the Brain. `page_jpeg` is `None` for the normal server-render path;
/// when the server's fast path refuses a page (a vector edition) the error
/// string is the exact literal `"needs_client_raster"`, and the frontend
/// re-calls with a canvas-encoded JPEG.
#[tauri::command]
async fn measure_scan_page(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    page: u32,
    page_jpeg: Option<Vec<u8>>,
    store: State<'_, Arc<Store>>,
) -> Result<score::measure_scan::ScanPageOutput, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let preference = store.get_setting("brain.provider").ok().flatten();
        let chain = brain::ProviderChain::from_native_config_with_preference(preference.as_deref());
        score::measure_scan::measure_scan_page(
            &store,
            piece_id,
            &edition_id,
            &edition_fingerprint,
            page,
            page_jpeg,
            &chain,
            &brain::NativeTransport::new(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("measure scan worker failed: {e}"))?
}

/// One page's input to [`measure_reconcile`]: the page number paired with its
/// raw vision scan. The wire shape of `pages_json`'s array elements.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ReconcilePageInput {
    page: u32,
    scan: score::measure_scan::ScanPageOutput,
}

/// Deterministically reconcile a set of page scans into a typed measure map
/// (Plan C, task C3). Pure reconciliation is `score::measure_reconcile::reconcile`;
/// this command only resolves its two optional inputs around that pure
/// function — the piece's MusicXML totals (absent MusicXML -> `None`, the
/// reconciliation still runs, just without the total-vs-XML check) and the
/// edition's saved calibration anchors (absent calibration -> no anchors) —
/// and returns the result straight back to the frontend. Nothing is written
/// to storage here; `measure_map` is only ever changed by an explicit user
/// Apply (`measure_map_apply`).
#[tauri::command]
async fn measure_reconcile(
    piece_id: i64,
    edition_id: String,
    edition_fingerprint: String,
    pages_json: String,
    store: State<'_, Arc<Store>>,
) -> Result<score::measure_reconcile::ReconcileResult, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let inputs: Vec<ReconcilePageInput> = serde_json::from_str(&pages_json)
            .map_err(|e| format!("measure reconcile pages are not valid JSON: {e}"))?;
        let pages = inputs.into_iter().map(|p| (p.page, p.scan)).collect();

        let xml = brain::score_xml_measure_facts(&store, piece_id)
            .ok()
            .and_then(|facts| {
                facts
                    .max_measure
                    .map(|max_measure| score::measure_reconcile::XmlTotals {
                        max_measure,
                        has_pickup: facts.has_pickup,
                    })
            });

        let anchors = store
            .score_calibration_get(piece_id, &edition_id, &edition_fingerprint)
            .map_err(|e| e.to_string())?
            .map(|calibration| {
                score::measure_reconcile::topmost_calibration_anchors(&calibration.points)
            })
            .unwrap_or_default();

        Ok(score::measure_reconcile::reconcile(pages, xml, anchors))
    })
    .await
    .map_err(|e| format!("measure reconcile worker failed: {e}"))?
}

// ── Practice Notebook: day sheets + per-piece long-term plans (spec §C2) ────

/// Read the Practice Notebook day sheet for `date`, or `null` when none has been
/// saved for that exact date (the frontend then renders a blank sheet; nothing
/// carries over from a prior day).
#[tauri::command]
fn day_sheet_get(
    date: String,
    store: State<'_, Arc<Store>>,
) -> Result<Option<store::DaySheet>, String> {
    store.day_sheet_get(&date).map_err(|e| e.to_string())
}

/// Validate and upsert the day sheet for `date`. `body_json` is an ordered array
/// of typed lines; malformed JSON, unknown line types, and unknown fields are
/// rejected. Returns the saved sheet as its save receipt.
#[tauri::command]
fn day_sheet_save(
    date: String,
    body_json: String,
    store: State<'_, Arc<Store>>,
) -> Result<store::DaySheet, String> {
    store
        .day_sheet_save(&date, &body_json)
        .map_err(|e| e.to_string())
}

// ── Dynamics calibration profiles (Plan B, task B2) ──────────────────────
//
// THE LAW: loudness only. These three commands move five dB figures and a
// free-text label in and out of the two `dynamics_*` tables. They write to no
// practice table and append no event.

/// Save a new pp→ff calibration profile and make it the sole active one.
///
/// A save ALWAYS creates a new row: recalibrating never mutates an existing
/// profile, so the previous curve stays inspectable. A non-increasing capture is
/// rejected with a message naming the offending step and both dB figures.
#[tauri::command]
fn dynamics_profile_save(
    device_id: String,
    label: String,
    points: Vec<store::dynamics_profiles::CalibrationPoint>,
    store: State<'_, Arc<Store>>,
) -> Result<store::dynamics_profiles::DynamicsProfile, String> {
    store
        .dynamics_profile_save(&device_id, &label, &points)
        .map_err(|e| e.to_string())
}

/// Every saved calibration profile, newest first.
#[tauri::command]
fn dynamics_profile_list(
    store: State<'_, Arc<Store>>,
) -> Result<Vec<store::dynamics_profiles::DynamicsProfile>, String> {
    store.dynamics_profile_list().map_err(|e| e.to_string())
}

/// Move the active flag to `id`. Creates and deletes nothing.
#[tauri::command]
fn dynamics_profile_activate(
    id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<store::dynamics_profiles::DynamicsProfile, String> {
    store
        .dynamics_profile_activate(id)
        .map_err(|e| e.to_string())
}

/// Read one piece's long-term "arch" plan, or `null` when it has none yet.
#[tauri::command]
fn piece_plan_get(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Option<store::PiecePlan>, String> {
    store.piece_plan_get(piece_id).map_err(|e| e.to_string())
}

/// Validate and upsert one piece's long-term "arch" plan. Returns the saved plan.
#[tauri::command]
fn piece_plan_save(
    piece_id: i64,
    body_text: String,
    store: State<'_, Arc<Store>>,
) -> Result<store::PiecePlan, String> {
    store
        .piece_plan_save(piece_id, &body_text)
        .map_err(|e| e.to_string())
}

// ── History/Calendar day-bucketed read models (Plan B, task B1) ────────────
//
// Pure reads over existing tables — no migration, no new indexes, no write
// paths. Every day boundary is a LOCAL calendar day, matching the session
// day-scoping convention (see `store::history_days`).

/// One row per LOCAL day in `[from,to]` with any practice evidence, newest
/// first — the History timeline's top-level list.
#[tauri::command]
fn history_days(
    from: String,
    to: String,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<store::HistoryDaySummary>, String> {
    store.history_days(&from, &to).map_err(|e| e.to_string())
}

/// One LOCAL day's full detail: every session and every set touched that day.
#[tauri::command]
fn history_day_detail(
    date: String,
    store: State<'_, Arc<Store>>,
) -> Result<store::HistoryDayDetail, String> {
    store.history_day_detail(&date).map_err(|e| e.to_string())
}

/// Existing day sheets whose date falls in `[from,to]`, ascending; read-only,
/// never creates a row for a date that has none.
#[tauri::command]
fn day_sheets_range(
    from: String,
    to: String,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<store::DaySheet>, String> {
    store
        .day_sheets_range(&from, &to)
        .map_err(|e| e.to_string())
}

// ── Day streak (Plan A, task A2) ───────────────────────────────────────────
//
// A pure read over the event log. There is no streak table and no streak write
// path anywhere in the app: a streak is a fact about practice that already
// happened, so it cannot be granted, bought or backfilled.

/// Consecutive LOCAL days whose event-derived focused time cleared the
/// configured `streak.threshold_minutes` bar, plus the best run on record.
#[tauri::command]
fn streak_summary(store: State<'_, Arc<Store>>) -> Result<store::StreakSummary, String> {
    let threshold = i64::from(settings::snapshot(&store).streak_threshold_minutes);
    store.streak_summary(threshold).map_err(|e| e.to_string())
}

// ── Warmup routines (schema v18) ─────────────────────────────────────────

#[tauri::command]
fn warmup_routines_list(store: State<'_, Arc<Store>>) -> Result<Vec<WarmupRoutine>, String> {
    store
        .warmup_routines_list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn warmup_routine_save(
    input: WarmupRoutineSaveInput,
    store: State<'_, Arc<Store>>,
) -> Result<WarmupRoutine, String> {
    store
        .warmup_routine_save(&input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn warmup_routine_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .warmup_routine_delete(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn warmup_system_piece(store: State<'_, Arc<Store>>) -> Result<WarmupSystemPiece, String> {
    store
        .warmup_system_piece()
        .map_err(|error| error.to_string())
}

// ── Listen-back takes (schema v19) ───────────────────────────────────────

const REP_REPLAY_MAX_BYTES: usize = 12 * 1024 * 1024;
const REP_REPLAY_MAX_DURATION_MS: u64 = 10 * 60 * 1000;
const REP_REPLAY_RECOVERY_DIR: &str = "_recovery";

#[derive(Debug, Default, PartialEq, Eq)]
struct RepReplayReconcileReport {
    recovered_finished_takes: usize,
    quarantined_partials: usize,
    quarantined_unlinked_takes: usize,
    missing_referenced_files: usize,
    damaged_referenced_files: usize,
    unsafe_entries_preserved: usize,
    unmanaged_entries_preserved: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GeneratedReplayName<'a> {
    block_id: i64,
    attempt_id: i64,
    duration_ms: u64,
    hash_prefix: &'a str,
    extension: &'a str,
    partial: bool,
}

fn valid_replay_day(day: &str) -> bool {
    day.len() == 10
        && day.bytes().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7) && byte == b'-'
                || !matches!(index, 4 | 7) && byte.is_ascii_digit()
        })
}

/// The filename is a tiny write-ahead record. If the process dies after the
/// durable rename but before SQLite commits, startup can prove the exact
/// block/attempt/duration/hash and restore the row without guessing "latest".
fn generated_replay_name(name: &str) -> Option<GeneratedReplayName<'_>> {
    let (finished_name, partial) = match name.strip_suffix(".partial") {
        Some(value) => (value, true),
        None => (name, false),
    };
    let (stem, extension) = finished_name.rsplit_once('.')?;
    if !matches!(extension, "webm" | "m4a") {
        return None;
    }
    let mut parts = stem.split('-');
    let block_id = parts.next()?.parse::<i64>().ok()?;
    let attempt_id = parts.next()?.parse::<i64>().ok()?;
    let duration_ms = parts.next()?.parse::<u64>().ok()?;
    let _nonce = parts.next()?.parse::<u128>().ok()?;
    let hash_prefix = parts.next()?;
    if parts.next().is_some()
        || block_id < 1
        || attempt_id < 1
        || duration_ms == 0
        || duration_ms > REP_REPLAY_MAX_DURATION_MS
        || hash_prefix.len() != 12
        || !hash_prefix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return None;
    }
    Some(GeneratedReplayName {
        block_id,
        attempt_id,
        duration_ms,
        hash_prefix,
        extension,
        partial,
    })
}

fn ensure_private_directory(
    path: &std::path::Path,
    label: &str,
) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(path).map_err(|error| format!("create {label}: {error}"))?;
    let metadata =
        std::fs::symlink_metadata(path).map_err(|error| format!("inspect {label}: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{label} must be a private directory, not a link"));
    }
    std::fs::canonicalize(path).map_err(|error| format!("resolve {label}: {error}"))
}

fn ensure_replay_day_directory(
    directory: &std::path::Path,
    day: &str,
) -> Result<std::path::PathBuf, String> {
    if !valid_replay_day(day) {
        return Err("kept take day is invalid".into());
    }
    let root = ensure_private_directory(directory, "rep-replays directory")?;
    let day_directory = root.join(day);
    let canonical_day = ensure_private_directory(&day_directory, "dated replay directory")?;
    if canonical_day.parent() != Some(root.as_path()) {
        return Err("dated replay directory escaped rep-replays".into());
    }
    // Persist the dated-directory entry as well as the file rename that will
    // happen inside it. This matters on a first save for a new local day.
    sync_directory(&root)?;
    Ok(canonical_day)
}

fn sync_directory(path: &std::path::Path) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("sync replay directory: {error}"))
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_INVALID_HANDLE};
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;

        let directory = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
            .map_err(|error| format!("open replay directory for sync: {error}"))?;
        match directory.sync_all() {
            Ok(()) => Ok(()),
            // Windows can open a directory handle but does not guarantee that
            // FlushFileBuffers accepts it. The file itself was sync_all'd before
            // publication; these two documented directory-handle responses mean
            // there is no stronger portable directory flush to perform.
            Err(error)
                if matches!(
                    error.raw_os_error(),
                    Some(code)
                        if code == ERROR_ACCESS_DENIED as i32
                            || code == ERROR_INVALID_HANDLE as i32
                ) =>
            {
                Ok(())
            }
            Err(error) => Err(format!("sync replay directory: {error}")),
        }
    }
}

fn rep_replays_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?
        .join("rep-replays");
    ensure_private_directory(&directory, "rep-replays directory")
}

fn validate_replay_input(
    input: &RepReplaySaveInput,
    byte_len: usize,
) -> Result<&'static str, String> {
    if input.rep_block_id < 1 {
        return Err("A review take must belong to a practice set.".into());
    }
    if input.attempt_id < 1 {
        return Err("A review take must identify the judged attempt.".into());
    }
    if byte_len == 0 || byte_len > REP_REPLAY_MAX_BYTES {
        return Err(format!(
            "A kept review take must be between 1 byte and {} MB.",
            REP_REPLAY_MAX_BYTES / (1024 * 1024)
        ));
    }
    if input.duration_ms == 0 || input.duration_ms > REP_REPLAY_MAX_DURATION_MS {
        return Err("A review take must be between 1 ms and 10 minutes.".into());
    }
    let mime = input.mime_type.trim().to_ascii_lowercase();
    if mime.starts_with("audio/webm") {
        Ok("webm")
    } else if mime.starts_with("audio/mp4") {
        Ok("m4a")
    } else {
        Err("Review takes must be compact WebM/Opus or MP4 audio.".into())
    }
}

fn rep_replay_path(
    directory: &std::path::Path,
    rel_path: &str,
) -> Result<std::path::PathBuf, String> {
    let suffix = rel_path
        .strip_prefix("rep-replays/")
        .ok_or_else(|| "kept take path is outside rep-replays".to_string())?;
    let mut components = suffix.split('/');
    let day = components.next().unwrap_or_default();
    let name = components.next().unwrap_or_default();
    if !valid_replay_day(day)
        || name.is_empty()
        || components.next().is_some()
        || name.contains('\\')
        || name.contains("..")
        || std::path::Path::new(name)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(name)
    {
        return Err("kept take path is invalid".into());
    }
    let day_directory = directory.join(day);
    let path = day_directory.join(name);
    match path.parent() {
        Some(parent) if parent == day_directory => Ok(path),
        _ => Err("kept take path escaped rep-replays".into()),
    }
}

/// Resolve an existing replay without following a root, day, or file symlink.
/// `Ok(None)` means the referenced file is simply absent; unsafe/ambiguous
/// filesystem state is an error and is preserved for manual recovery.
fn existing_replay_path(
    directory: &std::path::Path,
    rel_path: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let root = ensure_private_directory(directory, "rep-replays directory")?;
    let lexical = rep_replay_path(&root, rel_path)?;
    let day_directory = lexical
        .parent()
        .ok_or_else(|| "kept take has no dated directory".to_string())?;
    let day_metadata = match std::fs::symlink_metadata(day_directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect dated replay directory: {error}")),
    };
    if day_metadata.file_type().is_symlink() || !day_metadata.is_dir() {
        return Err("dated replay directory is not a private directory".into());
    }
    let canonical_day = std::fs::canonicalize(day_directory)
        .map_err(|error| format!("resolve dated replay directory: {error}"))?;
    if canonical_day.parent() != Some(root.as_path()) {
        return Err("dated replay directory escaped rep-replays".into());
    }
    let metadata = match std::fs::symlink_metadata(&lexical) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect kept take: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("kept take is not a private regular file".into());
    }
    let canonical =
        std::fs::canonicalize(&lexical).map_err(|error| format!("resolve kept take: {error}"))?;
    if canonical.parent() != Some(canonical_day.as_path()) {
        return Err("kept take escaped its dated directory".into());
    }
    Ok(Some(canonical))
}

fn write_replay_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let temporary = path.with_extension(format!(
        "{}.partial",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("audio")
    ));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("create temporary review take: {error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        return Err(format!("write review take: {error}"));
    }
    let parent = path.parent().ok_or("kept take has no parent directory")?;
    // Publishing with a hard link is atomic *and* no-replace. `rename` would
    // silently replace a destination created in the narrow check/write race.
    std::fs::hard_link(&temporary, path).map_err(|error| format!("finish review take: {error}"))?;
    sync_directory(parent)?;
    std::fs::remove_file(&temporary)
        .map_err(|error| format!("remove published replay temporary: {error}"))?;
    sync_directory(parent)
}

fn quarantine_replay_file(
    directory: &std::path::Path,
    day: &str,
    source: &std::path::Path,
    name: &str,
) -> Result<std::path::PathBuf, String> {
    let root = ensure_private_directory(directory, "rep-replays directory")?;
    let recovery = ensure_private_directory(
        &root.join(REP_REPLAY_RECOVERY_DIR),
        "replay recovery directory",
    )?;
    if recovery.parent() != Some(root.as_path()) {
        return Err("replay recovery directory escaped rep-replays".into());
    }
    sync_directory(&root)?;
    let stem = format!("{day}--{name}");
    let target = (0..10_000)
        .find_map(|collision| {
            let candidate = if collision == 0 {
                recovery.join(&stem)
            } else {
                recovery.join(format!("{stem}--{collision}"))
            };
            match std::fs::symlink_metadata(&candidate) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(candidate),
                _ => None,
            }
        })
        .ok_or_else(|| "replay recovery directory has too many name collisions".to_string())?;
    std::fs::rename(source, &target)
        .map_err(|error| format!("move unlinked replay into recovery: {error}"))?;
    sync_directory(
        source
            .parent()
            .ok_or("unlinked replay has no source directory")?,
    )?;
    sync_directory(&recovery)?;
    Ok(target)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FinishedReplayDisposition {
    Recovered,
    Quarantine,
}

fn recover_finished_replay(
    store: &Store,
    generated: GeneratedReplayName<'_>,
    rel_path: &str,
    path: &std::path::Path,
) -> Result<FinishedReplayDisposition, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("inspect unlinked finished replay: {error}"))?;
    if metadata.len() == 0 || metadata.len() > REP_REPLAY_MAX_BYTES as u64 {
        return Ok(FinishedReplayDisposition::Quarantine);
    }
    let bytes =
        std::fs::read(path).map_err(|error| format!("read unlinked finished replay: {error}"))?;
    let hash = store::sha256_hex(&bytes);
    if !hash.starts_with(generated.hash_prefix) {
        return Ok(FinishedReplayDisposition::Quarantine);
    }
    if !store
        .rep_replay_attempt_exists(generated.block_id, generated.attempt_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(FinishedReplayDisposition::Quarantine);
    }
    if store
        .rep_replay_for_attempt(generated.block_id, generated.attempt_id)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(FinishedReplayDisposition::Quarantine);
    }
    let mime_type = match generated.extension {
        "webm" => "audio/webm;codecs=opus",
        "m4a" => "audio/mp4",
        _ => return Ok(FinishedReplayDisposition::Quarantine),
    };
    match store.rep_replay_insert(RepReplayInsert {
        block_id: generated.block_id,
        attempt_id: generated.attempt_id,
        rel_path,
        mime_type,
        duration_ms: generated.duration_ms,
        byte_len: bytes.len() as u64,
        content_hash: &hash,
    }) {
        Ok(_) => Ok(FinishedReplayDisposition::Recovered),
        Err(error) => {
            // A concurrent or previously recovered winner makes this file a
            // duplicate, not a reason to fail startup. Any other DB failure is
            // surfaced and the source file remains untouched.
            if store
                .rep_replay_for_attempt(generated.block_id, generated.attempt_id)
                .map_err(|lookup_error| lookup_error.to_string())?
                .is_some()
            {
                Ok(FinishedReplayDisposition::Quarantine)
            } else {
                Err(error.to_string())
            }
        }
    }
}

/// Repair only states that can be proven from durable evidence. Finished
/// generated files contain enough identity in their names to restore their
/// exact SQLite row. Incomplete or ambiguous generated files are moved—not
/// deleted—under `_recovery`. Missing/corrupt DB-linked takes and unfamiliar
/// files are reported and left in place for backup/manual recovery.
fn reconcile_rep_replays_in_directory(
    directory: &std::path::Path,
    store: &Store,
) -> Result<RepReplayReconcileReport, String> {
    use std::collections::HashSet;

    let root = ensure_private_directory(directory, "rep-replays directory")?;
    let rows = store
        .rep_replay_files()
        .map_err(|error| error.to_string())?;
    let referenced: HashSet<String> = rows.iter().map(|row| row.rel_path.clone()).collect();
    let mut report = RepReplayReconcileReport::default();

    for row in &rows {
        match existing_replay_path(&root, &row.rel_path) {
            Ok(None) => report.missing_referenced_files += 1,
            Ok(Some(path)) => match std::fs::read(path) {
                Ok(bytes)
                    if bytes.len() as u64 == row.byte_len
                        && store::sha256_hex(&bytes) == row.content_hash => {}
                Ok(_) | Err(_) => report.damaged_referenced_files += 1,
            },
            Err(_) => report.unsafe_entries_preserved += 1,
        }
    }

    for day_entry in
        std::fs::read_dir(&root).map_err(|error| format!("scan rep-replays: {error}"))?
    {
        let day_entry = day_entry.map_err(|error| format!("scan rep-replays entry: {error}"))?;
        let day_name = match day_entry.file_name().into_string() {
            Ok(value) => value,
            Err(_) => {
                report.unsafe_entries_preserved += 1;
                continue;
            }
        };
        if day_name == REP_REPLAY_RECOVERY_DIR {
            continue;
        }
        if !valid_replay_day(&day_name) {
            report.unmanaged_entries_preserved += 1;
            continue;
        }
        let day_symlink_metadata = std::fs::symlink_metadata(day_entry.path())
            .map_err(|error| format!("inspect dated replay link: {error}"))?;
        if day_symlink_metadata.file_type().is_symlink() || !day_symlink_metadata.is_dir() {
            report.unsafe_entries_preserved += 1;
            continue;
        }
        let canonical_day = std::fs::canonicalize(day_entry.path())
            .map_err(|error| format!("resolve dated replay entry: {error}"))?;
        if canonical_day.parent() != Some(root.as_path()) {
            report.unsafe_entries_preserved += 1;
            continue;
        }
        for file_entry in std::fs::read_dir(&canonical_day)
            .map_err(|error| format!("scan dated replays: {error}"))?
        {
            let file_entry =
                file_entry.map_err(|error| format!("scan dated replay entry: {error}"))?;
            let name = match file_entry.file_name().into_string() {
                Ok(value) => value,
                Err(_) => {
                    report.unsafe_entries_preserved += 1;
                    continue;
                }
            };
            let rel_path = format!("rep-replays/{day_name}/{name}");
            if referenced.contains(&rel_path) {
                continue;
            }
            let link_metadata = std::fs::symlink_metadata(file_entry.path())
                .map_err(|error| format!("inspect unlinked replay: {error}"))?;
            if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
                report.unsafe_entries_preserved += 1;
                continue;
            }
            let Some(generated) = generated_replay_name(&name) else {
                report.unmanaged_entries_preserved += 1;
                continue;
            };
            let path = std::fs::canonicalize(file_entry.path())
                .map_err(|error| format!("resolve unlinked replay: {error}"))?;
            if path.parent() != Some(canonical_day.as_path()) {
                report.unsafe_entries_preserved += 1;
                continue;
            }
            if generated.partial {
                quarantine_replay_file(&root, &day_name, &path, &name)?;
                report.quarantined_partials += 1;
                continue;
            }
            match recover_finished_replay(store, generated, &rel_path, &path)? {
                FinishedReplayDisposition::Recovered => report.recovered_finished_takes += 1,
                FinishedReplayDisposition::Quarantine => {
                    quarantine_replay_file(&root, &day_name, &path, &name)?;
                    report.quarantined_unlinked_takes += 1;
                }
            }
        }
    }

    Ok(report)
}

#[tauri::command]
fn rep_replay_save(
    input: RepReplaySaveInput,
    app: AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<RepReplayMeta, String> {
    let directory = rep_replays_dir(&app)?;
    rep_replay_save_in_directory(input, &directory, &store)
}

fn rep_replay_save_in_directory(
    input: RepReplaySaveInput,
    directory: &std::path::Path,
    store: &Store,
) -> Result<RepReplayMeta, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(input.bytes_base64.trim())
        .map_err(|_| "The kept review take was not valid base64 audio.".to_string())?;
    let extension = validate_replay_input(&input, bytes.len())?;
    if !store
        .rep_replay_attempt_exists(input.rep_block_id, input.attempt_id)
        .map_err(|error| error.to_string())?
    {
        return Err("The judged attempt does not belong to this practice set.".into());
    }
    // A lost success response may make the frontend retry. Attempt identity is
    // the replay key, so return the already-durable take instead of writing a
    // second file or row.
    if let Some(existing) = store
        .rep_replay_for_attempt(input.rep_block_id, input.attempt_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(existing);
    }
    let hash = store::sha256_hex(&bytes);
    let day = store.local_today().map_err(|error| error.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("system clock before Unix epoch: {error}"))?
        .as_nanos();
    let filename = format!(
        "{}-{}-{}-{nonce}-{}.{}",
        input.rep_block_id,
        input.attempt_id,
        input.duration_ms,
        &hash[..12],
        extension
    );
    let rel_path = format!("rep-replays/{day}/{filename}");
    let path = ensure_replay_day_directory(directory, &day)?.join(&filename);
    match std::fs::symlink_metadata(&path) {
        Ok(_) => return Err("A kept take filename unexpectedly already exists.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("inspect kept take destination: {error}")),
    }
    write_replay_atomic(&path, &bytes)?;
    let inserted = store.rep_replay_insert(RepReplayInsert {
        block_id: input.rep_block_id,
        attempt_id: input.attempt_id,
        rel_path: &rel_path,
        mime_type: input.mime_type.trim(),
        duration_ms: input.duration_ms,
        byte_len: bytes.len() as u64,
        content_hash: &hash,
    });
    match inserted {
        Ok(row) => Ok(row),
        Err(error) => {
            // Covers a concurrent replay of the same request between the
            // preflight and INSERT. The unique attempt index chooses one file.
            // Preserve the losing finished bytes in recovery rather than
            // deleting user audio automatically.
            let winning = store
                .rep_replay_for_attempt(input.rep_block_id, input.attempt_id)
                .map_err(|lookup_error| lookup_error.to_string())?
                .ok_or_else(|| error.to_string())?;
            let _ = quarantine_replay_file(directory, &day, &path, &filename);
            Ok(winning)
        }
    }
}

#[tauri::command]
fn rep_replay_list(
    rep_block_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<RepReplayMeta>, String> {
    store
        .rep_replay_list(rep_block_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn rep_replay_read(
    id: i64,
    app: AppHandle,
    store: State<'_, Arc<Store>>,
) -> Result<String, String> {
    let directory = rep_replays_dir(&app)?;
    rep_replay_read_from_directory(id, &directory, &store)
}

fn rep_replay_read_from_directory(
    id: i64,
    directory: &std::path::Path,
    store: &Store,
) -> Result<String, String> {
    use base64::Engine as _;
    let row = store
        .rep_replay_file(id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("kept take {id} not found"))?;
    let path = existing_replay_path(directory, &row.rel_path)?
        .ok_or_else(|| format!("kept take {} is missing from disk", row.id))?;
    let bytes = std::fs::read(path).map_err(|error| format!("read kept take: {error}"))?;
    if bytes.len() as u64 != row.byte_len || store::sha256_hex(&bytes) != row.content_hash {
        return Err(format!("kept take {} failed its integrity check", row.id));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn rep_replay_delete(id: i64, app: AppHandle, store: State<'_, Arc<Store>>) -> Result<(), String> {
    let Some(row) = store
        .rep_replay_file(id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let directory = rep_replays_dir(&app)?;
    let path = existing_replay_path(&directory, &row.rel_path)?;
    delete_replay_file_then_metadata(path, || {
        store
            .rep_replay_delete_row(id)
            .map_err(|error| error.to_string())
    })
}

fn delete_replay_file_then_metadata<F>(
    path: Option<std::path::PathBuf>,
    delete_metadata: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<bool, String>,
{
    // This is the one destructive path and it is explicitly user-requested.
    // Remove+sync the bytes first, then the row. A crash between them leaves a
    // visible missing-file row that a retry can finish; it must not leave an
    // unlinked generated file that startup could legitimately recover.
    if let Some(path) = path {
        match std::fs::remove_file(&path) {
            Ok(()) => sync_directory(
                path.parent()
                    .ok_or("kept take has no dated directory after delete")?,
            )?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("delete kept take: {error}")),
        }
    }
    delete_metadata()?;
    Ok(())
}

#[cfg(test)]
mod rep_replay_file_tests {
    use super::*;
    use base64::Engine as _;

    fn replay_store() -> (Store, i64, i64) {
        let store = Store::open(":memory:").unwrap();
        let (block, attempt) = store.rep_replay_test_seed().unwrap();
        (store, block, attempt)
    }

    fn replay_input(block: i64, attempt: i64) -> RepReplaySaveInput {
        RepReplaySaveInput {
            rep_block_id: block,
            attempt_id: attempt,
            mime_type: "audio/webm;codecs=opus".into(),
            duration_ms: 800,
            bytes_base64: base64::engine::general_purpose::STANDARD.encode([1, 2, 3]),
        }
    }

    fn staged_generated_take(
        directory: &std::path::Path,
        block: i64,
        attempt: i64,
        duration_ms: u64,
        bytes: &[u8],
        partial: bool,
    ) -> (String, std::path::PathBuf) {
        let day = "2026-08-27";
        let hash = store::sha256_hex(bytes);
        let mut name = format!(
            "{block}-{attempt}-{duration_ms}-123456789-{}.webm",
            &hash[..12]
        );
        if partial {
            name.push_str(".partial");
        }
        let day_directory = directory.join(day);
        std::fs::create_dir_all(&day_directory).unwrap();
        let path = day_directory.join(&name);
        std::fs::write(&path, bytes).unwrap();
        (format!("rep-replays/{day}/{name}"), path)
    }

    #[test]
    fn replay_paths_cannot_leave_the_private_audio_directory() {
        let directory = std::path::PathBuf::from("/tmp/codakiller-rep-replays-test");
        assert_eq!(
            rep_replay_path(&directory, "rep-replays/2026-08-27/7-123-audio.webm",).unwrap(),
            directory.join("2026-08-27/7-123-audio.webm")
        );
        for escaped in [
            "../secret.webm",
            "rep-replays/../secret.webm",
            "rep-replays/nested/secret.webm",
            "rep-replays/2026-08-27/nested/secret.webm",
            "rep-replays/\\secret.webm",
            "/tmp/secret.webm",
        ] {
            assert!(rep_replay_path(&directory, escaped).is_err(), "{escaped}");
        }
    }

    #[test]
    fn replay_write_is_atomic_and_hashable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("take.webm");
        let bytes = b"small opus-shaped test bytes";
        write_replay_atomic(&path, bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(store::sha256_hex(&std::fs::read(path).unwrap()).len(), 64);
        assert_eq!(
            std::fs::read_dir(directory.path()).unwrap().count(),
            1,
            "the .partial file must be renamed away"
        );
    }

    #[test]
    fn replay_publish_never_replaces_an_existing_destination() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("take.webm");
        std::fs::write(&path, b"existing user audio").unwrap();

        let error = write_replay_atomic(&path, b"new competing audio").unwrap_err();
        assert!(error.contains("finish review take"), "{error}");
        assert_eq!(std::fs::read(&path).unwrap(), b"existing user audio");
        assert_eq!(
            std::fs::read(path.with_extension("webm.partial")).unwrap(),
            b"new competing audio",
            "the losing bytes remain available for startup recovery"
        );
    }

    #[test]
    fn wrong_or_missing_attempt_writes_no_file_or_row() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        assert!(rep_replay_save_in_directory(
            replay_input(block + 99, attempt),
            directory.path(),
            &store,
        )
        .is_err());
        assert!(rep_replay_save_in_directory(
            replay_input(block, attempt + 99),
            directory.path(),
            &store,
        )
        .is_err());
        assert_eq!(store.rep_replay_list(block).unwrap().len(), 0);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_lost_success_retry_returns_one_exact_durable_take() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let first =
            rep_replay_save_in_directory(replay_input(block, attempt), directory.path(), &store)
                .unwrap();
        let retry =
            rep_replay_save_in_directory(replay_input(block, attempt), directory.path(), &store)
                .unwrap();
        assert_eq!(retry.id, first.id);
        assert_eq!(store.rep_replay_list(block).unwrap().len(), 1);
        let encoded = rep_replay_read_from_directory(first.id, directory.path(), &store).unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
            [1, 2, 3],
        );
        let dated = std::fs::read_dir(directory.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(std::fs::read_dir(dated).unwrap().count(), 1);
    }

    #[test]
    fn replay_validation_allows_compact_audio_only() {
        let valid = RepReplaySaveInput {
            rep_block_id: 1,
            attempt_id: 2,
            mime_type: "audio/webm;codecs=opus".into(),
            duration_ms: 1_200,
            bytes_base64: "AQID".into(),
        };
        assert_eq!(validate_replay_input(&valid, 3), Ok("webm"));
        assert!(validate_replay_input(
            &RepReplaySaveInput {
                mime_type: "audio/wav".into(),
                ..valid.clone()
            },
            3
        )
        .is_err());
        assert!(validate_replay_input(
            &RepReplaySaveInput {
                duration_ms: 0,
                ..valid
            },
            3
        )
        .is_err());
    }

    #[test]
    fn generated_filename_is_an_exact_recovery_identity() {
        let parsed =
            generated_replay_name("12-98-1600-123456789-012345abcdef.webm.partial").unwrap();
        assert_eq!(parsed.block_id, 12);
        assert_eq!(parsed.attempt_id, 98);
        assert_eq!(parsed.duration_ms, 1_600);
        assert_eq!(parsed.hash_prefix, "012345abcdef");
        assert_eq!(parsed.extension, "webm");
        assert!(parsed.partial);
        for invalid in [
            "12-98-1600-123456789-012345abcdef.wav",
            "12-98-0-123456789-012345abcdef.webm",
            "12-98-1600-nope-012345abcdef.webm",
            "12-98-1600-123456789-TOOUPPERCASE.webm",
            "12-98-1600-123456789-short.webm",
        ] {
            assert!(generated_replay_name(invalid).is_none(), "{invalid}");
        }
    }

    #[test]
    fn startup_recovers_a_finished_exact_orphan_and_is_idempotent() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let bytes = b"durable finished opus payload";
        let (rel_path, path) =
            staged_generated_take(directory.path(), block, attempt, 1_600, bytes, false);

        let first = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(first.recovered_finished_takes, 1);
        assert_eq!(first.quarantined_unlinked_takes, 0);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let rows = store.rep_replay_list(block).unwrap();
        assert_eq!(rows.len(), 1);
        let file_row = store.rep_replay_file(rows[0].id).unwrap().unwrap();
        assert_eq!(file_row.rel_path, rel_path);
        assert_eq!(file_row.content_hash, store::sha256_hex(bytes));

        let second = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(second, RepReplayReconcileReport::default());
        assert_eq!(store.rep_replay_list(block).unwrap().len(), 1);
    }

    #[test]
    fn startup_moves_a_partial_to_recovery_without_deleting_its_bytes() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let bytes = b"possibly incomplete but never auto-deleted";
        let (_, source) = staged_generated_take(directory.path(), block, attempt, 900, bytes, true);

        let first = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(first.quarantined_partials, 1);
        assert!(!source.exists());
        assert!(store.rep_replay_list(block).unwrap().is_empty());
        let recovered = std::fs::read_dir(directory.path().join(REP_REPLAY_RECOVERY_DIR))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(std::fs::read(recovered).unwrap(), bytes);

        let second = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(second, RepReplayReconcileReport::default());
    }

    #[test]
    fn unverifiable_generated_and_unmanaged_files_are_preserved_conservatively() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let bytes = b"audio with a deliberately wrong filename hash";
        let (valid_rel, valid_path) =
            staged_generated_take(directory.path(), block, attempt, 700, bytes, false);
        let wrong_name = valid_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .replace(&store::sha256_hex(bytes)[..12], "000000000000");
        let wrong_path = valid_path.with_file_name(&wrong_name);
        std::fs::rename(&valid_path, &wrong_path).unwrap();
        let unmanaged = wrong_path.with_file_name("my-manual-take.webm");
        std::fs::write(&unmanaged, b"manual audio").unwrap();

        let report = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(report.quarantined_unlinked_takes, 1);
        assert_eq!(report.unmanaged_entries_preserved, 1);
        assert!(unmanaged.exists());
        assert!(!wrong_path.exists());
        let recovered_bytes: Vec<Vec<u8>> =
            std::fs::read_dir(directory.path().join(REP_REPLAY_RECOVERY_DIR))
                .unwrap()
                .map(|entry| std::fs::read(entry.unwrap().path()).unwrap())
                .collect();
        assert!(recovered_bytes.contains(&bytes.to_vec()));
        assert!(store.rep_replay_list(block).unwrap().is_empty());
        assert!(valid_rel.starts_with("rep-replays/2026-08-27/"));
    }

    #[test]
    fn missing_or_damaged_referenced_takes_keep_their_metadata_and_bytes() {
        let (missing_store, block, attempt) = replay_store();
        let missing_directory = tempfile::tempdir().unwrap();
        let saved = rep_replay_save_in_directory(
            replay_input(block, attempt),
            missing_directory.path(),
            &missing_store,
        )
        .unwrap();
        let saved_file = missing_store.rep_replay_file(saved.id).unwrap().unwrap();
        let saved_path = rep_replay_path(missing_directory.path(), &saved_file.rel_path).unwrap();
        std::fs::remove_file(saved_path).unwrap();
        let missing =
            reconcile_rep_replays_in_directory(missing_directory.path(), &missing_store).unwrap();
        assert_eq!(missing.missing_referenced_files, 1);
        assert_eq!(missing_store.rep_replay_list(block).unwrap().len(), 1);

        let (damaged_store, block, attempt) = replay_store();
        let damaged_directory = tempfile::tempdir().unwrap();
        let saved = rep_replay_save_in_directory(
            replay_input(block, attempt),
            damaged_directory.path(),
            &damaged_store,
        )
        .unwrap();
        let saved_file = damaged_store.rep_replay_file(saved.id).unwrap().unwrap();
        let saved_path = rep_replay_path(damaged_directory.path(), &saved_file.rel_path).unwrap();
        let damaged_bytes = b"changed bytes stay available for manual recovery";
        std::fs::write(&saved_path, damaged_bytes).unwrap();
        let damaged =
            reconcile_rep_replays_in_directory(damaged_directory.path(), &damaged_store).unwrap();
        assert_eq!(damaged.damaged_referenced_files, 1);
        assert_eq!(std::fs::read(saved_path).unwrap(), damaged_bytes);
        assert_eq!(damaged_store.rep_replay_list(block).unwrap().len(), 1);
    }

    #[test]
    fn explicit_delete_metadata_failure_never_resurrects_the_removed_take() {
        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let saved =
            rep_replay_save_in_directory(replay_input(block, attempt), directory.path(), &store)
                .unwrap();
        let file = store.rep_replay_file(saved.id).unwrap().unwrap();
        let path = existing_replay_path(directory.path(), &file.rel_path)
            .unwrap()
            .unwrap();

        let error = delete_replay_file_then_metadata(Some(path.clone()), || {
            Err("simulated SQLite metadata delete failure".to_string())
        })
        .unwrap_err();
        assert_eq!(error, "simulated SQLite metadata delete failure");
        assert!(
            !path.exists(),
            "the explicit byte deletion already succeeded"
        );
        assert_eq!(
            store.rep_replay_list(block).unwrap().len(),
            1,
            "failed metadata deletion remains visible and retryable"
        );

        let startup = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(startup.missing_referenced_files, 1);
        assert_eq!(startup.recovered_finished_takes, 0);
        assert_eq!(startup.quarantined_unlinked_takes, 0);
        assert!(
            !path.exists(),
            "startup must not recreate explicitly deleted audio"
        );
        assert_eq!(store.rep_replay_list(block).unwrap().len(), 1);

        delete_replay_file_then_metadata(None, || {
            store
                .rep_replay_delete_row(saved.id)
                .map_err(|cause| cause.to_string())
        })
        .unwrap();
        assert!(store.rep_replay_list(block).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_directory_symlink_is_rejected_without_touching_outside_files() {
        use std::os::unix::fs::symlink;

        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let bytes = b"partial remains at source when recovery is unsafe";
        let (_, source) = staged_generated_take(directory.path(), block, attempt, 900, bytes, true);
        symlink(
            outside.path(),
            directory.path().join(REP_REPLAY_RECOVERY_DIR),
        )
        .unwrap();

        let error = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap_err();
        assert!(error.contains("private directory"), "{error}");
        assert_eq!(std::fs::read(source).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn replay_root_symlink_is_rejected_without_scanning_its_target() {
        use std::os::unix::fs::symlink;

        let (store, _, _) = replay_store();
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let sentinel = outside.path().join("sentinel.webm");
        std::fs::write(&sentinel, b"never inspect or move me").unwrap();
        let linked_root = parent.path().join("rep-replays");
        symlink(outside.path(), &linked_root).unwrap();

        let error = reconcile_rep_replays_in_directory(&linked_root, &store).unwrap_err();
        assert!(error.contains("private directory"), "{error}");
        assert_eq!(
            std::fs::read(sentinel).unwrap(),
            b"never inspect or move me"
        );
    }

    #[cfg(unix)]
    #[test]
    fn dated_directory_and_file_symlinks_are_never_followed() {
        use std::os::unix::fs::symlink;

        let (store, block, attempt) = replay_store();
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_take = outside.path().join("outside.webm");
        std::fs::write(&outside_take, b"outside must stay untouched").unwrap();
        symlink(outside.path(), directory.path().join("2026-08-27")).unwrap();

        let report = reconcile_rep_replays_in_directory(directory.path(), &store).unwrap();
        assert_eq!(report.unsafe_entries_preserved, 1);
        assert_eq!(
            std::fs::read(&outside_take).unwrap(),
            b"outside must stay untouched"
        );
        assert!(store.rep_replay_list(block).unwrap().is_empty());
        assert!(existing_replay_path(
            directory.path(),
            &format!(
                "rep-replays/2026-08-27/{}",
                outside_take.file_name().unwrap().to_string_lossy()
            )
        )
        .is_err());
        assert!(store.rep_replay_attempt_exists(block, attempt).unwrap());
    }
}

// ── Day photos (Plan A, task A3) ───────────────────────────────────────────
//
// The ritual's artefact. Bytes go to `app_data_dir()/day-photos/`; the database
// stores only the day key, the relative path and a content hash (schema v15).
// The thumbnail is produced by the FRONTEND canvas and arrives in the same call,
// so no image codec enters the Rust build.

/// Where day photos live. Created on first save.
fn day_photos_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?
        .join("day-photos");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create day-photos dir: {e}"))?;
    Ok(dir)
}

/// The on-disk path for one day's photo file (`.jpg` or `.thumb.jpg`),
/// validated FIRST — before anything touches the filesystem — and checked a
/// SECOND, independent way (F3 fix wave, path-traversal): `date::is_valid`
/// already forbids `/`, `\`, and `..` by grammar (an exact 10-char
/// YYYY-MM-DD), but a delete command is exactly the place to never trust a
/// single validation layer, so this also asserts the joined path's parent is
/// still literally the day-photos dir before returning it. An absolute-path
/// or `..`-bearing `day` is rejected by BOTH checks independently.
fn day_photo_path(
    dir: &std::path::Path,
    day: &str,
    suffix: &str,
) -> Result<std::path::PathBuf, String> {
    if !date::is_valid(day) {
        return Err("day must be a valid YYYY-MM-DD local date".into());
    }
    let path = dir.join(format!("{day}{suffix}"));
    match path.parent() {
        Some(parent) if parent == dir => Ok(path),
        _ => Err("day photo path escaped the day-photos directory".into()),
    }
}

fn decode_jpeg(field: &str, value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("{field} is not valid base64: {e}"))
}

/// Write both file sizes for `day` under `dir` (the day-photos dir) and
/// return the content hash of the FULL bytes — the single source of truth
/// the DB row's `content_hash` column mirrors. Extracted as a plain,
/// AppHandle-free helper (F6 fix wave) so both the write and the read-side
/// verification below are directly unit-testable: `content_hash` used to be
/// write-only — nothing ever read it back — so a mutation that replaced the
/// real hash computation with a constant left the whole suite green.
fn day_photo_write_files(
    dir: &std::path::Path,
    day: &str,
    full: &[u8],
    thumb: &[u8],
) -> Result<String, String> {
    let full_path = day_photo_path(dir, day, ".jpg")?;
    let thumb_path = day_photo_path(dir, day, ".thumb.jpg")?;
    std::fs::write(&full_path, full).map_err(|e| format!("write day photo: {e}"))?;
    std::fs::write(&thumb_path, thumb).map_err(|e| format!("write day photo thumbnail: {e}"))?;
    Ok(store::sha256_hex(full))
}

/// Read and integrity-check one day's photo bytes — F6 fix wave. Resolves
/// via the row's STORED `rel_path` (never a path reconstructed from the day
/// key — `rel_path` was a second write-only field until now), then verifies
/// the bytes against the row's `content_hash`. A mismatch is treated the
/// same way a missing file already is: an error, never corrupt or
/// substituted bytes served as if they were the real photo.
fn day_photo_read_verified(
    app_data_dir: &std::path::Path,
    row: &store::DayPhotoRow,
) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(app_data_dir.join(&row.rel_path))
        .map_err(|e| format!("read day photo: {e}"))?;
    let actual_hash = store::sha256_hex(&bytes);
    if actual_hash != row.content_hash {
        return Err(format!(
            "day photo for {} failed its integrity check (content hash mismatch)",
            row.day
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod day_photo_integrity_tests {
    use super::*;

    /// F6 fix wave, on a real temp filesystem: proves content_hash is
    /// LOAD-BEARING, not decorative. If `day_photo_write_files`'s hash
    /// computation were replaced with a constant (the exact mutant that
    /// left the whole suite green before this fix wave — M5), this would
    /// fail: the constant would not match the real hash of `full`.
    #[test]
    fn a_written_photo_round_trips_through_the_verified_read() {
        let dir = tempfile::tempdir().unwrap();
        let full = b"pretend full-resolution jpeg bytes";
        let thumb = b"pretend thumbnail jpeg bytes";
        let content_hash = day_photo_write_files(dir.path(), "2026-08-22", full, thumb).unwrap();

        let row = store::DayPhotoRow {
            day: "2026-08-22".to_string(),
            rel_path: "2026-08-22.jpg".to_string(),
            content_hash,
            created_at: "2026-08-22T00:00:00Z".to_string(),
        };
        let read_back = day_photo_read_verified(dir.path(), &row).unwrap();
        assert_eq!(read_back, full);
    }

    /// The kill shot for M5: resolves via the STORED rel_path (a filename
    /// that does NOT match a day-based reconstruction), so this only
    /// passes if rel_path is genuinely being read, not ignored.
    #[test]
    fn resolves_via_the_stored_rel_path_not_a_reconstructed_day_filename() {
        let dir = tempfile::tempdir().unwrap();
        let full = b"bytes under a non-day-shaped filename";
        std::fs::write(dir.path().join("custom-name.jpg"), full).unwrap();
        let row = store::DayPhotoRow {
            day: "2026-08-22".to_string(),
            rel_path: "custom-name.jpg".to_string(),
            content_hash: store::sha256_hex(full),
            created_at: "2026-08-22T00:00:00Z".to_string(),
        };
        // A day-based reconstruction (dir/2026-08-22.jpg) does not exist —
        // this only succeeds by honouring rel_path.
        let read_back = day_photo_read_verified(dir.path(), &row).unwrap();
        assert_eq!(read_back, full);
    }

    /// The other half of the kill shot: a file that has been tampered with
    /// (or truncated, or corrupted) on disk is REJECTED, never served as if
    /// it were the real photo.
    #[test]
    fn a_tampered_file_fails_the_integrity_check_instead_of_being_served() {
        let dir = tempfile::tempdir().unwrap();
        let original = b"the real photo bytes";
        let content_hash =
            day_photo_write_files(dir.path(), "2026-08-22", original, b"thumb").unwrap();
        // Tamper with the file directly, bypassing day_photo_save entirely.
        std::fs::write(dir.path().join("2026-08-22.jpg"), b"corrupted bytes").unwrap();

        let row = store::DayPhotoRow {
            day: "2026-08-22".to_string(),
            rel_path: "2026-08-22.jpg".to_string(),
            content_hash,
            created_at: "2026-08-22T00:00:00Z".to_string(),
        };
        let err = day_photo_read_verified(dir.path(), &row).unwrap_err();
        assert!(err.contains("integrity"), "error should say why: {err}");
    }

    /// A missing file is still just a missing file — the ordinary,
    /// pre-existing "no evidence, no visual" fallback, not treated as a
    /// hash-mismatch/corruption case.
    #[test]
    fn a_missing_file_errors_as_missing_not_as_a_hash_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let row = store::DayPhotoRow {
            day: "2026-08-22".to_string(),
            rel_path: "2026-08-22.jpg".to_string(),
            content_hash: "irrelevant".to_string(),
            created_at: "2026-08-22T00:00:00Z".to_string(),
        };
        let err = day_photo_read_verified(dir.path(), &row).unwrap_err();
        assert!(err.contains("read day photo"), "got: {err}");
    }
}

#[cfg(test)]
mod day_photo_path_tests {
    use super::*;

    fn dir() -> std::path::PathBuf {
        std::path::PathBuf::from("/tmp/day-photos-test/day-photos")
    }

    #[test]
    fn a_valid_day_resolves_inside_the_dir() {
        let path = day_photo_path(&dir(), "2026-08-22", ".jpg").unwrap();
        assert_eq!(path, dir().join("2026-08-22.jpg"));
    }

    #[test]
    fn a_parent_traversal_is_rejected_and_never_reaches_a_path() {
        assert!(day_photo_path(&dir(), "../important-backup", ".jpg").is_err());
    }

    #[test]
    fn a_bare_double_dot_is_rejected() {
        assert!(day_photo_path(&dir(), "..", ".jpg").is_err());
    }

    #[test]
    fn an_absolute_path_is_rejected() {
        assert!(day_photo_path(&dir(), "/etc/passwd", ".jpg").is_err());
    }

    #[test]
    fn an_empty_day_is_rejected() {
        assert!(day_photo_path(&dir(), "", ".jpg").is_err());
    }

    #[test]
    fn a_url_encoded_traversal_is_rejected() {
        // `date::is_valid` never decodes percent-escapes, so this fails the
        // grammar check outright rather than becoming a live ".." after some
        // later decode step this command never performs.
        assert!(day_photo_path(&dir(), "%2e%2e%2fimportant-backup", ".jpg").is_err());
    }

    /// F3 regression, on a real temp filesystem: reproduces the verifier's
    /// exact probe. A victim file sits one level ABOVE a real day-photos
    /// dir; `day_photo_delete`'s body (validate-then-path, never
    /// path-then-validate) must refuse before ever calling `remove_file`, so
    /// the victim survives untouched.
    #[test]
    fn day_photo_delete_never_touches_a_file_outside_day_photos() {
        let root = std::env::temp_dir().join(format!(
            "codakiller-f3-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let photos_dir = root.join("day-photos");
        std::fs::create_dir_all(&photos_dir).unwrap();
        let victim = root.join("important-backup.jpg");
        std::fs::write(&victim, b"do not delete me").unwrap();

        // The exact shape of day_photo_delete's body: resolve BOTH paths
        // through day_photo_path before touching the filesystem at all.
        let attempt = (|| -> Result<(), String> {
            let full_path = day_photo_path(&photos_dir, "../important-backup", ".jpg")?;
            let _ = std::fs::remove_file(full_path);
            Ok(())
        })();

        assert!(attempt.is_err(), "the traversal must be rejected");
        assert!(victim.exists(), "the victim file must survive untouched");

        let _ = std::fs::remove_dir_all(&root);
    }
}

/// Write one day's full photo and its thumbnail, and record the row.
#[tauri::command]
fn day_photo_save(
    day: String,
    jpeg_base64: String,
    thumb_base64: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<(), String> {
    let day = day.trim().to_string();
    let full = decode_jpeg("jpeg_base64", &jpeg_base64)?;
    let thumb = decode_jpeg("thumb_base64", &thumb_base64)?;
    let dir = day_photos_dir(&app)?;
    let content_hash = day_photo_write_files(&dir, &day, &full, &thumb)?;
    store
        .day_photo_upsert(&day, &format!("day-photos/{day}.jpg"), &content_hash)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct DayPhotoThumb {
    day: String,
    thumb_base64: String,
}

/// Every photographed day in `[from,to]`, thumbnails only — one call per
/// visible Calendar week, never one per cell.
#[tauri::command]
fn day_photo_thumbs(
    from: String,
    to: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<Vec<DayPhotoThumb>, String> {
    use base64::Engine as _;
    let dir = day_photos_dir(&app)?;
    let rows = store
        .day_photo_rows(from.trim(), to.trim())
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            // A row whose file has gone missing renders as no photo, not as a
            // broken cell — the bars fall back automatically. A row whose
            // `day` somehow fails the path-safety check (it was validated at
            // insert time, so this should be unreachable) falls back the
            // same way rather than erroring the whole week.
            let path = day_photo_path(&dir, &row.day, ".thumb.jpg").ok()?;
            let bytes = std::fs::read(path).ok()?;
            Some(DayPhotoThumb {
                day: row.day,
                thumb_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect())
}

/// One day's full-resolution photo.
#[tauri::command]
fn day_photo_read(
    day: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<String, String> {
    use base64::Engine as _;
    let row = store
        .day_photo_row(day.trim())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no photo recorded for {}", day.trim()))?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    let bytes = day_photo_read_verified(&app_data_dir, &row)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Remove a day's photo — both files and the row.
#[tauri::command]
fn day_photo_delete(
    day: String,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<(), String> {
    let day = day.trim().to_string();
    let dir = day_photos_dir(&app)?;
    // F3 fix wave: validate (and path-contain) BEFORE any filesystem
    // operation. The old code trimmed the day, joined it straight into a
    // path with no `date::is_valid` check at all, and deleted — a
    // `day = "../important-backup"` deleted a file outside day-photos/
    // before the (unreached) row-delete's own validation ever ran.
    let full_path = day_photo_path(&dir, &day, ".jpg")?;
    let thumb_path = day_photo_path(&dir, &day, ".thumb.jpg")?;
    // Missing files are fine; the row is the record that matters.
    let _ = std::fs::remove_file(full_path);
    let _ = std::fs::remove_file(thumb_path);
    store.day_photo_delete_row(&day).map_err(|e| e.to_string())
}

/// The next-launch rollover prompt: the oldest LOCAL day a midnight
/// auto-close skipped the ritual for that has not yet been photographed, or
/// `None`. F4 fix wave: a non-destructive PEEK, not a read-and-clear — call
/// it as many times as you like (Shell mount, a StrictMode double-invoke,
/// a retry) with zero risk of losing a day. Pair with `day_photo_prompt_dismiss`
/// once the user has actually acted on the day it returns.
#[tauri::command]
fn day_photo_prompt(store: State<'_, Arc<Store>>) -> Result<Option<String>, String> {
    store.day_photo_prompt_peek().map_err(|e| e.to_string())
}

/// Consume exactly one pending rollover day — called once the user has
/// actually acted on it (photographed via `day_photo_save`, or skipped).
/// Idempotent: dismissing a day that was never pending (the common case —
/// a live, same-day end-of-session photo) is a harmless no-op.
#[tauri::command]
fn day_photo_prompt_dismiss(day: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .day_photo_prompt_dismiss(day.trim())
        .map_err(|e| e.to_string())
}

fn rejected_plan(
    command_id: &str,
    error: String,
) -> MutationReceipt<store::SessionPlanStartOutcome> {
    MutationReceipt::rejected(command_id, "session_plan_rejected", error)
}

/// Start one reviewed session plan item as the live rep set. The whole plan is
/// carried through and persisted in the durable receipt; only the item at
/// `start_sequence` opens. A repeated `command_id` replays the committed result
/// without opening a second block; a start while a block is already live is
/// rejected with no partial writes.
#[tauri::command]
fn session_plan_start(
    payload: store::SessionPlanStartPayload,
    rep: State<'_, Arc<RepEngine>>,
) -> MutationReceipt<store::SessionPlanStartOutcome> {
    let command_id = format!("session-plan-start:{}", payload.command_id);
    rep.session_plan_start(&payload)
        .unwrap_or_else(|error| rejected_plan(&command_id, error))
}

// ── Local tutorial video metadata + Region clip mappings ───────────────────

/// Authorize only directories containing paths that already passed the Store's
/// canonical `<piece>/tutorials/` containment check. This keeps the static
/// asset-protocol scope empty and never grants access to the whole home/vault.
fn tutorial_media_directories(
    videos: &[TutorialVideo],
) -> Result<std::collections::HashSet<PathBuf>, String> {
    let mut directories = std::collections::HashSet::new();
    for video in videos {
        let Some(directory) = std::path::Path::new(&video.file_path).parent() else {
            return Err("Tutorial video has no parent directory".into());
        };
        directories.insert(directory.to_path_buf());
    }
    Ok(directories)
}

fn authorize_tutorial_media(app: &AppHandle, videos: &[TutorialVideo]) -> Result<(), String> {
    for directory in tutorial_media_directories(videos)? {
        app.asset_protocol_scope()
            .allow_directory(directory, false)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tutorial_asset_scope_tests {
    use super::*;

    fn video(path: &str) -> TutorialVideo {
        TutorialVideo {
            id: 1,
            piece_id: 1,
            title: "Lesson".into(),
            file_path: path.into(),
            duration_seconds: None,
            clips: vec![],
        }
    }

    #[test]
    fn asset_scope_uses_only_deduplicated_validated_parent_directories() {
        let directories = tutorial_media_directories(&[
            video("/vault/Pieces/Scherzo/tutorials/full.mp4"),
            video("/vault/Pieces/Scherzo/tutorials/overview.mov"),
            video("/vault/Pieces/Scherzo/tutorials/chapters/coda.mp4"),
        ])
        .unwrap();
        assert_eq!(directories.len(), 2);
        assert!(directories.contains(std::path::Path::new("/vault/Pieces/Scherzo/tutorials")));
        assert!(directories.contains(std::path::Path::new(
            "/vault/Pieces/Scherzo/tutorials/chapters"
        )));
    }
}

#[tauri::command]
fn tutorial_video_list(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<Vec<TutorialVideo>, String> {
    let videos = store
        .tutorial_video_list(piece_id)
        .map_err(|error| error.to_string())?;
    authorize_tutorial_media(&app, &videos)?;
    Ok(videos)
}

#[tauri::command]
fn tutorial_video_scan(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<Vec<TutorialVideo>, String> {
    let videos = store
        .tutorial_video_scan(piece_id)
        .map_err(|error| error.to_string())?;
    authorize_tutorial_media(&app, &videos)?;
    Ok(videos)
}

#[tauri::command]
fn tutorial_video_upsert(
    args: TutorialVideoUpsert,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<TutorialVideo, String> {
    let video = store
        .tutorial_video_upsert(args)
        .map_err(|error| error.to_string())?;
    authorize_tutorial_media(&app, std::slice::from_ref(&video))?;
    Ok(video)
}

#[tauri::command]
fn tutorial_video_update(
    id: i64,
    patch: TutorialVideoPatch,
    store: State<'_, Arc<Store>>,
    app: AppHandle,
) -> Result<TutorialVideo, String> {
    let video = store
        .tutorial_video_update(id, patch)
        .map_err(|error| error.to_string())?;
    authorize_tutorial_media(&app, std::slice::from_ref(&video))?;
    Ok(video)
}

#[tauri::command]
fn tutorial_video_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .tutorial_video_delete(id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn tutorial_video_reveal(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    let path = store
        .tutorial_video_file_path(id)
        .map_err(|error| error.to_string())?;
    platform::reveal_file(&path)
}

#[tauri::command]
fn tutorial_clip_create(
    args: TutorialClipCreate,
    store: State<'_, Arc<Store>>,
) -> Result<TutorialClip, String> {
    store
        .tutorial_clip_create(args)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn tutorial_clip_update(
    id: i64,
    patch: TutorialClipPatch,
    store: State<'_, Arc<Store>>,
) -> Result<TutorialClip, String> {
    store
        .tutorial_clip_update(id, patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn tutorial_clip_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .tutorial_clip_delete(id)
        .map_err(|error| error.to_string())
}

// ── T4: Block update/delete ─────────────────────────────────────────────────

/// Apply a partial patch to a rep block. If the block is the active one, the
/// rep engine's live snapshot is resynced and `rep://state` re-emitted.
#[tauri::command]
fn block_update(
    block_id: i64,
    patch: BlockPatch,
    store: State<'_, Arc<Store>>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<BlockHistory, String> {
    let updated = store
        .block_update(block_id, patch)
        .map_err(|e| e.to_string())?;
    rep.resync_active_if(block_id);
    Ok(updated)
}

/// Delete a block and its reps (cascade). If the block was active, the caller
/// is expected to have closed it first; this only resyncs (a no-op if the
/// block is gone from the active snapshot's id).
#[tauri::command]
fn block_delete(
    block_id: i64,
    store: State<'_, Arc<Store>>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<(), String> {
    store.block_delete(block_id).map_err(|e| e.to_string())?;
    rep.resync_active_if(block_id);
    Ok(())
}

// ── T5: Rep update/delete ───────────────────────────────────────────────────

/// Apply a partial patch to one rep (verdict/note). Resyncs the owning
/// block's active snapshot afterward.
#[tauri::command]
fn rep_update(
    rep_id: i64,
    patch: RepPatch,
    store: State<'_, Arc<Store>>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<(), String> {
    let block_id = store.rep_update(rep_id, patch).map_err(|e| e.to_string())?;
    rep.resync_active_if(block_id);
    Ok(())
}

/// Compatibility name for append-only voiding; the source rep remains intact.
#[tauri::command]
fn rep_delete(
    rep_id: i64,
    store: State<'_, Arc<Store>>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<(), String> {
    let block_id = store.rep_delete(rep_id).map_err(|e| e.to_string())?;
    rep.resync_active_if(block_id);
    Ok(())
}

/// Every individual rep for a block, oldest first, for history drill-in.
#[tauri::command]
fn reps_for_block(block_id: i64, store: State<'_, Arc<Store>>) -> Result<Vec<Rep>, String> {
    store.reps_for_block(block_id).map_err(|e| e.to_string())
}

// ── T6: Goal CRUD + reorder ──────────────────────────────────────────────────

/// All goals for a piece, ordered by their sort order.
#[tauri::command]
fn goal_list(piece_id: i64, store: State<'_, Arc<Store>>) -> Result<Vec<Goal>, String> {
    store.goal_list(piece_id).map_err(|e| e.to_string())
}

/// Create a goal.
#[tauri::command]
fn goal_create(args: GoalCreate, store: State<'_, Arc<Store>>) -> Result<Goal, String> {
    store.goal_create(args).map_err(|e| e.to_string())
}

/// Apply a partial patch to a goal.
#[tauri::command]
fn goal_update(id: i64, patch: GoalPatch, store: State<'_, Arc<Store>>) -> Result<Goal, String> {
    store.goal_update(id, patch).map_err(|e| e.to_string())
}

/// Delete a goal.
#[tauri::command]
fn goal_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.goal_delete(id).map_err(|e| e.to_string())
}

/// Reassign every goal's sort order to match `ordered_ids`' array index.
#[tauri::command]
fn goal_reorder(
    piece_id: i64,
    ordered_ids: Vec<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store
        .goal_reorder(piece_id, ordered_ids)
        .map_err(|e| e.to_string())
}

// ── T7: Inline piece-field update ───────────────────────────────────────────

/// Update any of a piece's inline-editable intake fields (current_state,
/// deadline, target_tempo, notes). Appends no event — see [`PieceFieldPatch`].
#[tauri::command]
fn piece_field_update(
    piece_id: i64,
    patch: PieceFieldPatch,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store
        .piece_field_update(piece_id, patch)
        .map_err(|e| e.to_string())
}

/// A piece's derived progress dashboard (focused time, per-region mastery,
/// streak, best tempo, time-by-focus), computed from the durable event log and
/// canonical graph. Nothing is stored — the summary always reflects the current graph.
#[tauri::command]
fn progress_summary(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<ProgressSummary, String> {
    metrics::progress_summary(&store, piece_id).map_err(|e| e.to_string())
}

/// Read-only, all-piece Practice Universe signals derived from canonical work.
#[tauri::command]
fn universe_snapshot(store: State<'_, Arc<Store>>) -> Result<universe::UniverseSnapshot, String> {
    universe::snapshot(&store).map_err(|error| error.to_string())
}

/// Read-only disclosure of every migration/backfill-observed data anomaly,
/// grouped by kind with counts. Anomalies are projected, never repaired; this
/// command performs no writes and offers no correction actions.
#[tauri::command]
fn anomalies_list(store: State<'_, Arc<Store>>) -> Result<anomalies::AnomalyReport, String> {
    anomalies::report(&store).map_err(|error| error.to_string())
}

/// Read-only, deterministic next-work ranking. The brain can narrate this
/// trace, but it cannot change the ordering or write a schedule.
#[tauri::command]
fn brain_plan_preview(
    piece_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<planner::WorkSuggestion>, String> {
    brain::require_assistant_enabled(&store).map_err(|error| error.reason())?;
    let id =
        piece_id.ok_or_else(|| "Pick a piece before asking what to practice next".to_string())?;
    planner::preview_for_piece(&store, id).map_err(|error| error.to_string())
}

/// Answer an open practice question from a bounded, read-only context. This is
/// intentionally asynchronous and separate from the deterministic voice/rep
/// loop; provider calls can never block a verdict or metronome command.
#[tauri::command]
async fn brain_ask(
    request: brain::BrainAskRequest,
    store: State<'_, Arc<Store>>,
    sessions: State<'_, Arc<SessionService>>,
    rep: State<'_, Arc<RepEngine>>,
    voice: State<'_, Arc<VoiceLoop>>,
    pending_reviews: State<'_, Arc<brain::PendingIntakeReviews>>,
) -> Result<brain::BrainAnswer, String> {
    let should_speak = brain::should_speak_answer(request.source);
    let store = store.inner().clone();
    let sessions = sessions.inner().clone();
    // Durable-memory targets captured before `request` moves into the worker.
    let thread_id = request.thread_id;
    let thread_store = store.clone();
    let thread_question = request.question.trim().to_string();
    // Snapshot before entering the blocking provider worker. This keeps the
    // RepEngine authoritative without moving live state across that boundary.
    let active_rep = rep.snapshot();
    let answer = tauri::async_runtime::spawn_blocking(move || {
        brain::ask_native(request, store, sessions, active_rep)
    })
    .await
    .map_err(|_| "Brain worker stopped unexpectedly".to_string())?
    .map_err(|error| error.to_string())?;
    // Persist the completed exchange to the piece's Brain thread. This runs only
    // after a real answer (offline answers included, tagged by provider). It is
    // best-effort: the user already saw the answer, so a persistence failure
    // must never become an answer error, and it never touches practice state.
    if let (Some(thread_id), false) = (thread_id, thread_question.is_empty()) {
        let provider = serde_json::to_value(answer.provider)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| "offline".to_string());
        let citations_json =
            serde_json::to_string(&answer.citations).unwrap_or_else(|_| "[]".to_string());
        let _ = thread_store.brain_turn_append(thread_id, "user", &thread_question, None, "[]");
        let _ = thread_store.brain_turn_append(
            thread_id,
            "assistant",
            &answer.answer,
            Some(&provider),
            &citations_json,
        );
    }
    pending_reviews.register_answer(&answer);
    if should_speak {
        // Non-blocking queue into the existing gated TTS owner. A visual answer
        // still returns if voice shut down while the provider was working, and
        // citation ids never reach the speech path.
        let _ = voice.speak_brain_answer(&brain::spoken_answer(&answer));
    }
    Ok(answer)
}

/// Whole-score MusicXML measure landmarks for the mapping wizard's measure
/// strip (ledger #31). Reuses the same score resolution and parser as
/// `brain_ask`'s grounded context. Runs off the UI thread on the blocking pool
/// and never mutates practice state.
#[tauri::command]
async fn score_xml_measure_facts(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<brain::XmlMeasureFacts, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || brain::score_xml_measure_facts(&store, piece_id))
        .await
        .map_err(|_| "Score facts worker stopped unexpectedly".to_string())?
}

/// Resume (or create) the piece's active Brain conversation thread and return
/// its bounded recent turns. Read-or-create only; never mutates practice state.
#[tauri::command]
fn brain_thread_resume(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<store::model::BrainThreadResume, String> {
    store
        .brain_thread_resume(piece_id)
        .map_err(|error| error.to_string())
}

/// "Clear / new conversation": mark the piece's active thread cleared so the
/// next resume starts fresh. Turns are preserved (never deleted), not practice.
#[tauri::command]
fn brain_thread_clear(piece_id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .brain_thread_clear(piece_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn brain_intake_apply(
    request: brain::BrainIntakeApplyRequest,
    store: State<'_, Arc<Store>>,
    pending_reviews: State<'_, Arc<brain::PendingIntakeReviews>>,
) -> Result<brain::BrainIntakeApplyResult, String> {
    brain::apply_intake_review(request, &store, &pending_reviews).map_err(|error| error.to_string())
}

/// Truthful, no-network Brain status: whether a provider is configured and, if
/// not, why. Reflects key presence + the provider setting only; it never makes a
/// provider call, so it is safe to poll for the status line.
#[tauri::command]
fn brain_status(store: State<'_, Arc<Store>>) -> Result<brain::BrainStatus, String> {
    Ok(brain::status_native(&store))
}

/// Real Brain round-trip for the "Test connection" button. Runs the network
/// call on the blocking pool (like `brain_ask`), and reports the exact truthful
/// outcome — provider/model/latency on success, or the failure reason.
#[tauri::command]
async fn brain_test_connection(
    store: State<'_, Arc<Store>>,
) -> Result<brain::BrainTestResult, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || brain::test_connection_native(&store))
        .await
        .map_err(|_| "Brain test worker stopped unexpectedly".to_string())
}

#[tauri::command]
fn daily_work_list(
    from: String,
    to: String,
    piece_id: Option<i64>,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<store::calendar::DailyWorkView>, String> {
    store
        .daily_work_list(&from, &to, piece_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn daily_work_create(
    args: DailyWorkCreate,
    store: State<'_, Arc<Store>>,
) -> Result<store::calendar::DailyWorkView, String> {
    store
        .daily_work_create(args)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn daily_work_update(
    id: i64,
    expected_updated_ts: String,
    patch: DailyWorkPatch,
    store: State<'_, Arc<Store>>,
) -> Result<store::calendar::DailyWorkView, String> {
    store
        .daily_work_update(id, &expected_updated_ts, patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn daily_work_delete(
    id: i64,
    expected_updated_ts: String,
    store: State<'_, Arc<Store>>,
) -> Result<(), String> {
    store
        .daily_work_delete(id, &expected_updated_ts)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recovery_preview(
    store: State<'_, Arc<Store>>,
) -> Result<store::calendar::CalendarRecoveryPreview, String> {
    store.recovery_preview().map_err(|error| error.to_string())
}

#[tauri::command]
fn recovery_apply(
    decisions: Vec<store::calendar::RecoveryDecision>,
    store: State<'_, Arc<Store>>,
) -> Result<store::calendar::RecoveryApplyResult, String> {
    store
        .recovery_apply(decisions)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn calendar_capacity_set(minutes: u32, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store
        .calendar_capacity_set(minutes)
        .map_err(|error| error.to_string())
}

/// Mute (`true`) or unmute the mic. Gates STT and blocks any action while muted.
#[tauri::command]
fn voice_mute(muted: bool, voice: State<'_, Arc<VoiceLoop>>) {
    voice.set_muted(muted);
}

/// Release the native STT microphone process for an exclusive audio-review
/// owner. The returned epoch is an exact lease and must be supplied to resume.
#[tauri::command]
fn voice_capture_suspend(
    request_id: String,
    voice: State<'_, Arc<VoiceLoop>>,
) -> Result<u64, String> {
    voice.suspend_capture(&request_id)
}

/// Return one exact exclusive-capture lease. Request identity makes an
/// unmount-safe release-before-acquire race inert; `true` means this call
/// returned the final lease and restarted STT.
#[tauri::command]
fn voice_capture_resume(
    request_id: String,
    voice: State<'_, Arc<VoiceLoop>>,
) -> Result<bool, String> {
    voice.resume_capture(&request_id)
}

/// Current mic status (muted / down reason) for the top-bar glyph.
#[tauri::command]
fn voice_state(voice: State<'_, Arc<VoiceLoop>>) -> VoiceStatus {
    voice.state()
}

/// `true` while the cloud voice is on cooldown and utterances are coming from
/// the macOS `say` voice instead. Transitions also arrive live on `voice://tts`;
/// this is the initial read for a UI that mounts mid-cooldown.
#[tauri::command]
fn tts_degraded() -> bool {
    tts::status_hub().degraded()
}

/// Speak a bounded app-owned confirmation prompt through the same half-duplex
/// TTS owner as Brain answers. This is presentation only: it cannot route an
/// intent or mutate practice state.
#[tauri::command]
fn voice_speak(text: String, voice: State<'_, Arc<VoiceLoop>>) -> Result<(), String> {
    // A Brain answer is speech he asked to be turned off, and unlike a command
    // ack it has no chime shorthand — there is nothing to substitute, so the
    // answer simply is not spoken. Reported as success: nothing failed, and the
    // caller has already rendered the text.
    if voice.speech_muted() {
        return Ok(());
    }
    voice.speak_brain_answer(&text)
}

/// Serve one piece's PDF edition over the `ckscore://` scheme with HTTP Range
/// support, so PDF.js can pull the xref plus only the objects page 1 needs
/// instead of receiving a whole 8.6 MB image scan across IPC.
///
/// Registered asynchronously and answered from `spawn_blocking`: the seek+read
/// must never sit on an async runtime thread.
fn register_score_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(
        score::serve::SCHEME,
        |context, request, responder| {
            let Some(store) = context.app_handle().try_state::<Arc<Store>>() else {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::SERVICE_UNAVAILABLE)
                        .header(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(b"score store is not ready".to_vec())
                        .expect("static 503 response is well formed"),
                );
                return;
            };
            let store = store.inner().clone();
            let path = request.uri().path().to_string();
            let range = request
                .headers()
                .get(tauri::http::header::RANGE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            // The webview origin differs per platform, so log the real thing
            // once instead of assuming it (see NOTES). Only the first request
            // per launch logs, to keep a range-heavy load quiet.
            static LOGGED: std::sync::Once = std::sync::Once::new();
            LOGGED.call_once(|| {
                eprintln!(
                    "ckscore: first request uri={} origin={:?}",
                    request.uri(),
                    request
                        .headers()
                        .get(tauri::http::header::ORIGIN)
                        .and_then(|value| value.to_str().ok())
                );
            });
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(score::serve::respond(&store, &path, range.as_deref(), "*"));
            });
        },
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_score_protocol(tauri::Builder::default())
        .setup(|app| {
            // DB lives under Tauri's per-app data dir; parent dirs may not exist
            // on first launch, so create them before opening.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let store = Store::open(dir.join("codakiller.db"))?;
            initialize_pieces_dir(&store, &dir).map_err(std::io::Error::other)?;
            match reconcile_rep_replays_in_directory(&dir.join("rep-replays"), &store) {
                Ok(report) if report != RepReplayReconcileReport::default() => {
                    eprintln!("rep-replays: startup reconciliation {report:?}");
                }
                Ok(_) => {}
                // Replay maintenance is intentionally conservative and must
                // not prevent the practice tracker from launching. A failure
                // leaves every ambiguous row/file in place and is visible in
                // the native log for manual recovery.
                Err(error) => eprintln!("rep-replays: startup reconciliation skipped: {error}"),
            }

            // Load click sounds (dev + bundled paths). A load failure is
            // non-fatal: the metronome then runs silent rather than crashing.
            let clicks_dir = resolve_clicks_dir(app);
            let sounds = audio::mixer::load_clicks(&clicks_dir).unwrap_or_else(|e| {
                eprintln!("metronome: failed to load clicks from {clicks_dir:?}: {e}");
                Default::default()
            });
            let state = metronome::load_state(&store);
            let boost_level = metronome::load_boost_level(&store);
            let wake_word = (store
                .get_setting("voice.wake_word_enabled")
                .ok()
                .flatten()
                .as_deref()
                == Some("true"))
            .then(|| {
                store
                    .get_setting("voice.wake_word")
                    .ok()
                    .flatten()
                    .filter(|word| !word.trim().is_empty())
            })
            .flatten();
            // Managed behind `Arc` so the async commands can clone a `'static`
            // handle into `spawn_blocking` (the blocking work runs off the main
            // thread). The voice loop shares these same Arcs.
            let metro = Arc::new(Metronome::new(sounds, state, boost_level));
            let store = Arc::new(store);

            // Session log + rep engine share the store. Both emit app events
            // (`session://event`, `rep://state`) through the Tauri AppHandle,
            // installed here now that it exists. The voice loop drives the SAME
            // Arcs so a block opened by voice is the block the UI sees.
            let sessions = Arc::new(SessionService::new(store.clone()));
            let rep = Arc::new(RepEngine::new(store.clone(), sessions.clone()));
            if let Some(snapshot) = rep.snapshot().filter(|snapshot| snapshot.use_metronome) {
                metro.serialized(|| {
                    metro.restore_practice_owner(snapshot.block_id);
                });
            }
            let app_emitter: Arc<dyn StateEmitter> = Arc::new(AppEmitter(app.handle().clone()));
            sessions.set_emitter(app_emitter.clone());
            rep.set_emitter(app_emitter);
            // Task A5: day-rollover auto-pause goes through the rep engine's own
            // pause path (never a raw store write) so its in-memory active-block
            // cache stays in sync.
            sessions.set_rollover_pause_hook(rep.clone());

            app.manage(metro.clone());
            // The dynamics meter owns its own cpal INPUT stream; it is created
            // stopped and never opens the mic until the dock panel asks.
            app.manage(Arc::new(DynamicsMeter::new()));
            app.manage(store.clone());
            app.manage(sessions.clone());
            app.manage(rep.clone());
            app.manage(Arc::new(brain::PendingIntakeReviews::default()));

            // Start the end-to-end voice loop (STT → intent → metronome + spoken
            // confirmation). Managed so `voice_mute`/`voice_state` reach it and so
            // it is torn down on exit. It gates itself; a missing `hear` binary or
            // disabled Dictation surfaces as a `voice://status` down event, never a
            // crash.
            // v6 S9: publish cloud-voice degraded/recovered transitions to the UI
            // (the "Voice degraded — using system voice" pill). The TTS provider
            // is built on the voice action thread with no AppHandle in reach, so
            // it reports through the process-global status hub and this listener
            // turns each transition into a `voice://tts` event. Transitions only —
            // never per failure.
            let tts_app = app.handle().clone();
            tts::status_hub().set_listener(Box::new(move |degraded| {
                if let Err(e) =
                    tts_app.emit("voice://tts", serde_json::json!({ "degraded": degraded }))
                {
                    eprintln!("app: failed to emit voice://tts: {e}");
                }
            }));

            let stt_config = resolve_stt_config(app);
            let voice = VoiceLoop::start(
                &app.handle().clone(),
                metro,
                store.clone(),
                rep.clone(),
                sessions.clone(),
                stt_config,
                wake_word,
            );
            app.manage(voice);

            // Prime the piece list from the vault on a background thread so first
            // paint is never blocked on a filesystem scan. Best-effort: a missing
            // vault yields an empty scan (never a panic), and any upsert error is
            // logged rather than propagated — the UI can always re-trigger
            // `pieces_scan` manually.
            let scan_store = store.clone();
            std::thread::spawn(move || {
                if let Err(e) = ingest_pieces(&scan_store) {
                    eprintln!("vault: startup piece scan failed: {e}");
                }
            });

            // A raw POSIX SIGTERM/SIGINT/SIGHUP to the app bypasses Tauri's
            // graceful `CloseRequested`/`ExitRequested` cleanup, which would
            // orphan the `hear` child (it lives in its own process group) and leak
            // the microphone. Install an async-signal-safe handler that kills the
            // `hear` group before the process dies. See `stt::install_termination_handler`.
            #[cfg(unix)]
            stt::install_termination_handler();

            // An AppleEvent quit (`osascript 'quit app'` — and possibly other
            // NSApp-terminate paths) tears the process down WITHOUT delivering
            // `RunEvent::ExitRequested` OR a POSIX signal (verified live
            // 2026-07-10: the run-loop arm below never fired; `hear` was
            // orphaned holding the mic and the boosted volume was stranded).
            // `atexit` runs on every normal process exit including NSApp
            // terminate, so it is the path-independent backstop for the two
            // cleanups that must never be skipped. The open session is
            // deliberately NOT ended here: the next launch adopts it
            // (`SessionService`/`latest_open_session`) and exports it on the
            // next graceful end — nothing is lost, only deferred.
            #[cfg(unix)]
            {
                extern "C" fn exit_backstop() {
                    stt::kill_current_hear_group();
                    sysvol::restore_stranded_boost();
                }
                // Safe: registering a plain extern "C" fn to run at normal exit.
                unsafe {
                    libc::atexit(exit_backstop);
                }
            }
            Ok(())
        })
        // Restore the system volume on window close: a boosted volume must never
        // outlive the app. (BoostGuard::Drop is the in-process backstop; a hard
        // `kill -9` is the one path we cannot cover — see sysvol docs.)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Closing the window is the most natural "practice is over"
                // gesture, and (unlike an NSApp-terminate quit) it reliably
                // reaches us — so end + export the session here, BEFORE tearing
                // the pipelines down. Idempotent with the ExitRequested arm:
                // ending twice is a no-op (`latest_open_session` only finds
                // sessions with `ended_at IS NULL`).
                if let (Some(store), Some(rep)) = (
                    window.try_state::<Arc<Store>>(),
                    window.try_state::<Arc<RepEngine>>(),
                ) {
                    finalize_practice_on_exit(&store, &rep);
                }
                if let Some(voice) = window.try_state::<Arc<VoiceLoop>>() {
                    voice.shutdown();
                }
                if let Some(metro) = window.try_state::<Arc<Metronome>>() {
                    metro.shutdown();
                }
                // The mic must never outlive the window.
                if let Some(meter) = window.try_state::<Arc<DynamicsMeter>>() {
                    meter.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            variant_library_get,
            variant_library_save,
            settings_snapshot,
            settings_update,
            api_key_save,
            api_key_clear,
            measure_mapping_status,
            reference_open,
            imslp_search,
            imslp_editions,
            imslp_open_download,
            layout_get,
            layout_set,
            pieces_scan,
            pieces_list,
            piece_import_pdf,
            piece_archive_set,
            piece_folders_list,
            piece_folder_create,
            piece_folder_rename,
            piece_folder_delete,
            piece_folder_reparent,
            piece_move,
            piece_complete_set,
            piece_create_from_pdf,
            piece_remove,
            piece_movement_list,
            piece_movement_create,
            piece_movement_update,
            piece_movement_delete,
            warmup_routines_list,
            warmup_routine_save,
            warmup_routine_delete,
            warmup_system_piece,
            piece_open_source_url,
            downloads_list,
            pick_import_file,
            piece_get,
            score_pdf_editions,
            score_pdf_select,
            score_pdf_bytes,
            score_page_image,
            score_page_image_warm,
            score_page_cache_load,
            score_page_cache_save,
            piece_intake_save,
            piece_banner_set,
            piece_select,
            rep_open,
            rep_check,
            rep_undo,
            rep_correct,
            rep_adjustment_reverse,
            rep_restart,
            rep_close,
            rep_state,
            rep_replay_save,
            rep_replay_list,
            rep_replay_read,
            rep_replay_delete,
            sets_paused_list,
            rep_pause,
            rep_resume,
            rep_checkpoint,
            rep_reflect,
            rep_safety_stop,
            rep_recovery,
            retention_due,
            retention_snooze,
            retention_confirm,
            retention_lower,
            retention_reopen,
            rep_blocks_for_piece,
            region_list,
            region_create,
            region_update,
            region_delete,
            region_merge,
            region_split,
            score_micro_target_create,
            score_atlas_target_save,
            score_calibration_save,
            score_calibration_get,
            score_marks_page,
            score_mark_add,
            score_mark_undo,
            score_marks_clear_page,
            measure_map_get,
            measure_map_apply,
            measure_map_clear,
            measure_scan_page,
            measure_reconcile,
            day_sheet_get,
            day_sheet_save,
            piece_plan_get,
            piece_plan_save,
            history_days,
            streak_summary,
            day_photo_save,
            day_photo_thumbs,
            day_photo_read,
            day_photo_delete,
            day_photo_prompt,
            day_photo_prompt_dismiss,
            history_day_detail,
            day_sheets_range,
            session_plan_start,
            tutorial_video_list,
            tutorial_video_scan,
            tutorial_video_upsert,
            tutorial_video_update,
            tutorial_video_delete,
            tutorial_video_reveal,
            tutorial_clip_create,
            tutorial_clip_update,
            tutorial_clip_delete,
            block_update,
            block_delete,
            rep_update,
            rep_delete,
            reps_for_block,
            goal_list,
            goal_create,
            goal_update,
            goal_delete,
            goal_reorder,
            piece_field_update,
            progress_summary,
            universe_snapshot,
            anomalies_list,
            brain_plan_preview,
            brain_ask,
            score_xml_measure_facts,
            brain_thread_resume,
            brain_thread_clear,
            brain_intake_apply,
            brain_status,
            brain_test_connection,
            daily_work_list,
            daily_work_create,
            daily_work_update,
            daily_work_delete,
            recovery_preview,
            recovery_apply,
            calendar_capacity_set,
            session_current,
            session_end,
            metronome::metro_start,
            metronome::metro_stop,
            metronome::metro_set,
            metronome::metro_state,
            metronome::metro_practice_start,
            metronome::metro_practice_restart,
            metronome::metro_practice_pause,
            metronome::metro_practice_resume,
            metronome::metro_practice_retune,
            metronome::metro_practice_close,
            dynamics::dynamics_meter_start,
            dynamics::dynamics_meter_stop,
            dynamics::dynamics_meter_state,
            dynamics_profile_save,
            dynamics_profile_list,
            dynamics_profile_activate,
            voice_mute,
            voice_capture_suspend,
            voice_capture_resume,
            voice_state,
            tts_degraded,
            voice_speak,
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
                // Best-effort session export on quit. Must never block exit for
                // long or panic: end_and_export only reads the event log + appends
                // a small markdown file, and any I/O error inside is swallowed.
                if let (Some(store), Some(rep)) = (
                    app_handle.try_state::<Arc<Store>>(),
                    app_handle.try_state::<Arc<RepEngine>>(),
                ) {
                    finalize_practice_on_exit(&store, &rep);
                }
                if let Some(voice) = app_handle.try_state::<Arc<VoiceLoop>>() {
                    voice.shutdown();
                }
                if let Some(metro) = app_handle.try_state::<Arc<Metronome>>() {
                    metro.shutdown();
                }
            }
        });
}
