import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WarmupsWorkspace } from "./WarmupsWorkspace";
import { WARMUP_CATALOG } from "./catalog";
import type { WarmupApi, WarmupRoutine } from "./types";
import type { RepOpenArgs, RepSnapshot } from "../rep/useRep";
import { DockProvider, useDock } from "../dock/DockProvider";
import { DockPanel } from "../dock/DockPanel";
import { DOCK_STORAGE_KEY } from "../dock/dockState";

const ORIGINAL_VIEWPORT = {
  width: window.innerWidth,
  height: window.innerHeight,
};

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

function seedShownRepPanel() {
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      rep: {
        x: 160,
        y: 108,
        minimized: false,
        open: true,
        z: 1,
        flashing: false,
      },
    }),
  );
}

function RepDockProbe() {
  const rep = useDock("rep");
  return (
    <output data-testid="warmups-rep-dock-state">
      {rep.isOpen ? "open" : "closed"}:
      {rep.isMinimized ? "minimized" : "shown"}
    </output>
  );
}

function WarmupsDockHarness({
  activeRep = null,
  onOpenBlock = vi.fn(),
}: {
  activeRep?: RepSnapshot | null;
  onOpenBlock?: ReturnType<typeof vi.fn>;
}) {
  const [showWarmups, setShowWarmups] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShowWarmups(false)}>
        Leave Warmups
      </button>
      {showWarmups ? (
        <WarmupsWorkspace
          activeRep={activeRep}
          onOpenBlock={onOpenBlock}
          api={fakeApi()}
        />
      ) : (
        <p>Another workspace</p>
      )}
      <DockPanel
        id="rep"
        title="Rep Counter"
        defaultPosition={{ x: 160, y: 108 }}
        width={440}
      >
        Active set remains here
      </DockPanel>
      <RepDockProbe />
    </>
  );
}

function routine(over: Partial<WarmupRoutine> = {}): WarmupRoutine {
  return {
    id: 7,
    name: "Octave day",
    items: [{ catalog_id: "octave-jumps", bpm: 52, clean_streak: 4 }],
    created_at: "2026-08-27T10:00:00Z",
    updated_at: "2026-08-27T10:00:00Z",
    ...over,
  };
}

function fakeApi(saved: WarmupRoutine[] = []) {
  const api: WarmupApi = {
    listRoutines: vi.fn(async () => saved),
    saveRoutine: vi.fn(async (input) =>
      routine({
        id: input.id ?? 12,
        name: input.name,
        items: input.items,
      }),
    ),
    deleteRoutine: vi.fn(async () => undefined),
    systemPiece: vi.fn(async () => ({ piece_id: 999, title: "Warm-ups" })),
  };
  return api;
}

function circuit(): WarmupRoutine {
  return routine({
    name: "Technique circuit",
    items: [
      { catalog_id: "octave-jumps", bpm: 52, clean_streak: 2 },
      { catalog_id: "broken-octaves", bpm: 60, clean_streak: 3 },
    ],
  });
}

function repFor(
  args: RepOpenArgs,
  over: Partial<RepSnapshot> = {},
): RepSnapshot {
  return {
    block_id: 81,
    piece_id: args.piece_id,
    piece_title: "Warm-ups",
    region_id: args.region_id ?? null,
    m_start: args.m_start,
    m_end: args.m_end,
    label: args.label,
    mastery_status: "not_satisfied",
    mastery_verified: true,
    set_state: "active",
    timer_state: "active",
    safety_state: "clear",
    last_attempt_id: 20,
    ...over,
  } as RepSnapshot;
}

function openingMock() {
  let blockId = 81;
  return vi.fn(async (args: RepOpenArgs) =>
    repFor(args, { block_id: blockId++ }),
  );
}

async function loadAndStart(
  onOpenBlock: ReturnType<typeof vi.fn>,
): Promise<RepOpenArgs> {
  await screen.findByText("Technique circuit");
  fireEvent.click(screen.getByRole("button", { name: /Technique circuit/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start routine" }));
  await waitFor(() => expect(onOpenBlock).toHaveBeenCalledTimes(1));
  return onOpenBlock.mock.calls[0][0] as RepOpenArgs;
}

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(DOCK_STORAGE_KEY);
  setViewport(ORIGINAL_VIEWPORT.width, ORIGINAL_VIEWPORT.height);
  vi.restoreAllMocks();
});

describe("WarmupsWorkspace", () => {
  it("tucks the open Rep Counter at exactly 720x520 without touching the active set, then restores it on exit", async () => {
    setViewport(720, 520);
    seedShownRepPanel();
    const onOpenBlock = vi.fn();
    const activeRep = Object.freeze(
      repFor(
        {
          piece_id: 5,
          m_start: 1,
          m_end: 4,
          label: "Repertoire set",
          start_bpm: 60,
        },
        { piece_id: 5, piece_title: "Chopin", block_id: 404 },
      ),
    );

    render(
      <DockProvider>
        <WarmupsDockHarness
          activeRep={activeRep}
          onOpenBlock={onOpenBlock}
        />
      </DockProvider>,
    );

    expect(
      await screen.findByText(/Rep Counter is tucked into Tools/),
    ).toBeTruthy();
    expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
      "open:minimized",
    );
    expect(onOpenBlock).not.toHaveBeenCalled();
    expect(activeRep).toEqual(
      expect.objectContaining({
        block_id: 404,
        piece_id: 5,
        set_state: "active",
        timer_state: "active",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave Warmups" }));
    await waitFor(() =>
      expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
        "open:shown",
      ),
    );
  });

  it("leaves the open Rep Counter visible above the compact boundary", async () => {
    setViewport(900, 700);
    seedShownRepPanel();

    render(
      <DockProvider>
        <WarmupsDockHarness />
      </DockProvider>,
    );

    await screen.findByText("C major scale");
    expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
      "open:shown",
    );
    expect(
      screen.queryByText(/Rep Counter is tucked into Tools/),
    ).toBeNull();
  });

  it("restores its owned tuck immediately when the viewport grows out of compact mode", async () => {
    setViewport(720, 520);
    seedShownRepPanel();

    render(
      <DockProvider>
        <WarmupsDockHarness />
      </DockProvider>,
    );

    expect(
      await screen.findByText(/Rep Counter is tucked into Tools/),
    ).toBeTruthy();
    expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
      "open:minimized",
    );

    act(() => setViewport(900, 700));

    await waitFor(() =>
      expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
        "open:shown",
      ),
    );
    expect(
      screen.queryByText(/Rep Counter is tucked into Tools/),
    ).toBeNull();
  });

  it("respects a user restore and close instead of reopening that override on exit", async () => {
    setViewport(720, 520);
    seedShownRepPanel();

    render(
      <DockProvider>
        <WarmupsDockHarness />
      </DockProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Show Rep Counter" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
        "open:shown",
      ),
    );
    expect(
      screen.queryByText(/Rep Counter is tucked into Tools/),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close Rep Counter" }));
    expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
      "closed:shown",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave Warmups" }));

    await waitFor(() =>
      expect(screen.getByTestId("warmups-rep-dock-state").textContent).toBe(
        "closed:shown",
      ),
    );
  });

  it("keeps the catalog shrinkable inside the 480px stage at 720×520", () => {
    const css = readFileSync(
      resolve("src/features/warmups/warmups.css"),
      "utf8",
    );
    const effectiveStageWidth = 480;
    const headingPreferredWidth = 210 + 180 + 12;
    const twoCardPreferredWidth = 210 * 2 + 10;

    expect(headingPreferredWidth).toBeLessThanOrEqual(effectiveStageWidth);
    expect(twoCardPreferredWidth).toBeLessThanOrEqual(effectiveStageWidth);
    expect(css).toMatch(
      /\.warmups-layout\s*>\s*\*,\s*\.warmup-catalog\s*\{[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.warmups-section-heading\s*\{[^}]*flex-wrap:\s*wrap[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.warmups-section-heading\s*>\s*div\s*\{[^}]*flex:\s*1 1 210px[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.warmups-section-heading input\s*\{[^}]*box-sizing:\s*border-box[^}]*flex:\s*1 1 180px[^}]*min-width:\s*0[^}]*max-width:\s*300px/s,
    );
    expect(css).toMatch(
      /\.warmup-targets\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s,
    );
    expect(css).toMatch(
      /\.warmup-card-grid\s*\{[^}]*min-width:\s*0[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(210px, 100%\), 1fr\)\)/s,
    );
  });

  it("starts with the purpose and target vocabulary visible", async () => {
    render(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={vi.fn()}
        api={fakeApi()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Warmups with a reason" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Octaves" })).toBeTruthy();
    expect(screen.getByText(String(WARMUP_CATALOG.length))).toBeTruthy();
    await waitFor(() => expect(screen.getByText("C major scale")).toBeTruthy());
  });

  it("makes the complete catalog reachable without rendering every card at once", async () => {
    render(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={vi.fn()}
        api={fakeApi()}
      />,
    );
    expect(
      screen.getByText(`Showing 36 of ${WARMUP_CATALOG.length}`),
    ).toBeTruthy();
    expect(screen.queryByText("Major cadence progression — voiced")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more warmups" }));
    expect(
      screen.getByText(`Showing 72 of ${WARMUP_CATALOG.length}`),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more warmups" }));
    fireEvent.click(screen.getByRole("button", { name: "Show more warmups" }));

    expect(
      screen.getByText(
        `Showing ${WARMUP_CATALOG.length} of ${WARMUP_CATALOG.length}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Major cadence progression — voiced")).toBeTruthy();
    expect(screen.getByText("B minor arpeggio")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Show more warmups" }),
    ).toBeNull();
  });

  it("filters by demand and adds a configured item to today's routine", async () => {
    render(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={vi.fn()}
        api={fakeApi()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Octaves" }));
    expect(screen.getByText("Octave jumps — silent landing")).toBeTruthy();
    const card = screen
      .getByText("Octave jumps — silent landing")
      .closest("article")!;
    fireEvent.click(card.querySelector("button")!);
    expect(screen.getAllByText("Octave jumps — silent landing")).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("button", { name: "Start routine" }),
    ).not.toHaveProperty("disabled", true);
  });

  it("saves and reloads named routines", async () => {
    const api = fakeApi([routine()]);
    render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={vi.fn()} api={api} />,
    );
    await screen.findByText("Octave day");
    fireEvent.click(screen.getByRole("button", { name: /Octave day/ }));
    fireEvent.change(screen.getByLabelText("Routine name"), {
      target: { value: "Octaves before Chopin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update routine" }));
    await waitFor(() =>
      expect(api.saveRoutine).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          name: "Octaves before Chopin",
          items: [{ catalog_id: "octave-jumps", bpm: 52, clean_streak: 4 }],
        }),
      ),
    );
  });

  it("offers a real New routine action after loading a saved routine", async () => {
    render(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={vi.fn()}
        api={fakeApi([routine()])}
      />,
    );
    await screen.findByText("Octave day");
    fireEvent.click(screen.getByRole("button", { name: /Octave day/ }));
    expect(
      (screen.getByLabelText("Routine name") as HTMLInputElement).value,
    ).toBe("Octave day");

    fireEvent.click(screen.getByRole("button", { name: "New routine" }));

    expect(
      (screen.getByLabelText("Routine name") as HTMLInputElement).value,
    ).toBe("Today's warmup");
    expect(screen.queryByText("Octave jumps — silent landing")).toBeNull();
    expect(screen.getByRole("button", { name: "Save routine" })).toBeTruthy();
  });

  it("opens a warmup through the normal practice engine", async () => {
    const api = fakeApi([routine()]);
    const onOpenBlock = openingMock();
    render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    await screen.findByText("Octave day");
    fireEvent.click(screen.getByRole("button", { name: /Octave day/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start routine" }));
    await waitFor(() => expect(onOpenBlock).toHaveBeenCalledTimes(1));
    expect(onOpenBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        piece_id: 999,
        label: "Octave jumps — silent landing",
        start_bpm: 52,
        required_clean_streak: 4,
        use_metronome: true,
      }),
      expect.objectContaining({
        method: "warmup",
        judging_axis: expect.stringContaining("octaves"),
      }),
    );
  });

  it("refuses to replace an active repertoire set", async () => {
    const api = fakeApi([routine()]);
    const onOpenBlock = openingMock();
    render(
      <WarmupsWorkspace
        activeRep={{ piece_id: 5 } as never}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    await screen.findByText("Octave day");
    fireEvent.click(screen.getByRole("button", { name: /Octave day/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start routine" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Pause or close the current practice set",
    );
    expect(onOpenBlock).not.toHaveBeenCalled();
  });

  it("advances hands-free only after the exact opened block proves verified mastery", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const firstArgs = await loadAndStart(onOpenBlock);
    const first = repFor(firstArgs);

    view.rerender(
      <WarmupsWorkspace
        activeRep={first}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    expect(await screen.findByText("Rep Counter is running")).toBeTruthy();

    const mastered = repFor(firstArgs, {
      block_id: first.block_id,
      mastery_status: "satisfied",
      mastery_verified: true,
      last_attempt_id: 21,
    });
    view.rerender(
      <WarmupsWorkspace
        activeRep={mastered}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    expect(
      await screen.findByText(
        "Mastery verified · waiting for automatic close…",
      ),
    ).toBeTruthy();

    now.mockReturnValue(7_000);
    view.rerender(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    await waitFor(() => expect(onOpenBlock).toHaveBeenCalledTimes(2));
    expect(onOpenBlock.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        piece_id: 999,
        label: "Broken octaves",
        required_clean_streak: 3,
      }),
    );
    expect(screen.getByText(/2\/2 · Broken octaves/)).toBeTruthy();
  });

  it("celebrates a completed routine exactly once", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const api = fakeApi([routine()]);
    const onOpenBlock = openingMock();
    const onRoutineComplete = vi.fn();
    const view = render(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={onOpenBlock}
        onRoutineComplete={onRoutineComplete}
        api={api}
      />,
    );

    await screen.findByText("Octave day");
    fireEvent.click(screen.getByRole("button", { name: /Octave day/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start routine" }));
    await waitFor(() => expect(onOpenBlock).toHaveBeenCalledTimes(1));
    const args = onOpenBlock.mock.calls[0][0] as RepOpenArgs;

    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args)}
        onOpenBlock={onOpenBlock}
        onRoutineComplete={onRoutineComplete}
        api={api}
      />,
    );
    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, {
          mastery_status: "satisfied",
          mastery_verified: true,
          last_attempt_id: 21,
        })}
        onOpenBlock={onOpenBlock}
        onRoutineComplete={onRoutineComplete}
        api={api}
      />,
    );

    now.mockReturnValue(7_000);
    view.rerender(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={onOpenBlock}
        onRoutineComplete={onRoutineComplete}
        api={api}
      />,
    );

    expect(await screen.findByText("Routine complete")).toBeTruthy();
    await waitFor(() => expect(onRoutineComplete).toHaveBeenCalledTimes(1));

    view.rerender(
      <WarmupsWorkspace
        activeRep={null}
        onOpenBlock={onOpenBlock}
        onRoutineComplete={onRoutineComplete}
        api={api}
      />,
    );
    expect(onRoutineComplete).toHaveBeenCalledTimes(1);
  });

  it("owns the returned block id and rejects a same-label replacement", async () => {
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const args = await loadAndStart(onOpenBlock);

    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, { block_id: 82 })}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "different practice set",
    );
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Start this warmup" }),
    ).toBeTruthy();
  });

  it("does not mistake a manual close during the completion countdown for auto-close", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const args = await loadAndStart(onOpenBlock);
    const active = repFor(args);
    view.rerender(
      <WarmupsWorkspace
        activeRep={active}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, {
          mastery_status: "satisfied",
          mastery_verified: true,
          last_attempt_id: 21,
        })}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    expect(
      await screen.findByText(
        "Mastery verified · waiting for automatic close…",
      ),
    ).toBeTruthy();

    now.mockReturnValue(2_000);
    view.rerender(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "closed before the automatic-completion window",
    );
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1\/2 · Octave jumps/)).toBeTruthy();
  });

  it("does not advance on an unverified terminal projection or a generic close", async () => {
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const args = await loadAndStart(onOpenBlock);
    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, {
          mastery_status: "satisfied",
          mastery_verified: false,
        })}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    expect(await screen.findByText("Rep Counter is running")).toBeTruthy();

    view.rerender(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "ended before verified mastery",
    );
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Start this warmup" }),
    ).toBeTruthy();
  });

  it("never adopts or advances from an unrelated set", async () => {
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const args = await loadAndStart(onOpenBlock);
    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, {
          block_id: 404,
          label: "Unrelated set",
          mastery_status: "satisfied",
        })}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "different practice set",
    );
    view.rerender(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1\/2 · Octave jumps/)).toBeTruthy();
  });

  it("holds a safety-stopped exact set and does not treat its disappearance as completion", async () => {
    const api = fakeApi([circuit()]);
    const onOpenBlock = openingMock();
    const view = render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    const args = await loadAndStart(onOpenBlock);
    view.rerender(
      <WarmupsWorkspace
        activeRep={repFor(args, {
          safety_state: "stopped",
          mastery_status: "satisfied",
        })}
        onOpenBlock={onOpenBlock}
        api={api}
      />,
    );
    expect(
      await screen.findByText("Safety stop is holding this item"),
    ).toBeTruthy();

    view.rerender(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "ended before verified mastery",
    );
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
  });

  it("guards same-tick starts and ignores a stale open after leaving the run epoch", async () => {
    const api = fakeApi([circuit()]);
    let finishOpen: ((snap: RepSnapshot) => void) | null = null;
    const onOpenBlock = vi.fn(
      (args: RepOpenArgs) =>
        new Promise<RepSnapshot>((resolve) => {
          finishOpen = (snap) => resolve(snap);
          void args;
        }),
    );
    render(
      <WarmupsWorkspace activeRep={null} onOpenBlock={onOpenBlock} api={api} />,
    );
    await screen.findByText("Technique circuit");
    fireEvent.click(screen.getByRole("button", { name: /Technique circuit/ }));
    const start = screen.getByRole("button", { name: "Start routine" });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(onOpenBlock).toHaveBeenCalledTimes(1));
    expect(api.systemPiece).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Leave routine" }));
    const args = onOpenBlock.mock.calls[0][0] as RepOpenArgs;
    await act(async () => {
      finishOpen?.(repFor(args));
      await Promise.resolve();
    });

    expect(
      screen.queryByRole("region", { name: "Active warmup routine" }),
    ).toBeNull();
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
  });
});
