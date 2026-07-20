import { describe, expect, it } from "vitest";
import { parseSpokenConfirmationDecision } from "./spokenConfirmation";

describe("parseSpokenConfirmationDecision", () => {
  it.each(["Confirm.", "go ahead", "do it", "start the set"])(
    "accepts the exact confirmation phrase %s",
    (phrase) => expect(parseSpokenConfirmationDecision(phrase)).toBe("confirm"),
  );

  it.each(["cancel", "cancel that", "never mind"])(
    "accepts the exact cancellation phrase %s",
    (phrase) => expect(parseSpokenConfirmationDecision(phrase)).toBe("cancel"),
  );

  it.each([
    "yes I think the second phrase is harder",
    "yes",
    "no",
    "please start a new set at 80",
    "I said no yesterday",
    "maybe",
    "",
  ])("keeps non-exact speech inert: %s", (phrase) => {
    expect(parseSpokenConfirmationDecision(phrase)).toBeNull();
  });
});
