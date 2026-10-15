import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ExpiryService } from './expiry.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ExpiryService],
})
export class JobsModule {}
