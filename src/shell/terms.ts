// Product nouns shown to the user. Christian's decision is final:
// Brain → "Assistant", Ledger → "History".
//
// Only what a user READS lives here. Internal identifiers — command names like
// `brain_ask`, TypeScript types (`PracticeBrainContext`, `LedgerSurface`),
// file/dir names, CSS classes (`brain-connection`), and test ids
// (`workspace-brain`) — intentionally keep their original names. The spoken
// wake word "Coda" and the voice command grammar are a How-To-Use surface and
// are not renamed here either.

/** The plain-English helper surface (formerly "Brain"). */
export const ASSISTANT = "Assistant";

/** The immutable practice-record surface (formerly "Ledger"). */
export const HISTORY = "History";

/** Lowercase variants for mid-sentence prose. */
export const ASSISTANT_LOWER = "assistant";
export const HISTORY_LOWER = "history";
