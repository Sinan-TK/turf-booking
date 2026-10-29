import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import type { OwnerUserStatus } from '@venue/database';
import { contains } from '../common/list-filters';
import type { AuthContext } from '../auth/auth.types';
import type { InviteStaffDto } from './dto/owner-staff.dto';

const staffSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  venueAssignments: { select: { venue: { select: { id: true, name: true } } } },
} as const;

/** An owner admin's own staff: invited by email, each limited to the venues they are assigned. */
@Injectable()
export class OwnerStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly scope: OwnerScopeService,
    private readonly audit: AuditService,
  ) {}

  private shape(u: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
    createdAt: Date;
    venueAssignments: Array<{ venue: { id: string; name: string } }>;
  }) {
    const { venueAssignments, ...rest } = u;
    return { ...rest, venues: venueAssignments.map((a) => a.venue) };
  }

  /** One page of the organization's staff, newest first, with the total that match (name/email search, login status). */
  async list(
    actor: AuthContext,
    filters: { search?: string; status?: OwnerUserStatus; limit: number; offset: number },
  ) {
    const where = {
      organizationId: actor.organizationId,
      role: 'OWNER_STAFF' as const,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { OR: [{ name: contains(filters.search) }, { email: contains(filters.search) }] } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.client.venueOwnerUser.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: filters.offset,
        take: filters.limit,
        select: staffSelect,
      }),
      this.prisma.client.venueOwnerUser.count({ where }),
    ]);
    return { rows: users.map((u) => this.shape(u)), total };
  }

  async invite(dto: InviteStaffDto, actor: AuthContext) {
    const organizationId = actor.organizationId!;
    // Checked before the account exists, so a bad venue never leaves a half-made staff login.
    await this.scope.assertVenuesInOrganization(organizationId, dto.venueIds);
    const created = await this.identity.inviteOwner({
      organizationId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      role: 'OWNER_STAFF',
    });
    await this.scope.replaceAssignments(created.id, organizationId, dto.venueIds);
    await this.audit.record({
      actor,
      action: 'OWNER_STAFF_INVITED',
      entityType: 'VenueOwnerUser',
      entityId: created.id,
      metadata: { organizationId, email: created.email, venueIds: dto.venueIds },
    });
    return this.get(created.id, organizationId);
  }

  private async get(id: string, organizationId: string) {
    const user = await this.prisma.client.venueOwnerUser.findFirst({
      where: { id, organizationId, role: 'OWNER_STAFF' },
      select: staffSelect,
    });
    if (!user) throw new NotFoundException('Staff member not found');
    return this.shape(user);
  }

  async setVenues(id: string, venueIds: string[], actor: AuthContext) {
    const organizationId = actor.organizationId!;
    await this.get(id, organizationId);
    await this.scope.replaceAssignments(id, organizationId, venueIds);
    await this.audit.record({
      actor,
      action: 'OWNER_STAFF_VENUES_CHANGED',
      entityType: 'VenueOwnerUser',
      entityId: id,
      metadata: { organizationId, venueIds },
    });
    return this.get(id, organizationId);
  }

  /**
   * Deletes a staff login for good. Their history stays: audit entries and the blocks they created lose only the link to the
   * person, and their assignments and alerts go with them. Sessions and sign-in links are not linked by the database, so they are
   * removed here, which also signs them out. The token the browser holds stops working at once (the guard finds no account).
   */
  async remove(id: string, actor: AuthContext) {
    const organizationId = actor.organizationId!;
    const person = await this.get(id, organizationId);
    await this.prisma.client.$transaction([
      this.prisma.client.staffRefreshSession.deleteMany({ where: { portal: 'OWNER', userId: id } }),
      this.prisma.client.staffAuthToken.deleteMany({ where: { portal: 'OWNER', userId: id } }),
      this.prisma.client.venueOwnerUser.delete({ where: { id } }),
    ]);
    await this.audit.record({
      actor,
      action: 'OWNER_STAFF_DELETED',
      entityType: 'VenueOwnerUser',
      entityId: id,
      metadata: { organizationId, name: person.name, email: person.email },
    });
    return { deleted: true };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'DISABLED', actor: AuthContext) {
    const organizationId = actor.organizationId!;
    await this.get(id, organizationId);
    await this.prisma.client.venueOwnerUser.update({ where: { id }, data: { status } });
    // Disabling signs them out everywhere at once.
    if (status === 'DISABLED') await this.identity.revokeAllSessions('OWNER', id);
    await this.audit.record({
      actor,
      action: status === 'DISABLED' ? 'OWNER_USER_DISABLED' : 'OWNER_USER_ENABLED',
      entityType: 'VenueOwnerUser',
      entityId: id,
      metadata: { organizationId },
    });
    return this.get(id, organizationId);
  }
}
