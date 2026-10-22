import { Module } from '@nestjs/common';
import { WhatsAppClientService } from './whatsapp-client.service';

/**
 * The outbound WhatsApp sender (login code, booking confirmation). A narrow module so BookingsService,
 * PaymentsService and CoinsService can send notifications without depending on anything else.
 */
@Module({
  providers: [WhatsAppClientService],
  exports: [WhatsAppClientService],
})
export class WhatsAppClientModule {}
