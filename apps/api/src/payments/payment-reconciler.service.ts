import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

/**
 * The safety net behind the webhook. Every minute it looks at bookings in the PROCESSING window and at payments and wallet recharges
 * that were started but never reported complete, asks the gateway what really happened, and settles them the same way the webhook
 * would. A webhook that never comes (wrong URL or secret, an outage) therefore delays a confirmation by a minute instead of losing it.
 */
@Injectable()
export class PaymentReconcilerService {
  private readonly logger = new Logger(PaymentReconcilerService.name);
  private running = false;

  constructor(private readonly payments: PaymentsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    if (this.running) return; // a slow gateway must not pile runs up
    this.running = true;
    try {
      const processing = await this.payments.reconcileProcessing();
      const stale = await this.payments.reconcileStale();
      if (processing.confirmed || processing.failed || stale.settled || stale.closed) {
        this.logger.log(`Reconciled: ${processing.confirmed} confirmed, ${processing.failed} failed, ${stale.settled} settled late, ${stale.closed} closed`);
      }
    } catch (error) {
      this.logger.error(`Payment reconciliation failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
