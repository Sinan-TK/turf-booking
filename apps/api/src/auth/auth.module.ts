import { Global, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { OwnerAuthController } from './owner-auth.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { CustomerSessionService } from './customer-session.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { IdentityModule } from '../identity/identity.module';

/**
 * @Global so AuthGuard/CustomerSessionService/IdentityService are
 * available to every other module without each having to re-import
 * AuthModule or IdentityModule directly.
 */
@Global()
@Module({
  imports: [IdentityModule],
  controllers: [AdminAuthController, OwnerAuthController, StaffAuthController],
  providers: [CustomerSessionService, StaffAuthService, AuthGuard, RolesGuard],
  exports: [CustomerSessionService, AuthGuard, RolesGuard, IdentityModule],
})
export class AuthModule {}
