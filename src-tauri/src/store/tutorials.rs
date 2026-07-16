//! Local tutorial-video metadata and Region clip mappings.
//!
//! Media is never read into SQLite or IPC. The store validates and canonicalizes
//! files beneath `<piece>/tutorials/`, persists only their paths, and returns
//! those paths for the frontend to stream through Tauri's asset protocol.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};

use super::model::{
    TutorialClip, TutorialClipCreate, TutorialClipPatch, TutorialVideo, TutorialVideoPatch,
    TutorialVideoUpsert,
};
use super::Store;

const MAX_TITLE_CHARS: usize = 500;
const MAX_NOTES_CHARS: usize = 10_000;
const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mov", "m4v", "webm"];

fn invalid(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

fn normalized_title(value: String) -> rusqlite::Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid(
            "tutorial title must be between 1 and 500 characters",
        ));
    }
    Ok(value)
}

fn normalized_notes(value: Option<String>) -> rusqlite::Result<Option<String>> {
    let value = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if value
        .as_ref()
        .is_some_and(|value| value.chars().count() > MAX_NOTES_CHARS)
    {
        return Err(invalid("tutorial notes cannot exceed 10000 characters"));
    }
    Ok(value)
}

fn valid_duration(value: Option<f64>) -> bool {
    value.is_none_or(|value| value.is_finite() && value > 0.0)
}

fn is_video_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn piece_tutorials_dir(conn: &Connection, piece_id: i64) -> rusqlite::Result<PathBuf> {
    let folder: String = conn.query_row(
        "SELECT folder_path FROM piece WHERE id = ?1",
        [piece_id],
        |row| row.get(0),
    )?;
    Ok(PathBuf::from(folder).join("tutorials"))
}

/// Canonicalize and authorize one existing video. Both explicit upserts and
/// scans pass through this boundary, so symlink escapes and arbitrary paths
/// outside the owning Piece cannot enter the database.
fn validated_video_path(
    conn: &Connection,
    piece_id: i64,
    file_path: &Path,
) -> rusqlite::Result<PathBuf> {
    if !is_video_path(file_path) {
        return Err(invalid("tutorial file must be mp4, mov, m4v, or webm"));
    }
    let tutorials = piece_tutorials_dir(conn, piece_id)?;
    let root = fs::canonicalize(&tutorials).map_err(|_| {
        invalid(format!(
            "piece tutorials directory does not exist: {}",
            tutorials.display()
        ))
    })?;
    let file = fs::canonicalize(file_path).map_err(|_| {
        invalid(format!(
            "tutorial video does not exist: {}",
            file_path.display()
        ))
    })?;
    if !file.is_file() || !file.starts_with(&root) {
        return Err(invalid(
            "tutorial video must be a file inside this piece's tutorials directory",
        ));
    }
    Ok(file)
}

/// Recursive read with symlinks skipped. Canonical containment is checked
/// again for every file as defense in depth against unusual filesystem races.
fn collect_video_files(root: &Path, dir: &Path, output: &mut Vec<PathBuf>) -> rusqlite::Result<()> {
    let entries = fs::read_dir(dir)
        .map_err(|error| invalid(format!("could not scan {}: {error}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|error| invalid(format!("tutorial scan failed: {error}")))?;
        let file_type = entry
            .file_type()
            .map_err(|error| invalid(format!("tutorial scan failed: {error}")))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_video_files(root, &path, output)?;
        } else if file_type.is_file() && is_video_path(&path) {
            let canonical = fs::canonicalize(&path)
                .map_err(|error| invalid(format!("tutorial scan failed: {error}")))?;
            if canonical.starts_with(root) {
                output.push(canonical);
            }
        }
    }
    Ok(())
}

impl Store {
    pub fn tutorial_video_list(&self, piece_id: i64) -> rusqlite::Result<Vec<TutorialVideo>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Self::tutorial_video_list_conn(&conn, piece_id)
    }

    /// Return one revalidated canonical media path for a native Finder reveal.
    /// The command layer receives no caller-supplied filesystem path.
    pub fn tutorial_video_file_path(&self, id: i64) -> rusqlite::Result<PathBuf> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let video = Self::tutorial_video_get_conn(&conn, id)?;
        validated_video_path(&conn, video.piece_id, Path::new(&video.file_path))
    }

    fn tutorial_video_list_conn(
        conn: &Connection,
        piece_id: i64,
    ) -> rusqlite::Result<Vec<TutorialVideo>> {
        // Make an unknown piece an error rather than indistinguishable from an
        // existing piece with no tutorials.
        conn.query_row("SELECT id FROM piece WHERE id = ?1", [piece_id], |_| Ok(()))?;
        let rows: Vec<(i64, i64, String, String, Option<f64>)> = {
            let mut statement = conn.prepare(
                "SELECT id, piece_id, title, file_path, duration_seconds
                 FROM tutorial_video WHERE piece_id = ?1
                 ORDER BY title COLLATE NOCASE, id",
            )?;
            let rows = statement
                .query_map([piece_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                })?
                .collect::<Result<_, _>>()?;
            rows
        };
        rows.into_iter()
            .map(|(id, piece_id, title, file_path, duration_seconds)| {
                Ok(TutorialVideo {
                    id,
                    piece_id,
                    title,
                    file_path,
                    duration_seconds,
                    clips: Self::tutorial_clip_list_conn(conn, id)?,
                })
            })
            .collect()
    }

    fn tutorial_video_get_conn(conn: &Connection, id: i64) -> rusqlite::Result<TutorialVideo> {
        let (piece_id, title, file_path, duration_seconds) = conn.query_row(
            "SELECT piece_id, title, file_path, duration_seconds
             FROM tutorial_video WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        Ok(TutorialVideo {
            id,
            piece_id,
            title,
            file_path,
            duration_seconds,
            clips: Self::tutorial_clip_list_conn(conn, id)?,
        })
    }

    fn tutorial_clip_list_conn(
        conn: &Connection,
        video_id: i64,
    ) -> rusqlite::Result<Vec<TutorialClip>> {
        let mut statement = conn.prepare(
            "SELECT l.id, l.chapter_id, c.video_id, l.region_id, c.start_seconds, c.end_seconds,
                    c.title, c.notes, c.sort_order
             FROM tutorial_clip l
             JOIN tutorial_chapter c ON c.id = l.chapter_id
             WHERE c.video_id = ?1
             ORDER BY c.sort_order, c.start_seconds, l.id",
        )?;
        let clips = statement
            .query_map([video_id], |row| {
                Ok(TutorialClip {
                    id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    video_id: row.get(2)?,
                    region_id: row.get(3)?,
                    start_seconds: row.get(4)?,
                    end_seconds: row.get(5)?,
                    title: row.get(6)?,
                    notes: row.get(7)?,
                    order: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(clips)
    }

    fn tutorial_clip_get_conn(conn: &Connection, id: i64) -> rusqlite::Result<TutorialClip> {
        conn.query_row(
            "SELECT l.id, l.chapter_id, c.video_id, l.region_id, c.start_seconds, c.end_seconds,
                    c.title, c.notes, c.sort_order
             FROM tutorial_clip l
             JOIN tutorial_chapter c ON c.id = l.chapter_id
             WHERE l.id = ?1",
            [id],
            |row| {
                Ok(TutorialClip {
                    id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    video_id: row.get(2)?,
                    region_id: row.get(3)?,
                    start_seconds: row.get(4)?,
                    end_seconds: row.get(5)?,
                    title: row.get(6)?,
                    notes: row.get(7)?,
                    order: row.get(8)?,
                })
            },
        )
    }

    pub fn tutorial_video_upsert(
        &self,
        args: TutorialVideoUpsert,
    ) -> rusqlite::Result<TutorialVideo> {
        let title = normalized_title(args.title)?;
        if !valid_duration(args.duration_seconds) {
            return Err(invalid(
                "tutorial duration must be a finite positive number",
            ));
        }
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let path = validated_video_path(&conn, args.piece_id, Path::new(&args.file_path))?;
        let path = path.to_string_lossy().into_owned();
        let id: i64 = conn.query_row(
            "INSERT INTO tutorial_video (piece_id,title,file_path,duration_seconds)
             VALUES (?1,?2,?3,?4)
             ON CONFLICT(piece_id,file_path) DO UPDATE SET
               title = excluded.title,
               duration_seconds = COALESCE(excluded.duration_seconds, tutorial_video.duration_seconds),
               updated_ts = datetime('now')
             RETURNING id",
            rusqlite::params![args.piece_id, title, path, args.duration_seconds],
            |row| row.get(0),
        )?;
        Self::tutorial_video_get_conn(&conn, id)
    }

    pub fn tutorial_video_update(
        &self,
        id: i64,
        patch: TutorialVideoPatch,
    ) -> rusqlite::Result<TutorialVideo> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let current = Self::tutorial_video_get_conn(&conn, id)?;
        let title = patch
            .title
            .map(normalized_title)
            .transpose()?
            .unwrap_or(current.title);
        let file_path = if let Some(file_path) = patch.file_path {
            validated_video_path(&conn, current.piece_id, Path::new(&file_path))?
                .to_string_lossy()
                .into_owned()
        } else {
            current.file_path
        };
        let duration = patch.duration_seconds.unwrap_or(current.duration_seconds);
        if !valid_duration(duration) {
            return Err(invalid(
                "tutorial duration must be a finite positive number",
            ));
        }
        if let Some(duration) = duration {
            let latest_clip_end: Option<f64> = conn.query_row(
                "SELECT MAX(end_seconds) FROM tutorial_chapter WHERE video_id = ?1",
                [id],
                |row| row.get(0),
            )?;
            if latest_clip_end.is_some_and(|end| end > duration) {
                return Err(invalid(
                    "tutorial duration cannot end before an existing clip",
                ));
            }
        }
        conn.execute(
            "UPDATE tutorial_video SET title=?2,file_path=?3,duration_seconds=?4,
                    updated_ts=datetime('now') WHERE id=?1",
            rusqlite::params![id, title, file_path, duration],
        )?;
        Self::tutorial_video_get_conn(&conn, id)
    }

    pub fn tutorial_video_delete(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let changed = conn.execute("DELETE FROM tutorial_video WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    /// Discover every supported file beneath `<piece>/tutorials/` and register
    /// it idempotently. Existing authored titles, durations, and clips survive
    /// subsequent scans.
    pub fn tutorial_video_scan(&self, piece_id: i64) -> rusqlite::Result<Vec<TutorialVideo>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let tutorials = piece_tutorials_dir(&conn, piece_id)?;
        if !tutorials.exists() {
            return Self::tutorial_video_list_conn(&conn, piece_id);
        }
        let root = fs::canonicalize(&tutorials)
            .map_err(|error| invalid(format!("could not scan tutorials: {error}")))?;
        let mut paths = Vec::new();
        collect_video_files(&root, &root, &mut paths)?;
        paths.sort();
        paths.dedup();
        for path in paths {
            let path = validated_video_path(&conn, piece_id, &path)?;
            let title = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.replace(['_', '-'], " "))
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| "Tutorial video".to_string());
            conn.execute(
                "INSERT INTO tutorial_video (piece_id,title,file_path)
                 VALUES (?1,?2,?3)
                 ON CONFLICT(piece_id,file_path) DO NOTHING",
                rusqlite::params![piece_id, normalized_title(title)?, path.to_string_lossy()],
            )?;
        }
        Self::tutorial_video_list_conn(&conn, piece_id)
    }

    pub fn tutorial_clip_create(&self, args: TutorialClipCreate) -> rusqlite::Result<TutorialClip> {
        let title = normalized_title(args.title)?;
        let notes = normalized_notes(args.notes)?;
        validate_clip_values(args.start_seconds, args.end_seconds, args.order)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        validate_clip_relationship(&conn, args.video_id, args.region_id, args.end_seconds)?;
        // Reuse an identical chapter when it is mapped to another Region. This
        // is the synchronization seam: edits to that chapter then appear in
        // every linked Tricky Section instead of creating drift-prone copies.
        let chapter_id: i64 = conn
            .query_row(
                "SELECT id FROM tutorial_chapter
                 WHERE video_id=?1 AND start_seconds=?2 AND end_seconds=?3
                   AND title=?4 AND notes IS ?5 AND sort_order=?6
                 ORDER BY id LIMIT 1",
                rusqlite::params![
                    args.video_id,
                    args.start_seconds,
                    args.end_seconds,
                    title,
                    notes,
                    args.order
                ],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .map(Ok)
            .unwrap_or_else(|| {
                conn.query_row(
                    "INSERT INTO tutorial_chapter
                     (video_id,start_seconds,end_seconds,title,notes,sort_order)
                     VALUES (?1,?2,?3,?4,?5,?6) RETURNING id",
                    rusqlite::params![
                        args.video_id,
                        args.start_seconds,
                        args.end_seconds,
                        title,
                        notes,
                        args.order
                    ],
                    |row| row.get::<_, i64>(0),
                )
            })?;
        let id: i64 = conn.query_row(
            "INSERT INTO tutorial_clip (chapter_id,region_id)
             VALUES (?1,?2)
             ON CONFLICT(chapter_id,region_id) DO UPDATE SET region_id=excluded.region_id
             RETURNING id",
            rusqlite::params![chapter_id, args.region_id],
            |row| row.get(0),
        )?;
        Self::tutorial_clip_get_conn(&conn, id)
    }

    pub fn tutorial_clip_update(
        &self,
        id: i64,
        patch: TutorialClipPatch,
    ) -> rusqlite::Result<TutorialClip> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let tx = conn.transaction()?;
        let current = Self::tutorial_clip_get_conn(&tx, id)?;
        let chapter_id: i64 = tx.query_row(
            "SELECT chapter_id FROM tutorial_clip WHERE id=?1",
            [id],
            |row| row.get(0),
        )?;
        let video_id = patch.video_id.unwrap_or(current.video_id);
        let region_id = patch.region_id.unwrap_or(current.region_id);
        let start = patch.start_seconds.unwrap_or(current.start_seconds);
        let end = patch.end_seconds.unwrap_or(current.end_seconds);
        let title = patch
            .title
            .map(normalized_title)
            .transpose()?
            .unwrap_or(current.title);
        let notes = patch
            .notes
            .map(normalized_notes)
            .transpose()?
            .unwrap_or(current.notes);
        let order = patch.order.unwrap_or(current.order);
        validate_clip_values(start, end, order)?;
        validate_clip_relationship(&tx, video_id, region_id, end)?;
        validate_all_chapter_regions(&tx, chapter_id, id, video_id)?;
        tx.execute(
            "UPDATE tutorial_chapter SET video_id=?2,start_seconds=?3,end_seconds=?4,
                    title=?5,notes=?6,sort_order=?7,updated_ts=datetime('now')
             WHERE id=?1",
            rusqlite::params![chapter_id, video_id, start, end, title, notes, order],
        )?;
        tx.execute(
            "UPDATE tutorial_clip SET region_id=?2 WHERE id=?1",
            rusqlite::params![id, region_id],
        )?;
        let updated = Self::tutorial_clip_get_conn(&tx, id)?;
        tx.commit()?;
        Ok(updated)
    }

    pub fn tutorial_clip_delete(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let chapter_id: i64 = conn.query_row(
            "SELECT chapter_id FROM tutorial_clip WHERE id=?1",
            [id],
            |row| row.get(0),
        )?;
        let tx = conn.transaction()?;
        let changed = tx.execute("DELETE FROM tutorial_clip WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        tx.execute(
            "DELETE FROM tutorial_chapter
             WHERE id=?1 AND NOT EXISTS (
               SELECT 1 FROM tutorial_clip WHERE chapter_id=?1
             )",
            [chapter_id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn validate_clip_values(start: f64, end: f64, order: i64) -> rusqlite::Result<()> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start || order < 0 {
        return Err(invalid(
            "tutorial clip requires finite 0 <= start < end and a nonnegative order",
        ));
    }
    Ok(())
}

fn validate_clip_relationship(
    conn: &Connection,
    video_id: i64,
    region_id: i64,
    end_seconds: f64,
) -> rusqlite::Result<()> {
    let video: (i64, Option<f64>) = conn.query_row(
        "SELECT piece_id,duration_seconds FROM tutorial_video WHERE id=?1",
        [video_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let region_piece: i64 = conn.query_row(
        "SELECT piece_id FROM region WHERE id=?1",
        [region_id],
        |row| row.get(0),
    )?;
    if video.0 != region_piece {
        return Err(invalid(
            "tutorial video and region must belong to the same piece",
        ));
    }
    if video.1.is_some_and(|duration| end_seconds > duration) {
        return Err(invalid(
            "tutorial clip cannot extend beyond the video duration",
        ));
    }
    Ok(())
}

/// When shared chapter metadata moves to another video, every Region already
/// linked to that chapter must belong to the destination video's Piece.
fn validate_all_chapter_regions(
    conn: &Connection,
    chapter_id: i64,
    changing_link_id: i64,
    video_id: i64,
) -> rusqlite::Result<()> {
    let video_piece: i64 = conn.query_row(
        "SELECT piece_id FROM tutorial_video WHERE id=?1",
        [video_id],
        |row| row.get(0),
    )?;
    let mismatches: i64 = conn.query_row(
        "SELECT count(*) FROM tutorial_clip l
         JOIN region r ON r.id=l.region_id
         WHERE l.chapter_id=?1 AND l.id != ?2 AND r.piece_id != ?3",
        rusqlite::params![chapter_id, changing_link_id, video_piece],
        |row| row.get(0),
    )?;
    if mismatches > 0 {
        return Err(invalid(
            "shared tutorial chapter cannot move across the Pieces linked to it",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{RegionCreate, ScanPiece};
    use tempfile::TempDir;

    fn fixture() -> (TempDir, Store, i64, PathBuf) {
        let temp = TempDir::new().unwrap();
        let piece = temp.path().join("Scherzo");
        let tutorials = piece.join("tutorials");
        fs::create_dir_all(&tutorials).unwrap();
        let store = Store::open(":memory:").unwrap();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: piece.to_string_lossy().into_owned(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        (temp, store, piece_id, tutorials)
    }

    fn region(store: &Store, piece_id: i64, name: &str) -> i64 {
        store
            .region_create(RegionCreate {
                piece_id,
                name: name.into(),
                notes: None,
                m_start: 1,
                m_end: 8,
                kind: "hard_spot".into(),
            })
            .unwrap()
            .id
    }

    #[test]
    fn scan_is_recursive_idempotent_and_preserves_authored_metadata() {
        let (_temp, store, piece_id, tutorials) = fixture();
        fs::write(tutorials.join("overview.mp4"), b"not loaded by the store").unwrap();
        fs::create_dir(tutorials.join("chapter-1")).unwrap();
        fs::write(tutorials.join("chapter-1/left_hand.MOV"), b"fixture").unwrap();
        fs::write(tutorials.join("ignore.txt"), b"no").unwrap();

        let first = store.tutorial_video_scan(piece_id).unwrap();
        assert_eq!(first.len(), 2);
        let video = first
            .iter()
            .find(|video| video.title == "overview")
            .unwrap();
        store
            .tutorial_video_update(
                video.id,
                TutorialVideoPatch {
                    title: Some("Full lesson".into()),
                    duration_seconds: Some(Some(42.5)),
                    ..Default::default()
                },
            )
            .unwrap();
        let second = store.tutorial_video_scan(piece_id).unwrap();
        assert_eq!(second.len(), 2);
        assert_eq!(
            second
                .iter()
                .find(|video| video.id == video.id)
                .unwrap()
                .title,
            "Full lesson"
        );
        assert_eq!(
            second
                .iter()
                .find(|video| video.id == video.id)
                .unwrap()
                .duration_seconds,
            Some(42.5)
        );
    }

    #[test]
    fn upsert_rejects_files_outside_piece_and_invalid_duration() {
        let (temp, store, piece_id, tutorials) = fixture();
        let inside = tutorials.join("lesson.mp4");
        fs::write(&inside, b"fixture").unwrap();
        let outside = temp.path().join("outside.mp4");
        fs::write(&outside, b"fixture").unwrap();
        assert!(store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Outside".into(),
                file_path: outside.to_string_lossy().into_owned(),
                duration_seconds: None,
            })
            .is_err());
        assert!(store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Bad duration".into(),
                file_path: inside.to_string_lossy().into_owned(),
                duration_seconds: Some(f64::NAN),
            })
            .is_err());
    }

    #[test]
    fn clips_validate_piece_and_time_and_cascade_from_region_and_video() {
        let (temp, store, piece_id, tutorials) = fixture();
        let file = tutorials.join("lesson.mp4");
        fs::write(&file, b"fixture").unwrap();
        let video = store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Lesson".into(),
                file_path: file.to_string_lossy().into_owned(),
                duration_seconds: Some(60.0),
            })
            .unwrap();
        let first_region = region(&store, piece_id, "Opening");
        let clip = store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: first_region,
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: "Slow shape".into(),
                notes: Some("Watch the wrist".into()),
                order: 0,
            })
            .unwrap();
        assert_eq!(
            store.tutorial_video_list(piece_id).unwrap()[0].clips,
            vec![clip.clone()]
        );
        let shared_region = region(&store, piece_id, "Same chapter, other section");
        let shared_link = store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: shared_region,
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: "Slow shape".into(),
                notes: Some("Watch the wrist".into()),
                order: 0,
            })
            .unwrap();
        {
            let conn = store.conn.lock().unwrap();
            assert_eq!(
                conn.query_row("SELECT count(*) FROM tutorial_chapter", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                1,
                "identical chapters are shared instead of duplicated"
            );
        }
        store
            .tutorial_clip_update(
                clip.id,
                TutorialClipPatch {
                    title: Some("Slow shape and release".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let shared_views = store.tutorial_video_list(piece_id).unwrap();
        assert_eq!(shared_views[0].clips.len(), 2);
        assert!(shared_views[0]
            .clips
            .iter()
            .all(|clip| clip.title == "Slow shape and release"));
        assert!(store
            .tutorial_clip_update(
                clip.id,
                TutorialClipPatch {
                    end_seconds: Some(61.0),
                    ..Default::default()
                },
            )
            .is_err());

        let other_piece_dir = temp.path().join("Other");
        fs::create_dir_all(other_piece_dir.join("tutorials")).unwrap();
        let other_piece = store
            .upsert_piece(&ScanPiece {
                folder_path: other_piece_dir.to_string_lossy().into_owned(),
                title: "Other".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let other_region = region(&store, other_piece, "Other");
        assert!(store
            .tutorial_clip_update(
                clip.id,
                TutorialClipPatch {
                    region_id: Some(other_region),
                    ..Default::default()
                },
            )
            .is_err());

        store.region_delete(first_region).unwrap();
        assert_eq!(
            store.tutorial_video_list(piece_id).unwrap()[0].clips,
            vec![shared_views[0]
                .clips
                .iter()
                .find(|clip| clip.id == shared_link.id)
                .unwrap()
                .clone()]
        );
        store.tutorial_clip_delete(shared_link.id).unwrap();
        {
            let conn = store.conn.lock().unwrap();
            assert_eq!(
                conn.query_row("SELECT count(*) FROM tutorial_chapter", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                0,
                "deleting the last mapping removes its orphan chapter"
            );
        }

        let second_region = region(&store, piece_id, "Coda");
        store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: second_region,
                start_seconds: 20.0,
                end_seconds: 30.0,
                title: "Coda".into(),
                notes: None,
                order: 0,
            })
            .unwrap();
        store.tutorial_video_delete(video.id).unwrap();
        let conn = store.conn.lock().unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tutorial_clip", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }

    #[test]
    fn region_merge_transfers_and_deduplicates_tutorial_links() {
        let (_temp, store, piece_id, tutorials) = fixture();
        let file = tutorials.join("lesson.mp4");
        fs::write(&file, b"fixture").unwrap();
        let video = store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Lesson".into(),
                file_path: file.to_string_lossy().into_owned(),
                duration_seconds: Some(60.0),
            })
            .unwrap();
        let keep = region(&store, piece_id, "Keep");
        let absorb = region(&store, piece_id, "Absorb");
        for region_id in [keep, absorb] {
            store
                .tutorial_clip_create(TutorialClipCreate {
                    video_id: video.id,
                    region_id,
                    start_seconds: 5.0,
                    end_seconds: 12.0,
                    title: "Shared".into(),
                    notes: None,
                    order: 0,
                })
                .unwrap();
        }
        store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: absorb,
                start_seconds: 20.0,
                end_seconds: 28.0,
                title: "Absorb only".into(),
                notes: None,
                order: 1,
            })
            .unwrap();

        store.region_merge(keep, absorb).unwrap();
        let clips = store.tutorial_video_list(piece_id).unwrap().remove(0).clips;
        assert_eq!(clips.len(), 2);
        assert!(clips.iter().all(|clip| clip.region_id == keep));
        assert_eq!(
            clips.iter().filter(|clip| clip.title == "Shared").count(),
            1
        );
    }

    #[test]
    fn region_delete_removes_the_last_mapping_and_orphan_chapter() {
        let (_temp, store, piece_id, tutorials) = fixture();
        let file = tutorials.join("lesson.mp4");
        fs::write(&file, b"fixture").unwrap();
        let video = store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Lesson".into(),
                file_path: file.to_string_lossy().into_owned(),
                duration_seconds: Some(60.0),
            })
            .unwrap();
        let doomed = region(&store, piece_id, "Doomed");
        store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: doomed,
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: "Only link".into(),
                notes: None,
                order: 0,
            })
            .unwrap();
        store.region_delete(doomed).unwrap();
        let conn = store.conn.lock().unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tutorial_clip", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tutorial_chapter", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn failed_shared_chapter_edit_rolls_back_every_change() {
        let (_temp, store, piece_id, tutorials) = fixture();
        let file = tutorials.join("lesson.mp4");
        fs::write(&file, b"fixture").unwrap();
        let video = store
            .tutorial_video_upsert(TutorialVideoUpsert {
                piece_id,
                title: "Lesson".into(),
                file_path: file.to_string_lossy().into_owned(),
                duration_seconds: Some(60.0),
            })
            .unwrap();
        let first = region(&store, piece_id, "First");
        let second = region(&store, piece_id, "Second");
        let first_link = store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: first,
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: "Original".into(),
                notes: None,
                order: 0,
            })
            .unwrap();
        store
            .tutorial_clip_create(TutorialClipCreate {
                video_id: video.id,
                region_id: second,
                start_seconds: 5.0,
                end_seconds: 12.0,
                title: "Original".into(),
                notes: None,
                order: 0,
            })
            .unwrap();
        assert!(store
            .tutorial_clip_update(
                first_link.id,
                TutorialClipPatch {
                    region_id: Some(second),
                    title: Some("Must roll back".into()),
                    ..Default::default()
                },
            )
            .is_err());
        let clips = store.tutorial_video_list(piece_id).unwrap().remove(0).clips;
        assert_eq!(clips.len(), 2);
        assert!(clips.iter().all(|clip| clip.title == "Original"));
    }
}
