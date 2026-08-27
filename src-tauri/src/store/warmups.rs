//! Configurable warmup routines. Catalog definitions live in the frontend so
//! they can include code-native figures and teaching copy; SQLite stores only
//! the user's chosen catalog ids and practice settings.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Store;

const MAX_ROUTINE_ITEMS: usize = 40;
const MAX_NAME_CHARS: usize = 120;
const MAX_CATALOG_ID_CHARS: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WarmupRoutineItem {
    pub catalog_id: String,
    pub bpm: u32,
    pub clean_streak: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WarmupRoutine {
    pub id: i64,
    pub name: String,
    pub items: Vec<WarmupRoutineItem>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WarmupRoutineSaveInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub name: String,
    pub items: Vec<WarmupRoutineItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WarmupSystemPiece {
    pub piece_id: i64,
    pub title: String,
}

fn validate(input: &WarmupRoutineSaveInput) -> rusqlite::Result<()> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(rusqlite::Error::InvalidParameterName(
            "warmup routine name".into(),
        ));
    }
    if input.items.is_empty() || input.items.len() > MAX_ROUTINE_ITEMS {
        return Err(rusqlite::Error::InvalidParameterName(
            "warmup routine items".into(),
        ));
    }
    for item in &input.items {
        let id = item.catalog_id.trim();
        if id.is_empty()
            || id.chars().count() > MAX_CATALOG_ID_CHARS
            || !id.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
            || !(20..=300).contains(&item.bpm)
            || !(1..=20).contains(&item.clean_streak)
        {
            return Err(rusqlite::Error::InvalidParameterName(
                "warmup routine item".into(),
            ));
        }
    }
    Ok(())
}

fn read_routine(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Option<WarmupRoutine>> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT name,created_at,updated_at FROM warmup_routine WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((name, created_at, updated_at)) = row else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT catalog_id,bpm,clean_streak FROM warmup_routine_item
         WHERE routine_id=?1 ORDER BY position,id",
    )?;
    let items = stmt
        .query_map([id], |row| {
            Ok(WarmupRoutineItem {
                catalog_id: row.get(0)?,
                bpm: row.get(1)?,
                clean_streak: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(WarmupRoutine {
        id,
        name,
        items,
        created_at: super::model::sqlite_ts_to_rfc3339(&created_at),
        updated_at: super::model::sqlite_ts_to_rfc3339(&updated_at),
    }))
}

impl Store {
    pub fn warmup_routines_list(&self) -> rusqlite::Result<Vec<WarmupRoutine>> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let ids = {
            let mut stmt =
                conn.prepare("SELECT id FROM warmup_routine ORDER BY updated_at DESC,id DESC")?;
            let rows = stmt
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<i64>>>()?;
            rows
        };
        ids.into_iter()
            .map(|id| read_routine(&conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows))
            .collect()
    }

    pub fn warmup_routine_save(
        &self,
        input: &WarmupRoutineSaveInput,
    ) -> rusqlite::Result<WarmupRoutine> {
        validate(input)?;
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction()?;
        let id = if let Some(id) = input.id {
            let changed = tx.execute(
                "UPDATE warmup_routine SET name=?2,updated_at=datetime('now') WHERE id=?1",
                params![id, input.name.trim()],
            )?;
            if changed != 1 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            tx.execute("DELETE FROM warmup_routine_item WHERE routine_id=?1", [id])?;
            id
        } else {
            tx.query_row(
                "INSERT INTO warmup_routine(name) VALUES (?1) RETURNING id",
                [input.name.trim()],
                |row| row.get(0),
            )?
        };
        {
            let mut statement = tx.prepare(
                "INSERT INTO warmup_routine_item
                 (routine_id,position,catalog_id,bpm,clean_streak)
                 VALUES (?1,?2,?3,?4,?5)",
            )?;
            for (position, item) in input.items.iter().enumerate() {
                statement.execute(params![
                    id,
                    i64::try_from(position).unwrap_or(i64::MAX),
                    item.catalog_id.trim(),
                    item.bpm,
                    item.clean_streak,
                ])?;
            }
        }
        tx.commit()?;
        read_routine(&conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn warmup_routine_delete(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute("DELETE FROM warmup_routine WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn warmup_system_piece(&self) -> rusqlite::Result<WarmupSystemPiece> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.query_row(
            "SELECT id,title FROM piece WHERE kind='system' AND folder_path='codakiller://warmups'",
            [],
            |row| {
                Ok(WarmupSystemPiece {
                    piece_id: row.get(0)?,
                    title: row.get(1)?,
                })
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: Option<i64>) -> WarmupRoutineSaveInput {
        WarmupRoutineSaveInput {
            id,
            name: "Octave day".into(),
            items: vec![
                WarmupRoutineItem {
                    catalog_id: "octave-jumps".into(),
                    bpm: 52,
                    clean_streak: 4,
                },
                WarmupRoutineItem {
                    catalog_id: "broken-octaves".into(),
                    bpm: 64,
                    clean_streak: 3,
                },
            ],
        }
    }

    #[test]
    fn routine_round_trips_in_user_order_and_updates_atomically() {
        let store = Store::open(":memory:").unwrap();
        let saved = store.warmup_routine_save(&input(None)).unwrap();
        assert_eq!(saved.items[0].catalog_id, "octave-jumps");
        let mut update = input(Some(saved.id));
        update.name = "Fast octave day".into();
        update.items.reverse();
        let updated = store.warmup_routine_save(&update).unwrap();
        assert_eq!(updated.name, "Fast octave day");
        assert_eq!(updated.items[0].catalog_id, "broken-octaves");
        assert_eq!(store.warmup_routines_list().unwrap(), vec![updated]);
    }

    #[test]
    fn invalid_update_preserves_the_existing_routine() {
        let store = Store::open(":memory:").unwrap();
        let saved = store.warmup_routine_save(&input(None)).unwrap();
        let mut invalid = input(Some(saved.id));
        invalid.items[0].bpm = 999;
        assert!(store.warmup_routine_save(&invalid).is_err());
        assert_eq!(store.warmup_routines_list().unwrap(), vec![saved]);
    }

    #[test]
    fn validation_accepts_exact_boundaries_and_rejects_every_outside_edge() {
        let boundary_item = WarmupRoutineItem {
            catalog_id: "a".repeat(MAX_CATALOG_ID_CHARS),
            bpm: 20,
            clean_streak: 1,
        };
        let valid = WarmupRoutineSaveInput {
            id: None,
            name: "N".repeat(MAX_NAME_CHARS),
            items: vec![boundary_item; MAX_ROUTINE_ITEMS],
        };
        assert!(validate(&valid).is_ok());

        let invalid = [
            WarmupRoutineSaveInput {
                name: " ".into(),
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                name: "N".repeat(MAX_NAME_CHARS + 1),
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: Vec::new(),
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![valid.items[0].clone(); MAX_ROUTINE_ITEMS + 1],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    catalog_id: "Uppercase".into(),
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    catalog_id: "a".repeat(MAX_CATALOG_ID_CHARS + 1),
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    bpm: 19,
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    bpm: 301,
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    clean_streak: 0,
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
            WarmupRoutineSaveInput {
                items: vec![WarmupRoutineItem {
                    clean_streak: 21,
                    ..valid.items[0].clone()
                }],
                ..valid.clone()
            },
        ];
        for input in invalid {
            assert!(validate(&input).is_err());
        }

        let high_boundary = WarmupRoutineSaveInput {
            items: vec![WarmupRoutineItem {
                catalog_id: "boundary".into(),
                bpm: 300,
                clean_streak: 20,
            }],
            ..valid
        };
        assert!(validate(&high_boundary).is_ok());
    }

    #[test]
    fn migration_seeds_one_hidden_system_piece() {
        let store = Store::open(":memory:").unwrap();
        let system = store.warmup_system_piece().unwrap();
        assert_eq!(system.title, "Warm-ups");
        let count = store
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM piece WHERE kind='system'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
