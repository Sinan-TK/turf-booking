import { presentCustomer } from '../bookings/booking-customer';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { MailService } from '../identity/mail.service';
import { loadEnv } from '@venue/config';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import type { OwnerOrganizationStatus, OwnerUserRole, OwnerUserStatus } from '@venue/database';
import { contains } from '../common/list-filters';
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
    private readonly scope: OwnerScopeService,
    private readonly identity: IdentityService,
    private readonly mail: MailService,
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

  /**
   * Every organization, with its owner's name (the owner admin who has been there longest) and how many of its venues are active, so the
   * Super Admin's list says who and how big without opening each one. Draft, inactive and suspended venues do not count.
   */
  async listOrganizations() {
    const rows = await this.prisma.client.ownerOrganization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        ownerUsers: { where: { role: 'OWNER_ADMIN' }, orderBy: { createdAt: 'asc' }, take: 1, select: { name: true } },
        _count: { select: { venues: { where: { status: 'ACTIVE', deletedAt: null } } } },
      },
    });
    return rows.map(({ ownerUsers, _count, ...org }) => ({ ...org, ownerName: ownerUsers[0]?.name ?? null, activeVenues: _count.venues }));
  }

  async getOrganization(id: string) {
    const org = await this.prisma.client.ownerOrganization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /**
   * Organization plus what an admin needs to judge the tenant: venue and
   * login counts, booking volume and revenue, last booking, and the
   * venues themselves.
   */
  async getOrganizationDetail(id: string) {
    const org = await this.getOrganization(id);
    const db = this.prisma.client;
    const where = { venue: { organizationId: id } };
    const [venues, ownerUsers, byStatus, revenue, last, recentBookings] = await Promise.all([
      db.venue.findMany({
        where: { organizationId: id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          facilityCode: true,
          status: true,
          resources: { select: { category: { select: { id: true, name: true } } } },
          resourceGroups: { select: { category: { select: { id: true, name: true } } } },
        },
      }),
      db.venueOwnerUser.groupBy({ by: ['status'], where: { organizationId: id }, _count: { _all: true } }),
      db.booking.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.booking.aggregate({ where: { ...where, status: { in: ['CONFIRMED', 'COMPLETED'] } }, _sum: { amount: true } }),
      db.booking.aggregate({ where, _max: { createdAt: true } }),
      db.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderId: true,
          status: true,
          amount: true,
          currency: true,
          startTime: true,
          venue: { select: { name: true } },
          customer: { select: { id: true, name: true, whatsappNumber: true, phoneVerified: true, email: true } },
          walkInName: true,
          walkInPhone: true,
        },
      }),
    ]);
    const venueRows = venues.map(({ resources, resourceGroups, ...venue }) => {
      const byId = new Map<string, { id: string; name: string }>();
      for (const unit of [...resources, ...resourceGroups]) byId.set(unit.category.id, unit.category);
      return { ...venue, facilities: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    });
    const bookingsByStatus: Record<string, number> = {};
    let totalBookings = 0;
    for (const row of byStatus) {
      bookingsByStatus[row.status] = row._count._all;
      totalBookings += row._count._all;
    }
    const logins = { total: 0, active: 0 };
    for (const row of ownerUsers) {
      logins.total += row._count._all;
      if (row.status === 'ACTIVE') logins.active += row._count._all;
    }
    return {
      ...org,
      stats: {
        venues: venues.length,
        activeVenues: venues.filter((v) => v.status === 'ACTIVE').length,
        logins,
        totalBookings,
        bookingsByStatus,
        revenue: (revenue._sum.amount ?? 0).toString(),
        lastBookedAt: last._max.createdAt,
      },
      venues: venueRows,
      recentBookings: recentBookings.map((b) => presentCustomer(b)),
    };
  }

  /**
   * Suspending an organization signs its owners out (refresh sessions are
   * revoked; login and refresh already refuse a suspended organization).
   */
  async setStatus(id: string, status: OwnerOrganizationStatus, reason: string | undefined, actor: AuthContext) {
    const org = await this.getOrganization(id);
    if (org.status === status) return org;
    const updated = await this.prisma.client.ownerOrganization.update({ where: { id }, data: { status } });
    if (status === 'SUSPENDED' || status === 'REJECTED') {
      const users = await this.prisma.client.venueOwnerUser.findMany({ where: { organizationId: id }, select: { id: true } });
      await Promise.all(users.map((u) => this.identity.revokeAllSessions('OWNER', u.id)));
    }
    // Approving a sign-up that was waiting is not the same as lifting a suspension: say so in the log, and tell the owner.
    const approved = status === 'ACTIVE' && (org.status === 'PENDING_APPROVAL' || org.status === 'REJECTED');
    if (approved) await this.tellOwnerApproved(org);
    await this.audit.record({
      actor,
      action: approved
        ? 'OWNER_ORGANIZATION_APPROVED'
        : status === 'REJECTED'
          ? 'OWNER_ORGANIZATION_REJECTED'
          : status === 'SUSPENDED'
            ? 'OWNER_ORGANIZATION_SUSPENDED'
            : 'OWNER_ORGANIZATION_REACTIVATED',
      entityType: 'OwnerOrganization',
      entityId: id,
      metadata: { reason: reason ?? null, from: org.status },
    });
    return updated;
  }

  /** Emails the owner that their account was approved and can now be used in full. A mail failure never undoes the approval. */
  private async tellOwnerApproved(org: { name: string; contactEmail: string }) {
    const url = `${loadEnv().OWNER_APP_URL.replace(/\/$/, '')}/login`;
    const text = `Good news: ${org.name} has been approved on TurfX.\n\nYou can now sign in and set up your venues: ${url}\n`;
    const templateId = loadEnv().RESEND_OWNER_APPROVED_TEMPLATE_ID;
    await this.mail.send({
      to: org.contactEmail,
      subject: 'Your TurfX owner account is approved',
      ...(templateId ? { template: { id: templateId, variables: { BUSINESS_NAME: org.name.replace(/[<>&"']/g, ''), LOGIN_URL: url } } } : {}),
      text,
      html: `<p>Good news: <strong>${org.name.replace(/[<>&]/g, '')}</strong> has been approved on TurfX.</p><p>You can now <a href="${url}">sign in</a> and set up your venues.</p>`,
    });
  }

  async setOwnerUserStatus(
    organizationId: string,
    userId: string,
    status: OwnerUserStatus,
    reason: string | undefined,
    actor: AuthContext,
  ) {
    const user = await this.prisma.client.venueOwnerUser.findFirst({ where: { id: userId, organizationId } });
    if (!user) throw new NotFoundException('Owner login not found');
    if (user.status !== status) {
      await this.prisma.client.venueOwnerUser.update({ where: { id: userId }, data: { status } });
      if (status === 'DISABLED') await this.identity.revokeAllSessions('OWNER', userId);
      await this.audit.record({
        actor,
        action: status === 'DISABLED' ? 'OWNER_USER_DISABLED' : 'OWNER_USER_ENABLED',
        entityType: 'VenueOwnerUser',
        entityId: userId,
        metadata: { organizationId, reason: reason ?? null },
      });
    }
    const { passwordHash: _passwordHash, ...safe } = (await this.prisma.client.venueOwnerUser.findUnique({
      where: { id: userId },
    }))!;
    return safe;
  }

  async createOwnerUser(organizationId: string, dto: CreateOwnerUserDto, actor: AuthContext) {
    await this.getOrganization(organizationId);
    if (dto.venueIds?.length) {
      await this.scope.assertVenuesInOrganization(organizationId, dto.venueIds);
    }

    // Creates the VenueOwnerUser profile row and emails them an invite
    // link to set their own password.
    const ownerUser = await this.identity.inviteOwner({
      organizationId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      role: dto.role,
    });

    if (dto.role === 'OWNER_STAFF' && dto.venueIds?.length) {
      await this.scope.replaceAssignments(ownerUser.id, organizationId, dto.venueIds);
    }

    await this.audit.record({
      actor,
      action: 'OWNER_USER_CREATED',
      entityType: 'VenueOwnerUser',
      entityId: ownerUser.id,
      metadata: { organizationId, email: ownerUser.email, role: ownerUser.role },
    });

    return ownerUser;
  }

  /** One page of an organization's logins, newest first, with the total that match (name/email search, role, status). */
  async listOwnerUsers(
    organizationId: string,
    filters: { search?: string; role?: OwnerUserRole; status?: OwnerUserStatus; limit: number; offset: number },
  ) {
    await this.getOrganization(organizationId);
    const where = {
      organizationId,
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { OR: [{ name: contains(filters.search) }, { email: contains(filters.search) }] } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.client.venueOwnerUser.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: filters.offset,
        take: filters.limit,
        include: { venueAssignments: { select: { venueId: true } } },
      }),
      this.prisma.client.venueOwnerUser.count({ where }),
    ]);
    // Never expose credential hashes.
    return {
      rows: users.map(({ passwordHash: _passwordHash, venueAssignments, ...user }) => ({
        ...user,
        venueIds: venueAssignments.map((a) => a.venueId),
      })),
      total,
    };
  }
}
