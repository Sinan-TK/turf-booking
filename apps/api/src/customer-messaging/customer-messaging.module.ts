import { Module } from '@nestjs/common';
import { WhatsAppClientModule } from '../whatsapp/whatsapp-client.module';
import { WhatsAppCustomerMessenger } from '../whatsapp/whatsapp-customer-messenger';
import { CUSTOMER_MESSENGER } from './customer-messenger.port';

/** Wires the port to its WhatsApp adapter. Domain modules import this, never WhatsApp. */
@Module({
  imports: [WhatsAppClientModule],
  providers: [
    WhatsAppCustomerMessenger,
    { provide: CUSTOMER_MESSENGER, useExisting: WhatsAppCustomerMessenger },
  ],
  exports: [CUSTOMER_MESSENGER],
})
export class CustomerMessagingModule {}
