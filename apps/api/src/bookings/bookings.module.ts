import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { AdminBookingsController, BookingsController, OwnerBookingsController } from './bookings.controller';
import { BOOKINGS_REPOSITORY } from './bookings.repository';
import { PrismaBookingsRepository } from './prisma-bookings.repository';
import { ResourcesModule } from '../resources/resources.module';
import { PoliciesModule } from '../policies/policies.module';
import { CoinsModule } from '../coins/coins.module';
import { WhatsAppClientModule } from '../whatsapp/whatsapp-client.module';
import { CustomersModule } from '../customers/customers.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [
    ResourcesModule,
    PoliciesModule,
    CoinsModule,
    WhatsAppClientModule,
    CustomersModule,
    SchedulingModule,
  ],
  controllers: [BookingsController, AdminBookingsController, OwnerBookingsController],
  providers: [
    BookingsService,
    PrismaBookingsRepository,
    { provide: BOOKINGS_REPOSITORY, useClass: PrismaBookingsRepository },
  ],
  exports: [BookingsService, BOOKINGS_REPOSITORY],
})
export class BookingsModule {}
