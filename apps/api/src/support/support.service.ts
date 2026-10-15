import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SupportTicketStatus } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateTicketDto, UpdateTicketDto } from './dto/support.dto';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(dto: CreateTicketDto, actor: AuthContext) {
    if (dto.bookingId) {
      const booking = await this.prisma.client.booking.findUnique({ where: { id: dto.bookingId } });
      if (!booking || booking.customerId !== actor.id) {
        throw new ForbiddenException("Cannot raise a ticket against another customer's booking");
      }
    }
    return this.prisma.client.supportTicket.create({
      data: {
        customerId: actor.id,
        bookingId: dto.bookingId,
        venueId: dto.venueId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
      },
    });
  }

  async listForCustomer(actor: AuthContext) {
    return this.prisma.client.supportTicket.findMany({
      where: { customerId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForCustomer(ticketId: string, actor: AuthContext) {
    const ticket = await this.prisma.client.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.customerId !== actor.id) {
      throw new ForbiddenException("Cannot access another customer's ticket");
    }
    return ticket;
  }

  /** Platform-wide support queue for the Super Admin Portal (§12). */
  async listForAdmin(filters: { status?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.supportTicket.findMany({
      where: { status: filters.status ? (filters.status as SupportTicketStatus) : undefined },
      include: { customer: { select: { id: true, whatsappNumber: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getForAdmin(ticketId: string) {
    const ticket = await this.prisma.client.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        customer: { select: { id: true, whatsappNumber: true, name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async updateForAdmin(ticketId: string, dto: UpdateTicketDto) {
    await this.getForAdmin(ticketId);
    return this.prisma.client.supportTicket.update({ where: { id: ticketId }, data: dto });
  }

  async replyForAdmin(ticketId: string, body: string, actor: AuthContext) {
    await this.getForAdmin(ticketId);
    return this.prisma.client.supportMessage.create({
      data: { ticketId, authorType: 'ADMIN', authorAdminId: actor.id, body },
    });
  }
}
