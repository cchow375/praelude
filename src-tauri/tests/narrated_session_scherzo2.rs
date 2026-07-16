//! Deterministic **stateful** narrated-session replay — scherzo2 (contract Lane D
//! "Scherzo 2": next-day consolidation).
//!
//! Thin per-session file: it reuses the shared `replay_common` engine (fixture
//! schema, `SessionReplay`, `assert_full_session_replay`) and only pins the
//! scherzo2 header + the honest whole-session invariant. See
//! `narrated_session_replay.rs` for the engine's contract and self-proof.
//!
//! Empirical result: replayed through the real deterministic router, scherzo2's
//! 201 ordered segments are entirely meta-narration + verbose ASR. NO segment is a
//! clean hot-loop command, so — exactly like griffes — the session produces ZERO
//! durable mutations, and every contract-named scherzo2 moment firewalls to
//! `ignored`. Failures name the segment id + verbatim text.

#[path = "replay_common/mod.rs"]
mod replay_common;

use replay_common::{assert_full_session_replay, load, Classification};

const SCHERZO2: &str = include_str!("fixtures/narrated_session_scherzo2.json");

/// Replay every ordered scherzo2 segment through the stateful harness and assert
/// the routed outcome AND the state checkpoints. The Lane A/D claim on this real
/// session: 201 consecutive next-day-consolidation segments produce ZERO durable
/// mutations, and every buried/ambiguous command token is firewalled.
#[test]
fn scherzo2_session_replays_with_zero_false_mutations() {
    let fx = load(SCHERZO2);
    assert_eq!(fx.schema, "codakiller.narrated_session_replay.v1");
    assert_eq!(fx.session_id, "scherzo2");
    assert_eq!(fx.piece_alias_hint.as_deref(), Some("Scherzo"));
    assert_eq!(
        fx.source_wav_sha256,
        "9b6a44ee71d994b8e68a1c0c705bbfa225015d2ceb5cd5c5b32179b47ed918c0",
        "WAV hash must match the corpus manifest"
    );
    assert!(fx.source_narration_json.ends_with("scherzo2_narration.json"));
    assert!(!fx.honesty_note.trim().is_empty());
    assert_eq!(fx.segment_count, fx.segments.len(), "declared count matches");
    assert_eq!(fx.segments.len(), 201, "scherzo2 has 201 narration segments");

    let replay = assert_full_session_replay(&fx);

    // The whole-session invariant: a pure meta-narration session mutates nothing.
    assert_eq!(
        replay.mutations, 0,
        "scherzo2 must produce zero durable state mutations"
    );
    assert!(!replay.block_is_open(), "no block may be left open");
    assert!(!replay.metro_running(), "metronome must never have started");
}

/// scherzo2 contains no genuine hot-loop command; the honest bucket tally is
/// pinned so a future edit that silently reclassifies a segment (or invents a
/// phantom command) is caught. `review` (> 0) records the contract-required
/// Tier B/C behaviors the pure deterministic router cannot reach.
#[test]
fn scherzo2_classification_stats_are_honest() {
    let fx = load(SCHERZO2);
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
    assert_eq!(ambient, 175);
    assert_eq!(firewall, 18);
    assert_eq!(asr, 4);
    assert_eq!(correction, 1);
    assert_eq!(
        command, 0,
        "scherzo2 meta-narration produced no genuine hot-loop command"
    );
    assert_eq!(review, 3, "three contract-required Tier B/C moments escalated");
    assert_eq!(ambient + firewall + asr + command + correction + review, 201);
}
