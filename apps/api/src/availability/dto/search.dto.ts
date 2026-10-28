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
    // Several venue types at once, comma-separated ("FOOTBALL_TURF,CRICKET_NETS"): a unit of any of them matches.
    categorySlugs: z
      .string()
      .max(1000)
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.string().min(1).max(40)).max(25).optional()),
    date: z.string().date(),
    timeWindow: z.nativeEnum(TimeWindow),
    // Whether this duration is offered is decided per venue by its
    // BookingPolicy (venues that do not offer it simply return no slots).
    // Omitted: every unit is shown at its own minimum booking length.
    durationMinutes: z.coerce.number().int().positive().max(1440).optional(),
    facilityCode: z.string().optional(),
    districtId: z.string().uuid().optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(100).default(10),
    // Paging: at most `limit` venues per request (each with all its units), and `cursor` (from the previous answer's X-Next-Cursor header) to
    // continue. Without a limit every result is returned in one go.
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().regex(/^\d+\.\d+$/, 'cursor is not valid').optional(),
    // Narrow to venues (or unit types) whose name, address or sub-type contains this text.
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => v.facilityCode || v.districtId || (v.lat !== undefined && v.lng !== undefined), {
    message: 'One of facilityCode, districtId, or lat+lng is required',
  });
export class SearchDto extends createZodDto(searchSchema) {}
