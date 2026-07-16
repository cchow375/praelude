import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let lastIntent: { kind: string; text: string; bpm: number | null } | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((command: string) =>
    Promise.resolve(command === "pieces_list" || command === "brain_plan_preview" ? [] : command === "brain_ask" ? {
      id: "voice-answer",
      answer: "Try three slow landings.",
      provider: "offline",
      citations: [],
      methods: [],
      intake_review: null,
    } : null)),
}));
vi.mock("../voice/useVoice", () => ({
  useVoice: () => ({
    status: "live",
    mute: vi.fn(),
    lastIntent,
    downGuidance: null,
  }),
}));
vi.mock("../rep/useRep", () => ({
  useRep: () => ({ snap: null, feed: [], error: null, open: vi.fn(), check: vi.fn(), close: vi.fn() }),
}));
vi.mock("../session/useSession", () => ({
  useSession: () => ({ session: null, endSession: vi.fn() }),
}));

import { Shell } from "../../components/Shell";

afterEach(() => {
  cleanup();
  lastIntent = null;
});

describe("Brain navigation", () => {
  it("opens the persistent Brain drawer without leaving the current workspace", () => {
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Brain" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("main-brain")).toBeTruthy();
  });

  it("opens Brain and forwards a wake-word question from the global voice listener", async () => {
    lastIntent = { kind: "question", text: "How do I stabilize this leap?", bpm: null };
    render(<Shell />);

    await screen.findByText("How do I stabilize this leap?");
    expect(screen.getByRole("button", { name: "Brain" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("How do I stabilize this leap?")).toBeTruthy();
  });

  it("keeps the conversation mounted across drawer collapse and reopen", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    fireEvent.change(screen.getByLabelText("Ask Coda"), { target: { value: "How do I land this leap?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Try three slow landings.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Practice Brain" }));
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    expect(screen.getByText("Try three slow landings.")).toBeTruthy();
  });

  it("returns keyboard focus to the Brain tool when the drawer closes", async () => {
    render(<Shell />);
    const trigger = screen.getByRole("button", { name: "Brain" });
    fireEvent.click(trigger);
    const collapse = screen.getByRole("button", { name: "Collapse Practice Brain" });
    collapse.focus();
    fireEvent.click(collapse);
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    screen.getByLabelText("Ask Coda").focus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
