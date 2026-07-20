function normalizeAssistantSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const DIRECTED_OPENING = /^(?:can you|could you|would you|what\b|why\b|how\b|when\b|where\b|tell me\b|help me\b|i want to\b|im going to\b|im about to\b)/u;

/**
 * Conservative no-wake Brain boundary. It accepts only whole utterances whose
 * opening explicitly addresses an assistant or frames a question/intention.
 * Natural practice-set parsing runs first; handled hot-loop commands never
 * reach this classifier.
 */
export function parseAssistantDirectedQuestion(text: string): string | null {
  const normalized = normalizeAssistantSpeech(text);
  if (normalized.length < 4 || !DIRECTED_OPENING.test(normalized)) return null;
  return text.trim() || null;
}
