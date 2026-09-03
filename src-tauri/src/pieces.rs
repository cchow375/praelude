//! Pieces manager backend: import a browser-downloaded score PDF into a piece's
//! vault folder, and delete a piece's files by moving its folder to `.trash/`.
//!
//! Both operations are deliberately conservative about the filesystem:
//! - [`import_pdf`] COPIES the user's download (never moves it — their Downloads
//!   file stays exactly where the browser left it) and only ever writes inside
//!   `<pieces_root>/<folder>/score/`.
//! - [`delete_files`] MOVES a piece folder into `<pieces_root>/.trash/…` (never a hard
//!   delete) and re-points the DB row's `folder_path` at the trash location.
//!
//! WHY delete-files re-points the DB row (rather than leaving the DB untouched):
//! pieces are folder-scan discovered, but `list_pieces` reads the `piece` table,
//! and a rescan only ever *upserts* the folders it finds — it never PRUNES rows
//! whose folder has since gone. So moving the folder alone would leave the piece
//! listed in the workspace forever. Instead we KEEP the row — every `rep_block`,
//! `rep`, and `session` that references `piece_id` stays intact and joinable, so
//! no practice history is ever lost — and only re-point its `folder_path` into
//! `.trash/`. `Store::list_pieces` filters `%/.trash/%` out, so the piece drops
//! out of the Pieces workspace while its whole history remains in the database.
//! (The scanner also skips dot-directories, so the trashed folder is never
//! re-ingested as a new piece.)

use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::store::Store;

/// A real PDF begins with this signature (the `%PDF-1.x` header).
const PDF_MAGIC: &[u8] = b"%PDF-";

/// The in-`pieces_root` trash directory archived pieces are moved into. A leading
/// dot means [`crate::vault::scan_pieces`] never re-ingests anything under it.
const TRASH_DIR: &str = ".trash";
const MAX_PORTABLE_COMPONENT_UTF16: usize = 80;
const MAX_PORTABLE_PDF_STEM_UTF16: usize = 64;

fn windows_forbidden_component_character(character: char) -> bool {
    matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
}

fn windows_reserved_component(name: &str) -> bool {
    let trimmed = name.trim_end_matches([' ', '.']);
    let stem = trimmed.split('.').next().unwrap_or_default().trim();
    let upper = stem.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (bytes.len() == 4
            && (&bytes[..3] == b"COM" || &bytes[..3] == b"LPT")
            && matches!(bytes[3], b'1'..=b'9'))
}

fn truncate_utf16(value: &str, max_units: usize) -> String {
    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            let next = units + character.len_utf16();
            if next > max_units {
                false
            } else {
                units = next;
                true
            }
        })
        .collect()
}

/// Convert arbitrary metadata into a component that is valid on every desktop
/// filesystem Praelude ships on. The original text remains exact in SQLite.
fn portable_component(raw: &str, fallback: &str, max_utf16: usize) -> String {
    let replaced: String = raw
        .chars()
        .map(|character| match character {
            '/' | '\\' | '\0' => '–',
            forbidden if windows_forbidden_component_character(forbidden) => '–',
            control if control.is_control() => ' ',
            other => other,
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut safe = truncate_utf16(collapsed.trim(), max_utf16)
        .trim_end_matches([' ', '.'])
        .to_string();
    if safe.is_empty() {
        safe = fallback.to_string();
    }
    if safe.starts_with('.') || safe.starts_with('_') || windows_reserved_component(&safe) {
        safe.insert_str(0, "Piece ");
    }
    let safe = truncate_utf16(&safe, max_utf16);
    let safe = safe.trim_end_matches([' ', '.']);
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe.to_string()
    }
}

/// Validate a piece folder name: a single in-directory path component that a
/// scan would actually surface as a piece. Rejects traversal (`..`), separators,
/// and — matching [`crate::vault`]'s `scan_folder` — leading `.`/`_` (those are
/// skipped by the scanner, so a piece created under such a name would be
/// invisible). Returns the trimmed, validated name.
fn validate_folder_name(name: &str) -> Result<&str, String> {
    let untrimmed = name;
    let name = name.trim();
    if name.is_empty() {
        return Err("A piece needs a folder name.".into());
    }
    if name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name.chars().any(windows_forbidden_component_character)
        || untrimmed.ends_with([' ', '.'])
        || windows_reserved_component(name)
        || name.encode_utf16().count() > MAX_PORTABLE_COMPONENT_UTF16
        || name == "."
        || name == ".."
        || Path::new(name).file_name() != Some(OsStr::new(name))
    {
        return Err("That piece folder name isn't allowed.".into());
    }
    if name.starts_with('.') || name.starts_with('_') {
        return Err("A piece folder name can't start with '.' or '_'.".into());
    }
    Ok(name)
}

/// A bare, in-directory filename with no traversal (mirrors the corpus module).
fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != "."
        && name != ".."
        && Path::new(name).file_name() == Some(OsStr::new(name))
}

/// A collision-free name inside `dir`: `desired`, else `stem-2.ext`, `stem-3.ext`…
fn unique_name(dir: &Path, desired: &str) -> String {
    if !dir.join(desired).exists() {
        return desired.to_string();
    }
    let (stem, ext) = match desired.rfind('.') {
        Some(index) if index > 0 => (&desired[..index], &desired[index..]),
        _ => (desired, ""),
    };
    let mut n = 2;
    loop {
        let candidate = format!("{stem}-{n}{ext}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

fn clean_piece_text(value: &str, label: &str, required: bool) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return if required {
            Err(format!("A piece needs a {label}."))
        } else {
            Ok(None)
        };
    }
    if value.chars().count() > 200 || value.chars().any(char::is_control) {
        return Err(format!(
            "The {label} must be 200 visible characters or fewer."
        ));
    }
    Ok(Some(value.to_string()))
}

/// Produce one safe direct-child directory name. The exact title/composer are
/// stored separately in SQLite; this name is only a stable filesystem home.
fn metadata_folder_name(title: &str, composer: Option<&str>) -> String {
    let raw = composer
        .map(|composer| format!("{composer} - {title}"))
        .unwrap_or_else(|| title.to_string());
    portable_component(&raw, "Piece", MAX_PORTABLE_COMPONENT_UTF16)
}

fn portable_pdf_name(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("score");
    format!(
        "{}.pdf",
        portable_component(stem, "score", MAX_PORTABLE_PDF_STEM_UTF16)
    )
}

fn ensure_real_trash(pieces_root: &Path) -> Result<std::path::PathBuf, String> {
    let trash = pieces_root.join(TRASH_DIR);
    if let Ok(metadata) = fs::symlink_metadata(&trash) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("The Pieces trash location isn't a real folder.".into());
        }
    } else {
        fs::create_dir(&trash)
            .map_err(|_| "Could not prepare the Pieces trash folder.".to_string())?;
    }
    Ok(trash)
}

fn quarantine_incomplete_import(pieces_root: &Path, folder_path: &Path) -> Result<(), String> {
    let trash = ensure_real_trash(pieces_root)?;
    let name = folder_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("failed-import");
    let destination = trash.join(unique_name(&trash, &format!("{name}-failed-import")));
    fs::rename(folder_path, destination)
        .map_err(|_| "Could not quarantine the incomplete import.".to_string())
}

/// Create a complete, ready-to-use piece from one local PDF. The source file is
/// copied, never moved. Filesystem publication happens before the SQLite insert;
/// if the insert fails, the just-created folder is quarantined under `.trash`
/// so a half-created piece can never appear in a subsequent scan.
pub fn create_from_pdf(
    pieces_root: &Path,
    store: &Store,
    title: &str,
    composer: Option<&str>,
    source: &Path,
    folder_id: Option<i64>,
) -> Result<crate::store::model::PieceDetail, String> {
    let title = clean_piece_text(title, "title", true)?.expect("required title");
    let composer = composer
        .map(|value| clean_piece_text(value, "composer", false))
        .transpose()?
        .flatten();
    if !pieces_root.is_absolute() {
        return Err("The Pieces folder path is misconfigured.".into());
    }
    fs::create_dir_all(pieces_root)
        .map_err(|_| "Could not create the app's Pieces folder.".to_string())?;

    let desired = metadata_folder_name(&title, composer.as_deref());
    let folder_name = unique_name(pieces_root, &desired);
    let folder_path = import_pdf(pieces_root, &folder_name, source)?;
    let scanned = crate::vault::scan_pieces(pieces_root)
        .into_iter()
        .find(|piece| piece.folder_path == folder_path)
        .and_then(|piece| piece.pdf_path);
    let Some(scanned) = scanned else {
        let cleanup = quarantine_incomplete_import(pieces_root, Path::new(&folder_path));
        return match cleanup {
            Ok(()) => Err("The copied PDF could not be found in its new piece folder.".into()),
            Err(cleanup) => Err(format!(
                "The copied PDF could not be found in its new piece folder; {cleanup}"
            )),
        };
    };
    let pdf_path = scanned.to_string_lossy().into_owned();

    let id = match store.insert_pdf_piece(
        &title,
        composer.as_deref(),
        &folder_path,
        &pdf_path,
        folder_id,
    ) {
        Ok(id) => id,
        Err(error) => {
            let trash_result = quarantine_incomplete_import(pieces_root, Path::new(&folder_path));
            return match trash_result {
                Ok(()) => Err(error.to_string()),
                Err(cleanup) => Err(format!("{error}; {cleanup}")),
            };
        }
    };
    store
        .get_piece(id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The newly created piece could not be read back.".to_string())
}

/// Remove one exact DB-selected repertoire piece from the active library by
/// moving its direct child folder under `.trash`. The database row is retained
/// and re-pointed, preserving every historical foreign-key relationship.
pub fn remove_to_trash(pieces_root: &Path, store: &Store, id: i64) -> Result<String, String> {
    let target = store
        .piece_removal_target(id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("piece {id} not found"))?;
    if !pieces_root.is_absolute() {
        return Err("The Pieces folder path is misconfigured.".into());
    }
    let canonical_root = pieces_root
        .canonicalize()
        .map_err(|_| "The Pieces folder could not be resolved.".to_string())?;
    let source = std::path::PathBuf::from(&target.folder_path);
    let metadata = fs::symlink_metadata(&source)
        .map_err(|_| "That piece's folder no longer exists.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("That piece is not stored in a real folder.".into());
    }
    let canonical_source = source
        .canonicalize()
        .map_err(|_| "That piece's folder could not be resolved.".to_string())?;
    if canonical_source.parent() != Some(canonical_root.as_path()) {
        return Err("That piece is outside the configured Pieces folder.".into());
    }

    let trash = ensure_real_trash(pieces_root)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(target.title.as_str());
    let destination = trash.join(unique_name(&trash, &format!("{source_name}-{stamp}")));
    fs::rename(&source, &destination)
        .map_err(|_| "Could not move the piece to the Pieces trash folder.".to_string())?;
    let new_path = destination.to_string_lossy().into_owned();
    match store.repoint_piece_folder_by_id(id, &new_path) {
        Ok(true) => Ok(new_path),
        Ok(false) | Err(_) => {
            if fs::rename(&destination, &source).is_err() {
                return Err(format!(
                    "The piece was moved to {new_path}, but its library record could not be updated; the files are preserved there for recovery."
                ));
            }
            Err("The piece library record could not be updated; no files were removed.".into())
        }
    }
}

/// Import a downloaded score PDF into `<pieces_root>/<folder_name>/score/`.
///
/// Validates that `source` exists, is a regular file (not a symlink), has a
/// `.pdf` extension, and actually begins with the `%PDF-` magic bytes; then
/// creates the piece's `score/` folder if needed and **copies** the file in
/// (collision-safe, never a move). Returns the piece folder path.
pub fn import_pdf(pieces_root: &Path, folder_name: &str, source: &Path) -> Result<String, String> {
    let folder_name = validate_folder_name(folder_name)?;
    if !pieces_root.is_absolute() {
        return Err("The pieces folder path is misconfigured.".into());
    }

    // Source must be a real, regular file we can read.
    let meta =
        fs::symlink_metadata(source).map_err(|_| "That file could not be found.".to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err("That download isn't a regular file.".into());
    }
    let is_pdf_ext = source
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !is_pdf_ext {
        return Err("Only PDF scores can be imported this way.".into());
    }
    // Magic bytes: a genuine PDF starts with "%PDF-". This is the real gate — the
    // extension alone is trivially forgeable.
    let mut header = [0u8; 5];
    let mut file =
        fs::File::open(source).map_err(|_| "That download could not be opened.".to_string())?;
    let read = file
        .read(&mut header)
        .map_err(|_| "That download could not be read.".to_string())?;
    if read < PDF_MAGIC.len() || &header[..PDF_MAGIC.len()] != PDF_MAGIC {
        return Err("That file isn't a valid PDF.".into());
    }

    // Refuse to follow a pre-existing SYMLINK at the piece folder or its `score/`
    // subdir — either could redirect the copy outside the vault. (`is_absolute`
    // + the single-component `folder_name` already rule out `..`/separators.)
    let piece_folder = pieces_root.join(folder_name);
    for candidate in [&piece_folder, &piece_folder.join("score")] {
        if let Ok(md) = fs::symlink_metadata(candidate) {
            if md.file_type().is_symlink() {
                return Err("That piece folder isn't a real directory.".into());
            }
        }
    }

    // Create the piece's score dir and copy the file in.
    let score_dir = piece_folder.join("score");
    fs::create_dir_all(&score_dir)
        .map_err(|_| "Could not create the piece's score folder.".to_string())?;

    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| is_safe_file_name(name))
        .ok_or_else(|| "That download has an unusable file name.".to_string())?;
    let base = portable_pdf_name(source_name);
    let dest_name = unique_name(&score_dir, &base);
    let destination = score_dir.join(&dest_name);
    fs::copy(source, &destination)
        .map_err(|_| "Could not copy the score into the piece folder.".to_string())?;

    // Defense in depth: prove the copy landed directly inside the score dir AND
    // that the score dir is contained by the (canonical) pieces root — mirrors
    // the score module's `starts_with(canonical_root)` containment idiom, so no
    // surprising symlink component can place the file outside the vault.
    let canonical_root = pieces_root
        .canonicalize()
        .map_err(|_| "The pieces folder could not be resolved.".to_string())?;
    let canonical_score = score_dir
        .canonicalize()
        .map_err(|_| "The piece's score folder could not be resolved.".to_string())?;
    let contained = canonical_score.starts_with(&canonical_root)
        && matches!(destination.canonicalize(), Ok(dest) if dest.parent() == Some(canonical_score.as_path()));
    if !contained {
        let _ = fs::remove_file(&destination);
        return Err("The import escaped the piece folder.".into());
    }

    Ok(pieces_root.join(folder_name).to_string_lossy().into_owned())
}

/// Delete a piece's files: move `<pieces_root>/<folder_name>` into
/// `<pieces_root>/.trash/<folder_name>-<unix_secs>/` and re-point its DB row's
/// `folder_path` so it drops out of [`Store::list_pieces`] (which filters
/// `%/.trash/%`). NEVER hard-deletes and NEVER deletes the DB row: all practice
/// history (`rep_block`/`rep`/`session_event`) referencing this piece is
/// preserved. `typed_name` must exactly match the folder name or the display
/// title, or the operation is refused. This is deliberately distinct from
/// schema-v17's reversible logical archive, which never moves files.
#[cfg(test)]
pub fn delete_files(
    pieces_root: &Path,
    store: &Store,
    folder_name: &str,
    typed_name: &str,
) -> Result<String, String> {
    let folder_name = validate_folder_name(folder_name)?;
    if !pieces_root.is_absolute() {
        return Err("The pieces folder path is misconfigured.".into());
    }

    let folder = pieces_root.join(folder_name);
    let meta = fs::symlink_metadata(&folder)
        .map_err(|_| "That piece folder no longer exists.".to_string())?;
    if !meta.is_dir() {
        return Err("That piece isn't a folder.".into());
    }

    // Typed-name gate. The display title is the folder name's post-" - " part
    // (matching `vault::scan_folder`); accept either the folder name or the title
    // exactly (trimmed). Anything else is refused so a wrong name can't archive.
    let title = folder_name
        .split_once(" - ")
        .map(|(_, t)| t.trim())
        .unwrap_or(folder_name);
    let typed = typed_name.trim();
    if typed != folder_name && typed != title {
        return Err("The name you typed doesn't match this piece.".into());
    }

    // Move (never delete) into the in-root `.trash/`.
    let trash = pieces_root.join(TRASH_DIR);
    fs::create_dir_all(&trash).map_err(|_| "Could not prepare the trash folder.".to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest_name = unique_name(&trash, &format!("{folder_name}-{stamp}"));
    let destination = trash.join(&dest_name);
    fs::rename(&folder, &destination)
        .map_err(|_| "Could not move the piece to the trash folder.".to_string())?;

    // Re-point the DB row (best-effort: a just-imported piece not yet scanned has
    // no row, which is fine — there is nothing to hide). The row is never deleted,
    // so history stays intact and joinable.
    let old = folder.to_string_lossy().into_owned();
    let new = destination.to_string_lossy().into_owned();
    store
        .repoint_piece_folder(&old, &new)
        .map_err(|e| e.to_string())?;

    Ok(new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use tempfile::TempDir;

    /// Bytes of a minimal but valid PDF (starts with the `%PDF-` magic).
    const PDF_BYTES: &[u8] = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n";

    fn write(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    // ---- import_pdf ----

    #[test]
    fn import_copies_valid_pdf_into_score_folder_and_leaves_source() {
        let root = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("Chopin_Nocturne.pdf");
        write(&source, PDF_BYTES);

        let folder = import_pdf(root.path(), "Chopin - Nocturne", &source).unwrap();

        // The piece folder path is returned.
        assert_eq!(
            folder,
            root.path().join("Chopin - Nocturne").to_string_lossy()
        );
        // The file was COPIED (source still there) into score/ with identical bytes.
        assert!(source.exists(), "the user's download is never moved");
        let dest = root
            .path()
            .join("Chopin - Nocturne/score/Chopin_Nocturne.pdf");
        assert!(dest.exists());
        assert_eq!(fs::read(&dest).unwrap(), PDF_BYTES);
    }

    #[test]
    fn import_is_collision_safe() {
        let root = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("score.pdf");
        write(&source, PDF_BYTES);

        import_pdf(root.path(), "Bach - Fugue", &source).unwrap();
        import_pdf(root.path(), "Bach - Fugue", &source).unwrap();

        let score_dir = root.path().join("Bach - Fugue/score");
        assert!(score_dir.join("score.pdf").exists());
        assert!(score_dir.join("score-2.pdf").exists());
    }

    #[test]
    fn import_rejects_non_pdf_extension() {
        let root = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("notes.txt");
        write(&source, PDF_BYTES); // valid magic, wrong extension
        let err = import_pdf(root.path(), "X - Y", &source).unwrap_err();
        assert!(err.contains("PDF"), "got: {err}");
    }

    #[test]
    fn import_rejects_pdf_extension_without_magic_bytes() {
        let root = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("fake.pdf");
        write(&source, b"<html>bot check</html>");
        let err = import_pdf(root.path(), "X - Y", &source).unwrap_err();
        assert!(err.contains("valid PDF"), "got: {err}");
        // Nothing was created for a rejected import.
        assert!(!root.path().join("X - Y").exists());
    }

    #[test]
    fn import_rejects_missing_source() {
        let root = TempDir::new().unwrap();
        let err = import_pdf(root.path(), "X - Y", Path::new("/no/such/file.pdf")).unwrap_err();
        assert!(err.contains("could not be found"), "got: {err}");
    }

    #[test]
    fn import_rejects_folder_name_path_escape() {
        let root = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("score.pdf");
        write(&source, PDF_BYTES);
        for bad in [
            "../escape",
            "a/b",
            "..",
            ".hidden",
            "_template",
            "CON",
            "nul.txt",
            "Etude:",
            "trailing.",
            "trailing ",
        ] {
            let err = import_pdf(root.path(), bad, &source).unwrap_err();
            assert!(!err.is_empty(), "'{bad}' should be rejected");
        }
        // No traversal ever created a folder outside the root.
        assert!(!root.path().parent().unwrap().join("escape").exists());
    }

    #[test]
    fn metadata_and_pdf_names_are_portable_to_windows() {
        assert_eq!(
            metadata_folder_name("Prelude: Fugue?*", Some("CON")),
            "CON - Prelude– Fugue––"
        );
        assert_eq!(metadata_folder_name("NUL", None), "Piece NUL");
        assert_eq!(metadata_folder_name("title. ", None), "title");
        assert_eq!(portable_pdf_name("CON.pdf"), "Piece CON.pdf");
        assert_eq!(portable_pdf_name("Score: final?.PDF"), "Score– final–.pdf");
        let long = "𝄞".repeat(MAX_PORTABLE_COMPONENT_UTF16);
        let safe = metadata_folder_name(&long, None);
        assert!(safe.encode_utf16().count() <= MAX_PORTABLE_COMPONENT_UTF16);
        assert!(!safe.ends_with([' ', '.']));
    }

    #[test]
    #[cfg(unix)]
    fn import_refuses_a_symlinked_piece_folder() {
        use std::os::unix::fs::symlink;
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let dl = TempDir::new().unwrap();
        let source = dl.path().join("score.pdf");
        write(&source, PDF_BYTES);

        // A piece "folder" that is actually a symlink to a dir outside the vault.
        symlink(outside.path(), root.path().join("Sneaky")).unwrap();

        let err = import_pdf(root.path(), "Sneaky", &source).unwrap_err();
        assert!(err.contains("real directory"), "got: {err}");
        // Nothing was written into the symlink target.
        assert!(!outside.path().join("score/score.pdf").exists());
    }

    #[test]
    fn simple_create_copies_pdf_and_persists_user_metadata_and_folder() {
        let root = TempDir::new().unwrap();
        let downloads = TempDir::new().unwrap();
        let source = downloads.path().join("download.pdf");
        write(&source, PDF_BYTES);
        let store = Store::open(":memory:").unwrap();
        let folder = store.piece_folder_create("Audition", None).unwrap();

        let piece = create_from_pdf(
            root.path(),
            &store,
            "Ballade / sketch",
            Some("Chopin"),
            &source,
            Some(folder.id),
        )
        .unwrap();

        assert!(
            source.exists(),
            "the selected source is copied, never moved"
        );
        assert_eq!(piece.title, "Ballade / sketch");
        assert_eq!(piece.composer.as_deref(), Some("Chopin"));
        assert_eq!(piece.folder_id, Some(folder.id));
        assert!(piece.intake_done);
        assert!(piece
            .pdf_path
            .as_deref()
            .is_some_and(|path| Path::new(path).exists()));

        // A scanner refresh may update score paths, but user-entered metadata
        // stays exact even when the filesystem-safe folder name differs.
        for scanned in crate::vault::scan_pieces(root.path()) {
            store.upsert_piece(&scanned).unwrap();
        }
        let refreshed = store.get_piece(piece.id).unwrap().unwrap();
        assert_eq!(refreshed.title, "Ballade / sketch");
        assert_eq!(refreshed.composer.as_deref(), Some("Chopin"));
    }

    #[test]
    fn long_metadata_and_source_name_import_with_bounded_portable_paths() {
        let root = TempDir::new().unwrap();
        let downloads = TempDir::new().unwrap();
        let source_name = format!("{}.pdf", "source".repeat(24));
        let source = downloads.path().join(&source_name);
        write(&source, PDF_BYTES);
        let store = Store::open(":memory:").unwrap();
        let title = "Long title ".repeat(18);
        let composer = "Long composer ".repeat(14);

        let piece =
            create_from_pdf(root.path(), &store, &title, Some(&composer), &source, None).unwrap();

        assert_eq!(piece.title, title.trim());
        assert_eq!(piece.composer.as_deref(), Some(composer.trim()));
        let folder = Path::new(&piece.folder_path);
        let folder_name = folder.file_name().unwrap().to_string_lossy();
        assert!(folder_name.encode_utf16().count() <= MAX_PORTABLE_COMPONENT_UTF16);
        let copied = fs::read_dir(folder.join("score"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let copied_stem = copied.file_stem().unwrap().to_string_lossy();
        assert!(copied_stem.encode_utf16().count() <= MAX_PORTABLE_PDF_STEM_UTF16);
        assert_eq!(fs::read(copied).unwrap(), PDF_BYTES);
        assert!(
            source.exists(),
            "the long-named source is still copied, never moved"
        );
    }

    // ---- delete files ----

    /// A root with one scanned piece folder + its DB row. Returns (root, store,
    /// piece_id, folder_name).
    fn delete_files_fixture() -> (TempDir, Store, i64, String) {
        let root = TempDir::new().unwrap();
        let folder_name = "Chopin - Scherzo".to_string();
        let folder = root.path().join(&folder_name);
        write(&folder.join("score/score.pdf"), PDF_BYTES);

        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: folder.to_string_lossy().into_owned(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: Some(folder.join("score/score.pdf")),
            })
            .unwrap();
        (root, store, id, folder_name)
    }

    #[test]
    fn delete_files_rejects_wrong_typed_name() {
        let (root, store, _id, folder_name) = delete_files_fixture();
        let err = delete_files(root.path(), &store, &folder_name, "Nocturne").unwrap_err();
        assert!(err.contains("doesn't match"), "got: {err}");
        // Refused: the folder is untouched and the piece is still listed.
        assert!(root.path().join(&folder_name).exists());
        assert_eq!(store.list_pieces().unwrap().len(), 1);
    }

    #[test]
    fn delete_files_accepts_title_or_folder_name_and_moves_to_trash() {
        // Accept the display title...
        let (root, store, _id, folder_name) = delete_files_fixture();
        let dest = delete_files(root.path(), &store, &folder_name, "Scherzo").unwrap();
        assert!(dest.contains("/.trash/"), "moved into .trash: {dest}");
        assert!(
            !root.path().join(&folder_name).exists(),
            "original folder gone"
        );
        assert!(
            Path::new(&dest).join("score/score.pdf").exists(),
            "contents preserved"
        );
        // The piece dropped out of the workspace listing...
        assert!(store.list_pieces().unwrap().is_empty());
        // ...but its DB row (and thus all history) is preserved.
        assert!(store.get_piece(_id).unwrap().is_some());

        // ...and accept the exact folder name too.
        let (root2, store2, _id2, folder_name2) = delete_files_fixture();
        delete_files(root2.path(), &store2, &folder_name2, &folder_name2).unwrap();
        assert!(store2.list_pieces().unwrap().is_empty());
    }

    #[test]
    fn delete_files_rejects_missing_folder_and_path_escape() {
        let (root, store, _id, _folder) = delete_files_fixture();
        assert!(delete_files(root.path(), &store, "Ghost - Piece", "Piece").is_err());
        assert!(delete_files(root.path(), &store, "../escape", "escape").is_err());
    }

    #[test]
    fn id_based_remove_moves_files_and_preserves_piece_row() {
        let (root, store, id, folder_name) = delete_files_fixture();
        store.exec_for_test(&format!(
            "INSERT INTO rep_block
               (id,piece_id,m_start,m_end,planned_reps,status,focus,use_metronome)
             VALUES (700,{id},1,4,1,'done','notes',0);
             INSERT INTO rep(block_id,bpm,verdict) VALUES (700,60,'clean');"
        ));
        let destination = remove_to_trash(root.path(), &store, id).unwrap();
        assert!(destination.contains("/.trash/"));
        assert!(!root.path().join(folder_name).exists());
        assert!(Path::new(&destination).join("score/score.pdf").exists());
        assert!(store.list_pieces().unwrap().is_empty());
        let retained = store.get_piece(id).unwrap().unwrap();
        assert_eq!(retained.folder_path, destination);
        let history = store.block_history(id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].reps_done, 1);
    }

    #[test]
    fn id_based_remove_refuses_a_row_outside_the_configured_root() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let folder = outside.path().join("Outside");
        write(&folder.join("score/score.pdf"), PDF_BYTES);
        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: folder.to_string_lossy().into_owned(),
                title: "Outside".into(),
                composer: None,
                xml_path: None,
                pdf_path: Some(folder.join("score/score.pdf")),
            })
            .unwrap();
        assert!(remove_to_trash(root.path(), &store, id).is_err());
        assert!(folder.exists());
        assert_eq!(store.list_pieces().unwrap().len(), 1);
    }
}
