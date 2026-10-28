import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CLOCK = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const createPricingRuleSchema = z
  .object({
    resourceId: z.string().uuid().optional(),
    // P2: exactly one of resourceId/resourceGroupId. Pre-P2 clients send
    // resourceId only and keep the exclusive behavior byte-identically.
    resourceGroupId: z.string().uuid().optional(),
    // Only a pooled group is priced per duration (checked in VenueConfigService). A unit's price is per block of its own
    // minimum booking length, so for a unit this is ignored.
    durationMinutes: z.number().int().positive().max(1440).optional(),
    // The days of the week this price applies to, ISO numbers 1 = Monday .. 7 = Sunday.
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    // Legacy shorthand for days: WEEKDAY = Mon-Fri, WEEKEND = Sat-Sun. Ignored when `days` is sent.
    dayType: z.enum(['WEEKDAY', 'WEEKEND']).optional(),
    // Optional time of day the price applies to, by slot START time: [startWindow, endWindow).
    // Send both or neither; omit for "all day". endWindow may be "24:00".
    startWindow: z.string().regex(CLOCK, 'Expected HH:mm').optional(),
    endWindow: z.string().regex(CLOCK, 'Expected HH:mm').optional(),
    // PER_UNIT multiplies price by booked quantity (kayak fleet);
    // PER_BOOKING charges once. Defaults to legacy flat behavior.
    pricingMode: z.enum(['PER_BOOKING', 'PER_UNIT']).default('PER_BOOKING'),
    // Normal price: the full price of a slot. `price` is the same thing under its old name.
    normalPrice: z.number().nonnegative().optional(),
    price: z.number().nonnegative().optional(),
    // Optional offer, below the normal price; when set it is the full price instead.
    offerPrice: z.number().nonnegative().nullable().optional(),
    // The advance paid online (at most the full price); defaults to the full price.
    bookingPrice: z.number().nonnegative().optional(),
    currency: z.string().length(3).default('INR'),
    // Defaults to now — a future-dated value schedules a price change
    // without touching bookings already resolved against the current rule.
    effectiveFrom: z.string().datetime().optional(),
  })
  .refine((d) => !!d.resourceId !== !!d.resourceGroupId, {
    message: 'Exactly one of resourceId, resourceGroupId is required',
  })
  .refine((d) => !d.resourceGroupId || d.durationMinutes !== undefined, {
    message: 'Enter the duration this price is for',
  })
  .refine((d) => d.normalPrice !== undefined || d.price !== undefined, {
    message: 'Enter the normal price',
  })
  .refine((d) => d.days !== undefined || d.dayType !== undefined, {
    message: 'Choose the days this price applies to',
  })
  .refine((d) => (d.startWindow === undefined) === (d.endWindow === undefined), {
    message: 'Send both startWindow and endWindow, or neither',
  })
  .refine((d) => d.startWindow === undefined || d.endWindow === undefined || toMinutes(d.startWindow) < toMinutes(d.endWindow), {
    message: 'The time window must end after it starts',
  });
export class CreatePricingRuleDto extends createZodDto(createPricingRuleSchema) {}

// Change any of a price's fields. isActive blocks (false) or turns back on (true) a price without
// deleting it. To make a timed price all-day, send startWindow and endWindow as null.
export const updatePricingRuleSchema = z
  .object({
    isActive: z.boolean().optional(),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    durationMinutes: z.number().int().positive().max(1440).optional(),
    startWindow: z.string().regex(CLOCK, 'Expected HH:mm').nullable().optional(),
    endWindow: z.string().regex(CLOCK, 'Expected HH:mm').nullable().optional(),
    normalPrice: z.number().nonnegative().optional(),
    price: z.number().nonnegative().optional(),
    offerPrice: z.number().nonnegative().nullable().optional(),
    bookingPrice: z.number().nonnegative().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update' })
  .refine((d) => (d.startWindow === undefined) === (d.endWindow === undefined), {
    message: 'Send both startWindow and endWindow, or neither',
  })
  .refine((d) => (d.startWindow === null) === (d.endWindow === null), {
    message: 'Send both startWindow and endWindow, or neither',
  })
  .refine(
    (d) => !d.startWindow || !d.endWindow || toMinutes(d.startWindow) < toMinutes(d.endWindow),
    { message: 'The time window must end after it starts' },
  );
export class UpdatePricingRuleDto extends createZodDto(updatePricingRuleSchema) {}


export const createBlockedDateSchema = z.object({
  venueId: z.string().uuid(),
  resourceId: z.string().uuid().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  reason: z.string().max(300).optional(),
});
export class CreateBlockedDateDto extends createZodDto(createBlockedDateSchema) {}
