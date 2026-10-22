import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(150),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6).max(20),
});
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

export const createOwnerUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(150),
  phone: z.string().min(6).max(20).optional(),
  role: z.enum(['OWNER_ADMIN', 'OWNER_STAFF']).default('OWNER_ADMIN'),
  // Staff only: the venues they work in (an owner admin reaches every venue of the organization).
  venueIds: z.array(z.string().uuid()).max(200).optional(),
  // No password field: IdentityService creates the account passwordless
  // and emails the owner a link to set their own — this backend never
  // chooses or receives a credential for them.
});
export class CreateOwnerUserDto extends createZodDto(createOwnerUserSchema) {}

export const setOrganizationStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().max(500).optional(),
});
export class SetOrganizationStatusDto extends createZodDto(setOrganizationStatusSchema) {}

export const setOwnerUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().max(500).optional(),
});
export class SetOwnerUserStatusDto extends createZodDto(setOwnerUserStatusSchema) {}
