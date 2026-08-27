import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  readSettings,
  subscribeCommittedSettings,
  type Settings,
} from "../../state/settings";
import type { Verdict } from "./useRep";

// -----------------------------------------------------------------------------
// A6 — verdict hotkeys. Christian's words: "so I don't have to move my hand off
// the piano."  Space = clean, Right-Shift = sloppy, Return = again.
//
// This is the app's FIRST global keydown handler — every other handler in the
// codebase is component-local (Dialog, ScoreView, MetronomePopover,
// MeasureMapPanel, DayPhotoCapture, Popover). Nothing else guards it, so it
// brings every guard itself; see SUPPRESSED below.
// -----------------------------------------------------------------------------

export interface VerdictHotkeyConfig {
  /** Master toggle. Off means the listener records nothing and prevents nothing. */
  enabled: boolean;
  /** `KeyboardEvent.code` bound to each verdict. */
  clean: string;
  sloppy: string;
  again: string;
}

/** Christian's confirmed mapping (2026-08-25). All three are remappable. */
export const DEFAULT_VERDICT_HOTKEYS: VerdictHotkeyConfig = {
  enabled: DEFAULT_SETTINGS.hotkeys_enabled,
  clean: DEFAULT_SETTINGS.hotkey_verdict_clean,
  sloppy: DEFAULT_SETTINGS.hotkey_verdict_sloppy,
  again: DEFAULT_SETTINGS.hotkey_verdict_again,
};

/** Codes whose default action would scroll the page or submit a form. */
const SWALLOWED_CODES = new Set(["Space", "Enter", "NumpadEnter", "Tab"]);

const CODE_LABELS: Record<string, string> = {
  Space: "Space",
  ShiftRight: "Right-Shift",
  ShiftLeft: "Left-Shift",
  Enter: "Return",
  NumpadEnter: "Return",
  Backslash: "\\",
  Backquote: "`",
  Minus: "−",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Human wording for a `KeyboardEvent.code`, for the HUD hint and Settings. */
export function hotkeyLabel(code: string): string {
  const named = CODE_LABELS[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Numpad ${code.slice(6)}`;
  return code;
}

/** True when the keystroke belongs to something the pianist is typing into. */
function isTextEntry(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false;
  if (node.closest("input, textarea, select") != null) return true;
  // `isContentEditable` is the browser's answer but jsdom never implements it,
  // so the attribute is checked too — `closest` also covers a keystroke landing
  // on a child element inside an editable region.
  if (node instanceof HTMLElement && node.isContentEditable) return true;
  return node.closest('[contenteditable=""], [contenteditable="true"]') != null;
}

/**
 * B77's lesson, restated for the keyboard: while a modal scrim is up, keys must
 * not reach anything behind it. Tab could previously walk to a verdict button
 * behind the scrim and Return would record a rep through it.
 */
function blockingDialogIsOpen(): boolean {
  const candidates = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]',
  );
  for (const node of candidates) {
    // The dock panels and popovers declare themselves explicitly NON-modal —
    // and the rep HUD itself lives inside one of them. Treating every
    // role="dialog" as blocking suppressed every hotkey in the running app
    // even though nothing was covering the screen; only modality blocks.
    if (node.getAttribute("aria-modal") === "false") continue;
    return true;
  }
  return false;
}

/**
 * Read the verdict-hotkey mapping from the settings projection. Falls back to
 * the confirmed defaults whenever settings are unreadable, so the hotkeys work
 * on a first launch and in plain Vite exactly as they do in the packaged app.
 */
export function useVerdictHotkeyConfig(): VerdictHotkeyConfig {
  const [config, setConfig] = useState<VerdictHotkeyConfig>(
    // Never let the confirmed defaults act as a speculative mapping. A user
    // may have persisted different keys (or disabled hotkeys), and an active
    // set can already exist while this asynchronous snapshot is in flight.
    { ...DEFAULT_VERDICT_HOTKEYS, enabled: false },
  );

  useEffect(() => {
    let active = true;
    let committedUpdateSeen = false;
    const apply = (settings: Settings) => {
      const next: VerdictHotkeyConfig = {
        enabled: settings.hotkeys_enabled,
        clean: settings.hotkey_verdict_clean,
        sloppy: settings.hotkey_verdict_sloppy,
        again: settings.hotkey_verdict_again,
      };
      // Identity-stable when nothing was remapped: opening a set must not
      // cost the HUD a re-render just to rediscover the same mapping.
      setConfig((current) =>
        current.enabled === next.enabled &&
        current.clean === next.clean &&
        current.sloppy === next.sloppy &&
        current.again === next.again
          ? current
          : next,
      );
    };
    // Subscribe before starting the snapshot read. If Settings saves while an
    // older read is in flight, the committed projection wins and the stale
    // response is ignored rather than restoring the previous keys.
    const unsubscribe = subscribeCommittedSettings((settings) => {
      if (!active) return;
      committedUpdateSeen = true;
      apply(settings);
    });
    void (async () => {
      try {
        const settings = await readSettings();
        if (!active || committedUpdateSeen) return;
        apply(settings);
      } catch {
        // readSettings already falls back internally. A mocked or unexpected
        // rejection still resolves the loading gate to the confirmed defaults
        // rather than leaving hotkeys silently disabled forever.
        if (active && !committedUpdateSeen) apply(DEFAULT_SETTINGS);
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return config;
}

export interface VerdictHotkeysResult {
  /** True once a hotkey has actually recorded a rep in this set. */
  used: boolean;
}

/**
 * Mount the global verdict-hotkey listener.
 *
 * SUPPRESSED — the handler does nothing at all when:
 *   1. no set is live (`active` false);
 *   2. the master toggle is off;
 *   3. the keystroke is auto-repeat (holding a key records ONE rep, not a stream);
 *   4. a command/control/option modifier is held (⌘Space is Spotlight, not a rep);
 *   5. another handler already called `preventDefault`;
 *   6. a MODAL dialog is open anywhere in the document (a non-modal dock
 *      panel or popover does not block — the HUD itself lives in one);
 *   7. focus is in an input, textarea, select or contenteditable — Space there
 *      must insert a literal space into an attempt note;
 *   8. the code is not bound to a verdict.
 *
 * `onVerdict` must be the SAME path the verdict buttons use, so provenance,
 * receipts, the busy guard and the mastered guard are identical to a click.
 */
export function useVerdictHotkeys({
  active,
  config,
  onVerdict,
}: {
  active: boolean;
  config: VerdictHotkeyConfig;
  onVerdict: (verdict: Verdict) => void;
}): VerdictHotkeysResult {
  const [used, setUsed] = useState(false);
  // Held in refs so the listener is attached once and never re-registered on a
  // parent re-render (which happens on every keystroke in the attempt note).
  const stateRef = useRef({ active, config, onVerdict });
  stateRef.current = { active, config, onVerdict };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { active, config, onVerdict } = stateRef.current;
      if (!active || !config.enabled) return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented) return;
      if (blockingDialogIsOpen()) return;
      if (isTextEntry(event.target) || isTextEntry(document.activeElement))
        return;

      const verdict: Verdict | null =
        event.code === config.clean
          ? "clean"
          : event.code === config.sloppy
            ? "flawed"
            : event.code === config.again
              ? "failed"
              : null;
      if (verdict == null) return;

      // Space would scroll the window and Return would submit whatever form
      // happens to be focused; a bound key belongs to the verdict, not to the
      // page.
      if (SWALLOWED_CODES.has(event.code) || event.cancelable) {
        event.preventDefault();
      }
      setUsed(true);
      onVerdict(verdict);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { used };
}
