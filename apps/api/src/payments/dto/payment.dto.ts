import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrderSchema = z.object({
  bookingId: z.string().uuid(),
});
export class CreateOrderDto extends createZodDto(createOrderSchema) {}

export const verifyPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export class VerifyPaymentDto extends createZodDto(verifyPaymentSchema) {}
