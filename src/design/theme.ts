export type ThemePref = "auto" | "dark" | "light";
export type Theme = "dark" | "light";

/** New profiles retain the quiet dark practice room. */
export const THEME: Theme = "dark";

export function getSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return THEME;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(pref: ThemePref = THEME, system = getSystemTheme()): Theme {
  return pref === "auto" ? system : pref;
}

export function applyTheme(theme: Theme | ThemePref = THEME): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}

/** Only System appearance follows OS changes; explicit modes stay stable. */
export function watchTheme(pref: ThemePref = THEME): () => void {
  applyTheme(pref);
  if (pref !== "auto" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(query.matches ? "dark" : "light");
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
