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
//! `score/` (preferred) or the folder root. A direct `*.xml` file is a final
//! fallback only when a bounded prefix parses to a MusicXML root element. Everything
//! that is *not* a real piece folder — loose files (`.DS_Store`), the
//! `_piece-template` scaffold, dot-directories — is skipped.
//!
//! Robustness over strictness: a missing or unreadable pieces dir yields an
//! empty list, never an error. The startup scan runs on a background thread and
//! must never be able to panic the app or raise a first-paint error toast just
//! because the vault happens to be absent (external disk unplugged, fresh
//! machine, etc.).

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use quick_xml::events::Event;
use quick_xml::Reader;

/// Re-exported so callers use `vault::ScanPiece` per the P3 contract, while the
/// type itself lives with the rest of the data-layer serde types in the store.
pub use crate::store::model::ScanPiece;

/// Score-file extensions treated as machine-readable engravings (drive `has_xml`).
/// A plain `.xml` file is handled separately as a sniffed fallback, so these
/// unambiguous extensions retain priority.
const XML_EXTS: &[&str] = &["musicxml", "mxl"];
/// Plain XML discovery parses only this prefix and never resolves a DTD or
/// follows a symlink.
const PLAIN_XML_SNIFF_BYTES: u64 = 16 * 1024;
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
        xml_path: find_musicxml_score(path),
        pdf_path: find_score(path, PDF_EXTS),
    })
}

/// Prefer unambiguous MusicXML extensions across both supported locations,
/// then fall back to a content-sniffed direct `.xml` file. This ordering means
/// an official root-level `.musicxml`/`.mxl` still wins over an ambiguous
/// `score/*.xml`, while each tier retains the vault's score-dir-first rule.
fn find_musicxml_score(folder: &Path) -> Option<PathBuf> {
    find_score(folder, XML_EXTS).or_else(|| {
        first_plain_xml_musicxml(&folder.join("score")).or_else(|| first_plain_xml_musicxml(folder))
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

/// The alphabetically-first direct, regular, non-symlink `.xml` file whose
/// bounded prefix parses to a MusicXML document root. `DirEntry::file_type`
/// inspects the directory entry itself, so a symlink is rejected rather than
/// followed by `Path::is_file`.
fn first_plain_xml_musicxml(dir: &Path) -> Option<PathBuf> {
    let mut matches: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let path = entry.path();
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("xml"))
                .then_some(path)
        })
        .collect();
    matches.sort();
    matches
        .into_iter()
        .find(|path| has_musicxml_root_prefix(path))
}

fn has_musicxml_root_prefix(path: &Path) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut prefix = Vec::with_capacity(PLAIN_XML_SNIFF_BYTES as usize);
    if file
        .take(PLAIN_XML_SNIFF_BYTES)
        .read_to_end(&mut prefix)
        .is_err()
    {
        return false;
    }
    let mut reader = Reader::from_reader(Cursor::new(prefix));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let root = event.local_name();
                return root.as_ref() == b"score-partwise"
                    || root.as_ref() == b"score-timewise";
            }
            // quick-xml reports the external declaration but does not fetch or
            // resolve it. These prologue events are safe to skip.
            Ok(Event::DocType(_) | Event::Decl(_) | Event::PI(_) | Event::Comment(_)) => {}
            Ok(Event::Text(text)) if text.iter().all(u8::is_ascii_whitespace) => {}
            Ok(Event::Eof) | Err(_) => return false,
            _ => return false,
        }
        buffer.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create `dir/rel` as an empty file, making parent dirs as needed.
    fn touch(dir: &Path, rel: &str) {
        write_file(dir, rel, b"");
    }

    fn write_file(dir: &Path, rel: &str, contents: &[u8]) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
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
        assert!(p
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("score/sonata.musicxml"));
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
    fn arbitrary_plain_xml_is_not_treated_as_musicxml() {
        let td = TempDir::new().unwrap();
        let base = "Griffes - The Lake at Evening";
        write_file(
            td.path(),
            &format!("{base}/score/catalog.xml"),
            br#"<?xml version="1.0"?><catalog><score>not MusicXML</score></catalog>"#,
        );
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].xml_path, None);
    }

    #[test]
    fn musicxml_words_in_comments_or_nested_elements_do_not_fake_the_root() {
        let td = TempDir::new().unwrap();
        let base = "Griffes - The Lake at Evening";
        write_file(
            td.path(),
            &format!("{base}/score/a-comment.xml"),
            br#"<!-- <score-partwise version="4.0"/> --><catalog/>"#,
        );
        write_file(
            td.path(),
            &format!("{base}/score/b-nested.xml"),
            br#"<catalog><score-partwise version="4.0"/></catalog>"#,
        );
        write_file(
            td.path(),
            &format!("{base}/score/c-score.xml"),
            br#"<?xml version="1.0"?><score-partwise version="4.0"/>"#,
        );
        let pieces = scan_pieces(td.path());
        assert!(pieces[0]
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("score/c-score.xml"));
    }

    #[test]
    fn valid_plain_xml_musicxml_is_accepted() {
        let td = TempDir::new().unwrap();
        let base = "Griffes - The Lake at Evening";
        write_file(
            td.path(),
            &format!("{base}/score/lake.xml"),
            br#"<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><part-list/></score-partwise>"#,
        );
        let pieces = scan_pieces(td.path());
        assert!(pieces[0]
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("score/lake.xml"));
    }

    #[cfg(unix)]
    #[test]
    fn plain_xml_symlink_is_ignored() {
        use std::os::unix::fs::symlink;

        let td = TempDir::new().unwrap();
        let base = "Griffes - The Lake at Evening";
        write_file(
            td.path(),
            &format!("{base}/real-score.data"),
            br#"<score-partwise version="4.0"/>"#,
        );
        let link = td.path().join(format!("{base}/score/lake.xml"));
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(td.path().join(format!("{base}/real-score.data")), &link).unwrap();

        let pieces = scan_pieces(td.path());
        assert_eq!(pieces[0].xml_path, None);
    }

    #[test]
    fn official_musicxml_extension_precedes_plain_xml_fallback() {
        let td = TempDir::new().unwrap();
        let base = "Bach - Prelude";
        touch(td.path(), &format!("{base}/canonical.musicxml"));
        write_file(
            td.path(),
            &format!("{base}/score/alternate.xml"),
            br#"<score-timewise version="4.0"/>"#,
        );
        let pieces = scan_pieces(td.path());
        assert!(pieces[0]
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("canonical.musicxml"));
    }

    #[test]
    fn score_subdir_is_preferred_for_plain_xml_fallback() {
        let td = TempDir::new().unwrap();
        let base = "Bach - Prelude";
        write_file(
            td.path(),
            &format!("{base}/root.xml"),
            br#"<score-partwise version="4.0"/>"#,
        );
        write_file(
            td.path(),
            &format!("{base}/score/canonical.xml"),
            br#"<score-partwise version="4.0"/>"#,
        );
        let pieces = scan_pieces(td.path());
        assert!(pieces[0]
            .xml_path
            .as_ref()
            .unwrap()
            .ends_with("score/canonical.xml"));
    }

    #[test]
    fn plain_xml_root_beyond_sniff_limit_is_ignored() {
        let td = TempDir::new().unwrap();
        let base = "Late - Root";
        let mut contents = vec![b' '; PLAIN_XML_SNIFF_BYTES as usize];
        contents.extend_from_slice(br#"<score-partwise version="4.0"/>"#);
        write_file(td.path(), &format!("{base}/score/late.xml"), &contents);
        let pieces = scan_pieces(td.path());
        assert_eq!(pieces[0].xml_path, None);
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

    #[test]
    #[ignore = "requires Christian's real Pieces vault"]
    fn real_griffes_plain_xml_is_discovered_as_musicxml() {
        let pieces = scan_pieces(Path::new(
            "/Users/c3/Desktop/christian's universe/Piano Practice/Pieces",
        ));
        let griffes = pieces
            .iter()
            .find(|piece| piece.title == "The Lake at Evening Op.5 No.1")
            .expect("Griffes piece is present");
        assert!(griffes
            .xml_path
            .as_ref()
            .is_some_and(|path| path.extension().is_some_and(|ext| ext == "xml")));
    }
}
