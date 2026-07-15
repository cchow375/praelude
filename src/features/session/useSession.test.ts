import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  renderHook,
  act,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.fn();

type Handler = (e: { payload: unknown }) => void;
let listeners: Record<string, Handler>;
const unlistenMock = vi.fn();
const listenMock = vi.fn(async (event: string, cb: Handler) => {
  listeners[event] = cb;
  return unlistenMock;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...(args as [string, Handler])),
}));

import {
  useSession,
  type SessionView,
  type SessionEventView,
} from "./useSession";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

function receiptWrapper({ children }: { children: ReactNode }) {
  return createElement(ReceiptCenterProvider, null, children);
}

function makeSession(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 1,
    started_at: "2026-07-10T18:00:00Z",
    events: [],
    ...over,
  };
}

function emit(ev: SessionEventView) {
  act(() => {
    listeners["session://event"]?.({ payload: ev });
  });
}

beforeEach(() => {
  listeners = {};
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
  listenMock.mockClear();
  unlistenMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSession — IPC wiring", () => {
  it("subscribes to session://event and fetches session_current once on mount", async () => {
    invokeMock.mockResolvedValueOnce(makeSession({ id: 9 }));
    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.session?.id).toBe(9));
    expect(invokeMock).toHaveBeenCalledWith("session_current");
    expect(listenMock).toHaveBeenCalledWith(
      "session://event",
      expect.any(Function),
    );
  });

  it("prepends an incoming session://event to the timeline (newest first)", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSession({
        events: [{ ts: 1, kind: "rep", payload: { verdict: "clean" } }],
      }),
    );
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session?.events).toHaveLength(1));

    emit({ ts: 2, kind: "block_open", payload: { m: "1-8" } });

    expect(result.current.session?.events).toHaveLength(2);
    expect(result.current.session?.events[0].kind).toBe("block_open");
    expect(result.current.session?.events[1].kind).toBe("rep");
  });

  it("bootstraps via session_current when an event arrives with no session yet", async () => {
    // Mount fetch returns null (no session), then a later event triggers a
    // refetch that returns a real session.
    invokeMock.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(result.current.session).toBeNull();

    invokeMock.mockResolvedValueOnce(makeSession({ id: 5, events: [] }));
    emit({ ts: 1, kind: "session_start", payload: {} });

    await waitFor(() => expect(result.current.session?.id).toBe(5));
  });

  it("endSession() invokes session_end, clears the session, and returns the export", async () => {
    invokeMock.mockResolvedValueOnce(makeSession({ id: 3 }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session?.id).toBe(3));

    invokeMock.mockResolvedValueOnce({
      session_id: 3,
      files: ["(C) codakiller-2026-07-10.md"],
      pieces: 1,
      reps: 12,
    });

    let out: unknown;
    await act(async () => {
      out = await result.current.endSession();
    });

    expect(invokeMock).toHaveBeenCalledWith("session_end");
    expect(result.current.session).toBeNull();
    expect(out).toMatchObject({ session_id: 3, reps: 12 });
  });

  it("keeps a failed session end active and publishes an assertive error", async () => {
    invokeMock.mockResolvedValueOnce(makeSession({ id: 3 }));
    const { result } = renderHook(() => useSession(), {
      wrapper: receiptWrapper,
    });
    await waitFor(() => expect(result.current.session?.id).toBe(3));

    invokeMock.mockRejectedValueOnce({
      code: "export_failed",
      message: "The session export could not be written.",
    });
    await act(async () => {
      await expect(result.current.endSession()).rejects.toMatchObject({
        name: "CommandError",
        command: "session_end",
        code: "export_failed",
      });
    });

    expect(result.current.session?.id).toBe(3);
    expect(result.current.error).toBe("The session export could not be written.");
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toBe("The session export could not be written.");
  });

  it("caps the timeline at 200 events", async () => {
    const events: SessionEventView[] = Array.from({ length: 200 }, (_, i) => ({
      ts: i,
      kind: "rep",
      payload: {},
    }));
    invokeMock.mockResolvedValueOnce(makeSession({ events }));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.session?.events).toHaveLength(200));

    emit({ ts: 999, kind: "rep", payload: {} });

    expect(result.current.session?.events).toHaveLength(200);
    expect(result.current.session?.events[0].ts).toBe(999);
  });

  it("unsubscribes from the event on unmount", async () => {
    const { unmount } = renderHook(() => useSession());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    unmount();

    expect(unlistenMock).toHaveBeenCalled();
  });
});
