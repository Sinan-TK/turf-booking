import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { CustomerStatus } from '@venue/database';
import { contains } from '../common/list-filters';

export interface AdminCustomerFilters {
  status?: string;
  /** Matches WhatsApp number, name or email. */
  search?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * WhatsApp identity model (ARCHITECTURE.md): a customer is created on
   * first contact, resolved by phone number thereafter — no separate
   * signup step. Also creates the CoinWallet in the same transaction so
   * every customer has exactly one wallet from the moment they exist,
   * never created lazily on first credit (Phase 7 depends on this).
   */
  async findOrCreateByWhatsAppNumber(whatsappNumber: string) {
    const existing = await this.prisma.client.customerProfile.findUnique({
      where: { whatsappNumber },
    });
    if (existing) return existing;

    return this.prisma.client.$transaction(async (tx) => {
      const customer = await tx.customerProfile.create({ data: { whatsappNumber } });
      await tx.coinWallet.create({ data: { customerId: customer.id } });
      return customer;
    });
  }

  /** Called from the WhatsApp onboarding/profile-edit flow — a plain
   * update, not upsert, since the customer row always exists by the time
   * a name is captured (findOrCreateByWhatsAppNumber already ran). */
  async updateName(customerId: string, name: string) {
    return this.prisma.client.customerProfile.update({
      where: { id: customerId },
      data: { name },
    });
  }

  /** Platform-wide customer directory for the Super Admin Portal (§12). */
  private adminCustomerWhere(filters: AdminCustomerFilters) {
    const q = filters.search;
    return {
      status: filters.status ? (filters.status as CustomerStatus) : undefined,
      OR: q
        ? [
            { whatsappNumber: contains(q) },
            { name: contains(q) },
            { email: contains(q) },
          ]
        : undefined,
    };
  }

  async searchForAdmin(filters: AdminCustomerFilters, page: { limit: number; offset: number } = { limit: 50, offset: 0 }) {
    return this.prisma.client.customerProfile.findMany({
      where: this.adminCustomerWhere(filters),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: Math.min(page.limit, 200),
      skip: page.offset,
    });
  }

  async countForAdmin(filters: AdminCustomerFilters) {
    return this.prisma.client.customerProfile.count({ where: this.adminCustomerWhere(filters) });
  }

  /**
   * Profile plus what an admin needs to judge the account at a glance:
   * booking counts, spend, first/last booking, open tickets, and the
   * latest bookings and wallet movements.
   */
  async getForAdmin(customerId: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: customerId },
      include: { coinWallet: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const db = this.prisma.client;
    const [byStatus, spent, span, openTickets, lastSession, recentBookings, recentTransactions] = await Promise.all([
      db.booking.groupBy({ by: ['status'], where: { customerId }, _count: { _all: true } }),
      db.booking.aggregate({
        where: { customerId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { amount: true },
      }),
      db.booking.aggregate({ where: { customerId }, _min: { createdAt: true }, _max: { createdAt: true } }),
      db.supportTicket.count({ where: { customerId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      db.customerSession.findFirst({ where: { customerId }, orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
      db.booking.findMany({
        where: { customerId },
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
        },
      }),
      db.coinTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, type: true, amount: true, balanceAfter: true, createdAt: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    let totalBookings = 0;
    for (const row of byStatus) {
      counts[row.status] = row._count._all;
      totalBookings += row._count._all;
    }

    return {
      ...customer,
      stats: {
        totalBookings,
        bookingsByStatus: counts,
        totalSpent: (spent._sum.amount ?? 0).toString(),
        firstBookedAt: span._min.createdAt,
        lastBookedAt: span._max.createdAt,
        openTickets,
        lastSeenAt: lastSession?.lastSeenAt ?? null,
      },
      recentBookings,
      recentTransactions,
    };
  }

  /**
   * Blocking cuts off the web: sessions are revoked now and
   * CustomerSessionService/OTP refuse a blocked customer afterwards.
   */
  async setStatusForAdmin(customerId: string, status: CustomerStatus, reason: string | undefined, admin: AuthContext) {
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === status) return customer;

    const [updated] = await this.prisma.client.$transaction([
      this.prisma.client.customerProfile.update({ where: { id: customerId }, data: { status } }),
      ...(status === 'BLOCKED'
        ? [
            this.prisma.client.customerSession.updateMany({
              where: { customerId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actor: admin,
      action: status === 'BLOCKED' ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entityType: 'CustomerProfile',
      entityId: customerId,
      metadata: { reason: reason ?? null, from: customer.status },
    });
    return updated;
  }
}
