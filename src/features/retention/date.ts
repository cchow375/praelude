const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function nextIsoDate(value: string): string {
  if (!isIsoDate(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

/** Snoozing must move the check beyond both its current due date and this queue's date. */
export function isValidSnoozeDate(
  requested: string,
  currentDueDate: string,
  asOfDate: string,
): boolean {
  return isIsoDate(requested)
    && isIsoDate(currentDueDate)
    && isIsoDate(asOfDate)
    && requested > currentDueDate
    && requested > asOfDate;
}

export function defaultSnoozeDate(currentDueDate: string, asOfDate: string): string {
  if (!isIsoDate(currentDueDate) || !isIsoDate(asOfDate)) return "";
  return nextIsoDate(currentDueDate > asOfDate ? currentDueDate : asOfDate);
}
