/** Venue times in these tests are all Asia/Kolkata (UTC+05:30, no daylight saving). */
const pad = (n: number) => String(n).padStart(2, '0');

/** The next given ISO weekday (1 = Monday .. 7 = Sunday), at least `minDaysAhead` days from today, as 'YYYY-MM-DD' in Kolkata. */
export function nextIstDay(isoWeekday: number, minDaysAhead = 3): string {
  const kolkataNow = new Date(Date.now() + 330 * 60_000);
  const d = new Date(Date.UTC(kolkataNow.getUTCFullYear(), kolkataNow.getUTCMonth(), kolkataNow.getUTCDate() + minDaysAhead));
  while ((d.getUTCDay() || 7) !== isoWeekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** An instant (ISO string, UTC) for hour:minute Kolkata time on 'YYYY-MM-DD'. */
export const istInstant = (ymd: string, hour: number, minute = 0): string =>
  new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:30`).toISOString();

/** A phone number nobody else uses, so each test gets its own customer. */
export const uniquePhone = (): string => `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** Today's date in Kolkata as 'YYYY-MM-DD'. */
export const istToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' plus n days. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of 'YYYY-MM-DD'. */
export const isoWeekday = (ymd: string): number => new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7;
