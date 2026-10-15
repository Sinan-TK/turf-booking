import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import { AVAILABILITY_REPOSITORY } from './availability.repository';
import { PrismaAvailabilityRepository } from './prisma-availability.repository';
import { ResourcesModule } from '../resources/resources.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [ResourcesModule, SchedulingModule],
  controllers: [AvailabilityController],
  providers: [
    AvailabilityService,
    PrismaAvailabilityRepository,
    { provide: AVAILABILITY_REPOSITORY, useClass: PrismaAvailabilityRepository },
  ],
  exports: [AvailabilityService, AVAILABILITY_REPOSITORY],
})
export class AvailabilityModule {}
