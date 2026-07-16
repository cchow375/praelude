import { describe, expect, it } from "vitest";
import { commandIdForVoice, createCommandId, MAX_NATIVE_COMMAND_ID_LENGTH } from "./commandId";

describe("durable command identities", () => {
  it("creates distinct bounded UI identities with a readable operation prefix", () => {
    const first = createCommandId("Pause Practice");
    const second = createCommandId("Pause Practice");
    expect(first).toMatch(/^ui:pause-practice:/u);
    expect(second).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(MAX_NATIVE_COMMAND_ID_LENGTH);
  });

  it("maps exact voice delivery id plus revision deterministically", () => {
    expect(commandIdForVoice({ delivery_id: "speech-48", revision: 3 }))
      .toBe("voice:speech-48:r3");
    expect(commandIdForVoice({ delivery_id: "speech-48", revision: 4 }))
      .not.toBe(commandIdForVoice({ delivery_id: "speech-48", revision: 3 }));
  });

  it("rejects an operation that cannot form a bounded identity", () => {
    expect(() => createCommandId("🎹")).toThrow(/operation/u);
    expect(() => commandIdForVoice({ delivery_id: "x".repeat(200), revision: 0 }))
      .toThrow(/too long/u);
  });
});
