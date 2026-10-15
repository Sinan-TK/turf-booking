import { Injectable } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';

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
 * Opening hours and blackouts — the single read path for both search and
 * hold creation, so the two always agree.
 *
 * AVAILABILITY_SOURCE=rules (default): AvailabilityRule + BlockedPeriod.
 * Hours fall back to the legacy OperatingHours table for a venue that has no
 * AvailabilityRule rows at all (not yet synced), so a half-migrated venue
 * never silently becomes "open all day".
 * AVAILABILITY_SOURCE=legacy: OperatingHours + BlockedDate only (rollback).
 *
 * Writes always go to both table families (VenueConfigService), so flipping
 * the flag in either direction needs no data migration.
 */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  private useRules(): boolean {
    return loadEnv().AVAILABILITY_SOURCE === 'rules';
  }

  /**
   * Windows during which the target is open on the venue-local calendar day
   * `localDay` (whose weekday is 0=Sunday..6). `null` = no hours configured
   * for that weekday, which keeps the long-standing behaviour of
   * "unconstrained" (see AvailabilityService) rather than "closed".
   */
  async openWindows(
    venueId: string,
    target: { resourceId?: string; resourceGroupId?: string },
    localDay: DateTime,
  ): Promise<OpenWindow[] | null> {
    const weekday = localDay.weekday % 7; // luxon 1=Mon..7=Sun -> 0=Sun..6=Sat

    if (this.useRules()) {
      const rules = await this.prisma.client.availabilityRule.findMany({ where: { venueId } });
      if (rules.length > 0) {
        const dayStart = localDay.startOf('day').toJSDate();
        const dayEnd = localDay.endOf('day').toJSDate();
        const todays = rules.filter(
          (r) =>
            r.weekday === weekday &&
            (!r.validFrom || r.validFrom <= dayEnd) &&
            (!r.validTo || r.validTo >= dayStart),
        );
        const specific = todays.filter(
          (r) =>
            (target.resourceId !== undefined && r.resourceId === target.resourceId) ||
            (target.resourceGroupId !== undefined && r.resourceGroupId === target.resourceGroupId),
        );
        const chosen = specific.length
          ? specific
          : todays.filter((r) => r.resourceId === null && r.resourceGroupId === null);
        if (chosen.length === 0) return null;
        return chosen
          .map((r) => ({ openTime: r.openTime, closeTime: r.closeTime }))
          .sort((a, b) => a.openTime.localeCompare(b.openTime));
      }
      // No AvailabilityRule rows for this venue at all -> fall through to legacy.
    }

    const legacy = await this.prisma.client.operatingHours.findFirst({ where: { venueId, weekday } });
    return legacy ? [{ openTime: legacy.openTime, closeTime: legacy.closeTime }] : null;
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
   * True when [start, end) lies inside a single opening window on the
   * venue-local day of `start`. No configured hours = unconstrained.
   */
  async isWithinOpeningHours(
    venueId: string,
    target: { resourceId?: string; resourceGroupId?: string },
    start: Date,
    end: Date,
    timezone: string,
  ): Promise<boolean> {
    const localStart = DateTime.fromJSDate(start, { zone: timezone });
    const windows = await this.openWindows(venueId, target, localStart);
    if (windows === null) return true;
    return windows.some((w) => {
      const open = this.at(localStart, w.openTime);
      const close = this.at(localStart, w.closeTime);
      return start >= open && end <= close;
    });
  }

  /** Wall-clock "HH:mm" on the same local day as `day`, as an instant. */
  at(day: DateTime, hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    return day.set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 }).toJSDate();
  }
}
