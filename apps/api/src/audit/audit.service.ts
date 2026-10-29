import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import { Prisma, type AuditActorType } from '@venue/database';
import { contains, dateWhere, type DateRange } from '../common/list-filters';

/**
 * Every state-changing action in the app should go through this
 * (ARCHITECTURE.md §18), called from the service layer — never from a
 * controller directly — so it can't be bypassed by a new route that
 * forgets to add its own logging call site.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    actor: AuthContext | 'SYSTEM';
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string;
  }): Promise<void> {
    const { actor, action, entityType, entityId, metadata, ipAddress } = params;

    const base = { action, entityType, entityId, metadata, ipAddress };

    if (actor === 'SYSTEM') {
      await this.prisma.client.auditLog.create({
        data: { ...base, actorType: 'SYSTEM' },
      });
      return;
    }

    switch (actor.role) {
      case 'SUPER_ADMIN':
        await this.prisma.client.auditLog.create({
          data: { ...base, actorType: 'ADMIN', actorAdminId: actor.id },
        });
        return;
      case 'VENUE_OWNER':
        await this.prisma.client.auditLog.create({
          data: { ...base, actorType: 'OWNER', actorOwnerUserId: actor.id },
        });
        return;
      case 'CUSTOMER':
        await this.prisma.client.auditLog.create({
          data: { ...base, actorType: 'CUSTOMER', actorCustomerId: actor.id },
        });
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Reading (Super Admin's audit log page)
  // ---------------------------------------------------------------------------

  private where(f: { q?: string; actorType?: AuditActorType; entityType?: string; action?: string; range?: DateRange }): Prisma.AuditLogWhereInput {
    return {
      actorType: f.actorType,
      entityType: f.entityType,
      action: f.action,
      createdAt: dateWhere(f.range),
      ...(f.q
        ? {
            OR: [
              { action: contains(f.q) },
              { entityType: contains(f.q) },
              { entityId: contains(f.q) },
              { ipAddress: contains(f.q) },
              { actorAdmin: { is: { OR: [{ email: contains(f.q) }, { name: contains(f.q) }] } } },
              { actorOwnerUser: { is: { OR: [{ email: contains(f.q) }, { name: contains(f.q) }] } } },
            ],
          }
        : {}),
    };
  }

  count(f: Parameters<AuditService['where']>[0]) {
    return this.prisma.client.auditLog.count({ where: this.where(f) });
  }

  /** One page of the log, newest first, each entry with who did it (a name and email, not just an id). */
  async list(f: Parameters<AuditService['where']>[0] & { limit: number; offset: number }) {
    const rows = await this.prisma.client.auditLog.findMany({
      where: this.where(f),
      include: {
        actorAdmin: { select: { id: true, name: true, email: true } },
        actorOwnerUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit,
      skip: f.offset,
    });
    // Customers have no relation on the row, so their names come in one extra query for the page.
    const customerIds = [...new Set(rows.map((r) => r.actorCustomerId).filter((id): id is string => !!id))];
    const customers = customerIds.length
      ? await this.prisma.client.customerProfile.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true, whatsappNumber: true } })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));
    return rows.map(({ actorAdmin, actorOwnerUser, ...row }) => {
      const customer = row.actorCustomerId ? customerById.get(row.actorCustomerId) : undefined;
      const actor =
        row.actorType === 'ADMIN' ? actorAdmin
        : row.actorType === 'OWNER' ? actorOwnerUser
        : row.actorType === 'CUSTOMER' ? (customer ? { id: customer.id, name: customer.name ?? '', email: customer.email ?? customer.whatsappNumber ?? '' } : row.actorCustomerId ? { id: row.actorCustomerId, name: '', email: '' } : null)
        : null;
      return { ...row, actor };
    });
  }

  /** What the log's filters can offer: the kinds of thing and the actions that appear in it. */
  async facets() {
    const [entityTypes, actions] = await Promise.all([
      this.prisma.client.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
      this.prisma.client.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    return { entityTypes: entityTypes.map((e) => e.entityType), actions: actions.map((a) => a.action) };
  }

  // ---------------------------------------------------------------------------
  // Reading (an owner's own audit log)
  // ---------------------------------------------------------------------------

  /**
   * What belongs to one organisation: what its own logins did, and everything done to its venues, units, bookings, refunds,
   * payouts, logins and the organisation itself, by anyone. The log refers to its subject by a plain id, so each kind is matched
   * through the table it points at.
   */
  private ownerScope(organizationId: string): Prisma.Sql {
    const org = Prisma.sql`${organizationId}::uuid`;
    return Prisma.sql`(
      a."actorOwnerUserId" IN (SELECT id FROM venue_owner_users WHERE "organizationId" = ${org})
      OR (a."entityType" = 'OwnerOrganization' AND a."entityId" = ${organizationId})
      OR (a."entityType" = 'VenueOwnerUser' AND a."entityId" IN (SELECT id::text FROM venue_owner_users WHERE "organizationId" = ${org}))
      OR (a."entityType" = 'Venue' AND a."entityId" IN (SELECT id::text FROM venues WHERE "organizationId" = ${org}))
      OR (a."entityType" = 'Turf' AND a."entityId" IN (SELECT r.id::text FROM resources r JOIN venues v ON v.id = r."venueId" WHERE v."organizationId" = ${org}))
      OR (a."entityType" = 'Booking' AND a."entityId" IN (SELECT b.id::text FROM bookings b JOIN venues v ON v.id = b."venueId" WHERE v."organizationId" = ${org}))
      OR (a."entityType" = 'Refund' AND a."entityId" IN (SELECT f.id::text FROM refunds f JOIN bookings b ON b.id = f."bookingId" JOIN venues v ON v.id = b."venueId" WHERE v."organizationId" = ${org}))
      OR (a."entityType" = 'Payout' AND a."entityId" IN (SELECT id::text FROM payouts WHERE "organizationId" = ${org}))
    )`;
  }

  private ownerWhere(
    organizationId: string,
    f: { q?: string; actorType?: AuditActorType; entityType?: string; action?: string; range?: DateRange },
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [this.ownerScope(organizationId)];
    if (f.actorType) parts.push(Prisma.sql`a."actorType" = ${f.actorType}::"AuditActorType"`);
    if (f.entityType) parts.push(Prisma.sql`a."entityType" = ${f.entityType}`);
    if (f.action) parts.push(Prisma.sql`a.action = ${f.action}`);
    if (f.range?.from) parts.push(Prisma.sql`a."createdAt" >= ${f.range.from}`);
    if (f.range?.to) parts.push(Prisma.sql`a."createdAt" < ${f.range.to}`);
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      parts.push(Prisma.sql`(
        a.action ILIKE ${like} OR a."entityType" ILIKE ${like} OR a."entityId" ILIKE ${like}
        OR a."actorOwnerUserId" IN (SELECT id FROM venue_owner_users WHERE "organizationId" = ${organizationId}::uuid AND (email ILIKE ${like} OR name ILIKE ${like}))
      )`);
    }
    return Prisma.join(parts, ' AND ');
  }

  async countForOrganization(organizationId: string, f: Parameters<AuditService['ownerWhere']>[1]): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT count(*)::int AS n FROM audit_logs a WHERE ${this.ownerWhere(organizationId, f)}`,
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * One page of an organisation's log. Its own people are named; anything done by the platform team, a customer or the system is
   * shown only as that, with no name, address, IP or recorded details, because those belong to someone else.
   */
  async listForOrganization(organizationId: string, f: Parameters<AuditService['ownerWhere']>[1] & { limit: number; offset: number }) {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        actorType: AuditActorType;
        actorOwnerUserId: string | null;
        action: string;
        entityType: string;
        entityId: string;
        metadata: Prisma.JsonValue | null;
      }>
    >(
      Prisma.sql`SELECT a.id, a."createdAt", a."actorType", a."actorOwnerUserId", a.action, a."entityType", a."entityId", a.metadata
        FROM audit_logs a WHERE ${this.ownerWhere(organizationId, f)}
        ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
    );
    const ids = [...new Set(rows.map((r) => r.actorOwnerUserId).filter((id): id is string => !!id))];
    const people = ids.length
      ? await this.prisma.client.venueOwnerUser.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, name: true, email: true, role: true } })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => {
      const own = r.actorType === 'OWNER' && r.actorOwnerUserId ? byId.get(r.actorOwnerUserId) : undefined;
      return {
        id: r.id,
        createdAt: r.createdAt,
        actorType: r.actorType,
        actor: own ? { id: own.id, name: own.name, email: own.email, role: own.role } : null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: own ? r.metadata : null,
      };
    });
  }

  async facetsForOrganization(organizationId: string) {
    const scope = this.ownerScope(organizationId);
    const [types, actions] = await Promise.all([
      this.prisma.client.$queryRaw<Array<{ v: string }>>(Prisma.sql`SELECT DISTINCT a."entityType" AS v FROM audit_logs a WHERE ${scope} ORDER BY 1`),
      this.prisma.client.$queryRaw<Array<{ v: string }>>(Prisma.sql`SELECT DISTINCT a.action AS v FROM audit_logs a WHERE ${scope} ORDER BY 1`),
    ]);
    return { entityTypes: types.map((t) => t.v), actions: actions.map((a) => a.v) };
  }
}
