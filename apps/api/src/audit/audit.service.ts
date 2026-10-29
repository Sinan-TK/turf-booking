import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import type { AuditActorType, Prisma } from '@venue/database';
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
}
