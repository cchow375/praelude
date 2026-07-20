import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel, type SettingsApi, type SettingsSnapshot } from "./SettingsPanel";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";

const snapshot: SettingsSnapshot = { theme: "auto", interface_scale: 90, tts_provider: "auto", tts_voice: "Kore", brain_provider: "auto", knowledge_dir: "/vault/Knowledge and Resources", share_retrieved_knowledge: true, wake_word_enabled: false, wake_word: "coda", metronome_sound: "woodblock", metronome_boost: false, metronome_boost_level: 85, ladder_default_reps: 30, practice_default_clean_streak: 5, ladder_bpm_step: 4, calendar_capacity_minutes: 60, vault_pieces_dir: "/vault/Pieces", verdict_aliases: { clean: [], flawed: [], failed: [] }, api_keys: [{ provider: "claude", configured: false, source: "none" }, { provider: "gemini", configured: true, source: "keychain" }] };
function api(): SettingsApi { return { snapshot: vi.fn().mockResolvedValue(snapshot), update: vi.fn().mockImplementation(async (patch) => ({ ...snapshot, ...patch })), saveKey: vi.fn().mockResolvedValue({ provider: "claude", configured: true, source: "keychain" }), clearKey: vi.fn().mockResolvedValue({ provider: "gemini", configured: false, source: "none" }) }; }
afterEach(cleanup);

describe("SettingsPanel", () => {
  it("opens with a truthful, accessible practice guide", async () => {
    render(<SettingsPanel api={api()} />);

    const guide = await screen.findByRole("region", {
      name: "One practice loop, two voice lanes",
    });
    expect(guide.closest("details")?.open).toBe(true);
    expect(within(guide).getByRole("list", { name: "Golden practice flow" })).toBeTruthy();
    expect(within(guide).getByText("metronome off")).toBeTruthy();
    expect(within(guide).getByText(/Exact commands run immediately and offline/)).toBeTruthy();
    expect(within(guide).getByText(/without a wake phrase/)).toBeTruthy();
    expect(within(guide).getByText(/selected Score piece, Region, page/)).toBeTruthy();
    expect(within(guide).getByText(/manage Calendar and Goals by voice yet/)).toBeTruthy();
    expect(within(guide).getByRole("complementary", { name: "Confirmation safety" })).toBeTruthy();
    expect(within(guide).getByText(/Wake-word mode is off/)).toBeTruthy();
  });

  it("loads typed values and saves one validated projection", async () => {
    const settingsApi = api(); const onInterfaceScaleSaved = vi.fn(); const onPracticeDefaultCleanStreakSaved = vi.fn();
    render(<SettingsPanel api={settingsApi} onInterfaceScaleSaved={onInterfaceScaleSaved} onPracticeDefaultCleanStreakSaved={onPracticeDefaultCleanStreakSaved} />);
    await screen.findByText(/dark practice-room interface/i);
    fireEvent.change(screen.getByLabelText("Interface scale"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Share retrieved knowledge/ }));
    fireEvent.change(screen.getByLabelText("Default clean streak"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark", interface_scale: 80, practice_default_clean_streak: 7, knowledge_dir: "/vault/Knowledge and Resources", share_retrieved_knowledge: false })));
    expect(settingsApi.update).not.toHaveBeenCalledWith(expect.objectContaining({ ladder_default_reps: expect.anything() }));
    expect(settingsApi.update).toHaveBeenCalledTimes(1);
    expect(onInterfaceScaleSaved).toHaveBeenCalledWith(80);
    expect(onPracticeDefaultCleanStreakSaved).toHaveBeenCalledWith(7);
  });

  it("clears a secret input immediately after native write begins", async () => {
    let resolve: (value: { provider: "claude"; configured: true; source: "keychain" }) => void = () => undefined;
    const settingsApi = api();
    settingsApi.saveKey = vi.fn().mockReturnValue(new Promise((next) => { resolve = next; }));
    render(<SettingsPanel api={settingsApi} />);
    const control = await screen.findByRole("region", { name: "Claude API key" });
    const input = within(control).getByLabelText("New Claude API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secret-value-123" } });
    fireEvent.click(within(control).getByRole("button", { name: "Save key" }));
    expect(input.value).toBe("");
    expect(settingsApi.saveKey).toHaveBeenCalledWith("claude", "secret-value-123");
    resolve({ provider: "claude", configured: true, source: "keychain" });
    expect(await within(control).findByText("Configured (keychain)")).toBeTruthy();
  });

  it("submits the currently focused alias draft when Enter saves", async () => {
    const settingsApi = api();
    render(<SettingsPanel api={settingsApi} />);
    const alias = await screen.findByLabelText("Clean verdict aliases");
    fireEvent.change(alias, { target: { value: "solid landing, easy arrival" } });
    fireEvent.submit(alias.closest("form")!);
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledWith(expect.objectContaining({
      verdict_aliases: { clean: ["solid landing", "easy arrival"], flawed: [], failed: [] },
    })));
  });

  it("keeps a failed deep-settings save visible after the popover could close", async () => {
    const settingsApi = api();
    settingsApi.update = vi.fn().mockRejectedValue({
      code: "settings_invalid",
      message: "The wake word conflicts with a command.",
    });
    render(
      <ReceiptCenterProvider>
        <SettingsPanel api={settingsApi} />
      </ReceiptCenterProvider>,
    );
    await screen.findByText(/dark practice-room interface/i);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("list", { name: "Recent app activity" }).textContent).toContain(
        "The wake word conflicts with a command.",
      );
    });
    expect(screen.getAllByRole("alert").some((node) => (
      node.textContent === "The wake word conflicts with a command."
    ))).toBe(true);
  });
});
