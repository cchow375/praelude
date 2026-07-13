//! Honest, read-only Practice Universe aggregation.
//!
//! The Universe never stores progress. It derives every signal from the durable
//! canonical `event` log and the current Piece -> block -> Region graph. Only
//! practice event kinds are admitted, so Calendar and Goal administration cannot
//! manufacture practice time, active days, planets, halos, or brightness.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use crate::date::Date;
use crate::metrics;
use crate::store::model::{BlockMeta, Event, PieceSummary, Region};
use crate::store::Store;

const PRACTICE_EVENT_KINDS: [&str; 4] = ["rep_open", "rep", "verdict", "tempo_change"];
const ACTIVE_WINDOW_DAYS: i64 = 28;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct UniverseSnapshot {
    pub generated_at: String,
    pub definitions: Vec<SignalDefinition>,
    pub traces: UniverseTraces,
    pub totals: UniverseTotals,
    pub pieces: Vec<PieceSignal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct SignalDefinition {
    pub signal: &'static str,
    pub label: &'static str,
    pub definition: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct UniverseTraces {
    pub source: &'static str,
    pub practice_event_kinds: Vec<&'static str>,
    pub idle_threshold_seconds: i64,
    pub active_window_start: String,
    pub active_window_end: String,
    pub quality_formula: &'static str,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct UniverseTotals {
    pub focused_seconds: u64,
    pub active_days_28: u32,
    pub regions_practiced: u32,
    pub regions_revisited: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct PieceSignal {
    pub piece_id: i64,
    pub title: String,
    pub composer: Option<String>,
    pub focused_seconds: u64,
    pub active_days_28: u32,
    pub regions_total: u32,
    pub regions_practiced: u32,
    pub regions_revisited: u32,
    pub quality_brightness: f64,
    pub last_practiced: Option<String>,
    pub region_signals: Vec<RegionSignal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct RegionSignal {
    pub region_id: i64,
    pub name: String,
    pub kind: String,
    pub focused_seconds: u64,
    pub active_days_28: u32,
    pub practiced: bool,
    pub revisited: bool,
    pub quality_brightness: f64,
    pub last_practiced: Option<String>,
    pub practice_events: u32,
    pub rated_rep_events: u32,
    pub clean_rep_events: u32,
    pub distinct_practice_dates: u32,
}

struct PieceInput {
    piece: PieceSummary,
    regions: Vec<Region>,
    blocks: Vec<BlockMeta>,
    events: Vec<DatedEvent>,
}

#[derive(Clone)]
struct DatedEvent {
    event: Event,
    /// The event's date in the backend user's local timezone. Invalid event
    /// timestamps deliberately produce `None` instead of inventing activity.
    local_date: Option<Date>,
}

/// Assemble the read-only Universe snapshot from the store.
pub(crate) fn snapshot(store: &Store) -> rusqlite::Result<UniverseSnapshot> {
    let today_text = store.local_today()?;
    let today = Date::parse(&today_text).ok_or_else(|| {
        rusqlite::Error::InvalidParameterName(format!(
            "SQLite returned invalid local date '{today_text}'"
        ))
    })?;

    let inputs = store
        .list_pieces()?
        .into_iter()
        .map(|piece| {
            let events = store
                .events_for_piece(piece.id)?
                .into_iter()
                .map(|event| DatedEvent {
                    local_date: local_date_for_utc_timestamp(&event.ts),
                    event,
                })
                .collect();
            Ok(PieceInput {
                regions: store.region_list(piece.id)?,
                blocks: store.blocks_meta(piece.id)?,
                events,
                piece,
            })
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;

    aggregate(store.now_rfc3339()?, today, &inputs)
}

fn aggregate(
    generated_at: String,
    today: Date,
    inputs: &[PieceInput],
) -> rusqlite::Result<UniverseSnapshot> {
    let window_start = today.add_days(-(ACTIVE_WINDOW_DAYS - 1)).ok_or_else(|| {
        rusqlite::Error::InvalidParameterName("28-day Universe window is out of range".into())
    })?;
    let mut global_active_dates = BTreeSet::new();
    let mut pieces = Vec::with_capacity(inputs.len());

    for input in inputs {
        let practice: Vec<&DatedEvent> = input
            .events
            .iter()
            .filter(|dated| is_practice_event(&dated.event))
            .collect();
        let practice_events: Vec<Event> =
            practice.iter().map(|dated| dated.event.clone()).collect();
        let active_dates = dates_in_window(&practice, window_start, today);
        global_active_dates.extend(active_dates.iter().copied());

        let block_regions: HashMap<i64, i64> = input
            .blocks
            .iter()
            .filter_map(|block| block.region_id.map(|region| (block.block_id, region)))
            .collect();
        let mut region_signals = Vec::with_capacity(input.regions.len());

        for region in &input.regions {
            let region_practice: Vec<&DatedEvent> = practice
                .iter()
                .copied()
                .filter(|dated| {
                    event_block_id(&dated.event).and_then(|block| block_regions.get(&block))
                        == Some(&region.id)
                })
                .collect();
            let region_events: Vec<Event> = region_practice
                .iter()
                .map(|dated| dated.event.clone())
                .collect();
            let all_dates = all_valid_dates(&region_practice);
            let region_active_dates = dates_in_window(&region_practice, window_start, today);
            let (rated, clean) = rated_counts(&region_practice);

            region_signals.push(RegionSignal {
                region_id: region.id,
                name: region.name.clone(),
                kind: region.kind.clone(),
                focused_seconds: metrics::focused_seconds(&region_events),
                active_days_28: count_u32(region_active_dates.len()),
                practiced: !region_practice.is_empty(),
                revisited: all_dates.len() >= 2,
                quality_brightness: quality_brightness(rated, clean),
                last_practiced: last_practiced(&region_practice),
                practice_events: count_u32(region_practice.len()),
                rated_rep_events: rated,
                clean_rep_events: clean,
                distinct_practice_dates: count_u32(all_dates.len()),
            });
        }

        let (rated, clean) = rated_counts(&practice);
        pieces.push(PieceSignal {
            piece_id: input.piece.id,
            title: input.piece.title.clone(),
            composer: input.piece.composer.clone(),
            focused_seconds: metrics::focused_seconds(&practice_events),
            active_days_28: count_u32(active_dates.len()),
            regions_total: count_u32(input.regions.len()),
            regions_practiced: count_u32(
                region_signals
                    .iter()
                    .filter(|signal| signal.practiced)
                    .count(),
            ),
            regions_revisited: count_u32(
                region_signals
                    .iter()
                    .filter(|signal| signal.revisited)
                    .count(),
            ),
            quality_brightness: quality_brightness(rated, clean),
            last_practiced: last_practiced(&practice),
            region_signals,
        });
    }

    let totals = UniverseTotals {
        focused_seconds: pieces.iter().map(|piece| piece.focused_seconds).sum(),
        active_days_28: count_u32(global_active_dates.len()),
        regions_practiced: pieces.iter().map(|piece| piece.regions_practiced).sum(),
        regions_revisited: pieces.iter().map(|piece| piece.regions_revisited).sum(),
    };

    Ok(UniverseSnapshot {
        generated_at,
        definitions: definitions(),
        traces: UniverseTraces {
            source: "canonical event log + current Piece/block/Region graph",
            practice_event_kinds: PRACTICE_EVENT_KINDS.to_vec(),
            idle_threshold_seconds: metrics::IDLE_THRESHOLD_SECS,
            active_window_start: window_start.to_string(),
            active_window_end: today.to_string(),
            quality_formula: "0.92 + 0.08 * ((clean_rep_events + 2) / (rated_rep_events + 4)); rounded to 4 decimals; bounded 0.92..1.00",
        },
        totals,
        pieces,
    })
}

fn definitions() -> Vec<SignalDefinition> {
    vec![
        SignalDefinition {
            signal: "star_radius",
            label: "Focused time",
            definition: "Sum of gaps of 0–120 seconds between canonical practice events for this Piece; longer idle gaps add no time.",
        },
        SignalDefinition {
            signal: "orbit_continuity",
            label: "Active days",
            definition: "Distinct backend-local calendar dates with a canonical practice event in the inclusive 28-day window ending today.",
        },
        SignalDefinition {
            signal: "planet",
            label: "Region practiced",
            definition: "A current Region whose linked block has at least one canonical practice event.",
        },
        SignalDefinition {
            signal: "halo",
            label: "Region revisited",
            definition: "A practiced Region with canonical practice events on at least two distinct backend-local dates across all history.",
        },
        SignalDefinition {
            signal: "quality_brightness",
            label: "Subtle quality brightness",
            definition: "A bounded 0.92–1.00 visual tint from self-reported rep verdicts with a neutral prior. It is not a score, grade, or penalty.",
        },
    ]
}

fn is_practice_event(event: &Event) -> bool {
    PRACTICE_EVENT_KINDS.contains(&event.kind.as_str())
}

fn event_block_id(event: &Event) -> Option<i64> {
    event.payload.get("block_id")?.as_i64()
}

fn dates_in_window(events: &[&DatedEvent], start: Date, end: Date) -> BTreeSet<Date> {
    events
        .iter()
        .filter_map(|dated| dated.local_date)
        .filter(|date| (start..=end).contains(date))
        .collect()
}

fn all_valid_dates(events: &[&DatedEvent]) -> BTreeSet<Date> {
    events.iter().filter_map(|dated| dated.local_date).collect()
}

fn rated_counts(events: &[&DatedEvent]) -> (u32, u32) {
    events.iter().fold((0u32, 0u32), |(rated, clean), dated| {
        if !matches!(dated.event.kind.as_str(), "rep" | "verdict") {
            return (rated, clean);
        }
        match dated
            .event
            .payload
            .get("verdict")
            .and_then(|value| value.as_str())
        {
            Some("clean") => (rated.saturating_add(1), clean.saturating_add(1)),
            Some("flawed" | "failed") => (rated.saturating_add(1), clean),
            _ => (rated, clean),
        }
    })
}

/// Quality is intentionally a gentle tint, never a score. A two-clean/two-other
/// neutral prior keeps sparse self-reports from swinging the display. Rounding
/// makes the wire result stable across platforms.
fn quality_brightness(rated: u32, clean: u32) -> f64 {
    let clean = clean.min(rated) as f64;
    let adjusted_clean_share = (clean + 2.0) / (f64::from(rated) + 4.0);
    let bounded = (0.92 + 0.08 * adjusted_clean_share).clamp(0.92, 1.0);
    (bounded * 10_000.0).round() / 10_000.0
}

fn last_practiced(events: &[&DatedEvent]) -> Option<String> {
    events
        .iter()
        .filter_map(|dated| {
            parse_utc_epoch(&dated.event.ts).map(|epoch| (epoch, dated.event.ts.as_str()))
        })
        .max_by_key(|(epoch, _)| *epoch)
        .map(|(_, ts)| crate::store::model::sqlite_ts_to_rfc3339(ts))
}

fn count_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Canonical event timestamps are UTC. Convert them through the host timezone
/// database so DST and historical timezone transitions produce the same local
/// date the backend user sees. The pure aggregator receives the converted date,
/// keeping its behavior deterministic in tests.
fn local_date_for_utc_timestamp(ts: &str) -> Option<Date> {
    let epoch = parse_utc_epoch(ts)?;
    #[cfg(unix)]
    {
        let mut local = std::mem::MaybeUninit::<libc::tm>::uninit();
        // SAFETY: `epoch` and `local` are valid pointers for the duration of the
        // call. `localtime_r` writes exactly one initialized `tm` on success.
        if unsafe { libc::localtime_r(&epoch, local.as_mut_ptr()) }.is_null() {
            return None;
        }
        // SAFETY: the non-null return above guarantees initialization.
        let local = unsafe { local.assume_init() };
        let text = format!(
            "{:04}-{:02}-{:02}",
            local.tm_year + 1900,
            local.tm_mon + 1,
            local.tm_mday
        );
        Date::parse(&text)
    }
    #[cfg(not(unix))]
    {
        let day = epoch.div_euclid(86_400);
        Date::parse("1970-01-01")?.add_days(day)
    }
}

fn parse_utc_epoch(ts: &str) -> Option<i64> {
    if let Ok(epoch) = ts.parse::<i64>() {
        return Some(epoch);
    }
    if ts.len() < 19 || !matches!(ts.as_bytes().get(10), Some(b' ' | b'T')) {
        return None;
    }
    let suffix = ts.get(19..)?;
    if !suffix.is_empty() && suffix != "Z" {
        return None;
    }
    let date = Date::parse(ts.get(0..10)?)?;
    let time = ts.get(11..19)?;
    let bytes = time.as_bytes();
    if bytes.len() != 8 || bytes[2] != b':' || bytes[5] != b':' {
        return None;
    }
    let hour = time[0..2].parse::<i64>().ok()?;
    let minute = time[3..5].parse::<i64>().ok()?;
    let second = time[6..8].parse::<i64>().ok()?;
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    date.days_since_epoch()
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::ScanPiece;
    use serde_json::json;

    fn piece(id: i64, title: &str) -> PieceSummary {
        PieceSummary {
            id,
            title: title.into(),
            composer: Some("Composer".into()),
            has_xml: false,
            has_pdf: false,
            intake_done: false,
        }
    }

    fn region(id: i64, piece_id: i64, name: &str) -> Region {
        Region {
            id,
            piece_id,
            name: name.into(),
            m_start: 1,
            m_end: 8,
            kind: "section".into(),
            order: id,
            color: None,
            pdf_anchor: None,
        }
    }

    fn event(
        id: i64,
        piece_id: i64,
        kind: &str,
        ts: &str,
        local_date: Option<&str>,
        block_id: Option<i64>,
        verdict: Option<&str>,
    ) -> DatedEvent {
        DatedEvent {
            event: Event {
                id,
                ts: ts.into(),
                session_id: Some(1),
                piece_id: Some(piece_id),
                kind: kind.into(),
                payload: json!({ "block_id": block_id, "verdict": verdict }),
            },
            local_date: local_date.and_then(Date::parse),
        }
    }

    fn input(
        id: i64,
        regions: Vec<Region>,
        blocks: Vec<BlockMeta>,
        events: Vec<DatedEvent>,
    ) -> PieceInput {
        PieceInput {
            piece: piece(id, &format!("Piece {id}")),
            regions,
            blocks,
            events,
        }
    }

    fn run(inputs: &[PieceInput]) -> UniverseSnapshot {
        aggregate(
            "2026-07-12T12:00:00Z".into(),
            Date::parse("2026-07-12").unwrap(),
            inputs,
        )
        .unwrap()
    }

    #[test]
    fn empty_snapshot_has_definitions_traces_and_zero_totals() {
        let out = run(&[]);
        assert_eq!(out.totals, UniverseTotals::default());
        assert!(out.pieces.is_empty());
        assert_eq!(out.definitions.len(), 5);
        assert_eq!(out.traces.active_window_start, "2026-06-15");
        assert_eq!(out.traces.active_window_end, "2026-07-12");
        assert_eq!(out.traces.practice_event_kinds, PRACTICE_EVENT_KINDS);
    }

    #[test]
    fn active_window_is_inclusive_today_minus_27_through_today() {
        let events = vec![
            event(
                1,
                1,
                "rep",
                "2026-06-14 12:00:00",
                Some("2026-06-14"),
                None,
                None,
            ),
            event(
                2,
                1,
                "rep",
                "2026-06-15 12:00:00",
                Some("2026-06-15"),
                None,
                None,
            ),
            event(
                3,
                1,
                "rep",
                "2026-07-12 12:00:00",
                Some("2026-07-12"),
                None,
                None,
            ),
            event(
                4,
                1,
                "rep",
                "2026-07-13 12:00:00",
                Some("2026-07-13"),
                None,
                None,
            ),
        ];
        let out = run(&[input(1, vec![], vec![], events)]);
        assert_eq!(out.pieces[0].active_days_28, 2);
        assert_eq!(out.totals.active_days_28, 2);
    }

    #[test]
    fn admin_events_cannot_contaminate_any_signal() {
        let regions = vec![region(10, 1, "Only")];
        let blocks = vec![BlockMeta {
            block_id: 100,
            region_id: Some(10),
            focus: "tempo".into(),
        }];
        let events = vec![
            event(
                1,
                1,
                "goal_change",
                "2026-07-11 10:00:00",
                Some("2026-07-11"),
                Some(100),
                Some("clean"),
            ),
            event(
                2,
                1,
                "daily_work_change",
                "2026-07-11 10:01:00",
                Some("2026-07-11"),
                Some(100),
                Some("clean"),
            ),
            event(
                3,
                1,
                "recovery_apply",
                "2026-07-12 10:02:00",
                Some("2026-07-12"),
                Some(100),
                Some("clean"),
            ),
        ];
        let out = run(&[input(1, regions, blocks, events)]);
        let piece = &out.pieces[0];
        assert_eq!(piece.focused_seconds, 0);
        assert_eq!(piece.active_days_28, 0);
        assert_eq!(piece.regions_practiced, 0);
        assert_eq!(piece.regions_revisited, 0);
        assert_eq!(piece.quality_brightness, 0.96);
        assert!(!piece.region_signals[0].practiced);
    }

    #[test]
    fn multiple_regions_dates_and_pieces_aggregate_without_double_counting_days() {
        let a_regions = vec![region(10, 1, "A"), region(11, 1, "B")];
        let a_blocks = vec![
            BlockMeta {
                block_id: 100,
                region_id: Some(10),
                focus: "tempo".into(),
            },
            BlockMeta {
                block_id: 110,
                region_id: Some(11),
                focus: "notes".into(),
            },
        ];
        let a_events = vec![
            event(
                1,
                1,
                "rep",
                "2026-07-10 10:00:00",
                Some("2026-07-10"),
                Some(100),
                Some("clean"),
            ),
            event(
                2,
                1,
                "rep",
                "2026-07-10 10:01:00",
                Some("2026-07-10"),
                Some(110),
                Some("failed"),
            ),
            event(
                3,
                1,
                "rep",
                "2026-07-11 10:00:00",
                Some("2026-07-11"),
                Some(100),
                Some("flawed"),
            ),
        ];
        let b_regions = vec![region(20, 2, "C")];
        let b_blocks = vec![BlockMeta {
            block_id: 200,
            region_id: Some(20),
            focus: "tempo".into(),
        }];
        let b_events = vec![
            event(
                4,
                2,
                "rep_open",
                "2026-07-11 11:00:00",
                Some("2026-07-11"),
                Some(200),
                None,
            ),
            event(
                5,
                2,
                "rep",
                "2026-07-12 11:01:00",
                Some("2026-07-12"),
                Some(200),
                Some("clean"),
            ),
        ];
        let out = run(&[
            input(1, a_regions, a_blocks, a_events),
            input(2, b_regions, b_blocks, b_events),
        ]);
        assert_eq!(
            out.totals.active_days_28, 3,
            "global distinct dates, not piece sum"
        );
        assert_eq!(out.totals.regions_practiced, 3);
        assert_eq!(out.totals.regions_revisited, 2);
        assert_eq!(out.pieces[0].regions_revisited, 1);
        assert_eq!(out.pieces[0].region_signals[0].distinct_practice_dates, 2);
        assert_eq!(out.pieces[0].region_signals[1].distinct_practice_dates, 1);
        assert_eq!(out.pieces[1].regions_revisited, 1);
    }

    #[test]
    fn focused_time_and_last_practiced_use_only_valid_practice_timestamps() {
        let events = vec![
            event(
                1,
                1,
                "rep",
                "2026-07-12 10:00:00",
                Some("2026-07-12"),
                None,
                Some("clean"),
            ),
            event(
                2,
                1,
                "goal_change",
                "2026-07-12 10:00:30",
                Some("2026-07-12"),
                None,
                None,
            ),
            event(
                3,
                1,
                "rep",
                "2026-07-12 10:01:30",
                Some("2026-07-12"),
                None,
                Some("flawed"),
            ),
            event(4, 1, "rep", "invalid", None, None, Some("clean")),
        ];
        let out = run(&[input(1, vec![], vec![], events)]);
        assert_eq!(out.pieces[0].focused_seconds, 90);
        assert_eq!(
            out.pieces[0].last_practiced.as_deref(),
            Some("2026-07-12T10:01:30Z")
        );
    }

    #[test]
    fn quality_is_stable_neutral_and_tightly_bounded() {
        assert_eq!(quality_brightness(0, 0), 0.96);
        assert_eq!(quality_brightness(1, 1), 0.968);
        assert_eq!(quality_brightness(1, 0), 0.952);
        assert_eq!(quality_brightness(u32::MAX, u32::MAX), 1.0);
        assert_eq!(quality_brightness(u32::MAX, 0), 0.92);
        assert_eq!(
            quality_brightness(1, u32::MAX),
            0.968,
            "clean count clamps to rated"
        );
        for (rated, clean) in [(0, 0), (10, 0), (10, 5), (10, 10), (u32::MAX, 9)] {
            assert!((0.92..=1.0).contains(&quality_brightness(rated, clean)));
        }
    }

    #[test]
    fn quality_reads_only_rated_rep_events() {
        let events = vec![
            event(
                1,
                1,
                "rep_open",
                "2026-07-12 10:00:00",
                Some("2026-07-12"),
                None,
                Some("clean"),
            ),
            event(
                2,
                1,
                "tempo_change",
                "2026-07-12 10:00:10",
                Some("2026-07-12"),
                None,
                Some("clean"),
            ),
            event(
                3,
                1,
                "rep",
                "2026-07-12 10:00:20",
                Some("2026-07-12"),
                None,
                Some("failed"),
            ),
        ];
        let out = run(&[input(1, vec![], vec![], events)]);
        assert_eq!(out.pieces[0].quality_brightness, 0.952);
    }

    #[test]
    fn invalid_dates_and_timestamps_are_ignored_not_guessed() {
        let mut bad_local = event(1, 1, "rep", "2026-07-12 25:00:00", None, None, None);
        bad_local.local_date = Date::parse("2026-02-29");
        let out = run(&[input(1, vec![], vec![], vec![bad_local])]);
        assert_eq!(out.pieces[0].active_days_28, 0);
        assert_eq!(out.pieces[0].last_practiced, None);
        assert_eq!(parse_utc_epoch("2024-02-29T23:59:59Z"), Some(1_709_251_199));
        assert_eq!(parse_utc_epoch("1900-02-29 00:00:00"), None);
        assert_eq!(parse_utc_epoch("2026-07-12T12:00:00+04:00"), None);
    }

    #[test]
    fn store_snapshot_works_before_and_after_canonical_practice_events_exist() {
        let store = Store::open(":memory:").unwrap();
        let piece_id = store
            .upsert_piece(&ScanPiece {
                folder_path: "/vault/Piece".into(),
                title: "Piece".into(),
                composer: None,
                xml_path: None,
                pdf_path: None,
            })
            .unwrap();
        let before = snapshot(&store).unwrap();
        assert_eq!(before.pieces.len(), 1);
        assert_eq!(before.totals, UniverseTotals::default());

        store
            .append_event(
                "goal_change",
                None,
                Some(piece_id),
                &json!({"verdict":"clean"}),
            )
            .unwrap();
        let admin_only = snapshot(&store).unwrap();
        assert_eq!(admin_only.totals, UniverseTotals::default());

        store
            .append_event("rep", None, Some(piece_id), &json!({"verdict":"clean"}))
            .unwrap();
        let after = snapshot(&store).unwrap();
        assert_eq!(after.pieces[0].active_days_28, 1);
        assert_eq!(after.pieces[0].quality_brightness, 0.968);
    }
}
