import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseEnumFilter, parseSearch } from '../common/list-filters';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OwnerOrganizationsService } from './owner-organizations.service';
import { CreateOrganizationDto, CreateOwnerUserDto, SetOrganizationStatusDto, SetOwnerUserStatusDto } from './dto/owner-organization.dto';
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
    return this.orgs.getOrganizationDetail(id);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetOrganizationStatusDto, @CurrentUser() actor: AuthContext) {
    return this.orgs.setStatus(id, dto.status, dto.reason, actor);
  }

  @Patch(':id/owner-users/:userId/status')
  setOwnerUserStatus(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetOwnerUserStatusDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.orgs.setOwnerUserStatus(id, userId, dto.status, dto.reason, actor);
  }

  @Post(':id/owner-users')
  createOwnerUser(
    @Param('id') organizationId: string,
    @Body() dto: CreateOwnerUserDto,
    @CurrentUser() actor: AuthContext,
  ) {
    return this.orgs.createOwnerUser(organizationId, dto, actor);
  }

  // ?search= (name or email), ?role=, ?status=, ?limit=&offset=; the match count is in X-Total-Count.
  @Get(':id/owner-users')
  async listOwnerUsers(
    @Param('id') organizationId: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const { rows, total } = await this.orgs.listOwnerUsers(organizationId, {
      search: parseSearch(search),
      role: parseEnumFilter(role, ['OWNER_ADMIN', 'OWNER_STAFF'] as const, 'role'),
      status: parseEnumFilter(status, ['ACTIVE', 'DISABLED'] as const, 'status'),
      ...parsePage(limit, offset),
    });
    if (res) setTotalCount(res, total);
    return rows;
  }
}
