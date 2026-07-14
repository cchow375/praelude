import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel, type SettingsApi, type SettingsSnapshot } from "./SettingsPanel";

const snapshot: SettingsSnapshot = { theme: "auto", interface_scale: 90, tts_provider: "auto", tts_voice: "Kore", brain_provider: "auto", knowledge_dir: "/vault/Knowledge and Resources", share_retrieved_knowledge: true, wake_word_enabled: false, wake_word: "coda", metronome_sound: "woodblock", metronome_boost: false, metronome_boost_level: 85, ladder_default_reps: 30, ladder_bpm_step: 4, calendar_capacity_minutes: 60, vault_pieces_dir: "/vault/Pieces", verdict_aliases: { clean: [], flawed: [], failed: [] }, api_keys: [{ provider: "claude", configured: false, source: "none" }, { provider: "gemini", configured: true, source: "keychain" }] };
function api(): SettingsApi { return { snapshot: vi.fn().mockResolvedValue(snapshot), update: vi.fn().mockImplementation(async (patch) => ({ ...snapshot, ...patch })), saveKey: vi.fn().mockResolvedValue({ provider: "claude", configured: true, source: "keychain" }), clearKey: vi.fn().mockResolvedValue({ provider: "gemini", configured: false, source: "none" }) }; }
afterEach(cleanup);

describe("SettingsPanel", () => {
  it("loads typed values and saves one validated projection", async () => {
    const settingsApi = api(); const onThemeSaved = vi.fn(); const onInterfaceScaleSaved = vi.fn();
    render(<SettingsPanel api={settingsApi} onResetLayout={vi.fn()} onThemeSaved={onThemeSaved} onInterfaceScaleSaved={onInterfaceScaleSaved} />);
    fireEvent.change(await screen.findByLabelText("Theme"), { target: { value: "dark" } });
    fireEvent.change(screen.getByLabelText("Interface scale"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Share retrieved knowledge/ }));
    fireEvent.change(screen.getByLabelText("Default reps"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark", interface_scale: 80, ladder_default_reps: 40, knowledge_dir: "/vault/Knowledge and Resources", share_retrieved_knowledge: false })));
    expect(onThemeSaved).toHaveBeenCalledWith("dark");
    expect(onInterfaceScaleSaved).toHaveBeenCalledWith(80);
  });

  it("clears a secret input immediately after native write begins", async () => {
    let resolve: (value: { provider: "claude"; configured: true; source: "keychain" }) => void = () => undefined;
    const settingsApi = api();
    settingsApi.saveKey = vi.fn().mockReturnValue(new Promise((next) => { resolve = next; }));
    render(<SettingsPanel api={settingsApi} onResetLayout={vi.fn()} />);
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
    render(<SettingsPanel api={settingsApi} onResetLayout={vi.fn()} />);
    const alias = await screen.findByLabelText("Clean verdict aliases");
    fireEvent.change(alias, { target: { value: "solid landing, easy arrival" } });
    fireEvent.submit(alias.closest("form")!);
    await waitFor(() => expect(settingsApi.update).toHaveBeenCalledWith(expect.objectContaining({
      verdict_aliases: { clean: ["solid landing", "easy arrival"], flawed: [], failed: [] },
    })));
  });
});
