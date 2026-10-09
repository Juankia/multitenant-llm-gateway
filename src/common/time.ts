export interface MonthWindow {
  /** Inclusive start (first instant of the month, UTC). */
  start: Date;
  /** Exclusive end (first instant of the next month, UTC) - also the budget reset time. */
  end: Date;
  /** YYYY-MM label. */
  label: string;
}

/** Billing periods are calendar months in UTC so every tenant resets at the same instant. */
export function monthWindow(at: Date = new Date()): MonthWindow {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, label };
}

export function parseMonth(label: string): MonthWindow | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (!match) return null;
  return monthWindow(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}
