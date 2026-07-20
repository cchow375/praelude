import type { NaturalPracticeActionDraft } from "./actionDraft";
import type { ProposedAction } from "./proposedAction";

const HANDS: Record<NonNullable<NaturalPracticeActionDraft["contract"]["hands"]>, string> = {
  left: "left hand",
  right: "right hand",
  together: "hands together",
  separate: "hands separately",
};

/** A terse, app-owned read-back. Provider prose never controls this prompt. */
export function actionDraftSpeech(
  draft: NaturalPracticeActionDraft | ProposedAction,
): string {
  if (draft.kind !== "start_practice_set") {
    return `${draft.summary}. Say confirm or cancel.`;
  }
  if (draft.issues.length > 0) {
    return "I heard a practice request, but I need the exact score section. Select a section or say the measure range.";
  }

  const target = draft.target.label
    ?? (draft.target.m_start === draft.target.m_end
      ? `measure ${draft.target.m_start}`
      : `measures ${draft.target.m_start} to ${draft.target.m_end}`);
  const details = [
    draft.contract.hands ? HANDS[draft.contract.hands] : null,
    draft.contract.method,
    draft.contract.planned_attempts != null
      ? `${draft.contract.planned_attempts} attempts`
      : null,
    draft.contract.start_bpm != null
      ? `at ${draft.contract.start_bpm} beats per minute`
      : null,
  ].filter((part): part is string => Boolean(part));
  return `Start ${draft.piece_title}, ${target}${details.length ? `, ${details.join(", ")}` : ""}? Say confirm or cancel.`;
}
