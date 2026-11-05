import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { END_PATTERN, HM_PATTERN } from '../group-slots';

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
  // Shortest and longest booking of this unit, in minutes (the longest a whole multiple of the shortest). Omitted: the
  // facility's own defaults. Checked in ResourcesService, which knows the facility's start grid.
  minDurationMinutes: z.number().int().positive().max(1440).optional(),
  maxDurationMinutes: z.number().int().positive().max(1440).optional(),
});
export class CreateResourceDto extends createZodDto(createResourceSchema) {}

// Block (false) or reopen (true) booking on one unit. Existing bookings are untouched.
export const setResourceBookableSchema = z.object({ isBookable: z.boolean() });
export class SetResourceBookableDto extends createZodDto(setResourceBookableSchema) {}

// What customers read about one unit (empty clears it).
export const setResourceDescriptionSchema = z.object({ description: z.string().max(2000).transform((v) => v.trim()) });
export class SetResourceDescriptionDto extends createZodDto(setResourceDescriptionSchema) {}

// A unit's shortest and longest booking. Its prices are per block of the shortest.
export const setResourceDurationsSchema = z.object({
  minDurationMinutes: z.number().int().positive().max(1440),
  maxDurationMinutes: z.number().int().positive().max(1440),
});
export class SetResourceDurationsDto extends createZodDto(setResourceDurationsSchema) {}

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

// One fixed slot of a pooled item: a time range with its own number of items and its own price per item.
export const fixedSlotSchema = z.object({
  start: z.string().regex(HM_PATTERN, 'Use a time like 08:00'),
  end: z.string().regex(END_PATTERN, 'Use a time like 09:30'),
  count: z.number().int().min(1, 'Enter how many are available.').max(10000),
  price: z.number().nonnegative().max(1_000_000).nullable().optional(),
  advance: z.number().nonnegative().max(1_000_000).nullable().optional(),
});

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
    slotMode: z.enum(['FLEXIBLE', 'FIXED']).default('FLEXIBLE'),
    fixedSlots: z.array(fixedSlotSchema).max(48).default([]),
  })
  .refine(
    (d) => d.allocationMode !== 'POOLED' || d.totalUnits !== undefined,
    { message: 'POOLED groups require totalUnits' },
  )
  .refine((d) => d.slotMode !== 'FIXED' || d.fixedSlots.length > 0, { message: 'Add at least one slot for fixed times' });
export class CreateResourceGroupDto extends createZodDto(createResourceGroupSchema) {}

// Changes to a pooled group: how many it has, whether it is open, and when its slots are.
export const updateResourceGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  totalUnits: z.number().int().positive().max(10000).optional(),
  isBookable: z.boolean().optional(),
  description: z.string().max(2000).transform((v) => v.trim()).optional(),
  slotMode: z.enum(['FLEXIBLE', 'FIXED']).optional(),
  fixedSlots: z.array(fixedSlotSchema).max(48).optional(),
});
export class UpdateResourceGroupDto extends createZodDto(updateResourceGroupSchema) {}

// The order of a unit's photos: every one of its photo ids, main photo first.
export const reorderPhotosSchema = z.object({ photoIds: z.array(z.string().uuid()).min(1).max(3) });
export class ReorderPhotosDto extends createZodDto(reorderPhotosSchema) {}
