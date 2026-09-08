import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DockProvider, useDock } from "./DockProvider";
import { DOCK_STORAGE_KEY } from "./dockState";
import { PracticeDockPolicy } from "./PracticeDockPolicy";

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    },
  });
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      rep: { open: true, minimized: false, x: 10, y: 20, z: 1 },
    }),
  );
});
afterEach(cleanup);

function Probe() {
  const dock = useDock("rep");
  return (
    <>
      <output>
        {!dock.isOpen ? "closed" : dock.isMinimized ? "tucked" : "expanded"}
      </output>
      <button onClick={dock.open}>Restore</button>
      <button onClick={dock.openAutomatically}>Reveal active set</button>
      <button onClick={dock.close}>Close</button>
      <button onClick={dock.minimize}>Minimize</button>
    </>
  );
}
function Harness({ practiceView }: { practiceView: boolean }) {
  return (
    <DockProvider>
      <PracticeDockPolicy practiceView={practiceView} />
      <Probe />
    </DockProvider>
  );
}

it("tucks while browsing and restores only when returning to practice", () => {
  const view = render(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("expanded");
  view.rerender(<Harness practiceView={false} />);
  expect(screen.getByRole("status").textContent).toBe("tucked");
  view.rerender(<Harness practiceView={false} />);
  expect(screen.getByRole("status").textContent).toBe("tucked");
  view.rerender(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("expanded");
});

it("allows a deliberate restore while browsing", () => {
  const view = render(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.getByRole("status").textContent).toBe("expanded");
  view.rerender(<Harness practiceView={false} />);
  expect(screen.getByRole("status").textContent).toBe("expanded");
});

it("does not reopen a panel the musician closed", () => {
  const view = render(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  view.rerender(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("closed");
});

it("preserves a deliberate minimize when leaving and returning to practice", () => {
  const view = render(<Harness practiceView />);
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  view.rerender(<Harness practiceView={false} />);
  view.rerender(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("tucked");
});

it("allows manual restore when browsing began with a saved minimized panel", () => {
  window.localStorage.setItem(
    DOCK_STORAGE_KEY,
    JSON.stringify({
      rep: { open: true, minimized: true, x: 10, y: 20, z: 1 },
    }),
  );
  render(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.getByRole("status").textContent).toBe("expanded");
});

it("does not override a manual minimize after restoring an automatically tucked panel", () => {
  const view = render(<Harness practiceView />);
  view.rerender(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  view.rerender(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("tucked");
});

it("allows manual restore of an initially closed panel while browsing", () => {
  window.localStorage.setItem(DOCK_STORAGE_KEY, "{}");
  render(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.getByRole("status").textContent).toBe("expanded");
});

it("tucks a delayed automatic set reveal and restores it at the score", () => {
  window.localStorage.setItem(DOCK_STORAGE_KEY, "{}");
  const view = render(<Harness practiceView={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Reveal active set" }));
  expect(screen.getByRole("status").textContent).toBe("tucked");
  view.rerender(<Harness practiceView />);
  expect(screen.getByRole("status").textContent).toBe("expanded");
});
