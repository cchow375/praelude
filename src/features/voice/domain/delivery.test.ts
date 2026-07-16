import { describe, expect, it } from "vitest";
import {
  createVoiceDeliveryLedger,
  registerVoiceDelivery,
  validateVoiceDelivery,
  type VoiceTranscriptDelivery,
} from "./delivery";

function delivery(
  delivery_id: string,
  revision: number,
  text = "clean",
): VoiceTranscriptDelivery {
  return {
    delivery_id,
    revision,
    text,
    is_final: true,
    recognition: { source: "macos_speech", confidence: null },
  };
}

describe("voice delivery identity", () => {
  it("accepts identical transcript text again under a different delivery id", () => {
    const first = registerVoiceDelivery(
      createVoiceDeliveryLedger(),
      delivery("attempt-a", 0),
    );
    const second = registerVoiceDelivery(
      first.ledger,
      delivery("attempt-b", 0),
    );

    expect(first.disposition.kind).toBe("accepted_new");
    expect(second.disposition.kind).toBe("accepted_new");
    expect(second.ledger.latest_revision_by_delivery_id.size).toBe(2);
  });

  it("treats only the exact delivery id and revision replay as a duplicate", () => {
    const first = registerVoiceDelivery(
      createVoiceDeliveryLedger(),
      delivery("utterance-1", 3, "set tempo ninety"),
    );
    const replay = registerVoiceDelivery(
      first.ledger,
      delivery("utterance-1", 3, "set tempo ninety"),
    );

    expect(replay.disposition).toMatchObject({
      kind: "duplicate",
      identity: { delivery_id: "utterance-1", revision: 3 },
    });
    expect(replay.ledger).toBe(first.ledger);
  });

  it("does not let changed text bypass an exact transport identity replay", () => {
    const first = registerVoiceDelivery(
      createVoiceDeliveryLedger(),
      delivery("utterance-1", 3, "set tempo ninety"),
    );
    const impossibleRewrite = registerVoiceDelivery(
      first.ledger,
      delivery("utterance-1", 3, "set tempo one hundred"),
    );

    expect(impossibleRewrite.disposition.kind).toBe("duplicate");
  });

  it("accepts a higher progressive revision and records which revision it replaces", () => {
    const first = registerVoiceDelivery(
      createVoiceDeliveryLedger(),
      delivery("progressive", 4, "set tempo ninety"),
    );
    const revised = registerVoiceDelivery(
      first.ledger,
      delivery("progressive", 5, "set tempo ninety six"),
    );

    expect(revised.disposition).toMatchObject({
      kind: "accepted_revision",
      previous_revision: 4,
      identity: { delivery_id: "progressive", revision: 5 },
    });
    expect(revised.ledger.latest_revision_by_delivery_id.get("progressive")).toBe(5);
  });

  it("rejects an out-of-order older revision without moving the ledger backwards", () => {
    const latest = registerVoiceDelivery(
      createVoiceDeliveryLedger(),
      delivery("progressive", 8),
    );
    const stale = registerVoiceDelivery(
      latest.ledger,
      delivery("progressive", 7),
    );

    expect(stale.disposition).toMatchObject({
      kind: "stale_revision",
      latest_revision: 8,
    });
    expect(stale.ledger).toBe(latest.ledger);
  });

  it("validates identity and recognizer confidence at the boundary", () => {
    expect(validateVoiceDelivery(delivery("", 0))).toBe("empty_delivery_id");
    expect(validateVoiceDelivery(delivery("x".repeat(129), 0))).toBe("delivery_id_too_long");
    expect(validateVoiceDelivery(delivery("a", -1))).toBe("invalid_revision");
    expect(validateVoiceDelivery(delivery("a", 0))).toBeNull();
    expect(validateVoiceDelivery({
      ...delivery("a", 0),
      recognition: { source: "macos_speech", confidence: 1.2 },
    })).toBe("invalid_confidence");
  });
});
