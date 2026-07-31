/** Shared display formatting for the Universe map + its detail panel. */

import { daysSince } from "./repertoire";

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return safe > 0 ? "<1m" : "0m";
}

export function formatDate(value: string | null): string {
  if (!value) return "Not practiced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * How long ago something was practised, measured against the snapshot's own
 * `generated_at` so a stored snapshot always reads the same way.
 *
 * Falls back to the absolute date when the elapsed days cannot be computed
 * (unparseable stamp), rather than inventing a duration.
 */
export function formatSince(
  lastPracticed: string | null,
  reference: string | null | undefined,
): string {
  if (!lastPracticed) return "Never practiced";
  const days = daysSince(lastPracticed, reference);
  if (days == null) return `Practiced ${formatDate(lastPracticed)}`;
  if (days === 0) return "Practiced today";
  if (days === 1) return "Practiced yesterday";
  return `Practiced ${days} days ago`;
}
