mod anomalies;
pub mod audio;
mod brain;
mod date;
pub mod imslp;
pub mod intent;
mod keys;
mod knowledge;
pub mod ledger;
mod metrics;
mod metronome;
mod pieces;
mod planner;
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

use metronome::Metronome;
use rep::{RepEngine, RepVerdict};
use sessions::{SessionService, StateEmitter};
use store::model::{
    BlockHistory, BlockPatch, CheckOutcome, DailyWorkCreate, DailyWorkPatch, ExportResult, Goal,
    GoalCreate, GoalPatch, Intake, MutationReceipt, PanelLayout, PieceDetail, PieceFieldPatch,
    PieceSummary, ProgressSummary, RecoveryActionRequest, Region, RegionCreate, RegionPatch, Rep,
    RepOpenArgs, RepPatch, RepSnapshot, RetentionCheckView, RetentionResult, SessionView,
    SetFocusContextInput, TutorialClip, TutorialClipCreate, TutorialClipPatch, TutorialVideo,
    TutorialVideoPatch, TutorialVideoUpsert,
};
use store::Store;
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
fn settings_snapshot(store: State<'_, Arc<Store>>) -> settings::SettingsSnapshot {
    settings::snapshot(&store)
}

#[tauri::command]
fn settings_update(
    patch: settings::SettingsPatch,
    store: State<'_, Arc<Store>>,
) -> Result<settings::SettingsSnapshot, String> {
    settings::update(&store, patch)
}

#[tauri::command]
fn api_key_save(provider: keys::ApiKeyProvider, key: String) -> Result<keys::ApiKeyStatus, String> {
    keys::save_api_key(provider, &key)
}

#[tauri::command]
fn api_key_clear(provider: keys::ApiKeyProvider) -> Result<keys::ApiKeyStatus, String> {
    keys::clear_api_key(provider)
}

#[tauri::command]
fn reference_open(
    piece_id: i64,
    provider: references::ReferenceProvider,
    store: State<'_, Arc<Store>>,
) -> Result<references::ReferenceOpenResult, String> {
    references::open_reference(&store, piece_id, provider)
}

/// Search IMSLP for a work by title/composer. Returns up to 20 hits; an empty
/// list means "no results," not an error.
#[tauri::command]
fn imslp_search(query: String) -> Result<Vec<imslp::WorkHit>, String> {
    imslp::ImslpClient::new().search(&query)
}

/// List the downloadable editions of an IMSLP work page. A work with no score
/// files returns an empty list (audio-only / misfiled), which the picker shows
/// as "no scores found" rather than treating as an error.
#[tauri::command]
fn imslp_editions(page_title: String) -> Result<Vec<imslp::Edition>, String> {
    imslp::ImslpClient::new().editions(&page_title)
}

/// Resolve one edition file's direct URL (via `imageinfo`) and open it in the
/// user's system browser so THEY can clear IMSLP's one-time CAPTCHA and let the
/// browser download the PDF. The app never fetches the CAPTCHA-gated bytes
/// itself. Returns the resolved [`imslp::FileInfo`] so the UI can show size/mime.
#[tauri::command]
fn imslp_open_download(file_name: String) -> Result<imslp::FileInfo, String> {
    let info = imslp::ImslpClient::new().file_url(&file_name)?;
    // Defense in depth: only ever hand an https URL to the system browser.
    if !info.url.starts_with("https://") {
        return Err("IMSLP returned a non-https download URL; refusing to open it.".into());
    }
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&info.url)
        .status()
        .map_err(|_| "macOS could not open the IMSLP download in your browser.".to_string())?;
    if status.success() {
        Ok(info)
    } else {
        Err("macOS rejected the IMSLP download handoff.".into())
    }
}

/// Open an `https` URL in the user's system browser. Shared by the paste-URL
/// score-download fallback; refuses anything that is not `https`.
fn open_in_browser(url: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|_| "macOS could not open the link in your browser.".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("macOS rejected the browser handoff.".into())
    }
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

/// Archive a piece: move its vault folder into `.trash/` and re-point its DB row
/// so it leaves the Pieces workspace while all practice history is preserved.
/// `typed_name` must exactly match the piece's folder name or title. Returns the
/// refreshed piece list.
#[tauri::command]
fn piece_archive(
    folder_name: String,
    typed_name: String,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<PieceSummary>, String> {
    let dir = pieces_dir(&store);
    pieces::archive(&dir, &store, &folder_name, &typed_name)?;
    store.list_pieces().map_err(|e| e.to_string())
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
fn downloads_list() -> Result<Vec<DownloadEntry>, String> {
    let home = std::env::var("HOME").map_err(|_| "No home directory.".to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
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
    let output = std::process::Command::new("/usr/bin/osascript")
        .args([
            "-e",
            "POSIX path of (choose file with prompt \"Choose the downloaded score\")",
        ])
        .output()
        .map_err(|_| "Could not open the file picker.".to_string())?;
    if !output.status.success() {
        // Non-zero includes the user pressing Cancel (osascript -128): no file.
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if path.is_empty() { None } else { Some(path) })
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

/// The vault pieces directory: the `vault.pieces_dir` setting, or the shipped
/// default when it has never been set. Kept in one place so the startup scan and
/// the `pieces_scan` command always agree on where pieces live.
const DEFAULT_PIECES_DIR: &str = "/Users/c3/Desktop/christian's universe/Piano Practice/Pieces";

pub(crate) fn pieces_dir(store: &Store) -> PathBuf {
    store
        .get_setting("vault.pieces_dir")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_PIECES_DIR))
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
fn pieces_list(store: State<'_, Arc<Store>>) -> Result<Vec<PieceSummary>, String> {
    store.list_pieces().map_err(|e| e.to_string())
}

/// Full detail for one piece.
#[tauri::command]
fn piece_get(id: i64, store: State<'_, Arc<Store>>) -> Result<PieceDetail, String> {
    store
        .get_piece(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("piece {id} not found"))
}

/// Every real PDF edition directly inside this piece's `score/` folder or
/// piece root. Edition ids are stable piece-relative paths, never arbitrary
/// filesystem paths supplied by the frontend.
#[tauri::command]
fn score_pdf_editions(
    piece_id: i64,
    store: State<'_, Arc<Store>>,
) -> Result<Vec<score::PdfEdition>, String> {
    score::pdf_editions(&store, piece_id)
}

/// Choose one of the securely re-discovered editions as this piece's default.
#[tauri::command]
fn score_pdf_select(
    piece_id: i64,
    edition_id: String,
    store: State<'_, Arc<Store>>,
) -> Result<score::PdfEdition, String> {
    score::select_pdf(&store, piece_id, &edition_id)
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
    rep: State<'_, Arc<RepEngine>>,
) -> Result<RepSnapshot, String> {
    match context {
        Some(context) => rep.open_with_context(args, Some(context)),
        None => rep.open(args),
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

fn rejected_snapshot(command_id: &str, error: String) -> MutationReceipt<RepSnapshot> {
    MutationReceipt::rejected(command_id, "practice_rejected", error)
}

fn rejected_retention(command_id: &str, error: String) -> MutationReceipt<RetentionCheckView> {
    MutationReceipt::rejected(command_id, "retention_rejected", error)
}

#[tauri::command]
fn rep_pause(command_id: String, rep: State<'_, Arc<RepEngine>>) -> MutationReceipt<RepSnapshot> {
    rep.pause(&command_id)
        .unwrap_or_else(|error| rejected_snapshot(&command_id, error))
}

#[tauri::command]
fn rep_resume(command_id: String, rep: State<'_, Arc<RepEngine>>) -> MutationReceipt<RepSnapshot> {
    rep.resume(&command_id)
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

/// Create a region.
#[tauri::command]
fn region_create(args: RegionCreate, store: State<'_, Arc<Store>>) -> Result<Region, String> {
    store.region_create(args).map_err(|e| e.to_string())
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

/// Delete a region (member blocks are kept, unlinked).
#[tauri::command]
fn region_delete(id: i64, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.region_delete(id).map_err(|e| e.to_string())
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
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|error| format!("Could not open Finder: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Finder could not reveal the tutorial video".into())
    }
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
    let should_speak = matches!(request.source, brain::QuestionSource::Voice);
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
        // still returns if voice shut down while the provider was working.
        let _ = voice.speak_brain_answer(&answer.answer);
    }
    Ok(answer)
}

/// Passage-helper (spec C4): 2–4 grounded one-line practice strategies for a
/// described passage, or — in expand mode — one fuller version of a selected
/// strategy. Reads and suggests only: it builds the same bounded, read-only
/// context as `brain_ask`, has no practice-mutation authority, and never enters
/// the deterministic voice/rep loop. Offline / no key returns an honest error.
#[tauri::command]
async fn assistant_suggest(
    piece_id: i64,
    description: String,
    region_id: Option<i64>,
    expand_of: Option<String>,
    store: State<'_, Arc<Store>>,
    sessions: State<'_, Arc<SessionService>>,
) -> Result<brain::AssistantSuggestions, String> {
    let store = store.inner().clone();
    let sessions = sessions.inner().clone();
    let request = brain::AssistantSuggestRequest {
        piece_id,
        description,
        region_id,
        expand_of,
    };
    tauri::async_runtime::spawn_blocking(move || {
        brain::assistant_suggest_native(request, store, sessions)
    })
    .await
    .map_err(|_| "Assistant worker stopped unexpectedly".to_string())?
    .map_err(|error| error.to_string())
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

/// List every book in the knowledge-folder manifest with its file availability.
/// Bootstraps `books.json` from the built-ins on first read (zero action).
#[tauri::command]
fn books_list(store: State<'_, Arc<Store>>) -> Result<Vec<brain::BookListing>, String> {
    brain::list_books(&store)
}

/// Add a book: validate the `.md` source, copy it into the knowledge folder
/// (collision-safe), and append a manifest entry. The frontend owns the dialog.
#[tauri::command]
fn book_add(
    path: String,
    title: String,
    author: String,
    kind: brain::BookKind,
    store: State<'_, Arc<Store>>,
) -> Result<brain::BookListing, String> {
    brain::add_book(&store, &path, &title, &author, kind)
}

/// Remove a book: drop the manifest entry and move its file to `.trash/`.
/// Never hard-deletes; built-in books are removable by the same path.
#[tauri::command]
fn book_remove(id: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    brain::remove_book(&store, &id)
}

/// Reader source (D2): the markdown section around a quote, located by verbatim
/// `contains` substring and/or the nearest `heading` match.
#[tauri::command]
fn book_excerpt(
    source_id: String,
    heading: Option<String>,
    contains: Option<String>,
    store: State<'_, Arc<Store>>,
) -> Result<brain::BookExcerpt, String> {
    brain::book_excerpt(&store, &source_id, heading.as_deref(), contains.as_deref())
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

/// Current mic status (muted / down reason) for the top-bar glyph.
#[tauri::command]
fn voice_state(voice: State<'_, Arc<VoiceLoop>>) -> VoiceStatus {
    voice.state()
}

/// Speak a bounded app-owned confirmation prompt through the same half-duplex
/// TTS owner as Brain answers. This is presentation only: it cannot route an
/// intent or mutate practice state.
#[tauri::command]
fn voice_speak(text: String, voice: State<'_, Arc<VoiceLoop>>) -> Result<(), String> {
    voice.speak_brain_answer(&text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            app.manage(metro.clone());
            app.manage(store.clone());
            app.manage(sessions.clone());
            app.manage(rep.clone());
            app.manage(Arc::new(brain::PendingIntakeReviews::default()));

            // Start the end-to-end voice loop (STT → intent → metronome + spoken
            // confirmation). Managed so `voice_mute`/`voice_state` reach it and so
            // it is torn down on exit. It gates itself; a missing `hear` binary or
            // disabled Dictation surfaces as a `voice://status` down event, never a
            // crash.
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
            extern "C" fn exit_backstop() {
                stt::kill_current_hear_group();
                sysvol::restore_stranded_boost();
            }
            // Safe: registering a plain extern "C" fn to run at normal exit.
            unsafe {
                libc::atexit(exit_backstop);
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
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            settings_snapshot,
            settings_update,
            api_key_save,
            api_key_clear,
            reference_open,
            imslp_search,
            imslp_editions,
            imslp_open_download,
            layout_get,
            layout_set,
            pieces_scan,
            pieces_list,
            piece_import_pdf,
            piece_archive,
            piece_open_source_url,
            downloads_list,
            pick_import_file,
            piece_get,
            score_pdf_editions,
            score_pdf_select,
            score_pdf_bytes,
            score_page_cache_load,
            score_page_cache_save,
            piece_intake_save,
            piece_select,
            rep_open,
            rep_check,
            rep_undo,
            rep_correct,
            rep_adjustment_reverse,
            rep_restart,
            rep_close,
            rep_state,
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
            score_atlas_target_save,
            score_calibration_save,
            score_calibration_get,
            day_sheet_get,
            day_sheet_save,
            piece_plan_get,
            piece_plan_save,
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
            assistant_suggest,
            score_xml_measure_facts,
            brain_thread_resume,
            brain_thread_clear,
            brain_intake_apply,
            brain_status,
            brain_test_connection,
            books_list,
            book_add,
            book_remove,
            book_excerpt,
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
            voice_mute,
            voice_state,
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
