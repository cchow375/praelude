import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepSnapshot } from "../features/rep/useRep";

const activeRepSnapshot: RepSnapshot = {
  block_id: 1,
  piece_id: 1,
  piece_title: "Scherzo",
  m_start: 1,
  m_end: 8,
  label: null,
  bpm: 60,
  start_bpm: 60,
  target_bpm: 90,
  planned_reps: 10,
  reps_done: 2,
  attempts_recorded: 2,
  tries: 2,
  current_clean_streak: 2,
  mastery_progress_streak: 0,
  best_clean_streak: 2,
  reset_count: 0,
  accuracy: 1,
  required_clean_streak: 5,
  effective_required_clean_streak: 5,
  recovery_remaining: 0,
  mastery_status: "not_satisfied",
  mastery_verified: true,
  set_state: "active",
  last_attempt_id: 2,
  last_adjustment_id: null,
  cleans_at_step: 0,
  rule: { clean_needed: 3, bpm_step: 4 },
  variant: null,
  variants: [],
  verdicts: { clean: 2, flawed: 0, failed: 0 },
  last: null,
  status: "open",
  focus: "tempo",
  use_metronome: true,
};

function defaultRepState() {
  return {
    snap: activeRepSnapshot as RepSnapshot | null,
    feed: [],
    error: null as string | null,
    open: vi.fn(),
    check: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn().mockResolvedValue(undefined),
    correct: vi.fn().mockResolvedValue(undefined),
    reverseAdjustment: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    // Parity with the real hook (useRep.ts) so a RepHud signature drift is
    // caught here rather than silently passing undefined handlers.
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    reflect: vi.fn().mockResolvedValue(undefined),
    safetyStop: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
  };
}

const useRepMock = vi.fn(defaultRepState);

const invokeMock = vi.fn().mockImplementation((command: string) => {
  if (command === "pieces_list" || command === "daily_work_list") return Promise.resolve([]);
  if (command === "universe_snapshot") {
    return Promise.resolve({
      generated_at: "2026-07-12T17:00:00Z",
      definitions: [],
      traces: {
        source: "canonical practice events",
        practice_event_kinds: ["rep"],
        idle_threshold_seconds: 300,
        active_window_start: "2026-06-15",
        active_window_end: "2026-07-12",
        quality_formula: "bounded smoothing",
      },
      totals: { focused_seconds: 0, active_days_28: 0, regions_practiced: 0, regions_revisited: 0 },
      pieces: [],
    });
  }
  if (command === "recovery_preview") {
    return Promise.resolve({
      today: "2026-07-12",
      capacity_minutes: 60,
      items: [],
      days: [],
    });
  }
  if (command === "settings_snapshot") {
    return Promise.resolve({
      theme: "auto", tts_provider: "auto", tts_voice: "Kore", brain_provider: "auto",
      wake_word_enabled: false, wake_word: "coda", metronome_sound: "woodblock",
      metronome_boost: false, metronome_boost_level: 85, ladder_default_reps: 30,
      practice_default_clean_streak: 5,
      ladder_bpm_step: 4, calendar_capacity_minutes: 60,
      vault_pieces_dir: "/vault/Pieces",
      verdict_aliases: { clean: [], flawed: [], failed: [] },
      api_keys: [
        { provider: "claude", configured: false, source: "none" },
        { provider: "gemini", configured: true, source: "keychain" },
      ],
    });
  }
  return Promise.resolve(null);
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

function defaultVoiceState(): UseVoice {
  return {
    status: "live",
    mute: vi.fn(),
    lastIntent: null,
    downGuidance: null,
    acceptedFinalDelivery: null,
    tierAResult: null,
    deliveryDisposition: null,
  };
}
const useVoiceMock = vi.fn(defaultVoiceState);
vi.mock("../features/voice/useVoice", () => ({
  useVoice: () => useVoiceMock(),
}));

// The natural-language parser and its validator have their own domain tests.
// Here they are stubbed so the Lane-B integration tests can inject a ready,
// confirmable draft and exercise Shell's wiring (render → confirm → rep.open,
// cancel/suppress, error) without depending on grammar details.
const parseDraftMock = vi.fn();
vi.mock("../features/voice/domain/actionDraft", () => ({
  parseNaturalPracticeActionDraft: (...args: unknown[]) => parseDraftMock(...args),
  validateNaturalPracticeActionDraft: () => [],
}));
vi.mock("../features/rep/useRep", () => ({
  repAttempts: (snap: RepSnapshot) => snap.attempts_recorded ?? snap.reps_done,
  repTries: (snap: RepSnapshot) => snap.tries ?? snap.attempts_recorded ?? snap.reps_done,
  repMasteryStatus: (snap: RepSnapshot) => snap.mastery_status ?? "unverified_legacy",
  repMasteryVerified: (snap: RepSnapshot) => snap.mastery_verified === true,
  useRep: () => useRepMock(),
}));
vi.mock("../features/session/useSession", () => ({
  useSession: () => ({
    session: { id: 1, started_at: new Date().toISOString(), events: [] },
    endSession: vi.fn(), error: null, clearError: vi.fn(),
  }),
}));

import { Shell, groundPracticeBrainContext, voiceDraftOpenRequest } from "./Shell";
import type { UseVoice } from "../features/voice/useVoice";
import type { NaturalPracticeActionDraft } from "../features/voice/domain/actionDraft";
import type { VoiceTranscriptDelivery } from "../features/voice/domain/delivery";
import type { TierAParseResult } from "../features/voice/domain/tierAIntent";

afterEach(cleanup);
beforeEach(() => {
  useRepMock.mockReset().mockImplementation(defaultRepState);
  useVoiceMock.mockReset().mockImplementation(defaultVoiceState);
  parseDraftMock.mockReset();
});

// ---------------------------------------------------------------------------
// Lane-B (natural start-set draft) fixtures.
// ---------------------------------------------------------------------------

function readyDraft(
  overrides: Partial<NaturalPracticeActionDraft> = {},
): NaturalPracticeActionDraft {
  return {
    kind: "start_practice_set",
    source_text: "practice measures 40 to 56 at 80",
    piece_id: 7,
    piece_title: "Etude",
    target: { m_start: 40, m_end: 56 },
    contract: {
      start_bpm: 80,
      target_bpm: null,
      planned_attempts: null,
      required_clean_streak: 5,
      hands: null,
      method: null,
      intention: null,
      use_metronome: true,
    },
    confirmation_required: true,
    issues: [],
    status: "ready_to_confirm",
    ...overrides,
  };
}

function ignoredDelivery(handled: boolean): VoiceTranscriptDelivery {
  return {
    delivery_id: "draft-1",
    revision: 0,
    text: "practice measures 40 to 56 at 80",
    is_final: true,
    handled,
    recognition: { source: "macos_speech", confidence: null },
  };
}

function ignoredTierA(delivery: VoiceTranscriptDelivery): TierAParseResult {
  return {
    classification: "ignored",
    reason: "not_exact_command",
    evidence: {
      delivery_id: delivery.delivery_id,
      revision: delivery.revision,
      raw_text: delivery.text,
      normalized_text: delivery.text,
      recognition: delivery.recognition,
    },
  };
}

/** A useVoice state carrying an accepted, unhandled, ignored final for Lane B. */
function laneBVoiceState(handled: boolean) {
  const delivery = ignoredDelivery(handled);
  return {
    ...defaultVoiceState(),
    acceptedFinalDelivery: delivery,
    tierAResult: ignoredTierA(delivery),
  };
}

describe("v2 instrument shell", () => {
  it("never labels another piece's active rep as the selected piece", () => {
    const context = {
      piece_id: 2,
      piece_title: "Beethoven",
      composer: "Beethoven",
      surface: "score" as const,
      region: null,
      current_page: 1,
      edition_id: null,
      edition_label: null,
    };
    const otherPieceRep = {
      piece_id: 1,
      m_start: 40,
      m_end: 56,
      bpm: 92,
      target_bpm: 120,
      focus: "tempo",
      reps_done: 4,
      planned_reps: 10,
    } as RepSnapshot;
    expect(groundPracticeBrainContext(context, otherPieceRep)?.active_block).toBeNull();
  });

  it("lands intentionally on Today, then keeps the authoritative Set Desk when Atlas opens", async () => {
    render(<Shell />);
    expect(screen.getByLabelText("Version 1.3.0")).toBeTruthy();
    expect(await screen.findByTestId("today-workspace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Atlas" }));
    await waitFor(() => expect(screen.getByLabelText("Set Desk").getAttribute("aria-hidden")).toBe("false"));
    expect(screen.getByTestId("main-practice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand session timeline" })).toBeTruthy();
    expect(screen.queryByLabelText("Collapse panel")).toBeNull();
  });

  it("exposes a reset-layout recovery control", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset panel layout" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("layout_set", expect.anything()), { timeout: 1000 });
  });

  it("opens Calendar as a top-level workspace", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByTestId("calendar-workspace")).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("daily_work_list", expect.anything()));
  });

  it("keeps Brain as an overlay tool while the five workspaces stay navigable", async () => {
    render(<Shell />);
    for (const label of ["Today", "Atlas", "Ledger", "Calendar", "Universe"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("tab", { name: "Brain" })).toBeNull();
    const brain = screen.getByRole("button", { name: "Brain" });
    fireEvent.click(brain);
    expect(brain.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("complementary", { name: "Practice Brain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Metronome" })).toBeTruthy();

    const today = screen.getByRole("tab", { name: "Today" });
    fireEvent.keyDown(today, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Atlas" }).getAttribute("aria-selected")).toBe("true"));
  });

  it("keeps a restore error visible when no active snapshot exists", () => {
    useRepMock.mockReturnValue({
      ...defaultRepState(),
      snap: null,
      error: "Multiple live practice sets require recovery.",
    });

    render(<Shell />);

    expect(screen.queryByTestId("panel-rep")).toBeNull();
    const alerts = screen.getAllByRole("alert").filter((alert) =>
      alert.textContent?.includes("Multiple live practice sets require recovery."),
    );
    expect(alerts).toHaveLength(1);
  });

  it("does not duplicate an active-set error between Shell and RepHud", () => {
    useRepMock.mockReturnValue({
      ...defaultRepState(),
      error: "The attempt could not be saved.",
    });

    render(<Shell />);

    const alerts = screen.getAllByRole("alert").filter((alert) =>
      alert.textContent?.includes("The attempt could not be saved."),
    );
    expect(alerts).toHaveLength(1);
  });

  it("mounts the Ledger workspace on its tab", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Ledger" }));
    expect(await screen.findByTestId("ledger-workspace")).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("pieces_list"));
  });

  it("mounts the Universe workspace on its tab", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    expect(await screen.findByTestId("universe-workspace")).toBeTruthy();
  });
});

describe("Shell — Lane-B voice draft", () => {
  it("drafts an accepted, unhandled, not-exact-command final in the mic popover", async () => {
    parseDraftMock.mockReturnValue(readyDraft());
    useVoiceMock.mockReturnValue(laneBVoiceState(false));

    render(<Shell />);

    expect(
      await screen.findByRole("heading", { name: "Review the spoken set." }),
    ).toBeTruthy();
  });

  it("never drafts a final the backend already handled (double-open guard)", async () => {
    // Same accepted, tier-A-ignored final — but the backend routed it, so
    // `handled: true` must suppress Lane B even though tier A says ignored.
    parseDraftMock.mockReturnValue(readyDraft());
    useVoiceMock.mockReturnValue(laneBVoiceState(true));

    render(<Shell />);
    // Give the draft effect a chance to run.
    await waitFor(() => expect(useVoiceMock).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Review the spoken set." })).toBeNull();
  });

  it("confirming a draft opens the set via the translated rep.open request", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useRepMock.mockReturnValue({ ...defaultRepState(), snap: null, open });
    parseDraftMock.mockReturnValue(readyDraft());
    useVoiceMock.mockReturnValue(laneBVoiceState(false));

    render(<Shell />);
    fireEvent.click(await screen.findByRole("button", { name: "Start this set" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const [args, context] = open.mock.calls[0];
    expect(args).toMatchObject({
      piece_id: 7,
      m_start: 40,
      m_end: 56,
      start_bpm: 80,
      focus: "tempo",
      use_metronome: true,
    });
    expect(context).toMatchObject({ judging_axis: "pulse" });
  });

  it("shows an error and keeps the card when rep.open rejects", async () => {
    const open = vi.fn().mockRejectedValue(new Error("Close the current block first."));
    useRepMock.mockReturnValue({ ...defaultRepState(), snap: null, open });
    parseDraftMock.mockReturnValue(readyDraft());
    useVoiceMock.mockReturnValue(laneBVoiceState(false));

    render(<Shell />);
    fireEvent.click(await screen.findByRole("button", { name: "Start this set" }));

    await waitFor(() =>
      expect(
        screen.getByText("Close the current block first.", { selector: ".voice-draft-error" }),
      ).toBeTruthy(),
    );
    // The card stays so the user can retry or edit.
    expect(screen.getByRole("heading", { name: "Review the spoken set." })).toBeTruthy();
  });

  it("cancel suppresses the same delivery from re-drafting", async () => {
    parseDraftMock.mockReturnValue(readyDraft());
    useVoiceMock.mockReturnValue(laneBVoiceState(false));

    const { rerender } = render(<Shell defaultCleanStreak={5} />);
    expect(
      await screen.findByRole("heading", { name: "Review the spoken set." }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Review the spoken set." })).toBeNull();

    // A dep change re-runs the draft effect with the SAME delivery; the
    // suppressed deliveryKey must keep the card from reappearing.
    rerender(<Shell defaultCleanStreak={6} />);
    expect(screen.queryByRole("heading", { name: "Review the spoken set." })).toBeNull();
  });
});

describe("voiceDraftOpenRequest", () => {
  it("derives tempo focus + pulse axis when a tempo is set", () => {
    const request = voiceDraftOpenRequest(readyDraft());
    expect(request.args.focus).toBe("tempo");
    expect(request.context.judging_axis).toBe("pulse");
  });

  it("derives tempo focus from a tempo-ladder method with no explicit BPM", () => {
    const request = voiceDraftOpenRequest(
      readyDraft({
        contract: {
          start_bpm: null,
          target_bpm: null,
          planned_attempts: null,
          required_clean_streak: 5,
          hands: "together",
          method: "tempo ladder",
          intention: null,
          use_metronome: true,
        },
      }),
    );
    expect(request.args.focus).toBe("tempo");
    expect(request.context.judging_axis).toBe("pulse");
  });

  it("derives hands focus + accuracy axis when hands are set without tempo", () => {
    const request = voiceDraftOpenRequest(
      readyDraft({
        contract: {
          start_bpm: null,
          target_bpm: null,
          planned_attempts: null,
          required_clean_streak: 5,
          hands: "left",
          method: null,
          intention: null,
          use_metronome: false,
        },
      }),
    );
    expect(request.args.focus).toBe("hands");
    expect(request.context.judging_axis).toBe("accuracy");
    expect(request.context.hands).toBe("left");
  });

  it("derives notes focus when neither tempo nor hands are set", () => {
    const request = voiceDraftOpenRequest(
      readyDraft({
        contract: {
          start_bpm: null,
          target_bpm: null,
          planned_attempts: null,
          required_clean_streak: 5,
          hands: null,
          method: null,
          intention: null,
          use_metronome: false,
        },
      }),
    );
    expect(request.args.focus).toBe("notes");
    expect(request.context.judging_axis).toBe("accuracy");
  });

  it("throws when the piece is unresolved", () => {
    expect(() => voiceDraftOpenRequest(readyDraft({ piece_id: null }))).toThrow();
  });

  it("throws when the score range is incomplete", () => {
    expect(() =>
      voiceDraftOpenRequest(readyDraft({ target: { m_start: null, m_end: 56 } })),
    ).toThrow();
  });

  it("throws when unresolved issues remain", () => {
    expect(() =>
      voiceDraftOpenRequest(
        readyDraft({
          issues: [{ code: "missing_piece", field: "piece_id", message: "x" }],
          status: "needs_input",
        }),
      ),
    ).toThrow();
  });
});
