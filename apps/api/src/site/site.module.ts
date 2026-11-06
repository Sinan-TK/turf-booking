import { Global, Module } from '@nestjs/common';
import { AdminSiteController, PublicSiteController } from './site.controller';
import { SiteService } from './site.service';

/** Global so the customer sign-in can ask whether Google is switched on without importing this module. */
@Global()
@Module({
  controllers: [PublicSiteController, AdminSiteController],
  providers: [SiteService],
  exports: [SiteService],
})
export class SiteModule {}
