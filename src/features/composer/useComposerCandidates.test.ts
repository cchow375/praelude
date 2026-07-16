import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyWork } from "../calendar/types";
import type { BlockHistory, PieceSummary, Region } from "../pieces/types";
import type { RetentionCheckView } from "../retention";
import {
  buildComposerCandidates,
  useComposerCandidates,
  type ComposerCandidateApi,
} from "./useComposerCandidates";

afterEach(cleanup);

const piece: PieceSummary = {
  id: 3,
  title: "Ballade",
  composer: "Chopin",
  has_pdf: true,
  has_xml: true,
  intake_done: true,
};

const region: Region = {
  id: 8,
  piece_id: 3,
  name: "Coda transition",
  notes: null,
  m_start: 492,
  m_end: 512,
  kind: "hard_spot",
  order: 0,
  color: null,
  pdf_anchor: null,
};

const block: BlockHistory = {
  block_id: 21,
  m_start: 492,
  m_end: 512,
  label: "Coda transition",
  start_bpm: 50,
  bpm: 56,
  target_bpm: 64,
  planned_reps: 15,
  reps_done: 7,
  attempts_recorded: 7,
  status: "open",
  verdicts: { clean: 4, flawed: 1, failed: 2 },
  region_id: 8,
  focus: "tempo",
  use_metronome: true,
  mastery_verified: true,
  mastery_status: "not_satisfied",
  recovery_remaining: 2,
};

const check: RetentionCheckView = {
  id: 13,
  region_id: 8,
  source_set_id: 21,
  due_date: "2026-07-15",
  original_due_date: "2026-07-15",
  condition: { bpm: 56 },
  state: "due",
  result: null,
  completed_ts: null,
  created_ts: "2026-07-14T12:00:00Z",
  updated_ts: "2026-07-14T12:00:00Z",
};

const work: DailyWork = {
  id: 34,
  goal_id: 5,
  region_id: 8,
  block_id: null,
  title: "Stabilize coda",
  planned_minutes: 9,
  origin_date: "2026-07-15",
  scheduled_date: "2026-07-15",
  status: "planned",
  source: "manual",
  reschedule_count: 0,
  sort_order: 1,
  completed_ts: null,
  created_ts: "2026-07-14T12:00:00Z",
  updated_ts: "2026-07-14T12:00:00Z",
  piece_id: 3,
  piece_title: "Ballade",
  goal_text: "Stabilize",
  parent_goal_text: null,
};

describe("buildComposerCandidates", () => {
  it("preserves every explicit reason while grounding all same-target options", () => {
    const candidates = buildComposerCandidates({
      pieces: [piece],
      regions_by_piece: new Map([[3, [region]]]),
      blocks_by_piece: new Map([[3, [block]]]),
      due_retention: [check],
      planned_work: [work],
    });

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "due_retention",
      "recent_failure",
      "planned_work",
    ]);
    expect(candidates.every((candidate) => candidate.piece_ref === "3")).toBe(true);
    expect(candidates.every((candidate) => candidate.target_ref === "8")).toBe(true);
    expect(candidates[0]).toMatchObject({
      target_label: "Coda transition",
      due_on: "2026-07-15",
      priority: 100,
    });
  });

  it("never invents target ownership and does not treat raw clean clicks as mastery debt", () => {
    const candidates = buildComposerCandidates({
      pieces: [piece],
      regions_by_piece: new Map([[3, [region]]]),
      blocks_by_piece: new Map([[3, [{
        ...block,
        verdicts: { clean: 20, flawed: 0, failed: 0 },
        mastery_verified: false,
        mastery_status: "unverified_legacy",
        recovery_remaining: 0,
      }]]]),
      due_retention: [{ ...check, region_id: 999 }],
      planned_work: [],
    });
    expect(candidates).toEqual([]);
  });
});

describe("useComposerCandidates", () => {
  it("drops a stale load when the requested practice date changes", async () => {
    let resolveOldPieces: (value: PieceSummary[]) => void = () => undefined;
    const oldPieces = new Promise<PieceSummary[]>((resolve) => { resolveOldPieces = resolve; });
    const api: ComposerCandidateApi = {
      pieces: vi.fn()
        .mockReturnValueOnce(oldPieces)
        .mockResolvedValueOnce([piece]),
      regions: vi.fn().mockResolvedValue([region]),
      blocks: vi.fn().mockResolvedValue([block]),
      retention: vi.fn().mockImplementation((date: string) => Promise.resolve(
        date === "2026-07-16" ? [{ ...check, due_date: date }] : [check],
      )),
      work: vi.fn().mockResolvedValue([]),
    };
    const view = renderHook(
      ({ date }) => useComposerCandidates({ active: true, asOfDate: date, api }),
      { initialProps: { date: "2026-07-15" } },
    );
    view.rerender({ date: "2026-07-16" });
    await waitFor(() => expect(view.result.current.candidates[0]?.due_on).toBe("2026-07-16"));

    await act(async () => {
      resolveOldPieces([]);
      await oldPieces;
    });
    expect(view.result.current.candidates[0]?.due_on).toBe("2026-07-16");
  });
});
