import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Where a banner sends the customer: a path on this site ("/explore?type=FOOTBALL_TURF") or an https address. Anything else (a
 * "javascript:" or "data:" address, a protocol-relative "//host") is refused, since the link is shown to every visitor.
 */
const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)[^\s]*$/.test(v) || /^https:\/\/[^\s/]+[^\s]*$/.test(v), 'Use a path on this site such as /explore, or an https:// address.');

const when = z.string().datetime({ offset: true });

const bannerFields = {
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(160).nullable().optional(),
  linkUrl: link.nullable().optional(),
  startsAt: when.nullable().optional(),
  endsAt: when.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};

const datesInOrder = (b: { startsAt?: string | null; endsAt?: string | null }) =>
  !b.startsAt || !b.endsAt || new Date(b.endsAt).getTime() > new Date(b.startsAt).getTime();

export const createBannerSchema = z.object(bannerFields).refine(datesInOrder, { message: 'The end must be after the start.', path: ['endsAt'] });
export class CreateBannerDto extends createZodDto(createBannerSchema) {}

export const updateBannerSchema = z
  .object({ ...bannerFields, title: bannerFields.title.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
  .refine(datesInOrder, { message: 'The end must be after the start.', path: ['endsAt'] });
export class UpdateBannerDto extends createZodDto(updateBannerSchema) {}
