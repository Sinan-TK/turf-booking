import { Module } from '@nestjs/common';
import { AdminBannersController, PublicBannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
  controllers: [PublicBannersController, AdminBannersController],
  providers: [BannersService],
})
export class BannersModule {}
