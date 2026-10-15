import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import type { AuthContext } from '../auth/auth.types';

@Controller('admin/dashboard')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboard.summary();
  }
}

@Controller('owner/dashboard')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
export class OwnerDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() actor: AuthContext) {
    return this.dashboard.ownerSummary(actor.organizationId!);
  }
}
