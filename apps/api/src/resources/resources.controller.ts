import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResourcesService } from './resources.service';
import { CreateCompositionDto, CreateResourceDto, CreateResourceGroupDto } from './dto/resource.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('resources')
@UseGuards(AuthGuard, RolesGuard)
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  create(@Body() dto: CreateResourceDto, @CurrentUser() actor: AuthContext) {
    return this.resources.create(dto, actor);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
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
  listGroups(@Query('venueId') venueId: string, @CurrentUser() actor: AuthContext) {
    return this.resources.listGroupsForVenue(venueId, actor);
  }
}
