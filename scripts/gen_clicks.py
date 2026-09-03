#!/usr/bin/env python3
"""Synthesize the six metronome click sounds used by Praelude's audio engine.

Task 6 asset generator. Stdlib only (`wave`, `math`, `struct`, `random`) --
no numpy/scipy, so this must run on any Mac with a stock python3.

Each sound is a short (<=120 ms), 44.1 kHz mono 16-bit PCM WAV with most of its
energy in the 1-5 kHz band (to cut through a loud acoustic piano) and a sharp
attack + short decay (no mushy sustain). All six are peak-normalized to
-0.3 dBFS. `Mixer::load_clicks` derives the "beat" and "sub" variants via
*relative attenuation* rather than boosting "accent": accent stays at gain
1.0 (the sample as loaded, already limiter-maximized to -0.3 dBFS), beat is
attenuated -3 dB, and sub is attenuated -6 dB. This guarantees zero clipping,
since attenuation can only make an already-safe sample quieter.

Usage:
    python3 scripts/gen_clicks.py            # generate all six WAVs
    python3 scripts/gen_clicks.py --verify    # check format/duration/peak; exit
                                               # non-zero if any file is bad
"""
from __future__ import annotations

import math
import os
import random
import struct
import sys
import wave

SAMPLE_RATE = 44_100
TARGET_PEAK_DBFS = -0.3
MAX_DURATION_MS = 120
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src-tauri", "assets", "clicks")

SOUND_NAMES = ["woodblock", "rim", "beep", "clave", "cowbell", "tick"]


def db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def lin_to_db(lin: float) -> float:
    if lin <= 0.0:
        return -math.inf
    return 20.0 * math.log10(lin)


def n_samples(ms: float) -> int:
    return int(round(SAMPLE_RATE * ms / 1000.0))


def damped_sine(freq_hz: float, dur_ms: float, decay_tau_ms: float, phase: float = 0.0):
    """A sine burst with an exponential amplitude envelope (damped oscillator)."""
    n = n_samples(dur_ms)
    tau = decay_tau_ms / 1000.0
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t / tau)
        out.append(env * math.sin(2 * math.pi * freq_hz * t + phase))
    return out


def white_noise(dur_ms: float, seed: int):
    n = n_samples(dur_ms)
    rng = random.Random(seed)
    return [rng.uniform(-1.0, 1.0) for _ in range(n)]


def one_pole_highpass(sig, cutoff_hz: float):
    """Simple one-pole HPF to strip rumble/DC from noise-based clicks."""
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    dt = 1.0 / SAMPLE_RATE
    alpha = rc / (rc + dt)
    out = [0.0] * len(sig)
    prev_in = 0.0
    prev_out = 0.0
    for i, x in enumerate(sig):
        y = alpha * (prev_out + x - prev_in)
        out[i] = y
        prev_in = x
        prev_out = y
    return out


def one_pole_lowpass(sig, cutoff_hz: float):
    """Simple one-pole LPF, used to tame harsh noise into a filtered "click"."""
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    out = [0.0] * len(sig)
    prev = 0.0
    for i, x in enumerate(sig):
        prev = prev + alpha * (x - prev)
        out[i] = prev
    return out


def envelope(sig, attack_n: int, decay_fn):
    n = len(sig)
    out = [0.0] * n
    for i, x in enumerate(sig):
        if i < attack_n:
            a = i / max(attack_n, 1)
        else:
            a = decay_fn(i - attack_n)
        out[i] = x * a
    return out


def mix(*sigs):
    n = max(len(s) for s in sigs)
    out = [0.0] * n
    for s in sigs:
        for i, x in enumerate(s):
            out[i] += x
    return out


def add_transient_click(sig, click_len=6, gain=0.6, seed=1):
    """Add a brief noise transient at the very start (attack "chiff")."""
    rng = random.Random(seed)
    n = len(sig)
    out = list(sig)
    for i in range(min(click_len, n)):
        env = 1.0 - (i / click_len)
        out[i] += gain * env * rng.uniform(-1.0, 1.0)
    return out


def normalize_to_dbfs(sig, target_db: float):
    peak = max((abs(x) for x in sig), default=0.0)
    if peak <= 1e-12:
        return sig
    target_lin = db_to_lin(target_db)
    scale = target_lin / peak
    return [x * scale for x in sig]


# --- Per-sound synthesis recipes -------------------------------------------------

def make_woodblock():
    # Damped 1.6 kHz sine burst + a short noise transient for a woody "tock".
    body = damped_sine(1600.0, dur_ms=70.0, decay_tau_ms=12.0)
    sig = add_transient_click(body, click_len=8, gain=0.5, seed=1)
    return sig


def make_beep():
    # Clean 1 kHz sine, 30 ms, fast attack + linear decay tail (no noise).
    dur_ms = 30.0
    n = n_samples(dur_ms)
    attack_n = n_samples(2.0)
    sig = [math.sin(2 * math.pi * 1000.0 * (i / SAMPLE_RATE)) for i in range(n)]
    def decay_fn(i):
        remaining = n - attack_n
        return max(0.0, 1.0 - i / remaining)
    return envelope(sig, attack_n, decay_fn)


def make_rim():
    # Filtered noise click: band-passed (HPF then LPF) white noise, very short.
    dur_ms = 45.0
    noise = white_noise(dur_ms, seed=2)
    hp = one_pole_highpass(noise, cutoff_hz=800.0)
    bp = one_pole_lowpass(hp, cutoff_hz=4500.0)
    n = len(bp)
    attack_n = n_samples(1.0)
    def decay_fn(i):
        remaining = n - attack_n
        tau = remaining / 4.0
        return math.exp(-i / max(tau, 1))
    return envelope(bp, attack_n, decay_fn)


def make_clave():
    # 2.5 kHz damped sine, classic woodblock/clave "tock" with a fast decay.
    return damped_sine(2500.0, dur_ms=55.0, decay_tau_ms=9.0)


def make_cowbell():
    # Two inharmonic square-ish partials (800 Hz + 1.35 kHz) with fast decay,
    # approximated with sine + light odd-harmonic content for metallic bite.
    dur_ms = 90.0
    tau = 20.0
    a = damped_sine(800.0, dur_ms, tau)
    b = damped_sine(1350.0, dur_ms, tau)
    c = damped_sine(800.0 * 3, dur_ms, tau * 0.5, phase=0.3)  # 3rd harmonic-ish grit
    sig = mix([x * 0.6 for x in a], [x * 0.5 for x in b], [x * 0.15 for x in c])
    return sig


def make_tick():
    # 5 ms white-noise impulse, tightly windowed, minimal LPF to avoid harshness.
    dur_ms = 5.0
    noise = white_noise(dur_ms, seed=3)
    filtered = one_pole_lowpass(noise, cutoff_hz=6000.0)
    n = len(filtered)
    # Very short linear fade in/out so there's no hard edge (click "tick" not "pop").
    fade = max(1, n // 4)
    out = list(filtered)
    for i in range(n):
        env = 1.0
        if i < fade:
            env = i / fade
        elif i >= n - fade:
            env = (n - 1 - i) / fade
        out[i] *= env
    return out


RECIPES = {
    "woodblock": make_woodblock,
    "rim": make_rim,
    "beep": make_beep,
    "clave": make_clave,
    "cowbell": make_cowbell,
    "tick": make_tick,
}


def synth(name: str):
    sig = RECIPES[name]()
    # Trim to MAX_DURATION_MS just in case a recipe overshoots.
    max_n = n_samples(MAX_DURATION_MS)
    if len(sig) > max_n:
        sig = sig[:max_n]
    sig = normalize_to_dbfs(sig, TARGET_PEAK_DBFS)
    return sig


def write_wav(path: str, sig):
    n = len(sig)
    frames = bytearray()
    for x in sig:
        v = max(-1.0, min(1.0, x))
        i16 = int(round(v * 32767.0))
        frames += struct.pack("<h", i16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(frames))


def generate():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in SOUND_NAMES:
        sig = synth(name)
        path = os.path.join(OUT_DIR, f"{name}.wav")
        write_wav(path, sig)
        dur_ms = 1000.0 * len(sig) / SAMPLE_RATE
        peak_db = lin_to_db(max((abs(x) for x in sig), default=0.0))
        print(f"wrote {path}: {len(sig)} samples, {dur_ms:.1f} ms, peak {peak_db:.2f} dBFS")


def verify() -> bool:
    ok = True
    for name in SOUND_NAMES:
        path = os.path.join(OUT_DIR, f"{name}.wav")
        if not os.path.isfile(path):
            print(f"FAIL {name}: missing file {path}")
            ok = False
            continue

        file_ok = True
        try:
            with wave.open(path, "rb") as w:
                nchannels = w.getnchannels()
                sampwidth = w.getsampwidth()
                framerate = w.getframerate()
                nframes = w.getnframes()
                raw = w.readframes(nframes)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {name}: could not open WAV: {e}")
            ok = False
            continue

        if nchannels != 1:
            print(f"FAIL {name}: expected mono, got {nchannels} channels")
            ok = False
            file_ok = False
        if sampwidth != 2:
            print(f"FAIL {name}: expected 16-bit (2 bytes/sample), got {sampwidth}")
            ok = False
            file_ok = False
        if framerate != SAMPLE_RATE:
            print(f"FAIL {name}: expected {SAMPLE_RATE} Hz, got {framerate}")
            ok = False
            file_ok = False

        dur_ms = 1000.0 * nframes / framerate if framerate else 0.0
        if dur_ms > MAX_DURATION_MS + 1e-6:
            print(f"FAIL {name}: duration {dur_ms:.1f} ms exceeds {MAX_DURATION_MS} ms")
            ok = False
            file_ok = False

        samples = struct.unpack(f"<{nframes}h", raw) if nframes else ()
        peak = max((abs(s) for s in samples), default=0) / 32768.0
        peak_db = lin_to_db(peak)
        if peak_db < -0.5:
            print(f"FAIL {name}: peak {peak_db:.2f} dBFS below -0.5 dBFS floor")
            ok = False
            file_ok = False
        if file_ok:
            print(f"OK   {name}: {dur_ms:.1f} ms, peak {peak_db:.2f} dBFS, {nchannels}ch/{sampwidth*8}bit/{framerate}Hz")

    return ok


def main():
    if "--verify" in sys.argv:
        ok = verify()
        sys.exit(0 if ok else 1)
    generate()
    ok = verify()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
