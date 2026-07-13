//! P5.5 Calendar persistence and the atomic recovery boundary.
//!
//! Preview is assembled from a read-only SQLite snapshot and delegated to the
//! pure `recovery` module. Apply revalidates every optimistic token, date,
//! deadline, and capacity constraint inside one transaction before changing a
//! row. Calendar events are administrative and never count as practice time.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use super::model::{json_to_sql, DailyWorkCreate, DailyWorkPatch};
use super::{EventKind, Store};
use crate::date::Date;
use crate::recovery::{
    self, ExistingDayPlan, MissedDailyWork, RecoveryInput, RecoveryOutcome,
};

const CAPACITY_SETTING: &str = "calendar.daily_capacity_minutes";
const DEFAULT_CAPACITY_MINUTES: u32 = 60;
const MAX_CAPACITY_MINUTES: u32 = 1_440;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DailyWorkView {
    pub id: i64,
    pub goal_id: i64,
    pub region_id: Option<i64>,
    pub block_id: Option<i64>,
    pub title: String,
    pub planned_minutes: u32,
    pub origin_date: String,
    pub scheduled_date: String,
    pub status: String,
    pub source: String,
    pub reschedule_count: u32,
    pub sort_order: i64,
    pub completed_ts: Option<String>,
    pub created_ts: String,
    pub updated_ts: String,
    pub piece_id: i64,
    pub piece_title: String,
    pub goal_text: String,
    pub parent_goal_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarRecoveryItem {
    pub work: DailyWorkView,
    pub proposed_date: Option<String>,
    pub reason: String,
    pub effective_deadline: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarRecoveryDay {
    pub date: String,
    pub planned_minutes: u32,
    pub recovery_minutes: u32,
    pub capacity_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CalendarRecoveryPreview {
    pub today: String,
    pub capacity_minutes: u32,
    pub items: Vec<CalendarRecoveryItem>,
    pub days: Vec<CalendarRecoveryDay>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryDecision {
    pub id: i64,
    pub expected_updated_ts: String,
    pub action: String,
    #[serde(default)]
    pub date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecoveryApplyResult {
    pub applied_at: String,
    pub items: Vec<DailyWorkView>,
}

const VIEW_SELECT: &str = "
SELECT w.id, w.goal_id, w.region_id, w.block_id, w.title, w.planned_minutes,
       w.origin_date, w.scheduled_date, w.status, w.source, w.reschedule_count,
       w.sort_order, w.completed_ts, w.created_ts, w.updated_ts,
       g.piece_id, p.title, g.text, parent.text
FROM daily_work w
JOIN goal g ON g.id = w.goal_id
JOIN piece p ON p.id = g.piece_id
LEFT JOIN goal parent ON parent.id = g.parent_goal_id";

fn view_from_row(row: &Row<'_>) -> rusqlite::Result<DailyWorkView> {
    Ok(DailyWorkView {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        region_id: row.get(2)?,
        block_id: row.get(3)?,
        title: row.get(4)?,
        planned_minutes: row.get(5)?,
        origin_date: row.get(6)?,
        scheduled_date: row.get(7)?,
        status: row.get(8)?,
        source: row.get(9)?,
        reschedule_count: row.get(10)?,
        sort_order: row.get(11)?,
        completed_ts: row.get(12)?,
        created_ts: row.get(13)?,
        updated_ts: row.get(14)?,
        piece_id: row.get(15)?,
        piece_title: row.get(16)?,
        goal_text: row.get(17)?,
        parent_goal_text: row.get(18)?,
    })
}

fn get_view(conn: &Connection, id: i64) -> rusqlite::Result<DailyWorkView> {
    conn.query_row(&format!("{VIEW_SELECT} WHERE w.id = ?1"), [id], view_from_row)
}

fn token(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') || '-' || lower(hex(randomblob(8)))",
        [],
        |row| row.get(0),
    )
}

fn timestamp(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        [],
        |row| row.get(0),
    )
}

fn capacity(conn: &Connection) -> rusqlite::Result<u32> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM setting WHERE key = ?1",
            [CAPACITY_SETTING],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|minutes| (1..=MAX_CAPACITY_MINUTES).contains(minutes))
        .unwrap_or(DEFAULT_CAPACITY_MINUTES))
}

fn goal_piece(conn: &Connection, goal_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT piece_id FROM goal WHERE id = ?1",
        [goal_id],
        |row| row.get(0),
    )
}

fn validate_links(
    conn: &Connection,
    piece_id: i64,
    region_id: Option<i64>,
    block_id: Option<i64>,
) -> rusqlite::Result<()> {
    if let Some(region_id) = region_id {
        let owner: i64 = conn.query_row(
            "SELECT piece_id FROM region WHERE id = ?1",
            [region_id],
            |row| row.get(0),
        )?;
        if owner != piece_id {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    if let Some(block_id) = block_id {
        let (owner, region): (i64, Option<i64>) = conn.query_row(
            "SELECT piece_id, region_id FROM rep_block WHERE id = ?1",
            [block_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if owner != piece_id || region_id.is_some_and(|expected| region != Some(expected)) {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    Ok(())
}

fn append_event(
    tx: &Transaction<'_>,
    kind: &str,
    piece_id: i64,
    payload: &serde_json::Value,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO event (kind, piece_id, payload) VALUES (?1, ?2, ?3)",
        rusqlite::params![kind, piece_id, json_to_sql(payload)?],
    )?;
    Ok(())
}

fn strict_range(from: &str, to: &str) -> rusqlite::Result<()> {
    let from_date = Date::parse(from).ok_or(rusqlite::Error::InvalidQuery)?;
    let to_date = Date::parse(to).ok_or(rusqlite::Error::InvalidQuery)?;
    if from_date > to_date {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

impl Store {
    pub fn calendar_capacity_set(&self, minutes: u32) -> rusqlite::Result<()> {
        if !(1..=MAX_CAPACITY_MINUTES).contains(&minutes) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        self.set_setting(CAPACITY_SETTING, &minutes.to_string())
    }

    pub fn daily_work_list(
        &self,
        from: &str,
        to: &str,
        piece_id: Option<i64>,
    ) -> rusqlite::Result<Vec<DailyWorkView>> {
        strict_range(from, to)?;
        let conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let sql = format!(
            "{VIEW_SELECT}
             WHERE w.scheduled_date BETWEEN ?1 AND ?2
               AND (?3 IS NULL OR g.piece_id = ?3)
             ORDER BY w.scheduled_date, w.sort_order, w.id"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(rusqlite::params![from, to, piece_id], view_from_row)?;
        rows.collect()
    }

    pub fn daily_work_create(&self, args: DailyWorkCreate) -> rusqlite::Result<DailyWorkView> {
        let title = args.title.trim();
        if title.is_empty()
            || title.chars().count() > 500
            || !(1..=240).contains(&args.minutes)
            || Date::parse(&args.date).is_none()
            || !matches!(args.source.as_str(), "manual" | "planner")
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let tx = conn.transaction()?;
        let piece_id = goal_piece(&tx, args.goal_id)?;
        validate_links(&tx, piece_id, args.region_id, args.block_id)?;
        let updated_ts = token(&tx)?;
        let id: i64 = tx.query_row(
            "INSERT INTO daily_work
             (goal_id,region_id,block_id,title,planned_minutes,origin_date,scheduled_date,
              status,source,sort_order,updated_ts)
             VALUES (?1,?2,?3,?4,?5,?6,?6,'planned',?7,
               COALESCE((SELECT MAX(sort_order)+1 FROM daily_work WHERE scheduled_date=?6),0),?8)
             RETURNING id",
            rusqlite::params![
                args.goal_id,
                args.region_id,
                args.block_id,
                title,
                args.minutes,
                args.date,
                args.source,
                updated_ts,
            ],
            |row| row.get(0),
        )?;
        append_event(
            &tx,
            EventKind::DAILY_WORK_CHANGE,
            piece_id,
            &serde_json::json!({"action":"create","daily_work_id":id}),
        )?;
        let view = get_view(&tx, id)?;
        tx.commit()?;
        Ok(view)
    }

    pub fn daily_work_update(
        &self,
        id: i64,
        expected_updated_ts: &str,
        patch: DailyWorkPatch,
    ) -> rusqlite::Result<DailyWorkView> {
        let mut conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let tx = conn.transaction()?;
        let current = get_view(&tx, id)?;
        if current.updated_ts != expected_updated_ts {
            return Err(rusqlite::Error::InvalidQuery);
        }
        if patch.title.as_deref().is_some_and(|title| {
            title.trim().is_empty() || title.trim().chars().count() > 500
        }) || patch
            .planned_minutes
            .is_some_and(|minutes| !(1..=240).contains(&minutes))
            || patch
                .scheduled_date
                .as_deref()
                .is_some_and(|date| Date::parse(date).is_none())
            || patch.status.as_deref().is_some_and(|status| {
                !matches!(status, "planned" | "done" | "dismissed")
            })
            || patch.sort_order.is_some_and(|order| order < 0)
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let region_id = patch.region_id.unwrap_or(current.region_id);
        let block_id = patch.block_id.unwrap_or(current.block_id);
        validate_links(&tx, current.piece_id, region_id, block_id)?;

        let mut sets = Vec::<String>::new();
        let mut values = Vec::<Box<dyn rusqlite::ToSql>>::new();
        macro_rules! push_set {
            ($column:expr, $value:expr) => {{
                sets.push(format!("{} = ?{}", $column, values.len() + 2));
                values.push(Box::new($value) as Box<dyn rusqlite::ToSql>);
            }};
        }
        if let Some(region_id) = patch.region_id {
            push_set!("region_id", region_id);
        }
        if let Some(block_id) = patch.block_id {
            push_set!("block_id", block_id);
        }
        if let Some(title) = patch.title {
            push_set!("title", title.trim().to_string());
        }
        if let Some(minutes) = patch.planned_minutes {
            push_set!("planned_minutes", minutes);
        }
        if let Some(date) = patch.scheduled_date.clone() {
            push_set!("scheduled_date", date.clone());
            if date != current.scheduled_date && patch.sort_order.is_none() {
                let next: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(sort_order)+1,0) FROM daily_work WHERE scheduled_date=?1",
                    [&date],
                    |row| row.get(0),
                )?;
                push_set!("sort_order", next);
            }
        }
        if let Some(status) = patch.status {
            push_set!("status", status.clone());
            if status == "planned" {
                push_set!("completed_ts", Option::<String>::None);
            } else {
                push_set!("completed_ts", Some(timestamp(&tx)?));
            }
        }
        if let Some(order) = patch.sort_order {
            push_set!("sort_order", order);
        }
        if sets.is_empty() {
            return Ok(current);
        }
        let next_token = token(&tx)?;
        push_set!("updated_ts", next_token);
        let sql = format!("UPDATE daily_work SET {} WHERE id=?1", sets.join(", "));
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&id];
        params.extend(values.iter().map(|value| value.as_ref()));
        tx.execute(&sql, params.as_slice())?;
        append_event(
            &tx,
            EventKind::DAILY_WORK_CHANGE,
            current.piece_id,
            &serde_json::json!({"action":"update","daily_work_id":id}),
        )?;
        let view = get_view(&tx, id)?;
        tx.commit()?;
        Ok(view)
    }

    pub fn daily_work_delete(
        &self,
        id: i64,
        expected_updated_ts: &str,
    ) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let tx = conn.transaction()?;
        let current = get_view(&tx, id)?;
        if current.updated_ts != expected_updated_ts {
            return Err(rusqlite::Error::InvalidQuery);
        }
        tx.execute("DELETE FROM daily_work WHERE id=?1", [id])?;
        tx.execute(
            "UPDATE daily_work SET sort_order=sort_order-1
             WHERE scheduled_date=?1 AND sort_order>?2",
            rusqlite::params![current.scheduled_date, current.sort_order],
        )?;
        append_event(
            &tx,
            EventKind::DAILY_WORK_CHANGE,
            current.piece_id,
            &serde_json::json!({"action":"delete","daily_work_id":id}),
        )?;
        tx.commit()
    }

    pub fn recovery_preview(&self) -> rusqlite::Result<CalendarRecoveryPreview> {
        let conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        recovery_preview_conn(&conn)
    }

    pub fn recovery_apply(
        &self,
        decisions: Vec<RecoveryDecision>,
    ) -> rusqlite::Result<RecoveryApplyResult> {
        if decisions.is_empty()
            || decisions.len() > 200
            || decisions.iter().map(|decision| decision.id).collect::<HashSet<_>>().len()
                != decisions.len()
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let mut conn = self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let tx = conn.transaction()?;
        let today_text: String = tx.query_row("SELECT date('now','localtime')", [], |row| row.get(0))?;
        let today = Date::parse(&today_text).ok_or(rusqlite::Error::InvalidQuery)?;
        let horizon_end = today
            .add_days((recovery::RECOVERY_HORIZON_DAYS - 1).into())
            .ok_or(rusqlite::Error::InvalidQuery)?;
        let capacity_minutes = capacity(&tx)?;
        let recovery_limit = recovery::MIN_RECOVERY_SHARE_MINUTES.max(capacity_minutes / 2);

        let mut total_load = HashMap::<String, u32>::new();
        let mut recovery_load = HashMap::<String, u32>::new();
        {
            let mut statement = tx.prepare(
                "SELECT scheduled_date, SUM(planned_minutes),
                        SUM(CASE WHEN source='recovery' THEN planned_minutes ELSE 0 END)
                 FROM daily_work
                 WHERE status='planned' AND scheduled_date BETWEEN ?1 AND ?2
                 GROUP BY scheduled_date",
            )?;
            let rows = statement.query_map(
                rusqlite::params![today_text, horizon_end.to_string()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?, row.get::<_, u32>(2)?)),
            )?;
            for row in rows {
                let (date, total, recovered) = row?;
                total_load.insert(date.clone(), total);
                recovery_load.insert(date, recovered);
            }
        }

        let mut current_rows = Vec::with_capacity(decisions.len());
        for decision in &decisions {
            if !matches!(decision.action.as_str(), "move" | "done" | "dismiss" | "leave") {
                return Err(rusqlite::Error::InvalidQuery);
            }
            let work = get_view(&tx, decision.id)?;
            if work.updated_ts != decision.expected_updated_ts
                || work.status != "planned"
                || work.scheduled_date >= today_text
            {
                return Err(rusqlite::Error::InvalidQuery);
            }
            current_rows.push(work);
        }

        let mut result_items = Vec::with_capacity(decisions.len());
        for (decision, work) in decisions.iter().zip(current_rows.iter()) {
            match decision.action.as_str() {
                "leave" => result_items.push(work.clone()),
                "move" => {
                    let date_text = decision.date.as_deref().ok_or(rusqlite::Error::InvalidQuery)?;
                    let date = Date::parse(date_text).ok_or(rusqlite::Error::InvalidQuery)?;
                    let deadline: Option<String> = tx.query_row(
                        "SELECT COALESCE(g.target_date,parent.target_date)
                         FROM goal g LEFT JOIN goal parent ON parent.id=g.parent_goal_id
                         WHERE g.id=?1",
                        [work.goal_id],
                        |row| row.get(0),
                    )?;
                    if date < today
                        || date > horizon_end
                        || deadline
                            .as_deref()
                            .and_then(Date::parse)
                            .is_some_and(|deadline| date > deadline)
                    {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    let total = total_load.entry(date_text.to_string()).or_default();
                    let recovered = recovery_load.entry(date_text.to_string()).or_default();
                    if total.saturating_add(work.planned_minutes) > capacity_minutes
                        || recovered.saturating_add(work.planned_minutes) > recovery_limit
                    {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    *total += work.planned_minutes;
                    *recovered += work.planned_minutes;
                    let next_order: i64 = tx.query_row(
                        "SELECT COALESCE(MAX(sort_order)+1,0) FROM daily_work WHERE scheduled_date=?1",
                        [date_text],
                        |row| row.get(0),
                    )?;
                    tx.execute(
                        "UPDATE daily_work SET scheduled_date=?2,source='recovery',
                         reschedule_count=reschedule_count+1,sort_order=?3,updated_ts=?4
                         WHERE id=?1",
                        rusqlite::params![work.id, date_text, next_order, token(&tx)?],
                    )?;
                    result_items.push(get_view(&tx, work.id)?);
                }
                "done" | "dismiss" => {
                    let status = if decision.action == "done" { "done" } else { "dismissed" };
                    tx.execute(
                        "UPDATE daily_work SET status=?2,completed_ts=?3,updated_ts=?4 WHERE id=?1",
                        rusqlite::params![work.id, status, timestamp(&tx)?, token(&tx)?],
                    )?;
                    result_items.push(get_view(&tx, work.id)?);
                }
                _ => unreachable!(),
            }
            if decision.action != "leave" {
                append_event(
                    &tx,
                    EventKind::DAILY_WORK_CHANGE,
                    work.piece_id,
                    &serde_json::json!({
                        "action": decision.action,
                        "daily_work_id": work.id,
                        "from": work.scheduled_date,
                        "to": decision.date,
                    }),
                )?;
            }
        }
        for piece_id in current_rows
            .iter()
            .map(|work| work.piece_id)
            .collect::<HashSet<_>>()
        {
            let piece_decisions = decisions
                .iter()
                .zip(current_rows.iter())
                .filter(|(_, work)| work.piece_id == piece_id)
                .map(|(decision, _)| decision)
                .collect::<Vec<_>>();
            append_event(
                &tx,
                EventKind::RECOVERY_APPLY,
                piece_id,
                &serde_json::json!({"decisions": piece_decisions}),
            )?;
        }
        let applied_at = timestamp(&tx)?;
        tx.commit()?;
        Ok(RecoveryApplyResult {
            applied_at,
            items: result_items,
        })
    }
}

fn recovery_preview_conn(conn: &Connection) -> rusqlite::Result<CalendarRecoveryPreview> {
    let today: String = conn.query_row("SELECT date('now','localtime')", [], |row| row.get(0))?;
    let today_date = Date::parse(&today).ok_or(rusqlite::Error::InvalidQuery)?;
    let horizon_end = today_date
        .add_days((recovery::RECOVERY_HORIZON_DAYS - 1).into())
        .ok_or(rusqlite::Error::InvalidQuery)?;
    let capacity_minutes = capacity(conn)?;

    let missed_work = {
        let mut statement = conn.prepare(
            "SELECT w.id,w.goal_id,w.planned_minutes,w.origin_date,w.scheduled_date,
                    COALESCE(g.target_date,parent.target_date),g.sort_order,w.updated_ts,
                    w.reschedule_count
             FROM daily_work w
             JOIN goal g ON g.id=w.goal_id
             LEFT JOIN goal parent ON parent.id=g.parent_goal_id
             WHERE w.status='planned' AND w.scheduled_date < ?1
             ORDER BY w.id",
        )?;
        let rows = statement.query_map([&today], |row| {
            Ok(MissedDailyWork {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                planned_minutes: row.get(2)?,
                origin_date: row.get(3)?,
                scheduled_date: row.get(4)?,
                effective_deadline: row.get(5)?,
                goal_order: row.get(6)?,
                expected_updated_ts: row.get(7)?,
                reschedule_count: row.get(8)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let existing_days = {
        let mut statement = conn.prepare(
            "SELECT scheduled_date,SUM(planned_minutes),
                    SUM(CASE WHEN source='recovery' THEN planned_minutes ELSE 0 END)
             FROM daily_work
             WHERE status='planned' AND scheduled_date BETWEEN ?1 AND ?2
             GROUP BY scheduled_date",
        )?;
        let rows = statement.query_map(
            rusqlite::params![today, horizon_end.to_string()],
            |row| {
                Ok(ExistingDayPlan {
                    date: row.get(0)?,
                    planned_minutes: row.get(1)?,
                    recovery_minutes: row.get(2)?,
                })
            },
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let preview = recovery::preview(&RecoveryInput {
        today: today.clone(),
        capacity_minutes,
        missed_work,
        existing_days,
    })
    .map_err(|_| rusqlite::Error::InvalidQuery)?;

    let mut items = Vec::with_capacity(preview.items.len());
    for item in preview.items {
        let reason = match (&item.outcome, &item.unresolved) {
            (RecoveryOutcome::Unresolved, Some(unresolved)) => unresolved.message.clone(),
            _ => item.traces.join(" "),
        };
        items.push(CalendarRecoveryItem {
            work: get_view(conn, item.id)?,
            proposed_date: item.proposed_date,
            reason,
            effective_deadline: item.effective_deadline,
        });
    }
    let days = preview
        .days
        .into_iter()
        .map(|day| CalendarRecoveryDay {
            date: day.date,
            planned_minutes: day.total_after_preview_minutes,
            recovery_minutes: day.existing_recovery_minutes + day.proposed_recovery_minutes,
            capacity_minutes,
        })
        .collect();
    Ok(CalendarRecoveryPreview {
        today,
        capacity_minutes,
        items,
        days,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{GoalCreate, ScanPiece};

    fn fixture() -> (Store, i64, i64) {
        let store = Store::open(":memory:").unwrap();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Test".into(),
                title: "Test Piece".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let goal = store
            .goal_create(GoalCreate {
                piece_id,
                text: "Perform".into(),
                kind: "big".into(),
                parent_goal_id: None,
                target_date: None,
            })
            .unwrap();
        (store, piece_id, goal.id)
    }

    #[test]
    fn crud_is_display_ready_optimistic_and_does_not_create_practice_time() {
        let (store, piece_id, goal_id) = fixture();
        let work = store
            .daily_work_create(DailyWorkCreate {
                goal_id,
                region_id: None,
                block_id: None,
                title: "  Coda ladder  ".into(),
                minutes: 20,
                date: "2026-07-12".into(),
                source: "manual".into(),
            })
            .unwrap();
        assert_eq!(work.title, "Coda ladder");
        assert_eq!(work.piece_title, "Test Piece");
        assert_eq!(store.daily_work_list("2026-07-12", "2026-07-18", None).unwrap().len(), 1);
        assert!(store
            .daily_work_update(work.id, "stale", DailyWorkPatch {
                status: Some("done".into()),
                ..Default::default()
            })
            .is_err());
        let done = store
            .daily_work_update(work.id, &work.updated_ts, DailyWorkPatch {
                status: Some("done".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(done.status, "done");
        assert_eq!(crate::metrics::progress_summary(&store, piece_id).unwrap().focused_seconds, 0);
    }

    #[test]
    fn create_rejects_cross_piece_context_and_goal_delete_is_restricted() {
        let (store, _piece_id, goal_id) = fixture();
        let other = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Other".into(),
                title: "Other".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let region = store
            .region_create(crate::store::model::RegionCreate {
                piece_id: other,
                name: "Other region".into(),
                m_start: 1,
                m_end: 4,
                kind: "section".into(),
            })
            .unwrap();
        assert!(store.daily_work_create(DailyWorkCreate {
            goal_id,
            region_id: Some(region.id),
            block_id: None,
            title: "Wrong owner".into(),
            minutes: 15,
            date: "2026-07-12".into(),
            source: "manual".into(),
        }).is_err());
        let work = store.daily_work_create(DailyWorkCreate {
            goal_id,
            region_id: None,
            block_id: None,
            title: "Owned".into(),
            minutes: 15,
            date: "2026-07-12".into(),
            source: "manual".into(),
        }).unwrap();
        assert!(store.goal_delete(goal_id).is_err());
        store.daily_work_delete(work.id, &work.updated_ts).unwrap();
        store.goal_delete(goal_id).unwrap();
    }

    #[test]
    fn stale_recovery_batch_rolls_back_every_decision() {
        let (store, _piece_id, goal_id) = fixture();
        let today = store.local_today().unwrap();
        let yesterday = Date::parse(&today).unwrap().add_days(-1).unwrap().to_string();
        let one = store.daily_work_create(DailyWorkCreate {
            goal_id, region_id: None, block_id: None, title: "One".into(), minutes: 15,
            date: yesterday.clone(), source: "manual".into(),
        }).unwrap();
        let two = store.daily_work_create(DailyWorkCreate {
            goal_id, region_id: None, block_id: None, title: "Two".into(), minutes: 15,
            date: yesterday, source: "manual".into(),
        }).unwrap();
        let result = store.recovery_apply(vec![
            RecoveryDecision { id: one.id, expected_updated_ts: one.updated_ts.clone(), action: "done".into(), date: None },
            RecoveryDecision { id: two.id, expected_updated_ts: "stale".into(), action: "dismiss".into(), date: None },
        ]);
        assert!(result.is_err());
        let current = store.daily_work_list("0001-01-01", "9999-12-31", None).unwrap();
        assert!(current.iter().all(|work| work.status == "planned"));
    }

    #[test]
    fn preview_is_read_only_and_explicit_apply_moves_done_dismisses_or_leaves() {
        let (store, _piece_id, goal_id) = fixture();
        store.calendar_capacity_set(60).unwrap();
        let today = store.local_today().unwrap();
        let yesterday = Date::parse(&today).unwrap().add_days(-1).unwrap().to_string();
        let mut work = Vec::new();
        for title in ["Move", "Done", "Dismiss", "Leave"] {
            work.push(store.daily_work_create(DailyWorkCreate {
                goal_id, region_id: None, block_id: None, title: title.into(), minutes: 10,
                date: yesterday.clone(), source: "manual".into(),
            }).unwrap());
        }
        let before_events = store.events_for_piece(work[0].piece_id).unwrap().len();
        let preview = store.recovery_preview().unwrap();
        assert_eq!(preview.items.len(), 4);
        assert_eq!(store.events_for_piece(work[0].piece_id).unwrap().len(), before_events);
        let result = store.recovery_apply(vec![
            RecoveryDecision { id: work[0].id, expected_updated_ts: work[0].updated_ts.clone(), action: "move".into(), date: Some(today.clone()) },
            RecoveryDecision { id: work[1].id, expected_updated_ts: work[1].updated_ts.clone(), action: "done".into(), date: None },
            RecoveryDecision { id: work[2].id, expected_updated_ts: work[2].updated_ts.clone(), action: "dismiss".into(), date: None },
            RecoveryDecision { id: work[3].id, expected_updated_ts: work[3].updated_ts.clone(), action: "leave".into(), date: None },
        ]).unwrap();
        let by_title = result.items.into_iter().map(|item| (item.title.clone(), item)).collect::<HashMap<_, _>>();
        assert_eq!(by_title["Move"].scheduled_date, today);
        assert_eq!(by_title["Move"].reschedule_count, 1);
        assert_eq!(by_title["Done"].status, "done");
        assert_eq!(by_title["Dismiss"].status, "dismissed");
        assert_eq!(by_title["Leave"].status, "planned");
    }
}
