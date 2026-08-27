import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_VERDICT_HOTKEYS,
  hotkeyLabel,
  useVerdictHotkeyConfig,
  useVerdictHotkeys,
  type VerdictHotkeyConfig,
} from "./useVerdictHotkeys";
import {
  acceptCommittedSettings,
  DEFAULT_SETTINGS,
  readSettings,
} from "../../state/settings";
import type { Verdict } from "./useRep";

vi.mock("../../state/settings", async () => {
  const actual = await vi.importActual<typeof import("../../state/settings")>(
    "../../state/settings",
  );
  return { ...actual, readSettings: vi.fn() };
});

const readSettingsMock = vi.mocked(readSettings);

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

beforeEach(() => {
  readSettingsMock.mockResolvedValue(DEFAULT_SETTINGS);
});

function mount(
  over: Partial<{ active: boolean; config: VerdictHotkeyConfig }> = {},
) {
  const onVerdict = vi.fn<(verdict: Verdict) => void>();
  const view = renderHook(() =>
    useVerdictHotkeys({
      active: over.active ?? true,
      config: over.config ?? DEFAULT_VERDICT_HOTKEYS,
      onVerdict,
    }),
  );
  return { onVerdict, view };
}

/** Dispatch a real KeyboardEvent so `defaultPrevented` can be inspected. */
function press(
  target: EventTarget,
  init: KeyboardEventInit & { code: string },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    fireEvent(target, event);
  });
  return event;
}

describe("useVerdictHotkeys", () => {
  it("records a verdict for each bound key while a set is live", () => {
    const { onVerdict } = mount();
    press(document.body, { code: "Space", key: " " });
    press(document.body, { code: "ShiftRight", key: "Shift" });
    press(document.body, { code: "Enter", key: "Enter" });
    expect(onVerdict.mock.calls.map((call) => call[0])).toEqual([
      "clean",
      "flawed",
      "failed",
    ]);
  });

  it("uses event.code so the LEFT shift key records nothing", () => {
    const { onVerdict } = mount();
    press(document.body, { code: "ShiftLeft", key: "Shift" });
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("does NOT fire when no set is live", () => {
    const { onVerdict } = mount({ active: false });
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("does NOT fire while focus is in a text field, textarea, select or contenteditable", () => {
    const { onVerdict } = mount();
    for (const html of [
      '<input type="text" />',
      "<textarea></textarea>",
      "<select><option>a</option></select>",
      '<div contenteditable="true"></div>',
    ]) {
      document.body.innerHTML = html;
      const field = document.body.firstElementChild as HTMLElement;
      field.focus();
      press(field, { code: "Space", key: " " });
      press(field, { code: "Enter", key: "Enter" });
      press(field, { code: "ShiftRight", key: "Shift" });
    }
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("does NOT fire while a dialog is open", () => {
    const { onVerdict } = mount();
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true"><button>Confirm</button></div>';
    press(document.body.querySelector("button")!, {
      code: "Enter",
      key: "Enter",
    });
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("still fires inside a NON-modal dock panel, which is where the HUD lives", () => {
    // Regression found in the running app: DockPanel is
    // `role="dialog" aria-modal="false"`, so a guard keyed on the dialog ROLE
    // suppressed every hotkey permanently. Only modality may block.
    const { onVerdict } = mount();
    document.body.innerHTML =
      '<div role="dialog" aria-modal="false" class="dock-panel"><button>x</button></div>';
    press(document.body.querySelector("button")!, { code: "Space", key: " " });
    expect(onVerdict).toHaveBeenCalledWith("clean");
  });

  it("ignores auto-repeat (holding the key records one rep, not many)", () => {
    const { onVerdict } = mount();
    press(document.body, { code: "Space", key: " " });
    press(document.body, { code: "Space", key: " ", repeat: true });
    press(document.body, { code: "Space", key: " ", repeat: true });
    expect(onVerdict).toHaveBeenCalledTimes(1);
  });

  it("ignores a bound key held with a command, control or option modifier", () => {
    const { onVerdict } = mount();
    press(document.body, { code: "Space", key: " ", metaKey: true });
    press(document.body, { code: "Space", key: " ", ctrlKey: true });
    press(document.body, { code: "Space", key: " ", altKey: true });
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("preventDefaults Space and Return so the page neither scrolls nor submits", () => {
    mount();
    expect(
      press(document.body, { code: "Space", key: " " }).defaultPrevented,
    ).toBe(true);
    expect(
      press(document.body, { code: "Enter", key: "Enter" }).defaultPrevented,
    ).toBe(true);
    // An unbound key is left entirely alone.
    expect(
      press(document.body, { code: "KeyQ", key: "q" }).defaultPrevented,
    ).toBe(false);
  });

  it("honours a remapped key and stops honouring the old one", () => {
    const { onVerdict } = mount({
      config: { ...DEFAULT_VERDICT_HOTKEYS, clean: "KeyC" },
    });
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
    press(document.body, { code: "KeyC", key: "c" });
    expect(onVerdict).toHaveBeenCalledWith("clean");
  });

  it("is fully disabled by the master toggle", () => {
    const { onVerdict } = mount({
      config: { ...DEFAULT_VERDICT_HOTKEYS, enabled: false },
    });
    const event = press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reports first use so the teaching hint can compact", () => {
    const onVerdict = vi.fn<(verdict: Verdict) => void>();
    const { result } = renderHook(() =>
      useVerdictHotkeys({
        active: true,
        config: DEFAULT_VERDICT_HOTKEYS,
        onVerdict,
      }),
    );
    expect(result.current.used).toBe(false);
    press(document.body, { code: "Space", key: " " });
    expect(result.current.used).toBe(true);
  });

  it("detaches its listener on unmount", () => {
    const { onVerdict, view } = mount();
    view.unmount();
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
  });
});

describe("useVerdictHotkeyConfig", () => {
  it("starts at Christian's confirmed mapping", () => {
    expect(DEFAULT_VERDICT_HOTKEYS).toEqual({
      enabled: true,
      clean: "Space",
      sloppy: "ShiftRight",
      again: "Enter",
    });
  });

  it("round-trips a remapped key through settings", async () => {
    readSettingsMock.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      hotkeys_enabled: true,
      hotkey_verdict_clean: "KeyZ",
      hotkey_verdict_sloppy: "ShiftRight",
      hotkey_verdict_again: "Enter",
    });
    const { result } = renderHook(() => useVerdictHotkeyConfig());
    await waitFor(() => expect(result.current.clean).toBe("KeyZ"));
    expect(result.current.enabled).toBe(true);
  });

  it("keeps the verdict listener inert until the persisted mapping loads", async () => {
    let resolveSettings!: (settings: typeof DEFAULT_SETTINGS) => void;
    readSettingsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );
    const onVerdict = vi.fn<(verdict: Verdict) => void>();
    const { result } = renderHook(() => {
      const config = useVerdictHotkeyConfig();
      useVerdictHotkeys({ active: true, config, onVerdict });
      return config;
    });

    expect(result.current.enabled).toBe(false);
    press(document.body, { code: "Space", key: " " });
    press(document.body, { code: "ShiftRight", key: "Shift" });
    press(document.body, { code: "Enter", key: "Enter" });
    expect(onVerdict).not.toHaveBeenCalled();

    act(() => {
      resolveSettings({
        ...DEFAULT_SETTINGS,
        hotkey_verdict_clean: "KeyZ",
      });
    });
    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
      expect(result.current.clean).toBe("KeyZ");
    });
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
    press(document.body, { code: "KeyZ", key: "z" });
    expect(onVerdict).toHaveBeenCalledWith("clean");
  });

  it("adopts a committed remap without remounting the hotkey listener", async () => {
    const onVerdict = vi.fn<(verdict: Verdict) => void>();
    const { result } = renderHook(() => {
      const config = useVerdictHotkeyConfig();
      useVerdictHotkeys({ active: true, config, onVerdict });
      return config;
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => {
      acceptCommittedSettings({
        ...DEFAULT_SETTINGS,
        hotkey_verdict_clean: "KeyZ",
      });
    });
    expect(result.current.clean).toBe("KeyZ");
    press(document.body, { code: "Space", key: " " });
    expect(onVerdict).not.toHaveBeenCalled();
    press(document.body, { code: "KeyZ", key: "z" });
    expect(onVerdict).toHaveBeenCalledWith("clean");
  });

  it("carries the master toggle from settings", async () => {
    readSettingsMock.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      hotkeys_enabled: false,
    });
    const { result } = renderHook(() => useVerdictHotkeyConfig());
    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it("falls back to the defaults when settings cannot be read", async () => {
    readSettingsMock.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useVerdictHotkeyConfig());
    await waitFor(() =>
      expect(result.current).toEqual(DEFAULT_VERDICT_HOTKEYS),
    );
  });
});

describe("hotkeyLabel", () => {
  it("names the three confirmed keys the way Christian says them", () => {
    expect(hotkeyLabel("Space")).toBe("Space");
    expect(hotkeyLabel("ShiftRight")).toBe("Right-Shift");
    expect(hotkeyLabel("Enter")).toBe("Return");
  });

  it("renders an unmapped code readably rather than raw", () => {
    expect(hotkeyLabel("KeyZ")).toBe("Z");
    expect(hotkeyLabel("Digit4")).toBe("4");
    expect(hotkeyLabel("F7")).toBe("F7");
  });
});
