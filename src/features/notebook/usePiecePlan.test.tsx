import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Real invoke path against the dev-mock's stateful piece_plan backend.
import {
  installTauriDevMock,
  uninstallTauriDevMock,
} from "../../devMock/tauriDevMock";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { usePiecePlan } from "./usePiecePlan";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

beforeEach(() => installTauriDevMock());
afterEach(() => {
  cleanup();
  uninstallTauriDevMock();
  vi.useRealTimers();
});

describe("usePiecePlan", () => {
  it("loads an empty plan when the backend has no row for the piece", async () => {
    const { result } = renderHook(() => usePiecePlan(1), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.bodyText).toBe("");
    expect(result.current.updatedAt).toBeNull();
  });

  it("saves an edit and reconciles the editor from the returned plan", async () => {
    const { result } = renderHook(() => usePiecePlan(1), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.setBodyText("Phase 1: hands separate to 96 BPM");
    });
    await waitFor(() => expect(result.current.updatedAt).not.toBeNull());
    expect(result.current.bodyText).toBe("Phase 1: hands separate to 96 BPM");
    expect(result.current.error).toBeNull();

    // Round-trips through a fresh mount for the same piece.
    const reopened = renderHook(() => usePiecePlan(1), { wrapper });
    await waitFor(() => expect(reopened.result.current.status).toBe("ready"));
    expect(reopened.result.current.bodyText).toBe(
      "Phase 1: hands separate to 96 BPM",
    );
  });

  it("flushes the outgoing plan when the piece id changes mid-edit", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ id }) => usePiecePlan(id),
      { initialProps: { id: 1 }, wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.setBodyText("draft for piece one");
    });
    // Switch pieces before the debounce elapses; the outgoing edit must persist.
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.bodyText).toBe(""); // piece 2 is blank
    unmount();

    const reopened = renderHook(() => usePiecePlan(1), { wrapper });
    await waitFor(() => expect(reopened.result.current.status).toBe("ready"));
    expect(reopened.result.current.bodyText).toBe("draft for piece one");
  });

  it("surfaces an over-length rejection as an honest error state", async () => {
    const { result } = renderHook(() => usePiecePlan(1), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.setBodyText("x".repeat(40001));
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/exceeds 40000 characters/);
  });
});
