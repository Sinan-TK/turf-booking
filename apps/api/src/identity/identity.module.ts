import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityService } from './identity.service';
import { StaffTokenService } from './staff-token.service';
import { MailService } from './mail.service';
import { IDENTITY_PROVIDER } from './identity-provider.interface';
import { LocalIdentityAdapter } from './local-identity.adapter';

@Module({
  imports: [PrismaModule],
  providers: [
    IdentityService,
    StaffTokenService,
    MailService,
    LocalIdentityAdapter,
    { provide: IDENTITY_PROVIDER, useExisting: LocalIdentityAdapter },
  ],
  exports: [IdentityService, StaffTokenService, IDENTITY_PROVIDER],
})
export class IdentityModule {}
