//! Deterministic **stateful** replay of the real **scherzo1** narrated session
//! (v2 contract Lane A core + Lane D scaffolding) — the largest recording, 721
//! ordered segments over ~91 minutes.
//!
//! Reuses the shared engine in `replay_common` (the same `SessionReplay` that
//! mirrors `voice_loop::ActionCtx::handle_final`: live `Mode`, ambient never seeds
//! the command-dedup ledger, the 2.5 s spurious-final collapse, and the pure
//! `ledger::derive` state machine). It asserts speech routing, engine state, and
//! dedup/gate behavior ONLY — it never reads note-transcription output and never
//! grades piano audio.
//!
//! Honest result (see the fixture's `honesty_note`): all 721 segments — natural
//! narration, ASR-ambiguous colon/lost-hundred numbers, and ~64.8% repeated-Whisper
//! artifacts — route to `Intent::Ignored`. No rep block is ever voice-opened, the
//! metronome never starts, and there are ZERO durable state mutations. Every
//! practice action the contract names for this session is spoken conversationally
//! and requires a confirmed Tier B draft the deterministic hot loop must not
//! auto-fire; leaving them inert is the contract-correct behavior, proven here at
//! 9x griffes' scale.

#[path = "replay_common/mod.rs"]
mod replay_common;

use replay_common::{assert_full_session_replay, load, Classification};

const SCHERZO1: &str = include_str!("fixtures/narrated_session_scherzo1.json");

/// Replay every ordered scherzo1 segment through the stateful harness and assert
/// the routed outcome AND every contract-named checkpoint. The whole-session
/// invariant: the noisiest, longest real session mutates NOTHING.
#[test]
fn scherzo1_session_replays_with_zero_false_mutations() {
    let fx = load(SCHERZO1);
    assert_eq!(fx.schema, "codakiller.narrated_session_replay.v1");
    assert_eq!(fx.session_id, "scherzo1");
    assert_eq!(fx.piece_alias_hint.as_deref(), Some("Scherzo"));
    assert_eq!(
        fx.source_wav_sha256,
        "9d15d0421d1340822f35229f8aab191811f0a6b107bea8b421f37ad4baf6e10f",
        "WAV hash must match the corpus manifest"
    );
    assert!(fx.source_narration_json.ends_with("scherzo1_narration.json"));
    assert!(!fx.honesty_note.trim().is_empty());
    assert_eq!(fx.segment_count, fx.segments.len(), "declared count matches");
    assert_eq!(fx.segments.len(), 721, "scherzo1 has 721 narration segments");

    let replay = assert_full_session_replay(&fx);

    // The whole-session invariant: this 91-minute real session mutates nothing.
    assert_eq!(
        replay.mutations, 0,
        "scherzo1 must produce zero durable state mutations"
    );
    assert!(!replay.block_is_open(), "no block may be left open");
    assert!(!replay.metro_running(), "metronome must never have started");
}

/// Scherzo1's raw transcript contains no genuine hot-loop command and no item that
/// needed the contract's `review` escalation — assert the bucket tally explicitly
/// so a future edit that silently reclassifies (or a routing change that starts
/// firing on this ambient speech) is caught. The counts sum to 721.
#[test]
fn scherzo1_classification_stats_are_honest() {
    let fx = load(SCHERZO1);
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
    assert_eq!(ambient, 695);
    assert_eq!(firewall, 9);
    assert_eq!(asr, 16);
    assert_eq!(correction, 1);
    assert_eq!(
        command, 0,
        "scherzo1 narration produced no genuine deterministic hot-loop command"
    );
    assert_eq!(review, 0, "no scherzo1 segment required review escalation");
    assert_eq!(
        ambient + firewall + asr + command + correction + review,
        721
    );
}
