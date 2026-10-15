import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VenuesService } from './venues.service';
import { CreateVenueDto, UpdateVenueDto } from './dto/venue.dto';
import type { AuthContext } from '../auth/auth.types';

@Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  create(@Body() dto: CreateVenueDto, @CurrentUser() actor: AuthContext) {
    return this.venues.create(dto, actor);
  }

  @Get('mine')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  listMine(@CurrentUser() actor: AuthContext) {
    return this.venues.listMine(actor);
  }

  @Get(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  getById(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    return this.venues.getById(id, actor);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.VENUE_OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateVenueDto, @CurrentUser() actor: AuthContext) {
    return this.venues.update(id, dto, actor);
  }

  // Public — no guard. The "Enter Venue Code" customer flow
  // (ARCHITECTURE.md §6.6): normalizes input, exact-match lookup,
  // active-only.
  @Get('by-code/:facilityCode')
  findByCode(@Param('facilityCode') facilityCode: string) {
    return this.venues.findActiveByFacilityCode(facilityCode);
  }
}
