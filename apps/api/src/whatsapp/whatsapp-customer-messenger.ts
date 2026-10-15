import { Injectable } from '@nestjs/common';
import type { CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { WhatsAppClientService } from './whatsapp-client.service';

/** WhatsApp implementation of the CustomerMessenger port. */
@Injectable()
export class WhatsAppCustomerMessenger implements CustomerMessenger {
  constructor(private readonly whatsapp: WhatsAppClientService) {}

  bookingConfirmed(toPhone: string, orderId: string): Promise<void> {
    return this.whatsapp.sendText(
      toPhone,
      `✅ Payment received! Booking ${orderId} is confirmed. See you on the venue!`,
    );
  }

  bookingCancelled(toPhone: string, orderId: string, coinsCredited?: string): Promise<void> {
    const refundLine = coinsCredited ? `\n🪙 ${coinsCredited} Coins credited.` : '';
    return this.whatsapp.sendText(toPhone, `✅ Booking ${orderId} cancelled.${refundLine}`);
  }
}
