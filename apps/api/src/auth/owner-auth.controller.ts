import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import { Role } from '@venue/shared';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
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
  async me(@CurrentUser() user: AuthContext) {
    const assigned = await this.scope.assignedVenueIds(user);
    const [profile, venues] = await Promise.all([
      this.prisma.client.venueOwnerUser.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
      this.prisma.client.venue.findMany({
        where: { organizationId: user.organizationId, ...(assigned ? { id: { in: assigned } } : {}) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, facilityCode: true, status: true },
      }),
    ]);
    return { ...user, name: profile?.name ?? null, email: profile?.email ?? null, venues };
  }
}
