import { describe, expect, it } from "vitest";
import {
  composeSessionDraft,
  DEFAULT_SESSION_MINUTES,
  MAX_DRAFT_ITEMS,
  MAX_SESSION_MINUTES,
  type ComposerCandidate,
  type ComposerCandidateKind,
} from ".";

function candidate(
  id: string,
  kind: ComposerCandidateKind,
  overrides: Partial<ComposerCandidate> = {},
): ComposerCandidate {
  return {
    id,
    piece_ref: `piece-${id}`,
    target_ref: `target-${id}`,
    kind,
    ...(kind === "due_retention" ? { due_on: "2026-07-15" } : {}),
    priority: 50,
    estimated_minutes: 10,
    evidence: [{
      evidence_id: `evidence-${id}`,
      evidence_type: kind,
      source_ref: { source_type: "fixture", source_id: `source-${id}` },
      observed_at: "2026-07-15T12:00:00Z",
    }],
    ...overrides,
  };
}

describe("composeSessionDraft", () => {
  it("builds the default 20-minute draft in explicit urgency order", () => {
    const draft = composeSessionDraft({
      candidates: [
        candidate("plan", "planned_goal"),
        candidate("unresolved", "unresolved_target"),
        candidate("failure", "recent_failure"),
        candidate("retention-later", "due_retention", { due_on: "2026-07-14" }),
        candidate("retention-earlier", "due_retention", { due_on: "2026-07-12" }),
      ],
    });

    expect(draft.status).toBe("ready");
    expect(draft.available_minutes).toBe(DEFAULT_SESSION_MINUTES);
    expect(draft.allocated_minutes).toBe(20);
    expect(draft.sequence.map((item) => item.candidate_id)).toEqual([
      "retention-earlier",
      "retention-later",
      "failure",
      "unresolved",
      "plan",
    ]);
    expect(draft.sequence.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is deterministic across input order and uses stable IDs as the final tie-break", () => {
    const alpha = candidate("alpha", "planned_work", {
      piece_ref: "piece-a",
      target_ref: "target-a",
    });
    const beta = candidate("beta", "planned_work", {
      piece_ref: "piece-b",
      target_ref: "target-b",
    });

    const forward = composeSessionDraft({ candidates: [beta, alpha] });
    const reverse = composeSessionDraft({ candidates: [alpha, beta] });

    expect(forward).toEqual(reverse);
    expect(forward.sequence.map((item) => item.candidate_id)).toEqual(["alpha", "beta"]);
  });

  it("returns only a draft and leaves caller input untouched", () => {
    const explicit = candidate("explicit", "planned_work");
    const input = { available_minutes: 12, candidates: [explicit] } as const;
    const before = JSON.stringify(input);
    const draft = composeSessionDraft(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(draft).toMatchObject({
      mode: "draft_only",
      write_operations: [],
      status: "ready",
    });
    expect(Object.keys(draft)).not.toContain("attempt");
    expect(Object.keys(draft)).not.toContain("mastery");
    expect(Object.keys(draft)).not.toContain("start");
    expect(Object.keys(draft)).not.toContain("save");
  });

  it("copies exact piece/target refs and exposes source provenance", () => {
    const draft = composeSessionDraft({
      available_minutes: 5,
      candidates: [candidate("known", "planned_goal", {
        piece_ref: "piece:griffes",
        target_ref: "target:m14-18",
        evidence: [{
          evidence_id: "goal-evidence-4",
          evidence_type: "scheduled_goal",
          source_ref: { source_type: "goal", source_id: "goal-4" },
        }],
      })],
    });

    expect(draft.sequence[0]).toMatchObject({
      piece_ref: "piece:griffes",
      target_ref: "target:m14-18",
      provenance: {
        candidate_ids: ["known"],
        evidence_ids: ["goal-evidence-4"],
        source_refs: [{ source_type: "goal", source_id: "goal-4" }],
      },
    });
  });

  it("gives due retention spare capacity without starving repair and planned work", () => {
    const draft = composeSessionDraft({
      available_minutes: 20,
      max_items: 5,
      candidates: [
        candidate("due-a", "due_retention"),
        candidate("due-b", "due_retention"),
        candidate("due-c", "due_retention"),
        candidate("due-d", "due_retention"),
        candidate("repair", "recent_failure"),
        candidate("planned", "planned_work"),
      ],
    });

    expect(draft.sequence.filter((item) => item.kind === "due_retention")).toHaveLength(3);
    expect(draft.sequence.some((item) => item.kind === "recent_failure")).toBe(true);
    expect(draft.sequence.some((item) => item.kind === "planned_work")).toBe(true);
    expect(draft.sequence[0].kind).toBe("due_retention");
  });

  it("handles the minimum five-minute budget without over-allocation", () => {
    const draft = composeSessionDraft({
      available_minutes: 5,
      candidates: Array.from({ length: 8 }, (_, index) => (
        candidate(`work-${index}`, "planned_work", { estimated_minutes: 20 })
      )),
    });

    expect(draft.sequence).toHaveLength(5);
    expect(draft.sequence.map((item) => item.allocated_minutes)).toEqual([1, 1, 1, 1, 1]);
    expect(draft.allocated_minutes).toBe(5);
    expect(draft.unallocated_minutes).toBe(0);
  });

  it("collapses exact duplicate candidates", () => {
    const repeated = candidate("same", "unresolved_target");
    const draft = composeSessionDraft({ candidates: [repeated, repeated] });

    expect(draft.sequence).toHaveLength(1);
    expect(draft.sequence[0].provenance.candidate_ids).toEqual(["same"]);
    expect(draft.issues).toContainEqual(expect.objectContaining({
      code: "duplicate_candidate_collapsed",
      candidate_id: "same",
    }));
  });

  it("consolidates same-target reasons with the strongest reason primary and all sources retained", () => {
    const planned = candidate("planned", "planned_goal", {
      piece_ref: "piece-one",
      target_ref: "target-one",
    });
    const due = candidate("due", "due_retention", {
      piece_ref: "piece-one",
      target_ref: "target-one",
      evidence: [{
        evidence_id: "retention-evidence",
        evidence_type: "retention_due",
        source_ref: { source_type: "retention_check", source_id: "check-8" },
      }],
    });
    const draft = composeSessionDraft({ candidates: [planned, due] });

    expect(draft.sequence).toHaveLength(1);
    expect(draft.sequence[0]).toMatchObject({
      candidate_id: "due",
      kind: "due_retention",
      provenance: {
        candidate_ids: ["due", "planned"],
        evidence_ids: ["evidence-planned", "retention-evidence"],
      },
    });
    expect(draft.sequence[0].provenance.source_refs).toEqual([
      { source_type: "fixture", source_id: "source-planned" },
      { source_type: "retention_check", source_id: "check-8" },
    ]);
  });

  it("omits every conflicting claim for a reused stable candidate ID", () => {
    const draft = composeSessionDraft({
      candidates: [
        candidate("collision", "planned_work", { target_ref: "target-one" }),
        candidate("collision", "planned_work", { target_ref: "target-two" }),
      ],
    });

    expect(draft.status).toBe("empty");
    expect(draft.sequence).toEqual([]);
    expect(draft.issues).toContainEqual(expect.objectContaining({
      code: "conflicting_candidate_id",
      candidate_id: "collision",
    }));
  });

  it("caps oversized budgets and item counts", () => {
    const draft = composeSessionDraft({
      available_minutes: 999,
      max_items: 999,
      candidates: Array.from({ length: 10 }, (_, index) => (
        candidate(`cap-${index}`, "planned_work", { estimated_minutes: 999 })
      )),
    });

    expect(draft.available_minutes).toBe(MAX_SESSION_MINUTES);
    expect(draft.sequence).toHaveLength(MAX_DRAFT_ITEMS);
    expect(draft.allocated_minutes).toBe(MAX_SESSION_MINUTES);
    expect(draft.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "budget_capped",
      "max_items_capped",
    ]));
  });

  it.each([0, -1, 4, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns an inert invalid draft for invalid budget %s",
    (availableMinutes) => {
      const draft = composeSessionDraft({
        available_minutes: availableMinutes,
        candidates: [candidate("never-selected", "planned_work")],
      });

      expect(draft).toMatchObject({
        status: "invalid",
        mode: "draft_only",
        write_operations: [],
        available_minutes: 0,
        allocated_minutes: 0,
        sequence: [],
      });
      expect(draft.issues[0].code).toBe("invalid_budget");
    },
  );

  it("omits malformed candidates without manufacturing replacements", () => {
    const malformed = [
      candidate("no-evidence", "planned_work", { evidence: [] }),
      candidate("bad-due", "due_retention", { due_on: "2026-02-31" }),
      candidate("bad-priority", "unresolved_target", { priority: 101 }),
      candidate("bad-estimate", "recent_failure", { estimated_minutes: 0 }),
    ];
    const draft = composeSessionDraft({ candidates: malformed });

    expect(draft.status).toBe("empty");
    expect(draft.sequence).toEqual([]);
    expect(draft.issues.filter((issue) => issue.code === "invalid_candidate")).toHaveLength(4);
  });

  it("leaves unused time when explicit estimates do not fill the budget", () => {
    const draft = composeSessionDraft({
      available_minutes: 20,
      candidates: [
        candidate("one", "planned_work", { estimated_minutes: 2 }),
        candidate("two", "planned_work", { estimated_minutes: 3 }),
      ],
    });

    expect(draft.sequence.map((item) => item.allocated_minutes)).toEqual([2, 3]);
    expect(draft.allocated_minutes).toBe(5);
    expect(draft.unallocated_minutes).toBe(15);
  });

  it("rounds fractional configuration down and reports the normalization", () => {
    const draft = composeSessionDraft({
      available_minutes: 12.9,
      max_items: 2.8,
      candidates: [
        candidate("a", "planned_work"),
        candidate("b", "planned_work"),
        candidate("c", "planned_work"),
      ],
    });

    expect(draft.available_minutes).toBe(12);
    expect(draft.sequence).toHaveLength(2);
    expect(draft.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "budget_rounded",
      "max_items_rounded",
    ]));
  });

  it("uses due date, priority, recent evidence, then stable ID without ambient time", () => {
    const draft = composeSessionDraft({
      candidates: [
        candidate("due-high", "due_retention", { due_on: "2026-07-14", priority: 100 }),
        candidate("due-old", "due_retention", { due_on: "2026-07-10", priority: 1 }),
        candidate("recent-old", "recent_failure", {
          priority: 50,
          evidence: [{
            evidence_id: "recent-old-evidence",
            evidence_type: "self_reported_failure",
            source_ref: { source_type: "attempt", source_id: "attempt-old" },
            observed_at: "2026-07-10T10:00:00Z",
          }],
        }),
        candidate("recent-new", "recent_failure", {
          priority: 50,
          evidence: [{
            evidence_id: "recent-new-evidence",
            evidence_type: "self_reported_failure",
            source_ref: { source_type: "attempt", source_id: "attempt-new" },
            observed_at: "2026-07-15T10:00:00Z",
          }],
        }),
      ],
    });

    expect(draft.sequence.map((item) => item.candidate_id)).toEqual([
      "due-old",
      "due-high",
      "recent-new",
      "recent-old",
    ]);
  });

  it("returns an empty 20-minute draft when no explicit candidates exist", () => {
    expect(composeSessionDraft({ candidates: [] })).toMatchObject({
      status: "empty",
      available_minutes: 20,
      allocated_minutes: 0,
      unallocated_minutes: 20,
      sequence: [],
      mode: "draft_only",
      write_operations: [],
    });
  });
});
