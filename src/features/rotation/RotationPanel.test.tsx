import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockProvider } from "../dock/DockProvider";
import { DOCK_STORAGE_KEY } from "../dock/dockState";
import type { RepSnapshot } from "../rep/useRep";
import {
  DEFAULT_POSITION,
  RotationPanel,
  type RotationPanelProps,
} from "./RotationPanel";
import {
  ROTATION_STORAGE_KEY,
  type RotationSettings,
  type RotationTarget,
} from "./rotation";

const FIRST: RotationTarget = {
  key: "2:9",
  piece_id: 2,
  region_id: 9,
  piece_title: "Scherzo",
  label: "Rolled chords",
  m_start: 552,
  m_end: 576,
  sound_target: "Grand, without banging",
};

const SECOND: RotationTarget = {
  key: "2:10",
  piece_id: 2,
  region_id: 10,
  piece_title: "Scherzo",
  label: "Coda landing",
  m_start: 577,
  m_end: 588,
  sound_target: null,
};

const INITIAL_VIEWPORT = {
  width: window.innerWidth,
  height: window.innerHeight,
};

function snapshot(
  target: RotationTarget,
  blockId: number,
  over: Partial<RepSnapshot> = {},
): RepSnapshot {
  return {
    block_id: blockId,
    piece_id: target.piece_id,
    piece_title: target.piece_title,
    region_id: target.region_id,
    m_start: target.m_start,
    m_end: target.m_end,
    set_state: "active",
    timer_state: "active",
    ...over,
  } as RepSnapshot;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installMemoryStorage() {
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
}

function seedPanel(settings: Partial<RotationSettings> = {}) {
  window.localStorage.setItem(
    ROTATION_STORAGE_KEY,
    JSON.stringify({
      targets: [FIRST, SECOND],
      station_minutes: 1,
      shuffle: false,
      ...settings,
    }),
  );
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      rotation: {
        x: 160,
        y: 184,
        minimized: false,
        open: true,
        z: 1,
        flashing: false,
      },
    }),
  );
}

function panelProps(
  over: Partial<RotationPanelProps> = {},
): RotationPanelProps {
  return {
    activeRep: null,
    defaultCleanStreak: 3,
    onOpenBlock: vi.fn(async () => snapshot(FIRST, 101)),
    onPause: vi.fn(async () => undefined),
    audioFactory: vi.fn(() => ({ play: vi.fn(async () => undefined) })),
    now: Date.now,
    ...over,
  };
}

function renderPanel(props: RotationPanelProps) {
  return render(
    <DockProvider>
      <RotationPanel {...props} />
    </DockProvider>,
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickButton(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
  await flushMicrotasks();
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 520,
  });
  installMemoryStorage();
  seedPanel();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: INITIAL_VIEWPORT.width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: INITIAL_VIEWPORT.height,
  });
});

describe("RotationPanel — dense-layout dock clearance", () => {
  it("pulls an unsafe restored position above Tools and remains keyboard-draggable", () => {
    window.localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        rotation: {
          x: 160,
          y: 360,
          minimized: false,
          open: true,
          z: 1,
          flashing: false,
        },
      }),
    );

    renderPanel(panelProps());
    const panel = screen.getByRole("dialog", { name: "Practice rotation" });
    expect(panel.style.transform).toBe(
      `translate(160px, ${DEFAULT_POSITION.y}px)`,
    );

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(panel.style.transform).toBe(
      `translate(160px, ${DEFAULT_POSITION.y - 8}px)`,
    );
  });
});

describe("RotationPanel — no-yank deadline", () => {
  it("prompts and chimes once at the deadline without pausing or opening", async () => {
    const play = vi.fn(async () => undefined);
    const audioFactory = vi.fn(() => ({ play }));
    const onOpenBlock = vi.fn(async () => snapshot(FIRST, 101));
    const onPause = vi.fn(async () => undefined);
    renderPanel(panelProps({ onOpenBlock, onPause, audioFactory }));

    await clickButton("Start rotation");
    expect(onOpenBlock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(60_000));

    expect(play).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Time — retrieve the next passage when you are ready."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next station" })).toBeTruthy();
  });

  it("starts the full deadline only after a delayed open resolves", async () => {
    const opened = deferred<RepSnapshot>();
    const play = vi.fn(async () => undefined);
    const onOpenBlock = vi.fn(() => opened.promise);
    renderPanel(
      panelProps({
        onOpenBlock,
        audioFactory: () => ({ play }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start rotation" }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(play).not.toHaveBeenCalled();

    opened.resolve(snapshot(FIRST, 101));
    await flushMicrotasks();
    act(() => vi.advanceTimersByTime(59_999));
    expect(play).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("starts a later station's full deadline only after that open resolves", async () => {
    const nextOpened = deferred<RepSnapshot>();
    const first = snapshot(FIRST, 101);
    const play = vi.fn(async () => undefined);
    const onOpenBlock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => nextOpened.promise);
    const props = panelProps({
      onOpenBlock,
      audioFactory: () => ({ play }),
    });
    const view = renderPanel(props);
    await clickButton("Start rotation");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={first} />
      </DockProvider>,
    );

    await clickButton("Next station");
    act(() => vi.advanceTimersByTime(120_000));
    expect(play).not.toHaveBeenCalled();

    nextOpened.resolve(snapshot(SECOND, 202));
    await flushMicrotasks();
    act(() => vi.advanceTimersByTime(59_999));
    expect(play).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("never mutates an unrelated same-target block at or after the deadline", async () => {
    const onOpenBlock = vi.fn(async () => snapshot(FIRST, 101));
    const onPause = vi.fn(async () => undefined);
    const props = panelProps({ onOpenBlock, onPause });
    const view = renderPanel(props);
    await clickButton("Start rotation");

    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={snapshot(FIRST, 999)} />
      </DockProvider>,
    );
    act(() => vi.advanceTimersByTime(60_000));
    await clickButton("Next station");

    expect(onPause).not.toHaveBeenCalled();
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Another practice set is active/)).toBeTruthy();
  });
});

describe("RotationPanel — exact transition ownership", () => {
  it("pauses only its exact block and guards a double Next in the same turn", async () => {
    const pause = deferred<void>();
    const first = snapshot(FIRST, 101);
    const second = snapshot(SECOND, 202);
    const onOpenBlock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const onPause = vi.fn(() => pause.promise);
    const props = panelProps({ onOpenBlock, onPause });
    const view = renderPanel(props);
    await clickButton("Start rotation");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={first} />
      </DockProvider>,
    );

    const next = screen.getByRole("button", { name: "Next station" });
    act(() => {
      fireEvent.click(next);
      fireEvent.click(next);
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledWith(101);
    expect(onOpenBlock).toHaveBeenCalledTimes(1);

    pause.resolve();
    await flushMicrotasks();
    expect(onOpenBlock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Coda landing")).toBeTruthy();
  });

  it("leaves a failed Next retryable without pausing the same set twice", async () => {
    const first = snapshot(FIRST, 101);
    const second = snapshot(SECOND, 202);
    const onOpenBlock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("Could not open Coda landing."))
      .mockResolvedValueOnce(second);
    const onPause = vi.fn(async () => undefined);
    const props = panelProps({ onOpenBlock, onPause });
    const view = renderPanel(props);
    await clickButton("Start rotation");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={first} />
      </DockProvider>,
    );

    await clickButton("Next station");
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Choose Next station to retry/)).toBeTruthy();

    view.rerender(
      <DockProvider>
        <RotationPanel
          {...props}
          activeRep={snapshot(FIRST, 101, {
            set_state: "paused",
            timer_state: "paused",
          })}
        />
      </DockProvider>,
    );
    await clickButton("Next station");

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onOpenBlock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Coda landing")).toBeTruthy();
  });

  it("rejects a mismatched returned snapshot instead of claiming ownership", async () => {
    const onOpenBlock = vi.fn(async () => snapshot(SECOND, 202));
    renderPanel(panelProps({ onOpenBlock }));

    await clickButton("Start rotation");

    expect(screen.getByText(/opened a different set/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start rotation" })).toBeTruthy();
  });
});

describe("RotationPanel — epochs and full cycles", () => {
  it("guards a double Start and cannot claim to end while its open is pending", async () => {
    const opened = deferred<RepSnapshot>();
    const onOpenBlock = vi.fn(() => opened.promise);
    renderPanel(panelProps({ onOpenBlock }));

    const start = screen.getByRole("button", { name: "Start rotation" });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    expect(onOpenBlock).toHaveBeenCalledTimes(1);
    const endWhileOpening = screen.getByRole("button", {
      name: "End rotation",
    }) as HTMLButtonElement;
    expect(endWhileOpening.disabled).toBe(true);
    fireEvent.click(endWhileOpening);

    opened.resolve(snapshot(FIRST, 101));
    await flushMicrotasks();

    expect(
      screen.getByText(/Rotation started with Rolled chords/),
    ).toBeTruthy();
    const end = screen.getByRole("button", {
      name: "End rotation",
    }) as HTMLButtonElement;
    expect(end.disabled).toBe(false);
    fireEvent.click(end);
    expect(
      screen.getByText(
        "Rotation ended. The current practice set was left unchanged.",
      ),
    ).toBeTruthy();
  });

  it("cannot claim to end while the next station mutation is in flight", async () => {
    const nextOpened = deferred<RepSnapshot>();
    const first = snapshot(FIRST, 101);
    const onOpenBlock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => nextOpened.promise);
    const props = panelProps({ onOpenBlock });
    const view = renderPanel(props);
    await clickButton("Start rotation");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={first} />
      </DockProvider>,
    );

    await clickButton("Next station");
    const endWhileSwitching = screen.getByRole("button", {
      name: "End rotation",
    }) as HTMLButtonElement;
    expect(endWhileSwitching.disabled).toBe(true);
    fireEvent.click(endWhileSwitching);
    nextOpened.resolve(snapshot(SECOND, 202));
    await flushMicrotasks();

    expect(screen.getByText(/Retrieved Coda landing/)).toBeTruthy();
    const end = screen.getByRole("button", {
      name: "End rotation",
    }) as HTMLButtonElement;
    expect(end.disabled).toBe(false);
    fireEvent.click(end);
    expect(
      screen.getByText(
        "Rotation ended. The current practice set was left unchanged.",
      ),
    ).toBeTruthy();
  });

  it("ends after the final station instead of silently wrapping to station one", async () => {
    const first = snapshot(FIRST, 101);
    const second = snapshot(SECOND, 202);
    const play = vi.fn(async () => undefined);
    const onOpenBlock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const onPause = vi.fn(async () => undefined);
    const onCycleComplete = vi.fn();
    const props = panelProps({
      onOpenBlock,
      onPause,
      onCycleComplete,
      audioFactory: () => ({ play }),
    });
    const view = renderPanel(props);
    await clickButton("Start rotation");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={first} />
      </DockProvider>,
    );
    await clickButton("Next station");
    view.rerender(
      <DockProvider>
        <RotationPanel {...props} activeRep={second} />
      </DockProvider>,
    );

    act(() => vi.advanceTimersByTime(60_000));

    expect(play).toHaveBeenCalledTimes(1);
    expect(onOpenBlock).toHaveBeenCalledTimes(2);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Cycle 1 complete — all 2 passages retrieved."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start next cycle" }),
    ).toBeTruthy();
    expect(onCycleComplete).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(60_000));
    expect(onCycleComplete).toHaveBeenCalledTimes(1);
  });
});
