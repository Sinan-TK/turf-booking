import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { LocationsService } from './locations.service';
import {
  CreateAreaDto,
  CreateCountryDto,
  CreateDistrictDto,
  CreateStateDto,
  UpdateAreaDto,
  UpdateDistrictDto,
  UpdateStateDto,
} from './dto/location.dto';

/**
 * Reads are public (no guard): the web app needs districts/areas for the
 * "Select District" search filter before/without a customer being
 * authenticated. Writes are Super Admin only — location/district-code
 * master data is platform-wide configuration (ARCHITECTURE.md §13).
 */
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('admin/countries')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createCountry(@Body() dto: CreateCountryDto) {
    return this.locations.createCountry(dto);
  }

  @Get('countries')
  listCountries() {
    return this.locations.listCountries();
  }

  @Post('admin/states')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createState(@Body() dto: CreateStateDto, @CurrentUser() actor: AuthContext) {
    return this.locations.createState(dto, actor);
  }

  @Get('admin/states')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  listStatesAdmin(@Query('countryId') countryId?: string) {
    return this.locations.listStatesAdmin(countryId);
  }

  @Patch('admin/states/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  updateState(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStateDto, @CurrentUser() actor: AuthContext) {
    return this.locations.updateState(id, dto, actor);
  }

  @Get('states')
  listStates(@Query('countryId') countryId?: string) {
    return this.locations.listStates(countryId);
  }

  @Post('admin/districts')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createDistrict(@Body() dto: CreateDistrictDto, @CurrentUser() actor: AuthContext) {
    return this.locations.createDistrict(dto, actor);
  }

  @Get('admin/districts')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  listDistrictsAdmin(@Query('stateId') stateId?: string) {
    return this.locations.listDistrictsAdmin(stateId);
  }

  @Patch('admin/districts/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  updateDistrict(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDistrictDto, @CurrentUser() actor: AuthContext) {
    return this.locations.updateDistrict(id, dto, actor);
  }

  @Get('districts')
  listDistricts(@Query('stateId') stateId?: string) {
    return this.locations.listDistricts(stateId);
  }

  @Post('admin/areas')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createArea(@Body() dto: CreateAreaDto, @CurrentUser() actor: AuthContext) {
    return this.locations.createArea(dto, actor);
  }

  @Get('admin/areas')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  listAreasAdmin(@Query('districtId') districtId?: string) {
    return this.locations.listAreasAdmin(districtId);
  }

  @Patch('admin/areas/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  updateArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAreaDto, @CurrentUser() actor: AuthContext) {
    return this.locations.updateArea(id, dto, actor);
  }

  /** Every active area with its district and state, for the customer's location picker. */
  @Get('places')
  listPlaces() {
    return this.locations.listPlaces();
  }

  @Get('areas')
  listAreas(@Query('districtId') districtId?: string) {
    return this.locations.listAreas(districtId);
  }
}
