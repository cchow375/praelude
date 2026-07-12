pub mod audio;
pub mod intent;
mod keys;
mod metrics;
mod metronome;
mod rep;
mod sessions;
pub mod stt;
mod store;
mod sysvol;
pub mod tts;
pub mod vault;
mod voice_loop;

use std::path::PathBuf;
use std::sync::Arc;

use metronome::Metronome;
use rep::{RepEngine, RepVerdict};
use sessions::{SessionService, StateEmitter};
use stt::SttConfig;
use store::model::{
    BlockHistory, BlockPatch, CheckOutcome, ExportResult, Goal, GoalCreate, GoalPatch,
    Intake, PanelLayout, PieceDetail, PieceFieldPatch, PieceSummary, ProgressSummary, Region,
    RegionCreate, RegionPatch, Rep, RepOpenArgs, RepPatch, RepSnapshot, SessionView,
};
use store::Store;
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
    store.get_setting(&key).map_err(|e| e.to_string())
}

/// Persist a setting value (insert or overwrite).
#[tauri::command]
fn set_setting(key: String, value: String, store: State<'_, Arc<Store>>) -> Result<(), String> {
    store.set_setting(&key, &value).map_err(|e| e.to_string())
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
fn rep_open(args: RepOpenArgs, rep: State<'_, Arc<RepEngine>>) -> Result<RepSnapshot, String> {
    rep.open(args)
}

/// Record one rep against the active block. `verdict` is `"clean"`/`"flawed"`/
/// `"failed"`; `note` is optional. Takes the exact same engine path voice uses.
#[tauri::command]
fn rep_check(
    verdict: String,
    note: Option<String>,
    rep: State<'_, Arc<RepEngine>>,
) -> Result<CheckOutcome, String> {
    let v = RepVerdict::parse(&verdict).ok_or_else(|| format!("unknown verdict '{verdict}'"))?;
    rep.check(v, note)
}

/// Close the active block (`done` if the plan was met, else `abandoned`).
#[tauri::command]
fn rep_close(rep: State<'_, Arc<RepEngine>>) -> Option<RepSnapshot> {
    rep.close()
}

/// The current active-block snapshot, or `null` when no block is open.
#[tauri::command]
fn rep_state(rep: State<'_, Arc<RepEngine>>) -> Option<RepSnapshot> {
    rep.snapshot()
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
    sessions: State<'_, Arc<SessionService>>,
) -> Option<ExportResult> {
    let dir = pieces_dir(&store);
    sessions.end_and_export(&store, &dir)
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
    let updated = store.block_update(block_id, patch).map_err(|e| e.to_string())?;
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

/// Delete a rep. Resyncs the owning block's active snapshot afterward.
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
fn progress_summary(piece_id: i64, store: State<'_, Arc<Store>>) -> Result<ProgressSummary, String> {
    metrics::progress_summary(&store, piece_id).map_err(|e| e.to_string())
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

            // Session log + rep engine share the store. Both emit app events
            // (`session://event`, `rep://state`) through the Tauri AppHandle,
            // installed here now that it exists. The voice loop drives the SAME
            // Arcs so a block opened by voice is the block the UI sees.
            let sessions = Arc::new(SessionService::new(store.clone()));
            let rep = Arc::new(RepEngine::new(store.clone(), sessions.clone()));
            let app_emitter: Arc<dyn StateEmitter> = Arc::new(AppEmitter(app.handle().clone()));
            sessions.set_emitter(app_emitter.clone());
            rep.set_emitter(app_emitter);

            app.manage(metro.clone());
            app.manage(store.clone());
            app.manage(sessions.clone());
            app.manage(rep.clone());

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
                if let (Some(store), Some(sessions)) = (
                    window.try_state::<Arc<Store>>(),
                    window.try_state::<Arc<SessionService>>(),
                ) {
                    let dir = pieces_dir(&store);
                    let _ = sessions.end_and_export(&store, &dir);
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
            layout_get,
            layout_set,
            pieces_scan,
            pieces_list,
            piece_get,
            piece_intake_save,
            piece_select,
            rep_open,
            rep_check,
            rep_close,
            rep_state,
            rep_blocks_for_piece,
            region_list,
            region_create,
            region_update,
            region_delete,
            region_merge,
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
            session_current,
            session_end,
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
                // Best-effort session export on quit. Must never block exit for
                // long or panic: end_and_export only reads the event log + appends
                // a small markdown file, and any I/O error inside is swallowed.
                if let (Some(store), Some(sessions)) = (
                    app_handle.try_state::<Arc<Store>>(),
                    app_handle.try_state::<Arc<SessionService>>(),
                ) {
                    let dir = pieces_dir(&store);
                    let _ = sessions.end_and_export(&store, &dir);
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
