import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

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
  private adminCustomerWhere(search: string | undefined) {
    return search
      ? {
          OR: [
            { whatsappNumber: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;
  }

  async searchForAdmin(search: string | undefined, page: { limit: number; offset: number } = { limit: 50, offset: 0 }) {
    return this.prisma.client.customerProfile.findMany({
      where: this.adminCustomerWhere(search),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: Math.min(page.limit, 200),
      skip: page.offset,
    });
  }

  async countForAdmin(search: string | undefined) {
    return this.prisma.client.customerProfile.count({ where: this.adminCustomerWhere(search) });
  }

  async getForAdmin(customerId: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: customerId },
      include: { coinWallet: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
