import { Module } from '@nestjs/common';
import { OwnerOrganizationsService } from './owner-organizations.service';
import { OwnerOrganizationsController } from './owner-organizations.controller';
import { OwnerRegistrationController } from './owner-registration.controller';
import { OwnerRegistrationService } from './owner-registration.service';

@Module({
  controllers: [OwnerOrganizationsController, OwnerRegistrationController],
  providers: [OwnerOrganizationsService, OwnerRegistrationService],
  exports: [OwnerOrganizationsService],
})
export class OwnerOrganizationsModule {}
