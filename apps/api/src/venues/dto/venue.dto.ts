import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { googleMapsUrlProblem, optionalGoogleMapsUrlSchema } from '@venue/shared';

export const createVenueSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  districtId: z.string().uuid(),
  areaId: z.string().uuid().optional(),
  address: z.string().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  googleMapsUrl: optionalGoogleMapsUrlSchema,
  // How many days ahead customers can book: today and the next (n - 1) days. Defaults to 7; at most 14.
  advanceBookingDays: z.number().int().min(1, 'Choose at least 1 day.').max(14, 'Customers can book at most 14 days ahead.').optional(),
  // No timezone or facility here: the timezone comes from the district, and
  // the facilities (football turf, pool...) are the categories of the units
  // added under the venue.
  // defaultSlotGranularityMinutes is a fixed platform constant (60 minutes,
  // see packages/database/prisma/schema.prisma) — every venue runs on
  // whole-hour slots, so it's no longer client-settable here.
  // Only meaningful when the caller is SUPER_ADMIN — a Venue Owner's own
  // organizationId is always used instead, server-side, regardless of
  // what's in the request body (ARCHITECTURE.md §12).
  organizationId: z.string().uuid().optional(),
});
export class CreateVenueDto extends createZodDto(createVenueSchema) {}

export const updateVenueSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(2000).optional(),
  areaId: z.string().uuid().optional(),
  address: z.string().min(1).max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // undefined = leave as is; empty or null = remove the link.
  googleMapsUrl: z.string().nullable().optional().transform((v) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim())).superRefine((v, ctx) => {
    const problem = v ? googleMapsUrlProblem(v) : undefined;
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }),
  advanceBookingDays: z.number().int().min(1, 'Choose at least 1 day.').max(14, 'Customers can book at most 14 days ahead.').optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});
export class UpdateVenueDto extends createZodDto(updateVenueSchema) {}
