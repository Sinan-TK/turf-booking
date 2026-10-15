import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createVenueSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  districtId: z.string().uuid(),
  areaId: z.string().uuid().optional(),
  address: z.string().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  // Venue type. Optional for backward compatibility: omitted = FOOTBALL_TURF.
  // Must be an ACTIVE category.
  categoryId: z.string().uuid().optional(),
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
  timezone: z.string().min(1).optional(),
  // Changeable only while the venue has no resources yet.
  categoryId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});
export class UpdateVenueDto extends createZodDto(updateVenueSchema) {}
