//! Deterministic voice-firewall replay over compact, manually adjudicated
//! excerpts from Christian's narrated practice corpus.
//!
//! This test feeds transcript text and state into the pure intent router. It
//! never reads note-transcription output and never grades piano audio.

use praelude_lib::intent::{Intent, MetroSetArgs, Mode, RepOpenSpec, Router, Verdict};
use serde::Deserialize;

const FIXTURE: &str = include_str!("fixtures/narrated_voice_firewall.json");

#[derive(Debug, Deserialize)]
struct Contract {
    status: String,
    cases: Vec<Case>,
    deferred_delivery_observations: Vec<DeferredDeliveryObservation>,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    source: String,
    text: String,
    mode: String,
    expected: Expected,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Expected {
    Ignored,
    Rep {
        verdict: String,
        note: Option<String>,
    },
    RepOpen {
        m_start: u32,
        m_end: u32,
        start_bpm: Option<f64>,
        target_bpm: Option<f64>,
        reps: Option<u32>,
    },
    MetroStart {
        bpm: Option<f64>,
    },
    MetroDelta {
        bpm_delta: f64,
    },
    ScoreMeasure {
        value: u32,
    },
}

#[derive(Debug, Deserialize)]
struct DeferredDeliveryObservation {
    id: String,
    source: String,
    mode: String,
    events: Vec<ObservedDelivery>,
    required_action_count: usize,
    required_final: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct ObservedDelivery {
    at_ms: u64,
    text: String,
}

fn contract() -> Contract {
    serde_json::from_str(FIXTURE).expect("narrated firewall fixture must be valid JSON")
}

fn mode(name: &str) -> Mode {
    match name {
        "idle" => Mode::default(),
        "running" => Mode {
            metro_running: true,
            ..Mode::default()
        },
        "rep" => Mode {
            rep_block_active: true,
            ..Mode::default()
        },
        "rep_running" => Mode {
            rep_block_active: true,
            metro_running: true,
            ..Mode::default()
        },
        other => panic!("unknown fixture mode {other:?}"),
    }
}

fn expected_intent(expected: Expected) -> Intent {
    match expected {
        Expected::Ignored => Intent::Ignored,
        Expected::Rep { verdict, note } => {
            let verdict = match verdict.as_str() {
                "pass" => Verdict::Pass,
                "flawed" => Verdict::Flawed,
                "fail" => Verdict::Fail,
                other => panic!("unknown fixture verdict {other:?}"),
            };
            Intent::RepCheck(verdict, note)
        }
        Expected::RepOpen {
            m_start,
            m_end,
            start_bpm,
            target_bpm,
            reps,
        } => Intent::RepOpen(RepOpenSpec {
            m_start,
            m_end,
            start_bpm,
            target_bpm,
            reps,
        }),
        Expected::MetroStart { bpm } => Intent::MetroStart(bpm),
        Expected::MetroDelta { bpm_delta } => Intent::MetroSet(MetroSetArgs {
            bpm_delta: Some(bpm_delta),
            bpm_abs: None,
            beats_per_bar: None,
        }),
        Expected::ScoreMeasure { value } => Intent::ScoreMeasure(value),
    }
}

#[test]
fn narrated_transcripts_match_the_firewall_contract() {
    let contract = contract();
    assert_eq!(
        contract.status, "contract_planned_first_firewall_gate",
        "fixture status must stay honest"
    );

    for case in contract.cases {
        let got = Router::route(&case.text, &mode(&case.mode));
        let expected = expected_intent(case.expected);
        assert_eq!(
            got, expected,
            "fixture {} from {} routed incorrectly for transcript {:?}",
            case.id, case.source, case.text
        );
    }
}

#[test]
fn delivery_identity_observations_remain_explicitly_deferred() {
    let contract = contract();
    assert_eq!(
        contract.deferred_delivery_observations.len(),
        2,
        "both observed delivery hazards must remain represented"
    );

    for observation in contract.deferred_delivery_observations {
        assert!(
            observation.events.len() >= 2,
            "{} ({}) must retain the observed event sequence",
            observation.id,
            observation.source
        );
        assert_eq!(
            observation.required_action_count, 1,
            "{} must eventually collapse to one action",
            observation.id
        );
        assert!(!observation.required_final.trim().is_empty());
        assert!(!observation.reason.trim().is_empty());
        assert!(
            observation
                .events
                .windows(2)
                .all(|pair| pair[0].at_ms < pair[1].at_ms),
            "{} timestamps must remain ordered",
            observation.id
        );

        // The pure router should continue to recognize every observation as a
        // genuine command. Coalescing progressive/re-sent delivery is explicitly
        // deferred to the STT/voice layer, which has utterance timing/identity.
        for event in observation.events {
            let routed = Router::route(&event.text, &mode(&observation.mode));
            assert!(
                !matches!(routed, Intent::Ignored),
                "{} must not solve delivery dedup by killing the command {:?}",
                observation.id,
                event.text
            );
        }
    }
}
