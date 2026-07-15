import { describe, expect, it, vi } from "vitest";
import {
  CommandError,
  commandErrorMessage,
  defineCommand,
  executeCommand,
  normalizeCommandError,
} from "./command";

describe("typed command boundary", () => {
  it("invokes a definition with typed arguments and returns its result", async () => {
    const command = defineCommand<{ id: number }, { title: string }>(
      "piece_get",
      "The piece could not be loaded.",
    );
    const invoker = vi.fn().mockResolvedValue({ title: "Scherzo" });

    const result = await executeCommand(command, { id: 7 }, invoker);

    expect(invoker).toHaveBeenCalledWith("piece_get", { id: 7 });
    expect(result.title).toBe("Scherzo");
  });

  it("normalizes structured native failures with a stable code", async () => {
    const command = defineCommand<undefined, null>(
      "session_end",
      "The session could not be ended.",
    );
    const invoker = vi.fn().mockRejectedValue({
      code: "export_failed",
      message: "The session summary could not be written.",
    });

    await expect(executeCommand(command, undefined, invoker)).rejects.toMatchObject({
      name: "CommandError",
      command: "session_end",
      code: "export_failed",
      message: "The session summary could not be written.",
    });
  });

  it("uses the command fallback for opaque values instead of stringifying objects", () => {
    const error = normalizeCommandError(
      "rep_open",
      "The practice block could not be opened.",
      { unexpected: true },
    );

    expect(error).toBeInstanceOf(CommandError);
    expect(error.message).toBe("The practice block could not be opened.");
    expect(error.message).not.toContain("[object Object]");
  });

  it("preserves useful string and Error messages", () => {
    expect(commandErrorMessage("database busy", "fallback")).toBe("database busy");
    expect(commandErrorMessage(new Error("permission denied"), "fallback")).toBe(
      "permission denied",
    );
  });
});
