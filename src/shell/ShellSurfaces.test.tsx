import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NaturalPracticeActionDraft } from "../features/voice/domain/actionDraft";
import type { RepSnapshot } from "../features/rep/useRep";

// The shell owns the three app-level practice state machines (rep, session,
// voice) so their surfaces persist across every workspace. These tests mock the
// command seam to prove the shell mounts the active-block HUD and the session
// bar from authoritative state, and that the Lane-B voice-draft translation is
// exact. `listen` is mocked to a no-op so useRep/useSession fall back to their
// one-shot fetch (the eventless path), exactly as in browser dev.

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { Shell, voiceDraftOpenRequest } from "./Shell";
import { ReceiptCenterProvider } from "../features/receipts/ReceiptCenter";

const ACTIVE_SNAP: RepSnapshot = {
  block_id: 1,
  piece_id: 7,
  piece_title: "Scherzo No. 2",
  m_start: 65,
  m_end: 96,
  label: null,
  bpm: 84,
  start_bpm: 60,
  target_bpm: 96,
  planned_reps: 30,
  reps_done: 2,
  cleans_at_step: 1,
  rule: { clean_needed: 3, bpm_step: 4 },
  variant: null,
  variants: [],
  verdicts: { clean: 2, flawed: 0, failed: 0 },
  last: { verdict: "clean", note: null, bpm: 84 },
  status: "active",
  focus: "tempo",
  use_metronome: true,
  attempts_recorded: 2,
  tries: 2,
  voided_attempts: 0,
  current_clean_streak: 2,
  mastery_progress_streak: 2,
  best_clean_streak: 2,
  reset_count: 0,
  accuracy: 1,
  required_clean_streak: 5,
  effective_required_clean_streak: 5,
  recovery_remaining: 0,
  mastery_status: "not_satisfied",
  mastery_verified: true,
  set_state: "active",
  last_attempt_id: 10,
  last_adjustment_id: null,
};

const ACTIVE_SESSION = {
  id: 1,
  started_at: new Date().toISOString(),
  events: [{ ts: new Date().toISOString(), kind: "rep_open", payload: {} }],
};

function readyDraft(
  over: Partial<NaturalPracticeActionDraft> = {},
): NaturalPracticeActionDraft {
  return {
    kind: "start_practice_set",
    source_text: "start scherzo measures 65 to 96 at 84",
    piece_id: 7,
    piece_title: "Scherzo No. 2",
    target: { m_start: 65, m_end: 96 },
    contract: {
      start_bpm: 84,
      target_bpm: 96,
      planned_attempts: 30,
      required_clean_streak: 5,
      hands: "together",
      method: "tempo ladder",
      intention: "even development voicing",
      use_metronome: true,
    },
    confirmation_required: true,
    issues: [],
    status: "ready_to_confirm",
    ...over,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "rep_state":
        return Promise.resolve(ACTIVE_SNAP);
      case "session_current":
        return Promise.resolve(ACTIVE_SESSION);
      case "voice_state":
        return Promise.resolve({ muted: false, down: null });
      case "metro_state":
        return Promise.resolve({ running: false, bpm: 84 });
      default:
        return Promise.resolve(null);
    }
  });
});
afterEach(cleanup);

describe("Shell app-level practice surfaces", () => {
  it("mounts the active-block Rep HUD from authoritative rep state", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const hud = await screen.findByRole("region", {
      name: "Active practice set",
    });
    expect(hud).toBeTruthy();
    expect(screen.getByText("Scherzo No. 2")).toBeTruthy();
    expect(screen.getByText("mm. 65–96")).toBeTruthy();
    // Verdict entry from the kit is present.
    expect(screen.getByRole("button", { name: "Clean" })).toBeTruthy();
  });

  it("mounts the session bar from the current session", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "End session" }),
    ).toBeTruthy();
  });
});

describe("voiceDraftOpenRequest", () => {
  it("maps a ready spoken tempo set into the exact rep_open contract", () => {
    const request = voiceDraftOpenRequest(readyDraft());
    expect(request.args).toMatchObject({
      piece_id: 7,
      m_start: 65,
      m_end: 96,
      start_bpm: 84,
      target_bpm: 96,
      planned_reps: 30,
      required_clean_streak: 5,
      focus: "tempo",
      use_metronome: true,
      region_id: null,
      increment: null,
    });
    expect(request.context).toMatchObject({
      intention: "even development voicing",
      judging_axis: "pulse",
      hands: "together",
      method: "tempo ladder",
    });
  });

  it("refuses to translate a draft that still needs input", () => {
    expect(() => voiceDraftOpenRequest(readyDraft({ piece_id: null }))).toThrow(
      /still needs input/,
    );
    expect(() =>
      voiceDraftOpenRequest(
        readyDraft({
          issues: [{ code: "missing_measures", message: "x" } as never],
        }),
      ),
    ).toThrow(/still needs input/);
  });

  it("classifies a non-tempo hands draft as a hands focus with accuracy judging", () => {
    const request = voiceDraftOpenRequest(
      readyDraft({
        contract: {
          start_bpm: null,
          target_bpm: null,
          planned_attempts: 20,
          required_clean_streak: 5,
          hands: "left",
          method: "blocked practice",
          intention: null,
          use_metronome: false,
        },
      }),
    );
    expect(request.args.focus).toBe("hands");
    expect(request.context.judging_axis).toBe("accuracy");
  });
});
