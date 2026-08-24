import { useEffect, useState } from "react";
import { streakSummary, type StreakSummary } from "./api";

/**
 * One read on mount. Deliberately not polled: a streak changes at LOCAL-day
 * granularity, and this app's streaming idiom is listen-then-fetch-once, never
 * a timer (see useMetronome). A failed read leaves the value null, which every
 * consumer renders as "nothing", never as a zero streak.
 */
export function useStreak(): StreakSummary | null {
  const [summary, setSummary] = useState<StreakSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void streakSummary()
      .then((next) => {
        if (alive) setSummary(next);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return summary;
}
