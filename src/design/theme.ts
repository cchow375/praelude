// Theme resolution + application for CodaKiller.
//
// A theme *preference* is one of 'auto' | 'dark' | 'light'. 'auto' defers to the
// operating system's `prefers-color-scheme`. Everything downstream (the token
// system in tokens.css) reacts to the `data-theme` attribute on <html>, which is
// always a *concrete* theme ('dark' | 'light') produced by resolveTheme().

export type ThemePref = "auto" | "dark" | "light";
export type Theme = "dark" | "light";

/**
 * Collapse a preference + the current system scheme into a concrete theme.
 * Pure and side-effect free so it is trivially testable.
 */
export function resolveTheme(pref: ThemePref, system: Theme): Theme {
  return pref === "auto" ? system : pref;
}

/** Read the OS color scheme. Safe in non-DOM (test) environments. */
export function getSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Write the resolved concrete theme onto <html data-theme>. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Keep <html data-theme> in sync with a preference, re-resolving live whenever
 * the OS scheme changes (only relevant while the preference is 'auto', but we
 * subscribe unconditionally and let resolveTheme decide). Returns an unsubscribe.
 */
export function watchTheme(pref: ThemePref): () => void {
  applyTheme(resolveTheme(pref, getSystemTheme()));

  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme(resolveTheme(pref, getSystemTheme()));
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
