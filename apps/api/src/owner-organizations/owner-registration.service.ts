import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A venue owner signing themselves up. It creates the owner's organization and an owner-admin login, and emails an invite link to set
 * the password: the same path an admin-created owner takes, so the email address is proved before the account can be used and no
 * password ever travels through this endpoint. The answer is the same whether or not the address is already in use, so the form cannot
 * be used to find out who has an account. Nothing here puts a venue on the customer site: a venue stays hidden until the Super Admin
 * makes it live.
 */
@Injectable()
export class OwnerRegistrationService {
  private readonly logger = new Logger(OwnerRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: { businessName: string; name: string; email: string; phone: string }, ipAddress?: string): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.client.venueOwnerUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (existing) return; // already has an account: say nothing different (they can use "Forgot password")

    const organization = await this.prisma.client.ownerOrganization.create({
      // Waits for the Super Admin's approval before the owner sees anything real.
      data: { name: dto.businessName.trim(), contactEmail: email, contactPhone: dto.phone, status: 'PENDING_APPROVAL' },
    });
    try {
      await this.identity.inviteOwner({ organizationId: organization.id, email, name: dto.name.trim(), phone: dto.phone, role: 'OWNER_ADMIN' });
    } catch (err) {
      // No account came of it (a clash with a sign-up at the same moment, or the email could not be sent): leave nothing half made.
      await this.prisma.client.ownerOrganization.delete({ where: { id: organization.id } }).catch(() => undefined);
      if ((err as { status?: number }).status === 409) return;
      this.logger.error(`Owner sign-up invite failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('We could not send the email just now. Please try again in a few minutes.');
    }
    await this.audit.record({
      actor: 'SYSTEM',
      action: 'OWNER_SELF_REGISTERED',
      entityType: 'OwnerOrganization',
      entityId: organization.id,
      metadata: { name: organization.name, email },
      ipAddress,
    });
  }
}
