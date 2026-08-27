//! Deterministic **stateful** narrated-session replay — real `scherzo3` (308
//! ordered segments), a companion to `narrated_session_replay.rs` (griffes).
//!
//! Scherzo3 is a dense practice session, but it is META-NARRATION: Christian
//! describing to the future coach how it should behave while he plays. He never
//! issues a clean hot-loop command, so the deterministic firewall correctly routes
//! ALL 308 segments to `ignored` with ZERO durable mutation — while resisting a
//! thick stream of BURIED command tokens ("turn my metronome on", "quarter note
//! 55", "tempo 55", "Start, 473", leading "Metronome right now", "stop myself",
//! "play measures 468"), ASR measure-confusion ("446, 468"), self-corrections, and
//! every contract-named Scherzo3 moment (all Tier B/C, correctly not hot-looped).
//!
//! The reusable engine (fixture schema, `SessionReplay`, loader, full-session
//! assertion runner) lives in `replay_common`; this file is intentionally thin.

#[path = "replay_common/mod.rs"]
mod replay_common;

use replay_common::{assert_full_session_replay, load, Classification};

const SCHERZO3: &str = include_str!("fixtures/narrated_session_scherzo3.json");

/// Replay every ordered scherzo3 segment through the stateful harness and assert
/// the routed outcome AND the state checkpoints. The Lane A claim on a second real
/// session: 308 consecutive practice-narration segments produce ZERO durable
/// mutations, every buried/ambiguous command token is firewalled, and the honest
/// bucket tally is pinned so a future edit that silently reclassifies a segment (or
/// admits a false mutation) is caught.
#[test]
fn scherzo3_session_replays_with_zero_false_mutations() {
    let fx = load(SCHERZO3);
    assert_eq!(fx.schema, "codakiller.narrated_session_replay.v1");
    assert_eq!(fx.session_id, "scherzo3");
    assert_eq!(fx.piece_alias_hint.as_deref(), Some("Scherzo"));
    assert_eq!(
        fx.source_wav_sha256, "03b294f5a2c57e23eb06c4122f3799c7697abbc9abbd767e509231b7df21de63",
        "WAV hash must match the corpus manifest"
    );
    assert!(fx
        .source_narration_json
        .ends_with("scherzo3_narration.json"));
    assert!(!fx.honesty_note.trim().is_empty());
    assert_eq!(
        fx.segment_count,
        fx.segments.len(),
        "declared count matches"
    );
    assert_eq!(
        fx.segments.len(),
        308,
        "scherzo3 has 308 narration segments"
    );

    // Honest bucket tally (documentation metadata; the runner asserts the routed
    // outcome regardless). Every segment carries a non-empty adjudication basis.
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
    assert_eq!(ambient, 283);
    assert_eq!(firewall, 13);
    assert_eq!(asr, 1);
    assert_eq!(correction, 8);
    assert_eq!(
        command, 0,
        "scherzo3 meta-narration issues no clean hot-loop command"
    );
    assert_eq!(
        review, 3,
        "three genuinely ambiguous items escalated, not guessed"
    );
    assert_eq!(
        ambient + firewall + asr + command + correction + review,
        308
    );

    let replay = assert_full_session_replay(&fx);

    // The whole-session invariant: a pure practice-narration session mutates nothing.
    assert_eq!(
        replay.mutations, 0,
        "scherzo3 must produce zero durable state mutations"
    );
    assert!(!replay.block_is_open(), "no block may be left open");
    assert!(!replay.metro_running(), "metronome must never have started");
}
