import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Capture the props ScoreWorkspace hands to ScoreView. The real ScoreView
// needs pdfjs; here we only prove the workspace forwards the practice seam
// (the Practice tab renders nothing unless onOpenBlock reaches ScoreView).
const scoreViewProps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("./ScoreView", () => ({
  ScoreView: (props: unknown) => {
    scoreViewProps.current = props;
    return <div data-testid="score-view-stub" />;
  },
}));

import { ScoreWorkspace } from "./ScoreWorkspace";
import type { ScoreViewProps } from "./ScoreView";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import { TodaySheetProvider } from "../notebook/DaySheetStore";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

const PIECES = [
  {
    id: 1,
    title: "Scherzo No. 2",
    composer: "Chopin",
    has_xml: true,
    has_pdf: true,
    intake_done: true,
  },
  {
    id: 2,
    title: "The White Peacock",
    composer: "Griffes",
    has_xml: false,
    has_pdf: true,
    intake_done: true,
  },
];

describe("ScoreWorkspace", () => {
  it("loads pieces and renders the picker + the score view for the first piece", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      // No PDF editions → ScoreView stays on its empty state (no pdfjs in jsdom).
      if (command === "score_pdf_editions") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);

    expect(await screen.findByTestId("score-workspace")).toBeTruthy();
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    expect(picker.value).toBe("1");
    expect(screen.getByRole("heading", { name: "Scherzo No. 2" })).toBeTruthy();
    // Both PDF-bearing pieces are offered.
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 1 }),
    );
  });

  it("opens the exact requested piece and synchronizes picker changes to native context", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <ScoreWorkspace requestedPieceId={2} requestRevision={1} />,
    );

    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    expect(picker.value).toBe("2");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 2 }),
    );

    fireEvent.change(picker, { target: { value: "1" } });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 1 }),
    );

    rerender(<ScoreWorkspace requestedPieceId={2} requestRevision={2} />);
    await waitFor(() => expect(picker.value).toBe("2"));
  });

  // B83: window.confirm is banned (wry/WKWebView can silently return falsy
  // from it) — replaced with the same inline two-step confirm idiom used by
  // MeasureMapPanel.tsx.
  it("switches pieces immediately with no prompt when the measure-map review is clean", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    await screen.findByTestId("score-view-stub");

    fireEvent.change(picker, { target: { value: "2" } });
    await waitFor(() => expect(picker.value).toBe("2"));
    expect(
      screen.queryByTestId("score-workspace-piece-switch-confirm"),
    ).toBeNull();
  });

  it("switching pieces with a dirty measure-map review prompts inline and does not switch", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    expect(picker.value).toBe("1");

    // ScoreView reports unsaved measure-map review work in progress.
    const props = scoreViewProps.current as ScoreViewProps;
    props.onMeasureMapDirtyChange?.(true);

    fireEvent.change(picker, { target: { value: "2" } });
    const confirm = await screen.findByTestId(
      "score-workspace-piece-switch-confirm",
    );
    expect(confirm.textContent).toContain(
      "Discard the measure-map review? Your scan/edits have not been applied.",
    );
    // Declined by default: the switch never happened, and the DOM value was
    // reverted (the browser mutates it before the handler runs).
    expect(picker.value).toBe("1");
  });

  it("confirming the inline prompt switches to the originally-chosen piece", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    const props = scoreViewProps.current as ScoreViewProps;
    props.onMeasureMapDirtyChange?.(true);

    fireEvent.change(picker, { target: { value: "2" } });
    fireEvent.click(
      await screen.findByTestId("score-workspace-piece-switch-confirm-yes"),
    );
    await waitFor(() => expect(picker.value).toBe("2"));
    expect(
      screen.queryByTestId("score-workspace-piece-switch-confirm"),
    ).toBeNull();
  });

  it("dismissing the inline prompt keeps both the review and the original selection", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    const props = scoreViewProps.current as ScoreViewProps;
    props.onMeasureMapDirtyChange?.(true);

    fireEvent.change(picker, { target: { value: "2" } });
    fireEvent.click(
      await screen.findByTestId("score-workspace-piece-switch-confirm-no"),
    );
    expect(picker.value).toBe("1");
    expect(
      screen.queryByTestId("score-workspace-piece-switch-confirm"),
    ).toBeNull();

    // The review is still "dirty" — a later switch attempt prompts again
    // rather than having been silently cleared by the dismissal.
    fireEvent.change(picker, { target: { value: "2" } });
    expect(
      await screen.findByTestId("score-workspace-piece-switch-confirm"),
    ).toBeTruthy();
  });

  // B83 follow-up: the styling hook itself is load-bearing (an invisible
  // confirm reads to the user as "I clicked the thing and nothing
  // happened" — the same symptom as the window.confirm bug this replaced),
  // so pin that the confirm container carries its class only while pending.
  it("renders the piece-switch confirm banner with its styling class only while a switch is pending", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    const picker = (await screen.findByLabelText(
      "Choose a piece",
    )) as HTMLSelectElement;
    expect(
      screen.queryByTestId("score-workspace-piece-switch-confirm"),
    ).toBeNull();

    const props = scoreViewProps.current as ScoreViewProps;
    props.onMeasureMapDirtyChange?.(true);
    fireEvent.change(picker, { target: { value: "2" } });

    const confirm = await screen.findByTestId(
      "score-workspace-piece-switch-confirm",
    );
    expect(confirm.className).toContain("score-workspace-piece-switch-confirm");
    const yes = screen.getByTestId("score-workspace-piece-switch-confirm-yes");
    const no = screen.getByTestId("score-workspace-piece-switch-confirm-no");
    expect(yes.className).toContain("is-danger");
    expect(no.className).toContain("is-safe");

    fireEvent.click(no);
    expect(
      screen.queryByTestId("score-workspace-piece-switch-confirm"),
    ).toBeNull();
  });

  it("shows the requested no-PDF piece instead of substituting another score", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") {
        return Promise.resolve([
          ...PIECES,
          {
            id: 3,
            title: "Unscanned Prelude",
            composer: "Composer",
            has_xml: false,
            has_pdf: false,
            intake_done: true,
          },
        ]);
      }
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace requestedPieceId={3} requestRevision={1} />);

    expect(
      await screen.findByRole("heading", { name: "Unscanned Prelude" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(
      /No PDF score is available for Unscanned Prelude/i,
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("piece_select", { id: 3 }),
    );
  });

  it("forwards the practice seam so the Practice tab can open a block", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });
    const onOpenBlock = vi.fn().mockResolvedValue(undefined);
    const onResumeSet = vi.fn().mockResolvedValue(undefined);
    const activeRep = { block_id: 77 } as never;

    render(
      <ScoreWorkspace
        onOpenBlock={onOpenBlock}
        onResumeSet={onResumeSet}
        defaultCleanStreak={4}
        isActive={false}
        activeRep={activeRep}
      />,
    );

    await screen.findByTestId("score-view-stub");
    const props = scoreViewProps.current as ScoreViewProps;
    expect(typeof props.onOpenBlock).toBe("function");
    expect(props.defaultCleanStreak).toBe(4);
    expect(props.isActive).toBe(false);
    expect(props.activeRep).toBe(activeRep);

    // The forwarded handler must reach the shell's rep.open.
    const args = {
      piece_id: 2,
      m_start: 1,
      m_end: 8,
      target_bpm: 96,
    };
    await props.onOpenBlock?.(args as never);
    expect(onOpenBlock).toHaveBeenCalledWith(args);
    await props.onResumeSet?.(901);
    expect(onResumeSet).toHaveBeenCalledWith(901);
  });

  it("lifts the selected piece and exact Score focus into Brain context", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      return Promise.resolve(undefined);
    });
    const onPracticeContextChange = vi.fn();

    render(
      <ScoreWorkspace onPracticeContextChange={onPracticeContextChange} />,
    );

    await screen.findByTestId("score-view-stub");
    await waitFor(() =>
      expect(onPracticeContextChange).toHaveBeenCalledWith(
        expect.objectContaining({
          piece_id: 1,
          piece_title: "Scherzo No. 2",
          surface: "score",
          region: null,
        }),
      ),
    );

    const props = scoreViewProps.current as ScoreViewProps;
    props.onContextChange?.({
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
    });

    expect(onPracticeContextChange).toHaveBeenLastCalledWith({
      piece_id: 1,
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
    });
  });

  it("shows an empty state when no piece has a PDF", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<ScoreWorkspace />);
    await waitFor(() =>
      expect(screen.getByText(/No pieces with a PDF score yet/i)).toBeTruthy(),
    );
  });

  it("opens on the Plan tab for a deep link and lists the piece's plan items (spec C3)", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      if (command === "day_sheet_get") {
        return Promise.resolve({
          date: "2026-07-27",
          body: [
            { type: "piece", piece_id: 1 },
            { type: "item", text: "Slow hands separately", checked: false },
          ],
          updated_at: "2026-07-27T00:00:00Z",
        });
      }
      return Promise.resolve(undefined);
    });

    render(
      <ReceiptCenterProvider>
        <TodaySheetProvider>
          <ScoreWorkspace
            requestedPieceId={1}
            requestRevision={1}
            requestedTab="plan"
          />
        </TodaySheetProvider>
      </ReceiptCenterProvider>,
    );

    // The deep link lands on the Plan tab, selected, not the Score reader.
    const planTab = await screen.findByRole("tab", { name: "Plan" });
    await waitFor(() =>
      expect(planTab.getAttribute("aria-selected")).toBe("true"),
    );
    // That piece's today plan item is shown from the shared store.
    const plan = await screen.findByRole("region", {
      name: "Today's plan for this piece",
    });
    await waitFor(() =>
      expect(
        within(plan).queryByDisplayValue("Slow hands separately"),
      ).toBeTruthy(),
    );
  });
});

describe("ScoreWorkspace — goals banner (A11)", () => {
  it("renders the selected piece's banner above the score page", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      if (command === "piece_get") {
        const id = ((args ?? {}) as { id?: number }).id;
        return Promise.resolve({
          id,
          banner_text: id === 1 ? "Even development voicing" : null,
        });
      }
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);

    const banner = await screen.findByTestId("score-banner");
    expect(banner.textContent).toContain("Even development voicing");
    // Above the page, not below it: the strip precedes the reader in the DOM.
    const view = screen.getByTestId("score-view-stub");
    expect(
      banner.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows only the quiet '+ goal' affordance for a piece with no banner", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      if (command === "piece_get")
        return Promise.resolve({ id: 1, banner_text: null });
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);

    expect(
      await screen.findByRole("button", { name: "Add a goal banner" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("score-banner")).toBeNull();
  });

  // Fix wave item 11 (live-QA finding): ScoreBanner and ScoreView used to
  // BOTH carry `key={selectedId}` as siblings under the same pane — React
  // warns "two children with the same key" on every mount/piece-switch
  // regardless of the two components being different types. ScoreView keeps
  // its key deliberately (a fresh mount per piece resets PDF/tool state);
  // ScoreBanner does not need one (it resets its own state via a
  // `[pieceId]` effect), so this pins that only ScoreView's key survives.
  it("does not warn about a duplicate React key between the banner and the score view", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "pieces_list") return Promise.resolve(PIECES);
      if (command === "piece_get") {
        const id = ((args ?? {}) as { id?: number }).id;
        return Promise.resolve({ id, banner_text: "One goal" });
      }
      return Promise.resolve(undefined);
    });

    render(<ScoreWorkspace />);
    await screen.findByTestId("score-view-stub");
    await screen.findByTestId("score-banner");

    const keyWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes("same key"),
    );
    expect(keyWarning).toBe(false);
    errorSpy.mockRestore();
  });
});
