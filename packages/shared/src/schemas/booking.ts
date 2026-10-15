import { z } from 'zod';
import { PaymentMethod } from '../enums';

export const createHoldRequestSchema = z
  .object({
    bookingSessionToken: z.string().min(16),
    resourceId: z.string().uuid().optional(),
    // P2 pooled path: exactly one of resourceId/resourceGroupId.
    resourceGroupId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(100).default(1),
    startTime: z.string().datetime(),
    durationMinutes: z.number().int().positive(),
  })
  .refine((d) => !!d.resourceId !== !!d.resourceGroupId, {
    message: 'Exactly one of resourceId, resourceGroupId is required',
  });
export type CreateHoldRequest = z.infer<typeof createHoldRequestSchema>;

/**
 * Money and coins are mutually exclusive by construction: this schema has
 * no field that accepts a split amount, only a single discriminant.
 * (ARCHITECTURE.md §9 — "Payment Method Rule")
 */
export const payForBookingRequestSchema = z.object({
  bookingId: z.string().uuid(),
  method: z.nativeEnum(PaymentMethod),
});
export type PayForBookingRequest = z.infer<typeof payForBookingRequestSchema>;

export const cancelBookingRequestSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type CancelBookingRequest = z.infer<typeof cancelBookingRequestSchema>;
