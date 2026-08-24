import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrainWorkspace,
  __resetAssistantToolsConsentForTests,
  knowledgeShareLabel,
} from "./BrainWorkspace";
import type { BrainAnswer, BrainApi, BrainGroundingSummary } from "./types";
import type { PracticeBrainContext } from "./types";
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
    knowledge_share_cause: "shared",
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

const scoreContext: PracticeBrainContext = {
  piece_id: 7,
  piece_title: "Scherzo No. 2",
  composer: "Chopin",
  surface: "score",
  region: {
    id: 44,
    name: "Coda landing",
    notes: "Release before the leap",
    m_start: 720,
    m_end: 732,
  },
  current_page: 18,
  edition_id: "ekier.pdf",
  edition_label: "Ekier National Edition",
  active_block: {
    block_id: 99,
    m_start: 720,
    m_end: 732,
    bpm: 80,
    target_bpm: 96,
    focus: "tempo",
    use_metronome: true,
    reps_done: 2,
    planned_reps: 5,
    attempts_recorded: 2,
    tries: 2,
    current_clean_streak: 1,
    mastery_progress_streak: 1,
    required_clean_streak: 5,
    mastery_status: "not_satisfied",
    mastery_verified: true,
    set_state: "active",
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
  beforeEach(() => __resetAssistantToolsConsentForTests());

  it("sends each wake question once as Voice with the exact shell context", async () => {
    const answer = {
      ...groundedAnswer,
      id: "voice-answer-1",
      proposed_action: {
        kind: "tempo",
        summary: "Set the metronome to 80 BPM",
        bpm: 80,
      },
    } satisfies BrainAnswer;
    const api = makeApi(answer);
    const onProposedAction = vi.fn();
    const props = {
      api,
      invoker: makeInvoker(),
      practiceContext: scoreContext,
      onProposedAction,
    };
    const { rerender } = render(
      <BrainWorkspace
        {...props}
        wakeQuestion={{ id: 1, text: "How should I work on this?" }}
      />,
    );

    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    expect(api.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "How should I work on this?",
        source: "voice",
        piece_id: 7,
        context: scoreContext,
      }),
    );
    expect(onProposedAction).toHaveBeenCalledWith({
      answerId: "voice-answer-1",
      pieceId: 7,
      targetBlockId: 99,
      action: {
        kind: "tempo",
        summary: "Set the metronome to 80 BPM",
        bpm: 80,
      },
    });

    // A rerender of the same event identity cannot ask or propose twice.
    rerender(
      <BrainWorkspace
        {...props}
        wakeQuestion={{ id: 1, text: "How should I work on this?" }}
      />,
    );
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    expect(onProposedAction).toHaveBeenCalledTimes(1);
  });

  it("never surfaces a proposed mutation from a typed answer", async () => {
    const api = makeApi({
      ...groundedAnswer,
      proposed_action: {
        kind: "tempo",
        summary: "Set the metronome to 80 BPM",
        bpm: 80,
      },
    });
    const onProposedAction = vi.fn();
    render(
      <BrainWorkspace
        api={api}
        invoker={makeInvoker()}
        practiceContext={scoreContext}
        onProposedAction={onProposedAction}
      />,
    );

    fireEvent.change(await screen.findByLabelText("Ask Coda"), {
      target: { value: "Set the tempo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);
    expect(onProposedAction).not.toHaveBeenCalled();
  });

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
      tools_consent: false,
    });
    // Citation chips.
    const chips = screen.getByLabelText("Citations");
    expect(chips.textContent).toContain("The Musician's Way, Chapter 9");
    expect(chips.textContent).toContain("source-1");
  });

  it("reports provider configuration without claiming a network check", async () => {
    render(<BrainWorkspace api={makeApi()} invoker={makeInvoker()} />);
    expect(await screen.findByText("● configured — gemini")).toBeTruthy();
  });

  it("shows the exact score and active-set context before the user asks", async () => {
    render(
      <BrainWorkspace
        api={makeApi()}
        invoker={makeInvoker()}
        practiceContext={{ ...scoreContext, today_plan: "Secure the coda" }}
      />,
    );

    const strip = await screen.findByLabelText("Current Assistant context");
    expect(strip.textContent).toContain("Coda sees");
    expect(strip.textContent).toContain("Scherzo No. 2");
    expect(strip.textContent).toContain("Coda landing");
    expect(strip.textContent).toContain("mm. 720–732");
    expect(strip.textContent).toContain("page 18");
    expect(strip.textContent).toContain("Ekier National Edition");
    expect(strip.textContent).toContain("active set · 2/5 attempts");
    expect(strip.textContent).toContain("Today plan included");
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

  it("waits for durable memory before sending an immediate wake question", async () => {
    let resolveResume!: (value: { thread_id: number; turns: [] }) => void;
    const api = makeApi();
    vi.mocked(api.resumeThread).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }),
    );
    render(
      <BrainWorkspace
        api={api}
        invoker={makeInvoker()}
        practiceContext={scoreContext}
        wakeQuestion={{ id: 1, text: "What happened last time?" }}
      />,
    );

    expect(
      (
        (await screen.findByRole("button", {
          name: "Loading memory…",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(api.ask).not.toHaveBeenCalled();
    resolveResume({ thread_id: 42, turns: [] });
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    expect(api.ask).toHaveBeenCalledWith(
      expect.objectContaining({ thread_id: 42, piece_id: 7 }),
    );
  });

  it("drops a late answer and action after the user switches pieces", async () => {
    let resolveAnswer!: (value: BrainAnswer) => void;
    const api = makeApi();
    vi.mocked(api.ask).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const onProposedAction = vi.fn();
    const invoker = makeInvoker({
      pieces_list: [
        {
          id: 7,
          title: "Scherzo No. 2",
          composer: "Chopin",
          has_xml: true,
          has_pdf: true,
          intake_done: true,
        },
        {
          id: 8,
          title: "Ballade No. 1",
          composer: "Chopin",
          has_xml: true,
          has_pdf: true,
          intake_done: true,
        },
      ],
    });
    render(
      <BrainWorkspace
        api={api}
        invoker={invoker}
        practiceContext={scoreContext}
        wakeQuestion={{ id: 1, text: "How should I work on this?" }}
        onProposedAction={onProposedAction}
      />,
    );
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Piece thread"), {
      target: { value: "8" },
    });
    resolveAnswer({
      ...groundedAnswer,
      id: "late-answer",
      answer: "This belongs to the Scherzo.",
      proposed_action: {
        kind: "verdict",
        summary: "Log clean",
        verdict: "clean",
        note: null,
      },
    });

    await waitFor(() => expect(api.resumeThread).toHaveBeenCalledWith(8));
    expect(screen.queryByText("This belongs to the Scherzo.")).toBeNull();
    expect(onProposedAction).not.toHaveBeenCalled();
  });

  it("keeps the selected piece thread when transient shell context disappears", async () => {
    const props = { api: makeApi(), invoker: makeInvoker() };
    const { rerender } = render(
      <BrainWorkspace {...props} practiceContext={scoreContext} />,
    );
    await waitFor(() => expect(props.api.resumeThread).toHaveBeenCalledWith(7));
    rerender(<BrainWorkspace {...props} practiceContext={undefined} />);
    expect(
      (screen.getByLabelText("Piece thread") as HTMLSelectElement).value,
    ).toBe("7");
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

  it("shows the consent card before the first question of the session, not after", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    expect(
      await screen.findByText(
        /Assistant may read practice data this session/i,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Allow"));
    expect(
      screen.queryByText(/Assistant may read practice data this session/i),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "what's stalling?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);

    expect(api.ask).toHaveBeenCalledWith(
      expect.objectContaining({ tools_consent: true }),
    );
  });

  it("never re-shows the consent card for a second question in the same session", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);

    fireEvent.click(
      await screen.findByText("Just answer without it"),
    );
    expect(
      screen.queryByText(/Assistant may read practice data this session/i),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "how do I fix this passage?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);
    expect(
      screen.queryByText(/Assistant may read practice data this session/i),
    ).toBeNull();
    expect(api.ask).toHaveBeenCalledWith(
      expect.objectContaining({ tools_consent: false }),
    );

    // Asking again does not resurrect the card either — consent is
    // session-scoped, not per-question.
    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "one more question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(/Assistant may read practice data this session/i),
    ).toBeNull();
  });

  it("renders a provenance chip for each tool consulted in a tool-grounded answer", async () => {
    const api = makeApi({
      ...groundedAnswer,
      tool_provenance: [
        {
          tool: "streak_summary",
          args_human: "",
          summary: "current streak 3 day(s), best 7",
        },
      ],
    });
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);
    fireEvent.click(screen.getByText("Allow"));

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "what's my streak?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);

    expect(screen.getByText("streak_summary")).toBeTruthy();
  });

  it("renders no provenance chips when an answer carries no tool receipts", async () => {
    const api = makeApi(groundedAnswer);
    render(<BrainWorkspace api={api} invoker={makeInvoker()} />);
    fireEvent.click(screen.getByText("Allow"));

    fireEvent.change(screen.getByLabelText("Ask Coda"), {
      target: { value: "How should I practice the coda leap?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);

    expect(screen.queryByLabelText("Tools consulted")).toBeNull();
  });
});

// The grounding receipt used to collapse every non-shared state into "Book
// excerpts stayed on this Mac", which read as "the content is hidden from the
// assistant". These pin the exact copy for each cause the backend can report.
describe("knowledgeShareLabel", () => {
  const grounding = (
    cause: BrainGroundingSummary["knowledge_share_cause"],
    shared: boolean,
  ): BrainGroundingSummary => ({
    ...groundedAnswer.grounding!,
    knowledge_shared_with_provider: shared,
    knowledge_share_cause: cause,
  });

  it("names the shared case", () => {
    expect(knowledgeShareLabel(grounding("shared", true), "claude")).toBe(
      "Retrieved excerpts shared with provider",
    );
  });

  it("says nothing matched rather than implying content was withheld", () => {
    const label = knowledgeShareLabel(grounding("no_matches", false), "claude");
    expect(label).toBe("No book excerpts matched this question");
    expect(label).not.toMatch(/stayed|hidden|kept/i);
  });

  it("names the privacy setting when sharing is what held excerpts back", () => {
    expect(
      knowledgeShareLabel(grounding("sharing_disabled", false), "claude"),
    ).toBe("Book excerpts are kept on this Mac (sharing is off in Settings)");
  });

  it("names an empty library and a fully local answer", () => {
    expect(knowledgeShareLabel(grounding("no_library", false), "claude")).toBe(
      "No knowledge books are indexed yet",
    );
    expect(knowledgeShareLabel(grounding("offline", false), "offline")).toBe(
      "Answered on this Mac — nothing was sent",
    );
  });

  it("falls back to the boolean when an older payload carries no cause", () => {
    expect(knowledgeShareLabel(grounding(undefined, false), "claude")).toBe(
      "No book excerpts matched this question",
    );
    expect(knowledgeShareLabel(grounding(undefined, true), "claude")).toBe(
      "Retrieved excerpts shared with provider",
    );
  });
});
