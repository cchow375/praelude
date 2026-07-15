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
    expect(api.planPreview).toHaveBeenCalledWith(null);
    expect(api.ask).not.toHaveBeenCalled();
  });

  it("adds a Goal suggestion to Calendar only after explicit confirmation", async () => {
    const api = makeApi();
    vi.mocked(api.planPreview).mockResolvedValue([{
      id: "goal:9",
      kind: "goal",
      goal_id: 9,
      title: "Secure the coda",
      m_start: null,
      m_end: null,
      score: 80,
      reasons: ["due in 2 days"],
    }]);
    render(<BrainWorkspace api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
    expect(api.schedule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Date for Secure the coda"), { target: { value: "2026-07-14" } });
    fireEvent.change(screen.getByLabelText("Minutes for Secure the coda"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));

    await waitFor(() => expect(api.schedule).toHaveBeenCalledWith({
      goal_id: 9,
      title: "Secure the coda",
      minutes: 25,
      date: "2026-07-14",
    }));
    expect(await screen.findByText("Added to Calendar.")).toBeTruthy();
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
      piece_id: null,
      history: [],
      context: null,
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
      piece_id: null,
      history: [],
      context: null,
    }));
    rerender(
      <BrainWorkspace api={api} wakeQuestion={{ id: 1, text: "Why does this leap keep missing?" }} />,
    );
    expect(api.ask).toHaveBeenCalledTimes(1);
  });

  it("shows exact score grounding and sends bounded prior turns on follow-up", async () => {
    const api = makeApi();
    render(<BrainWorkspace compact api={api} practiceContext={{
      piece_id: 7,
      piece_title: "Scherzo No. 2",
      composer: "Chopin",
      surface: "score",
      region: { id: 4, name: "Coda leap", notes: "Release before the jump", m_start: 720, m_end: 732 },
      current_page: 14,
      edition_id: "urtext",
      edition_label: "Urtext",
      active_block: null,
    }} />);

    expect(screen.getByText("Coda leap · mm. 720–732")).toBeTruthy();
    await waitFor(() => expect(api.planPreview).toHaveBeenLastCalledWith(7));
    fireEvent.change(screen.getByLabelText("Ask Coda"), { target: { value: "Why does it miss?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(groundedAnswer.answer);
    expect(screen.getByText("3 knowledge books indexed")).toBeTruthy();
    expect(screen.getByText("MusicXML included")).toBeTruthy();
    expect(screen.getByText("Retrieved excerpts shared with provider")).toBeTruthy();
    expect(screen.getByText("Answer context: Scherzo No. 2 · Coda leap · mm. 720–732")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Ask Coda"), { target: { value: "What should I change first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(api.ask).toHaveBeenLastCalledWith(expect.objectContaining({
      question: "What should I change first?",
      piece_id: 7,
      history: [
        { role: "user", content: "Why does it miss?" },
        { role: "assistant", content: groundedAnswer.answer },
      ],
      context: expect.objectContaining({ piece_id: 7, region: expect.objectContaining({ id: 4 }) }),
    })));
  });

  it("omits the BPM label when the active set has no captured BPM", async () => {
    const api = makeApi();
    render(<BrainWorkspace api={api} practiceContext={{
      piece_id: 7,
      piece_title: "Scherzo No. 2",
      composer: "Chopin",
      surface: "details",
      region: null,
      current_page: null,
      edition_id: null,
      edition_label: null,
      active_block: {
        m_start: 720,
        m_end: 732,
        bpm: null,
        target_bpm: null,
        focus: "tempo",
        use_metronome: true,
        reps_done: 0,
        planned_reps: 5,
        attempts_recorded: 0,
        tries: 0,
        current_clean_streak: 0,
        mastery_progress_streak: 0,
        required_clean_streak: 3,
        mastery_status: "not_satisfied",
        mastery_verified: true,
        set_state: "active",
      },
    }} />);

    expect(screen.getByText("Active tempo set · 0 tries · mastery proof 0/3 · mastery not yet satisfied")).toBeTruthy();
    expect(screen.queryByText(/null BPM/)).toBeNull();
    await waitFor(() => expect(api.planPreview).toHaveBeenCalledWith(7));
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
