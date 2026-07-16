// Theme resolution + application for CodaKiller.
//
// v3 is DARK-ONLY. Light mode was dropped (see tokens.css). The `ThemePref`
// union is retained so the Settings snapshot contract ("auto" | "dark" |
// "light") still type-checks, but every path resolves to the single concrete
// theme "dark" and writes `data-theme="dark"` onto <html>.

export type ThemePref = "auto" | "dark" | "light";
export type Theme = "dark";

/** Dark-only: always resolves to the single concrete theme. */
export function resolveTheme(_pref?: ThemePref, _system?: Theme): Theme {
  return "dark";
}

/** Dark-only: the app never reads the OS scheme anymore. */
export function getSystemTheme(): Theme {
  return "dark";
}

/** Write the (only) concrete theme onto <html data-theme>. */
export function applyTheme(_theme: Theme = "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", "dark");
}

/**
 * Keep <html data-theme> pinned to dark. Retained as a no-op subscription so
 * existing callers (App, settings) need no signature change. Returns an
 * unsubscribe.
 */
export function watchTheme(_pref?: ThemePref): () => void {
  applyTheme("dark");
  return () => {};
}
