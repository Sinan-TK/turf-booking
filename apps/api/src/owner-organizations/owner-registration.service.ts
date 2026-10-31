import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A venue owner signing themselves up. It creates the owner's organization and an owner-admin login, and emails an invite link to set
 * the password: the same path an admin-created owner takes, so the email address is proved before the account can be used and no
 * password ever travels through this endpoint. An address that already has an owner login is refused plainly (OWNER_EMAIL_TAKEN), and
 * emailTaken lets the form say so as soon as it is typed; both are rate-limited, since they tell anyone who asks whether an owner has that address. Nothing here puts a venue on the customer site: a venue stays hidden until the Super Admin
 * makes it live.
 */
export const OWNER_EMAIL_TAKEN = 'An owner account with this email already exists. Sign in, or use Forgot password.';

@Injectable()
export class OwnerRegistrationService {
  private readonly logger = new Logger(OwnerRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  /** Whether an owner login (any organization, any role in it) already uses this address. Other kinds of account do not count. */
  async emailTaken(email: string): Promise<boolean> {
    const found = await this.prisma.client.venueOwnerUser.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, select: { id: true } });
    return !!found;
  }

  async register(dto: { businessName: string; name: string; email: string; phone: string }, ipAddress?: string): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    if (await this.emailTaken(email)) throw new ConflictException(OWNER_EMAIL_TAKEN);

    const organization = await this.prisma.client.ownerOrganization.create({
      // Waits for the Super Admin's approval before the owner sees anything real.
      data: { name: dto.businessName.trim(), contactEmail: email, contactPhone: dto.phone, status: 'PENDING_APPROVAL' },
    });
    try {
      await this.identity.inviteOwner({ organizationId: organization.id, email, name: dto.name.trim(), phone: dto.phone, role: 'OWNER_ADMIN' });
    } catch (err) {
      // No account came of it (a clash with a sign-up at the same moment, or the email could not be sent): leave nothing half made.
      await this.prisma.client.ownerOrganization.delete({ where: { id: organization.id } }).catch(() => undefined);
      if ((err as { status?: number }).status === 409) throw new ConflictException(OWNER_EMAIL_TAKEN); // someone took it a moment ago
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
