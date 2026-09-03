/**
 * Tiny, self-contained completion sound palette.
 *
 * We synthesize these tones instead of shipping a grab-bag of opaque sound
 * assets. That keeps the feedback instant and offline, lets each earned moment
 * have its own character, and—most importantly—keeps sound strictly optional:
 * a missing/blocked Web Audio device is swallowed here and can never hold up a
 * practice write.
 */
import type { Verdict } from "../rep/useRep";
import type { CompletionMoment } from "./completionFx";

type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context?.state !== "closed") return context;
  const candidate = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = window.AudioContext ?? candidate.webkitAudioContext;
  if (!Constructor) return null;
  try {
    context = new Constructor();
    return context;
  } catch {
    return null;
  }
}

function note(
  ctx: AudioContext,
  when: number,
  frequency: number,
  duration: number,
  gain: number,
  kind: OscillatorType = "sine",
  endFrequency?: number,
) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = kind;
  oscillator.frequency.setValueAtTime(frequency, when);
  if (endFrequency != null) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      when + duration,
    );
  }
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

function withContext(play: (ctx: AudioContext, now: number) => void) {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    // A resume is harmless when already running; it lets a user-initiated
    // verdict work after macOS/WebKit suspended the context.
    void ctx.resume().catch(() => undefined);
    play(ctx, ctx.currentTime + 0.015);
  } catch {
    // Feedback is decorative. Do not surface a device failure in the hot loop.
  }
}

/** A compact, optimistic answer for every committed manual or spoken verdict. */
export function playRepFeedback(verdict: Verdict) {
  withContext((ctx, now) => {
    if (verdict === "clean") {
      // A glassy fifth with a quick upward sparkle—present, but never a jarring
      // notification sound when repeated hundreds of times in a session.
      note(ctx, now, 659.25, 0.16, 0.075, "sine", 880);
      note(ctx, now + 0.065, 987.77, 0.22, 0.05, "triangle", 1174.66);
    } else if (verdict === "flawed") {
      note(ctx, now, 392, 0.13, 0.04, "sine", 466.16);
    } else {
      note(ctx, now, 261.63, 0.16, 0.035, "triangle", 220);
    }
  });
}

/** A more generous, unmistakably earned sound for the larger milestones. */
export function playCompletionSound(moment: CompletionMoment) {
  withContext((ctx, now) => {
    if (moment === "set_complete") {
      // Open fifth → octave: compact enough for regular sets, grand enough to
      // feel like a landing rather than the ordinary rep tick.
      note(ctx, now, 523.25, 0.42, 0.075, "sine", 659.25);
      note(ctx, now + 0.09, 783.99, 0.52, 0.06, "triangle", 1046.5);
      note(ctx, now + 0.18, 1046.5, 0.72, 0.045, "sine", 1318.51);
      return;
    }
    if (moment === "variant_stage") {
      // A chain advance is an earned mini-finale: a three-step ascending arc.
      [659.25, 783.99, 987.77].forEach((frequency, index) =>
        note(ctx, now + index * 0.075, frequency, 0.34, 0.06, "triangle", frequency * 1.12),
      );
      return;
    }
    if (moment === "mastery_landing") {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        note(ctx, now + index * 0.085, frequency, 0.7, 0.055, "sine", frequency * 1.08),
      );
      return;
    }
    // The remaining ritual moments retain a warm, restrained landing.
    note(ctx, now, 587.33, 0.4, 0.055, "sine", 698.46);
    note(ctx, now + 0.1, 880, 0.5, 0.04, "triangle", 1046.5);
  });
}
