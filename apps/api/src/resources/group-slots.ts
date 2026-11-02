/**
 * Start times of a pooled group (a kayak fleet). FLEXIBLE: any start the venue's booking grid and the group's priced hours allow.
 * FIXED: only the departures the owner listed, as venue-local "HH:mm".
 */
export const HM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The listed times, trimmed, de-duplicated and in clock order. */
export function normalizeStartTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()))].sort();
}

/** "HH:mm" on the clock of `timezone` for an instant. */
export function localHm(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** "18:30" -> "6:30 PM". */
export function clockLabel(hm: string): string {
  const [h = 0, m = 0] = hm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface GroupSlotRules {
  isBookable: boolean;
  slotMode: 'FLEXIBLE' | 'FIXED';
  fixedStartTimes: string[];
}

/** Why this start cannot be booked on the group, or null when its slot rules allow it. */
export function groupStartProblem(group: GroupSlotRules, start: Date, timezone: string): string | null {
  if (!group.isBookable) return 'This is not open for booking right now.';
  if (group.slotMode === 'FIXED' && !group.fixedStartTimes.includes(localHm(start, timezone))) {
    return `This is only available at fixed times: ${group.fixedStartTimes.map(clockLabel).join(', ')}.`;
  }
  return null;
}
