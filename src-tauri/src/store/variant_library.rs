//! Durable user-local variant names, picker visibility, and copied routine stages.
use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Store;

const KEY: &str = "practice.variant_library";
const BUILT_INS: [&str; 10] = [
    "slow",
    "dotted",
    "reverse dotted",
    "staccato",
    "tenuto",
    "legato",
    "left hand only",
    "right hand only",
    "hands separate",
    "blocked chords",
];
// Revisions cross the JavaScript boundary and must remain exactly representable.
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VariantLibrary {
    pub revision: u64,
    pub custom_variants: Vec<String>,
    pub hidden_variants: Vec<String>,
    pub routines: Vec<VariantRoutine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VariantRoutine {
    pub id: String,
    pub name: String,
    pub stages: Vec<VariantRoutineStage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VariantRoutineStage {
    pub name: String,
    pub clean_streak: u32,
}

fn normalize(value: &str) -> Result<String, String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err("Variant and routine names must contain 1–80 characters.".into());
    }
    Ok(value)
}

fn validate(mut library: VariantLibrary) -> Result<VariantLibrary, String> {
    if library.revision > MAX_REVISION {
        return Err("Variant library revision is out of range.".into());
    }
    if library.custom_variants.len() > 100 || library.routines.len() > 100 {
        return Err("The library supports up to 100 custom variants and 100 routines.".into());
    }
    let mut known: HashSet<String> = BUILT_INS.iter().map(|name| (*name).into()).collect();
    for name in &mut library.custom_variants {
        *name = normalize(name)?;
        if !known.insert(name.to_lowercase()) {
            return Err(format!("Variant name already exists: {name}"));
        }
    }
    let mut hidden = HashSet::new();
    for name in &mut library.hidden_variants {
        *name = normalize(name)?;
        let key = name.to_lowercase();
        if !known.contains(&key) || !hidden.insert(key.clone()) {
            return Err("Hidden variants must be unique names from the variant library.".into());
        }
        // Return exact picker spelling even when an input used different casing.
        *name = BUILT_INS
            .iter()
            .copied()
            .chain(library.custom_variants.iter().map(String::as_str))
            .find(|candidate| candidate.to_lowercase() == key)
            .expect("known variant has a canonical name")
            .to_owned();
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for routine in &mut library.routines {
        // IDs are opaque stable identities: validate but never rewrite them.
        if routine.id.is_empty()
            || routine.id.chars().count() > 80
            || routine.id.trim() != routine.id
            || routine.id.chars().any(char::is_control)
            || !ids.insert(routine.id.clone())
        {
            return Err(
                "Routine IDs must be unique, nonempty IDs of at most 80 characters.".into(),
            );
        }
        routine.name = normalize(&routine.name)?;
        if !names.insert(routine.name.to_lowercase()) {
            return Err(format!("Routine name already exists: {}", routine.name));
        }
        if routine.stages.is_empty() || routine.stages.len() > 64 {
            return Err("Each routine needs 1–64 stages.".into());
        }
        for stage in &mut routine.stages {
            stage.name = normalize(&stage.name)?;
            if !(1..=100).contains(&stage.clean_streak) {
                return Err("Each routine stage needs a clean streak of 1–100.".into());
            }
        }
    }
    Ok(library)
}

fn read(conn: &Connection) -> Result<VariantLibrary, String> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM setting WHERE key = ?1", [KEY], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        None => Ok(VariantLibrary::default()),
        Some(raw) => {
            let value = serde_json::from_str(&raw)
                .map_err(|e| format!("Saved variant library could not be read: {e}"))?;
            validate(value).map_err(|e| format!("Saved variant library is invalid: {e}"))
        }
    }
}

impl Store {
    pub fn variant_library_get(&self) -> Result<VariantLibrary, String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        read(&conn)
    }

    pub fn variant_library_save(&self, library: VariantLibrary) -> Result<VariantLibrary, String> {
        let mut next = validate(library)?;
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let current = read(&tx)?;
        if current.revision != next.revision {
            return Err("Variant library changed elsewhere. Reload it before saving again.".into());
        }
        next.revision = next
            .revision
            .checked_add(1)
            .filter(|n| *n <= MAX_REVISION)
            .ok_or("Variant library revision limit reached.")?;
        let raw = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO setting (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [KEY, &raw])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example() -> VariantLibrary {
        VariantLibrary {
            custom_variants: vec!["  Soft   landing  ".into()],
            hidden_variants: vec![" TENUTO ".into()],
            routines: vec![VariantRoutine {
                id: "routine-1".into(),
                name: "  Evening  ".into(),
                stages: vec![
                    VariantRoutineStage {
                        name: "dotted".into(),
                        clean_streak: 3,
                    },
                    VariantRoutineStage {
                        name: "Soft landing".into(),
                        clean_streak: 5,
                    },
                ],
            }],
            ..Default::default()
        }
    }

    #[test]
    fn variant_library_persists_across_close_and_reopen_without_schema_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.db");
        let store = Store::open(&path).unwrap();
        let schema = store.schema_version().unwrap();
        assert_eq!(
            store.variant_library_get().unwrap(),
            VariantLibrary::default()
        );
        assert_eq!(store.get_setting(KEY).unwrap(), None);
        let saved = store.variant_library_save(example()).unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.custom_variants, ["Soft landing"]);
        assert_eq!(saved.hidden_variants, ["tenuto"]);
        assert_eq!(saved.routines[0].name, "Evening");
        drop(store);
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.variant_library_get().unwrap(), saved);
        assert_eq!(reopened.schema_version().unwrap(), schema);
        let mut removed = saved.clone();
        removed.custom_variants.clear();
        let removed = reopened.variant_library_save(removed).unwrap();
        assert_eq!(removed.routines, saved.routines);
    }

    #[test]
    fn variant_library_rejects_invalid_saves_atomically() {
        let store = Store::open(":memory:").unwrap();
        let saved = store.variant_library_save(example()).unwrap();
        let mut bad = saved.clone();
        bad.custom_variants.push(" DOTTED ".into());
        assert!(store.variant_library_save(bad).is_err());
        let mut bad = saved.clone();
        bad.routines[0].stages[0].clean_streak = 0;
        assert!(store.variant_library_save(bad).is_err());
        let mut bad = saved.clone();
        bad.hidden_variants.push("nonexistent".into());
        assert!(store.variant_library_save(bad).is_err());
        let mut bad = saved.clone();
        bad.routines.push(bad.routines[0].clone());
        assert!(store.variant_library_save(bad).is_err());
        assert_eq!(store.variant_library_get().unwrap(), saved);
    }

    #[test]
    fn variant_library_bounds_and_duplicate_names_are_enforced() {
        let mut bad = example();
        bad.custom_variants = (0..101).map(|n| format!("Custom {n}")).collect();
        assert!(validate(bad).is_err());
        let mut bad = example();
        bad.custom_variants[0] = "x".repeat(81);
        assert!(validate(bad).is_err());
        let mut bad = example();
        bad.custom_variants.push(" soft LANDING ".into());
        assert!(validate(bad).is_err());
        let mut bad = example();
        bad.routines[0].stages.clear();
        assert!(validate(bad).is_err());
        let mut bad = example();
        bad.routines[0].stages = vec![bad.routines[0].stages[0].clone(); 65];
        assert!(validate(bad).is_err());
        let mut bad = example();
        bad.routines[0].stages[0].clean_streak = 101;
        assert!(validate(bad).is_err());
        let mut bad = example();
        let mut duplicate = bad.routines[0].clone();
        duplicate.id = "different-id".into();
        duplicate.name = "EVENING".into();
        bad.routines.push(duplicate);
        assert!(validate(bad).is_err());
    }

    #[test]
    fn variant_library_stale_writer_cannot_replace_newer_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.db");
        let a = Store::open(&path).unwrap();
        let b = Store::open(&path).unwrap();
        let stale = b.variant_library_get().unwrap();
        let saved = a.variant_library_save(example()).unwrap();
        assert!(b
            .variant_library_save(stale)
            .unwrap_err()
            .contains("Reload"));
        assert_eq!(b.variant_library_get().unwrap(), saved);
    }

    #[test]
    fn variant_library_corruption_and_revision_overflow_never_overwrite() {
        let store = Store::open(":memory:").unwrap();
        for corrupt in [
            "{broken",
            r#"{"revision":0,"custom_variants":[],"hidden_variants":[],"routines":[],"extra":true}"#,
        ] {
            store.set_setting(KEY, corrupt).unwrap();
            assert!(store.variant_library_get().is_err());
            assert!(store.variant_library_save(example()).is_err());
            assert_eq!(store.get_setting(KEY).unwrap().as_deref(), Some(corrupt));
        }
        let library = VariantLibrary {
            revision: MAX_REVISION,
            ..Default::default()
        };
        store
            .set_setting(KEY, &serde_json::to_string(&library).unwrap())
            .unwrap();
        assert!(store.variant_library_save(library.clone()).is_err());
        assert_eq!(store.variant_library_get().unwrap(), library);
    }
}
