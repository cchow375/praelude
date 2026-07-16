//! Shared narrated-session replay engine (v2 contract Lane A core + Lane D
//! scaffolding), extracted from `narrated_session_replay.rs` so future
//! per-session test files can reuse it without duplicating code.
//!
//! Per-session test files (narrated_session_scherzo1.rs etc.) should declare the
//! same `#[path]` mod and call the shared runner with their fixture path.
#![allow(dead_code)]

use codakiller_lib::intent::{Intent, MetroSetArgs, Mode, RepOpenSpec, Router, Verdict};
use codakiller_lib::ledger::{self, AttemptRecord, LedgerSummary, MutationSource};
use codakiller_lib::protocol::{AttemptVerdict, MasteryStatus, PracticeContract};
use serde::Deserialize;

/// Mirror of the production command-dedup window (`voice_loop::DEDUP_WINDOW`).
pub const DEDUP_WINDOW_MS: u64 = 2500;

// ---------------------------------------------------------------------------
// Fixture schema (serde, deny_unknown_fields — every field is adjudicated).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionFixture {
    pub schema: String,
    pub session_id: String,
    #[serde(default)]
    pub piece_alias_hint: Option<String>,
    pub source_wav_sha256: String,
    pub source_narration_json: String,
    pub segment_count: usize,
    #[serde(default)]
    pub wake_word: Option<String>,
    pub initial_state: StateCheckpoint,
    pub honesty_note: String,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Segment {
    pub id: String,
    pub at_ms: u64,
    pub raw_text: String,
    pub classification: Classification,
    pub classification_basis: String,
    pub expected: Expected,
    #[serde(default)]
    pub checkpoint: Option<StateCheckpoint>,
}

/// The adjudication taxonomy from the v2 contract. This is documentation /
/// stats metadata; the harness asserts `routed == expected` regardless of the
/// bucket, and the firewall/ASR buckets additionally guard that a buried command
/// token or an ambiguous number never fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
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
pub struct StateCheckpoint {
    #[serde(default)]
    pub metro_running: Option<bool>,
    #[serde(default)]
    pub metro_bpm: Option<f64>,
    #[serde(default)]
    pub block_active: Option<bool>,
    #[serde(default)]
    pub attempts_recorded: Option<u32>,
    #[serde(default)]
    pub current_clean_streak: Option<u32>,
    #[serde(default)]
    pub mastery: Option<String>,
}

/// The adjudicated expectation for one segment. Mirrors the seed firewall
/// fixture's tagged idiom, extended with `suppressed` (a dedup drop) and the full
/// command surface so the same shape drives the batch slice.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Expected {
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
    pub fn intent(&self) -> Option<Intent> {
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
pub enum Outcome {
    Ignored,
    Suppressed,
    Acted(Intent),
}

/// The stateful replay engine, reused verbatim by the batch-conversion slice.
pub struct SessionReplay {
    metro: MetroMirror,
    block: Option<BlockState>,
    wake_word: Option<String>,
    /// (normalized text, at_ms) of the last COMMAND — ambient never seeds it.
    last_command: Option<(String, u64)>,
    /// Count of durable state mutations applied across the session.
    pub mutations: u32,
}

impl SessionReplay {
    pub fn new(wake_word: Option<String>, initial: &StateCheckpoint) -> Self {
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
    pub fn drive(&mut self, raw_text: &str, at_ms: u64) -> Outcome {
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
    pub fn mastery(&self) -> MasteryStatus {
        self.block
            .as_ref()
            .map(|b| b.summary().contract.mastery)
            .unwrap_or(MasteryStatus::NotApplicable)
    }

    pub fn attempts_recorded(&self) -> u32 {
        self.block.as_ref().map(|b| b.summary().tries).unwrap_or(0)
    }

    pub fn current_clean_streak(&self) -> u32 {
        self.block
            .as_ref()
            .map(|b| b.summary().current_clean_streak)
            .unwrap_or(0)
    }

    pub fn block_is_open(&self) -> bool {
        self.block.is_some()
    }

    /// The live block's full ledger summary, or `None` when no block is open.
    /// Exposed for tests that need finer-grained fields (streak resets,
    /// clean/failed counts, mastery) than the convenience accessors provide.
    pub fn block_summary(&self) -> Option<LedgerSummary> {
        self.block.as_ref().map(|b| b.summary())
    }

    pub fn metro_running(&self) -> bool {
        self.metro.running
    }

    pub fn metro_bpm(&self) -> f64 {
        self.metro.bpm
    }

    pub fn assert_checkpoint(&self, cp: &StateCheckpoint, seg_id: &str, text: &str) {
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

pub fn mastery_str(m: MasteryStatus) -> &'static str {
    match m {
        MasteryStatus::Satisfied => "satisfied",
        MasteryStatus::NotSatisfied => "not_satisfied",
        MasteryStatus::NotApplicable => "not_applicable",
        MasteryStatus::UnverifiedLegacy => "unverified_legacy",
    }
}

pub fn load(raw: &str) -> SessionFixture {
    serde_json::from_str(raw).expect("session fixture must be valid JSON")
}

/// Replay every ordered segment of a fixture through the stateful harness and
/// assert the routed outcome AND the state checkpoints against `expected`.
/// Shared by every per-session test file; callers pass their own fixture
/// contents and expected segment count so failures still name the right file.
pub fn assert_full_session_replay(fx: &SessionFixture) -> SessionReplay {
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

    replay
}
