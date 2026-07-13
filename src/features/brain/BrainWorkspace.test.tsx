import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainWorkspace } from "./BrainWorkspace";
import type { BrainAnswer, BrainApi } from "./types";

const groundedAnswer: BrainAnswer = {
  id: "answer-1",
  answer: "Use a short, silent landing before rebuilding the leap.",
  provider: "claude",
  citations: [
    {
      source_id: "source-1",
      label: "The Musician's Way, Chapter 9",
      excerpt: "Separate the motion before reconnecting it.",
    },
  ],
  methods: [
    {
      id: "silent-landing",
      name: "Silent landing",
      why: "Separates the arrival shape from the leap.",
      dose: "3 silent placements, then 5 slow repetitions",
      watch_for: "Keep the wrist loose; stop if it locks.",
    },
  ],
  intake_review: {
    piece_id: 7,
    piece_title: "Scherzo No. 2",
    summary: "One possible clarification. Nothing changes until you save.",
    fields: [
      {
        field: "current_state",
        label: "Current state",
        current: "The coda is messy.",
        proposed: "The coda leap is inconsistent above 92 BPM.",
      },
    ],
  },
};

function makeApi(answer: BrainAnswer = groundedAnswer): BrainApi {
  return {
    ask: vi.fn().mockResolvedValue(answer),
    applyIntakeReview: vi.fn().mockResolvedValue({
      piece_id: 7,
      saved_at: "2026-07-12T22:00:00Z",
    }),
    planPreview: vi.fn().mockResolvedValue([
      {
        id: "region:4",
        kind: "revisit",
        title: "Coda landing",
        m_start: null,
        m_end: null,
        score: 72,
        reasons: ["3 of the last 5 attempts were flawed or failed"],
      },
    ]),
  };
}

afterEach(cleanup);

describe("BrainWorkspace", () => {
  it("shows the deterministic next-work trace independently of AI answers", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} />);

    expect(await screen.findByRole("heading", { name: "Ranked from your real practice graph" })).toBeTruthy();
    expect(await screen.findByText("Coda landing")).toBeTruthy();
    expect(screen.getByText("3 of the last 5 attempts were flawed or failed")).toBeTruthy();
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("asks a typed question and renders a grounded answer, method, and citation", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} />);

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "How should I practice the coda leap?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await screen.findByText("Use a short, silent landing before rebuilding the leap.");
    expect(api.ask).toHaveBeenCalledWith({
      question: "How should I practice the coda leap?",
      source: "typed",
    });
    expect(screen.getByRole("heading", { name: "Silent landing" })).toBeTruthy();
    expect(screen.getByText(/The Musician's Way, Chapter 9/)).toBeTruthy();
    expect(screen.getAllByText("Claude")).toHaveLength(2);
  });

  it("submits a wake-word question once and marks it as voice input", async () => {
    const api = makeApi();
    const { rerender } = render(
      <BrainWorkspace api={api} wakeQuestion={{ id: 1, text: "Why does this leap keep missing?" }} />,
    );

    await waitFor(() => expect(api.ask).toHaveBeenCalledWith({
      question: "Why does this leap keep missing?",
      source: "voice",
    }));
    rerender(
      <BrainWorkspace api={api} wakeQuestion={{ id: 1, text: "Why does this leap keep missing?" }} />,
    );
    expect(api.ask).toHaveBeenCalledTimes(1);
  });

  it("shows offline and error states without discarding the typed question", async () => {
    const offline = makeApi({ ...groundedAnswer, provider: "offline" });
    const { unmount } = render(<BrainWorkspace api={offline} />);
    fireEvent.change(screen.getByLabelText("Ask Coda"), { target: { value: "What can I do offline?" } });
    fireEvent.submit(screen.getByRole("form", { name: "Ask the practice brain" }));
    expect(await screen.findAllByText("Offline library")).toHaveLength(2);
    unmount();

    const failing = makeApi();
    vi.mocked(failing.ask).mockRejectedValue(new Error("Provider unavailable"));
    render(<BrainWorkspace api={failing} />);
    const input = screen.getByLabelText("Ask Coda") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep this question" } });
    fireEvent.submit(screen.getByRole("form", { name: "Ask the practice brain" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Provider unavailable");
    expect(input.value).toBe("Keep this question");
  });

  it("keeps intake suggestions local until explicit Save and sends edited fields only then", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText("Ask Coda"), { target: { value: "Review my intake" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const suggestion = await screen.findByLabelText("Suggested Current state");
    expect(api.applyIntakeReview).not.toHaveBeenCalled();
    fireEvent.change(suggestion, {
      target: { value: "The coda leap breaks above 96 BPM." },
    });
    expect(screen.getByText("The coda is messy.")).toBeTruthy();
    expect(api.applyIntakeReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save suggested changes" }));
    await waitFor(() => expect(api.applyIntakeReview).toHaveBeenCalledWith({
      answer_id: "answer-1",
      piece_id: 7,
      changes: [{ field: "current_state", value: "The coda leap breaks above 96 BPM." }],
    }));
    expect(await screen.findByText("Saved to intake.")).toBeTruthy();
  });
});
