//! The ack chime: a short pre-rendered blip that stands in for a spoken
//! confirmation on routine commands.
//!
//! # Why a chime at all
//!
//! Christian, July 31: the metronome felt "delayed by 5 seconds". A third of
//! that was the settler's quiet gap (fixed by the voice loop's fast path); the
//! rest is the ack itself. A spoken "Ninety-six." costs a synthesis round trip
//! plus ~1.2 s of playback plus the 300 ms acoustic tail before the mic reopens —
//! per command, for information the UI is already showing. A 120 ms blip closes
//! the same gate cycle in a fraction of the time and does not talk over practice.
//!
//! Speech is not gone; it is *reserved*. See `voice_loop`'s ack-policy docs for
//! the exact split — anything carrying words a chime cannot spell (an error, a
//! rung announcement, a set completion, an assistant answer) still speaks.
//!
//! # Why generated, not an asset
//!
//! The click WAVs under `assets/clicks/` are authored percussion, and the ack has
//! to be *unmistakably not a click* — the whole point is that the pianist can tell
//! "I heard you" apart from "here is beat one". Generating it here gives us that
//! separation for free: a pitched, slowly-decaying two-partial tone against the
//! clicks' broadband transients. It also keeps the app self-contained (no new
//! asset to ship, load, or fail to find) and costs one 120 ms buffer, computed
//! once per process.
//!
//! # Shape
//!
//! Two sine partials a fifth apart (1200 Hz + 1800 Hz at a third the amplitude)
//! under an exponential decay, with a 4 ms raised-cosine attack and a 6 ms fade to
//! zero at the tail. The envelope's job is entirely anti-click: a buffer that
//! starts or ends on a non-zero sample produces a broadband pop through the
//! mixer, which is exactly the sound we are trying not to make.

use std::sync::OnceLock;

/// Sample rate the chime is rendered at. The engine resamples on enqueue
/// (`super::resample_linear_into`), so this only has to be high enough not to
/// alias the top partial — it is not tied to the output device.
pub const CHIME_RATE: u32 = 48_000;

/// Total length. Long enough to read as a deliberate tone, short enough that the
/// half-duplex gate cycle it drives is over almost as soon as it began.
const CHIME_MS: f32 = 120.0;

/// Lower partial (Hz) and the fifth above it. Well clear of a piano's
/// fundamental register so the ack sits on top of playing rather than inside it.
const PARTIAL_HZ: [f32; 2] = [1200.0, 1800.0];
const PARTIAL_GAIN: [f32; 2] = [1.0, 0.33];

/// Amplitude decay time constant (seconds): the tone is down ~50 dB by the end.
const DECAY_TAU_S: f32 = 0.030;

/// Peak amplitude. Deliberately below the click samples' near-full-scale
/// authoring (see `mixer::load_clicks`) — an acknowledgement should never be the
/// loudest thing in the room.
const PEAK: f32 = 0.30;

const ATTACK_MS: f32 = 4.0;
const RELEASE_MS: f32 = 6.0;

/// The rendered ack chime, mono f32 at [`CHIME_RATE`]. Computed on first use and
/// then shared: the voice loop plays the same slice for every ack, so there is no
/// per-command allocation on the hot path.
pub fn ack_chime() -> &'static [f32] {
    static CHIME: OnceLock<Vec<f32>> = OnceLock::new();
    CHIME.get_or_init(|| render(CHIME_RATE))
}

/// Render the chime at `rate`. Split out from [`ack_chime`] so the tests can
/// check the envelope's endpoints at a rate of their choosing.
fn render(rate: u32) -> Vec<f32> {
    let rate_f = rate as f32;
    let len = ((CHIME_MS / 1000.0) * rate_f).round() as usize;
    let attack = ((ATTACK_MS / 1000.0) * rate_f).round().max(1.0) as usize;
    let release = ((RELEASE_MS / 1000.0) * rate_f).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let t = i as f32 / rate_f;
        let mut sample = 0.0;
        for (hz, gain) in PARTIAL_HZ.iter().zip(PARTIAL_GAIN.iter()) {
            sample += gain * (std::f32::consts::TAU * hz * t).sin();
        }
        // Normalize by the summed partial gains so PEAK really is the peak.
        sample /= PARTIAL_GAIN.iter().sum::<f32>();
        let mut env = (-t / DECAY_TAU_S).exp();
        // Raised-cosine attack, then a linear fade over the final samples. Both
        // exist only so the buffer begins and ends exactly at zero.
        if i < attack {
            let x = i as f32 / attack as f32;
            env *= 0.5 - 0.5 * (std::f32::consts::PI * x).cos();
        }
        let from_end = len - i;
        if from_end <= release {
            env *= (from_end - 1) as f32 / release as f32;
        }
        out.push(PEAK * env * sample);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chime_is_short_bounded_and_click_free() {
        let chime = ack_chime();
        // ~120 ms at the render rate, give or take rounding.
        let expected = ((CHIME_MS / 1000.0) * CHIME_RATE as f32).round() as usize;
        assert_eq!(chime.len(), expected, "120 ms at {CHIME_RATE} Hz");

        // Never louder than the peak we chose (headroom against the clicks).
        let peak = chime.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak <= PEAK + 1e-6, "peak {peak} exceeds {PEAK}");
        assert!(peak > PEAK * 0.5, "peak {peak} is implausibly quiet");

        // Endpoints at zero: a non-zero first/last sample pops through the mixer.
        assert_eq!(chime[0], 0.0, "starts at silence");
        assert_eq!(chime[chime.len() - 1], 0.0, "ends at silence");
    }

    #[test]
    fn chime_decays_rather_than_sustains() {
        let chime = ack_chime();
        // Compare the energy of the first quarter against the last quarter: the
        // exponential envelope should leave the tail far quieter than the head.
        let quarter = chime.len() / 4;
        let energy = |s: &[f32]| s.iter().map(|v| v * v).sum::<f32>();
        let head = energy(&chime[..quarter]);
        let tail = energy(&chime[chime.len() - quarter..]);
        assert!(
            tail < head * 0.01,
            "tail energy {tail} should be far below head energy {head}"
        );
    }
}
