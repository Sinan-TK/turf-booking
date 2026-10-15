import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TimeWindow } from '@venue/shared';

export const searchSchema = z
  .object({
    // Optional filters: sub-type (Resource.groundType) and venue type.
    // Omitted = everything — the API no longer needs a placeholder value.
    groundType: z.string().min(1).optional(),
    categoryId: z.string().uuid().optional(),
    categorySlug: z.string().min(1).max(40).optional(),
    date: z.string().date(),
    timeWindow: z.nativeEnum(TimeWindow),
    // Whether this duration is offered is decided per venue by its
    // BookingPolicy (venues that do not offer it simply return no slots).
    durationMinutes: z.coerce.number().int().positive().max(1440),
    facilityCode: z.string().optional(),
    districtId: z.string().uuid().optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(100).default(10),
  })
  .refine((v) => v.facilityCode || v.districtId || (v.lat !== undefined && v.lng !== undefined), {
    message: 'One of facilityCode, districtId, or lat+lng is required',
  });
export class SearchDto extends createZodDto(searchSchema) {}
