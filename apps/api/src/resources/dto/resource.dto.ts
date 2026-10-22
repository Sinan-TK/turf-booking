import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createResourceSchema = z.object({
  venueId: z.string().uuid(),
  // The facility (VenueCategory) this unit belongs to. Must be active.
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(100),
  // Open string, not a hardcoded enum — generalizes past 5s/7s
  // (ARCHITECTURE.md §5.2).
  // Only meaningful for a facility with preset unit types, where it must be one of them. For a
  // facility without presets it is ignored and stored blank (see ResourcesService).
  groundType: z.string().trim().max(20).default(''),
  isBookable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export class CreateResourceDto extends createZodDto(createResourceSchema) {}

// Block (false) or reopen (true) booking on one unit. Existing bookings are untouched.
export const setResourceBookableSchema = z.object({ isBookable: z.boolean() });
export class SetResourceBookableDto extends createZodDto(setResourceBookableSchema) {}

// Same, for every unit of one facility inside one venue.
export const setFacilityBookableSchema = z.object({
  venueId: z.string().uuid(),
  categoryId: z.string().uuid(),
  isBookable: z.boolean(),
});
export class SetFacilityBookableDto extends createZodDto(setFacilityBookableSchema) {}

export const createCompositionSchema = z.object({
  parentResourceId: z.string().uuid(),
  childResourceId: z.string().uuid(),
});
export class CreateCompositionDto extends createZodDto(createCompositionSchema) {}

// P2: named inventory pools inside a venue. POOLED groups (kayak fleets)
// require totalUnits — the counted capacity the atomic writer guards;
// EXCLUSIVE groups are organizational only and leave it null.
export const createResourceGroupSchema = z
  .object({
    venueId: z.string().uuid(),
    categoryId: z.string().uuid(),
    name: z.string().min(1).max(100),
    allocationMode: z.enum(['EXCLUSIVE', 'POOLED']),
    totalUnits: z.number().int().positive().max(10000).optional(),
    sortOrder: z.number().int().default(0),
  })
  .refine(
    (d) => d.allocationMode !== 'POOLED' || d.totalUnits !== undefined,
    { message: 'POOLED groups require totalUnits' },
  );
export class CreateResourceGroupDto extends createZodDto(createResourceGroupSchema) {}
