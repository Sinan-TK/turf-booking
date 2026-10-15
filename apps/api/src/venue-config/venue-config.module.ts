import { Module } from '@nestjs/common';
import { VenueConfigService } from './venue-config.service';
import { VenueConfigController } from './venue-config.controller';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [SchedulingModule],
  controllers: [VenueConfigController],
  providers: [VenueConfigService],
  exports: [VenueConfigService],
})
export class VenueConfigModule {}
