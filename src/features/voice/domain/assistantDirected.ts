function normalizeAssistantSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const DIRECTED_OPENING = /^(?:(?:okay|ok|so|well)\s+)?(?:can you\b|could you\b|would you\b|what\b|why\b|how\b|when\b|where\b|which\b|who\b|should i\b|do you\b|did i\b|have i\b|is (?:this|that|there)\b|are (?:these|those|there)\b|tell me\b|help me\b|i want to\b|im going to\b|im about to\b)/u;

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
