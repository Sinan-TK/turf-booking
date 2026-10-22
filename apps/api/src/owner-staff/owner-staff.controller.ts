import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { OwnerStaffService } from './owner-staff.service';
import { InviteStaffDto, SetStaffStatusDto, SetStaffVenuesDto } from './dto/owner-staff.dto';

@Controller('owner/staff')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN')
export class OwnerStaffController {
  constructor(private readonly staff: OwnerStaffService) {}

  @Get()
  list(@CurrentUser() actor: AuthContext) {
    return this.staff.list(actor);
  }

  @Post()
  invite(@Body() dto: InviteStaffDto, @CurrentUser() actor: AuthContext) {
    return this.staff.invite(dto, actor);
  }

  @Patch(':id/venues')
  setVenues(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffVenuesDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.staff.setVenues(id, dto.venueIds, actor);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStaffStatusDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.staff.setStatus(id, dto.status, actor);
  }
}
