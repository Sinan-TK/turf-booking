import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResourcesService } from './resources.service';
import {
  CreateCompositionDto,
  CreateResourceDto,
  CreateResourceGroupDto,
  SetFacilityBookableDto,
  SetResourceBookableDto,
} from './dto/resource.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('resources')
@UseGuards(AuthGuard, RolesGuard)
// Units are the owner admin's to manage; staff may only read the units of their assigned venues.
@OwnerRoles('OWNER_ADMIN')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  create(@Body() dto: CreateResourceDto, @CurrentUser() actor: AuthContext) {
    return this.resources.create(dto, actor);
  }

  // Declared before ':id' so "facility-bookable" is never read as an id.
  @Patch('facility-bookable')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  setFacilityBookable(@Body() dto: SetFacilityBookableDto, @CurrentUser() actor: AuthContext) {
    return this.resources.setFacilityBookable(dto, actor);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  setBookable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResourceBookableDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.resources.setBookable(id, dto.isBookable, actor);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @OwnerRoles('OWNER_ADMIN', 'OWNER_STAFF')
  list(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.resources.listForVenue(venueId, actor);
  }

  @Post('compositions')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  addComposition(@Body() dto: CreateCompositionDto, @CurrentUser() actor: AuthContext) {
    return this.resources.addComposition(dto, actor);
  }

  // P2 pooled inventory pools (kayak fleets) — same owner/admin-only
  // guard as resources; customers only ever see resolved availability
  // via the booking-hold price snapshot and group-availability read.
  @Post('groups')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  createGroup(@Body() dto: CreateResourceGroupDto, @CurrentUser() actor: AuthContext) {
    return this.resources.createGroup(dto, actor);
  }

  @Get('groups')
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  @OwnerRoles('OWNER_ADMIN', 'OWNER_STAFF')
  listGroups(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.resources.listGroupsForVenue(venueId, actor);
  }
}
