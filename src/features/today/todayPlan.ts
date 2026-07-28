const STORAGE_PREFIX = "codakiller.today-plan.";

export const TODAY_PLAN_MAX_LENGTH = 1200;
export const TODAY_PLAN_CHANGED_EVENT = "codakiller:today-plan-changed";

function storageKey(date: string) {
  return `${STORAGE_PREFIX}${date}`;
}

/**
 * The lightweight daily intention is UI context, not practice evidence. Keep it
 * local to this Mac and date-scoped so opening a new day never silently carries
 * yesterday's plan forward.
 */
export function readTodayPlan(date: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey(date)) ?? "";
  } catch {
    return "";
  }
}

export function writeTodayPlan(date: string, value: string): string {
  const bounded = value.slice(0, TODAY_PLAN_MAX_LENGTH);
  if (typeof window === "undefined") return bounded;
  try {
    if (bounded.trim()) {
      window.localStorage.setItem(storageKey(date), bounded);
    } else {
      window.localStorage.removeItem(storageKey(date));
    }
    window.dispatchEvent(
      new CustomEvent(TODAY_PLAN_CHANGED_EVENT, {
        detail: { date, value: bounded },
      }),
    );
  } catch {
    // A blocked WebView storage layer must not make the practice surface fail.
  }
  return bounded;
}

/**
 * Retire the legacy key for a date. Used once by the day-sheet migration after
 * the value has been seeded into the durable sheet, so the notebook — not this
 * localStorage slot — becomes the single source of truth going forward.
 */
export function clearTodayPlan(date: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(date));
    window.dispatchEvent(
      new CustomEvent(TODAY_PLAN_CHANGED_EVENT, {
        detail: { date, value: "" },
      }),
    );
  } catch {
    // A blocked storage layer is a no-op; the seed already holds the value.
  }
}
