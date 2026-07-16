import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ComposerCandidate } from "./domain";
import {
  SessionComposer,
  type ReviewedSessionDraft,
} from "./SessionComposer";

const CANDIDATES: readonly ComposerCandidate[] = [
  {
    id: "retention-1",
    piece_ref: "piece-griffes",
    target_ref: "target-14-18",
    kind: "due_retention",
    due_on: "2026-07-15",
    priority: 90,
    estimated_minutes: 10,
    piece_label: "The White Peacock",
    target_label: "Measures 14–18",
    evidence: [{
      evidence_id: "retention-evidence-1",
      evidence_type: "retention_due",
      source_ref: { source_type: "retention_check", source_id: "check-41" },
    }],
  },
  {
    id: "repair-1",
    piece_ref: "piece-chopin",
    target_ref: "target-coda",
    kind: "recent_failure",
    priority: 80,
    estimated_minutes: 10,
    piece_label: "Scherzo No. 2",
    target_label: "Coda landing",
    evidence: [{
      evidence_id: "attempt-evidence-9",
      evidence_type: "self_reported_failure",
      source_ref: { source_type: "attempt", source_id: "attempt-209" },
      observed_at: "2026-07-15T16:00:00Z",
    }],
  },
  {
    id: "planned-1",
    piece_ref: "piece-bach",
    target_ref: "target-voices",
    kind: "planned_goal",
    priority: 60,
    estimated_minutes: 10,
    piece_label: "Prelude",
    target_label: "Inner voices",
    evidence: [{
      evidence_id: "goal-evidence-3",
      evidence_type: "planned_goal",
      source_ref: { source_type: "goal", source_id: "goal-3" },
    }],
  },
];

afterEach(cleanup);

function renderComposer<
  T extends (draft: ReviewedSessionDraft) => void | Promise<void>
    = Mock<(draft: ReviewedSessionDraft) => void>,
>(
  onStartSession: T = vi.fn<(draft: ReviewedSessionDraft) => void>() as unknown as T,
  candidates = CANDIDATES,
) {
  const view = render(
    <SessionComposer candidates={candidates} onStartSession={onStartSession} />,
  );
  return { ...view, onStartSession };
}

function startButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Start Session" }) as HTMLButtonElement;
}

describe("SessionComposer", () => {
  it("shows the explicit 20-minute default and transparent retention/repair/planned provenance", () => {
    const { onStartSession } = renderComposer();
    const budget = screen.getByRole("spinbutton", {
      name: "Session length in minutes",
    }) as HTMLInputElement;

    expect(budget.value).toBe("20");
    expect(screen.getByText("Whole minutes · 5–180 · default 20")).toBeTruthy();
    expect(screen.getByText("Retention")).toBeTruthy();
    expect(screen.getByText("Repair")).toBeTruthy();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText(/Due retention check · due 2026-07-15/)).toBeTruthy();
    expect(screen.getByText("retention_check:check-41")).toBeTruthy();
    expect(screen.getByText("attempt:attempt-209")).toBeTruthy();
    expect(screen.getByText("goal:goal-3")).toBeTruthy();
    expect(onStartSession).not.toHaveBeenCalled();
  });

  it("hands an exact reviewed draft to the sole callback only after Start Session is clicked", async () => {
    const { onStartSession } = renderComposer();
    expect(onStartSession).not.toHaveBeenCalled();

    fireEvent.click(startButton());
    await waitFor(() => expect(onStartSession).toHaveBeenCalledTimes(1));
    const reviewed = onStartSession.mock.calls[0][0];

    expect(reviewed).toMatchObject({
      mode: "reviewed_session_draft",
      available_minutes: 20,
      allocated_minutes: 20,
      unallocated_minutes: 0,
      excluded_candidate_ids: [],
    });
    expect(reviewed.sequence.map((item) => ({
      candidate: item.candidate_id,
      piece: item.piece_ref,
      target: item.target_ref,
      minutes: item.allocated_minutes,
    }))).toEqual([
      { candidate: "retention-1", piece: "piece-griffes", target: "target-14-18", minutes: 7 },
      { candidate: "repair-1", piece: "piece-chopin", target: "target-coda", minutes: 7 },
      { candidate: "planned-1", piece: "piece-bach", target: "target-voices", minutes: 6 },
    ]);
    expect(reviewed.sequence[0].provenance.source_refs).toEqual([
      { source_type: "retention_check", source_id: "check-41" },
    ]);
    expect(Object.keys(reviewed)).not.toContain("write_operations");
    expect(Object.keys(reviewed)).not.toContain("attempt");
    expect(Object.keys(reviewed)).not.toContain("mastery");
    expect(await screen.findByText(/no practice fact was written by the composer/i)).toBeTruthy();
  });

  it("recomposes deterministically when the user chooses the five-minute minimum", async () => {
    renderComposer();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Session length in minutes" }), {
      target: { value: "5" },
    });

    await waitFor(() => {
      expect((screen.getByRole("spinbutton", { name: "Minutes for Measures 14–18" }) as HTMLInputElement).value).toBe("2");
    });
    expect((screen.getByRole("spinbutton", { name: "Minutes for Coda landing" }) as HTMLInputElement).value).toBe("2");
    expect((screen.getByRole("spinbutton", { name: "Minutes for Inner voices" }) as HTMLInputElement).value).toBe("1");
    expect(screen.getByText("5 / 5 min")).toBeTruthy();
    expect(startButton().disabled).toBe(false);
  });

  it.each([
    ["", "Enter a session length from 5 to 180 minutes."],
    ["4", "Session length must be between 5 and 180 minutes."],
    ["181", "Session length must be between 5 and 180 minutes."],
    ["5.5", "Session length must be a whole number of minutes."],
  ])("live-validates the session length %s", async (value, message) => {
    renderComposer();
    const input = screen.getByRole("spinbutton", { name: "Session length in minutes" });
    fireEvent.change(input, { target: { value } });

    expect(await screen.findByText(message)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(startButton().disabled).toBe(true);
  });

  it("supports explicit exclusion while preserving an honest unallocated remainder", async () => {
    const { onStartSession } = renderComposer();
    const includePlanned = screen.getByRole("checkbox", {
      name: "Include Inner voices",
    }) as HTMLInputElement;
    fireEvent.click(includePlanned);

    expect(includePlanned.checked).toBe(false);
    expect((screen.getByRole("spinbutton", { name: "Minutes for Inner voices" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("14 / 20 min")).toBeTruthy();
    fireEvent.click(startButton());
    await waitFor(() => expect(onStartSession).toHaveBeenCalledTimes(1));

    expect(onStartSession.mock.calls[0][0]).toMatchObject({
      allocated_minutes: 14,
      unallocated_minutes: 6,
      excluded_candidate_ids: ["planned-1"],
    });
    expect(onStartSession.mock.calls[0][0].sequence.map((item) => item.candidate_id)).toEqual([
      "retention-1",
      "repair-1",
    ]);
  });

  it("blocks invalid target allocations and total over-allocation until corrected", async () => {
    const { onStartSession } = renderComposer();
    const retentionMinutes = screen.getByRole("spinbutton", {
      name: "Minutes for Measures 14–18",
    });
    const plannedMinutes = screen.getByRole("spinbutton", {
      name: "Minutes for Inner voices",
    });

    fireEvent.change(retentionMinutes, { target: { value: "11" } });
    expect(await screen.findByText("Use 1–10 minutes for this target.")).toBeTruthy();
    expect(retentionMinutes.getAttribute("aria-invalid")).toBe("true");
    expect(startButton().disabled).toBe(true);

    fireEvent.change(retentionMinutes, { target: { value: "10" } });
    expect(await screen.findByText("Allocated time exceeds the session by 3 minutes.")).toBeTruthy();
    expect(startButton().disabled).toBe(true);

    fireEvent.change(plannedMinutes, { target: { value: "3" } });
    await waitFor(() => expect(startButton().disabled).toBe(false));
    fireEvent.click(startButton());
    await waitFor(() => expect(onStartSession).toHaveBeenCalledTimes(1));
    expect(onStartSession.mock.calls[0][0].sequence.map((item) => item.allocated_minutes)).toEqual([
      10,
      7,
      3,
    ]);
  });

  it("requires at least one included target", async () => {
    renderComposer();
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);

    expect(await screen.findByText("Include at least one target before starting.")).toBeTruthy();
    expect(startButton().disabled).toBe(true);
  });

  it("stays inert and explains the boundary when no valid candidate exists", () => {
    renderComposer(vi.fn(), []);

    expect(screen.getByText("No valid explicit candidates are available. The composer will not invent one.")).toBeTruthy();
    expect(screen.getByText("Add at least one valid explicit candidate.")).toBeTruthy();
    expect(startButton().disabled).toBe(true);
  });

  it("discloses rejected or consolidated source inputs instead of silently hiding them", () => {
    const malformed: ComposerCandidate = {
      ...CANDIDATES[2],
      id: "malformed",
      target_ref: "bad-target",
      evidence: [],
    };
    renderComposer(vi.fn(), [...CANDIDATES, malformed]);

    expect(screen.getByText("1 source note")).toBeTruthy();
    expect(screen.getByText(/Candidate omitted/)).toBeTruthy();
    expect(screen.getByText(/1 explicit candidate was not placed/)).toBeTruthy();
  });

  it("uses labeled native controls for keyboard operation", () => {
    renderComposer();
    const budget = screen.getByRole("spinbutton", { name: "Session length in minutes" });
    expect(budget.tagName).toBe("INPUT");
    expect(budget.getAttribute("min")).toBe("5");
    expect(budget.getAttribute("max")).toBe("180");

    for (const name of ["Measures 14–18", "Coda landing", "Inner voices"]) {
      const include = screen.getByRole("checkbox", { name: `Include ${name}` });
      const minutes = screen.getByRole("spinbutton", { name: `Minutes for ${name}` });
      expect(include.tagName).toBe("INPUT");
      expect(minutes.tagName).toBe("INPUT");
    }
    expect(startButton().getAttribute("type")).toBe("button");
    const sequence = screen.getByRole("list", { name: "Editable session sequence" });
    expect(within(sequence).getAllByRole("listitem")).toHaveLength(3);
  });

  it("announces asynchronous callback progress and prevents a second start while pending", async () => {
    let resolveStart!: () => void;
    const onStart = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
    renderComposer(onStart);
    fireEvent.click(startButton());

    expect(await screen.findByRole("button", { name: "Starting session…" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Starting session…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    await act(async () => resolveStart());
    expect(await screen.findByText(/Start requested for 3 targets/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Session requested" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports a rejected callback without claiming a write and permits correction or retry", async () => {
    const onStart = vi.fn(async () => { throw new Error("owner rejected"); });
    renderComposer(onStart);
    fireEvent.click(startButton());

    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was written");
    expect(screen.getByText("The session owner did not accept the start request. Nothing was written.")).toBeTruthy();
    expect(startButton().disabled).toBe(false);
  });
});
