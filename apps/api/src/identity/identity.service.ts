import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { StaffPortal } from '@venue/database';
import type { OwnerUserRole } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity-provider.interface';

/**
 * Provisions Super Admin / Venue Owner identities. Creates the platform
 * profile row (AdminUser/VenueOwnerUser, passwordless) and has the
 * IdentityProvider email them a link to set their own password — this
 * backend never generates, receives or transmits a password for them.
 * Returned rows never include passwordHash.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  async inviteAdmin(params: { email: string; name: string }) {
    const email = params.email.trim().toLowerCase();
    const existing = await this.prisma.client.adminUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) throw new ConflictException('An admin with this email already exists');

    const created = await this.prisma.client.adminUser.create({
      data: { email, name: params.name },
    });
    const { passwordHash: _omit, ...adminUser } = created;

    await this.identity.sendInvite({
      portal: StaffPortal.ADMIN,
      userId: adminUser.id,
      email,
      name: adminUser.name,
    });
    return adminUser;
  }

  async inviteOwner(params: {
    organizationId: string;
    email: string;
    name: string;
    phone?: string;
    role: OwnerUserRole;
  }) {
    const email = params.email.trim().toLowerCase();
    const existing = await this.prisma.client.venueOwnerUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) throw new ConflictException('An owner user with this email already exists');

    const created = await this.prisma.client.venueOwnerUser.create({
      data: {
        organizationId: params.organizationId,
        email,
        name: params.name,
        phone: params.phone,
        role: params.role,
      },
    });
    const { passwordHash: _omit, ...ownerUser } = created;

    await this.identity.sendInvite({
      portal: StaffPortal.OWNER,
      userId: ownerUser.id,
      email,
      name: ownerUser.name,
    });
    return ownerUser;
  }

  /** "Logout everywhere": revokes every refresh session for this user.
   * Their current access token (≤ ACCESS_TOKEN_TTL_MINUTES) simply expires. */
  async revokeAllSessions(portal: StaffPortal, userId: string) {
    await this.identity.revokeAllSessions(portal, userId);
  }
}
