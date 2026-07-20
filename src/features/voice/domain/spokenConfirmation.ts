export type SpokenConfirmationDecision = "confirm" | "cancel";

function normalizeDecision(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

const CONFIRM_PHRASES = new Set([
  "confirm",
  "go ahead",
  "do it",
  "start it",
  "start the set",
]);

const CANCEL_PHRASES = new Set([
  "cancel",
  "cancel that",
  "never mind",
  "nevermind",
]);

/**
 * Pending confirmation is a tiny deterministic voice mode. Only an exact,
 * whole-utterance phrase can decide a draft; ambient prose and partial matches
 * remain inert.
 */
export function parseSpokenConfirmationDecision(
  text: string,
): SpokenConfirmationDecision | null {
  const normalized = normalizeDecision(text);
  if (CONFIRM_PHRASES.has(normalized)) return "confirm";
  if (CANCEL_PHRASES.has(normalized)) return "cancel";
  return null;
}
