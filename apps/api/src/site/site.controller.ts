import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { SiteService } from './site.service';

class GoogleSwitchDto extends createZodDto(z.object({ enabled: z.boolean() })) {}
class FeaturedDto extends createZodDto(z.object({ venueIds: z.array(z.string().uuid()).max(50) })) {}

/** What the public customer site reads without signing in: the switches that change what it shows, and the featured venues. */
@Controller('site')
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('config')
  config() {
    return this.site.publicConfig();
  }

  @Get('featured-venues')
  featured() {
    return this.site.featuredVenues();
  }
}

/** The Super Admin's controls for the public site. */
@Controller('admin/site')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSiteController {
  constructor(private readonly site: SiteService) {}

  @Get()
  view() {
    return this.site.adminView();
  }

  @Put('google')
  google(@Body() dto: GoogleSwitchDto, @CurrentUser() actor: AuthContext) {
    return this.site.setGoogleSignIn(dto.enabled, actor);
  }

  @Put('featured')
  featuredVenues(@Body() dto: FeaturedDto, @CurrentUser() actor: AuthContext) {
    return this.site.setFeatured(dto.venueIds, actor);
  }
}
