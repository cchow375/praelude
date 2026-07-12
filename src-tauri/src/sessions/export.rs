//! Session → vault export.
//!
//! At the end of a session we append a human-readable summary into each practiced
//! piece's folder, at `(C) codakiller-sessions.md`. This is the ONLY file the app
//! writes inside the vault, and it is strictly **append-only** (create with a
//! one-line header if missing; never edit or delete existing content, never touch
//! human-authored docs).
//!
//! The session→piece→block linkage exists only in the durable `event` log (blocks
//! carry no session id in the schema), so this enumerates the blocks touched in a
//! session from that log's `rep_open` events, then renders each block from the
//! CANONICAL graph — `block_history` + `reps_for_block` — rather than the frozen
//! event payloads. That is what lets a block edited (relabelled/retempoed) after
//! its reps were logged export with its CURRENT values, and survive a relaunch.
//! A session with no rep blocks writes nothing.

use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use crate::store::model::{BlockHistory, ExportResult};
use crate::store::{EventKind, Store};

/// The append-only per-piece session log filename.
const SESSIONS_FILE: &str = "(C) codakiller-sessions.md";
/// The one-line header written when the file is first created.
const HEADER: &str = "# CodaKiller session log\n";

/// Append a summary section to each practiced piece's `(C) codakiller-sessions.md`,
/// rendering each block from the current canonical graph. Returns what was written.
/// A session with no rep blocks writes no files (but still returns a result).
pub fn write_session_md(store: &Store, session_id: i64, pieces_dir: &Path) -> ExportResult {
    let events = store.events_for_session(session_id).unwrap_or_default();

    // Enumerate the pieces + their blocks touched in the session. The ONLY
    // session→piece→block linkage is the durable event log's `rep_open` events
    // (piece_id/block_id live in the payload); the block DATA is read canonically
    // below, so a post-log edit is reflected. Pieces are ordered by first open,
    // blocks by first open within a piece.
    let mut piece_order: Vec<i64> = Vec::new();
    let mut blocks_by_piece: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut seen_block: HashSet<i64> = HashSet::new();
    for ev in &events {
        if ev.kind != EventKind::REP_OPEN {
            continue;
        }
        let piece_id = match ev.payload["piece_id"].as_i64().or(ev.piece_id) {
            Some(p) => p,
            None => continue,
        };
        let Some(block_id) = ev.payload["block_id"].as_i64() else {
            continue;
        };
        if !blocks_by_piece.contains_key(&piece_id) {
            piece_order.push(piece_id);
        }
        if seen_block.insert(block_id) {
            blocks_by_piece.entry(piece_id).or_default().push(block_id);
        }
    }

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

    // Metronome actions come from the live session feed (the durable log carries
    // no `metro` rows); a supplementary tally for the summary line only.
    let metro_actions = store
        .session_events(session_id)
        .unwrap_or_default()
        .iter()
        .filter(|e| e.kind == "metro")
        .count() as u32;

    // Render + append one section per piece, in the order they were first opened.
    let mut total_reps: u32 = 0;
    let mut files: Vec<String> = Vec::new();
    for piece_id in &piece_order {
        // Resolve the piece (title + folder); skip (do not error) if unknown.
        let detail = match store.get_piece(*piece_id) {
            Ok(Some(detail)) => detail,
            _ => continue,
        };
        // Canonical block rows for the piece, indexed by id (current values).
        let hist: HashMap<i64, BlockHistory> = store
            .block_history(*piece_id)
            .unwrap_or_default()
            .into_iter()
            .map(|b| (b.block_id, b))
            .collect();
        let block_ids = blocks_by_piece.get(piece_id).cloned().unwrap_or_default();

        let (section, reps) =
            render_section(store, &detail.title, &block_ids, &hist, &start_ts, &end_ts, metro_actions);
        total_reps += reps;

        let path = Path::new(&detail.folder_path).join(SESSIONS_FILE);
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

/// Render one piece's markdown section from the canonical graph: a dated header, a
/// blocks table (measures, tempo start→top, verdict tallies, current label),
/// verdict notes, and a metronome summary line. Returns the section text and the
/// number of reps it accounts for.
fn render_section(
    store: &Store,
    title: &str,
    block_ids: &[i64],
    hist: &HashMap<i64, BlockHistory>,
    start_ts: &str,
    end_ts: &str,
    metro_actions: u32,
) -> (String, u32) {
    let mut s = String::new();
    s.push_str(&format!(
        "\n## {} {}–{}\n\n",
        date_of(start_ts),
        time_of(start_ts),
        time_of(end_ts)
    ));
    s.push_str(&format!("**{title}**\n\n"));
    s.push_str("| Measures | Tempo | Reps (clean/flawed/failed) | Label |\n");
    s.push_str("|---|---|---|---|\n");

    let mut notes: Vec<(String, String)> = Vec::new();
    let mut reps_total: u32 = 0;
    for block_id in block_ids {
        let Some(b) = hist.get(block_id) else {
            continue;
        };
        let reps = store.reps_for_block(*block_id).unwrap_or_default();
        reps_total += reps.len() as u32;
        // Top tempo reached is the highest bpm any rep landed at (the ladder only
        // climbs, so this is where the block topped out).
        let tempo = if b.focus == "tempo" {
            b.start_bpm.map(|start| {
                let top_bpm = reps.iter().map(|r| r.bpm).fold(start, f64::max);
                if top_bpm > start {
                    format!("{}→{}", fmt(start), fmt(top_bpm))
                } else {
                    fmt(start)
                }
            })
        } else {
            None
        };
        let label = b.label.as_deref().unwrap_or("");
        s.push_str(&format!(
            "| {}–{} | {} | {} ({}/{}/{}) | {} |\n",
            b.m_start,
            b.m_end,
            tempo.as_deref().unwrap_or("—"),
            b.reps_done,
            b.verdicts.clean,
            b.verdicts.flawed,
            b.verdicts.failed,
            label
        ));
        for r in &reps {
            if let Some(note) = &r.note {
                if !note.trim().is_empty() {
                    notes.push((r.verdict.clone(), note.clone()));
                }
            }
        }
    }

    if !notes.is_empty() {
        s.push('\n');
        for (verdict, note) in notes {
            s.push_str(&format!("- {verdict}: {note}\n"));
        }
    }

    s.push_str(&format!("\n_Metronome actions: {metro_actions}._\n"));
    (s, reps_total)
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

    // ── T8 seed helpers ───────────────────────────────────────────────────
    // These seed the canonical graph directly (no rep engine), plus the ONE
    // linkage export needs: a durable `REP_OPEN` event tying the session to the
    // piece/block. Block DATA (label, measures, tempo, reps) is read canonically
    // by the exporter, so editing the block after seeding is reflected on export.

    use crate::store::model::{BlockPatch, IncrementRule};
    use crate::store::EventKind;

    fn seed_piece_with_folder(store: &Store, title: &str, folder: &str) -> i64 {
        store
            .upsert_piece(&ScanPiece {
                folder_path: folder.into(),
                title: title.into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap()
    }

    fn seed_block(store: &Store, pid: i64, m_start: u32, m_end: u32) -> i64 {
        let label = format!("mm.{m_start}-{m_end}");
        let bid = store
            .insert_rep_block(
                pid,
                m_start,
                m_end,
                Some(&label),
                Some(60.0),
                None,
                &IncrementRule { clean_needed: 3, bpm_step: 2.0 },
                10,
                &[],
                "tempo",
                true,
            )
            .unwrap();
        let sid = store.latest_open_session().unwrap();
        store
            .append_event(
                EventKind::REP_OPEN,
                sid,
                Some(pid),
                &serde_json::json!({ "piece_id": pid, "block_id": bid }),
            )
            .unwrap();
        bid
    }

    fn seed_rep(store: &Store, block_id: i64, verdict: &str) -> i64 {
        store.insert_rep(block_id, 60.0, None, verdict, None).unwrap()
    }

    #[test]
    fn export_reflects_post_log_block_edit_after_relaunch() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("codakiller.db");
        let pieces = dir.path().join("pieces");
        std::fs::create_dir_all(pieces.join("etude")).unwrap();

        // session 1: log reps under original label
        let session_id;
        {
            let store = Store::open(&db).unwrap();
            let pid = seed_piece_with_folder(&store, "Etude", pieces.join("etude").to_str().unwrap());
            session_id = store.open_session().unwrap();
            let block_id = seed_block(&store, pid, 1, 8); // label "mm.1-8"
            seed_rep(&store, block_id, "clean");
            // edit AFTER logging
            store
                .block_update(
                    block_id,
                    BlockPatch { label: Some(Some("legato section".into())), ..Default::default() },
                )
                .unwrap();
        } // store dropped == "relaunch"

        // relaunch: fresh Store on same db, export
        let store2 = Store::open(&db).unwrap();
        let res = write_session_md(&store2, session_id, &pieces);
        let md = std::fs::read_to_string(pieces.join("etude").join("(C) codakiller-sessions.md")).unwrap();
        assert!(md.contains("legato section"), "export must reflect the post-log edit; got:\n{md}");
        assert!(!md.contains("mm.1-8"), "stale label must not appear; got:\n{md}");
        assert!(res.reps >= 1);
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
            focus: "tempo".into(),
            use_metronome: true,
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
            focus: "tempo".into(),
            use_metronome: true,
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
            focus: "tempo".into(),
            use_metronome: true,
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
