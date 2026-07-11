//! Session → vault export.
//!
//! At the end of a session we append a human-readable summary into each practiced
//! piece's folder, at `(C) codakiller-sessions.md`. This is the ONLY file the app
//! writes inside the vault, and it is strictly **append-only** (create with a
//! one-line header if missing; never edit or delete existing content, never touch
//! human-authored docs).
//!
//! The session→piece→block linkage exists only in the session event log (blocks
//! carry no session id in the schema), so this reconstructs everything from the
//! `rep_open` / `rep` / `rep_close` / `metro` events, groups by piece, and writes
//! one section per piece touched. A session with no rep events writes nothing.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use crate::store::model::ExportResult;
use crate::store::Store;

/// The append-only per-piece session log filename.
const SESSIONS_FILE: &str = "(C) codakiller-sessions.md";
/// The one-line header written when the file is first created.
const HEADER: &str = "# CodaKiller session log\n";

/// One block's rolled-up practice data, reconstructed from the event log.
struct BlockAgg {
    m_start: u32,
    m_end: u32,
    start_bpm: f64,
    top_bpm: f64,
    clean: u32,
    flawed: u32,
    failed: u32,
    reps: u32,
    /// (verdict, note) for every rep that carried a note.
    notes: Vec<(String, String)>,
}

/// One piece's blocks, in open order, plus its title.
struct PieceAgg {
    title: String,
    order: Vec<i64>,
    blocks: HashMap<i64, BlockAgg>,
}

/// Reconstruct a session from its event log and append a summary section to each
/// practiced piece's `(C) codakiller-sessions.md`. Returns what was written.
/// A session with no rep activity writes no files (but still returns a result).
pub fn write_session_md(store: &Store, session_id: i64, pieces_dir: &Path) -> ExportResult {
    let events = store.session_events(session_id).unwrap_or_default();

    // Session time window for the section header (native ts → date + HH:MM).
    let start_ts = store
        .session_started_at(session_id)
        .ok()
        .flatten()
        .or_else(|| events.first().map(|e| e.ts.clone()))
        .unwrap_or_default();
    let end_ts = events
        .last()
        .map(|e| e.ts.clone())
        .unwrap_or_else(|| start_ts.clone());

    // Group by piece.
    let mut pieces: HashMap<i64, PieceAgg> = HashMap::new();
    let mut piece_order: Vec<i64> = Vec::new();
    let mut total_reps: u32 = 0;
    let mut metro_actions: u32 = 0;

    for ev in &events {
        let p = &ev.payload;
        match ev.kind.as_str() {
            "rep_open" => {
                let (Some(piece_id), Some(block_id)) =
                    (p["piece_id"].as_i64(), p["block_id"].as_i64())
                else {
                    continue;
                };
                let title = p["piece_title"].as_str().unwrap_or("Untitled").to_string();
                let start_bpm = p["start_bpm"].as_f64().unwrap_or(0.0);
                let entry = pieces.entry(piece_id).or_insert_with(|| {
                    piece_order.push(piece_id);
                    PieceAgg {
                        title: title.clone(),
                        order: Vec::new(),
                        blocks: HashMap::new(),
                    }
                });
                entry.title = title;
                if !entry.blocks.contains_key(&block_id) {
                    entry.order.push(block_id);
                    entry.blocks.insert(
                        block_id,
                        BlockAgg {
                            m_start: p["m_start"].as_u64().unwrap_or(0) as u32,
                            m_end: p["m_end"].as_u64().unwrap_or(0) as u32,
                            start_bpm,
                            top_bpm: start_bpm,
                            clean: 0,
                            flawed: 0,
                            failed: 0,
                            reps: 0,
                            notes: Vec::new(),
                        },
                    );
                }
            }
            "rep" => {
                total_reps += 1;
                let (Some(piece_id), Some(block_id)) =
                    (p["piece_id"].as_i64(), p["block_id"].as_i64())
                else {
                    continue;
                };
                let Some(piece) = pieces.get_mut(&piece_id) else {
                    continue;
                };
                let Some(block) = piece.blocks.get_mut(&block_id) else {
                    continue;
                };
                block.reps += 1;
                if let Some(bpm) = p["bpm"].as_f64() {
                    block.top_bpm = block.top_bpm.max(bpm);
                }
                let verdict = p["verdict"].as_str().unwrap_or("");
                match verdict {
                    "clean" => block.clean += 1,
                    "flawed" => block.flawed += 1,
                    "failed" => block.failed += 1,
                    _ => {}
                }
                if let Some(note) = p["note"].as_str() {
                    if !note.trim().is_empty() {
                        block.notes.push((verdict.to_string(), note.to_string()));
                    }
                }
            }
            "metro" => metro_actions += 1,
            _ => {}
        }
    }

    // Render + append one section per piece, in the order they were first opened.
    let mut files: Vec<String> = Vec::new();
    for piece_id in &piece_order {
        let Some(piece) = pieces.get(piece_id) else {
            continue;
        };
        // Resolve the piece folder; skip (do not error) if it is unknown.
        let folder = match store.get_piece(*piece_id) {
            Ok(Some(detail)) => detail.folder_path,
            _ => continue,
        };
        let section = render_section(piece, &start_ts, &end_ts, metro_actions);
        let path = Path::new(&folder).join(SESSIONS_FILE);
        if let Err(e) = append_section(&path, &section) {
            eprintln!("session export: failed to write {path:?}: {e}");
            continue;
        }
        files.push(path.to_string_lossy().into_owned());
    }
    let _ = pieces_dir; // pieces are located by their own stored folder_path

    ExportResult {
        session_id,
        pieces: piece_order.len() as u32,
        reps: total_reps,
        files,
    }
}

/// Render one piece's markdown section: a dated header, a blocks table, verdict
/// notes, and a metronome summary line.
fn render_section(piece: &PieceAgg, start_ts: &str, end_ts: &str, metro_actions: u32) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "\n## {} {}–{}\n\n",
        date_of(start_ts),
        time_of(start_ts),
        time_of(end_ts)
    ));
    s.push_str(&format!("**{}**\n\n", piece.title));
    s.push_str("| Measures | Tempo | Reps (clean/flawed/failed) |\n");
    s.push_str("|---|---|---|\n");

    let mut notes: Vec<(String, String)> = Vec::new();
    for block_id in &piece.order {
        let Some(b) = piece.blocks.get(block_id) else {
            continue;
        };
        let tempo = if b.top_bpm > b.start_bpm {
            format!("{}→{}", fmt(b.start_bpm), fmt(b.top_bpm))
        } else {
            fmt(b.start_bpm)
        };
        s.push_str(&format!(
            "| {}–{} | {} | {} ({}/{}/{}) |\n",
            b.m_start, b.m_end, tempo, b.reps, b.clean, b.flawed, b.failed
        ));
        notes.extend(b.notes.iter().cloned());
    }

    if !notes.is_empty() {
        s.push('\n');
        for (verdict, note) in notes {
            s.push_str(&format!("- {verdict}: {note}\n"));
        }
    }

    s.push_str(&format!("\n_Metronome actions: {metro_actions}._\n"));
    s
}

/// Append `section` to `path`, creating the file with a one-line header first if
/// it does not already exist. Never rewrites existing content.
fn append_section(path: &Path, section: &str) -> std::io::Result<()> {
    let existed = path.exists();
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    if !existed {
        f.write_all(HEADER.as_bytes())?;
    }
    f.write_all(section.as_bytes())
}

/// `YYYY-MM-DD` from a native SQLite timestamp `"YYYY-MM-DD HH:MM:SS"`.
fn date_of(ts: &str) -> &str {
    ts.get(0..10).unwrap_or(ts)
}

/// `HH:MM` from a native SQLite timestamp `"YYYY-MM-DD HH:MM:SS"`.
fn time_of(ts: &str) -> &str {
    ts.get(11..16).unwrap_or("")
}

/// A BPM without a trailing `.0` for whole numbers.
fn fmt(bpm: f64) -> String {
    if bpm.fract() == 0.0 {
        (bpm as i64).to_string()
    } else {
        bpm.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::SessionService;
    use crate::store::model::{RepOpenArgs, ScanPiece};
    use crate::store::Store;
    use std::sync::Arc;

    fn piece(store: &Store, folder: &Path, title: &str) -> i64 {
        store
            .upsert_piece(&ScanPiece {
                folder_path: folder.to_string_lossy().into_owned(),
                title: title.into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap()
    }

    #[test]
    fn two_blocks_two_pieces_writes_two_files_and_appends() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(":memory:").unwrap());
        let sessions = Arc::new(SessionService::new(store.clone()));
        let rep = crate::rep::RepEngine::new(store.clone(), sessions.clone());

        // Two piece folders inside the tempdir (never the real vault).
        let fa = dir.path().join("Chopin - Scherzo");
        let fb = dir.path().join("Bach - Prelude");
        std::fs::create_dir_all(&fa).unwrap();
        std::fs::create_dir_all(&fb).unwrap();
        let pa = piece(&store, &fa, "Scherzo");
        let pb = piece(&store, &fb, "Prelude");

        // Piece A: a block with a step and a note.
        rep.open(RepOpenArgs {
            piece_id: pa,
            m_start: 40,
            m_end: 56,
            label: None,
            start_bpm: 80.0,
            target_bpm: Some(120.0),
            planned_reps: Some(30),
            increment: None,
            variants: vec![],
        })
        .unwrap();
        for _ in 0..3 {
            rep.check(crate::rep::RepVerdict::Clean, None).unwrap();
        }
        rep.check(crate::rep::RepVerdict::Failed, Some("LH jump".into())).unwrap();
        rep.close();

        // Piece B: a second block.
        rep.open(RepOpenArgs {
            piece_id: pb,
            m_start: 1,
            m_end: 8,
            label: None,
            start_bpm: 60.0,
            target_bpm: None,
            planned_reps: Some(5),
            increment: None,
            variants: vec![],
        })
        .unwrap();
        rep.check(crate::rep::RepVerdict::Clean, None).unwrap();
        rep.close();

        let sid = sessions.current_id().unwrap();
        let result = write_session_md(&store, sid, dir.path());
        assert_eq!(result.pieces, 2);
        assert_eq!(result.reps, 5, "4 reps in A + 1 in B");
        assert_eq!(result.files.len(), 2);

        let a_md = std::fs::read_to_string(fa.join(SESSIONS_FILE)).unwrap();
        assert!(a_md.starts_with("# CodaKiller session log"), "one-line header");
        assert!(a_md.contains("| 40–56 | 80→84 |"), "tempo ladder start→top: {a_md}");
        assert!(a_md.contains("(3/0/1)"), "verdict tallies in the table: {a_md}");
        assert!(a_md.contains("- failed: LH jump"), "note bullet: {a_md}");

        let b_md = std::fs::read_to_string(fb.join(SESSIONS_FILE)).unwrap();
        assert!(b_md.contains("| 1–8 | 60 |"), "no-step tempo shows single value: {b_md}");

        // Appending a second session must add a new section, not overwrite.
        rep.open(RepOpenArgs {
            piece_id: pa,
            m_start: 57,
            m_end: 64,
            label: None,
            start_bpm: 70.0,
            target_bpm: None,
            planned_reps: Some(2),
            increment: None,
            variants: vec![],
        })
        .unwrap();
        rep.check(crate::rep::RepVerdict::Clean, None).unwrap();
        rep.close();
        let sid2 = sessions.current_id().unwrap();
        write_session_md(&store, sid2, dir.path());

        let a_md2 = std::fs::read_to_string(fa.join(SESSIONS_FILE)).unwrap();
        assert!(a_md2.contains("| 40–56 |") && a_md2.contains("| 57–64 |"), "both sections present");
        assert_eq!(
            a_md2.matches("## ").count(),
            2,
            "two dated sections after two exports"
        );
    }

    #[test]
    fn session_with_no_rep_events_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(":memory:").unwrap());
        let sessions = Arc::new(SessionService::new(store.clone()));
        // Only a metro event — no reps.
        sessions.log("metro", serde_json::json!({ "action": "start", "bpm": 90 }));
        let sid = sessions.current_id().unwrap();
        let result = write_session_md(&store, sid, dir.path());
        assert_eq!(result.pieces, 0);
        assert!(result.files.is_empty(), "no vault write with zero rep activity");
    }
}
