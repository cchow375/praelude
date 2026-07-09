//! SQLite-backed persistence (rusqlite, bundled).
//!
//! `Store` owns a single [`rusqlite::Connection`]. Connection is not `Sync`, so
//! it is wrapped in a `Mutex`; the app manages one `Store` as Tauri state and
//! all commands serialize through that lock. At this app's scale (a single local
//! user, low write volume) a global lock is more than adequate.

mod migrations;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};

/// A migrated SQLite store. Thread-safe via an internal `Mutex`.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (creating if absent) the database at `path` and migrate it to the
    /// current schema version. Pass `":memory:"` for an ephemeral test database.
    pub fn open<P: AsRef<Path>>(path: P) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// The database's current `PRAGMA user_version`. Part of the store contract
    /// (migration gate); currently exercised only by tests.
    #[allow(dead_code)]
    pub fn schema_version(&self) -> rusqlite::Result<i32> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
    }

    /// Read a setting, or `None` if the key is absent.
    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM setting WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
    }

    /// Insert or replace a setting.
    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Store {
        Store::open(":memory:").expect("open in-memory store")
    }

    #[test]
    fn fresh_store_is_at_schema_version_1() {
        assert_eq!(mem().schema_version().unwrap(), 1);
    }

    #[test]
    fn setting_roundtrips() {
        let store = mem();
        assert_eq!(store.get_setting("theme").unwrap(), None);

        store.set_setting("theme", "dark").unwrap();
        assert_eq!(store.get_setting("theme").unwrap(), Some("dark".into()));

        // Upsert overwrites rather than erroring on the PK.
        store.set_setting("theme", "light").unwrap();
        assert_eq!(store.get_setting("theme").unwrap(), Some("light".into()));
    }

    #[test]
    fn all_seven_schema_tables_exist() {
        let store = mem();
        let conn = store.conn.lock().unwrap();
        for table in [
            "piece",
            "rep_block",
            "rep",
            "session",
            "session_event",
            "spot_review",
            "setting",
        ] {
            let found: String = conn
                .query_row(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| panic!("table `{table}` should exist"));
            assert_eq!(found, table);
        }
    }

    #[test]
    fn migrate_is_idempotent_on_reopen() {
        // Re-running migration over an already-migrated connection must not error
        // (e.g. duplicate CREATE TABLE) and must leave the version untouched.
        let store = mem();
        migrations::migrate(&store.conn.lock().unwrap()).expect("re-migrate is a no-op");
        assert_eq!(store.schema_version().unwrap(), 1);
    }
}
