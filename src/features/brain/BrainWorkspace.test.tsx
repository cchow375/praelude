import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrainWorkspace } from "./BrainWorkspace";
import type { BrainAnswer, BrainApi } from "./types";
import type { CommandInvoker } from "../../services/command";

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
  grounding: {
    piece_title: "Scherzo No. 2",
    region_name: "Coda leap",
    measure_range: [720, 732],
    recent_rep_count: 5,
    active_block_included: true,
    knowledge_status: "ready",
    knowledge_shared_with_provider: true,
    knowledge_sources: [
      "Gebrian — Learn Faster",
      "Roskell — The Complete Pianist",
      "Breth — Effective Practicing",
    ],
    musicxml_status: "ready",
    warnings: ["The MusicXML edition may differ from the open PDF"],
  },
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
        goal_id: null,
        title: "Coda landing",
        m_start: null,
        m_end: null,
        score: 72,
        reasons: ["3 of the last 5 attempts were flawed or failed"],
      },
    ]),
    schedule: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue({ thread_id: 100, turns: [] }),
    clearThread: vi.fn().mockResolvedValue(undefined),
  };
}

/** A command.ts invoker seam covering the two commands this workspace owns
 *  directly (brain_status + pieces_list). Overridable per-test. */
function makeInvoker(
  overrides: Partial<Record<string, unknown>> = {},
): CommandInvoker {
  const table: Record<string, unknown> = {
    brain_status: { online: true, provider: "gemini", reason: null },
    pieces_list: [
      {
        id: 7,
        title: "Scherzo No. 2",
        composer: "Chopin",
        has_xml: true,
        has_pdf: true,
        intake_done: true,
      },
    ],
    ...overrides,
  };
  return vi.fn(async (command: string) => table[command] ?? null);
}

afterEach(cleanup);

describe("BrainWorkspace", () => {
  it("asks a typed question and renders the one-glance answer plus citation chips", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.change(await screen.findByLabelText("Ask Coda"), {
      target: { value: "How should I practice the coda leap?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    // One-glance answer rendered plainly.
    await screen.findByText(
      "Use a short, silent landing before rebuilding the leap.",
    );
    expect(api.ask).toHaveBeenCalledWith({
      question: "How should I practice the coda leap?",
      source: "typed",
      piece_id: null,
      thread_id: null,
      history: [],
      context: null,
    });
    // Citation chips.
    const chips = screen.getByLabelText("Citations");
    expect(chips.textContent).toContain("The Musician's Way, Chapter 9");
    expect(chips.textContent).toContain("source-1");
  });

  it("renders a persistent online status line from brain_status", async () => {
    render(<BrainWorkspace api={makeApi()} invoker={makeInvoker()} />);
    expect(await screen.findByText("● online — gemini")).toBeTruthy();
  });

  it("renders the truthful offline reason in the status line", async () => {
    render(
      <BrainWorkspace
        api={makeApi()}
        invoker={makeInvoker({
          brain_status: {
            online: false,
            provider: null,
            reason: "key present but network unreachable",
          },
        })}
      />,
    );
    expect(
      await screen.findByText(
        "○ offline — key present but network unreachable",
      ),
    ).toBeTruthy();
  });

  it("resumes durable prior turns when a piece is selected", async () => {
    const api = makeApi();
    vi.mocked(api.resumeThread).mockResolvedValue({
      thread_id: 42,
      turns: [
        {
          role: "user",
          content: "Why does the coda miss?",
          provider: null,
          citations: [],
          created_ts: "t1",
        },
        {
          role: "assistant",
          content: "Release the wrist before the leap.",
          provider: "claude",
          citations: [],
          created_ts: "t2",
        },
      ],
    });
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.change(await screen.findByLabelText("Piece thread"), {
      target: { value: "7" },
    });

    expect(
      await screen.findByText("Release the wrist before the leap."),
    ).toBeTruthy();
    expect(screen.getByText("Why does the coda miss?")).toBeTruthy();
    await waitFor(() => expect(api.resumeThread).toHaveBeenCalledWith(7));
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("passes the resumed thread_id and piece context through on each ask", async () => {
    const api = makeApi();
    vi.mocked(api.resumeThread).mockResolvedValue({ thread_id: 42, turns: [] });
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.change(await screen.findByLabelText("Piece thread"), {
      target: { value: "7" },
    });
    await waitFor(() => expect(api.resumeThread).toHaveBeenCalledWith(7));

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "How do I fix it?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(api.ask).toHaveBeenLastCalledWith(
        expect.objectContaining({
          thread_id: 42,
          piece_id: 7,
          context: expect.objectContaining({
            piece_id: 7,
            piece_title: "Scherzo No. 2",
          }),
        }),
      ),
    );
  });

  it("shows the deterministic next-work suggestions independently of AI answers", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    expect(await screen.findByText("Coda landing")).toBeTruthy();
    expect(
      screen.getByText("3 of the last 5 attempts were flawed or failed"),
    ).toBeTruthy();
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("adds a Goal suggestion to Calendar only after explicit confirmation", async () => {
    const api = makeApi();
    vi.mocked(api.planPreview).mockResolvedValue([
      {
        id: "goal:9",
        kind: "goal",
        goal_id: 9,
        title: "Secure the coda",
        m_start: null,
        m_end: null,
        score: 80,
        reasons: ["due in 2 days"],
      },
    ]);
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    expect(api.schedule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Date for Secure the coda"), {
      target: { value: "2026-07-14" },
    });
    fireEvent.change(screen.getByLabelText("Minutes for Secure the coda"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));

    await waitFor(() =>
      expect(api.schedule).toHaveBeenCalledWith({
        goal_id: 9,
        title: "Secure the coda",
        minutes: 25,
        date: "2026-07-14",
      }),
    );
    expect(await screen.findByText("Added to Calendar.")).toBeTruthy();
  });

  it("keeps intake suggestions local until explicit Save and sends edited fields only then", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);
    fireEvent.change(await screen.findByLabelText("Ask Coda"), {
      target: { value: "Review my intake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const suggestion = await screen.findByLabelText("Suggested Current state");
    expect(api.applyIntakeReview).not.toHaveBeenCalled();
    fireEvent.change(suggestion, {
      target: { value: "The coda leap breaks above 96 BPM." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save suggested changes" }),
    );
    await waitFor(() =>
      expect(api.applyIntakeReview).toHaveBeenCalledWith({
        answer_id: "answer-1",
        piece_id: 7,
        changes: [
          {
            field: "current_state",
            value: "The coda leap breaks above 96 BPM.",
          },
        ],
      }),
    );
    expect(await screen.findByText("Saved to intake.")).toBeTruthy();
  });

  it("shows an error without discarding the typed question", async () => {
    const api = makeApi();
    vi.mocked(api.ask).mockRejectedValue(new Error("Provider unavailable"));
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);
    const input = (await screen.findByLabelText(
      "Ask Coda",
    )) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep this question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Provider unavailable",
    );
    expect(input.value).toBe("Keep this question");
  });

  it("clears the conversation and starts a fresh empty thread", async () => {
    const api = makeApi();
    vi.mocked(api.resumeThread)
      .mockResolvedValueOnce({
        thread_id: 42,
        turns: [
          {
            role: "user",
            content: "Old question",
            provider: null,
            citations: [],
            created_ts: "t1",
          },
          {
            role: "assistant",
            content: "Old answer stays until cleared.",
            provider: "offline",
            citations: [],
            created_ts: "t2",
          },
        ],
      })
      .mockResolvedValue({ thread_id: 43, turns: [] });
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.change(await screen.findByLabelText("Piece thread"), {
      target: { value: "7" },
    });
    expect(
      await screen.findByText("Old answer stays until cleared."),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("brain-clear-conversation"));

    await waitFor(() => expect(api.clearThread).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(screen.queryByText("Old answer stays until cleared.")).toBeNull(),
    );
  });
});
