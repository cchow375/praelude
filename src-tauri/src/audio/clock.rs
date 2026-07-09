//! Sample-accurate click scheduling.
//!
//! [`ClickClock`] emits [`ClickEvent`]s (accent / beat / subdivision) at exact
//! frame offsets within each audio buffer. Timing is carried in a **fractional
//! sample accumulator** (`next_tick: f64`): the true, un-rounded position of the
//! next tick persists across buffer boundaries, and offsets are floored only when
//! placing an event inside a buffer. Rounding the beat interval per-beat would
//! accumulate drift (audible after an hour of practice); this design does not.

/// Upper bound on subdivisions per beat actually honored by the scheduler.
/// Musically 16 (sixteenth-note subdivisions of a beat) is already extreme; the
/// clamp also caps how many events a single buffer can emit, which keeps the
/// callback's pre-sized event scratch from ever reallocating even under a
/// pathological pattern. At the max clamped tempo (1000 bpm) a beat is
/// `sample_rate*60/1000` frames (2880 at 48 kHz); with 16 subdivisions that is
/// one tick per ~180 frames, so a typical ≤4096-frame buffer emits well under 64
/// events (the scratch capacity).
///
/// Single source of truth: `metronome.rs` clamps user input to this same bound by
/// re-exporting it (via [`crate::audio`]) rather than defining its own copy.
pub const MAX_SUBDIVISION: u8 = 16;

/// Musically-sane bpm bounds honored by the scheduler ([`safe_bpm`]). Also the
/// single source of truth for the metronome's user-facing bpm clamp — `metronome.rs`
/// re-exports these instead of duplicating the literals.
pub const MIN_BPM: f64 = 1.0;
pub const MAX_BPM: f64 = 1000.0;

/// A metronome pattern. All fields are plain data so the whole struct is `Copy`
/// and can be handed to the audio thread lock-free.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClickPattern {
    /// Beats per minute.
    pub bpm: f64,
    /// Beats in a bar (the accent lands on beat 1 of each bar).
    pub beats_per_bar: u8,
    /// Whether beat 1 of the bar is accented.
    pub accent_first: bool,
    /// Subdivisions per beat (1 = quarter notes, 2 = eighths, ...).
    pub subdivision: u8,
}

impl Default for ClickPattern {
    fn default() -> Self {
        ClickPattern {
            bpm: 120.0,
            beats_per_bar: 4,
            accent_first: true,
            subdivision: 1,
        }
    }
}

/// The kind of a scheduled click.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ClickKind {
    /// Beat 1 of a bar (loudest click).
    Accent,
    /// A normal beat.
    Beat,
    /// A subdivision tick between beats.
    Sub,
}

/// A click to voice at `offset_in_buffer` frames into the current buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClickEvent {
    /// Frame offset within the buffer passed to [`ClickClock::next_events`].
    pub offset_in_buffer: usize,
    /// Which click sample to play.
    pub kind: ClickKind,
}

/// Schedules clicks against a fixed sample rate. Pure state machine — no audio
/// device, no allocation on the hot path (see [`ClickClock::next_events_into`]).
pub struct ClickClock {
    sample_rate: f64,
    pattern: ClickPattern,
    /// Pattern to adopt at the next beat boundary (never mid-interval).
    pending: Option<ClickPattern>,
    /// Fractional frames from the current buffer's start to the next tick.
    next_tick: f64,
    /// Cached `sample_rate * 60 / bpm` for the pattern currently in effect.
    samples_per_beat: f64,
    /// Subdivision index of the *next* tick (0 = a beat boundary).
    sub_idx: u8,
    /// Bar-relative index of the next beat boundary (0 = beat 1 = accent).
    beat_in_bar: u8,
}

/// Clamp `bpm` to a positive, finite, musically-sane range so `samples_per_beat`
/// is always a finite value > 0. Without this, `bpm <= 0`, `NaN`, or `+inf` would
/// yield a zero/negative/NaN beat interval and **stall the scheduler loop
/// forever** — a hang inside the real-time callback. The UI constrains bpm, but a
/// frozen audio thread is catastrophic, so the engine never trusts the input.
fn safe_bpm(bpm: f64) -> f64 {
    if bpm.is_finite() {
        bpm.clamp(MIN_BPM, MAX_BPM)
    } else {
        ClickPattern::default().bpm
    }
}

impl ClickClock {
    /// Create a clock at `sample_rate` Hz with a default (120 bpm, 4/4) pattern.
    pub fn new(sample_rate: u32) -> Self {
        let pattern = ClickPattern::default();
        ClickClock {
            sample_rate: sample_rate as f64,
            pattern,
            pending: None,
            next_tick: 0.0,
            samples_per_beat: sample_rate as f64 * 60.0 / safe_bpm(pattern.bpm),
            sub_idx: 0,
            beat_in_bar: 0,
        }
    }

    /// Queue a pattern change. It takes effect at the **next beat boundary**, so
    /// the current interval always completes at the old tempo (test (b)).
    pub fn set_pattern(&mut self, pattern: ClickPattern) {
        self.pending = Some(pattern);
    }

    /// Allocating convenience wrapper around [`Self::next_events_into`]. Used by
    /// tests; the real-time callback uses the `_into` form to avoid allocating.
    pub fn next_events(&mut self, frames: usize) -> Vec<ClickEvent> {
        let mut out = Vec::new();
        self.next_events_into(frames, &mut out);
        out
    }

    /// Emit all clicks that fall within the next `frames` frames into `out`
    /// (cleared first). Advances the accumulator by exactly `frames`.
    pub fn next_events_into(&mut self, frames: usize, out: &mut Vec<ClickEvent>) {
        out.clear();
        let n = frames as f64;
        while self.next_tick < n {
            // `next_tick < n` guarantees the floor is a valid in-buffer offset.
            let offset = self.next_tick.floor() as usize;
            let kind = if self.sub_idx == 0 {
                // Beat boundary: adopt any queued pattern *here* (never mid-
                // interval) and recompute the beat length from the live tempo.
                if let Some(p) = self.pending.take() {
                    self.pattern = p;
                }
                self.samples_per_beat = self.sample_rate * 60.0 / safe_bpm(self.pattern.bpm);
                if self.pattern.accent_first && self.beat_in_bar == 0 {
                    ClickKind::Accent
                } else {
                    ClickKind::Beat
                }
            } else {
                ClickKind::Sub
            };
            out.push(ClickEvent {
                offset_in_buffer: offset,
                kind,
            });

            // Advance to the next subdivision tick. The fractional remainder in
            // `next_tick` is preserved — never rounded — so beats never drift.
            let sub = self.pattern.subdivision.clamp(1, MAX_SUBDIVISION);
            self.next_tick += self.samples_per_beat / sub as f64;
            self.sub_idx += 1;
            if self.sub_idx >= sub {
                self.sub_idx = 0;
                self.beat_in_bar = (self.beat_in_bar + 1) % self.pattern.beats_per_bar.max(1);
            }
        }
        // Carry the accumulator into the next buffer. `next_tick >= n` on loop
        // exit, so this stays non-negative.
        self.next_tick -= n;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive the clock over many fixed-size buffers and collect the global frame
    /// index (buffer_start + offset) of every non-sub click.
    fn run_beats(clock: &mut ClickClock, buffers: usize, frames: usize) -> Vec<(usize, ClickKind)> {
        let mut hits = Vec::new();
        for b in 0..buffers {
            let base = b * frames;
            for ev in clock.next_events(frames) {
                hits.push((base + ev.offset_in_buffer, ev.kind));
            }
        }
        hits
    }

    // (a) Zero drift across buffer boundaries: at 120 bpm / 44100 Hz beats are
    //     exactly 22050 frames apart even though 22050 is not a multiple of 512.
    #[test]
    fn beat_spacing_is_exact_across_buffer_boundaries() {
        let mut clock = ClickClock::new(44100);
        clock.set_pattern(ClickPattern {
            bpm: 120.0,
            beats_per_bar: 4,
            accent_first: true,
            subdivision: 1,
        });
        let hits = run_beats(&mut clock, 200, 512); // 200*512 = 102400 frames
        let positions: Vec<usize> = hits.iter().map(|(p, _)| *p).collect();
        assert_eq!(
            &positions[..5],
            &[0, 22050, 44100, 66150, 88200],
            "beats must land on exact 22050-frame multiples"
        );
        for w in positions.windows(2) {
            assert_eq!(w[1] - w[0], 22050, "no drift: every gap is exactly 22050");
        }
    }

    // Longevity / non-integer-bpm drift regression. 137 bpm at 48 kHz gives a
    // beat interval of 21021.8978... frames — deliberately NOT an integer, so
    // any per-beat rounding would accumulate. Run ≥10 simulated minutes of
    // 512-frame buffers and assert the absolute error of every beat position vs
    // the ideal `i * samples_per_beat` stays under one frame AND does not grow
    // across the run (the core product property: no audible drift after long
    // practice). This test must live in the tree, not in a story.
    #[test]
    fn no_drift_at_non_integer_bpm_over_ten_minutes() {
        let sample_rate = 48_000u32;
        let bpm = 137.0;
        let frames = 512usize;
        let spb = sample_rate as f64 * 60.0 / bpm; // 21021.8978...
        assert!(spb.fract() != 0.0, "test only meaningful for non-integer spb");

        let mut clock = ClickClock::new(sample_rate);
        clock.set_pattern(ClickPattern {
            bpm,
            beats_per_bar: 4,
            accent_first: true,
            subdivision: 1,
        });

        // ≥10 minutes of audio.
        let total_frames = sample_rate as usize * 600;
        let buffers = total_frames / frames; // 56_250

        let mut positions: Vec<usize> = Vec::new();
        let mut scratch: Vec<ClickEvent> = Vec::new();
        for b in 0..buffers {
            let base = b * frames;
            clock.next_events_into(frames, &mut scratch);
            for ev in &scratch {
                positions.push(base + ev.offset_in_buffer);
            }
        }

        assert!(positions.len() > 1350, "≈{} beats expected over 10 min", positions.len());
        assert_eq!(positions[0], 0, "first beat at frame 0");

        let mut max_abs_err = 0.0f64;
        for (i, &pos) in positions.iter().enumerate() {
            let ideal = i as f64 * spb;
            let err = (pos as f64 - ideal).abs();
            if err > max_abs_err {
                max_abs_err = err;
            }
            // Bounded: never off by a whole frame, at ANY point in the run — a
            // growing error would blow past this well before 10 minutes.
            assert!(
                err < 1.0,
                "beat {i} at frame {pos} drifted {err} frames from ideal {ideal}"
            );
        }
        // Every inter-beat gap is the floor or ceil of spb (21021 or 21022) —
        // never a value that would betray accumulation.
        for w in positions.windows(2) {
            let gap = w[1] - w[0];
            assert!(
                gap == spb.floor() as usize || gap == spb.ceil() as usize,
                "gap {gap} must be floor/ceil of {spb}"
            );
        }
        // Non-growing: the worst error is a sub-frame floor artifact, not drift.
        assert!(max_abs_err < 1.0, "max abs error {max_abs_err} must stay sub-frame");
    }

    // (b) A bpm change applies at the next beat, never mid-interval.
    #[test]
    fn bpm_change_applies_at_next_beat() {
        let mut clock = ClickClock::new(44100);
        clock.set_pattern(ClickPattern {
            bpm: 120.0, // 22050 frames/beat
            beats_per_bar: 4,
            accent_first: false,
            subdivision: 1,
        });
        let frames = 512;
        let mut positions = Vec::new();
        for b in 0..300 {
            let base = b * frames;
            // Switch to 60 bpm (44100 frames/beat) partway through the first
            // interval — well before the beat at frame 22050.
            if b == 20 {
                clock.set_pattern(ClickPattern {
                    bpm: 60.0,
                    beats_per_bar: 4,
                    accent_first: false,
                    subdivision: 1,
                });
            }
            for ev in clock.next_events(frames) {
                positions.push(base + ev.offset_in_buffer);
            }
        }
        // Beat 0 at 0, beat 1 still at 22050 (old tempo — change was mid-interval),
        // then 60 bpm spacing (44100) from there on.
        assert_eq!(positions[0], 0);
        assert_eq!(positions[1], 22050, "the in-progress interval keeps old tempo");
        assert_eq!(positions[2] - positions[1], 44100, "new tempo starts next beat");
        assert_eq!(positions[3] - positions[2], 44100);
    }

    // (c) subdivision = 2 emits a Sub exactly halfway between beats.
    #[test]
    fn subdivision_two_emits_sub_at_midpoint() {
        let mut clock = ClickClock::new(44100);
        clock.set_pattern(ClickPattern {
            bpm: 120.0, // beat = 22050, half = 11025
            beats_per_bar: 4,
            accent_first: false,
            subdivision: 2,
        });
        let hits = run_beats(&mut clock, 200, 512);
        // Expect alternating Beat, Sub, Beat, Sub, ... at 0, 11025, 22050, 33075...
        assert_eq!(hits[0], (0, ClickKind::Beat));
        assert_eq!(hits[1], (11025, ClickKind::Sub));
        assert_eq!(hits[2], (22050, ClickKind::Beat));
        assert_eq!(hits[3], (33075, ClickKind::Sub));
        assert_eq!(hits[4], (44100, ClickKind::Beat));
    }

    // Degenerate tempos must never stall the scheduler loop (a hang here would
    // freeze the audio callback). +inf/NaN/<=0 bpm are clamped to a safe value.
    #[test]
    fn degenerate_bpm_never_hangs() {
        for bad in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN, 0.0, -120.0] {
            let mut clock = ClickClock::new(44100);
            clock.set_pattern(ClickPattern {
                bpm: bad,
                beats_per_bar: 4,
                accent_first: true,
                subdivision: 1,
            });
            // Would loop forever pre-fix; must terminate and stay in-range.
            for _ in 0..50 {
                for ev in clock.next_events(512) {
                    assert!(ev.offset_in_buffer < 512, "offset must stay in buffer");
                }
            }
        }
    }

    // (d) With accent_first and beats_per_bar = 4, the accent lands on beat 1 of
    //     each bar and nowhere else.
    #[test]
    fn accent_lands_on_beat_one_of_each_bar() {
        let mut clock = ClickClock::new(44100);
        clock.set_pattern(ClickPattern {
            bpm: 120.0,
            beats_per_bar: 4,
            accent_first: true,
            subdivision: 1,
        });
        let hits = run_beats(&mut clock, 800, 512); // enough for ~2 bars
        let kinds: Vec<ClickKind> = hits.iter().take(8).map(|(_, k)| *k).collect();
        use ClickKind::*;
        assert_eq!(
            kinds,
            vec![Accent, Beat, Beat, Beat, Accent, Beat, Beat, Beat],
            "accent only on beat 1 of each 4-beat bar"
        );
    }
}
