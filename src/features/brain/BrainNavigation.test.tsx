import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("opens the Brain workspace from the top-level view switcher", () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Brain" }));
    expect(screen.getByTestId("main-brain")).toBeTruthy();
  });

  it("opens Brain and forwards a wake-word question from the global voice listener", async () => {
    lastIntent = { kind: "question", text: "How do I stabilize this leap?", bpm: null };
    render(<Shell />);

    expect(await screen.findByTestId("main-brain")).toBeTruthy();
    expect(screen.getByText("How do I stabilize this leap?")).toBeTruthy();
  });
});
