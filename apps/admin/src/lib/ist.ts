// IST (Asia/Kolkata) calendar helpers + number formatting, shared by the
// Dashboard, Analytics and Marketing panels so every date on every panel means
// the same thing and is rendered the same way.
//
// Every aggregate in this product is bucketed on the IST calendar day (the
// nightly Cloud Functions roll up IST 00:00 -> IST 00:00), so the UI must do its
// date arithmetic in IST too — never in the viewer's local timezone.

export const DAY_MS = 86_400_000;
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar date (YYYY-MM-DD) for a UTC instant in ms. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's IST calendar date. */
export function istToday(): string {
  return istDay(Date.now());
}

/** IST midnight of a given IST date, as a UTC instant in ms. */
export function istMidnightMs(istDate: string): number {
  return new Date(`${istDate}T00:00:00+05:30`).getTime();
}

/** IST midnight of today, as a UTC instant in ms. */
export function istTodayMidnightMs(): number {
  return istMidnightMs(istToday());
}

/** Shift an IST date string by whole days. */
export function addDays(istDate: string, days: number): string {
  return istDay(istMidnightMs(istDate) + days * DAY_MS);
}

/**
 * Every IST date from `start` to `end` inclusive, newest first.
 *
 * Breakdown tables render this list rather than only the dates that happen to
 * have data, so a zero day is visibly zero instead of silently absent — that
 * gap is what made "today is missing" confusing on the marketing panel.
 */
export function daysDescending(start: string, end: string): string[] {
  const out: string[] = [];
  for (let ms = istMidnightMs(end); ms >= istMidnightMs(start); ms -= DAY_MS) {
    out.push(istDay(ms));
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue, 4 Aug 2026" — parsed as an IST date, not the viewer's timezone. */
export function formatDay(istDate: string, opts: { year?: boolean } = {}): string {
  const [y, m, d] = istDate.split("-").map(Number);
  if (!y || !m || !d) return istDate;
  // Date.UTC + the UTC getters keep the weekday correct regardless of viewer tz.
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTHS[m - 1]}${opts.year === false ? "" : ` ${y}`}`;
}

/** "4 Aug" — compact form for chart axes. */
export function formatDayShort(istDate: string): string {
  const [, m, d] = istDate.split("-").map(Number);
  if (!m || !d) return istDate;
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Today" / "Yesterday" for the two most recent days, else null. */
export function relativeDayLabel(istDate: string, today = istToday()): string | null {
  if (istDate === today) return "Today";
  if (istDate === addDays(today, -1)) return "Yesterday";
  return null;
}

/** Wall-clock time in IST, e.g. "16:33:41". */
export function istClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Indian-grouped integer, e.g. 1,23,456. */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** "₹11,559" — whole rupees, Indian grouping. */
export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${formatCount(amount)}`;
  }
}

/**
 * Percent change from `previous` to `current`.
 * Returns null when there's no baseline to compare against, so the UI can show
 * "—" instead of a meaningless +100%.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}
