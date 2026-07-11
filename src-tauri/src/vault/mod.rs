//! Read-only ingest of pieces from the Obsidian vault.
//!
//! WHY read-only is a hard invariant: the vault holds Christian's hand-authored
//! practice docs and is the source of truth for the *human* side of the app.
//! This scanner only ever *reads* directory listings — it opens no files for
//! writing, creates nothing, deletes nothing. The only vault writes the whole
//! app is ever allowed are additive `(C) codakiller-*` session-summary appends,
//! and those live elsewhere (session export), never here.
//!
//! A "piece" is a folder directly under the pieces dir. Its display name is
//! parsed from the folder name (`"Composer - Title"`); its score files are the
//! first matching `*.musicxml`/`*.mxl` (engraving) and `*.pdf` found under
//! `score/` (preferred) or the folder root. Everything that is *not* a real
//! piece folder — loose files (`.DS_Store`), the `_piece-template` scaffold,
//! dot-directories — is skipped.
//!
//! Robustness over strictness: a missing or unreadable pieces dir yields an
//! empty list, never an error. The startup scan runs on a background thread and
//! must never be able to panic the app or raise a first-paint error toast just
//! because the vault happens to be absent (external disk unplugged, fresh
//! machine, etc.).

use std::path::{Path, PathBuf};

/// Re-exported so callers use `vault::ScanPiece` per the P3 contract, while the
/// type itself lives with the rest of the data-layer serde types in the store.
pub use crate::store::model::ScanPiece;

/// Score-file extensions treated as machine-readable engravings (drive `has_xml`).
/// Note `.xml` alone is intentionally NOT here: only true MusicXML (`.musicxml`)
/// and compressed MusicXML (`.mxl`) count.
const XML_EXTS: &[&str] = &["musicxml", "mxl"];
/// Score-file extension treated as a printable score (drives `has_pdf`).
const PDF_EXTS: &[&str] = &["pdf"];

/// Scan `dir` for piece folders. Read-only; infallible from the caller's view —
/// a missing/unreadable directory returns an empty vec rather than erroring, and
/// individual unreadable entries are skipped. Results are sorted by title
/// (case-insensitive) so the ordering is deterministic.
pub fn scan_pieces(dir: &Path) -> Vec<ScanPiece> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // Missing or unreadable vault dir: nothing to ingest, never an error.
        Err(_) => return Vec::new(),
    };

    let mut pieces: Vec<ScanPiece> = entries
        .flatten()
        .filter_map(|entry| scan_folder(&entry.path()))
        .collect();

    pieces.sort_by_key(|p| p.title.to_lowercase());
    pieces
}

/// Turn one directory entry into a `ScanPiece`, or `None` if it is not a piece
/// folder (a file, a dot-dir, or the `_`-prefixed template scaffold).
fn scan_folder(path: &Path) -> Option<ScanPiece> {
    if !path.is_dir() {
        return None; // loose files like `.DS_Store`
    }
    let name = path.file_name().and_then(|n| n.to_str())?;
    // Dot-dirs and the `_piece-template` scaffold are not pieces.
    if name.starts_with('.') || name.starts_with('_') {
        return None;
    }

    // "Composer - Title" → (Some(composer), title); no separator → title only.
    // `split_once` keeps any further " - " inside the title.
    let (composer, title) = match name.split_once(" - ") {
        Some((c, t)) => (Some(c.trim().to_string()), t.trim().to_string()),
        None => (None, name.trim().to_string()),
    };

    Some(ScanPiece {
        folder_path: path.to_string_lossy().into_owned(),
        title,
        composer,
        xml_path: find_score(path, XML_EXTS),
        pdf_path: find_score(path, PDF_EXTS),
    })
}

/// First score file with one of `exts`, looking in `score/` first (the vault's
/// convention) then the folder root. Within a directory, files are sorted so the
/// pick is deterministic.
fn find_score(folder: &Path, exts: &[&str]) -> Option<PathBuf> {
    // `score/` is the canonical location; fall back to the folder root.
    first_with_ext(&folder.join("score"), exts).or_else(|| first_with_ext(folder, exts))
}

/// The alphabetically-first regular file directly in `dir` whose extension
/// matches (case-insensitively) one of `exts`.
fn first_with_ext(dir: &Path, exts: &[&str]) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x)))
        })
        .collect();
    matches.sort();
    matches.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create `dir/rel` as an empty file, making parent dirs as needed.
    fn touch(dir: &Path, rel: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"").unwrap();
    }

    #[test]
    fn missing_dir_returns_empty_not_error() {
        let missing = PathBuf::from("/no/such/vault/dir/at/all");
        assert_eq!(scan_pieces(&missing), Vec::new());
    }

    #[test]
    fn parses_composer_and_title_from_folder_name() {
        let td = TempDir::new().unwrap();
        fs::create_dir(td.path().join("Chopin - Scherzo No.2 Op.31")).unwrap();
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].composer.as_deref(), Some("Chopin"));
        assert_eq!(pieces[0].title, "Scherzo No.2 Op.31");
    }

    #[test]
    fn folder_without_separator_is_title_only() {
        let td = TempDir::new().unwrap();
        fs::create_dir(td.path().join("Improvisation Sketches")).unwrap();
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].composer, None);
        assert_eq!(pieces[0].title, "Improvisation Sketches");
    }

    #[test]
    fn picks_score_files_from_score_subdir() {
        let td = TempDir::new().unwrap();
        let base = "Beethoven - Sonata Op.90";
        touch(td.path(), &format!("{base}/score/sonata.musicxml"));
        touch(td.path(), &format!("{base}/score/urtext.pdf"));
        touch(td.path(), &format!("{base}/score/notes.krn")); // ignored ext
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        let p = &pieces[0];
        assert!(p.xml_path.as_ref().unwrap().ends_with("score/sonata.musicxml"));
        assert!(p.pdf_path.as_ref().unwrap().ends_with("score/urtext.pdf"));
    }

    #[test]
    fn accepts_mxl_and_score_files_at_folder_root() {
        let td = TempDir::new().unwrap();
        let base = "Ravel - Jeux d'eau";
        // No `score/` subdir here: files sit at the folder root.
        touch(td.path(), &format!("{base}/jeux.mxl"));
        touch(td.path(), &format!("{base}/jeux.pdf"));
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert!(pieces[0].xml_path.as_ref().unwrap().ends_with("jeux.mxl"));
        assert!(pieces[0].pdf_path.as_ref().unwrap().ends_with("jeux.pdf"));
    }

    #[test]
    fn plain_xml_extension_is_not_treated_as_musicxml() {
        let td = TempDir::new().unwrap();
        let base = "Griffes - The Lake at Evening";
        touch(td.path(), &format!("{base}/score/lake.xml")); // .xml, not .musicxml
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].xml_path, None, ".xml alone must not count as MusicXML");
    }

    #[test]
    fn score_subdir_is_preferred_over_root() {
        let td = TempDir::new().unwrap();
        let base = "Bach - Prelude";
        touch(td.path(), &format!("{base}/root.musicxml"));
        touch(td.path(), &format!("{base}/score/canonical.musicxml"));
        let pieces = scan_pieces(td.path());
        assert!(pieces[0]
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("score/canonical.musicxml"));
    }

    #[test]
    fn score_pick_is_deterministic_alphabetical() {
        let td = TempDir::new().unwrap();
        let base = "X - Y";
        touch(td.path(), &format!("{base}/score/b.pdf"));
        touch(td.path(), &format!("{base}/score/a.pdf"));
        let pieces = scan_pieces(td.path());
        assert!(pieces[0].pdf_path.as_ref().unwrap().ends_with("a.pdf"));
    }

    #[test]
    fn skips_files_template_and_dot_dirs() {
        let td = TempDir::new().unwrap();
        fs::create_dir(td.path().join("Chopin - Etude")).unwrap();
        fs::create_dir(td.path().join("_piece-template")).unwrap();
        fs::create_dir(td.path().join(".obsidian")).unwrap();
        fs::write(td.path().join(".DS_Store"), b"junk").unwrap();
        fs::write(td.path().join("README.md"), b"notes").unwrap();
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].title, "Etude");
    }

    #[test]
    fn results_sorted_by_title_case_insensitive() {
        let td = TempDir::new().unwrap();
        fs::create_dir(td.path().join("Z - zebra piece")).unwrap();
        fs::create_dir(td.path().join("A - apple piece")).unwrap();
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].title, "apple piece");
        assert_eq!(pieces[1].title, "zebra piece");
    }

    #[test]
    fn piece_without_scores_has_no_paths() {
        let td = TempDir::new().unwrap();
        fs::create_dir(td.path().join("Empty - Piece")).unwrap();
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].xml_path, None);
        assert_eq!(pieces[0].pdf_path, None);
    }
}
