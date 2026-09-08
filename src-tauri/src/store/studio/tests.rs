use super::*;
use crate::ledger::MutationSource;
use crate::protocol::PracticeContract;
use crate::rep::RepVerdict;
use crate::store::model::{DemotionConfig, IncrementRule, RepOpenArgs, ScanPiece};

const NOW: &str = "2026-09-08T02:00:00Z";

/// Release rehearsal only. The path guard prevents accidentally opening live
/// Application Support data even if the environment is misconfigured.
#[test]
#[ignore = "requires PRAELUDE_STUDIO_COPY in /private/tmp/praelude-v11-rehearsal"]
fn studio_rehearsal_on_explicit_disposable_copy() {
    let path = std::fs::canonicalize(
        std::env::var("PRAELUDE_STUDIO_COPY").expect("set disposable rehearsal copy"),
    )
    .unwrap();
    assert!(path.starts_with("/private/tmp/praelude-v11-rehearsal"));
    let store = Store::open(&path).unwrap();
    assert_eq!(store.schema_version().unwrap(), 21);
    let started = std::time::Instant::now();
    let before = store.studio_snapshot().unwrap();
    let elapsed = started.elapsed();
    assert_eq!(before, store.studio_snapshot().unwrap());
    println!(
        "Studio copy: {} XP, {} completed sets, rank {} division {}, {} coins; read {:?}",
        before.progress.total_xp,
        before.progress.completed_sets,
        before.progress.rank_index,
        before.progress.division,
        before.wallet.balance,
        elapsed
    );
    let named = store
        .studio_profile_save("Rehearsal pianist", before.revision)
        .unwrap();
    let next = if named.wallet.balance >= 25 {
        store
            .studio_purchase("decor-plant", named.revision)
            .unwrap()
    } else {
        named
    };
    drop(store);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(next, reopened.studio_snapshot().unwrap());
}

fn store_with_piece() -> (Store, i64) {
    let store = Store::open(":memory:").unwrap();
    let piece = store
        .upsert_piece(&ScanPiece {
            folder_path: "/studio-test/piece".into(),
            title: "Test piece".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        })
        .unwrap();
    (store, piece)
}

fn add_focused_xp(store: &Store, piece: i64, xp: u64) {
    let conn = store.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO session (id,started_at) VALUES (1,'2026-09-07 00:00:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "WITH RECURSIVE ticks(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM ticks WHERE n<?1)
         INSERT INTO event (ts,session_id,piece_id,kind,payload)
         SELECT datetime('2026-09-07 00:00:00','+' || (n*120) || ' seconds'),1,?2,'rep','{}' FROM ticks",
        rusqlite::params![i64::try_from(xp * 5).unwrap(), piece],
    ).unwrap();
}

fn open_set(store: &Store, piece: i64, contract: PracticeContract, command: &str) -> (i64, i64) {
    let args: RepOpenArgs = serde_json::from_value(serde_json::json!({
        "piece_id": piece, "m_start":1, "m_end":4, "start_bpm":null,
        "focus":"notes", "use_metronome":false,
        "required_clean_streak":contract.required_success,
        "attempt_target":if contract.mastery_basis == crate::protocol::MasteryBasis::TotalAttempts { Some(contract.required_success) } else { None },
    })).unwrap();
    let opened = store
        .v2_open_set(
            None,
            &args,
            &IncrementRule {
                clean_needed: 3,
                bpm_step: 4.0,
                ..Default::default()
            },
            5,
            &contract,
            None,
            MutationSource::UserClick,
            command,
            NOW,
            DemotionConfig::default(),
        )
        .unwrap();
    (opened.snapshot.block_id, opened.session_id)
}

fn complete_set(store: &Store, piece: i64, index: usize, total_plays: bool) -> (i64, i64) {
    let contract = if total_plays {
        PracticeContract::total_attempts(3)
    } else {
        PracticeContract::consecutive_clean(3)
    };
    let (block, session) = open_set(store, piece, contract, &format!("open-{index}"));
    for attempt in 0..3 {
        let done = store
            .v2_record_attempt(
                Some(session),
                block,
                None,
                if total_plays {
                    RepVerdict::Failed
                } else {
                    RepVerdict::Clean
                },
                None,
                MutationSource::UserClick,
                &format!("rep-{index}-{attempt}"),
                NOW,
                DemotionConfig::default(),
            )
            .unwrap();
        if attempt == 2 {
            assert_eq!(done.snapshot.mastery_status, "satisfied");
        }
    }
    (block, session)
}

#[test]
fn blank_snapshot_has_only_starter_items_and_never_writes() {
    let (store, _) = store_with_piece();
    let before_version = store.schema_version().unwrap();
    let first = store.studio_snapshot().unwrap();
    assert_eq!(first, store.studio_snapshot().unwrap());
    assert_eq!(first.progress.total_xp, 0);
    assert_eq!(first.progress.rank_name, "Prelude");
    assert_eq!(first.progress.division, 1);
    assert_eq!(first.wallet.balance, 0);
    assert_eq!(first.owned_item_ids.len(), 6);
    assert_eq!(first.equipped[&StudioSlot::Piano], "piano-digital");
    assert_eq!(first.equipped[&StudioSlot::Seat], "seat-box");
    assert!(store.get_setting(KEY).unwrap().is_none());
    assert_eq!(store.schema_version().unwrap(), before_version);
}

#[test]
fn exact_rank_boundaries_and_endless_encores() {
    for (xp, rank, division, required, remaining) in [
        (0, 1, 1, 100, 0),
        (99, 1, 1, 100, 99),
        (100, 1, 2, 100, 0),
        (999, 1, 10, 100, 99),
        (1000, 2, 1, 150, 0),
        (2499, 2, 10, 150, 149),
        (2500, 3, 1, 200, 0),
        (32499, 10, 10, 550, 549),
        (32500, 11, 1, 600, 0),
        (38500, 12, 1, 650, 0),
    ] {
        let progress = progress::rank_progress(0, xp);
        assert_eq!(
            (
                progress.rank_index,
                progress.division,
                progress.division_xp_required,
                progress.division_xp
            ),
            (rank, division, required, remaining),
            "{xp} XP"
        );
    }
    assert_eq!(progress::rank_progress(0, 32500).rank_name, "Encore 1");
    let huge = progress::rank_progress(progress::MAX_SAFE_INTEGER, progress::MAX_SAFE_INTEGER);
    assert_eq!(huge.total_xp, progress::MAX_SAFE_INTEGER);
    assert!((1..=10).contains(&huge.division));
    assert!(huge.division_xp < huge.division_xp_required);
}

#[test]
fn focus_uses_one_canonical_session_timeline_excludes_idle_and_admin() {
    let (store, piece) = store_with_piece();
    add_focused_xp(&store, piece, 1);
    let second_piece = store
        .upsert_piece(&ScanPiece {
            folder_path: "/studio-test/second".into(),
            title: "Second piece".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        })
        .unwrap();
    {
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO event (ts,session_id,piece_id,kind,payload)
            SELECT ts,session_id,?1,kind,payload FROM event WHERE piece_id=?2",
            rusqlite::params![second_piece, piece],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO event (ts,session_id,piece_id,kind,payload) VALUES
            ('2026-09-07 00:11:00',1,?1,'goal_change','{}'),
            ('2026-09-07 05:00:00',1,?1,'rep','{}'),
            ('not-a-date',1,?1,'rep','{}')",
            [piece],
        )
        .unwrap();
    }
    let progress = store.studio_snapshot().unwrap().progress;
    assert_eq!(progress.focused_seconds, 600);
    assert_eq!(progress.focus_xp, 1);
    assert_eq!(progress.set_xp, 0);
}

#[test]
fn partial_minutes_are_accumulated_without_sampling_grants() {
    assert_eq!(progress::rank_progress(599, 0).focus_xp, 0);
    assert_eq!(progress::rank_progress(600, 0).focus_xp, 1);
    assert_eq!(progress::rank_progress(3600, 0).focus_xp, 6);
    assert_eq!(
        (0..=12).map(progress::set_milestone_xp).collect::<Vec<_>>(),
        vec![0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 6, 6, 6]
    );
}

#[test]
fn sets_are_derived_once_and_undo_cannot_farm_rewards() {
    let (store, piece) = store_with_piece();
    let mut last = (0, 0);
    for index in 0..10 {
        last = complete_set(&store, piece, index, false);
        let first = store.studio_snapshot().unwrap();
        assert_eq!(first.progress.completed_sets, index as u64 + 1);
        assert_eq!(
            first.progress.set_xp,
            progress::set_milestone_xp(index as u64 + 1)
        );
        assert_eq!(first, store.studio_snapshot().unwrap());
    }
    assert_eq!(
        store.studio_snapshot().unwrap().progress.next_set_milestone,
        None
    );
    let undone_mutation = store
        .v2_undo(
            last.1,
            last.0,
            MutationSource::UserClick,
            "undo-last",
            Some(NOW),
            DemotionConfig::default(),
        )
        .unwrap();
    let undone = store.studio_snapshot().unwrap();
    assert_eq!(undone.progress.completed_sets, 9);
    assert_eq!(undone.progress.set_xp, 4);
    store
        .v2_reverse_adjustment(
            last.1,
            last.0,
            undone_mutation.snapshot.last_adjustment_id.unwrap(),
            MutationSource::UserClick,
            "restore-last",
            Some(NOW),
            DemotionConfig::default(),
        )
        .unwrap();
    assert_eq!(store.studio_snapshot().unwrap().progress.set_xp, 6);
    assert!(store.get_setting(KEY).unwrap().is_none());
}

#[test]
fn total_plays_rewards_completion_without_requiring_false_clean_verdicts() {
    let (store, piece) = store_with_piece();
    for index in 0..3 {
        complete_set(&store, piece, index, true);
    }
    let progress = store.studio_snapshot().unwrap().progress;
    assert_eq!(progress.completed_sets, 3);
    assert_eq!(progress.set_xp, 1);
}

#[test]
fn incomplete_and_falsely_done_sets_do_not_earn_completion() {
    let (store, piece) = store_with_piece();
    let (block, _) = open_set(
        &store,
        piece,
        PracticeContract::consecutive_clean(3),
        "unfinished",
    );
    assert_eq!(store.studio_snapshot().unwrap().progress.completed_sets, 0);
    {
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "UPDATE set_contract SET set_state='paused' WHERE set_id=?1",
            [block],
        )
        .unwrap();
    }
    assert_eq!(store.studio_snapshot().unwrap().progress.completed_sets, 0);
    {
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "UPDATE set_contract SET set_state='mastered' WHERE set_id=?1",
            [block],
        )
        .unwrap();
        conn.execute("UPDATE rep_block SET status='done' WHERE id=?1", [block])
            .unwrap();
    }
    assert_eq!(store.studio_snapshot().unwrap().progress.completed_sets, 0);
}

#[test]
fn first_earned_division_buys_a_plant_exactly_once_and_survives_reload() {
    let (store, piece) = store_with_piece();
    add_focused_xp(&store, piece, 100);
    let first = store.studio_snapshot().unwrap();
    assert_eq!(first.wallet.balance, 25);
    let purchased = store.studio_purchase("decor-plant", 0).unwrap();
    assert_eq!(purchased.wallet.spent_coins, 25);
    assert_eq!(purchased.wallet.balance, 0);
    assert_eq!(purchased.equipped[&StudioSlot::Decor], "decor-plant");
    assert_eq!(purchased.revision, 1);
    assert!(store.studio_purchase("decor-plant", 0).is_err());
    assert_eq!(purchased, store.studio_purchase("decor-plant", 1).unwrap());
    assert_eq!(purchased, store.studio_snapshot().unwrap());
    let unequipped = store.studio_equip("decor-none", 1).unwrap();
    assert_eq!(unequipped.wallet.spent_coins, 25);
    assert_eq!(unequipped.revision, 2);
    assert_eq!(
        store.studio_equip("decor-plant", 2).unwrap().wallet.balance,
        0
    );
}

#[test]
fn purchases_enforce_funds_unlocks_ownership_and_unknown_item_rejection() {
    let (store, _) = store_with_piece();
    assert!(store
        .studio_purchase("decor-plant", 0)
        .unwrap_err()
        .contains("coins"));
    assert!(store
        .studio_purchase("piano-concert-grand", 0)
        .unwrap_err()
        .contains("rank 5"));
    assert!(store.studio_purchase("fake-item", 0).is_err());
    assert!(store.studio_equip("piano-concert-grand", 0).is_err());
    assert!(store.get_setting(KEY).unwrap().is_none());
}

#[test]
fn corrected_earnings_retain_owned_items_without_allowing_extra_spend() {
    let (store, piece) = store_with_piece();
    add_focused_xp(&store, piece, 100);
    store.studio_purchase("decor-plant", 0).unwrap();
    store
        .conn
        .lock()
        .unwrap()
        .execute("DELETE FROM event", [])
        .unwrap();
    let corrected = store.studio_snapshot().unwrap();
    assert_eq!(corrected.wallet.earned_coins, 0);
    assert_eq!(corrected.wallet.balance, 0);
    assert_eq!(corrected.wallet.spent_coins, 25);
    assert!(corrected
        .owned_item_ids
        .contains(&"decor-plant".to_string()));
    assert!(store.studio_purchase("seat-stool", 1).is_err());
}

#[test]
fn profile_is_local_normalized_revisioned_and_bounded() {
    let (store, _) = store_with_piece();
    let profile = store
        .studio_profile_save("  Clara   Schumann  ", 0)
        .unwrap();
    assert_eq!(profile.profile.display_name, "Clara Schumann");
    assert_eq!(profile.revision, 1);
    assert!(store.studio_profile_save("Overwrite", 0).is_err());
    for bad in ["".into(), " ".into(), "x".repeat(41), "New\nName".into()] {
        assert!(store.studio_profile_save(&bad, 1).is_err());
    }
    assert_eq!(store.studio_snapshot().unwrap(), profile);
}

#[test]
fn malformed_saved_state_is_preserved_and_never_reset() {
    let (store, _) = store_with_piece();
    for raw in ["{}", "not-json", "null"] {
        store.set_setting(KEY, raw).unwrap();
        assert!(store.studio_snapshot().is_err());
        assert!(store.studio_profile_save("Name", 0).is_err());
        assert_eq!(store.get_setting(KEY).unwrap().as_deref(), Some(raw));
    }
    let mut invalid = SavedStudio::default();
    invalid
        .equipped
        .insert(StudioSlot::Piano, "piano-concert-grand".into());
    let raw = serde_json::to_string(&invalid).unwrap();
    store.set_setting(KEY, &raw).unwrap();
    assert!(store.studio_snapshot().is_err());
    assert_eq!(
        store.get_setting(KEY).unwrap().as_deref(),
        Some(raw.as_str())
    );
}

#[test]
fn two_concurrent_spends_cannot_use_one_balance_twice() {
    let (store, piece) = store_with_piece();
    add_focused_xp(&store, piece, 100);
    let store = std::sync::Arc::new(store);
    let threads = (0..2)
        .map(|_| {
            let store = store.clone();
            std::thread::spawn(move || store.studio_purchase("decor-plant", 0))
        })
        .collect::<Vec<_>>();
    assert_eq!(
        threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(Result::is_ok)
            .count(),
        1
    );
    let snapshot = store.studio_snapshot().unwrap();
    assert_eq!(snapshot.wallet.spent_coins, 25);
    assert_eq!(snapshot.revision, 1);
}

#[test]
fn profile_and_equipment_persist_across_real_store_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("studio.db");
    let store = Store::open(&path).unwrap();
    let piece = store
        .upsert_piece(&ScanPiece {
            folder_path: "/studio-test/persistent".into(),
            title: "Persistent piece".into(),
            composer: None,
            xml_path: None,
            pdf_path: None,
        })
        .unwrap();
    add_focused_xp(&store, piece, 100);
    store.studio_profile_save("Clara", 0).unwrap();
    let bought = store.studio_purchase("decor-plant", 1).unwrap();
    drop(store);
    let reopened = Store::open(path).unwrap();
    assert_eq!(reopened.studio_snapshot().unwrap(), bought);
    assert_eq!(reopened.schema_version().unwrap(), 21);
}

#[test]
fn session_milestones_are_cumulative_per_session_and_old_sets_are_retained() {
    let (store, piece) = store_with_piece();
    let mut last_session = 0;
    for index in 0..3 {
        last_session = complete_set(&store, piece, index, false).1;
    }
    assert_eq!(
        store
            .studio_snapshot()
            .unwrap()
            .progress
            .current_session_sets,
        3
    );
    store
        .conn
        .lock()
        .unwrap()
        .execute(
            "UPDATE session SET ended_at=?1 WHERE id=?2",
            rusqlite::params![NOW, last_session],
        )
        .unwrap();
    let ended = store.studio_snapshot().unwrap().progress;
    assert_eq!(ended.current_session_sets, 0);
    assert_eq!(ended.set_xp, 1);
    for index in 3..6 {
        complete_set(&store, piece, index, false);
    }
    let next = store.studio_snapshot().unwrap().progress;
    assert_eq!(next.current_session_sets, 3);
    assert_eq!(next.completed_sets, 6);
    assert_eq!(next.set_xp, 2);
    assert_eq!(next.next_set_milestone, Some(5));
}
