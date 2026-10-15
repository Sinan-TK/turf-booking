import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Durations are validated against the venue's BookingPolicy in the service
// (min/max/increment differ per venue type); the DTO only checks the shape.
const durationMinutes = z.number().int().positive().max(1440);

export const createHoldSchema = z
  .object({
    resourceId: z.string().uuid().optional(),
    // P2 pooled path: exactly one of resourceId/resourceGroupId.
    // quantity defaults to 1 so every pre-P2 client (resourceId only)
    // keeps hitting the exclusive path byte-identically.
    resourceGroupId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(100).default(1),
    startTime: z.string().datetime(),
    durationMinutes,
  })
  .refine((d) => !!d.resourceId !== !!d.resourceGroupId, {
    message: 'Exactly one of resourceId, resourceGroupId is required',
  });
export class CreateHoldDto extends createZodDto(createHoldSchema) {}

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});
export class CancelBookingDto extends createZodDto(cancelBookingSchema) {}

export const createOfflineBookingSchema = z.object({
  resourceId: z.string().uuid(),
  startTime: z.string().datetime(),
  durationMinutes,
  // Reused as the lookup/creation key exactly like the WhatsApp flow
  // (CustomersService.findOrCreateByWhatsAppNumber) — a walk-in
  // customer is still a real CustomerProfile, not a placeholder.
  customerWhatsappNumber: z.string().min(6).max(20),
  customerName: z.string().max(150).optional(),
  // Optional: falls back to the configured PricingRule for this
  // resource/duration/day-type if omitted. Required only when no such
  // rule exists. Must be positive when supplied manually — a real
  // walk-in booking was paid for something; a free/₹0 "booking" is not
  // this endpoint's job (that's a promotion/comp, tracked elsewhere)
  // and would otherwise let a slot be reserved while recording zero
  // revenue with no policy check at all. Capped generously to keep a
  // fat-fingered extra zero from creating an absurd audit/commission
  // figure.
  amount: z.number().positive().max(1_000_000).optional(),
});
export class CreateOfflineBookingDto extends createZodDto(createOfflineBookingSchema) {}
