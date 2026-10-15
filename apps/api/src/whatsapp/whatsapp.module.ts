import { Module } from '@nestjs/common';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMenuService } from './whatsapp-menu.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppClientModule } from './whatsapp-client.module';
import { CustomersModule } from '../customers/customers.module';
import { SavedVenuesModule } from '../saved-venues/saved-venues.module';
import { BookingSessionsModule } from '../booking-sessions/booking-sessions.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PoliciesModule } from '../policies/policies.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [
    WhatsAppClientModule,
    CustomersModule,
    SavedVenuesModule,
    BookingSessionsModule,
    BookingsModule,
    PoliciesModule,
    SupportModule,
  ],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppSessionService, WhatsAppMenuService, WhatsAppWebhookService],
})
export class WhatsAppModule {}
