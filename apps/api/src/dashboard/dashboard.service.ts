import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cheap counts for the Super Admin Portal's landing page — every query
   * here is a single indexed COUNT/SUM, not a heavy aggregation, kept
   * intentionally minimal rather than a general-purpose reporting engine
   * (ARCHITECTURE.md §14/§19: reporting/analytics is explicitly deferred
   * beyond this phase's scope).
   */
  async summary() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const [
      totalOrganizations,
      totalVenues,
      activeVenues,
      totalCustomers,
      bookingsToday,
      openSupportTickets,
      revenueThisMonth,
    ] = await Promise.all([
      this.prisma.client.ownerOrganization.count(),
      this.prisma.client.venue.count(),
      this.prisma.client.venue.count({ where: { status: 'ACTIVE' } }),
      this.prisma.client.customerProfile.count(),
      this.prisma.client.booking.count({ where: { startTime: { gte: startOfToday } } }),
      this.prisma.client.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.client.payment.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalOrganizations,
      totalVenues,
      activeVenues,
      totalCustomers,
      bookingsToday,
      openSupportTickets,
      revenueThisMonth: revenueThisMonth._sum.amount ?? 0,
    };
  }

  /** Same shape of cheap counts, scoped to one organization for the
   * Venue Owner Portal's dashboard. */
  async ownerSummary(organizationId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const [totalVenues, activeVenues, bookingsToday, revenueThisMonth] = await Promise.all([
      this.prisma.client.venue.count({ where: { organizationId } }),
      this.prisma.client.venue.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.client.booking.count({
        where: { venue: { organizationId }, startTime: { gte: startOfToday } },
      }),
      this.prisma.client.payment.aggregate({
        where: {
          status: 'SUCCESS',
          createdAt: { gte: startOfMonth },
          booking: { venue: { organizationId } },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalVenues,
      activeVenues,
      bookingsToday,
      revenueThisMonth: revenueThisMonth._sum.amount ?? 0,
    };
  }
}
