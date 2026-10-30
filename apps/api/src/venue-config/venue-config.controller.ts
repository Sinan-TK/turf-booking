import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VenueConfigService } from './venue-config.service';
import { CreateBlockedDateDto, CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/venue-config.dto';
import type { AuthContext } from '../auth/auth.types';

// Owner/Admin only — this is "how bookable is my venue" configuration,
// never customer-facing (customers only ever see the resolved output,
// via /search and the booking-hold price snapshot).
@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN') // prices and closed days are not a staff member's
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

  @Patch('resources/pricing-rules/:id')
  updatePricingRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePricingRuleDto, @CurrentUser() actor: AuthContext) {
    return this.config.updatePricingRule(id, dto, actor);
  }

  @Delete('resources/pricing-rules/:id')
  deletePricingRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.config.deletePricingRule(id, actor);
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
  deleteBlockedDate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.config.deleteBlockedDate(id, actor);
  }
}
