// Praelude renders one deliberate dark interface. ThemePref stays compatible
// with persisted settings from older releases, but every value resolves dark.

export type ThemePref = "auto" | "dark" | "light";
export type Theme = "dark";

/** The one concrete theme the app renders. */
export const THEME: Theme = "dark";

/** Dark by design: old auto/light preferences migrate visually without a DB write. */
export function resolveTheme(_pref?: ThemePref, _system?: Theme): Theme {
  return THEME;
}

/** Praelude does not follow the OS appearance. */
export function getSystemTheme(): Theme {
  return THEME;
}

/**
 * Write the concrete theme onto <html data-theme>.
 *
 * A stored `ThemePref` is accepted and ignored so existing callers that pass a
 * persisted preference still compiles; tokens.css defines the complete dark
 * set for every historical attribute value, so no stale value can un-style a
 * surface.
 */
export function applyTheme(_theme: Theme | ThemePref = THEME): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", THEME);
}

/**
 * Keep <html data-theme> pinned to dark. Retained as a no-op subscription so
 * existing callers (App, settings) need no signature change. Returns an
 * unsubscribe.
 */
export function watchTheme(_pref?: ThemePref): () => void {
  applyTheme();
  return () => {};
}
