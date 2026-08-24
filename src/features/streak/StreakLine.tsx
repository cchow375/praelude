import type { StreakSummary } from "./api";
import "./streak.css";

/**
 * The one component both the Today menu and the Calendar header mount, so the
 * two surfaces can never disagree about the same number.
 *
 * Renders NOTHING when nothing has been earned — not a zero, not a greyed-out
 * "start your streak!" nudge. The earned-only law is a rendering rule, not just
 * a data rule: an unearned visual is still an unearned visual.
 */
export function StreakLine({ summary }: { summary: StreakSummary | null }) {
  if (!summary) return null;
  const { current_days, best_days, threshold_minutes } = summary;
  if (current_days === 0 && best_days === 0) return null;
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
