import type { NotebookLine } from "./lines";

// Plan total time (spec A9): a PURE roll-up over a day sheet's body — the
// header's "Σ N min planned · M lines unestimated" summary reads straight off
// this, live for today's editable sheet and static for a browsed past sheet.
// `minutes` sums every BlockLine's minutes (a block with minutes=0 still
// counts as timed — bounds validation belongs to the line model, not here).
// `untimedActionLines` counts UNCHECKED ItemLines only: a checked item is done
// work, not pending work, so it never counts toward "unestimated".

export interface PlanTotals {
  minutes: number;
  timedLines: number;
  untimedActionLines: number;
}

export function planTotals(lines: NotebookLine[]): PlanTotals {
  let minutes = 0;
  let timedLines = 0;
  let untimedActionLines = 0;
  for (const line of lines) {
    if (line.type === "block") {
      minutes += line.minutes;
      timedLines += 1;
    } else if (line.type === "item" && !line.checked) {
      untimedActionLines += 1;
    }
  }
  return { minutes, timedLines, untimedActionLines };
}

/**
 * The header string, or `null` for an empty/total-zero sheet (nothing timed,
 * nothing unestimated) so the header renders nothing at all rather than an
 * empty summary line.
 */
export function formatPlanTotals(totals: PlanTotals): string | null {
  if (totals.minutes === 0 && totals.untimedActionLines === 0) return null;
  const base = `Σ ${totals.minutes} min planned`;
  if (totals.untimedActionLines === 0) return base;
  return `${base} · ${totals.untimedActionLines} lines unestimated`;
}
