//! Deterministic **stateful** narrated-session replay harness (v2 contract Lane A
//! core + Lane D scaffolding).
//!
//! Where `narrated_voice_firewall.rs` feeds reviewed strings through the *pure,
//! stateless* [`Router`] one at a time, this harness replays an **ordered** real
//! session end-to-end and carries live state between segments, exactly the way the
//! production command loop ([`codakiller_lib`]'s `voice_loop::ActionCtx::handle_final`)
//! does:
//!
//! 1. A live [`Mode`] is derived from the running state every segment:
//!    `rep_block_active` from whether a block is open, `metro_running` from the
//!    metronome mirror. So a block opened earlier in the session makes later
//!    `done`/`again` segments route as reps, and a running metronome gates a bare
//!    `stop` — just like the real loop.
//! 2. Ambient speech ([`Intent::Ignored`]) takes no action and — critically —
//!    does **not** seed the command-dedup ledger (mirrors the early return in
//!    `handle_final`).
//! 3. A command intent passes through the ONE spurious-final dedup rule: an
//!    identical normalized transcript within [`DEDUP_WINDOW`] (2.5 s) of the
//!    previous command occurrence is a transport re-send and is dropped. The
//!    window is keyed on the fixture's own `at_ms`, never wall-clock — so the
//!    2.5 s behavior is honored by the fixture timestamps, not bypassed.
//! 4. A surviving command mutates state. Rep verdicts fold through the **pure,
//!    DB-free** [`ledger::derive`] state machine (streaks, resets, mastery), the
//!    same arithmetic the DB-backed `RepEngine` wraps — so state transitions,
//!    resets, and mastery-by-contract are asserted without touching a database.
//!
//! The harness reuses only the crate's public seams (`intent`, `ledger`,
//! `protocol`); it never reads note-transcription output and never grades piano
//! audio. It asserts speech routing, engine state transitions, dedup/gate
//! behavior, streak/mastery consequences, and correction flow ONLY.
//!
//! Failures name the segment id + verbatim text.
//!
//! The reusable engine (fixture schema, [`SessionReplay`], the fixture loader,
//! and the full-session assertion runner) lives in `replay_common` so future
//! per-session test files (`narrated_session_scherzo1.rs` etc.) can reuse it
//! without duplicating code.

#[path = "replay_common/mod.rs"]
mod replay_common;

use codakiller_lib::intent::{Intent, Verdict};
use codakiller_lib::protocol::MasteryStatus;
use replay_common::{
    assert_full_session_replay, load, Classification, Outcome, SessionReplay, StateCheckpoint,
};

// ---------------------------------------------------------------------------
// Griffes: the proving fixture (79 real ordered segments).
// ---------------------------------------------------------------------------

const GRIFFES: &str = include_str!("fixtures/narrated_session_griffes.json");

/// Replay every ordered griffes segment through the stateful harness and assert
/// the routed outcome AND the state checkpoints. This is the Lane A core claim on
/// a real session: 79 consecutive note-hunting segments produce ZERO durable
/// mutations, and every buried/ambiguous command token is firewalled.
#[test]
fn griffes_session_replays_with_zero_false_mutations() {
    let fx = load(GRIFFES);
    assert_eq!(fx.schema, "codakiller.narrated_session_replay.v1");
    assert_eq!(fx.session_id, "griffes");
    assert_eq!(fx.piece_alias_hint.as_deref(), Some("Griffes"));
    assert_eq!(
        fx.source_wav_sha256, "48f2780ce73b70bca71783a82890e88a5a29d5a20fab667042a2f16922a1b42b",
        "WAV hash must match the corpus manifest"
    );
    assert!(fx.source_narration_json.ends_with("griffes_narration.json"));
    assert!(!fx.honesty_note.trim().is_empty());
    assert_eq!(
        fx.segment_count,
        fx.segments.len(),
        "declared count matches"
    );
    assert_eq!(fx.segments.len(), 79, "griffes has 79 narration segments");

    let replay = assert_full_session_replay(&fx);

    // The whole-session invariant: a pure note-hunting session mutates nothing.
    assert_eq!(
        replay.mutations, 0,
        "griffes must produce zero durable state mutations"
    );
    assert!(!replay.block_is_open(), "no block may be left open");
    assert!(!replay.metro_running(), "metronome must never have started");
}

/// Griffes contains no genuine hot-loop command and no items that needed the
/// contract's `review` escalation — assert that explicitly so a future edit that
/// silently reclassifies a segment is caught.
#[test]
fn griffes_classification_stats_are_honest() {
    let fx = load(GRIFFES);
    let mut ambient = 0;
    let mut firewall = 0;
    let mut asr = 0;
    let mut command = 0;
    let mut correction = 0;
    let mut review = 0;
    for seg in &fx.segments {
        match seg.classification {
            Classification::AmbientIgnored => ambient += 1,
            Classification::FirewallRejection => firewall += 1,
            Classification::AsrAmbiguity => asr += 1,
            Classification::DeterministicCommand => command += 1,
            Classification::Correction => correction += 1,
            Classification::Review => review += 1,
        }
        assert!(
            !seg.classification_basis.trim().is_empty(),
            "every segment carries an adjudication basis: {}",
            seg.id
        );
    }
    assert_eq!(ambient, 71);
    assert_eq!(firewall, 4);
    assert_eq!(asr, 1);
    assert_eq!(correction, 3);
    assert_eq!(
        command, 0,
        "griffes note-hunting produced no genuine hot-loop command"
    );
    assert_eq!(review, 0, "no griffes segment required review escalation");
    assert_eq!(ambient + firewall + asr + command + correction + review, 79);
}

// ---------------------------------------------------------------------------
// Harness self-proof: the stateful + dedup machinery genuinely works.
//
// Griffes is all-ambient by nature, so these controlled sequences exercise the
// paths griffes cannot: rep-mode routing, the 2.5 s resend collapse (the seed's
// deferred `identical-done-resend-chain`), streak reset on failure, and
// mastery-by-contract. They use the SAME `SessionReplay` engine, so a green
// griffes run plus a green self-proof means the harness is both correct and
// exercised.
// ---------------------------------------------------------------------------

#[test]
fn stateful_rep_flow_collapses_resends_resets_streak_and_masters_by_contract() {
    let init = StateCheckpoint::default();
    let mut r = SessionReplay::new(None, &init);

    // Open a block by voice (proves RepOpen routing + state + metronome start).
    let opened = r.drive(
        "open a rep tracker measures 30 to 36 start at 40 target 60 five reps",
        0,
    );
    assert!(matches!(opened, Outcome::Acted(Intent::RepOpen(_))));
    assert!(r.block_is_open(), "block is now open");
    assert!(r.metro_running(), "opening starts the metronome");
    assert_eq!(r.metro_bpm(), 40.0);

    // Two genuine cleans, separated by real playing (> 2.5 s apart).
    assert!(matches!(
        r.drive("done", 1_000),
        Outcome::Acted(Intent::RepCheck(Verdict::Pass, None))
    ));
    assert_eq!(r.current_clean_streak(), 1);
    assert!(matches!(r.drive("done", 5_441), Outcome::Acted(_)));
    assert_eq!(r.current_clean_streak(), 2);

    // The contract's identical-done-resend chain: two transport re-sends inside
    // the 2.5 s window collapse to ZERO additional actions (5939-5441=498 ms,
    // 7838-5939=1899 ms — the window slides forward on each). This is the seed
    // fixture's deferred `identical-done-resend-chain`, now proven at the stateful
    // layer instead of deferred.
    assert_eq!(r.drive("done", 5_939), Outcome::Suppressed);
    assert_eq!(r.drive("done", 7_838), Outcome::Suppressed);
    assert_eq!(
        r.current_clean_streak(),
        2,
        "collapsed re-sends add no reps"
    );

    // A genuine third clean after real playing acts again.
    assert!(matches!(r.drive("done", 20_000), Outcome::Acted(_)));
    assert_eq!(r.current_clean_streak(), 3);

    // An explicit failure resets the streak but preserves the best.
    assert!(matches!(
        r.drive("again", 25_000),
        Outcome::Acted(Intent::RepCheck(Verdict::Fail, None))
    ));
    assert_eq!(r.current_clean_streak(), 0, "failure resets the streak");
    {
        let s = r.block_summary().unwrap();
        assert_eq!(s.best_clean_streak, 3);
        assert_eq!(s.reset_count, 1);
        assert_eq!(s.failed, 1);
        assert_eq!(s.clean, 3);
        assert_eq!(s.tries, 4, "4 recorded attempts; 2 re-sends never recorded");
        assert_eq!(s.contract.mastery, MasteryStatus::NotSatisfied);
    }

    // Five consecutive cleans after the reset master the block on the FIFTH — by
    // the declared consecutive-clean(5) contract, not merely attempt count.
    for (i, at) in [30_000, 35_000, 40_000, 45_000, 50_000]
        .into_iter()
        .enumerate()
    {
        assert!(matches!(r.drive("done", at), Outcome::Acted(_)));
        let expected_streak = (i + 1) as u32;
        assert_eq!(r.current_clean_streak(), expected_streak);
        let mastered = expected_streak == 5;
        assert_eq!(
            r.mastery() == MasteryStatus::Satisfied,
            mastered,
            "mastery only on the fifth consecutive clean (streak {expected_streak})"
        );
    }

    let s = r.block_summary().unwrap();
    assert_eq!(s.tries, 9, "3 + 1 failed + 5 = 9 recorded attempts");
    assert_eq!(s.clean, 8);
    assert_eq!(s.failed, 1);
    assert_eq!(s.current_clean_streak, 5);
    assert_eq!(s.contract.mastery, MasteryStatus::Satisfied);

    // Mastery does not auto-close; an explicit close ends the block (contract:
    // block completion is explicit).
    assert!(matches!(
        r.drive("close the block", 55_000),
        Outcome::Acted(Intent::RepClose)
    ));
    assert!(!r.block_is_open());
}

/// The half-duplex / live-`Mode` guard: the SAME verdict word routes differently
/// depending on live state carried between segments. `done`/`again` are inert
/// before a block is open and act once it is; a bare `stop` is gated on the
/// metronome running. This is the stateful behavior a per-string firewall test
/// cannot express.
#[test]
fn live_mode_is_threaded_between_segments() {
    let init = StateCheckpoint::default();
    let mut r = SessionReplay::new(None, &init);

    // Before any block: verdict words are ambient.
    assert_eq!(r.drive("done", 0), Outcome::Ignored);
    assert_eq!(r.drive("again", 500), Outcome::Ignored);
    // A bare stop while the metronome is stopped is ambient (running-state guard).
    assert_eq!(r.drive("stop", 1_000), Outcome::Ignored);
    assert_eq!(r.mutations, 0);

    // Open a block; now the metronome runs and rep-mode is live.
    assert!(matches!(
        r.drive("rep block measures 12 to 16 at 60", 2_000),
        Outcome::Acted(Intent::RepOpen(_))
    ));
    assert!(r.metro_running());

    // Same word 'done' now acts as a rep.
    assert!(matches!(
        r.drive("done", 3_000),
        Outcome::Acted(Intent::RepCheck(Verdict::Pass, None))
    ));
    // A bare stop now stops the metronome (it is running).
    assert!(matches!(
        r.drive("stop", 4_000),
        Outcome::Acted(Intent::MetroStop)
    ));
    assert!(!r.metro_running());
    // ...and once stopped, a second bare stop is inert again.
    assert_eq!(r.drive("stop", 5_000), Outcome::Ignored);
}

/// Progressive ASR revision (`Metronome 90` → `Metronome 96` ~213 ms later) is
/// DIFFERENT text, so the identical-text dedup rule does not collapse it: both
/// route and the final settled state is 96. Coalescing progressive hypotheses to
/// a single action needs utterance/delivery identity above the command layer and
/// remains an explicitly OPEN contract item (Lane A/C) — this test pins the
/// current honest behavior rather than pretending it is solved here.
#[test]
fn progressive_revision_settles_to_final_but_collapse_stays_deferred() {
    let init = StateCheckpoint::default();
    let mut r = SessionReplay::new(None, &init);
    assert!(matches!(
        r.drive("Metronome 90", 0),
        Outcome::Acted(Intent::MetroStart(Some(v))) if v == 90.0
    ));
    assert!(matches!(
        r.drive("Metronome 96", 213),
        Outcome::Acted(Intent::MetroStart(Some(v))) if v == 96.0
    ));
    assert_eq!(r.metro_bpm(), 96.0, "final settled tempo");
    assert_eq!(
        r.mutations, 2,
        "both progressive hypotheses act — single-action collapse is deferred to the STT layer"
    );
}
