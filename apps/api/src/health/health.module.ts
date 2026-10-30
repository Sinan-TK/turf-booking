import { Module } from '@nestjs/common';
import { AdminSystemHealthController, HealthController } from './health.controller';
import { CspReportController } from './csp-report.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController, AdminSystemHealthController, CspReportController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
