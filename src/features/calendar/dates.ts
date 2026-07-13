const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: string): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid local date: ${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, amount: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + amount);
  return formatLocalDate(date);
}

export function startOfWeek(value: string): string {
  const date = parseLocalDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return formatLocalDate(date);
}

export function todayLocal(): string {
  return formatLocalDate(new Date());
}

export function dayLabel(value: string): { weekday: string; date: string } {
  const date = parseLocalDate(value);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
  };
}

export function weekLabel(from: string, to: string): string {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  const startLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${startLabel} – ${endLabel}`;
}
