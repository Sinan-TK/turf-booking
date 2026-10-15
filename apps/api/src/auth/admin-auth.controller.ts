import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';

// Login/refresh/logout/password flows live in StaffAuthController
// (POST /auth/admin/*). All that's left here is confirming who the
// verified session belongs to.
@Controller('auth/admin')
export class AdminAuthController {
  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  me(@CurrentUser() user: AuthContext) {
    return user;
  }
}
