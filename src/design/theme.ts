// Theme resolution + application for CodaKiller.
//
// v4 is PAPER-ONLY. The app is a notebook: warm paper, ink, ruled lines (see
// tokens.css). The `ThemePref` union is retained because the Settings snapshot
// contract ("auto" | "dark" | "light") is persisted by the Rust side, but every
// path resolves to the single concrete theme "paper" and writes
// `data-theme="paper"` onto <html>.

export type ThemePref = "auto" | "dark" | "light";
export type Theme = "paper";

/** The one concrete theme the app renders. */
export const THEME: Theme = "paper";

/** Paper-only: always resolves to the single concrete theme. */
export function resolveTheme(_pref?: ThemePref, _system?: Theme): Theme {
  return THEME;
}

/** Paper-only: the app never reads the OS scheme anymore. */
export function getSystemTheme(): Theme {
  return THEME;
}

/**
 * Write the (only) concrete theme onto <html data-theme>.
 *
 * A stored `ThemePref` is accepted and ignored so existing callers that pass a
 * persisted preference still compile; tokens.css defines the full paper set for
 * every historical attribute value, so no stale attribute can un-style a
 * surface.
 */
export function applyTheme(_theme: Theme | ThemePref = THEME): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", THEME);
}

/**
 * Keep <html data-theme> pinned to paper. Retained as a no-op subscription so
 * existing callers (App, settings) need no signature change. Returns an
 * unsubscribe.
 */
export function watchTheme(_pref?: ThemePref): () => void {
  applyTheme();
  return () => {};
}
