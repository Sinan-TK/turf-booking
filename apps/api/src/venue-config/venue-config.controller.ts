import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VenueConfigService } from './venue-config.service';
import { CreateBlockedDateDto, CreatePricingRuleDto, UpsertOperatingHoursDto } from './dto/venue-config.dto';
import type { AuthContext } from '../auth/auth.types';

// Owner/Admin only — this is "how bookable is my venue" configuration,
// never customer-facing (customers only ever see the resolved output,
// via /search and the booking-hold price snapshot).
@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
export class VenueConfigController {
  constructor(private readonly config: VenueConfigService) {}

  @Post('resources/pricing-rules')
  createPricingRule(@Body() dto: CreatePricingRuleDto, @CurrentUser() actor: AuthContext) {
    return this.config.createPricingRule(dto, actor);
  }

  @Get('resources/pricing-rules')
  listPricingRules(
    @CurrentUser() actor: AuthContext,
    @Query('resourceId') resourceId?: string,
    @Query('resourceGroupId') resourceGroupId?: string,
  ) {
    return this.config.listPricingRules(actor, resourceId, resourceGroupId);
  }

  // Deliberately NOT under /venues/... — VenuesController's GET /venues/:id
  // would otherwise swallow a literal path segment like
  // /venues/operating-hours (Nest/Express match :id greedily against
  // whatever the next module happens to register second), which is
  // exactly what happened here before this module got its own prefix —
  // confirmed live as a 500 ("invalid UUID: operating-hours") rather than
  // assumed.
  @Put('venue-config/operating-hours')
  upsertOperatingHours(@Body() dto: UpsertOperatingHoursDto, @CurrentUser() actor: AuthContext) {
    return this.config.upsertOperatingHours(dto, actor);
  }

  @Get('venue-config/operating-hours')
  listOperatingHours(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.config.listOperatingHours(venueId, actor);
  }

  @Post('venue-config/blocked-dates')
  createBlockedDate(@Body() dto: CreateBlockedDateDto, @CurrentUser() actor: AuthContext) {
    return this.config.createBlockedDate(dto, actor);
  }

  @Get('venue-config/blocked-dates')
  listBlockedDates(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.config.listBlockedDates(venueId, actor);
  }

  @Delete('venue-config/blocked-dates/:id')
  deleteBlockedDate(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    return this.config.deleteBlockedDate(id, actor);
  }
}
