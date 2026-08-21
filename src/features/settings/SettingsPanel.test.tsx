import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsPanel,
  type SettingsApi,
  type SettingsSnapshot,
} from "./SettingsPanel";
import { ReceiptCenterProvider } from "../receipts/ReceiptCenter";
import type { BooksApi, BookRecord } from "./BooksPanel";

// The voice section reflects live degraded-TTS state pushed over `voice://tts`.
// Only the event module is mocked (so a test can emit the backend's transition);
// `invoke` stays real and simply rejects with no backend, exactly as in the app's
// browser-dev mode.
type Handler = (e: { payload: unknown }) => void;
const listeners: Record<string, Handler> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: Handler) => {
    listeners[event] = cb;
    return () => undefined;
  }),
}));

const snapshot: SettingsSnapshot = {
  theme: "auto",
  interface_scale: 90,
  tts_provider: "auto",
  tts_voice: "Kore",
  brain_provider: "auto",
  knowledge_dir: "/vault/Knowledge and Resources",
  share_retrieved_knowledge: true,
  wake_word_enabled: false,
  wake_word: "coda",
  metronome_sound: "woodblock",
  metronome_boost: false,
  metronome_boost_level: 85,
  ladder_default_reps: 30,
  practice_default_clean_streak: 5,
  ladder_bpm_step: 4,
  calendar_capacity_minutes: 60,
  vault_pieces_dir: "/vault/Pieces",
  verdict_aliases: { clean: [], flawed: [], failed: [] },
  api_keys: [
    { provider: "claude", configured: false, source: "none" },
    { provider: "gemini", configured: true, source: "keychain" },
  ],
};
function api(): SettingsApi {
  return {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    update: vi
      .fn()
      .mockImplementation(async (patch) => ({ ...snapshot, ...patch })),
    saveKey: vi.fn().mockResolvedValue({
      provider: "claude",
      configured: true,
      source: "keychain",
    }),
    clearKey: vi.fn().mockResolvedValue({
      provider: "gemini",
      configured: false,
      source: "none",
    }),
  };
}
afterEach(cleanup);

describe("SettingsPanel", () => {
  it("opens with a truthful, accessible practice guide", async () => {
    render(<SettingsPanel api={api()} />);

    const guide = await screen.findByRole("region", {
      name: "One practice loop, two voice lanes",
    });
    expect(guide.closest("details")?.open).toBe(true);
    expect(
      within(guide).getByRole("list", { name: "Golden practice flow" }),
    ).toBeTruthy();
    expect(within(guide).getByText("metronome off")).toBeTruthy();
    expect(
      within(guide).getByText(/Exact commands run immediately and offline/),
    ).toBeTruthy();
    expect(within(guide).getByText(/without a wake phrase/)).toBeTruthy();
    expect(
      within(guide).getByText(/selected Score piece, Region, page/),
    ).toBeTruthy();
    expect(
      within(guide).getByText(/manage Calendar and Goals by voice yet/),
    ).toBeTruthy();
    expect(
      within(guide).getByRole("complementary", { name: "Confirmation safety" }),
    ).toBeTruthy();
    expect(within(guide).getByText(/Wake-word mode is off/)).toBeTruthy();
  });

  it("loads typed values and saves one validated projection", async () => {
    const settingsApi = api();
    const onInterfaceScaleSaved = vi.fn();
    const onPracticeDefaultCleanStreakSaved = vi.fn();
    render(
      <SettingsPanel
        api={settingsApi}
        onInterfaceScaleSaved={onInterfaceScaleSaved}
        onPracticeDefaultCleanStreakSaved={onPracticeDefaultCleanStreakSaved}
      />,
    );
    await screen.findByText(/dark practice-room interface/i);
    fireEvent.change(screen.getByLabelText("Interface scale"), {
      target: { value: "80" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Share retrieved knowledge/ }),
    );
    fireEvent.change(screen.getByLabelText("Default clean streak"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(settingsApi.update).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "dark",
          interface_scale: 80,
          practice_default_clean_streak: 7,
          knowledge_dir: "/vault/Knowledge and Resources",
          share_retrieved_knowledge: false,
        }),
      ),
    );
    expect(settingsApi.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ ladder_default_reps: expect.anything() }),
    );
    expect(settingsApi.update).toHaveBeenCalledTimes(1);
    expect(onInterfaceScaleSaved).toHaveBeenCalledWith(80);
    expect(onPracticeDefaultCleanStreakSaved).toHaveBeenCalledWith(7);
  });

  it("clears a secret input immediately after native write begins", async () => {
    let resolve: (value: {
      provider: "claude";
      configured: true;
      source: "keychain";
    }) => void = () => undefined;
    const settingsApi = api();
    settingsApi.saveKey = vi.fn().mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );
    render(<SettingsPanel api={settingsApi} />);
    const control = await screen.findByRole("region", {
      name: "Claude API key",
    });
    const input = within(control).getByLabelText(
      "New Claude API key",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secret-value-123" } });
    fireEvent.click(within(control).getByRole("button", { name: "Save key" }));
    expect(input.value).toBe("");
    expect(settingsApi.saveKey).toHaveBeenCalledWith(
      "claude",
      "secret-value-123",
    );
    resolve({ provider: "claude", configured: true, source: "keychain" });
    expect(
      await within(control).findByText("Configured (keychain)"),
    ).toBeTruthy();
  });

  it("submits the currently focused alias draft when Enter saves", async () => {
    const settingsApi = api();
    render(<SettingsPanel api={settingsApi} />);
    const alias = await screen.findByLabelText("Clean verdict aliases");
    fireEvent.change(alias, {
      target: { value: "solid landing, easy arrival" },
    });
    fireEvent.submit(alias.closest("form")!);
    await waitFor(() =>
      expect(settingsApi.update).toHaveBeenCalledWith(
        expect.objectContaining({
          verdict_aliases: {
            clean: ["solid landing", "easy arrival"],
            flawed: [],
            failed: [],
          },
        }),
      ),
    );
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
      expect(
        screen.getByRole("list", { name: "Recent app activity" }).textContent,
      ).toContain("The wake word conflicts with a command.");
    });
    expect(
      screen
        .getAllByRole("alert")
        .some(
          (node) =>
            node.textContent === "The wake word conflicts with a command.",
        ),
    ).toBe(true);
  });

  it("shows the degraded-voice pill in the voice section while the cloud voice is down", async () => {
    render(<SettingsPanel api={api()} />);
    await screen.findByLabelText("Coach voice");
    expect(
      screen.queryByText("Voice degraded — using system voice"),
    ).toBeNull();

    await waitFor(() => expect(listeners["voice://tts"]).toBeDefined());
    act(() => listeners["voice://tts"]({ payload: { degraded: true } }));
    expect(
      screen.getByText("Voice degraded — using system voice"),
    ).toBeTruthy();

    act(() => listeners["voice://tts"]({ payload: { degraded: false } }));
    expect(
      screen.queryByText("Voice degraded — using system voice"),
    ).toBeNull();
  });

  // B72: the "Add a book" group used to be a nested <form>, invalid HTML
  // inside the settings <form> and browser-defined submit semantics.
  it("keeps the Books add group out of the settings form (no nested form, B72)", async () => {
    const added: BookRecord = {
      id: "added-1",
      file_name: "focus.md",
      title: "On Focus",
      author: "",
      kind: "practice-method",
      visual_dependency: false,
      available: true,
    };
    const booksApi: BooksApi = {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue(added),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const { container } = render(
      <SettingsPanel api={api()} booksApi={booksApi} />,
    );
    await screen.findByText(/dark practice-room interface/i);

    // Open the Books disclosure.
    fireEvent.click(screen.getByText("Books"));
    await screen.findByText("No books yet.");

    // Structural regression check: no <form> nested inside another <form>.
    expect(container.querySelectorAll("form form").length).toBe(0);

    // The add flow still works end-to-end from outside the settings form.
    fireEvent.change(screen.getByLabelText("Markdown file path"), {
      target: { value: "/vault/Knowledge/focus.md" },
    });
    fireEvent.change(screen.getByLabelText("Book title"), {
      target: { value: "On Focus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add book" }));

    await waitFor(() =>
      expect(booksApi.add).toHaveBeenCalledWith({
        path: "/vault/Knowledge/focus.md",
        title: "On Focus",
        author: "",
        kind: "practice-method",
      }),
    );
  });
});
