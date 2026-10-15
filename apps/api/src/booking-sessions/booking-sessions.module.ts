import { Module } from '@nestjs/common';
import { BookingSessionsService } from './booking-sessions.service';
import { BookingSessionsController } from './booking-sessions.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [BookingSessionsController],
  providers: [BookingSessionsService],
  exports: [BookingSessionsService],
})
export class BookingSessionsModule {}
