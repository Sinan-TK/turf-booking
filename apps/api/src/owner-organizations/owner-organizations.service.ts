import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateOrganizationDto, CreateOwnerUserDto } from './dto/owner-organization.dto';

/**
 * Super-Admin-only provisioning for the OwnerOrganization -> VenueOwnerUser
 * hierarchy (ARCHITECTURE.md §Owners). Before this module existed, the
 * only way to create an organization or an owner login was the seed
 * script, which the Super Admin Portal's "Owners" page needs to replace.
 */
@Injectable()
export class OwnerOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  async createOrganization(dto: CreateOrganizationDto, actor: AuthContext) {
    const org = await this.prisma.client.ownerOrganization.create({
      data: {
        name: dto.name,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
      },
    });

    await this.audit.record({
      actor,
      action: 'OWNER_ORGANIZATION_CREATED',
      entityType: 'OwnerOrganization',
      entityId: org.id,
      metadata: { name: org.name },
    });

    return org;
  }

  async listOrganizations() {
    return this.prisma.client.ownerOrganization.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getOrganization(id: string) {
    const org = await this.prisma.client.ownerOrganization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async createOwnerUser(organizationId: string, dto: CreateOwnerUserDto, actor: AuthContext) {
    await this.getOrganization(organizationId);

    // Creates the VenueOwnerUser profile row and emails them an invite
    // link to set their own password.
    const ownerUser = await this.identity.inviteOwner({
      organizationId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      role: dto.role,
    });

    await this.audit.record({
      actor,
      action: 'OWNER_USER_CREATED',
      entityType: 'VenueOwnerUser',
      entityId: ownerUser.id,
      metadata: { organizationId, email: ownerUser.email, role: ownerUser.role },
    });

    return ownerUser;
  }

  async listOwnerUsers(organizationId: string) {
    await this.getOrganization(organizationId);
    const users = await this.prisma.client.venueOwnerUser.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    // Never expose credential hashes.
    return users.map(({ passwordHash: _passwordHash, ...user }) => user);
  }
}
