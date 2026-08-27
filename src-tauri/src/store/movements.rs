//! Schema-v17 PDF movement persistence.
//!
//! A movement stores only its first page. The next movement start (or the live
//! PDF page count) supplies the inclusive end at read time, which keeps the DB
//! honest when a PDF edition changes length.

use rusqlite::OptionalExtension;

use super::model::{PieceMovement, PieceMovementCreate, PieceMovementPatch};
use super::Store;

fn title(value: String) -> rusqlite::Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.chars().count() > 200 {
        return Err(rusqlite::Error::InvalidParameterName(
            "movement title must be 1–200 characters".into(),
        ));
    }
    Ok(value)
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PieceMovement> {
    Ok(PieceMovement {
        id: row.get(0)?,
        piece_id: row.get(1)?,
        title: row.get(2)?,
        start_page: row.get(3)?,
        display_order: row.get(4)?,
    })
}

impl Store {
    pub fn piece_movement_list(&self, piece_id: i64) -> rusqlite::Result<Vec<PieceMovement>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut statement = conn.prepare(
            "SELECT id,piece_id,title,start_page,display_order
               FROM piece_movement
              WHERE piece_id=?1
              ORDER BY start_page,display_order,id",
        )?;
        let movements = statement.query_map([piece_id], row)?.collect();
        movements
    }

    pub fn piece_movement_create(
        &self,
        input: PieceMovementCreate,
    ) -> rusqlite::Result<PieceMovement> {
        if input.start_page < 1 {
            return Err(rusqlite::Error::InvalidParameterName(
                "movement start page must be at least 1".into(),
            ));
        }
        let title = title(input.title)?;
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let id: i64 = conn.query_row(
            "INSERT INTO piece_movement(piece_id,title,start_page,display_order)
             VALUES (?1,?2,?3,
               COALESCE((SELECT MAX(display_order)+1 FROM piece_movement WHERE piece_id=?1),0))
             RETURNING id",
            rusqlite::params![input.piece_id, title, input.start_page],
            |value| value.get(0),
        )?;
        conn.query_row(
            "SELECT id,piece_id,title,start_page,display_order
               FROM piece_movement WHERE id=?1",
            [id],
            row,
        )
    }

    pub fn piece_movement_update(
        &self,
        id: i64,
        patch: PieceMovementPatch,
    ) -> rusqlite::Result<PieceMovement> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let current = conn
            .query_row(
                "SELECT id,piece_id,title,start_page,display_order
                   FROM piece_movement WHERE id=?1",
                [id],
                row,
            )
            .optional()?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
        let next_title = match patch.title {
            Some(value) => title(value)?,
            None => current.title,
        };
        let next_start = patch.start_page.unwrap_or(current.start_page);
        if next_start < 1 {
            return Err(rusqlite::Error::InvalidParameterName(
                "movement start page must be at least 1".into(),
            ));
        }
        let next_order = patch.display_order.unwrap_or(current.display_order);
        conn.execute(
            "UPDATE piece_movement
                SET title=?2,start_page=?3,display_order=?4
              WHERE id=?1",
            rusqlite::params![id, next_title, next_start, next_order],
        )?;
        conn.query_row(
            "SELECT id,piece_id,title,start_page,display_order
               FROM piece_movement WHERE id=?1",
            [id],
            row,
        )
    }

    pub fn piece_movement_delete(&self, id: i64) -> rusqlite::Result<bool> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(conn.execute("DELETE FROM piece_movement WHERE id=?1", [id])? == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;

    fn store_with_piece() -> Store {
        let store = Store::open(":memory:").unwrap();
        store
            .upsert_piece(&ScanPiece {
                folder_path: "/scores/op90".into(),
                title: "Schubert op. 90".into(),
                composer: Some("Schubert".into()),
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        store
    }

    #[test]
    fn movement_crud_orders_by_page_and_preserves_edits() {
        let store = store_with_piece();
        let second = store
            .piece_movement_create(PieceMovementCreate {
                piece_id: 1,
                title: "  II  ".into(),
                start_page: 7,
            })
            .unwrap();
        store
            .piece_movement_create(PieceMovementCreate {
                piece_id: 1,
                title: "I".into(),
                start_page: 1,
            })
            .unwrap();

        let listed = store.piece_movement_list(1).unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|movement| (movement.title.as_str(), movement.start_page))
                .collect::<Vec<_>>(),
            [("I", 1), ("II", 7)]
        );
        let updated = store
            .piece_movement_update(
                second.id,
                PieceMovementPatch {
                    title: Some("Impromptu II".into()),
                    start_page: Some(8),
                    display_order: None,
                },
            )
            .unwrap();
        assert_eq!(
            (updated.title.as_str(), updated.start_page),
            ("Impromptu II", 8)
        );
        assert!(store.piece_movement_delete(second.id).unwrap());
        assert!(!store.piece_movement_delete(second.id).unwrap());
    }

    #[test]
    fn movement_contract_rejects_bad_or_duplicate_starts() {
        let store = store_with_piece();
        store
            .piece_movement_create(PieceMovementCreate {
                piece_id: 1,
                title: "I".into(),
                start_page: 1,
            })
            .unwrap();
        for input in [
            PieceMovementCreate {
                piece_id: 1,
                title: "duplicate".into(),
                start_page: 1,
            },
            PieceMovementCreate {
                piece_id: 1,
                title: " ".into(),
                start_page: 2,
            },
            PieceMovementCreate {
                piece_id: 1,
                title: "bad page".into(),
                start_page: 0,
            },
        ] {
            assert!(store.piece_movement_create(input).is_err());
        }
    }
}
