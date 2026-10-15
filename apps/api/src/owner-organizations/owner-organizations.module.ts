import { Module } from '@nestjs/common';
import { OwnerOrganizationsService } from './owner-organizations.service';
import { OwnerOrganizationsController } from './owner-organizations.controller';

@Module({
  controllers: [OwnerOrganizationsController],
  providers: [OwnerOrganizationsService],
  exports: [OwnerOrganizationsService],
})
export class OwnerOrganizationsModule {}
