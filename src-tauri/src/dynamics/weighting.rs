//! IEC 61672 A-weighting as a cascade of three biquad sections.
//!
//! # THE LAW
//!
//! This module is loudness-only. It contains no FFT, no pitch/onset/note
//! detection, no transcription and no grading — it turns one sample into one
//! weighted sample, and nothing more. The A-weighting curve is derived here at
//! runtime from the standard's analog pole/zero set by bilinear transform: no
//! DSP crate, no lookup table, no model (the target machine is an 8 GB M2 Air).
//!
//! # Real-time discipline
//!
//! Mirrors `crate::audio`'s rules verbatim: every type here is `Copy` and POD,
//! `process` allocates nothing, locks nothing and does no I/O, so the whole
//! cascade can be moved into a cpal callback by value.

/// IEC 61672 A-weighting break frequencies, in Hz.
pub const F1: f64 = 20.598_997;
/// See [`F1`].
pub const F2: f64 = 107.652_65;
/// See [`F1`].
pub const F3: f64 = 737.862_23;
/// See [`F1`].
pub const F4: f64 = 12_194.217;

/// One direct-form-I biquad. `Copy` and POD — the callback owns it by value.
#[derive(Clone, Copy, Debug, Default)]
pub struct Biquad {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    /// Bilinear-transform an analog section
    /// `(b2s·s² + b1s·s + b0s) / (a2s·s² + a1s·s + a0s)` at `sample_rate`,
    /// normalized so `a0 == 1`.
    ///
    /// Substituting `s -> K(1 − z⁻¹)/(1 + z⁻¹)` with `K = 2·fs` and clearing
    /// denominators gives the five coefficients below.
    pub fn from_analog(
        b2s: f64,
        b1s: f64,
        b0s: f64,
        a2s: f64,
        a1s: f64,
        a0s: f64,
        sample_rate: f64,
    ) -> Self {
        let k = 2.0 * sample_rate;
        let kk = k * k;

        let b0 = b2s * kk + b1s * k + b0s;
        let b1 = 2.0 * (b0s - b2s * kk);
        let b2 = b2s * kk - b1s * k + b0s;

        let a0 = a2s * kk + a1s * k + a0s;
        let a1 = 2.0 * (a0s - a2s * kk);
        let a2 = a2s * kk - a1s * k + a0s;

        Self {
            b0: (b0 / a0) as f32,
            b1: (b1 / a0) as f32,
            b2: (b2 / a0) as f32,
            a1: (a1 / a0) as f32,
            a2: (a2 / a0) as f32,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    /// Process one sample. NO allocation, NO branch on state — callback-safe.
    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    /// Complex magnitude of this section at `hz`. Test/analysis only — never
    /// called from the audio callback.
    pub fn magnitude_at(&self, hz: f64, sample_rate: f64) -> f64 {
        let w = 2.0 * std::f64::consts::PI * hz / sample_rate;
        let (s1, c1) = w.sin_cos();
        let (s2, c2) = (2.0 * w).sin_cos();

        let num_re = self.b0 as f64 + self.b1 as f64 * c1 + self.b2 as f64 * c2;
        let num_im = -(self.b1 as f64 * s1 + self.b2 as f64 * s2);
        let den_re = 1.0 + self.a1 as f64 * c1 + self.a2 as f64 * c2;
        let den_im = -(self.a1 as f64 * s1 + self.a2 as f64 * s2);

        let num = (num_re * num_re + num_im * num_im).sqrt();
        let den = (den_re * den_re + den_im * den_im).sqrt();
        if den == 0.0 {
            f64::INFINITY
        } else {
            num / den
        }
    }
}

/// The IEC 61672 A-weighting curve as three cascaded biquads plus the scalar
/// that normalizes the cascade to 0 dB at 1 kHz.
#[derive(Clone, Copy, Debug)]
pub struct AWeighting {
    sections: [Biquad; 3],
    gain: f32,
}

impl AWeighting {
    /// Derive the cascade for `sample_rate` (44_100.0 / 48_000.0 / anything).
    ///
    /// `H(s) = k·s⁴ / [(s+w1)²·(s+w2)·(s+w3)·(s+w4)²]` split into three
    /// second-order sections. `k` is not hardcoded: it is recovered as
    /// `1 / |cascade(1 kHz)|` at the *device's* sample rate, so the curve is
    /// exactly 0 dB at 1 kHz at 44.1 kHz and 48 kHz alike.
    pub fn new(sample_rate: f64) -> Self {
        let tau = 2.0 * std::f64::consts::PI;
        let (w1, w2, w3, w4) = (tau * F1, tau * F2, tau * F3, tau * F4);

        let sections = [
            // s² / (s² + 2·w1·s + w1²)
            Biquad::from_analog(1.0, 0.0, 0.0, 1.0, 2.0 * w1, w1 * w1, sample_rate),
            // s² / (s² + (w2+w3)·s + w2·w3)
            Biquad::from_analog(1.0, 0.0, 0.0, 1.0, w2 + w3, w2 * w3, sample_rate),
            // 1 / (s² + 2·w4·s + w4²)
            Biquad::from_analog(0.0, 0.0, 1.0, 1.0, 2.0 * w4, w4 * w4, sample_rate),
        ];

        let mut me = Self {
            sections,
            gain: 1.0,
        };
        let at_1k = me.raw_magnitude(1000.0, sample_rate);
        me.gain = if at_1k > 0.0 {
            (1.0 / at_1k) as f32
        } else {
            1.0
        };
        me
    }

    /// Process one sample through all three sections + the 1 kHz normalizer.
    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let mut y = x;
        for section in self.sections.iter_mut() {
            y = section.process(y);
        }
        y * self.gain
    }

    /// Un-normalized cascade magnitude. Test/analysis only.
    fn raw_magnitude(&self, hz: f64, sample_rate: f64) -> f64 {
        self.sections
            .iter()
            .map(|s| s.magnitude_at(hz, sample_rate))
            .product()
    }

    /// Cascade magnitude response in dB at `hz`. Test/analysis only — the
    /// audio path uses [`AWeighting::process`], never this.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn response_db(&self, hz: f64, sample_rate: f64) -> f64 {
        let m = self.raw_magnitude(hz, sample_rate) * self.gain as f64;
        if m <= 0.0 {
            f64::NEG_INFINITY
        } else {
            20.0 * m.log10()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // IEC 61672-1 Table 3, class-1 tolerances are ±0.7 dB at 100 Hz; we assert
    // the textbook A-weighting values with room for the bilinear transform's
    // own low-frequency warping.
    #[test]
    fn a_weighting_is_unity_at_1khz_at_both_real_sample_rates() {
        for fs in [44_100.0_f64, 48_000.0_f64] {
            let w = AWeighting::new(fs);
            let db = w.response_db(1000.0, fs);
            assert!(
                db.abs() <= 0.5,
                "fs={fs}: 1 kHz response {db} dB, want ~0 dB"
            );
        }
    }

    #[test]
    fn a_weighting_attenuates_100hz_by_about_19db() {
        for fs in [44_100.0_f64, 48_000.0_f64] {
            let w = AWeighting::new(fs);
            let db = w.response_db(100.0, fs);
            assert!(
                (db - (-19.1)).abs() <= 1.5,
                "fs={fs}: 100 Hz response {db} dB, want ~-19.1 dB"
            );
        }
    }

    #[test]
    fn a_weighting_rolls_off_below_the_piano_fundamental_range() {
        // Sanity that the curve is monotone-ish upward across the low band and
        // is NOT a spectrum analyser in disguise — it is one scalar per sample.
        let fs = 48_000.0;
        let w = AWeighting::new(fs);
        assert!(w.response_db(31.5, fs) < w.response_db(100.0, fs));
        assert!(w.response_db(100.0, fs) < w.response_db(1000.0, fs));
    }

    #[test]
    fn biquad_process_is_allocation_free_and_stateful() {
        let mut b = Biquad::from_analog(1.0, 0.0, 0.0, 1.0, 2.0, 1.0, 48_000.0);
        let first = b.process(1.0);
        let second = b.process(1.0);
        assert!(first.is_finite() && second.is_finite());
        assert_ne!(first, second, "biquad must carry state across samples");
    }

    #[test]
    fn a_weighting_processes_a_1khz_sine_at_about_unity_gain() {
        // The process() path and the response_db() path must agree: a 1 kHz
        // sine in, a ~1 kHz sine of the same RMS out.
        let fs = 48_000.0_f64;
        let mut w = AWeighting::new(fs);
        let mut sum_in = 0.0_f64;
        let mut sum_out = 0.0_f64;
        for n in 0..48_000 {
            let x = (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / fs).sin() as f32;
            let y = w.process(x);
            // Skip the filter's settling transient.
            if n > 4_800 {
                sum_in += (x as f64) * (x as f64);
                sum_out += (y as f64) * (y as f64);
            }
        }
        let db = 10.0 * (sum_out / sum_in).log10();
        assert!(
            db.abs() < 0.5,
            "1 kHz through process() is {db} dB, want ~0"
        );
    }
}
