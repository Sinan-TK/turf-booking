import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  assertTransition,
  BOOKING_SESSION_TRANSITIONS,
  BOOKING_TRANSITIONS,
  SLOT_HOLD_TRANSITIONS,
} from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * The two scheduled sweeps ARCHITECTURE.md §16 calls for. Deliberately
 * separate from any future BullMQ-based notification queue (Phase 6/8) —
 * these are periodic sweeps, not per-item async jobs, so a simple cron is
 * the right tool rather than forcing everything through one queue.
 */
@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireBookingSessions() {
    const expired = await this.prisma.client.bookingSession.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      select: { id: true, status: true },
    });
    for (const session of expired) {
      assertTransition('BookingSession', BOOKING_SESSION_TRANSITIONS, session.status, 'EXPIRED');
      await this.prisma.client.bookingSession.update({
        where: { id: session.id, status: session.status },
        data: { status: 'EXPIRED' },
      });
    }
    if (expired.length > 0) this.logger.log(`Expired ${expired.length} booking session(s)`);
  }

  /**
   * The hold's own expiry, not the BookingSession's (§8/§9 step 2) — a
   * hold's holdExpiresAt is pushed out independently when payment starts,
   * so it can legitimately outlive its BookingSession. Cascades to the
   * ResourceLock rows (releasing the resource) and, if the booking never
   * got paid, cancels it.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireSlotHolds() {
    const expired = await this.prisma.client.slotHold.findMany({
      where: { status: 'HELD', holdExpiresAt: { lt: new Date() } },
      include: { booking: true },
    });

    for (const hold of expired) {
      assertTransition('SlotHold', SLOT_HOLD_TRANSITIONS, hold.status, 'EXPIRED');
      await this.prisma.client.$transaction(async (tx) => {
        await tx.slotHold.update({
          where: { id: hold.id, status: hold.status },
          data: { status: 'EXPIRED' },
        });
        await tx.resourceLock.updateMany({
          where: { slotHoldId: hold.id },
          data: { status: 'EXPIRED' },
        });
        // No-op for exclusive holds; releases pooled reservations so
        // expired kayak holds free their units (same keep-in-sync rule
        // as cancelAtomic and both confirm paths).
        await tx.inventoryReservation.updateMany({
          where: { slotHoldId: hold.id },
          data: { status: 'EXPIRED' },
        });

        if (hold.booking && hold.booking.status === 'PENDING_PAYMENT') {
          assertTransition('Booking', BOOKING_TRANSITIONS, hold.booking.status, 'CANCELLED');
          await tx.booking.update({
            where: { id: hold.booking.id, status: hold.booking.status },
            data: {
              status: 'CANCELLED',
              cancellationReasonCode: 'HOLD_EXPIRED',
              cancelledAt: new Date(),
            },
          });
        }
      });

      await this.audit.record({
        actor: 'SYSTEM',
        action: 'SLOT_HOLD_EXPIRED',
        entityType: 'SlotHold',
        entityId: hold.id,
        metadata: { bookingId: hold.booking?.id },
      });
    }
    if (expired.length > 0) this.logger.log(`Expired ${expired.length} slot hold(s)`);
  }
}
