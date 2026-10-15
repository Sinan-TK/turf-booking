import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LocationsService } from './locations.service';
import {
  CreateAreaDto,
  CreateCountryDto,
  CreateDistrictDto,
  CreateStateDto,
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
  createState(@Body() dto: CreateStateDto) {
    return this.locations.createState(dto);
  }

  @Get('states')
  listStates(@Query('countryId') countryId?: string) {
    return this.locations.listStates(countryId);
  }

  @Post('admin/districts')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createDistrict(@Body() dto: CreateDistrictDto) {
    return this.locations.createDistrict(dto);
  }

  @Get('districts')
  listDistricts(@Query('stateId') stateId?: string) {
    return this.locations.listDistricts(stateId);
  }

  @Post('admin/areas')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createArea(@Body() dto: CreateAreaDto) {
    return this.locations.createArea(dto);
  }

  @Get('areas')
  listAreas(@Query('districtId') districtId?: string) {
    return this.locations.listAreas(districtId);
  }
}
