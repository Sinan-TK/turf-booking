import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

/** ISO weekdays: 1 = Monday .. 7 = Sunday. */
export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const LEGACY_DAY_TYPES: Record<string, number[]> = {
  WEEKDAY: [1, 2, 3, 4, 5],
  WEEKEND: [6, 7],
  HOLIDAY: [],
};

/** The old WEEKDAY / WEEKEND / HOLIDAY bucket as the days it stood for. */
export function legacyDayTypeToWeekdays(dayType: string): number[] {
  return LEGACY_DAY_TYPES[dayType] ?? [];
}

export interface PricingRuleLike {
  /** False = blocked by the owner; never matches a slot. */
  isActive?: boolean;
  weekdays: number[];
  /** Only read when `weekdays` is empty (a row written before weekdays existed). */
  dayType?: string | null;
  startWindow: string | null;
  endWindow: string | null;
  effectiveFrom: Date;
  createdAt: Date;
}

/** "HH:mm" -> minutes since midnight; "24:00" is the end of the day. Null if malformed. */
export function parseClock(value: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 24 * 60 && Number(m[2]) < 60 ? minutes : null;
}

function ruleWeekdays(rule: PricingRuleLike): number[] {
  if (rule.weekdays.length > 0) return rule.weekdays;
  return rule.dayType ? legacyDayTypeToWeekdays(rule.dayType) : [];
}

/** The rule's [start, end) window in minutes, or null when it applies all day. */
function window(rule: PricingRuleLike): [number, number] | null {
  const start = parseClock(rule.startWindow);
  const end = parseClock(rule.endWindow);
  return start !== null && end !== null && start < end ? [start, end] : null;
}

/**
 * Which price applies to a slot starting at `at`, evaluated in the VENUE's
 * local time (a booking near local midnight must price against the right day).
 *
 * A rule matches when it covers the slot's weekday and, if it has a time
 * window, the slot starts inside [start, end). When several match, the most
 * specific wins: a time window beats an all-day rule, a shorter window beats a
 * longer one, and otherwise the most recently effective / created rule wins
 * (so adding a new all-day price overrides the old one).
 */
export function pickPricingRule<T extends PricingRuleLike>(rules: T[], at: Date, timezone: string): T | null {
  const local = DateTime.fromJSDate(at, { zone: timezone });
  const minutes = local.hour * 60 + local.minute;
  const matches = rules.filter((rule) => {
    if (rule.isActive === false) return false;
    if (rule.effectiveFrom > at) return false;
    if (!ruleWeekdays(rule).includes(local.weekday)) return false;
    const w = window(rule);
    return w === null || (minutes >= w[0] && minutes < w[1]);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const wa = window(a);
    const wb = window(b);
    if ((wa === null) !== (wb === null)) return wa === null ? 1 : -1;
    if (wa && wb && wa[1] - wa[0] !== wb[1] - wb[0]) return wa[1] - wa[0] - (wb[1] - wb[0]);
    return (
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
    );
  });
  return matches[0] ?? null;
}

const toHHmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The times a unit can be booked on one weekday, derived from its prices: every active
 * price covering that weekday contributes its time window (all day = 00:00-24:00), and
 * windows that overlap or touch are merged. No price = no window = not bookable.
 * `weekday` is ISO (1 = Monday .. 7 = Sunday). A start time inside a window is always
 * covered by at least one price, so these windows are exactly where a price exists.
 */
export function coverageWindows(rules: PricingRuleLike[], weekday: number): Array<{ openTime: string; closeTime: string }> {
  const spans = rules
    .filter((r) => r.isActive !== false && ruleWeekdays(r).includes(weekday))
    .map((r) => window(r) ?? ([0, 24 * 60] as [number, number]))
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => ({ openTime: toHHmm(start), closeTime: end === 24 * 60 ? '24:00' : toHHmm(end) }));
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon–Fri", "Sat, Sun", "Every day" — runs of 3+ consecutive days become a range. */
export function describeDays(days: number[]): string {
  if (days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${DAY_SHORT[sorted[i]! - 1]}–${DAY_SHORT[sorted[j]! - 1]}`);
    else for (let k = i; k <= j; k++) parts.push(DAY_SHORT[sorted[k]! - 1]!);
    i = j + 1;
  }
  return parts.join(', ');
}

function describeClock(hhmm: string): string {
  if (hhmm === '24:00') return 'midnight';
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Fri–Sun, 6:00 pm – 11:00 pm, 60 min at INR 1500" for error messages. */
export function describeRule(
  rule: PricingRuleLike & { durationMinutes: number; normalPrice: Money; offerPrice?: Money | null; currency: string },
): string {
  const days = describeDays(ruleWeekdays(rule));
  const w = window(rule);
  const time = w ? `${describeClock(rule.startWindow!)} – ${describeClock(rule.endWindow!)}` : 'all day';
  return `${days}, ${time}, ${rule.durationMinutes} min at ${rule.currency} ${effectivePrice(rule)}`;
}

/** True when some slot (a day and a start time) would be priced by both rules. */
export function rulesOverlap(a: PricingRuleLike, b: PricingRuleLike): boolean {
  const daysB = new Set(ruleWeekdays(b));
  if (!ruleWeekdays(a).some((d) => daysB.has(d))) return false;
  const wa = window(a) ?? [0, 24 * 60];
  const wb = window(b) ?? [0, 24 * 60];
  return wa[0] < wb[1] && wb[0] < wa[1];
}

type Money = { toString(): string } | number | string;
const toNumber = (m: Money): number => Number(m.toString());
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The full price of a slot: the offer price when the rule has one, else the normal price.
 * (The booking price is only the advance paid online; the rest is paid at the venue.)
 */
export function effectivePrice(rule: { normalPrice: Money; offerPrice?: Money | null }): number {
  return cents(rule.offerPrice != null ? toNumber(rule.offerPrice) : toNumber(rule.normalPrice));
}

/**
 * Checks a rule's three prices and fills in the booking price. Normal is the full price; an offer must
 * be below it and then replaces it as the full price; the booking price (the advance paid online) can
 * equal the full price but never exceed it, and defaults to it (pay everything up front).
 */
export function resolvePrices(input: {
  normalPrice: number;
  offerPrice?: number | null;
  bookingPrice?: number | null;
}): { normalPrice: number; offerPrice: number | null; bookingPrice: number } {
  const normalPrice = cents(input.normalPrice);
  const offerPrice = input.offerPrice == null ? null : cents(input.offerPrice);
  if (offerPrice !== null && offerPrice >= normalPrice) {
    throw new BadRequestException(`The offer price must be below the normal price (${normalPrice}).`);
  }
  const full = offerPrice ?? normalPrice;
  const bookingPrice = input.bookingPrice == null ? full : cents(input.bookingPrice);
  if (bookingPrice <= 0 && full > 0) {
    throw new BadRequestException('The booking amount must be more than 0: it is what the customer pays online to hold the slot.');
  }
  if (bookingPrice > full) {
    throw new BadRequestException(
      `The booking amount can't be more than the ${offerPrice !== null ? 'offer' : 'normal'} price (${full}).`,
    );
  }
  return { normalPrice, offerPrice, bookingPrice };
}

/** A rule as the API returns it: the stored three prices plus `price`, the effective full price. */
export function withPrice<T extends { normalPrice: Money; offerPrice?: Money | null }>(rule: T): T & { price: number } {
  return { ...rule, price: effectivePrice(rule) };
}
