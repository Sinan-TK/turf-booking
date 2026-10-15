import { Module } from '@nestjs/common';
import { VenueCategoriesService } from './venue-categories.service';
import { AdminCategoriesController, PublicCategoriesController } from './venue-categories.controller';

@Module({
  controllers: [PublicCategoriesController, AdminCategoriesController],
  providers: [VenueCategoriesService],
  exports: [VenueCategoriesService],
})
export class VenueCategoriesModule {}
