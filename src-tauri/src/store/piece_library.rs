//! Logical Pieces-library organization and reversible library state.
//!
//! Folders here are database-only labels. They never move score files, so a
//! drag in the library cannot invalidate an edition path, Region anchor, or
//! practice-history relationship.

use std::path::PathBuf;

use rusqlite::{params, OptionalExtension, Transaction};

use super::model::{PieceDetail, PieceFolder};
use super::Store;

fn invalid(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

fn clean_folder_name(name: &str) -> rusqlite::Result<String> {
    let name = name.trim();
    let length = name.chars().count();
    if length == 0 || length > 120 || name.chars().any(char::is_control) {
        return Err(invalid("A folder name must be 1–120 visible characters."));
    }
    Ok(name.to_string())
}

fn folder_row(tx: &Transaction<'_>, id: i64) -> rusqlite::Result<Option<PieceFolder>> {
    tx.query_row(
        "SELECT id,name,parent_id FROM piece_folder WHERE id=?1",
        [id],
        |row| {
            Ok(PieceFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
            })
        },
    )
    .optional()
}

fn sibling_name_taken(
    tx: &Transaction<'_>,
    parent_id: Option<i64>,
    name: &str,
    excluding_id: Option<i64>,
) -> rusqlite::Result<bool> {
    tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM piece_folder
            WHERE parent_id IS ?1
              AND lower(trim(name))=lower(trim(?2))
              AND (?3 IS NULL OR id != ?3)
         )",
        params![parent_id, name, excluding_id],
        |row| row.get(0),
    )
}

fn with_suffix(name: &str, n: u32) -> String {
    let suffix = format!(" ({n})");
    let keep = 120usize.saturating_sub(suffix.chars().count());
    let base: String = name.chars().take(keep).collect();
    format!("{base}{suffix}")
}

fn unique_sibling_name(
    tx: &Transaction<'_>,
    parent_id: Option<i64>,
    desired: &str,
    excluding_id: Option<i64>,
) -> rusqlite::Result<String> {
    if !sibling_name_taken(tx, parent_id, desired, excluding_id)? {
        return Ok(desired.to_string());
    }
    for n in 2..=10_000 {
        let candidate = with_suffix(desired, n);
        if !sibling_name_taken(tx, parent_id, &candidate, excluding_id)? {
            return Ok(candidate);
        }
    }
    Err(invalid("Could not find a unique folder name."))
}

/// Exact filesystem identity used by the ID-based remove-to-trash path.
pub(crate) struct PieceRemovalTarget {
    pub folder_path: String,
    pub title: String,
}

impl Store {
    pub fn piece_folder_list(&self) -> rusqlite::Result<Vec<PieceFolder>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut statement = conn.prepare(
            "SELECT id,name,parent_id FROM piece_folder
             ORDER BY name COLLATE NOCASE,id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(PieceFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn piece_folder_create(
        &self,
        name: &str,
        parent_id: Option<i64>,
    ) -> rusqlite::Result<PieceFolder> {
        let name = clean_folder_name(name)?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        if let Some(parent_id) = parent_id {
            if folder_row(&tx, parent_id)?.is_none() {
                return Err(invalid(format!("folder {parent_id} not found")));
            }
        }
        if sibling_name_taken(&tx, parent_id, &name, None)? {
            return Err(invalid("A folder with that name already exists here."));
        }
        let id: i64 = tx.query_row(
            "INSERT INTO piece_folder(name,parent_id) VALUES (?1,?2) RETURNING id",
            params![name, parent_id],
            |row| row.get(0),
        )?;
        let folder = folder_row(&tx, id)?.ok_or_else(|| invalid("created folder disappeared"))?;
        tx.commit()?;
        Ok(folder)
    }

    pub fn piece_folder_rename(&self, id: i64, name: &str) -> rusqlite::Result<PieceFolder> {
        let name = clean_folder_name(name)?;
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let current =
            folder_row(&tx, id)?.ok_or_else(|| invalid(format!("folder {id} not found")))?;
        if sibling_name_taken(&tx, current.parent_id, &name, Some(id))? {
            return Err(invalid("A folder with that name already exists here."));
        }
        tx.execute(
            "UPDATE piece_folder SET name=?2,updated_at=datetime('now') WHERE id=?1",
            params![id, name],
        )?;
        let folder = folder_row(&tx, id)?.ok_or_else(|| invalid("renamed folder disappeared"))?;
        tx.commit()?;
        Ok(folder)
    }

    pub fn piece_folder_reparent(
        &self,
        id: i64,
        parent_id: Option<i64>,
    ) -> rusqlite::Result<PieceFolder> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let current =
            folder_row(&tx, id)?.ok_or_else(|| invalid(format!("folder {id} not found")))?;
        if let Some(parent_id) = parent_id {
            if parent_id == id {
                return Err(invalid("A folder cannot contain itself."));
            }
            if folder_row(&tx, parent_id)?.is_none() {
                return Err(invalid(format!("folder {parent_id} not found")));
            }
            let cycle: bool = tx.query_row(
                "WITH RECURSIVE descendants(id) AS (
                   SELECT id FROM piece_folder WHERE parent_id=?1
                   UNION ALL
                   SELECT folder.id FROM piece_folder AS folder
                   JOIN descendants ON folder.parent_id=descendants.id
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id=?2)",
                params![id, parent_id],
                |row| row.get(0),
            )?;
            if cycle {
                return Err(invalid(
                    "A folder cannot be moved inside one of its children.",
                ));
            }
        }
        if sibling_name_taken(&tx, parent_id, &current.name, Some(id))? {
            return Err(invalid("A folder with that name already exists there."));
        }
        tx.execute(
            "UPDATE piece_folder SET parent_id=?2,updated_at=datetime('now') WHERE id=?1",
            params![id, parent_id],
        )?;
        let folder = folder_row(&tx, id)?.ok_or_else(|| invalid("moved folder disappeared"))?;
        tx.commit()?;
        Ok(folder)
    }

    /// Delete only the logical folder. Its pieces and direct child folders are
    /// promoted to the deleted folder's parent in the same transaction. A
    /// colliding child-folder name receives a Finder-style numeric suffix so
    /// deletion can never fail by stranding or dropping contents.
    pub fn piece_folder_delete(&self, id: i64) -> rusqlite::Result<()> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let current =
            folder_row(&tx, id)?.ok_or_else(|| invalid(format!("folder {id} not found")))?;
        let children: Vec<(i64, String)> = {
            let mut statement = tx.prepare(
                "SELECT id,name FROM piece_folder WHERE parent_id=?1
                 ORDER BY name COLLATE NOCASE,id",
            )?;
            let rows = statement
                .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            rows
        };
        for (child_id, child_name) in children {
            let promoted_name =
                unique_sibling_name(&tx, current.parent_id, &child_name, Some(child_id))?;
            tx.execute(
                "UPDATE piece_folder
                 SET parent_id=?2,name=?3,updated_at=datetime('now') WHERE id=?1",
                params![child_id, current.parent_id, promoted_name],
            )?;
        }
        tx.execute(
            "UPDATE piece SET folder_id=?2 WHERE folder_id=?1",
            params![id, current.parent_id],
        )?;
        tx.execute("DELETE FROM piece_folder WHERE id=?1", [id])?;
        tx.commit()
    }

    pub fn piece_move(&self, id: i64, folder_id: Option<i64>) -> rusqlite::Result<PieceDetail> {
        {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if let Some(folder_id) = folder_id {
                let exists: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM piece_folder WHERE id=?1)",
                    [folder_id],
                    |row| row.get(0),
                )?;
                if !exists {
                    return Err(invalid(format!("folder {folder_id} not found")));
                }
            }
            if conn.execute(
                "UPDATE piece SET folder_id=?2
                 WHERE id=?1 AND kind='repertoire'
                   AND replace(folder_path, char(92), '/') NOT LIKE '%/.trash/%'",
                params![id, folder_id],
            )? != 1
            {
                return Err(invalid(format!("piece {id} not found")));
            }
        }
        self.get_piece(id)?
            .ok_or_else(|| invalid(format!("piece {id} not found")))
    }

    pub fn set_piece_completed(&self, id: i64, completed: bool) -> rusqlite::Result<PieceDetail> {
        {
            let conn = self
                .conn
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let sql = if completed {
                "UPDATE piece
                 SET completed_at=CAST(strftime('%s','now') AS INTEGER),archived_at=NULL
                 WHERE id=?1 AND kind='repertoire'
                   AND replace(folder_path, char(92), '/') NOT LIKE '%/.trash/%'"
            } else {
                "UPDATE piece SET completed_at=NULL
                 WHERE id=?1 AND kind='repertoire'
                   AND replace(folder_path, char(92), '/') NOT LIKE '%/.trash/%'"
            };
            if conn.execute(sql, [id])? != 1 {
                return Err(invalid(format!("piece {id} not found")));
            }
        }
        self.get_piece(id)?
            .ok_or_else(|| invalid(format!("piece {id} not found")))
    }

    pub(crate) fn insert_pdf_piece(
        &self,
        title: &str,
        composer: Option<&str>,
        folder_path: &str,
        pdf_path: &str,
        folder_id: Option<i64>,
    ) -> rusqlite::Result<i64> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "INSERT INTO piece
               (title,composer,folder_path,pdf_path,preferred_pdf_path,intake_done,folder_id,
                metadata_source)
             VALUES (?1,?2,?3,?4,?4,1,?5,'user')
             RETURNING id",
            params![title, composer, folder_path, pdf_path, folder_id],
            |row| row.get(0),
        )
    }

    pub(crate) fn piece_removal_target(
        &self,
        id: i64,
    ) -> rusqlite::Result<Option<PieceRemovalTarget>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        conn.query_row(
            "SELECT folder_path,title FROM piece
             WHERE id=?1 AND kind='repertoire'
               AND replace(folder_path, char(92), '/') NOT LIKE '%/.trash/%'",
            [id],
            |row| {
                Ok(PieceRemovalTarget {
                    folder_path: row.get(0)?,
                    title: row.get(1)?,
                })
            },
        )
        .optional()
    }

    pub(crate) fn repoint_piece_folder_by_id(
        &self,
        id: i64,
        new_path: &str,
    ) -> rusqlite::Result<bool> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(conn.execute(
            "UPDATE piece SET folder_path=?2,folder_id=NULL WHERE id=?1 AND kind='repertoire'",
            params![id, new_path],
        )? == 1)
    }

    /// Recover the old scanner root without embedding any user's path in the
    /// application. Used only when upgrading a database that predates the
    /// app-owned Pieces directory setting.
    pub(crate) fn infer_legacy_pieces_dir(&self) -> rusqlite::Result<Option<PathBuf>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut statement = conn.prepare(
            "SELECT folder_path FROM piece
             WHERE kind='repertoire'
               AND replace(folder_path, char(92), '/') NOT LIKE '%/.trash/%'
             ORDER BY id",
        )?;
        let paths: Vec<String> = statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut parents = paths
            .iter()
            .filter_map(|raw| PathBuf::from(raw).parent().map(ToOwned::to_owned));
        let Some(first) = parents.next() else {
            return Ok(None);
        };
        if !first.is_absolute() || parents.any(|parent| parent != first) {
            return Ok(None);
        }
        Ok(Some(first))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;

    fn store() -> Store {
        Store::open(":memory:").unwrap()
    }

    #[test]
    fn nested_folders_reject_cycles_and_delete_promotes_everything() {
        let store = store();
        let root = store.piece_folder_create("Repertoire", None).unwrap();
        let child = store
            .piece_folder_create("Classical", Some(root.id))
            .unwrap();
        let grandchild = store
            .piece_folder_create("Sonatas", Some(child.id))
            .unwrap();
        store.piece_folder_create("Sonatas", Some(root.id)).unwrap();
        assert!(store
            .piece_folder_reparent(root.id, Some(grandchild.id))
            .is_err());

        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/scores/sonata".into(),
                title: "Sonata".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        store.piece_move(piece_id, Some(child.id)).unwrap();
        store.piece_folder_delete(child.id).unwrap();

        assert_eq!(
            store.get_piece(piece_id).unwrap().unwrap().folder_id,
            Some(root.id)
        );
        let promoted = store
            .piece_folder_list()
            .unwrap()
            .into_iter()
            .find(|folder| folder.id == grandchild.id)
            .unwrap();
        assert_eq!(promoted.parent_id, Some(root.id));
        assert_eq!(promoted.name, "Sonatas (2)");
    }

    #[test]
    fn completion_is_reversible_and_excluded_only_from_the_active_projection() {
        let store = store();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/scores/etude".into(),
                title: "Etude".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        assert_eq!(store.list_pieces().unwrap().len(), 1);
        let completed = store.set_piece_completed(id, true).unwrap();
        assert!(completed.completed_at.is_some());
        assert!(store.list_pieces().unwrap().is_empty());
        assert_eq!(store.list_pieces_including_archived().unwrap().len(), 1);
        let active = store.set_piece_completed(id, false).unwrap();
        assert_eq!(active.completed_at, None);
        assert_eq!(store.list_pieces().unwrap().len(), 1);
    }

    #[test]
    fn windows_trash_paths_are_hidden_and_rejected_by_library_mutations() {
        let store = store();
        let id = store
            .upsert_piece(&ScanPiece {
                folder_path: r"C:\Users\Friend\AppData\Roaming\CodaKiller\Pieces\.trash\Etude-1"
                    .into(),
                title: "Etude".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();

        assert!(store.list_pieces().unwrap().is_empty());
        assert!(store.list_pieces_including_archived().unwrap().is_empty());
        assert!(!store.set_piece_archived(id, true).unwrap());
        assert!(store.set_piece_completed(id, true).is_err());
        assert!(store.piece_move(id, None).is_err());
        assert!(store.piece_removal_target(id).unwrap().is_none());
        assert!(store.infer_legacy_pieces_dir().unwrap().is_none());
        assert!(
            store.get_piece(id).unwrap().is_some(),
            "history identity stays durable"
        );
    }
}
