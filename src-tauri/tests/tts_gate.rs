//! Integration tests for the half-duplex gate — the safety invariant that
//! CodaKiller never "hears itself". They drive the real [`Speaker`] worker with a
//! mock provider, a time-modeled fake PCM sink, and a recording gate, asserting
//! the exact ordering:
//!
//!   close gate  →  first sample enqueued  →  (drain)  →  reopen 300±50 ms later.
//!
//! Timing uses short REAL sleeps (the brief allows fake clock OR short real
//! sleeps); the fake sink models the engine's reserve-first `pcm_done` semantics
//! so the drain is a genuine timed event to measure the 300 ms margin against. No
//! audio device, no network, no `hear` process is touched.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use codakiller_lib::tts::{Gate, Pcm, PcmError, PcmSink, Speaker, SpeakerConfig, TtsError, TtsProvider};

// --------------------------------------------------------------------------
// Test doubles
// --------------------------------------------------------------------------

/// A provider that returns a fixed amount of PCM (or an error) and records how
/// many times it was called.
struct MockProvider {
    pcm: Result<Pcm, TtsError>,
    calls: Arc<AtomicUsize>,
}

impl MockProvider {
    fn returning(rate: u32, samples: usize) -> (Box<dyn TtsProvider>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let p = MockProvider {
            pcm: Ok(Pcm {
                rate,
                mono_f32: vec![0.1; samples],
            }),
            calls: calls.clone(),
        };
        (Box::new(p), calls)
    }

    fn failing() -> (Box<dyn TtsProvider>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let p = MockProvider {
            pcm: Err(TtsError::Transport("mock synth failure".into())),
            calls: calls.clone(),
        };
        (Box::new(p), calls)
    }
}

impl TtsProvider for MockProvider {
    fn synth(&self, _text: &str) -> Result<Pcm, TtsError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.pcm.clone()
    }
}

/// Fake sink that models the real engine's reserve-first `pcm_done`: pending rises
/// on enqueue and the audio "plays out" in real time, so `done()` flips true
/// roughly `total_samples / rate` after the FIRST enqueue. Records the instant of
/// the first enqueue and the total samples accepted. Optionally returns backpressure
/// (`QueueFull`) for the first `fail_first` enqueue calls to exercise retry.
struct FakeSink {
    first_enqueue: Mutex<Option<Instant>>,
    total_samples: AtomicUsize,
    enqueue_calls: AtomicUsize,
    fail_first: usize,
}

impl FakeSink {
    fn new(fail_first: usize) -> Arc<FakeSink> {
        Arc::new(FakeSink {
            first_enqueue: Mutex::new(None),
            total_samples: AtomicUsize::new(0),
            enqueue_calls: AtomicUsize::new(0),
            fail_first,
        })
    }
    fn first_enqueue_at(&self) -> Option<Instant> {
        *self.first_enqueue.lock().unwrap()
    }
}

impl PcmSink for FakeSink {
    fn enqueue(&self, samples: &[f32], _src_rate: u32) -> Result<(), PcmError> {
        let call = self.enqueue_calls.fetch_add(1, Ordering::SeqCst);
        if call < self.fail_first {
            return Err(PcmError::QueueFull); // backpressure; caller must retry
        }
        let mut fe = self.first_enqueue.lock().unwrap();
        if fe.is_none() {
            *fe = Some(Instant::now());
        }
        self.total_samples.fetch_add(samples.len(), Ordering::SeqCst);
        Ok(())
    }
    fn done(&self) -> bool {
        match self.first_enqueue_at() {
            None => true, // nothing enqueued yet => vacuously done
            Some(t0) => {
                // 24 kHz sink; play out in real time.
                let n = self.total_samples.load(Ordering::SeqCst);
                let dur = Duration::from_secs_f64(n as f64 / 24_000.0);
                t0.elapsed() >= dur
            }
        }
    }
}

/// A gate that timestamps every open/close so the test can prove ordering.
#[derive(Default)]
struct RecordingGate {
    events: Mutex<Vec<(Instant, bool)>>, // (when, open?)
}

impl RecordingGate {
    fn new() -> Arc<RecordingGate> {
        Arc::new(RecordingGate::default())
    }
    fn events(&self) -> Vec<(Instant, bool)> {
        self.events.lock().unwrap().clone()
    }
}

impl Gate for RecordingGate {
    fn set_gate(&self, open: bool) {
        self.events.lock().unwrap().push((Instant::now(), open));
    }
}

fn test_config() -> SpeakerConfig {
    SpeakerConfig {
        reopen_delay: Duration::from_millis(300),
        poll_interval: Duration::from_millis(2),
        retry_delay: Duration::from_millis(2),
        chunk_samples: 2048,
    }
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

/// THE core safety test. Provider yields 500 ms of PCM (12000 @ 24 kHz). Assert:
///   1. the gate CLOSES before the first sample is enqueued;
///   2. the gate stays closed during the whole drain;
///   3. it reopens 300±50 ms AFTER the sink finished draining.
#[test]
fn gate_closes_before_enqueue_and_reopens_300ms_after_drain() {
    let (provider, _calls) = MockProvider::returning(24_000, 12_000); // 0.5 s
    let sink = FakeSink::new(0);
    let gate = RecordingGate::new();

    let speaker = Speaker::spawn(
        provider,
        sink.clone() as Arc<dyn PcmSink>,
        gate.clone() as Arc<dyn Gate>,
        test_config(),
    );
    speaker.speak_blocking("CodaKiller online").expect("spoke");

    let events = gate.events();
    assert_eq!(events.len(), 2, "exactly one close then one open: {events:?}");
    let (close_at, close_open) = events[0];
    let (open_at, open_open) = events[1];
    assert!(!close_open, "first gate event must be a CLOSE");
    assert!(open_open, "second gate event must be an OPEN");

    // (1) close strictly before the first enqueue.
    let first_enq = sink.first_enqueue_at().expect("something was enqueued");
    assert!(
        close_at <= first_enq,
        "gate must close BEFORE the first sample is enqueued"
    );

    // (2)+(3) reopen lands 300±50 ms after the drain completed. The sink drains
    // ~0.5 s after first enqueue; measure reopen relative to that drain instant.
    let drain_at = first_enq + Duration::from_secs_f64(12_000.0 / 24_000.0);
    let margin = open_at.saturating_duration_since(drain_at);
    assert!(
        (250..=350).contains(&(margin.as_millis() as u64)),
        "gate must reopen 300±50 ms after drain, was {} ms",
        margin.as_millis()
    );
    // And the gate was closed for the full drain: open strictly after drain.
    assert!(open_at > drain_at, "gate stayed closed through the entire drain");

    drop(speaker);
}

/// A synth failure must NOT touch the gate: the mic stays live (never muted) when
/// we could not even produce audio.
#[test]
fn synth_failure_never_touches_the_gate() {
    let (provider, calls) = MockProvider::failing();
    let sink = FakeSink::new(0);
    let gate = RecordingGate::new();

    let speaker = Speaker::spawn(
        provider,
        sink.clone() as Arc<dyn PcmSink>,
        gate.clone() as Arc<dyn Gate>,
        test_config(),
    );
    let err = speaker.speak_blocking("boom").expect_err("synth failed");
    assert!(matches!(err, TtsError::Transport(_)), "got {err:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 1, "provider was called");
    assert!(
        gate.events().is_empty(),
        "gate must be untouched on synth failure (mic stays live): {:?}",
        gate.events()
    );
    assert_eq!(
        sink.total_samples.load(Ordering::SeqCst),
        0,
        "nothing enqueued on synth failure"
    );

    drop(speaker);
}

/// Backpressure: the sink refuses the first several enqueue calls with QueueFull.
/// The worker must RETRY (never drop) so all samples land, and the gate cycle
/// still completes correctly (close before enqueue, one reopen).
#[test]
fn backpressure_is_retried_never_dropped() {
    let total = 6_000usize; // 0.25 s @ 24 kHz, chunked at 2048 => 3 chunks
    let (provider, _calls) = MockProvider::returning(24_000, total);
    let sink = FakeSink::new(5); // fail the first 5 enqueue attempts
    let gate = RecordingGate::new();

    let speaker = Speaker::spawn(
        provider,
        sink.clone() as Arc<dyn PcmSink>,
        gate.clone() as Arc<dyn Gate>,
        test_config(),
    );
    speaker.speak_blocking("retry me").expect("spoke despite backpressure");

    assert_eq!(
        sink.total_samples.load(Ordering::SeqCst),
        total,
        "every sample must eventually be enqueued (retried, not dropped)"
    );
    assert!(
        sink.enqueue_calls.load(Ordering::SeqCst) >= 5 + 3,
        "expected >=5 refused retries plus 3 accepted chunks, got {}",
        sink.enqueue_calls.load(Ordering::SeqCst)
    );
    let events = gate.events();
    assert_eq!(events.len(), 2, "close then open despite backpressure");
    assert!(!events[0].1 && events[1].1, "close then open ordering");
    // Close still precedes the first (successful) enqueue.
    assert!(events[0].0 <= sink.first_enqueue_at().unwrap());

    drop(speaker);
}

/// Two back-to-back `speak` calls must serialize: their gate cycles never
/// interleave, yielding a clean close/open/close/open sequence.
#[test]
fn utterances_serialize_no_interleaved_gate_cycles() {
    let (provider, _calls) = MockProvider::returning(24_000, 2_400); // 0.1 s each
    let sink = FakeSink::new(0);
    let gate = RecordingGate::new();

    let speaker = Speaker::spawn(
        provider,
        sink.clone() as Arc<dyn PcmSink>,
        gate.clone() as Arc<dyn Gate>,
        test_config(),
    );
    speaker.speak("first");
    speaker.speak_blocking("second").expect("second spoke");

    let events = gate.events();
    assert_eq!(events.len(), 4, "two full cycles: {events:?}");
    // Strict close,open,close,open — never two closes in a row.
    let opens: Vec<bool> = events.iter().map(|e| e.1).collect();
    assert_eq!(opens, vec![false, true, false, true], "cycles must not interleave");

    drop(speaker);
}
