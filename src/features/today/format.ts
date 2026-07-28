/**
 * Small pure formatters shared by the Today menu and the Today's Practice
 * panel. They live apart from either component so the menu can import them
 * without pulling the panel (and its data hooks) into the menu's module graph.
 */

export function compactDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function todayLabel(now = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
}
