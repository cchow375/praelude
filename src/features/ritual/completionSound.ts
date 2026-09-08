/**
 * Praelude's offline musical voice: felt-string attacks, glass harmonics and a
 * soft breath of air. Progress opens the voicing; completion resolves it.
 * Everything here is decorative and synchronous callers never await audio.
 */
import type { Verdict } from "../rep/useRep";
import type { CompletionMoment } from "./completionFx";

type AudioContextConstructor = new () => AudioContext;
export interface RepSoundState {
  progress: number;
  setbackCount: number;
}

type Cue = {
  ctx: AudioContext;
  bus: GainNode;
  sources: Set<AudioScheduledSourceNode>;
  nodes: AudioNode[];
  dispose: () => void;
};

let context: AudioContext | null = null;
let resumePromise: Promise<void> | null = null;
let requestId = 0;
let variation = 0;
const cues: Cue[] = [];
const MAX_SOURCES = 48;
const MAX_RESUME_WAIT_MS = 250;
const TINY = 0.0001;

function audioContext(): AudioContext | null {
  if (context && context.state !== "closed") return context;
  const candidate = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = candidate.AudioContext ?? candidate.webkitAudioContext;
  if (!Constructor) return null;
  try {
    context = new Constructor();
    resumePromise = null;
    return context;
  } catch {
    return null;
  }
}

/** Acquire WebKit's audio permission inside the original click/key gesture. */
export function unlockCompletionAudio() {
  const ctx = audioContext();
  if (!ctx || ctx.state === "running" || resumePromise) return;
  try {
    const pending = ctx.resume().catch(() => undefined);
    resumePromise = pending;
    void pending.then(() => {
      if (resumePromise === pending) resumePromise = null;
    });
  } catch {
    resumePromise = null;
  }
}

/**
 * Start-set and microphone gestures also unlock subsequent voice rewards.
 * Retain these cheap listeners so a device suspension can recover on the next
 * gesture; a running context is a no-op and pending resumes are coalesced.
 */
export function installCompletionAudioUnlock(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const unlock = (event: Event) => {
    if (event instanceof KeyboardEvent && event.repeat) return;
    unlockCompletionAudio();
  };
  document.addEventListener("pointerdown", unlock, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", unlock, {
    capture: true,
    passive: true,
  });
  return () => {
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
}

function disconnect(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    // A disappearing device must not throw from an asynchronous ended event.
  }
}

function stopCue(cue: Cue, fade: boolean) {
  const now = cue.ctx.currentTime;
  try {
    cue.bus.gain.cancelScheduledValues(now);
    cue.bus.gain.setValueAtTime(0.72, now);
    cue.bus.gain.linearRampToValueAtTime(0, now + (fade ? 0.025 : 0));
    cue.sources.forEach((source) => {
      try {
        source.stop(now + (fade ? 0.03 : 0));
      } catch {
        // A source can already have ended during a device transition.
      }
    });
  } catch {
    cue.dispose();
  } finally {
    if (!fade) cue.dispose();
  }
}

function beginCue(ctx: AudioContext): Cue {
  // A new verdict drains the old musical tail. Rapid input cannot stack an
  // unbounded fanfare; at most one fading cue and one current cue survive.
  while (cues.length > 1) stopCue(cues[0], false);
  if (cues[0]) stopCue(cues[0], true);
  const bus = ctx.createGain();
  bus.gain.value = 0.72;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -15;
  limiter.knee.value = 12;
  limiter.ratio.value = 5;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;
  bus.connect(limiter);
  limiter.connect(ctx.destination);
  const cue: Cue = {
    ctx,
    bus,
    sources: new Set(),
    nodes: [bus, limiter],
    dispose() {
      cue.sources.forEach((source) => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      });
      cue.sources.clear();
      cue.nodes.forEach(disconnect);
      const index = cues.indexOf(cue);
      if (index !== -1) cues.splice(index, 1);
    },
  };
  cues.push(cue);
  return cue;
}

function attach(
  cue: Cue,
  source: AudioScheduledSourceNode,
  nodes: AudioNode[],
) {
  cue.sources.add(source);
  cue.nodes.push(source, ...nodes);
  source.onended = () => {
    source.onended = null;
    disconnect(source);
    nodes.forEach(disconnect);
    cue.sources.delete(source);
    if (!cue.sources.size) cue.dispose();
  };
}

function partial(
  cue: Cue,
  when: number,
  frequency: number,
  duration: number,
  gain: number,
  type: OscillatorType,
  endFrequency = frequency,
) {
  if (cue.sources.size >= MAX_SOURCES) return;
  const { ctx } = cue;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  attach(cue, oscillator, [envelope]);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(
    endFrequency,
    when + duration,
  );
  envelope.gain.setValueAtTime(TINY, when);
  envelope.gain.exponentialRampToValueAtTime(gain, when + 0.008);
  envelope.gain.exponentialRampToValueAtTime(
    gain * 0.3,
    when + duration * 0.22,
  );
  envelope.gain.exponentialRampToValueAtTime(TINY, when + duration);
  oscillator.connect(envelope);
  envelope.connect(cue.bus);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.025);
}

function pluck(
  cue: Cue,
  when: number,
  hz: number,
  duration: number,
  gain: number,
) {
  partial(cue, when, hz, duration, gain, "triangle");
  // A short, slightly inharmonic glass transient over a warm string body.
  partial(cue, when, hz * 2.003, duration * 0.48, gain * 0.28, "sine");
  partial(cue, when + 0.006, hz * 3.99, duration * 0.2, gain * 0.08, "sine");
}

function air(cue: Cue, when: number, duration: number, bright: boolean) {
  const { ctx } = cue;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const envelope = ctx.createGain();
  attach(cue, source, [filter, envelope]);
  const buffer = ctx.createBuffer(
    1,
    Math.ceil(ctx.sampleRate * duration),
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  // Fixed noise texture: no downloads, audio files, or random reward strength.
  let seed = 1729;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    data[i] = seed / 2147483648;
  }
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.Q.value = 0.65;
  filter.frequency.setValueAtTime(bright ? 1400 : 750, when);
  filter.frequency.exponentialRampToValueAtTime(
    bright ? 5200 : 180,
    when + duration,
  );
  envelope.gain.setValueAtTime(TINY, when);
  envelope.gain.exponentialRampToValueAtTime(
    bright ? 0.055 : 0.035,
    when + duration * 0.12,
  );
  envelope.gain.exponentialRampToValueAtTime(TINY, when + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(cue.bus);
  source.start(when);
  source.stop(when + duration + 0.025);
}

function withContext(play: (cue: Cue, now: number) => void) {
  const id = ++requestId;
  const requestedAt = performance.now();
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const schedule = () => {
      // Do not replay queued verdicts after a slow unlock or device resume.
      if (
        id !== requestId ||
        performance.now() - requestedAt > MAX_RESUME_WAIT_MS ||
        ctx.state !== "running"
      )
        return;
      let cue: Cue | undefined;
      try {
        cue = beginCue(ctx);
        play(cue, ctx.currentTime + 0.012);
        if (!cue.sources.size) cue.dispose();
      } catch {
        cue?.dispose();
        // Device failures never reach the durable practice path.
      }
    };
    if (ctx.state === "running") schedule();
    else if (resumePromise)
      void resumePromise.then(schedule).catch(() => undefined);
  } catch {
    // Context creation and graph construction are both optional.
  }
}

const clamp = (value: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;

/** Each clean rep climbs the same musical arc, with three alternating ornaments. */
export function playRepFeedback(verdict: Verdict, state?: RepSoundState) {
  const progress = clamp(state?.progress ?? 0, 1);
  const setbacks = clamp(state?.setbackCount ?? 1, 3);
  const ornament = variation++ % 3;
  withContext((cue, now) => {
    if (verdict === "clean") {
      const step = Math.min(4, Math.floor(progress * 5));
      const root = [261.63, 329.63, 392, 440, 493.88][step];
      const duration = 0.35 + progress * 0.36;
      pluck(cue, now, root, duration, 0.1);
      pluck(cue, now + 0.045, root * 2, duration * 0.8, 0.045);
      if (progress >= 0.35) pluck(cue, now + 0.09, root * 1.5, 0.38, 0.037);
      if (progress >= 0.6)
        pluck(cue, now + 0.14, root * [2.5, 3, 2.25][ornament], 0.43, 0.03);
      if (progress >= 0.8) {
        pluck(cue, now + 0.2, root * 4, 0.44, 0.023);
        air(cue, now, 0.28, true);
      }
      // Subtle alternate answering harmonic even for the first repetition.
      partial(
        cue,
        now + 0.065,
        root * [3, 4, 2.5][ornament],
        0.19,
        0.011,
        "sine",
      );
    } else {
      // A falling felt-string sigh, deepening over three setbacks. No alarm,
      // harsh buzzer or escalating volume: a reset can sound serious and kind.
      const root =
        (verdict === "flawed" ? 293.66 : 261.63) / (1 + setbacks * 0.12);
      partial(
        cue,
        now,
        root,
        0.3 + setbacks * 0.06,
        0.085,
        "triangle",
        root * 0.75,
      );
      partial(cue, now + 0.025, root * 2.01, 0.22, 0.023, "sine", root * 1.5);
      air(cue, now, 0.22 + setbacks * 0.055, false);
      if (setbacks >= 2)
        partial(cue, now + 0.055, root * 0.5, 0.4, 0.045, "sine");
    }
  });
}

/** A resolving chord for a set; a wider two-octave cascade for a full chain. */
export function playCompletionSound(moment: CompletionMoment) {
  if (moment === "set_exit") return;
  withContext((cue, now) => {
    const chain = moment === "chain_complete";
    const complete =
      chain || moment === "set_complete" || moment === "mastery_landing";
    if (complete) {
      const tones = chain
        ? [261.63, 392, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
        : [261.63, 392, 523.25, 659.25, 1046.5];
      partial(cue, now, 130.81, chain ? 1.65 : 1.15, 0.13, "sine");
      tones.forEach((hz, i) =>
        pluck(
          cue,
          now + i * (chain ? 0.075 : 0.055),
          hz,
          chain ? 1.25 : 0.95,
          i < 2 ? 0.058 : 0.038,
        ),
      );
      air(cue, now + 0.04, chain ? 0.85 : 0.48, true);
      if (chain) {
        [523.25, 659.25, 783.99].forEach((hz) =>
          pluck(cue, now + 0.67, hz, 1.35, 0.032),
        );
        pluck(cue, now + 0.85, 2093, 0.95, 0.024);
      }
      return;
    }
    const tones =
      moment === "variant_stage"
        ? [329.63, 493.88, 659.25, 987.77]
        : [293.66, 440, 587.33];
    tones.forEach((hz, i) => pluck(cue, now + i * 0.065, hz, 0.65, 0.055));
    air(cue, now, 0.3, true);
  });
}
