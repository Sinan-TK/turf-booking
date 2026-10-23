import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CommercialTermsService } from './commercial-terms.service';

/**
 * Commercial terms are edited by the Super Admin only. Bodies are validated in the service against the shared
 * zod schemas (packages/shared/src/commercial.ts), which also check the merged result.
 */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminCommercialTermsController {
  constructor(private readonly terms: CommercialTermsService) {}

  @Get('commercial-terms/default')
  getDefault() {
    return this.terms.getDefault();
  }

  @Put('commercial-terms/default')
  putDefault(@Body() body: unknown, @CurrentUser() actor: AuthContext) {
    return this.terms.putDefault(body, actor);
  }

  @Get('categories/:id/commercial-terms')
  getFacility(@Param('id', ParseUUIDPipe) id: string) {
    return this.terms.getFacility(id);
  }

  @Put('categories/:id/commercial-terms')
  putFacility(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() actor: AuthContext) {
    return this.terms.putFacility(id, body, actor);
  }

  @Get('venues/:venueId/commercial-terms')
  listForVenue(@Param('venueId', ParseUUIDPipe) venueId: string) {
    return this.terms.listForVenue(venueId);
  }

  @Put('venues/:venueId/facilities/:categoryId/commercial-terms')
  putVenueFacility(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.terms.putVenueFacility(venueId, categoryId, body, actor);
  }

  @Delete('venues/:venueId/facilities/:categoryId/commercial-terms')
  deleteVenueFacility(
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.terms.deleteVenueFacility(venueId, categoryId, actor);
  }
}

/** The owner's read-only view of the terms their venue runs on. */
@Controller('owner')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN') // money terms are not a staff member's
export class OwnerCommercialTermsController {
  constructor(private readonly terms: CommercialTermsService) {}

  @Get('commercial-terms')
  list(@Query('venueId', ParseUUIDPipe) venueId: string, @CurrentUser() actor: AuthContext) {
    return this.terms.listForOwner(venueId, actor);
  }
}
