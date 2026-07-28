import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { brainApi } from "./api";
import type {
  BrainAskRequest,
  BrainIntakeApplyRequest,
  PlannerScheduleRequest,
} from "./types";

describe("brainApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it("ask() maps a full request (with context and history) to brain_ask", async () => {
    const request: BrainAskRequest = {
      question: "How should I approach measure 12?",
      source: "typed",
      piece_id: 3,
      thread_id: 7,
      history: [
        { role: "user", content: "What tempo should I use?" },
        { role: "assistant", content: "Start at 60 bpm." },
      ],
      context: {
        piece_id: 3,
        piece_title: "Nocturne Op. 9 No. 2",
        composer: "Chopin",
        surface: "score",
        region: null,
        current_page: 1,
        edition_id: null,
        edition_label: null,
        active_block: null,
      },
    };
    await brainApi.ask(request);
    expect(invokeMock).toHaveBeenCalledWith("brain_ask", { request });
  });

  it("ask() passes piece_id: null, thread_id: null, context: null, and an empty history through unchanged", async () => {
    const request: BrainAskRequest = {
      question: "",
      source: "voice",
      piece_id: null,
      thread_id: null,
      history: [],
      context: null,
    };
    await brainApi.ask(request);
    // TODO: an empty `question` string reaches the backend unvalidated — decide
    // whether the caller must guard against blank/whitespace-only questions
    // (e.g. from a misfired voice event) before invoking.
    expect(invokeMock).toHaveBeenCalledWith("brain_ask", { request });
  });

  it("applyIntakeReview() maps the request to brain_intake_apply, including an empty changes list", async () => {
    const request: BrainIntakeApplyRequest = {
      answer_id: "answer-1",
      piece_id: 3,
      changes: [],
    };
    await brainApi.applyIntakeReview(request);
    // TODO: confirm an empty `changes` array is a legitimate no-op apply rather
    // than something the caller should short-circuit before invoking.
    expect(invokeMock).toHaveBeenCalledWith("brain_intake_apply", { request });
  });

  it("planPreview() maps a pieceId to brain_plan_preview", async () => {
    await brainApi.planPreview(3);
    expect(invokeMock).toHaveBeenCalledWith("brain_plan_preview", {
      pieceId: 3,
    });
  });

  it("planPreview() passes pieceId: null through unchanged (no piece filter)", async () => {
    await brainApi.planPreview(null);
    expect(invokeMock).toHaveBeenCalledWith("brain_plan_preview", {
      pieceId: null,
    });
  });

  it("resumeThread() maps pieceId to brain_thread_resume", async () => {
    await brainApi.resumeThread(3);
    expect(invokeMock).toHaveBeenCalledWith("brain_thread_resume", {
      pieceId: 3,
    });
  });

  it("clearThread() maps pieceId to brain_thread_clear and resolves to undefined even when invoke() resolves a value", async () => {
    invokeMock.mockResolvedValueOnce({ unexpected: "payload" });
    const result = await brainApi.clearThread(3);
    expect(invokeMock).toHaveBeenCalledWith("brain_thread_clear", {
      pieceId: 3,
    });
    // clearThread() explicitly discards whatever invoke() resolves with via
    // `.then(() => undefined)` — confirm that swallow is intentional and no
    // caller ever needs the raw backend payload.
    expect(result).toBeUndefined();
  });

  it("schedule() re-shapes a PlannerScheduleRequest into the daily_work_create args envelope with hardcoded region/block/source", async () => {
    const request: PlannerScheduleRequest = {
      goal_id: 5,
      title: "Slow practice: exposition",
      minutes: 20,
      date: "2026-07-17",
    };
    await brainApi.schedule(request);
    expect(invokeMock).toHaveBeenCalledWith("daily_work_create", {
      args: {
        goal_id: 5,
        region_id: null,
        block_id: null,
        title: "Slow practice: exposition",
        minutes: 20,
        date: "2026-07-17",
        source: "planner",
      },
    });
  });

  it("schedule() resolves to undefined and discards whatever daily_work_create actually returns", async () => {
    invokeMock.mockResolvedValueOnce({ id: 99, status: "planned" });
    const result = await brainApi.schedule({
      goal_id: 5,
      title: "Warm-up",
      minutes: 10,
      date: "2026-07-17",
    });
    // TODO: schedule() throws away the created DailyWork record (including its
    // id) returned by daily_work_create — decide whether any caller needs that
    // id for follow-up actions (e.g. undo, linking back to the plan preview
    // suggestion) or whether fire-and-forget is intended for good.
    expect(result).toBeUndefined();
  });

  it("schedule() passes boundary/invalid minute values through without client-side validation", async () => {
    await brainApi.schedule({
      goal_id: 5,
      title: "Zero-length",
      minutes: 0,
      date: "2026-07-17",
    });
    expect(invokeMock).toHaveBeenCalledWith("daily_work_create", {
      args: expect.objectContaining({ minutes: 0 }),
    });

    invokeMock.mockClear();
    await brainApi.schedule({
      goal_id: 5,
      title: "Negative",
      minutes: -5,
      date: "2026-07-17",
    });
    // TODO: negative/zero minute values reach the backend unvalidated — decide
    // whether brainApi.schedule() (fed from a WorkSuggestion-derived draft)
    // should reject these before invoking, same open question as
    // calendarApi.setCapacity().
    expect(invokeMock).toHaveBeenCalledWith("daily_work_create", {
      args: expect.objectContaining({ minutes: -5 }),
    });
  });

  it("propagates a rejected invoke() call from ask() without swallowing the error", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));
    await expect(
      brainApi.ask({
        question: "What next?",
        source: "typed",
        piece_id: null,
        thread_id: null,
        history: [],
        context: null,
      }),
    ).rejects.toThrow("backend unavailable");
  });

  it("propagates a rejected invoke() call from clearThread() (the .then(() => undefined) mapper does not catch errors)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("thread not found"));
    await expect(brainApi.clearThread(3)).rejects.toThrow("thread not found");
  });

  it("propagates a rejected invoke() call from schedule() (the .then(() => undefined) mapper does not catch errors)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("goal not found"));
    await expect(
      brainApi.schedule({
        goal_id: 999,
        title: "Ghost goal",
        minutes: 10,
        date: "2026-07-17",
      }),
    ).rejects.toThrow("goal not found");
  });

  it("resolves with whatever malformed/unexpected payload invoke() returns from ask(), unvalidated", async () => {
    invokeMock.mockResolvedValueOnce({ not: "a BrainAnswer" });
    const result = await brainApi.ask({
      question: "What next?",
      source: "typed",
      piece_id: null,
      thread_id: null,
      history: [],
      context: null,
    });
    // TODO: brainApi performs no runtime shape validation on the IPC response —
    // in particular `proposed_action` is typed `unknown` and this file does no
    // narrowing of it at all; the type comment says "the frontend re-narrows it
    // before use," meaning some other module (not this one) is trusted to guard
    // against a malformed confirm-gated action before it can mutate anything.
    expect(result).toEqual({ not: "a BrainAnswer" });
  });

  it("resolves with a malformed (non-array) payload from planPreview(), unvalidated", async () => {
    invokeMock.mockResolvedValueOnce({ not: "a WorkSuggestion[]" });
    const result = await brainApi.planPreview(3);
    expect(result).toEqual({ not: "a WorkSuggestion[]" });
  });

  it("resolves with a malformed payload from resumeThread(), unvalidated", async () => {
    invokeMock.mockResolvedValueOnce({ thread_id: 7, turns: "not an array" });
    const result = await brainApi.resumeThread(3);
    expect(result).toEqual({ thread_id: 7, turns: "not an array" });
  });
});
