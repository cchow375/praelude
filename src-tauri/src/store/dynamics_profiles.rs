//! Per-piano dynamics calibration profiles (spec Plan B, task B2).
//!
//! A profile is one free-text-labelled capture of the five dynamics
//! `pp → p → mf → f → ff` as measured dBFS on one microphone at one piano in
//! one room ("Steinway, living room, lid half"). Exactly one profile is active
//! database-wide; the schema-v15 partial unique index
//! `dynamics_profile_one_active_idx` enforces that, so the deactivate MUST
//! happen inside the same transaction as the insert or the write is racy.
//!
//! # THE LAW
//!
//! Loudness only. A profile is five dB figures and a label. Nothing here
//! records a verdict, a grade, or any judgement of the playing, and nothing
//! here writes to `rep`, `rep_block`, `session`, `session_event`, `goal`,
//! `region` or `set_contract`. The two `dynamics_*` tables are the only tables
//! this module touches.
//!
//! # Validation is the belt, not the braces
//!
//! The v15 DDL does carry CHECK constraints (`active IN (0,1)`,
//! `dynamic_label IN ('pp','p','mf','f','ff')`) — so a mislabelled point WOULD
//! be rejected at the database. It would be rejected with a SQLite constraint
//! message, though, not with words a musician can act on. [`validate_points`]
//! runs first so the user is told *which step* is wrong and *by how much*; the
//! DB constraints stay underneath as the backstop. There is no DB-level
//! monotonicity constraint at all, so the strictly-increasing rule exists only
//! here.

use super::practice_v2::invalid;
use super::Store;

/// The five labels, in the only legal order.
pub const DYNAMIC_LABELS: [&str; 5] = ["pp", "p", "mf", "f", "ff"];

/// Free-text profile label bounds (characters). Required, so 1 is the floor.
const LABEL_MIN_CHARS: usize = 1;
const LABEL_MAX_CHARS: usize = 120;
/// Device identifier bound. Not user-typed, but never trusted unbounded.
const DEVICE_ID_MAX_CHARS: usize = 200;

/// One calibrated dynamic: its label and the dBFS the user actually played it
/// at.
///
/// Deliberately *not* re-exported from `store` — `store::CalibrationPoint`
/// already means the score-atlas page/measure calibration point, an unrelated
/// thing. This one is always referred to through its module.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CalibrationPoint {
    pub dynamic_label: String,
    pub measured_db: f64,
}

/// One stored profile with its five points, always ordered pp→ff.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct DynamicsProfile {
    pub id: i64,
    pub device_id: String,
    pub label: String,
    pub active: bool,
    pub created_at: String,
    pub points: Vec<CalibrationPoint>,
}

/// Reject anything that is not five points, correctly labelled, in order, and
/// STRICTLY increasing. The message names the offending pair and quotes both dB
/// figures — never a generic "invalid".
///
/// The TypeScript mirror (`src/features/dock/calibration.ts`) produces these
/// messages word for word, so the wizard can reject before the round-trip and
/// the user reads the same sentence either way.
pub fn validate_points(points: &[CalibrationPoint]) -> Result<(), String> {
    if points.len() != DYNAMIC_LABELS.len() {
        return Err(format!(
            "Calibration needs all five steps ({}), but got {}. Start again from pp.",
            DYNAMIC_LABELS.join(", "),
            points.len()
        ));
    }

    for (index, point) in points.iter().enumerate() {
        let want = DYNAMIC_LABELS[index];
        if point.dynamic_label != want {
            return Err(format!(
                "Calibration step {} must be labelled \"{}\", but got \"{}\". \
                 The five steps are {} in that order.",
                index + 1,
                want,
                point.dynamic_label,
                DYNAMIC_LABELS.join(", ")
            ));
        }
        if !point.measured_db.is_finite() {
            return Err(format!(
                "Calibration step {want} has no usable level reading. Recapture {want}."
            ));
        }
    }

    for index in 1..points.len() {
        let previous = &points[index - 1];
        let current = &points[index];
        if current.measured_db <= previous.measured_db {
            return Err(format!(
                "Calibration must get louder at every step, but {} ({:.1} dB) is not louder \
                 than {} ({:.1} dB). Recapture {}, or start again from pp.",
                current.dynamic_label,
                current.measured_db,
                previous.dynamic_label,
                previous.measured_db,
                current.dynamic_label
            ));
        }
    }

    Ok(())
}

/// Bound the free-text label. Required — an unnamed profile is unusable a month
/// later, when "which piano was this?" is the whole question.
fn validate_label(label: &str) -> Result<(), String> {
    let count = label.chars().count();
    if count < LABEL_MIN_CHARS {
        return Err(
            "A profile needs a name — which piano, which room, which lid position.".to_string(),
        );
    }
    if count > LABEL_MAX_CHARS {
        return Err(format!(
            "A profile name may be at most {LABEL_MAX_CHARS} characters; that one is {count}."
        ));
    }
    Ok(())
}

impl Store {
    /// Insert a profile plus its five points and make it the sole active
    /// profile, in ONE transaction.
    ///
    /// A save ALWAYS creates a new row — recalibrating never mutates an
    /// existing profile, so the old curve stays inspectable.
    pub(crate) fn dynamics_profile_save(
        &self,
        device_id: &str,
        label: &str,
        points: &[CalibrationPoint],
    ) -> rusqlite::Result<DynamicsProfile> {
        let label = label.trim();
        validate_label(label).map_err(invalid)?;
        if device_id.trim().is_empty() || device_id.chars().count() > DEVICE_ID_MAX_CHARS {
            return Err(invalid("a calibration profile needs a device id"));
        }
        validate_points(points).map_err(invalid)?;

        // Timestamp before the connection lock (`now_rfc3339` locks too).
        let created_at = self.now_rfc3339()?;

        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        // Deactivate FIRST: `dynamics_profile_one_active_idx` is a partial
        // unique index on active=1, so inserting an active row while another is
        // still active violates it. Same transaction, so there is no window in
        // which zero profiles are active.
        tx.execute("UPDATE dynamics_profile SET active = 0 WHERE active = 1", [])?;
        tx.execute(
            "INSERT INTO dynamics_profile (device_id, label, active, created_at)
             VALUES (?1, ?2, 1, ?3)",
            rusqlite::params![device_id, label, &created_at],
        )?;
        let id = tx.last_insert_rowid();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO dynamics_calibration_point
                     (profile_id, ordinal, dynamic_label, measured_db)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            // `dynamics_calibration_point` has no `id`; its primary key is
            // (profile_id, ordinal), so the ordinal IS the pp→ff order.
            for (ordinal, point) in points.iter().enumerate() {
                stmt.execute(rusqlite::params![
                    id,
                    ordinal as i64,
                    point.dynamic_label,
                    point.measured_db
                ])?;
            }
        }
        tx.commit()?;

        Ok(DynamicsProfile {
            id,
            device_id: device_id.to_string(),
            label: label.to_string(),
            active: true,
            created_at,
            points: points.to_vec(),
        })
    }

    /// Every profile, newest first, each with its five points in pp→ff order.
    pub(crate) fn dynamics_profile_list(&self) -> rusqlite::Result<Vec<DynamicsProfile>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Self::load_profiles(&conn, None)
    }

    /// The one active profile, or `None` when nothing has been calibrated yet.
    pub(crate) fn dynamics_profile_active(&self) -> rusqlite::Result<Option<DynamicsProfile>> {
        let conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        Ok(Self::load_profiles(&conn, Some("p.active = 1"))?
            .into_iter()
            .next())
    }

    /// Move the active flag to `id` without creating or deleting any row.
    pub(crate) fn dynamics_profile_activate(&self, id: i64) -> rusqlite::Result<DynamicsProfile> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction()?;
        let exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM dynamics_profile WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(invalid(format!("no calibration profile with id {id}")));
        }
        // Deactivate before activating — see `dynamics_profile_save`.
        tx.execute(
            "UPDATE dynamics_profile SET active = 0 WHERE active = 1 AND id <> ?1",
            [id],
        )?;
        tx.execute("UPDATE dynamics_profile SET active = 1 WHERE id = ?1", [id])?;
        tx.commit()?;
        drop(conn);

        // Read back through the same path the frontend will, so the receipt can
        // never disagree with what a subsequent query would report.
        self.dynamics_profile_active()?
            .filter(|p| p.id == id)
            .ok_or_else(|| invalid(format!("calibration profile {id} vanished during activate")))
    }

    /// Shared reader. `where_sql` is a literal fragment written in this file
    /// only — never user input.
    fn load_profiles(
        conn: &rusqlite::Connection,
        where_sql: Option<&str>,
    ) -> rusqlite::Result<Vec<DynamicsProfile>> {
        let filter = match where_sql {
            Some(w) => format!("WHERE {w}"),
            None => String::new(),
        };
        let sql = format!(
            "SELECT p.id, p.device_id, p.label, p.active, p.created_at
             FROM dynamics_profile p {filter}
             ORDER BY p.id DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(DynamicsProfile {
                id: row.get(0)?,
                device_id: row.get(1)?,
                label: row.get(2)?,
                active: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
                points: Vec::new(),
            })
        })?;
        let mut profiles: Vec<DynamicsProfile> = rows.collect::<rusqlite::Result<_>>()?;

        let mut points = conn.prepare(
            "SELECT dynamic_label, measured_db FROM dynamics_calibration_point
             WHERE profile_id = ?1 ORDER BY ordinal ASC",
        )?;
        for profile in profiles.iter_mut() {
            profile.points = points
                .query_map([profile.id], |row| {
                    Ok(CalibrationPoint {
                        dynamic_label: row.get(0)?,
                        measured_db: row.get(1)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
        }
        Ok(profiles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(v: [f64; 5]) -> Vec<CalibrationPoint> {
        DYNAMIC_LABELS
            .iter()
            .zip(v)
            .map(|(l, db)| CalibrationPoint {
                dynamic_label: (*l).to_string(),
                measured_db: db,
            })
            .collect()
    }

    fn store() -> Store {
        Store::open(":memory:").unwrap()
    }

    #[test]
    fn rejects_a_non_increasing_curve_naming_the_offending_pair() {
        let err = validate_points(&pts([-48.0, -29.8, -31.4, -18.0, -9.0])).unwrap_err();
        assert!(err.contains("mf"), "message must name mf: {err}");
        assert!(err.contains("-31.4"), "message must quote the measured dB: {err}");
        assert!(
            err.contains("p ("),
            "message must name the step it failed against: {err}"
        );
        assert!(
            !err.to_lowercase().contains("invalid input"),
            "no generic wording: {err}"
        );
    }

    #[test]
    fn rejects_equal_neighbours_strictly_increasing_means_strictly() {
        assert!(validate_points(&pts([-48.0, -38.0, -38.0, -18.0, -9.0])).is_err());
    }

    #[test]
    fn rejects_a_short_or_mislabelled_point_set() {
        assert!(validate_points(&[]).is_err());
        let mut wrong = pts([-48.0, -38.0, -28.0, -18.0, -9.0]);
        wrong[2].dynamic_label = "mp".into();
        let err = validate_points(&wrong).unwrap_err();
        assert!(err.contains("mp"), "{err}");
    }

    #[test]
    fn accepts_a_strictly_increasing_curve() {
        assert!(validate_points(&pts([-48.0, -38.0, -28.0, -18.0, -9.0])).is_ok());
    }

    #[test]
    fn save_activates_the_new_profile_and_deactivates_every_other() {
        let store = store();
        let a = store
            .dynamics_profile_save(
                "mic-1",
                "Steinway, lid closed",
                &pts([-50.0, -40.0, -30.0, -20.0, -10.0]),
            )
            .unwrap();
        assert!(a.active);
        let b = store
            .dynamics_profile_save(
                "mic-1",
                "Steinway, lid half",
                &pts([-48.0, -38.0, -28.0, -18.0, -9.0]),
            )
            .unwrap();
        assert!(b.active);
        let all = store.dynamics_profile_list().unwrap();
        assert_eq!(all.iter().filter(|p| p.active).count(), 1);
        assert_eq!(store.dynamics_profile_active().unwrap().unwrap().id, b.id);
        assert_eq!(all.len(), 2, "recalibration creates a NEW profile, never mutates");
    }

    #[test]
    fn save_stores_all_five_points_in_pp_to_ff_order() {
        let store = store();
        let p = store
            .dynamics_profile_save("mic-1", "Steinway", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap();
        let round_tripped = store.dynamics_profile_active().unwrap().unwrap();
        let labels: Vec<_> = round_tripped
            .points
            .iter()
            .map(|c| c.dynamic_label.as_str())
            .collect();
        assert_eq!(labels, DYNAMIC_LABELS.to_vec());
        assert_eq!(round_tripped.points[0].measured_db, -50.0);
        assert_eq!(round_tripped.points[4].measured_db, -10.0);
        assert_eq!(round_tripped.id, p.id);
    }

    #[test]
    fn a_rejected_save_writes_nothing_at_all() {
        let store = store();
        assert!(store
            .dynamics_profile_save("mic-1", "bad", &pts([-50.0, -40.0, -45.0, -20.0, -10.0]))
            .is_err());
        assert!(store.dynamics_profile_list().unwrap().is_empty());
    }

    #[test]
    fn a_rejected_save_leaves_the_previously_active_profile_active() {
        let store = store();
        let good = store
            .dynamics_profile_save("mic-1", "good", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap();
        assert!(store
            .dynamics_profile_save("mic-1", "bad", &pts([-50.0, -40.0, -45.0, -20.0, -10.0]))
            .is_err());
        assert_eq!(store.dynamics_profile_active().unwrap().unwrap().id, good.id);
        assert_eq!(store.dynamics_profile_list().unwrap().len(), 1);
    }

    #[test]
    fn save_requires_a_free_text_label() {
        let store = store();
        let err = store
            .dynamics_profile_save("mic-1", "   ", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap_err()
            .to_string();
        assert!(err.contains("name"), "{err}");
        assert!(store.dynamics_profile_list().unwrap().is_empty());
    }

    #[test]
    fn save_rejects_an_over_long_label() {
        let store = store();
        let long = "x".repeat(LABEL_MAX_CHARS + 1);
        assert!(store
            .dynamics_profile_save("mic-1", &long, &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .is_err());
        assert!(store.dynamics_profile_list().unwrap().is_empty());
    }

    #[test]
    fn activate_moves_the_active_flag_without_creating_rows() {
        let store = store();
        let a = store
            .dynamics_profile_save("mic-1", "A", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap();
        let _b = store
            .dynamics_profile_save("mic-1", "B", &pts([-48.0, -38.0, -28.0, -18.0, -9.0]))
            .unwrap();
        let back = store.dynamics_profile_activate(a.id).unwrap();
        assert!(back.active);
        assert_eq!(back.id, a.id);
        assert_eq!(store.dynamics_profile_list().unwrap().len(), 2);
        assert_eq!(
            store
                .dynamics_profile_list()
                .unwrap()
                .iter()
                .filter(|p| p.active)
                .count(),
            1
        );
    }

    #[test]
    fn activate_rejects_an_unknown_id_and_leaves_the_flag_alone() {
        let store = store();
        let a = store
            .dynamics_profile_save("mic-1", "A", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap();
        assert!(store.dynamics_profile_activate(9_999).is_err());
        assert_eq!(store.dynamics_profile_active().unwrap().unwrap().id, a.id);
    }

    #[test]
    fn active_is_none_before_anything_is_calibrated() {
        assert!(store().dynamics_profile_active().unwrap().is_none());
    }

    /// The v15 CHECK constraint is a real backstop, not decoration — prove it
    /// rejects a bad label even if app-level validation were ever bypassed.
    #[test]
    fn the_schema_check_constraint_rejects_a_bad_dynamic_label() {
        let store = store();
        store
            .dynamics_profile_save("mic-1", "A", &pts([-50.0, -40.0, -30.0, -20.0, -10.0]))
            .unwrap();
        let conn = store.conn.lock().unwrap();
        let direct = conn.execute(
            "INSERT INTO dynamics_calibration_point (profile_id, ordinal, dynamic_label, measured_db)
             VALUES ((SELECT id FROM dynamics_profile LIMIT 1), 9, 'mp', -30.0)",
            [],
        );
        assert!(direct.is_err(), "DB must reject an off-vocabulary label");
    }
}
