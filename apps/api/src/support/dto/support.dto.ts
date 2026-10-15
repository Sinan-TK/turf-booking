import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createTicketSchema = z.object({
  category: z.enum([
    'REFUND_ISSUE',
    'PAID_BUT_BOOKING_FAILED',
    'BOOKING_ISSUE',
    'ACCOUNT_PROFILE_ISSUE',
    'OTHER',
  ]),
  subject: z.string().min(1).max(150),
  description: z.string().min(1).max(2000),
  bookingId: z.string().uuid().optional(),
  venueId: z.string().uuid().optional(),
});
export class CreateTicketDto extends createZodDto(createTicketSchema) {}

export const updateTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});
export class UpdateTicketDto extends createZodDto(updateTicketSchema) {}

export const replyTicketSchema = z.object({
  body: z.string().min(1).max(2000),
});
export class ReplyTicketDto extends createZodDto(replyTicketSchema) {}
