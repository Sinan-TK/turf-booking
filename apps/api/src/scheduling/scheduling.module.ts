import { Module } from '@nestjs/common';
import { PolicyResolverService } from './policy-resolver.service';
import { ScheduleService } from './schedule.service';

@Module({
  providers: [PolicyResolverService, ScheduleService],
  exports: [PolicyResolverService, ScheduleService],
})
export class SchedulingModule {}
