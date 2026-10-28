import { Injectable } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { coverageWindows } from '../pricing/pricing-rules';

export interface OpenWindow {
  /** "HH:mm" in the venue's local time. */
  openTime: string;
  closeTime: string;
}

export interface BlockTarget {
  /** Resources whose footprint the booking occupies (exclusive path). */
  footprintIds?: string[];
  /** Pooled group being booked. */
  resourceGroupId?: string;
}

/**
 * When a unit can be booked, and blackouts — the single read path for both search and
 * hold creation, so the two always agree.
 *
 * There are no separate "opening hours": a unit can be booked exactly where one of its
 * active prices (for the requested duration) covers the day and time. Blackouts come
 * from AvailabilityRule-era BlockedPeriod (AVAILABILITY_SOURCE=rules, default) or the
 * legacy BlockedDate table (AVAILABILITY_SOURCE=legacy, rollback).
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  private useRules(): boolean {
    return loadEnv().AVAILABILITY_SOURCE === 'rules';
  }

  /**
   * Windows during which the target can be booked for `durationMinutes` on the venue-local
   * calendar day `localDay`: the merged time windows of its active prices that cover that
   * weekday (see coverageWindows). Empty = no price covers that day, so it is not bookable.
   */
  async openWindows(
    target: { resourceId?: string; resourceGroupId?: string },
    localDay: DateTime,
    durationMinutes: number,
  ): Promise<OpenWindow[]> {
    if (target.resourceId === undefined && target.resourceGroupId === undefined) return [];
    const rules = await this.prisma.client.pricingRule.findMany({
      where: {
        // A unit's prices are per block, whatever the booking length; only a pooled group is priced per duration.
        ...(target.resourceGroupId !== undefined && target.resourceId === undefined ? { durationMinutes } : {}),
        isActive: true,
        effectiveFrom: { lte: localDay.endOf('day').toJSDate() },
        ...(target.resourceId !== undefined
          ? { resourceId: target.resourceId }
          : { resourceGroupId: target.resourceGroupId }),
      },
    });
    return coverageWindows(rules, localDay.weekday);
  }

  /** Blocked ranges overlapping [start, end) that apply to the target. */
  async findBlocks(
    venueId: string,
    target: BlockTarget,
    start: Date,
    end: Date,
  ): Promise<Array<{ startTime: Date; endTime: Date }>> {
    const footprintIds = target.footprintIds ?? [];
    if (this.useRules()) {
      return this.prisma.client.blockedPeriod.findMany({
        where: {
          venueId,
          startTime: { lt: end },
          endTime: { gt: start },
          OR: [
            { resourceId: null, resourceGroupId: null },
            ...(footprintIds.length ? [{ resourceId: { in: footprintIds } }] : []),
            ...(target.resourceGroupId ? [{ resourceGroupId: target.resourceGroupId }] : []),
          ],
        },
        select: { startTime: true, endTime: true },
      });
    }
    // Legacy BlockedDate has no group column: only venue-wide and
    // resource-scoped blocks exist there.
    return this.prisma.client.blockedDate.findMany({
      where: {
        venueId,
        startTime: { lt: end },
        endTime: { gt: start },
        OR: [{ resourceId: null }, ...(footprintIds.length ? [{ resourceId: { in: footprintIds } }] : [])],
      },
      select: { startTime: true, endTime: true },
    });
  }

  async isBlocked(venueId: string, target: BlockTarget, start: Date, end: Date): Promise<boolean> {
    return (await this.findBlocks(venueId, target, start, end)).length > 0;
  }

  /**
   * True when [start, end) lies inside a single bookable window (see openWindows) on the
   * venue-local day of `start`. The duration is the length of [start, end).
   */
  async isWithinOpeningHours(
    target: { resourceId?: string; resourceGroupId?: string },
    start: Date,
    end: Date,
    timezone: string,
  ): Promise<boolean> {
    const localStart = DateTime.fromJSDate(start, { zone: timezone });
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    const windows = await this.openWindows(target, localStart, durationMinutes);
    return windows.some((w) => start >= this.at(localStart, w.openTime) && end <= this.at(localStart, w.closeTime));
  }

  /** Wall-clock "HH:mm" on the same local day as `day`, as an instant. */
  at(day: DateTime, hhmm: string): Date {
    if (hhmm === '24:00') return day.startOf('day').plus({ days: 1 }).toJSDate(); // end of the day
    const [h, m] = hhmm.split(':').map(Number);
    return day.set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 }).toJSDate();
  }
}
