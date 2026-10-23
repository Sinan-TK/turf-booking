import { Global, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { OwnerAuthController } from './owner-auth.controller';
import { StaffAuthController } from './staff-auth.controller';
import { CustomerAuthController } from './customer-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { CustomerSessionService } from './customer-session.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { IdentityModule } from '../identity/identity.module';
import { CustomersModule } from '../customers/customers.module';
import { CustomerMessagingModule } from '../customer-messaging/customer-messaging.module';
import { CustomerOtpService } from './customer-otp.service';
import { CustomerPasswordService } from './customer-password.service';
import { ConfiguredGoogleTokenVerifier, GOOGLE_TOKEN_VERIFIER } from './google-token-verifier';

/**
 * @Global so AuthGuard/CustomerSessionService/IdentityService are
 * available to every other module without each having to re-import
 * AuthModule or IdentityModule directly.
 */
@Global()
@Module({
  imports: [IdentityModule, CustomersModule, CustomerMessagingModule],
  controllers: [AdminAuthController, OwnerAuthController, StaffAuthController, CustomerAuthController],
  providers: [
    CustomerSessionService,
    CustomerOtpService,
    CustomerPasswordService,
    StaffAuthService,
    AuthGuard,
    RolesGuard,
    { provide: GOOGLE_TOKEN_VERIFIER, useClass: ConfiguredGoogleTokenVerifier },
  ],
  exports: [CustomerSessionService, CustomerOtpService, GOOGLE_TOKEN_VERIFIER, AuthGuard, RolesGuard, IdentityModule],
})
export class AuthModule {}
