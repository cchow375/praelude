import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import { CalibrationWizard, CAPTURE_EVENT_COUNT } from "./CalibrationWizard";

/** A hand-driven stand-in for the `dynamics://level` stream. */
const stream = () => {
  const listeners: ((db: number) => void)[] = [];
  return {
    subscribe: (fn: (db: number) => void) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit: (db: number) => {
      act(() => {
        listeners.forEach((l) => l(db));
      });
    },
    count: () => listeners.length,
  };
};

/** One full capture: press Capture, then feed a whole 2s window at `db`. */
function capture(s: ReturnType<typeof stream>, db: number) {
  fireEvent.click(screen.getByRole("button", { name: /capture/i }));
  for (let k = 0; k < CAPTURE_EVENT_COUNT; k++) s.emit(db);
}

describe("CalibrationWizard", () => {
  it("walks pp -> p -> mf -> f -> ff, one capture per step", async () => {
    const s = stream();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/play pp/i)).toBeTruthy();
    for (const [i, db] of [-48, -38, -28, -18, -9].entries()) {
      capture(s, db);
      await waitFor(() =>
        expect(screen.getByTestId("wizard-step").textContent).toBe(
          String(i + 1 < 5 ? i + 2 : 5),
        ),
      );
    }
    expect(screen.getByLabelText(/profile name/i)).toBeTruthy();
  });

  it("stores the MEDIAN of the capture window, so one bang cannot move a step", async () => {
    const s = stream();
    const onSave = vi.fn();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    // pp: fifteen samples at -48 and one loud stray at -3.
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));
    for (let k = 0; k < CAPTURE_EVENT_COUNT - 1; k++) s.emit(-48);
    s.emit(-3);
    await waitFor(() =>
      expect(screen.getByTestId("wizard-step").textContent).toBe("2"),
    );
    for (const db of [-38, -28, -18, -9]) capture(s, db);

    fireEvent.change(screen.getByLabelText(/profile name/i), {
      target: { value: "Steinway" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, points] = onSave.mock.calls[0];
    expect(points[0]).toEqual({ dynamic_label: "pp", measured_db: -48 });
  });

  it("refuses to save a non-increasing capture and says exactly which step is wrong", async () => {
    const s = stream();
    const onSave = vi.fn();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    for (const db of [-48, -29.8, -31.4, -18, -9]) capture(s, db);
    fireEvent.change(screen.getByLabelText(/profile name/i), {
      target: { value: "Steinway" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("mf"),
    );
    expect(screen.getByRole("alert").textContent).toContain("-31.4");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("requires a free-text profile label before saving", async () => {
    const s = stream();
    const onSave = vi.fn();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    for (const db of [-48, -38, -28, -18, -9]) capture(s, db);
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/profile name/i), {
      target: { value: "Steinway, living room, lid half" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Steinway, living room, lid half", [
        { dynamic_label: "pp", measured_db: -48 },
        { dynamic_label: "p", measured_db: -38 },
        { dynamic_label: "mf", measured_db: -28 },
        { dynamic_label: "f", measured_db: -18 },
        { dynamic_label: "ff", measured_db: -9 },
      ]),
    );
  });

  it("ignores level events while no capture is in flight", async () => {
    const s = stream();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    for (let k = 0; k < 100; k++) s.emit(-20);
    expect(screen.getByTestId("wizard-step").textContent).toBe("1");
  });

  it("start again clears every captured step", async () => {
    const s = stream();
    render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    capture(s, -48);
    capture(s, -38);
    await waitFor(() =>
      expect(screen.getByTestId("wizard-step").textContent).toBe("3"),
    );
    fireEvent.click(screen.getByRole("button", { name: /start again/i }));
    expect(screen.getByTestId("wizard-step").textContent).toBe("1");
    expect(screen.getByText(/play pp/i)).toBeTruthy();
  });

  it("unsubscribes from the level stream on unmount", () => {
    const s = stream();
    const { unmount } = render(
      <CalibrationWizard
        levelStream={s.subscribe}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(s.count()).toBe(1);
    unmount();
    expect(s.count()).toBe(0);
  });
});
