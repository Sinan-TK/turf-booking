import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The category-scope default BookingPolicy. Cross-field rules are checked
 * here so a bad policy can never be stored: the interval must tile a day,
 * durations must be reachable from the minimum in whole increments.
 */
export const categoryPolicySchema = z
  .object({
    slotIntervalMin: z.number().int().min(5).max(240),
    minDurationMin: z.number().int().min(5).max(1440),
    maxDurationMin: z.number().int().min(5).max(1440),
    durationIncrementMin: z.number().int().min(5).max(1440),
    bufferBeforeMin: z.number().int().min(0).max(240).default(0),
    bufferAfterMin: z.number().int().min(0).max(240).default(0),
    maxAdvanceDays: z.number().int().min(1).max(365),
    minLeadMinutes: z.number().int().min(0).max(10080),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (1440 % p.slotIntervalMin !== 0) {
      issue('slotIntervalMin', 'Must divide evenly into a 24-hour day (e.g. 15, 30, 60)');
    }
    if (p.maxDurationMin < p.minDurationMin) {
      issue('maxDurationMin', 'Must be greater than or equal to the minimum duration');
    }
    if (p.minDurationMin % p.durationIncrementMin !== 0) {
      issue('minDurationMin', 'Must be a multiple of the duration increment');
    }
    if ((p.maxDurationMin - p.minDurationMin) % p.durationIncrementMin !== 0) {
      issue('maxDurationMin', 'Must be reachable from the minimum in whole duration increments');
    }
  });
export type CategoryPolicyInput = z.infer<typeof categoryPolicySchema>;

const unitTypes = z
  .array(z.string().trim().min(1).max(20))
  .max(30)
  .refine((list) => new Set(list.map((t) => t.toLowerCase())).size === list.length, {
    message: 'Unit types must be unique',
  });

export const createCategorySchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use 2–40 characters: A–Z, 0–9 and underscores, starting with a letter'),
  name: z.string().trim().min(1).max(80),
  defaultAllocationMode: z.enum(['EXCLUSIVE', 'POOLED']).default('EXCLUSIVE'),
  iconKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/, 'Use a Material Symbols icon name, e.g. sports_esports')
    .default('category'),
  unitLabel: z.string().trim().min(1).max(40).default('Unit'),
  venueLabel: z.string().trim().min(1).max(60).default('Venue'),
  unitTypes: unitTypes.default([]),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
  policy: categoryPolicySchema.optional(),
});
export class CreateCategoryDto extends createZodDto(createCategorySchema) {}

// slug is immutable once created (it is the stable identifier).
export const updateCategorySchema = createCategorySchema.omit({ slug: true }).partial();
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
