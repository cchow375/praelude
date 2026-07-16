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

use codakiller_lib::intent::{Intent, MetroSetArgs, Mode, RepOpenSpec, Router, Verdict};
use codakiller_lib::ledger::{self, AttemptRecord, LedgerSummary, MutationSource};
use codakiller_lib::protocol::{AttemptVerdict, MasteryStatus, PracticeContract};
use serde::Deserialize;

/// Mirror of the production command-dedup window (`voice_loop::DEDUP_WINDOW`).
const DEDUP_WINDOW_MS: u64 = 2500;

// ---------------------------------------------------------------------------
// Fixture schema (serde, deny_unknown_fields — every field is adjudicated).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionFixture {
    schema: String,
    session_id: String,
    #[serde(default)]
    piece_alias_hint: Option<String>,
    source_wav_sha256: String,
    source_narration_json: String,
    segment_count: usize,
    #[serde(default)]
    wake_word: Option<String>,
    initial_state: StateCheckpoint,
    honesty_note: String,
    segments: Vec<Segment>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Segment {
    id: String,
    at_ms: u64,
    raw_text: String,
    classification: Classification,
    classification_basis: String,
    expected: Expected,
    #[serde(default)]
    checkpoint: Option<StateCheckpoint>,
}

/// The adjudication taxonomy from the v2 contract. This is documentation /
/// stats metadata; the harness asserts `routed == expected` regardless of the
/// bucket, and the firewall/ASR buckets additionally guard that a buried command
/// token or an ambiguous number never fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Classification {
    /// Pure narration; no command-shaped token.
    AmbientIgnored,
    /// Carries a command-shaped token that a naive matcher might fire on, but the
    /// firewall correctly ignores.
    FirewallRejection,
    /// Colon/clock number forms or multiple guessed numbers that must never
    /// execute (contract "ASR corruption" section).
    AsrAmbiguity,
    /// A genuine hot-loop command that must act and mutate state.
    DeterministicCommand,
    /// An immediate user self-correction.
    Correction,
    /// Genuinely ambiguous under the contract — escalated for human adjudication
    /// rather than silently guessed. Counted and reported; never left implicit.
    Review,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct StateCheckpoint {
    #[serde(default)]
    metro_running: Option<bool>,
    #[serde(default)]
    metro_bpm: Option<f64>,
    #[serde(default)]
    block_active: Option<bool>,
    #[serde(default)]
    attempts_recorded: Option<u32>,
    #[serde(default)]
    current_clean_streak: Option<u32>,
    #[serde(default)]
    mastery: Option<String>,
}

/// The adjudicated expectation for one segment. Mirrors the seed firewall
/// fixture's tagged idiom, extended with `suppressed` (a dedup drop) and the full
/// command surface so the same shape drives the batch slice.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Expected {
    /// Ambient / not a command → no action, no state change.
    Ignored,
    /// A command that is a transport re-send within the dedup window → dropped.
    Suppressed,
    Rep {
        verdict: String,
        #[serde(default)]
        note: Option<String>,
    },
    RepOpen {
        m_start: u32,
        m_end: u32,
        #[serde(default)]
        start_bpm: Option<f64>,
        #[serde(default)]
        target_bpm: Option<f64>,
        #[serde(default)]
        reps: Option<u32>,
    },
    RepStatus,
    RepClose,
    SessionEnd,
    MetroStart {
        #[serde(default)]
        bpm: Option<f64>,
    },
    MetroStop,
    MetroDelta {
        bpm_delta: f64,
    },
    MetroAbs {
        bpm: f64,
    },
    MetroAccent {
        beats_per_bar: u8,
    },
    ScorePage {
        value: u32,
    },
    ScoreMeasure {
        value: u32,
    },
}

impl Expected {
    /// The concrete [`Intent`] a command expectation must route to. `None` for the
    /// non-command outcomes (`ignored`, `suppressed`), which are checked at the
    /// [`Outcome`] level instead.
    fn intent(&self) -> Option<Intent> {
        Some(match self {
            Expected::Ignored | Expected::Suppressed => return None,
            Expected::Rep { verdict, note } => {
                let v = match verdict.as_str() {
                    "pass" => Verdict::Pass,
                    "flawed" => Verdict::Flawed,
                    "fail" => Verdict::Fail,
                    other => panic!("unknown fixture verdict {other:?}"),
                };
                Intent::RepCheck(v, note.clone())
            }
            Expected::RepOpen {
                m_start,
                m_end,
                start_bpm,
                target_bpm,
                reps,
            } => Intent::RepOpen(RepOpenSpec {
                m_start: *m_start,
                m_end: *m_end,
                start_bpm: *start_bpm,
                target_bpm: *target_bpm,
                reps: *reps,
            }),
            Expected::RepStatus => Intent::RepStatus,
            Expected::RepClose => Intent::RepClose,
            Expected::SessionEnd => Intent::SessionEnd,
            Expected::MetroStart { bpm } => Intent::MetroStart(*bpm),
            Expected::MetroStop => Intent::MetroStop,
            Expected::MetroDelta { bpm_delta } => Intent::MetroSet(MetroSetArgs {
                bpm_delta: Some(*bpm_delta),
                bpm_abs: None,
                beats_per_bar: None,
            }),
            Expected::MetroAbs { bpm } => Intent::MetroSet(MetroSetArgs {
                bpm_delta: None,
                bpm_abs: Some(*bpm),
                beats_per_bar: None,
            }),
            Expected::MetroAccent { beats_per_bar } => Intent::MetroSet(MetroSetArgs {
                bpm_delta: None,
                bpm_abs: None,
                beats_per_bar: Some(*beats_per_bar),
            }),
            Expected::ScorePage { value } => Intent::ScorePage(*value),
            Expected::ScoreMeasure { value } => Intent::ScoreMeasure(*value),
        })
    }
}

// ---------------------------------------------------------------------------
// Live replay state — the stateful shell around Router + ledger::derive.
// ---------------------------------------------------------------------------

/// Metronome mirror: only the two fields that feed [`Mode`] and the tempo path.
struct MetroMirror {
    running: bool,
    bpm: f64,
}

/// The one open rep block, holding the pure attempt log the ledger folds.
struct BlockState {
    contract: PracticeContract,
    attempts: Vec<AttemptRecord>,
    next_attempt_id: i64,
    bpm: f64,
}

impl BlockState {
    fn summary(&self) -> LedgerSummary {
        ledger::derive(&self.contract, &self.attempts, &[], 0)
            .expect("attempt ledger derives cleanly")
    }
}

/// What happened to one segment.
#[derive(Debug, PartialEq)]
enum Outcome {
    Ignored,
    Suppressed,
    Acted(Intent),
}

/// The stateful replay engine, reused verbatim by the batch-conversion slice.
struct SessionReplay {
    metro: MetroMirror,
    block: Option<BlockState>,
    wake_word: Option<String>,
    /// (normalized text, at_ms) of the last COMMAND — ambient never seeds it.
    last_command: Option<(String, u64)>,
    /// Count of durable state mutations applied across the session.
    mutations: u32,
}

impl SessionReplay {
    fn new(wake_word: Option<String>, initial: &StateCheckpoint) -> Self {
        SessionReplay {
            metro: MetroMirror {
                running: initial.metro_running.unwrap_or(false),
                bpm: initial.metro_bpm.unwrap_or(60.0),
            },
            block: None,
            wake_word,
            last_command: None,
            mutations: 0,
        }
    }

    fn mode(&self) -> Mode {
        Mode {
            rep_block_active: self.block.is_some(),
            wake_word: self.wake_word.clone(),
            metro_running: self.metro.running,
        }
    }

    /// Drive one utterance through routing → dedup → state mutation, exactly as
    /// `voice_loop::ActionCtx::handle_final` does. Returns the outcome.
    fn drive(&mut self, raw_text: &str, at_ms: u64) -> Outcome {
        let intent = Router::route(raw_text, &self.mode());

        // Ambient takes no action AND does not seed the command dedup ledger.
        if matches!(intent, Intent::Ignored) {
            return Outcome::Ignored;
        }

        // ONE spurious-final dedup rule for every command intent, keyed on the
        // fixture's at_ms (never wall-clock). The stored timestamp slides forward
        // on every occurrence — including a suppressed one — so a chain of
        // re-sends each < window from the last collapses fully.
        let norm: String = raw_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let suppress = self
            .last_command
            .as_ref()
            .is_some_and(|(prev, at)| *prev == norm && at_ms.saturating_sub(*at) < DEDUP_WINDOW_MS);
        self.last_command = Some((norm, at_ms));
        if suppress {
            return Outcome::Suppressed;
        }

        self.apply(&intent);
        Outcome::Acted(intent)
    }

    /// Fold a surviving command's consequence into live state.
    fn apply(&mut self, intent: &Intent) {
        self.mutations += 1;
        match intent {
            Intent::MetroStart(bpm) => {
                self.metro.running = true;
                if let Some(b) = bpm {
                    self.metro.bpm = *b;
                }
            }
            Intent::MetroStop => self.metro.running = false,
            Intent::MetroSet(args) => {
                if let Some(d) = args.bpm_delta {
                    self.metro.bpm = (self.metro.bpm + d).clamp(1.0, 1000.0);
                } else if let Some(v) = args.bpm_abs {
                    self.metro.bpm = v;
                }
                // beats_per_bar leaves tempo unchanged.
            }
            Intent::RepOpen(spec) => {
                // The clean-streak target defaults to the app's 5 (the DB engine's
                // `required_clean_streak` default); `spec.reps` is a planned ceiling,
                // not the mastery streak. Mirrors `act_rep_open` starting the
                // metronome at the block tempo when idle.
                let start = spec.start_bpm.unwrap_or(self.metro.bpm);
                self.block = Some(BlockState {
                    contract: PracticeContract::consecutive_clean(5),
                    attempts: Vec::new(),
                    next_attempt_id: 1,
                    bpm: start,
                });
                if !self.metro.running {
                    self.metro.running = true;
                    self.metro.bpm = start;
                }
            }
            Intent::RepCheck(verdict, note) => {
                if let Some(block) = self.block.as_mut() {
                    let v = match verdict {
                        Verdict::Pass => AttemptVerdict::Clean,
                        Verdict::Flawed => AttemptVerdict::Flawed,
                        Verdict::Fail => AttemptVerdict::Failed,
                    };
                    block.attempts.push(AttemptRecord {
                        id: block.next_attempt_id,
                        verdict: v,
                        bpm: self.metro.running.then_some(block.bpm),
                        note: note.clone(),
                        source: MutationSource::VoiceHotLoop,
                    });
                    block.next_attempt_id += 1;
                }
            }
            Intent::RepClose => self.block = None,
            // RepStatus / SessionEnd / ScorePage / ScoreMeasure / Question are
            // read-only or out-of-scope for durable practice state here.
            _ => {}
        }
    }

    /// Mastery status of the live block, or `NotApplicable` when none is open.
    fn mastery(&self) -> MasteryStatus {
        self.block
            .as_ref()
            .map(|b| b.summary().contract.mastery)
            .unwrap_or(MasteryStatus::NotApplicable)
    }

    fn attempts_recorded(&self) -> u32 {
        self.block.as_ref().map(|b| b.summary().tries).unwrap_or(0)
    }

    fn current_clean_streak(&self) -> u32 {
        self.block
            .as_ref()
            .map(|b| b.summary().current_clean_streak)
            .unwrap_or(0)
    }

    fn assert_checkpoint(&self, cp: &StateCheckpoint, seg_id: &str, text: &str) {
        if let Some(want) = cp.metro_running {
            assert_eq!(
                self.metro.running, want,
                "checkpoint metro_running for {seg_id} {text:?}"
            );
        }
        if let Some(want) = cp.metro_bpm {
            assert_eq!(
                self.metro.bpm, want,
                "checkpoint metro_bpm for {seg_id} {text:?}"
            );
        }
        if let Some(want) = cp.block_active {
            assert_eq!(
                self.block.is_some(),
                want,
                "checkpoint block_active for {seg_id} {text:?}"
            );
        }
        if let Some(want) = cp.attempts_recorded {
            assert_eq!(
                self.attempts_recorded(),
                want,
                "checkpoint attempts_recorded for {seg_id} {text:?}"
            );
        }
        if let Some(want) = cp.current_clean_streak {
            assert_eq!(
                self.current_clean_streak(),
                want,
                "checkpoint current_clean_streak for {seg_id} {text:?}"
            );
        }
        if let Some(want) = &cp.mastery {
            let got = mastery_str(self.mastery());
            assert_eq!(
                got, want,
                "checkpoint mastery for {seg_id} {text:?}"
            );
        }
    }
}

fn mastery_str(m: MasteryStatus) -> &'static str {
    match m {
        MasteryStatus::Satisfied => "satisfied",
        MasteryStatus::NotSatisfied => "not_satisfied",
        MasteryStatus::NotApplicable => "not_applicable",
        MasteryStatus::UnverifiedLegacy => "unverified_legacy",
    }
}

// ---------------------------------------------------------------------------
// Griffes: the proving fixture (79 real ordered segments).
// ---------------------------------------------------------------------------

const GRIFFES: &str = include_str!("fixtures/narrated_session_griffes.json");

fn load(raw: &str) -> SessionFixture {
    serde_json::from_str(raw).expect("session fixture must be valid JSON")
}

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
        fx.source_wav_sha256,
        "48f2780ce73b70bca71783a82890e88a5a29d5a20fab667042a2f16922a1b42b",
        "WAV hash must match the corpus manifest"
    );
    assert!(fx.source_narration_json.ends_with("griffes_narration.json"));
    assert!(!fx.honesty_note.trim().is_empty());
    assert_eq!(fx.segment_count, fx.segments.len(), "declared count matches");
    assert_eq!(fx.segments.len(), 79, "griffes has 79 narration segments");

    let mut replay = SessionReplay::new(fx.wake_word.clone(), &fx.initial_state);
    let mut prev_at: Option<u64> = None;

    for seg in &fx.segments {
        // Fixture timestamps are the ordering anchors; they must be monotonic so
        // the dedup window is meaningful.
        if let Some(prev) = prev_at {
            assert!(
                seg.at_ms >= prev,
                "segment {} out of order: {} < {}",
                seg.id,
                seg.at_ms,
                prev
            );
        }
        prev_at = Some(seg.at_ms);

        let outcome = replay.drive(&seg.raw_text, seg.at_ms);

        match seg.expected.intent() {
            None => {
                let want = match seg.expected {
                    Expected::Suppressed => Outcome::Suppressed,
                    _ => Outcome::Ignored,
                };
                assert_eq!(
                    outcome, want,
                    "segment {} ({}) expected {:?} but routed differently for {:?}",
                    seg.id, seg.classification_basis, want, seg.raw_text
                );
            }
            Some(expected_intent) => {
                assert_eq!(
                    outcome,
                    Outcome::Acted(expected_intent),
                    "segment {} ({}) routed incorrectly for {:?}",
                    seg.id,
                    seg.classification_basis,
                    seg.raw_text
                );
            }
        }

        // Firewall/ASR buckets are a hard regression guard: a buried command token
        // or an ambiguous number must never act.
        if matches!(
            seg.classification,
            Classification::FirewallRejection | Classification::AsrAmbiguity
        ) {
            assert_eq!(
                outcome,
                Outcome::Ignored,
                "segment {} is bucketed {:?} but did not firewall to Ignored: {:?}",
                seg.id,
                seg.classification,
                seg.raw_text
            );
        }

        if let Some(cp) = &seg.checkpoint {
            replay.assert_checkpoint(cp, &seg.id, &seg.raw_text);
        }
    }

    // The whole-session invariant: a pure note-hunting session mutates nothing.
    assert_eq!(
        replay.mutations, 0,
        "griffes must produce zero durable state mutations"
    );
    assert!(replay.block.is_none(), "no block may be left open");
    assert!(!replay.metro.running, "metronome must never have started");
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
    assert!(r.block.is_some(), "block is now open");
    assert!(r.metro.running, "opening starts the metronome");
    assert_eq!(r.metro.bpm, 40.0);

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
        let s = r.block.as_ref().unwrap().summary();
        assert_eq!(s.best_clean_streak, 3);
        assert_eq!(s.reset_count, 1);
        assert_eq!(s.failed, 1);
        assert_eq!(s.clean, 3);
        assert_eq!(s.tries, 4, "4 recorded attempts; 2 re-sends never recorded");
        assert_eq!(s.contract.mastery, MasteryStatus::NotSatisfied);
    }

    // Five consecutive cleans after the reset master the block on the FIFTH — by
    // the declared consecutive-clean(5) contract, not merely attempt count.
    for (i, at) in [30_000, 35_000, 40_000, 45_000, 50_000].into_iter().enumerate() {
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

    let s = r.block.as_ref().unwrap().summary();
    assert_eq!(s.tries, 9, "3 + 1 failed + 5 = 9 recorded attempts");
    assert_eq!(s.clean, 8);
    assert_eq!(s.failed, 1);
    assert_eq!(s.current_clean_streak, 5);
    assert_eq!(s.contract.mastery, MasteryStatus::Satisfied);

    // Mastery does not auto-close; an explicit close ends the block (contract:
    // block completion is explicit).
    assert!(matches!(r.drive("close the block", 55_000), Outcome::Acted(Intent::RepClose)));
    assert!(r.block.is_none());
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
    assert!(r.metro.running);

    // Same word 'done' now acts as a rep.
    assert!(matches!(
        r.drive("done", 3_000),
        Outcome::Acted(Intent::RepCheck(Verdict::Pass, None))
    ));
    // A bare stop now stops the metronome (it is running).
    assert!(matches!(r.drive("stop", 4_000), Outcome::Acted(Intent::MetroStop)));
    assert!(!r.metro.running);
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
    assert_eq!(r.metro.bpm, 96.0, "final settled tempo");
    assert_eq!(
        r.mutations, 2,
        "both progressive hypotheses act — single-action collapse is deferred to the STT layer"
    );
}
