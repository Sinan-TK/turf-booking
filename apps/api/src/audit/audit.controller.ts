import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditActorType } from '@venue/database';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseDateRange, parseEnumFilter, parseSearch } from '../common/list-filters';
import { AuditService } from './audit.service';

/** The Super Admin's audit log: who did what, to what, and when. Read only; entries are written by the services themselves. */
@Controller('admin/audit-logs')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('actorType') actorType?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const filters = {
      q: parseSearch(search),
      actorType: parseEnumFilter(actorType, Object.values(AuditActorType), 'actorType') as AuditActorType | undefined,
      entityType: parseSearch(entityType),
      action: parseSearch(action),
      range: parseDateRange(from, to),
    };
    const [rows, total] = await Promise.all([this.audit.list({ ...filters, ...parsePage(limit, offset) }), this.audit.count(filters)]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  // The kinds of thing and the actions that appear in the log, for the page's filters.
  @Get('facets')
  facets() {
    return this.audit.facets();
  }
}

/**
 * An owner's own audit log: what their people did, and what was done to their venues, bookings, payouts and logins. Only the owner
 * admin; staff do not see it. Other organisations' entries, and platform-only entries, never appear.
 */
@Controller('owner/audit-log')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN')
export class OwnerAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @CurrentUser() actor: AuthContext,
    @Query('search') search?: string,
    @Query('actorType') actorType?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const filters = {
      q: parseSearch(search),
      actorType: parseEnumFilter(actorType, Object.values(AuditActorType), 'actorType') as AuditActorType | undefined,
      entityType: parseSearch(entityType),
      action: parseSearch(action),
      range: parseDateRange(from, to),
    };
    const org = actor.organizationId!;
    const [rows, total] = await Promise.all([
      this.audit.listForOrganization(org, { ...filters, ...parsePage(limit, offset) }),
      this.audit.countForOrganization(org, filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get('facets')
  facets(@CurrentUser() actor: AuthContext) {
    return this.audit.facetsForOrganization(actor.organizationId!);
  }
}
