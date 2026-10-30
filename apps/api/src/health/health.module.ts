import { Module } from '@nestjs/common';
import { AdminSystemHealthController, HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController, AdminSystemHealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
