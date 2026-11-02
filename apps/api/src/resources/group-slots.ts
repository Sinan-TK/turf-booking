/**
 * Slots of a pooled group (a kayak fleet). FLEXIBLE: any start the venue's booking grid and the group's priced hours allow, for a priced
 * length, from the whole fleet. FIXED: only the slots the owner listed: each is a time range (venue-local) with its own number of items
 * and its own price per item, and slots never overlap.
 */
export const HM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** An end time, where "24:00" is midnight at the end of the day. */
export const END_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export interface FixedSlot {
  /** "HH:mm", venue-local. */
  start: string;
  /** "HH:mm" or "24:00". */
  end: string;
  /** How many items this slot offers (at most the whole fleet). */
  count: number;
  /** Price and online advance for ONE item; null until the owner has priced the slot (it is then not shown to customers). */
  price: number | null;
  advance: number | null;
}

export interface GroupSlotRules {
  isBookable: boolean;
  slotMode: 'FLEXIBLE' | 'FIXED';
  fixedSlots: unknown;
}

/** "HH:mm" or "24:00" as minutes since local midnight. */
export function minutesOf(hm: string): number {
  const [h = 0, m = 0] = hm.split(':').map(Number);
  return h * 60 + m;
}

/** The slots as stored (Json), kept only where they have the right shape, in clock order. */
export function parseFixedSlots(json: unknown): FixedSlot[] {
  if (!Array.isArray(json)) return [];
  const slots: FixedSlot[] = [];
  for (const raw of json) {
    const s = raw as Partial<FixedSlot> | null;
    if (!s || typeof s.start !== 'string' || typeof s.end !== 'string' || !HM_PATTERN.test(s.start) || !END_PATTERN.test(s.end)) continue;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    slots.push({ start: s.start, end: s.end, count: Math.trunc(Number(s.count) || 0), price: num(s.price), advance: num(s.advance) });
  }
  return slots.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
}

/** A slot's length in minutes. */
export function slotLength(slot: Pick<FixedSlot, 'start' | 'end'>): number {
  return minutesOf(slot.end) - minutesOf(slot.start);
}

/** "HH:mm" on the clock of `timezone` for an instant. */
export function localHm(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** "18:30" -> "6:30 PM"; "24:00" -> "12:00 AM". */
export function clockLabel(hm: string): string {
  const [h = 0, m = 0] = hm.split(':').map(Number);
  const hour = h % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(m).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "8:00 AM – 9:30 AM". */
export function rangeLabel(slot: Pick<FixedSlot, 'start' | 'end'>): string {
  return `${clockLabel(slot.start)} – ${clockLabel(slot.end)}`;
}

/** The slot that starts at this instant on the venue's clock, or null. */
export function findSlot(group: Pick<GroupSlotRules, 'fixedSlots'>, start: Date, timezone: string): FixedSlot | null {
  const hm = localHm(start, timezone);
  return parseFixedSlots(group.fixedSlots).find((s) => s.start === hm) ?? null;
}

/** Why this start (and length) cannot be booked on the group, or null when its slot rules allow it. */
export function groupStartProblem(group: GroupSlotRules, start: Date, timezone: string, durationMinutes?: number): string | null {
  if (!group.isBookable) return 'This is not open for booking right now.';
  if (group.slotMode !== 'FIXED') return null;
  const slot = findSlot(group, start, timezone);
  if (!slot) {
    const all = parseFixedSlots(group.fixedSlots);
    return `This is only available at fixed times: ${all.map(rangeLabel).join(', ') || 'none are set up yet'}.`;
  }
  if (durationMinutes !== undefined && durationMinutes !== slotLength(slot)) {
    return `The ${rangeLabel(slot)} slot is ${slotLength(slot)} minutes long.`;
  }
  if (slot.price === null || slot.advance === null) return 'This slot has no price yet.';
  return null;
}

/**
 * The first thing wrong with a list of slots an owner is saving, in words the owner can act on, or null when they are fine.
 * `allowedLength` says whether the booking rules allow a booking of that many minutes; `minAdvancePercent` is the platform's smallest
 * online advance, as a percentage of the price.
 */
export function slotProblems(
  slots: FixedSlot[],
  ctx: { totalUnits: number | null; slotIntervalMin: number; allowedLength: (minutes: number) => boolean; minAdvancePercent?: number },
): string | null {
  if (slots.length === 0) return 'Add at least one slot for fixed times.';
  const sorted = [...slots].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    const label = rangeLabel(s);
    const length = slotLength(s);
    if (length <= 0) return `${label}: the end must be after the start.`;
    if (minutesOf(s.start) % ctx.slotIntervalMin !== 0) return `${label}: the start must be a multiple of ${ctx.slotIntervalMin} minutes.`;
    if (!ctx.allowedLength(length)) return `${label}: a booking of ${length} minutes is not allowed for this facility.`;
    if (!Number.isInteger(s.count) || s.count < 1) return `${label}: enter how many are available.`;
    if (ctx.totalUnits !== null && s.count > ctx.totalUnits) return `${label}: ${s.count} is more than the ${ctx.totalUnits} you have.`;
    const next = sorted[i + 1];
    if (next && minutesOf(next.start) < minutesOf(s.end)) return `${label} overlaps ${rangeLabel(next)}. Slots can't overlap.`;
    if (s.price !== null || s.advance !== null) {
      if (s.price === null || s.price < 0) return `${label}: enter the price for one.`;
      if (s.advance === null || s.advance <= 0) return `${label}: enter how much one pays online.`;
      if (s.advance > s.price) return `${label}: the online amount can't be more than the price (${s.price}).`;
      if (ctx.minAdvancePercent !== undefined && s.advance < Math.ceil((s.price * ctx.minAdvancePercent) / 100)) {
        return `${label}: the online amount must be at least ${ctx.minAdvancePercent}% of the price (${Math.ceil((s.price * ctx.minAdvancePercent) / 100)}).`;
      }
    }
  }
  return null;
}
