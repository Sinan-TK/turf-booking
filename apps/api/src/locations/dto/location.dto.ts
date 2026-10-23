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
