import { Module } from '@nestjs/common';
import { OwnerStaffController } from './owner-staff.controller';
import { OwnerStaffService } from './owner-staff.service';

@Module({
  controllers: [OwnerStaffController],
  providers: [OwnerStaffService],
})
export class OwnerStaffModule {}
