import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCountrySchema = z.object({
  name: z.string().min(1).max(100),
  isoCode: z.string().length(2).toUpperCase(),
});
export class CreateCountryDto extends createZodDto(createCountrySchema) {}

export const createStateSchema = z.object({
  countryId: z.string().uuid(),
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(10).toUpperCase(),
});
export class CreateStateDto extends createZodDto(createStateSchema) {}

export const createDistrictSchema = z.object({
  stateId: z.string().uuid(),
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(10).toUpperCase(),
  timezone: z.string().min(1),
});
export class CreateDistrictDto extends createZodDto(createDistrictSchema) {}

export const createAreaSchema = z
  .object({
    districtId: z.string().uuid(),
    name: z.string().min(1).max(100),
    // The town's centre; both or neither.
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((a) => (a.lat === undefined) === (a.lng === undefined), { message: 'Give both latitude and longitude, or neither.', path: ['lat'] });
export class CreateAreaDto extends createZodDto(createAreaSchema) {}

const status = z.enum(['ACTIVE', 'INACTIVE']);

/** The code is part of facility codes already handed out, so it is not editable: only the name and the on/off switch. */
export const updateStateSchema = z.object({ name: z.string().min(1).max(100).optional(), status: status.optional() }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
export class UpdateStateDto extends createZodDto(updateStateSchema) {}

export const updateDistrictSchema = z
  .object({ name: z.string().min(1).max(100).optional(), timezone: z.string().min(1).optional(), status: status.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
export class UpdateDistrictDto extends createZodDto(updateDistrictSchema) {}

export const updateAreaSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    // null clears the centre; both or neither, as when creating.
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    status: status.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
  .refine((a) => (a.lat === undefined) === (a.lng === undefined) && (a.lat === null) === (a.lng === null), {
    message: 'Give both latitude and longitude (or clear both).',
    path: ['lat'],
  });
export class UpdateAreaDto extends createZodDto(updateAreaSchema) {}
