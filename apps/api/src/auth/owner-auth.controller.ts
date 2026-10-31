import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import { Role } from '@venue/shared';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AllowPendingOwner, Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';

// Login/refresh/logout/password flows live in StaffAuthController
// (POST /auth/owner/*). All that's left here is confirming who the
// verified session belongs to.
@Controller('auth/owner')
export class OwnerAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OwnerScopeService,
  ) {}

  /** Who the session belongs to, and which venues they may work in (all of the organization's for an owner admin). */
  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.VENUE_OWNER)
  @AllowPendingOwner()
  async me(@CurrentUser() user: AuthContext) {
    const assigned = await this.scope.assignedVenueIds(user);
    const [profile, venues] = await Promise.all([
      this.prisma.client.venueOwnerUser.findUnique({ where: { id: user.id }, select: { name: true, email: true, organization: { select: { name: true, status: true } } } }),
      this.prisma.client.venue.findMany({
        where: { organizationId: user.organizationId, ...(assigned ? { id: { in: assigned } } : {}) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, facilityCode: true, status: true },
      }),
    ]);
    // organizationStatus is PENDING_APPROVAL for a sign-up not yet approved: the portal then shows only a "waiting" page.
    return {
      ...user,
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      organizationName: profile?.organization.name ?? null,
      organizationStatus: profile?.organization.status ?? 'ACTIVE',
      venues,
    };
  }
}
