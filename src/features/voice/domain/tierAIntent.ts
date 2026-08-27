import {
  validateVoiceDelivery,
  type InvalidDeliveryReason,
  type VoiceDeliveryIdentity,
  type VoiceRecognitionMetadata,
  type VoiceTranscriptDelivery,
} from "./delivery";
import { parseSpokenCountInteger, parseSpokenInteger } from "./spokenNumber";

export const TIER_A_COUNT_MIN = 1;
export const TIER_A_COUNT_MAX = 100;
export const TIER_A_TEMPO_MIN = 20;
export const TIER_A_TEMPO_MAX = 300;

export type PracticeVoiceState = "idle" | "active" | "paused";
export type SelfReportedVerdict = "clean" | "flawed" | "miss";
export type RetentionVoiceAction = "confirm" | "lower" | "reopen" | "snooze";

export interface TierAContext {
  readonly practice_state: PracticeVoiceState;
  readonly metronome_running: boolean;
  readonly last_attempt_available: boolean;
  readonly pending_duplicate_attempt: boolean;
  readonly retention_due: boolean;
}

export type TierAIntent =
  | { readonly kind: "record_attempt"; readonly verdict: SelfReportedVerdict }
  | {
      /** Quality is deliberately not inferred from a batch count declaration. */
      readonly kind: "report_attempt_count";
      readonly count: number;
    }
  | { readonly kind: "add_clean_reps"; readonly count: number }
  | { readonly kind: "confirm_pending_attempt" }
  | { readonly kind: "report_last_attempt" }
  | { readonly kind: "undo_last_attempt"; readonly count?: number }
  | {
      readonly kind: "correct_last_attempt";
      readonly verdict: SelfReportedVerdict;
    }
  | { readonly kind: "restart_set" }
  | { readonly kind: "reset_clean_streak" }
  | { readonly kind: "close_set" }
  | { readonly kind: "practice_status" }
  | { readonly kind: "pause_practice" }
  | { readonly kind: "resume_practice" }
  | { readonly kind: "safety_stop" }
  | { readonly kind: "metronome_on" }
  | { readonly kind: "metronome_off" }
  | {
      readonly kind: "adjust_tempo";
      readonly direction: "faster" | "slower";
    }
  | { readonly kind: "set_tempo"; readonly bpm: number }
  | { readonly kind: "correct_tempo"; readonly bpm: number }
  | { readonly kind: "help" }
  | {
      readonly kind: "retention";
      readonly action: RetentionVoiceAction;
    };

export interface TierAEvidence extends VoiceDeliveryIdentity {
  readonly raw_text: string;
  readonly normalized_text: string;
  readonly recognition: VoiceRecognitionMetadata;
}

export type TierAIgnoredReason =
  "non_final" | "not_exact_command" | "state_mismatch" | "unsafe_characters";

export type TierARejectionReason =
  | InvalidDeliveryReason
  | "unsafe_numeric_punctuation"
  | "invalid_count"
  | "count_out_of_range"
  | "invalid_tempo"
  | "tempo_out_of_range"
  | "no_active_set"
  | "practice_paused"
  | "already_paused"
  | "already_active"
  | "no_last_attempt"
  | "no_pending_attempt"
  | "retention_not_due";

export type TierAParseResult =
  | {
      readonly classification: "matched";
      readonly intent: TierAIntent;
      readonly evidence: TierAEvidence;
    }
  | {
      readonly classification: "rejected";
      readonly reason: TierARejectionReason;
      readonly evidence: TierAEvidence;
    }
  | {
      readonly classification: "ignored";
      readonly reason: TierAIgnoredReason;
      readonly evidence: TierAEvidence;
    };

interface NormalizedTranscript {
  readonly text: string;
  readonly has_numeric_colon: boolean;
  readonly has_unsafe_characters: boolean;
}

/**
 * Normalize only presentation punctuation and whitespace. The parser still
 * uses full-string equality/anchored forms; normalization never authorizes a
 * substring command.
 */
export function normalizeTierATranscript(raw: string): NormalizedTranscript {
  const compatible = raw.normalize("NFKC").toLocaleLowerCase("en-US");
  const hasNumericColon = /\d\s*:\s*\d/u.test(compatible);
  const withoutApostrophes = compatible.replace(/[’']/gu, "");
  const spaced = withoutApostrophes.replace(/[.,!?;:—–-]/gu, " ");
  const hasUnsafeCharacters = /[^a-z0-9\s]/u.test(spaced);
  return {
    text: spaced.replace(/\s+/gu, " ").trim(),
    has_numeric_colon: hasNumericColon,
    has_unsafe_characters: hasUnsafeCharacters,
  };
}

function evidenceFor(
  delivery: VoiceTranscriptDelivery,
  normalized: string,
): TierAEvidence {
  return {
    delivery_id: delivery.delivery_id,
    revision: delivery.revision,
    raw_text: delivery.text,
    normalized_text: normalized,
    recognition: delivery.recognition,
  };
}

function match(intent: TierAIntent, evidence: TierAEvidence): TierAParseResult {
  return { classification: "matched", intent, evidence };
}

function reject(
  reason: TierARejectionReason,
  evidence: TierAEvidence,
): TierAParseResult {
  return { classification: "rejected", reason, evidence };
}

function ignore(
  reason: TierAIgnoredReason,
  evidence: TierAEvidence,
): TierAParseResult {
  return { classification: "ignored", reason, evidence };
}

function setAvailable(context: TierAContext): boolean {
  return (
    context.practice_state === "active" || context.practice_state === "paused"
  );
}

function parseBoundedParameter(
  body: string,
  min: number,
  max: number,
  parser: (text: string) => number | null = parseSpokenInteger,
): { value: number | null; valid: boolean } {
  const value = parser(body);
  return { value, valid: value !== null && value >= min && value <= max };
}

function parseCountCommand(text: string): string | null {
  for (const prefix of ["count that as ", "count "] as const) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  if (text.startsWith("did ")) {
    const body = text.slice("did ".length);
    // `did` is also an ambient auxiliary. Treat it as a count command only
    // when the complete remainder is numeric (or contains explicit digits that
    // deserve a bounded rejection); `did you count four` stays inert.
    if (parseSpokenInteger(body) !== null || /\d/u.test(body)) return body;
  }
  return null;
}

function hasNegativeNumericLiteral(raw: string): boolean {
  return /(?:^|\s)-\s*\d/u.test(raw.normalize("NFKC"));
}

function parseTempoCommand(
  text: string,
): { kind: "set_tempo" | "correct_tempo"; number_text: string } | null {
  for (const prefix of [
    "correct last tempo to ",
    "correct tempo to ",
  ] as const) {
    if (text.startsWith(prefix)) {
      return { kind: "correct_tempo", number_text: text.slice(prefix.length) };
    }
  }
  for (const prefix of ["set tempo to ", "set tempo "] as const) {
    if (text.startsWith(prefix)) {
      return { kind: "set_tempo", number_text: text.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Fold the recognizer's manglings of "metronome" back onto the word. Mirror of
 * the Rust router's `fold_metronome` (`src-tauri/src/intent/mod.rs`), and it has
 * to stay a mirror: two routers that disagree about what the user said are worse
 * than either one alone.
 *
 * The mangles are the ones observed in Christian's sessions. Folding them can
 * only ever produce a token the grammar already accepts, so it loosens nothing —
 * the command-shape checks below still have to pass.
 */
function foldMetronomeMangles(text: string): string {
  const words = text.split(" ").filter((w) => w.length > 0);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    // Two-word splits first: "metro gnome" is one mangled word, not two.
    if (
      words[i] === "metro" &&
      (words[i + 1] === "gnome" || words[i + 1] === "nome")
    ) {
      out.push("metronome");
      i += 1;
      continue;
    }
    out.push(
      words[i] === "metranome" || words[i] === "metrodome"
        ? "metronome"
        : words[i],
    );
  }
  return out.join(" ");
}

/**
 * Leading courtesy that carries no instruction. Mirror of the Rust router's
 * `COURTESY_PREFIXES` / `strip_courtesy`: head of the utterance only, these
 * exact forms only, at most twice ("hey can you stop the metronome").
 */
const COURTESY_PREFIXES: readonly (readonly string[])[] = [
  ["can", "you"],
  ["could", "you"],
  ["would", "you"],
  ["will", "you"],
  ["hey"],
  ["ok"],
  ["okay"],
];

function stripCourtesy(words: readonly string[]): readonly string[] {
  let rest = words;
  for (let round = 0; round < 2; round += 1) {
    const prefix = COURTESY_PREFIXES.find(
      (candidate) =>
        rest.length > candidate.length &&
        candidate.every((word, index) => rest[index] === word),
    );
    if (!prefix) break;
    rest = rest.slice(prefix.length);
  }
  return rest;
}

/**
 * The metronome on/off command, recognized by tokens rather than by a fixed list
 * of sentences — "turn the metronome off", "can you stop the metronome" and
 * "metronome please stop" are one command said three ways, and Christian's
 * "Siri 2015" complaint was that only the shortest spelling worked.
 *
 * Order-flexible, but not free-form. The firewall is the same shape the Rust
 * router uses (`is_explicit_metro_stop`): after courtesy is removed the
 * utterance must name the metronome, carry exactly one direction cue, be at most
 * five words, and be built ENTIRELY from this vocabulary. An ambient sentence
 * that happens to contain the tokens — "can you believe the metronome on that
 * recording" — carries words that are not in it, and never matches.
 */
function matchMetronomeCommand(text: string): "on" | "off" | null {
  const VOCAB = new Set([
    "metronome",
    "on",
    "off",
    "start",
    "stop",
    "turn",
    "kill",
    "halt",
    "the",
    "please",
    "it",
    "now",
  ]);
  const words = stripCourtesy(
    foldMetronomeMangles(text).split(" ").filter(Boolean),
  );
  if (words.length === 0 || words.length > 5) return null;
  if (!words.includes("metronome")) return null;
  if (!words.every((word) => VOCAB.has(word))) return null;

  const off = words.some(
    (word) =>
      word === "off" || word === "stop" || word === "kill" || word === "halt",
  );
  const on = words.some((word) => word === "on" || word === "start");
  // Exactly one direction. "turn the metronome on off" is not a command.
  if (off === on) return null;
  return off ? "off" : "on";
}

/** Parse one final transcript using exact, state-gated Tier A grammar. */
export function parseTierAIntent(
  delivery: VoiceTranscriptDelivery,
  context: TierAContext,
): TierAParseResult {
  const normalized = normalizeTierATranscript(delivery.text);
  const evidence = evidenceFor(delivery, normalized.text);
  const invalidDelivery = validateVoiceDelivery(delivery);
  if (invalidDelivery) return reject(invalidDelivery, evidence);
  if (!delivery.is_final) return ignore("non_final", evidence);
  if (normalized.has_unsafe_characters)
    return ignore("unsafe_characters", evidence);

  const text = normalized.text;

  if (text === "help" || text === "voice help" || text === "practice help") {
    return match({ kind: "help" }, evidence);
  }
  if (
    [
      "safety stop",
      "stop practice",
      "it hurts",
      "my hand hurts",
      "it kind of hurts now",
      "its kind of hurt now",
      "i feel numb",
      "my hand is numb",
      "i feel weakness",
    ].includes(text)
  ) {
    return match({ kind: "safety_stop" }, evidence);
  }

  const verdict = (
    text === "clean" ||
    text === "got it" ||
    text === "done" ||
    text === "mark done" ||
    text === "rep done"
      ? "clean"
      : text === "flawed" || text === "sloppy" || text === "mark sloppy"
        ? "flawed"
        : text === "miss" ||
            text === "missed" ||
            text === "no" ||
            text === "again" ||
            text === "mark again"
          ? "miss"
          : null
  ) satisfies SelfReportedVerdict | null;
  if (verdict !== null) {
    if (context.practice_state === "active") {
      return match({ kind: "record_attempt", verdict }, evidence);
    }
    if (context.practice_state === "paused") {
      return reject("practice_paused", evidence);
    }
    // Short verdict words are conversational outside the active hot loop.
    return ignore("state_mismatch", evidence);
  }

  if (text === "count that") {
    if (context.pending_duplicate_attempt)
      return match({ kind: "confirm_pending_attempt" }, evidence);
    if (context.practice_state === "active")
      return match({ kind: "add_clean_reps", count: 1 }, evidence);
    return reject("no_active_set", evidence);
  }
  if (text === "did that count") {
    if (!context.last_attempt_available)
      return reject("no_last_attempt", evidence);
    return match({ kind: "report_last_attempt" }, evidence);
  }

  const countBody = parseCountCommand(text);
  if (countBody !== null) {
    if (normalized.has_numeric_colon) {
      return reject("unsafe_numeric_punctuation", evidence);
    }
    if (hasNegativeNumericLiteral(delivery.text)) {
      return reject("invalid_count", evidence);
    }
    const count = parseBoundedParameter(
      countBody,
      TIER_A_COUNT_MIN,
      TIER_A_COUNT_MAX,
      parseSpokenCountInteger,
    );
    if (count.value === null) return reject("invalid_count", evidence);
    if (!count.valid) return reject("count_out_of_range", evidence);
    if (context.practice_state === "paused")
      return reject("practice_paused", evidence);
    if (context.practice_state !== "active")
      return reject("no_active_set", evidence);
    return match(
      { kind: "report_attempt_count", count: count.value },
      evidence,
    );
  }

  const addClean = /^add (.+) (?:clean|cleans|rep|reps)$/u.exec(text);
  if (addClean) {
    const countText = addClean[1] === "a" ? "one" : addClean[1];
    const count = parseBoundedParameter(
      countText,
      TIER_A_COUNT_MIN,
      TIER_A_COUNT_MAX,
      parseSpokenCountInteger,
    );
    if (count.value === null) return reject("invalid_count", evidence);
    if (!count.valid) return reject("count_out_of_range", evidence);
    if (context.practice_state === "paused")
      return reject("practice_paused", evidence);
    if (context.practice_state !== "active")
      return reject("no_active_set", evidence);
    return match({ kind: "add_clean_reps", count: count.value }, evidence);
  }

  const countedUndo = /^(?:take (.+) (?:back|away)|(?:remove|undo) (.+) reps?)$/u.exec(
    text,
  );
  if (countedUndo) {
    const count = parseBoundedParameter(
      countedUndo[1] ?? countedUndo[2],
      TIER_A_COUNT_MIN,
      TIER_A_COUNT_MAX,
      parseSpokenCountInteger,
    );
    if (count.value !== null) {
      if (!count.valid) return reject("count_out_of_range", evidence);
      if (!setAvailable(context)) return reject("no_active_set", evidence);
      if (!context.last_attempt_available)
        return reject("no_last_attempt", evidence);
      return match({ kind: "undo_last_attempt", count: count.value }, evidence);
    }
  }

  if (
    [
      "undo that",
      "undo last",
      "undo last rep",
      "remove last rep",
      "remove the last rep",
      "take one back",
      "take one away",
    ].includes(text)
  ) {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    if (!context.last_attempt_available)
      return reject("no_last_attempt", evidence);
    return match({ kind: "undo_last_attempt" }, evidence);
  }

  const correction =
    /^(?:correct last|correct last rep) to (clean|flawed|miss)$/u.exec(text);
  if (correction) {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    if (!context.last_attempt_available)
      return reject("no_last_attempt", evidence);
    return match(
      {
        kind: "correct_last_attempt",
        verdict: correction[1] as SelfReportedVerdict,
      },
      evidence,
    );
  }

  if (["restart set", "restart the set"].includes(text)) {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    return match({ kind: "restart_set" }, evidence);
  }
  if (
    [
      "restart streak",
      "restart the streak",
      "reset streak",
      "reset the streak",
    ].includes(text)
  ) {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    return match({ kind: "reset_clean_streak" }, evidence);
  }
  if (
    ["close set", "close the set", "finish set", "finish the set"].includes(
      text,
    )
  ) {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    return match({ kind: "close_set" }, evidence);
  }

  if (text === "status" || text === "practice status") {
    if (!setAvailable(context)) return reject("no_active_set", evidence);
    return match({ kind: "practice_status" }, evidence);
  }

  if (text === "pause practice") {
    if (context.practice_state === "paused")
      return reject("already_paused", evidence);
    if (context.practice_state !== "active")
      return reject("no_active_set", evidence);
    return match({ kind: "pause_practice" }, evidence);
  }
  if (text === "resume practice") {
    if (context.practice_state === "active")
      return reject("already_active", evidence);
    if (context.practice_state !== "paused")
      return reject("no_active_set", evidence);
    return match({ kind: "resume_practice" }, evidence);
  }

  // Token-based, order-flexible, and still firewalled — see
  // `matchMetronomeCommand`. This replaced a fixed list of five sentences.
  const metronome = matchMetronomeCommand(text);
  if (metronome === "on") return match({ kind: "metronome_on" }, evidence);
  if (metronome === "off") return match({ kind: "metronome_off" }, evidence);
  if (text === "faster" || text === "slower") {
    if (!context.metronome_running && !setAvailable(context)) {
      return ignore("state_mismatch", evidence);
    }
    return match({ kind: "adjust_tempo", direction: text }, evidence);
  }

  const tempo = parseTempoCommand(text);
  if (tempo) {
    if (normalized.has_numeric_colon) {
      return reject("unsafe_numeric_punctuation", evidence);
    }
    if (hasNegativeNumericLiteral(delivery.text)) {
      return reject("invalid_tempo", evidence);
    }
    const bpm = parseBoundedParameter(
      tempo.number_text,
      TIER_A_TEMPO_MIN,
      TIER_A_TEMPO_MAX,
    );
    if (bpm.value === null) return reject("invalid_tempo", evidence);
    if (!bpm.valid) return reject("tempo_out_of_range", evidence);
    return match({ kind: tempo.kind, bpm: bpm.value }, evidence);
  }

  const retention = (
    text === "confirm retention"
      ? "confirm"
      : text === "lower retention"
        ? "lower"
        : text === "reopen target"
          ? "reopen"
          : text === "snooze retention"
            ? "snooze"
            : null
  ) satisfies RetentionVoiceAction | null;
  if (retention !== null) {
    if (!context.retention_due) return reject("retention_not_due", evidence);
    return match({ kind: "retention", action: retention }, evidence);
  }

  return ignore("not_exact_command", evidence);
}
