import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OwnerOrganizationsService } from './owner-organizations.service';
import { CreateOrganizationDto, CreateOwnerUserDto } from './dto/owner-organization.dto';
import type { AuthContext } from '../auth/auth.types';

// Super Admin only — this is platform-level provisioning of Venue Owner
// tenants, not something an owner can do for themselves.
@Controller('admin/organizations')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class OwnerOrganizationsController {
  constructor(private readonly orgs: OwnerOrganizationsService) {}

  @Post()
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() actor: AuthContext) {
    return this.orgs.createOrganization(dto, actor);
  }

  @Get()
  list() {
    return this.orgs.listOrganizations();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.orgs.getOrganization(id);
  }

  @Post(':id/owner-users')
  createOwnerUser(
    @Param('id') organizationId: string,
    @Body() dto: CreateOwnerUserDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.orgs.createOwnerUser(organizationId, dto, actor);
  }

  @Get(':id/owner-users')
  listOwnerUsers(@Param('id') organizationId: string) {
    return this.orgs.listOwnerUsers(organizationId);
  }
}
