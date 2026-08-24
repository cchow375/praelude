import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NaturalPracticeActionDraft } from "../features/voice/domain/actionDraft";
import type { RepSnapshot } from "../features/rep/useRep";
import type { PracticeBrainContext } from "../features/brain/types";
import { todayLocal } from "../features/calendar/dates";
import { TODAY_PLAN_CHANGED_EVENT } from "../features/today/todayPlan";

// The shell owns the three app-level practice state machines (rep, session,
// voice) so their surfaces persist across every workspace. These tests mock the
// command seam to prove the shell mounts the active-block HUD and the session
// bar from authoritative state, and that the Lane-B voice-draft translation is
// exact. `listen` is mocked to a no-op so useRep/useSession fall back to their
// one-shot fetch (the eventless path), exactly as in browser dev.

const invokeMock = vi.fn();
const eventBus = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      eventBus.handlers.set(name, handler);
      return () => {
        if (eventBus.handlers.get(name) === handler) {
          eventBus.handlers.delete(name);
        }
      };
    },
  ),
}));

// The Score workspace is lazy-loaded; stub it to capture the props the shell
// passes. The Practice tab inside ScoreView is dead unless the shell threads
// rep.open through here (the v3.0.2 "Practice button does nothing" bug).
const scoreWorkspaceProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../features/score/ScoreWorkspace", () => ({
  ScoreWorkspace: (props: unknown) => {
    scoreWorkspaceProps.current = props;
    return <div data-testid="score-workspace-stub" />;
  },
}));

const ledgerWorkspaceProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../features/ledger/LedgerCalendarWorkspace", () => ({
  LedgerCalendarWorkspace: (props: unknown) => {
    ledgerWorkspaceProps.current = props;
    return <div data-testid="ledger-workspace-stub" />;
  },
}));

const universeWorkspaceProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../features/universe/UniverseWorkspace", () => ({
  UniverseWorkspace: (props: unknown) => {
    universeWorkspaceProps.current = props;
    return <div data-testid="universe-workspace-stub" />;
  },
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

const BRAIN_ANSWER = {
  id: "voice-answer-1",
  answer: "Use the selected landing and keep the wrist released.",
  provider: "claude",
  citations: [],
  methods: [],
  intake_review: null,
  proposed_action: {
    kind: "tempo",
    summary: "Set the metronome to 80 BPM",
    bpm: 80,
  },
};

async function emit(name: string, payload: unknown) {
  await waitFor(() => expect(eventBus.handlers.has(name)).toBe(true));
  act(() => eventBus.handlers.get(name)?.({ payload }));
}

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

const SCORE_CONTEXT: PracticeBrainContext = {
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
  active_block: null,
};

async function publishSelectedScoreContext() {
  fireEvent.click(await screen.findByRole("tab", { name: "Score" }));
  await screen.findByTestId("score-workspace-stub");
  const props = scoreWorkspaceProps.current as {
    onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
  };
  act(() => props.onPracticeContextChange?.(SCORE_CONTEXT));
}

beforeEach(() => {
  eventBus.handlers.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      // Christian's 2026-08-24 request flipped assistant_enabled's real
      // default to off; this suite exercises Brain routing, so it
      // explicitly opts back in.
      case "settings_snapshot":
        return Promise.resolve({ assistant_enabled: true });
      case "rep_state":
        return Promise.resolve(ACTIVE_SNAP);
      case "session_current":
        return Promise.resolve(ACTIVE_SESSION);
      case "voice_state":
        return Promise.resolve({ muted: false, down: null });
      case "metro_state":
        return Promise.resolve({ running: false, bpm: 84 });
      case "pieces_list":
        return Promise.resolve([
          {
            id: 7,
            title: "Scherzo No. 2",
            composer: "Chopin",
            has_xml: true,
            has_pdf: true,
            intake_done: true,
          },
        ]);
      case "brain_status":
        return Promise.resolve({
          online: true,
          provider: "claude",
          reason: null,
        });
      case "brain_plan_preview":
        return Promise.resolve([]);
      case "brain_thread_resume":
        return Promise.resolve({ thread_id: 42, turns: [] });
      case "brain_ask":
        return Promise.resolve(BRAIN_ANSWER);
      case "rep_open":
        return Promise.resolve({ ...ACTIVE_SNAP, block_id: 2 });
      default:
        return Promise.resolve(null);
    }
  });
});
afterEach(cleanup);

describe("Shell app-level practice surfaces", () => {
  it("carries Today and Universe navigation to the exact inner surface and piece", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );

    // Today is the app menu now; "Shape the day" lives in the practice window.
    fireEvent.click(
      await screen.findByRole("button", { name: "Today's Practice" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open the Calendar" }),
    );
    await screen.findByTestId("ledger-workspace-stub");
    expect(ledgerWorkspaceProps.current).toEqual(
      expect.objectContaining({
        requestedSurface: "calendar",
        requestedPieceId: null,
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    await screen.findByTestId("universe-workspace-stub");
    const universe = universeWorkspaceProps.current as {
      onOpenPractice: (piece: { piece_id: number; title: string }) => void;
      onOpenLedger: (piece: { piece_id: number; title: string }) => void;
    };
    act(() => universe.onOpenPractice({ piece_id: 42, title: "Poem" }));
    await screen.findByTestId("score-workspace-stub");
    expect(scoreWorkspaceProps.current).toEqual(
      expect.objectContaining({
        requestedPieceId: 42,
        requestRevision: 1,
        isActive: true,
      }),
    );

    // A repeated deep link is a new navigation event even when the requested
    // piece ID is identical and the cached Score was changed in between.
    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    act(() => universe.onOpenPractice({ piece_id: 42, title: "Poem" }));
    await screen.findByTestId("score-workspace-stub");
    expect(scoreWorkspaceProps.current).toEqual(
      expect.objectContaining({ requestedPieceId: 42, requestRevision: 2 }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    act(() => universe.onOpenLedger({ piece_id: 43, title: "Sonata" }));
    await screen.findByTestId("ledger-workspace-stub");
    expect(ledgerWorkspaceProps.current).toEqual(
      expect.objectContaining({
        requestedSurface: "ledger",
        requestedPieceId: 43,
      }),
    );
  });

  it("returns Settings to the workspace where it opened", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell settingsContent={<div data-testid="settings-stub" />} />
      </ReceiptCenterProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Score" }));
    await screen.findByTestId("score-workspace-stub");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByTestId("settings-stub")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      screen.getByRole("tab", { name: "Score" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

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

  it("keeps the rep panel reachable across every workspace tab (Task A3: shell-level, not per-view)", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByRole("dialog", { name: "Rep Counter" });

    // Universe, Ledger, and Score are all lazy-mounted, view-switched
    // surfaces — the dock panel lives OUTSIDE that switch (mounted once at
    // shell level, per the brief), so it must survive navigating to each.
    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    await screen.findByTestId("universe-workspace-stub");
    let panel = await screen.findByRole("dialog", { name: "Rep Counter" });
    expect(within(panel).getByText("Scherzo No. 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Score" }));
    await screen.findByTestId("score-workspace-stub");
    panel = await screen.findByRole("dialog", { name: "Rep Counter" });
    expect(within(panel).getByText("Scherzo No. 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    await screen.findByTestId("workspace-today");
    panel = await screen.findByRole("dialog", { name: "Rep Counter" });
    expect(within(panel).getByText("Scherzo No. 2")).toBeTruthy();
  });

  it("mounts the session bar from the current session", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const end = await screen.findByRole("button", { name: "End session" });
    expect((end as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Close the active set before ending the session."),
    ).toBeTruthy();
  });

  it("re-homes the standalone metronome instrument at the shell rail", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Metronome" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    // Opening mounts the instrument popover (tempo readout is the tell).
    expect(
      await screen.findByRole("textbox", {
        name: "Tempo, beats per minute",
      }),
    ).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("routes a wake question to Brain with exact Score and active-set context", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TODAY_PLAN_CHANGED_EVENT, {
          detail: {
            date: todayLocal(),
            value: "Diagnose page 18, then make the landing reliable at 80.",
          },
        }),
      );
    });

    await emit("voice://intent", {
      kind: "question",
      text: "How should I practice this landing?",
      bpm: null,
    });

    await screen.findByText(BRAIN_ANSWER.answer);
    const askCall = invokeMock.mock.calls.find(
      ([command]) => command === "brain_ask",
    );
    expect(askCall?.[1]).toEqual({
      request: expect.objectContaining({
        question: "How should I practice this landing?",
        source: "voice",
        piece_id: 7,
        context: expect.objectContaining({
          ...SCORE_CONTEXT,
          today_plan: "Diagnose page 18, then make the landing reliable at 80.",
          active_block: expect.objectContaining({
            m_start: 65,
            m_end: 96,
            tries: 2,
            mastery_verified: true,
          }),
        }),
      }),
    });
    expect(await screen.findByText("Set the metronome to 80 BPM")).toBeTruthy();
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "voice_speak"),
      ).toHaveLength(1),
    );
    expect(
      invokeMock.mock.calls.find(([command]) => command === "voice_speak")?.[1],
    ).toEqual({
      text: "Set the metronome to 80 BPM. Say confirm or cancel.",
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "metro_set"),
    ).toHaveLength(0);

    // Bare yes/no remain inert because the native hot loop owns them first.
    await emit("voice://transcript", {
      delivery_id: "confirm-unsafe-yes",
      revision: 0,
      text: "yes",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });
    await emit("voice://transcript", {
      delivery_id: "confirm-unsafe-no",
      revision: 0,
      text: "no",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "metro_set"),
    ).toHaveLength(0);

    await emit("voice://transcript", {
      delivery_id: "confirm-safe",
      revision: 0,
      text: "confirm",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "metro_set"),
      ).toHaveLength(1),
    );
    // The delivery firewall + confirmation ledger make replay exact-once.
    await emit("voice://transcript", {
      delivery_id: "confirm-safe",
      revision: 0,
      text: "confirm",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "metro_set"),
    ).toHaveLength(1);
  });

  it("routes a natural practice-advice question to Brain instead of drafting a set", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();

    await emit("voice://transcript", {
      delivery_id: "natural-question-1",
      revision: 0,
      text: "How should I practice this section?",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.94,
    });

    await screen.findByText(BRAIN_ANSWER.answer);
    const calls = invokeMock.mock.calls.filter(
      ([command]) => command === "brain_ask",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({
      request: expect.objectContaining({
        question: "How should I practice this section?",
        source: "voice",
        context: expect.objectContaining({
          piece_id: 7,
          region: SCORE_CONTEXT.region,
          current_page: 18,
          edition_id: "ekier.pdf",
        }),
      }),
    });
  });

  it("binds a delayed Brain verdict to the set active when the question began", async () => {
    let resolveAnswer!: (value: typeof BRAIN_ANSWER) => void;
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((...args: unknown[]) =>
      args[0] === "brain_ask"
        ? new Promise((resolve) => {
            resolveAnswer = resolve;
          })
        : baseInvoke?.(...args),
    );
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();

    await emit("voice://intent", {
      kind: "question",
      text: "Was that clean?",
      bpm: null,
    });
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "brain_ask"),
      ).toHaveLength(1),
    );

    await emit("rep://state", { ...ACTIVE_SNAP, block_id: 2 });
    resolveAnswer({
      ...BRAIN_ANSWER,
      id: "delayed-verdict",
      proposed_action: {
        kind: "verdict",
        summary: "Log clean",
        verdict: "clean",
        note: null,
      },
    });

    expect(
      await screen.findByText(
        "The active set changed. Ask again before applying this action.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("invalidates a natural set draft when the selected Region bounds change", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();
    await emit("rep://state", null);
    await emit("voice://transcript", {
      delivery_id: "natural-range-change",
      revision: 0,
      text: "Practice this section five times",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.96,
    });
    expect(await screen.findByText("Review the spoken set.")).toBeTruthy();

    const props = scoreWorkspaceProps.current as {
      onPracticeContextChange?: (context: PracticeBrainContext | null) => void;
    };
    act(() =>
      props.onPracticeContextChange?.({
        ...SCORE_CONTEXT,
        region: SCORE_CONTEXT.region
          ? { ...SCORE_CONTEXT.region, m_start: 721 }
          : null,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start this set" }));

    expect(
      await screen.findByText(
        "The Score target changed. Review a new spoken draft before starting.",
      ),
    ).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rep_open"),
    ).toHaveLength(0);
  });

  it("drafts a no-wake natural set from the selected Region and writes only after confirm", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();
    await emit("rep://state", null);

    await emit("voice://transcript", {
      delivery_id: "natural-set-1",
      revision: 0,
      text: "I want to do dotted rhythms five times on the right hand at 80",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.96,
    });

    expect(await screen.findByText("Review the spoken set.")).toBeTruthy();
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "voice_speak"),
      ).toHaveLength(1),
    );
    expect(
      invokeMock.mock.calls.find(([command]) => command === "voice_speak")?.[1],
    ).toEqual({
      text: "Start Scherzo No. 2, Coda landing, right hand, rhythmic variants, 5 attempts, at 80 beats per minute? Say confirm or cancel.",
    });
    expect(
      (screen.getByLabelText("Draft start measure") as HTMLInputElement).value,
    ).toBe("720");
    expect(
      (screen.getByLabelText("Draft end measure") as HTMLInputElement).value,
    ).toBe("732");
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rep_open"),
    ).toHaveLength(0);

    // A spoken confirmation must apply the edited card, not the parser's stale
    // original. This is the hands-free equivalent of pressing the card button.
    fireEvent.change(screen.getByLabelText("Draft start measure"), {
      target: { value: "721" },
    });

    await emit("voice://transcript", {
      delivery_id: "natural-set-confirm",
      revision: 0,
      text: "confirm",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });

    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === "rep_open"),
      ).toHaveLength(1),
    );
    const openCall = invokeMock.mock.calls.find(
      ([command]) => command === "rep_open",
    );
    expect(openCall?.[1]).toEqual({
      args: expect.objectContaining({
        piece_id: 7,
        m_start: 721,
        region_id: 44,
        m_end: 732,
        start_bpm: 80,
        planned_reps: 5,
      }),
      context: expect.objectContaining({
        hands: "right",
        method: "rhythmic variants",
      }),
    });
  });

  it("does not reuse an invisible Score Region after navigating back to Today", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    await emit("rep://state", null);

    await emit("voice://transcript", {
      delivery_id: "natural-after-score-left",
      revision: 0,
      text: "I want to do dotted rhythms five times on the right hand at 80",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.96,
    });

    await screen.findByText(BRAIN_ANSWER.answer);
    const ask = invokeMock.mock.calls.find(
      ([command]) => command === "brain_ask",
    );
    expect(ask?.[1]).toEqual({
      request: expect.objectContaining({
        piece_id: null,
        context: null,
      }),
    });
  });

  it("keeps a natural start-set draft unavailable while another set is active", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();

    await emit("voice://transcript", {
      delivery_id: "natural-set-while-active",
      revision: 0,
      text: "I want to do dotted rhythms five times on the right hand at 80",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.96,
    });

    expect(
      await screen.findByText(
        "A practice set is already active. Close or finish it before starting another.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Start this set",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.find(
          ([command]) => command === "voice_speak",
        )?.[1],
      ).toEqual({
        text: "A practice set is already active. Close or finish it before starting another, or say cancel.",
      }),
    );

    await emit("voice://transcript", {
      delivery_id: "natural-set-active-confirm",
      revision: 0,
      text: "confirm",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.99,
    });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rep_open"),
    ).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen
          .getAllByText(
            "A practice set is already active. Close or finish it before starting another.",
          )
          .some((element) => element.getAttribute("role") === "alert"),
      ).toBe(true),
    );
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

  it("mounts the Score workspace with the shell's rep-open seam", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Score" }));

    await screen.findByTestId("score-workspace-stub");
    const props = scoreWorkspaceProps.current as {
      onOpenBlock?: unknown;
      defaultCleanStreak?: unknown;
    };
    expect(typeof props.onOpenBlock).toBe("function");
    expect(typeof props.defaultCleanStreak).toBe("number");
  });
});
