import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController, OwnerDashboardController } from './dashboard.controller';

@Module({
  controllers: [DashboardController, OwnerDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
