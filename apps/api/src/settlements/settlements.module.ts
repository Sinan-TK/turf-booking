import { Module } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { PayoutsService } from './payouts.service';
import { AdminCommissionUsageController, AdminPayoutsController, OwnerPayoutsController } from './payouts.controller';

@Module({
  controllers: [AdminPayoutsController, AdminCommissionUsageController, OwnerPayoutsController],
  providers: [SettlementsService, PayoutsService],
  exports: [SettlementsService, PayoutsService],
})
export class SettlementsModule {}
