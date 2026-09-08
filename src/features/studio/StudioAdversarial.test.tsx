import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioProvider, useStudio } from "./StudioProvider";
import { StudioWorkspace } from "./StudioWorkspace";
import type { StudioSnapshot } from "./studioApi";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Map<string, () => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (event: string, callback: () => void) => {
  mocks.handlers.set(event, callback);
  return Promise.resolve(() => mocks.handlers.delete(event));
} }));

function snapshot(revision = 0): StudioSnapshot {
  return {
    revision,
    profile: { display_name: "Pianist" },
    progress: { total_xp: 100, focused_seconds: 60000, focus_xp: 100, set_xp: 0, completed_sets: 0, current_session_sets: 0, next_set_milestone: 3, rank_index: 1, rank_name: "Prelude", division: 2, division_xp: 0, division_xp_required: 100, divisions_completed: 1 },
    wallet: { earned_coins: 25, spent_coins: 0, balance: 25 },
    owned_item_ids: ["decor-none"],
    equipped: { piano: "piano-digital", seat: "seat-box", shelf: "shelf-none", decor: "decor-none", room: "room-first", theme: "theme-slate" },
    catalog: [
      { id: "decor-none", name: "Quiet space", description: "Just music", slot: "decor", price: 0, unlock_rank: 1 },
      { id: "decor-plant", name: "Studio fern", description: "A plant", slot: "decor", price: 25, unlock_rank: 1 },
    ],
  };
}

beforeEach(() => { mocks.invoke.mockReset(); mocks.handlers.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps rejected purchase error and revision refresh inside the active dialog", async () => {
  let current = snapshot();
  mocks.invoke.mockImplementation((command: string) => command === "studio_snapshot" ? Promise.resolve(current) : Promise.reject("Studio changed elsewhere. Refresh it before trying again."));
  render(<StudioProvider><StudioWorkspace onOpenPractice={vi.fn()} /></StudioProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "25 coins · Get" }));
  let dialog = screen.getByRole("dialog", { name: "Get furnishing" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Get for 25 coins" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Studio changed elsewhere"));
  current = snapshot(4);
  fireEvent.click(within(dialog).getByRole("button", { name: "Refresh values" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  mocks.invoke.mockImplementation((command: string, args?: { expectedRevision: number }) => {
    if (command === "studio_snapshot") return Promise.resolve(current);
    expect(args?.expectedRevision).toBe(4);
    return Promise.resolve({ ...current, revision: 5, wallet: { earned_coins: 25, spent_coins: 25, balance: 0 }, owned_item_ids: ["decor-none", "decor-plant"], equipped: { ...current.equipped, decor: "decor-plant" } });
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Get for 25 coins" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Studio fern is now in your room.")).toBeTruthy();
});

it("keeps a rejected profile save visible without discarding the user's name", async () => {
  mocks.invoke.mockImplementation((command: string) => command === "studio_snapshot" ? Promise.resolve(snapshot()) : Promise.reject("Display name cannot contain control characters."));
  render(<StudioProvider><StudioWorkspace onOpenPractice={vi.fn()} /></StudioProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Pianist" }));
  const dialog = screen.getByRole("dialog", { name: "Your local profile" });
  const input = within(dialog).getByRole("textbox", { name: "Display name" });
  fireEvent.change(input, { target: { value: "My chosen name" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("control characters"));
  expect((input as HTMLInputElement).value).toBe("My chosen name");
});

function Probe() {
  const state = useStudio();
  return <><span data-testid="xp">{state.snapshot?.progress.total_xp}</span><button onClick={() => void state.refresh()}>Refresh</button><button onClick={() => void state.mutate(() => mocks.invoke("change"), "Saved")}>Change</button></>;
}

it("ignores a read started before a later successful mutation", async () => {
  let resolveOld!: (value: StudioSnapshot) => void;
  mocks.invoke.mockResolvedValueOnce(snapshot());
  render(<StudioProvider><Probe /></StudioProvider>);
  await waitFor(() => expect(screen.getByTestId("xp").textContent).toBe("100"));
  mocks.invoke.mockImplementation((command: string) => command === "studio_snapshot" ? new Promise<StudioSnapshot>(resolve => { resolveOld = resolve; }) : Promise.resolve({ ...snapshot(1), progress: { ...snapshot().progress, total_xp: 200 } }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  await waitFor(() => expect(screen.getByTestId("xp").textContent).toBe("200"));
  await act(async () => resolveOld(snapshot()));
  expect(screen.getByTestId("xp").textContent).toBe("200");
});

it("replays practice refresh requests received while a Studio mutation is in flight", async () => {
  vi.useFakeTimers();
  let resolveMutation!: (value: StudioSnapshot) => void;
  let calls = 0;
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "change") return new Promise<StudioSnapshot>(resolve => { resolveMutation = resolve; });
    calls++;
    return Promise.resolve(calls === 1 ? snapshot() : { ...snapshot(1), progress: { ...snapshot().progress, total_xp: 101 } });
  });
  render(<StudioProvider><Probe /></StudioProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  act(() => mocks.handlers.get("rep://state")?.());
  await act(async () => { vi.advanceTimersByTime(701); });
  await act(async () => resolveMutation(snapshot(1)));
  await act(async () => { vi.advanceTimersByTime(701); });
  expect(screen.getByTestId("xp").textContent).toBe("101");
});
