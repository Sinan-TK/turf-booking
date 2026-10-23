import { Module } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { PayoutsService } from './payouts.service';
import { AdminPayoutsController, OwnerPayoutsController } from './payouts.controller';

@Module({
  controllers: [AdminPayoutsController, OwnerPayoutsController],
  providers: [SettlementsService, PayoutsService],
  exports: [SettlementsService, PayoutsService],
})
export class SettlementsModule {}
