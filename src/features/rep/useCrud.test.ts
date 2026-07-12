import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
import { useCrud } from "./useCrud";

describe("useCrud", () => {
  beforeEach(() => invokeMock.mockReset().mockResolvedValue(null));

  it("uses camelCase command arguments and nested snake_case patches", () => {
    const { result } = renderHook(() => useCrud());
    void result.current.blockUpdate(9, { region_id: 3 });
    expect(invokeMock).toHaveBeenCalledWith("block_update", {
      blockId: 9,
      patch: { region_id: 3 },
    });
  });
});
