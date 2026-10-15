import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createPricingRuleSchema = z
  .object({
    resourceId: z.string().uuid().optional(),
    // P2: exactly one of resourceId/resourceGroupId. Pre-P2 clients send
    // resourceId only and keep the exclusive behavior byte-identically.
    resourceGroupId: z.string().uuid().optional(),
    // Shape only: the allowed durations are the venue's BookingPolicy and
    // are checked in VenueConfigService.
    durationMinutes: z.number().int().positive().max(1440),
    dayType: z.enum(['WEEKDAY', 'WEEKEND', 'HOLIDAY']),
    startWindow: z.string().max(5).optional(),
    endWindow: z.string().max(5).optional(),
    // PER_UNIT multiplies price by booked quantity (kayak fleet);
    // PER_BOOKING charges once. Defaults to legacy flat behavior.
    pricingMode: z.enum(['PER_BOOKING', 'PER_UNIT']).default('PER_BOOKING'),
    price: z.number().nonnegative(),
    currency: z.string().length(3).default('INR'),
    // Defaults to now — a future-dated value schedules a price change
    // without touching bookings already resolved against the current rule.
    effectiveFrom: z.string().datetime().optional(),
  })
  .refine((d) => !!d.resourceId !== !!d.resourceGroupId, {
    message: 'Exactly one of resourceId, resourceGroupId is required',
  });
export class CreatePricingRuleDto extends createZodDto(createPricingRuleSchema) {}

export const upsertOperatingHoursSchema = z.object({
  venueId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6), // 0 = Sunday .. 6 = Saturday, matches OperatingHours model
  openTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm'),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:mm'),
});
export class UpsertOperatingHoursDto extends createZodDto(upsertOperatingHoursSchema) {}

export const createBlockedDateSchema = z.object({
  venueId: z.string().uuid(),
  resourceId: z.string().uuid().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  reason: z.string().max(300).optional(),
});
export class CreateBlockedDateDto extends createZodDto(createBlockedDateSchema) {}
