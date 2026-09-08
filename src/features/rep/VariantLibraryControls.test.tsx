import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BlockForm } from "./BlockForm";
import type { VariantLibrary } from "./useVariantLibrary";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let disk: VariantLibrary;
let failSave = false;
beforeEach(() => {
  disk = { revision: 0, custom_variants: [], hidden_variants: [], routines: [] };
  failSave = false;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "variant_library_get") return structuredClone(disk);
    if (command === "variant_library_save") {
      if (failSave) throw new Error("Disk is full");
      const input = (args as { library: VariantLibrary }).library;
      if (input.revision !== disk.revision) throw new Error("Library changed; reload before saving");
      disk = structuredClone({ ...input, revision: input.revision + 1 });
      return structuredClone(disk);
    }
    throw new Error(`Unexpected ${command}`);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const manage = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Manage variants" }));
  await waitFor(() => expect((screen.getByLabelText("Show Dotted") as HTMLInputElement).disabled).toBe(false));
};
const add = async (name: string) => {
  fireEvent.change(screen.getByLabelText("Saved variant name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
  await waitFor(() => expect(screen.getByLabelText(`Show ${name}`)).toBeTruthy());
};
describe("durable variants and routines", () => {
  it("prevents implicit form submission from variant names and counts in the compact dialog", () => {
    const onOpen = vi.fn();
    render(<BlockForm presentation="compact" pieceId={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose variants" }));
    fireEvent.click(screen.getByRole("button", { name: "Dotted" }));
    for (const name of ["Variant 1 name", "Variant 1 consecutive cleans"]) {
      expect(fireEvent.keyDown(screen.getByLabelText(name), { key: "Enter", code: "Enter" })).toBe(false);
    }
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0][0].variants[0].name).toBe("dotted");
  });
  it("confirms deletion inline, retains confirmation on failure, and preserves selected stages", async () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    await manage(); await add("Soft landing");
    fireEvent.click(screen.getByRole("button", { name: "Soft landing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete saved variant Soft landing" }));
    expect(disk.custom_variants).toEqual(["Soft landing"]);
    failSave = true;
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText(/Disk is full/);
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(disk.custom_variants).toEqual([]));
    expect((screen.getByLabelText("Variant 1 name") as HTMLInputElement).value).toBe("Soft landing");
  });
  it("shows a load failure and prevents saving until a valid library is loaded", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Library unavailable"));
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage variants" }));
    await screen.findByText(/Library unavailable/);
    expect((screen.getByLabelText("Show Dotted") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Saved variant name"), { target: { value: "Kept" } });
    expect((screen.getByRole("button", { name: "Save to library" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload library" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save to library" }) as HTMLButtonElement).disabled).toBe(false));
  });
  it("offers routine creation directly in compact Variants and preserves Total plays semantics", async () => {
    const onOpen = vi.fn();
    render(<BlockForm presentation="compact" pieceId={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose variants" }));
    fireEvent.click(screen.getByRole("button", { name: "Dotted" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sequence as routine" }));
    fireEvent.change(screen.getByLabelText("Routine name"), { target: { value: "Daily" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save routine" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save routine" }));
    await screen.findByRole("button", { name: "Daily" });
    fireEvent.click(screen.getByRole("button", { name: "Close practice customizer" }));
    fireEvent.click(screen.getByRole("button", { name: "Practice settings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Total plays" }));
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0].variants).toEqual([]);
    expect(disk.routines[0].stages[0].name).toBe("dotted");
  });

  it("saves custom shortcuts and visibility through native commands, reads them afresh after remount", async () => {
    const view = render(<BlockForm pieceId={1} onOpen={vi.fn()} />);
    await manage(); await add("Soft landing");
    fireEvent.click(screen.getByLabelText("Show Dotted"));
    await waitFor(() => expect(disk.hidden_variants).toEqual(["dotted"]));
    view.unmount();
    render(<BlockForm pieceId={99} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Soft landing" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Dotted" })).toBeNull();
    expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === "variant_library_get")).toHaveLength(2);
  });
  it("copies routine stage order/counts into a replacement draft and keeps saved snapshots independent", async () => {
    const onOpen = vi.fn();
    render(<BlockForm pieceId={1} onOpen={onOpen} />); await manage();
    for (const name of ["Dotted", "Reverse dotted", "Staccato"]) fireEvent.click(screen.getByRole("button", { name }));
    fireEvent.change(screen.getByLabelText("Variant 2 consecutive cleans"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Routine name"), { target: { value: "Rhythm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save routine" }));
    await screen.findByRole("button", { name: "Rhythm" });
    fireEvent.click(screen.getByRole("button", { name: "Slow" }));
    fireEvent.click(screen.getByRole("button", { name: "Rhythm" }));
    expect(screen.queryByLabelText("Variant 4 name")).toBeNull();
    expect((screen.getByLabelText("Variant 2 consecutive cleans") as HTMLInputElement).value).toBe(String(7));
    fireEvent.change(screen.getByLabelText("Variant 1 name"), { target: { value: "Edited" } });
    expect(disk.routines[0].stages[0].name).toBe("dotted");
    fireEvent.click(screen.getByRole("button", { name: "Start set" }));
    expect(onOpen.mock.calls[0][0].variants.map((s: { name: string }) => s.name)).toEqual(["Edited", "reverse dotted", "staccato"]);
  });
  it("does not claim save success or clear the typed name after a native failure", async () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />); await manage();
    failSave = true;
    fireEvent.change(screen.getByLabelText("Saved variant name"), { target: { value: "Soft landing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await screen.findByText(/Disk is full/);
    expect((screen.getByLabelText("Saved variant name") as HTMLInputElement).value).toBe(String("Soft landing"));
    expect(screen.queryByText("Saved", { exact: true })).toBeNull();
    expect(disk.custom_variants).toEqual([]);
  });
  it("rejects stale writes, retains draft, and supports explicit reload and retry", async () => {
    render(<BlockForm pieceId={1} onOpen={vi.fn()} />); await manage();
    disk = { ...disk, revision: 1, custom_variants: ["Elsewhere"] };
    fireEvent.change(screen.getByLabelText("Saved variant name"), { target: { value: "Local" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await screen.findByText(/Library changed/);
    fireEvent.click(screen.getByRole("button", { name: "Reload library" }));
    await screen.findByLabelText("Show Elsewhere");
    expect((screen.getByLabelText("Saved variant name") as HTMLInputElement).value).toBe(String("Local"));
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await screen.findByLabelText("Show Local");
    expect(disk.custom_variants).toEqual(["Elsewhere", "Local"]);
  });
  it("refreshes another mounted composer's library after save without changing its chain", async () => {
    render(<><div data-testid="one"><BlockForm pieceId={1} onOpen={vi.fn()} /></div><div data-testid="two"><BlockForm pieceId={2} onOpen={vi.fn()} /></div></>);
    const first = within(screen.getByTestId("one")); const second = within(screen.getByTestId("two"));
    fireEvent.click(first.getByRole("button", { name: "Manage variants" }));
    await waitFor(() => expect((first.getByLabelText("Show Dotted") as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(second.getByRole("button", { name: "Dotted" }));
    fireEvent.change(first.getByLabelText("Saved variant name"), { target: { value: "Shared" } });
    fireEvent.click(first.getByRole("button", { name: "Save to library" }));
    await second.findByRole("button", { name: "Shared" });
    expect((second.getByLabelText("Variant 1 name") as HTMLInputElement).value).toBe(String("dotted"));
  });
});
