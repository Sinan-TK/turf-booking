import { Module } from '@nestjs/common';
import { WhatsAppClientService } from './whatsapp-client.service';

/**
 * Deliberately separate from WhatsAppModule (which also wires up the
 * menu state machine and webhook, and therefore depends on
 * Bookings/BookingSessions/Support). BookingsService, PaymentsService,
 * and CoinsService all need to send outbound notifications, so they
 * import this narrow module instead of the full one — importing
 * WhatsAppModule from any of them would be circular (it depends on
 * BookingsModule itself).
 */
@Module({
  providers: [WhatsAppClientService],
  exports: [WhatsAppClientService],
})
export class WhatsAppClientModule {}
