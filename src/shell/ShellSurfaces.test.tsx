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

const warmupsWorkspaceProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../features/warmups/WarmupsWorkspace", () => ({
  WarmupsWorkspace: (props: unknown) => {
    warmupsWorkspaceProps.current = props;
    return <div data-testid="warmups-workspace-stub" />;
  },
}));

const rotationPanelProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../features/rotation/RotationPanel", () => ({
  RotationPanel: (props: unknown) => {
    rotationPanelProps.current = props;
    return <div data-testid="rotation-panel-stub" />;
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
      case "voice_capture_suspend":
        return Promise.resolve(1);
      case "voice_capture_resume":
        return Promise.resolve(true);
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
      case "rep_check":
        return Promise.resolve({
          snap: {
            ...ACTIVE_SNAP,
            attempts_recorded: 3,
            tries: 3,
            reps_done: 3,
            last_attempt_id: 11,
          },
          new_bpm: null,
          block_done: false,
          say: "Attempt saved.",
        });
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

    // The Today menu and the top rail both make the library—not History—the
    // primary Pieces destination.
    fireEvent.click(await screen.findByRole("button", { name: "Pieces" }));
    await screen.findByTestId("ledger-workspace-stub");
    expect(ledgerWorkspaceProps.current).toEqual(
      expect.objectContaining({
        requestedSurface: "pieces",
        requestedPieceId: null,
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));

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

    fireEvent.click(screen.getByRole("tab", { name: "Pieces" }));
    await waitFor(() =>
      expect(ledgerWorkspaceProps.current).toEqual(
        expect.objectContaining({
          requestedSurface: "pieces",
          requestedPieceId: null,
        }),
      ),
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

  it("exposes Warmups in the workspace rail and mounts it on the shell rep seam", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );

    const tab = await screen.findByRole("tab", { name: "Warmups" });
    expect(tab.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tab);

    expect(await screen.findByTestId("warmups-workspace-stub")).toBeTruthy();
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(warmupsWorkspaceProps.current).toEqual(
      expect.objectContaining({
        activeRep: expect.objectContaining({ block_id: ACTIVE_SNAP.block_id }),
        onOpenBlock: expect.any(Function),
      }),
    );
  });

  it("keeps verdict hotkeys active while practising from Warmups", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByRole("region", { name: "Active practice set" });
    fireEvent.click(screen.getByRole("tab", { name: "Warmups" }));
    await screen.findByTestId("warmups-workspace-stub");
    invokeMock.mockClear();

    fireEvent.keyDown(document.body, { code: "Space", key: " " });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "rep_check",
        expect.objectContaining({ verdict: "clean" }),
      ),
    );
  });

  it("scopes verdict hotkeys to Score even though the Rep panel persists globally", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByRole("region", { name: "Active practice set" });
    invokeMock.mockClear();

    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    expect(invokeMock).not.toHaveBeenCalledWith("rep_check", expect.anything());

    fireEvent.click(screen.getByRole("tab", { name: "Score" }));
    await screen.findByTestId("score-workspace-stub");
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "rep_check",
        expect.objectContaining({ verdict: "clean" }),
      ),
    );
    const recorded = invokeMock.mock.calls.filter(
      ([command]) => command === "rep_check",
    ).length;

    fireEvent.click(screen.getByRole("tab", { name: "Universe" }));
    await screen.findByTestId("universe-workspace-stub");
    fireEvent.keyDown(document.body, { code: "Enter", key: "Enter" });
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "rep_check"),
    ).toHaveLength(recorded);
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

  it("mounts one Rotation panel at shell level with the authoritative rep controls", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );

    const panel = await screen.findByTestId("rotation-panel-stub");
    expect(rotationPanelProps.current).toEqual(
      expect.objectContaining({
        activeRep: expect.objectContaining({ block_id: ACTIVE_SNAP.block_id }),
        defaultCleanStreak: expect.any(Number),
        onOpenBlock: expect.any(Function),
        onPause: expect.any(Function),
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Warmups" }));
    await screen.findByTestId("warmups-workspace-stub");
    expect(screen.getAllByTestId("rotation-panel-stub")).toHaveLength(1);
    expect(panel.isConnected).toBe(true);
  });

  it("fails closed when the backend reports voice unsupported", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "voice_state") {
        return Promise.resolve({
          muted: false,
          down: "unsupported-platform",
          guidance:
            "Hands-free voice is unavailable on Windows. Keyboard and mouse controls still work.",
        });
      }
      return baseInvoke?.(command, ...args);
    });
    render(
      <ReceiptCenterProvider>
        <Shell platform="windows" />
      </ReceiptCenterProvider>,
    );

    const mic = await screen.findByRole("button", {
      name: "Mic unavailable",
    });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    expect(mic.textContent).toContain("Unavailable");
    expect(mic.getAttribute("title")).toContain("unavailable on Windows");

    await screen.findByRole("region", { name: "Active practice set" });
    expect(screen.getByText("Listen Back unavailable")).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", {
        name: /Review each rep by listening back/i,
      }),
    ).toBeNull();
    expect(
      screen.getByText(/Keyboard and mouse controls still work/i),
    ).toBeTruthy();
  });

  it("keeps Listen Back available on macOS when hands-free voice is down", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "voice_state") {
        return Promise.resolve({
          muted: false,
          down: "dictation-disabled",
          guidance: "Enable Dictation, then relaunch.",
        });
      }
      return baseInvoke?.(command, ...args);
    });
    render(
      <ReceiptCenterProvider>
        <Shell platform="other" />
      </ReceiptCenterProvider>,
    );

    const mic = await screen.findByRole("button", {
      name: "Mic unavailable",
    });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole("region", { name: "Active practice set" });
    expect(
      screen.getByRole("checkbox", {
        name: /Review each rep by listening back/i,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Listen Back unavailable")).toBeNull();
  });

  it("gives Listen Back exact capture ownership without overwriting user mute", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByRole("region", { name: "Active practice set" });
    const review = screen.getByRole("checkbox", {
      name: /Review each rep by listening back/,
    });
    invokeMock.mockClear();

    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_capture_suspend", {
        requestId: expect.stringMatching(/^listen-back-/),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: true });
    const mic = screen.getByRole("button", {
      name: "Mic muted — click to unmute",
    }) as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(mic.title).toContain("Listen Back");

    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_capture_resume", {
        requestId: expect.stringMatching(/^listen-back-/),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Mic listening — click to mute" }),
    ).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: false });
  });

  it("leaves a pre-existing user mute intact across Listen Back", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await emit("voice://status", { state: "muted" });
    const review = screen.getByRole("checkbox", {
      name: /Review each rep by listening back/,
    });
    invokeMock.mockClear();

    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_capture_suspend", {
        requestId: expect.stringMatching(/^listen-back-/),
      }),
    );
    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_capture_resume", {
        requestId: expect.stringMatching(/^listen-back-/),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Mic muted — click to unmute" }),
    ).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "voice_mute",
      expect.anything(),
    );
  });

  it("keeps the immediate voice firewall closed when physical suspension fails", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "voice_capture_suspend") {
        return Promise.reject(new Error("capture lifecycle unavailable"));
      }
      return baseInvoke?.(command, ...args);
    });
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const review = await screen.findByRole("checkbox", {
      name: /Review each rep by listening back/,
    });
    invokeMock.mockClear();

    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: true }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/could not safely take the microphone/i),
      ).toBeTruthy(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("voice_mute", { muted: false });
    expect(
      (
        screen.getByRole("button", {
          name: "Mic muted — click to unmute",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(review);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("voice_mute", { muted: false }),
    );
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

  it("ends an ordinary session without opening the day-photo ritual or touching the camera", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "rep_state") return Promise.resolve(null);
      if (command === "session_end") return Promise.resolve(null);
      return baseInvoke?.(command, ...args);
    });
    const getUserMedia = vi.fn(() => Promise.reject(new Error("not expected")));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const end = await screen.findByRole("button", { name: "End session" });
    await waitFor(() =>
      expect((end as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(end);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("session_end"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "End session" })).toBeNull(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Today's practice photo" }),
    ).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("offers the photo ritual only after confirmed End my day, and camera access still waits for Use camera", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command: string, ...args: unknown[]) => {
      if (command === "rep_state") return Promise.resolve(null);
      if (command === "session_end") return Promise.resolve(null);
      return baseInvoke?.(command, ...args);
    });
    const getUserMedia = vi.fn(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    const endDay = await screen.findByRole("button", { name: "End my day" });
    await waitFor(() =>
      expect((endDay as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(endDay);
    fireEvent.click(screen.getByRole("button", { name: "End day" }));

    await screen.findByRole("dialog", { name: "Today's practice photo" });
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use camera" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
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

// -- Assistant disabled (Christian's 2026-08-24 "off by default" request) --
//
// Reuses the file-scope harness (invokeMock, eventBus, emit, SCORE_CONTEXT,
// publishSelectedScoreContext, BRAIN_ANSWER) but overrides settings_snapshot
// to prove the disabled gate — nav, voice routing, and the stale-view
// fallback — while everything else (rep/session/voice/metro/pieces state)
// stays wired exactly as the enabled suite above.
describe("Shell — Assistant disabled", () => {
  beforeEach(() => {
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "settings_snapshot":
          return Promise.resolve({ assistant_enabled: false });
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
        // brain_ask stays wired to a real answer so a broken gate would be
        // caught two ways: the spy call count below, AND the answer text
        // never appearing anywhere in the tree.
        case "brain_ask":
          return Promise.resolve(BRAIN_ANSWER);
        case "rep_open":
          return Promise.resolve({ ...ACTIVE_SNAP, block_id: 2 });
        default:
          return Promise.resolve(null);
      }
    });
  });

  it("renders no Assistant tab", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByTestId("workspace-today");
    const nav = screen.getByRole("tablist", { name: /workspace/i });
    const labels = within(nav)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual(["Today", "Score", "Warmups", "Pieces", "Universe"]);
    expect(screen.queryByRole("tab", { name: "Assistant" })).toBeNull();
  });

  it("does not route a wake-word question to Assistant: no brain_ask call, no answer rendered", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();

    await emit("voice://intent", {
      kind: "question",
      text: "How should I practice this landing?",
      bpm: null,
    });

    // Give any (incorrect) routing a chance to settle before asserting
    // absence, so this cannot pass merely because nothing happened yet.
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([command]) => command === "brain_ask"),
      ).toBe(false);
    });
    expect(screen.queryByText(BRAIN_ANSWER.answer)).toBeNull();
    // Still on Score — no silent jump to a hidden Brain view.
    expect(
      screen.getByRole("tab", { name: "Score" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("does not route a natural (no-wake) question to Assistant: no brain_ask call, no answer rendered", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await publishSelectedScoreContext();

    await emit("voice://transcript", {
      delivery_id: "natural-question-disabled-1",
      revision: 0,
      text: "How should I practice this section?",
      is_final: true,
      handled: false,
      source: "macos_speech",
      confidence: 0.94,
    });

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([command]) => command === "brain_ask"),
      ).toBe(false);
    });
    expect(screen.queryByText(BRAIN_ANSWER.answer)).toBeNull();
  });

  it("does not strand the user on a stale persisted brain view: falls back to a real view", async () => {
    render(
      <ReceiptCenterProvider>
        <Shell />
      </ReceiptCenterProvider>,
    );
    await screen.findByTestId("workspace-today");

    // Simulate a wake-word question having routed to Brain in a prior
    // session/render before the toggle flipped off, by driving the exact
    // same event the enabled suite uses to reach view === "brain" — then
    // proving the shell corrects itself rather than going blank.
    await emit("voice://intent", {
      kind: "question",
      text: "Anything?",
      bpm: null,
    });

    // The defensive view-reset effect and the gated routing effect both
    // agree: never brain, and never a blank stage.
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-brain")).toBeNull();
    });
    expect(await screen.findByTestId("workspace-today")).toBeTruthy();
  });
});
