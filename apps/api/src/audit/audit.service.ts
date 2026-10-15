import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import type { Prisma } from '@venue/database';

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
}
