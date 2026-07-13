//! Secure, read-only access to the real PDF editions inside one vault piece.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::store::Store;

/// Frontend contract for one selectable real-score edition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PdfEdition {
    pub id: String,
    pub label: String,
    pub size_bytes: u64,
    pub modified_unix: u64,
    pub fingerprint: String,
    pub selected: bool,
}

#[derive(Debug)]
struct DiscoveredEdition {
    wire: PdfEdition,
    path: PathBuf,
}

/// Discover every direct PDF under a piece's `score/` directory, then its
/// folder root. Paths never come from the frontend: an edition id is resolved
/// only by matching this freshly validated list.
pub fn pdf_editions(store: &Store, piece_id: i64) -> Result<Vec<PdfEdition>, String> {
    Ok(discover(store, piece_id)?
        .into_iter()
        .map(|edition| edition.wire)
        .collect())
}

pub fn select_pdf(store: &Store, piece_id: i64, edition_id: &str) -> Result<PdfEdition, String> {
    let edition = resolve_edition(store, piece_id, edition_id)?;
    let path = edition.path.to_string_lossy().into_owned();
    if !store
        .set_preferred_pdf_path(piece_id, &path)
        .map_err(|e| format!("save PDF preference: {e}"))?
    {
        return Err(format!("piece {piece_id} not found"));
    }
    let mut selected = edition.wire;
    selected.selected = true;
    Ok(selected)
}

pub fn pdf_bytes(store: &Store, piece_id: i64, edition_id: &str) -> Result<Vec<u8>, String> {
    let edition = resolve_edition(store, piece_id, edition_id)?;
    std::fs::read(&edition.path).map_err(|e| format!("read PDF edition '{edition_id}': {e}"))
}

fn resolve_edition(
    store: &Store,
    piece_id: i64,
    edition_id: &str,
) -> Result<DiscoveredEdition, String> {
    discover(store, piece_id)?
        .into_iter()
        .find(|edition| edition.wire.id == edition_id)
        .ok_or_else(|| format!("PDF edition '{edition_id}' not found for piece {piece_id}"))
}

fn discover(store: &Store, piece_id: i64) -> Result<Vec<DiscoveredEdition>, String> {
    let paths = store
        .piece_pdf_paths(piece_id)
        .map_err(|e| format!("load piece {piece_id}: {e}"))?
        .ok_or_else(|| format!("piece {piece_id} not found"))?;
    let root = PathBuf::from(paths.folder_path);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("open piece {piece_id} folder: {e}"))?;

    let selected = paths
        .preferred_pdf_path
        .as_deref()
        .or(paths.scanned_pdf_path.as_deref())
        .and_then(|path| {
            Path::new(path)
                .canonicalize()
                .ok()
                .filter(|path| path.starts_with(&canonical_root))
        });

    let mut output = Vec::new();
    let mut ids = HashSet::new();
    for directory in [root.join("score"), root.clone()] {
        let mut paths: Vec<PathBuf> = match std::fs::read_dir(&directory) {
            Ok(entries) => entries
                .flatten()
                .filter_map(|entry| {
                    let file_type = entry.file_type().ok()?;
                    // Never follow file symlinks. A symlinked `score/` directory
                    // is still contained by the canonical-path check below.
                    if !file_type.is_file() || file_type.is_symlink() {
                        return None;
                    }
                    let path = entry.path();
                    let is_pdf = path
                        .extension()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value.eq_ignore_ascii_case("pdf"));
                    let visible = path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| !value.starts_with('.'));
                    (is_pdf && visible).then_some(path)
                })
                .collect(),
            Err(_) => continue,
        };
        paths.sort();

        for path in paths {
            let canonical = match path.canonicalize() {
                Ok(path) if path.starts_with(&canonical_root) => path,
                _ => continue,
            };
            let relative = match path.strip_prefix(&root) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let id = relative
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            if !ids.insert(id.clone()) {
                continue;
            }
            let metadata = match canonical.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let size_bytes = metadata.len();
            let modified_unix = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_secs());
            let label = readable_label(&path);
            output.push(DiscoveredEdition {
                wire: PdfEdition {
                    id,
                    label,
                    size_bytes,
                    modified_unix,
                    fingerprint: format!("{size_bytes:x}-{modified_unix:x}"),
                    selected: selected.as_ref().is_some_and(|value| value == &canonical),
                },
                path: canonical,
            });
        }
    }
    Ok(output)
}

fn readable_label(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("PDF edition")
        .strip_prefix("(C) ")
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("PDF edition")
        })
        .replace('_', " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use std::fs;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, Store, i64) {
        let td = TempDir::new().unwrap();
        let piece = td.path().join("Chopin - Scherzo");
        fs::create_dir_all(piece.join("score")).unwrap();
        fs::write(piece.join("score/(C) Ekier_Draft.pdf"), b"ekier").unwrap();
        fs::write(piece.join("score/Cortot.PDF"), b"cortot-edition").unwrap();
        fs::write(piece.join("Root edition.pdf"), b"root").unwrap();
        fs::write(piece.join("score/not-a-pdf.txt"), b"no").unwrap();
        fs::create_dir_all(piece.join("score/nested")).unwrap();
        fs::write(piece.join("score/nested/hidden.pdf"), b"nested").unwrap();

        let store = Store::open(":memory:").unwrap();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: piece.to_string_lossy().into_owned(),
                title: "Scherzo".into(),
                composer: Some("Chopin".into()),
                xml_path: None,
                pdf_path: Some(piece.join("score/(C) Ekier_Draft.pdf")),
            })
            .unwrap();
        (td, store, id)
    }

    #[test]
    fn discovers_all_direct_pdf_editions_score_then_root() {
        let (_td, store, id) = fixture();
        let editions = pdf_editions(&store, id).unwrap();
        assert_eq!(
            editions.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            [
                "score/(C) Ekier_Draft.pdf",
                "score/Cortot.PDF",
                "Root edition.pdf"
            ]
        );
        assert_eq!(editions[0].label, "Ekier Draft");
        assert_eq!(editions[0].size_bytes, 5);
        assert!(!editions[0].fingerprint.is_empty());
        assert!(editions[0].selected);
        assert_eq!(editions.iter().filter(|e| e.selected).count(), 1);
    }

    #[test]
    fn selecting_an_edition_survives_a_rescan() {
        let (_td, store, id) = fixture();
        let selected = select_pdf(&store, id, "score/Cortot.PDF").unwrap();
        assert!(selected.selected);
        let after_select = store.get_piece(id).unwrap().unwrap();
        let expected = std::path::PathBuf::from(&after_select.folder_path)
            .join("score/Cortot.PDF")
            .canonicalize()
            .unwrap();
        assert_eq!(after_select.pdf_path.as_deref(), expected.to_str());

        let detail = store.get_piece(id).unwrap().unwrap();
        store
            .upsert_piece(&ScanPiece {
                folder_path: detail.folder_path.clone(),
                title: detail.title,
                composer: detail.composer,
                xml_path: None,
                pdf_path: Some(
                    std::path::PathBuf::from(&detail.folder_path).join("Root edition.pdf"),
                ),
            })
            .unwrap();
        assert!(store
            .get_piece(id)
            .unwrap()
            .unwrap()
            .pdf_path
            .unwrap()
            .ends_with("score/Cortot.PDF"));
        assert!(
            pdf_editions(&store, id)
                .unwrap()
                .iter()
                .find(|e| e.id == "score/Cortot.PDF")
                .unwrap()
                .selected
        );
    }

    #[test]
    fn bytes_are_exact_and_untrusted_ids_cannot_escape_or_cross_pieces() {
        let (td, store, id) = fixture();
        assert_eq!(
            pdf_bytes(&store, id, "score/Cortot.PDF").unwrap(),
            b"cortot-edition"
        );
        fs::write(td.path().join("outside.pdf"), b"secret").unwrap();
        assert!(pdf_bytes(&store, id, "../outside.pdf")
            .unwrap_err()
            .contains("edition"));
        assert!(select_pdf(&store, id, "../outside.pdf").is_err());
        assert!(store
            .get_piece(id)
            .unwrap()
            .unwrap()
            .pdf_path
            .unwrap()
            .ends_with("score/(C) Ekier_Draft.pdf"));

        let other = td.path().join("Other - Piece");
        fs::create_dir_all(other.join("score")).unwrap();
        let other_id = store
            .upsert_piece(&ScanPiece {
                folder_path: other.to_string_lossy().into_owned(),
                title: "Other".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert!(pdf_bytes(&store, other_id, "score/Cortot.PDF").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_pdf_outside_the_piece_is_not_exposed() {
        use std::os::unix::fs::symlink;
        let (td, store, id) = fixture();
        let outside = td.path().join("outside.pdf");
        fs::write(&outside, b"secret").unwrap();
        let folder = std::path::PathBuf::from(store.get_piece(id).unwrap().unwrap().folder_path);
        symlink(outside, folder.join("score/escape.pdf")).unwrap();
        assert!(pdf_editions(&store, id)
            .unwrap()
            .iter()
            .all(|e| e.id != "score/escape.pdf"));
    }
}
