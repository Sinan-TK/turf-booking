import { Module } from '@nestjs/common';
import { SavedVenuesService } from './saved-venues.service';
import { SavedVenuesController } from './saved-venues.controller';

@Module({
  controllers: [SavedVenuesController],
  providers: [SavedVenuesService],
  exports: [SavedVenuesService],
})
export class SavedVenuesModule {}
