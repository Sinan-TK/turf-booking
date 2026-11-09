import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PayoutStatus, SettlementKind } from '@venue/database';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnerRoles } from '../auth/decorators/owner-roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { parsePage, setTotalCount } from '../common/pagination';
import { parseDateRange, parseEnumFilter, parseSearch } from '../common/list-filters';
import { PayoutsService } from './payouts.service';
import { SettlementsService } from './settlements.service';

class MarkPaidDto extends createZodDto(
  z.object({
    reference: z.string().trim().min(3, 'Enter the bank transfer reference.').max(100),
    // The amount the admin reviewed and transferred. If the payout has changed since (a late settlement joined it), paying is refused.
    totalOwnerAmount: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  }),
) {}

class RunDto extends createZodDto(
  z.object({
    /** Run as of this moment instead of now (prepare a past or coming week). */
    asOf: z.string().datetime().optional(),
  }),
) {}

@Controller('admin/payouts')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly settlements: SettlementsService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('organizationId') organizationId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // "OVERDUE" is the admin's view of an Initiated payout that has waited too long; it is not stored.
    const overdue = status === 'OVERDUE';
    const filters = {
      status: overdue ? undefined : (parseEnumFilter(status, Object.values(PayoutStatus), 'status') as PayoutStatus | undefined),
      overdue,
      organizationId,
    };
    const [rows, total] = await Promise.all([
      this.payouts.listForAdmin({ ...filters, ...parsePage(limit, offset) }),
      this.payouts.countForAdmin(filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  // Platform totals: coins outstanding, this month's earnings, payouts waiting.
  @Get('summary')
  summary() {
    return this.payouts.platformSummary();
  }

  /** Settle ended bookings and prepare the due payouts now, instead of waiting for the scheduled runs. */
  @Post('run')
  async run(@Body() dto: RunDto) {
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('asOf must be a valid time');
    const settled = await this.settlements.completeAndSettle(new Date(Math.min(asOf.getTime(), Date.now())));
    const payouts = await this.payouts.createDuePayouts(asOf);
    return { ...settled, payouts: payouts.length };
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.getForAdmin(id);
  }

  @Post(':id/mark-paid')
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto, @CurrentUser() actor: AuthContext) {
    return this.payouts.markPaid(id, dto.reference, actor, dto.totalOwnerAmount);
  }
}

/** Super Admin: how much of each facility's monthly commission cap a venue has used this month. */
@Controller('admin/venues')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminCommissionUsageController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get(':venueId/commission-month')
  usage(@Param('venueId', ParseUUIDPipe) venueId: string) {
    return this.payouts.usageForVenue(venueId);
  }
}

@Controller('owner')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
@OwnerRoles('OWNER_ADMIN') // money pages are not a staff member's
export class OwnerPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('earnings')
  earnings(@CurrentUser() actor: AuthContext) {
    return this.payouts.earningsForOwner(actor.organizationId!);
  }

  // What was earned in a period (?from=&to=), in total, by venue and by facility.
  @Get('earnings/breakdown')
  breakdown(@CurrentUser() actor: AuthContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.payouts.earningsBreakdown(actor.organizationId!, parseDateRange(from, to));
  }

  // The bookings behind the earnings, filterable and paged (the total is in X-Total-Count).
  @Get('earnings/settlements')
  async settlements(
    @CurrentUser() actor: AuthContext,
    @Query('search') search?: string,
    @Query('venueId', new ParseUUIDPipe({ optional: true })) venueId?: string,
    @Query('categoryId', new ParseUUIDPipe({ optional: true })) categoryId?: string,
    @Query('kind') kind?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const filters = {
      search: parseSearch(search),
      venueId,
      categoryId,
      kind: parseEnumFilter(kind, Object.values(SettlementKind), 'kind') as SettlementKind | undefined,
      range: parseDateRange(from, to),
    };
    const org = actor.organizationId!;
    const [rows, total] = await Promise.all([
      this.payouts.listSettlementsForOwner(org, { ...filters, ...parsePage(limit, offset) }),
      this.payouts.countSettlementsForOwner(org, filters),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get('payouts')
  async list(
    @CurrentUser() actor: AuthContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const [rows, total] = await Promise.all([
      this.payouts.listForOwner(actor.organizationId!, parsePage(limit, offset)),
      this.payouts.countForOwner(actor.organizationId!),
    ]);
    if (res) setTotalCount(res, total);
    return rows;
  }

  @Get('payouts/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthContext) {
    return this.payouts.getForOwner(id, actor.organizationId!);
  }
}
