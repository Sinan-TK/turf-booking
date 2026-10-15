import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import type { CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { WhatsAppClientService } from './whatsapp-client.service';

/** WhatsApp implementation of the CustomerMessenger port. */
@Injectable()
export class WhatsAppCustomerMessenger implements CustomerMessenger {
  private readonly logger = new Logger(WhatsAppCustomerMessenger.name);

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

  async loginCode(toPhone: string, code: string): Promise<void> {
    const env = loadEnv();
    if (env.AUTH_OTP_DELIVERY === 'log') {
      // Development only (production refuses to start with this setting).
      this.logger.warn(`[DEV ONLY] login code for ${toPhone}: ${code}`);
      return;
    }
    if (env.WHATSAPP_OTP_TEMPLATE) {
      return this.whatsapp.sendTemplate(toPhone, env.WHATSAPP_OTP_TEMPLATE, 'en', [code]);
    }
    return this.whatsapp.sendText(
      toPhone,
      `Your Venue Booking login code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Do not share it.`,
    );
  }
}
