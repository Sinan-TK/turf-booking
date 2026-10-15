import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { FacilityCodeService } from './facility-code.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService, FacilityCodeService],
  exports: [LocationsService, FacilityCodeService],
})
export class LocationsModule {}
