import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Public probe for load balancers and uptime monitors. 200 when the database answers, 503 when it does not. */
  @Get()
  async check() {
    try {
      return await this.health.check();
    } catch {
      throw new ServiceUnavailableException({ status: 'down', timestamp: new Date().toISOString() });
    }
  }
}

/** The Super Admin's system status page: per-part checks, how long each took, and the uptime. Safe details only (see HealthService). */
@Controller('admin/system/health')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminSystemHealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async details() {
    return this.health.details();
  }
}
