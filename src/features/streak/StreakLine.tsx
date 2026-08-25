import type { StreakSummary } from "./api";
import "./streak.css";

/**
 * The one component both the Today menu and the Calendar header mount, so the
 * two surfaces can never disagree about the same number.
 *
 * At zero, this TEACHES rather than displays: it names the threshold that
 * starts day 1, never a streak number that was not earned (constraint 4,
 * earned-only motivation law — a promise is lawful, an unearned visual is
 * not). Before this it rendered nothing at all, which is why the feature was
 * invisible until someone had already earned a day.
 */
export function StreakLine({ summary }: { summary: StreakSummary | null }) {
  if (!summary) return null;
  const { current_days, best_days, threshold_minutes } = summary;
  if (current_days === 0 && best_days === 0) {
    return (
      <p className="streak-line is-empty" data-testid="streak-line">
        Day 1 starts at {threshold_minutes} focused minutes.
      </p>
    );
  }
  return (
    <p
      className="streak-line"
      data-testid="streak-line"
      title={`A day joins the streak at ${threshold_minutes} focused minutes.`}
    >
      {current_days > 0 && (
        <span className="streak-current">{current_days} day streak</span>
      )}
      {best_days > 0 && <span className="streak-best">best {best_days}</span>}
    </p>
  );
}
