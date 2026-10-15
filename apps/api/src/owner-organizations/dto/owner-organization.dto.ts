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
  // No password field: IdentityService creates the account passwordless
  // and emails the owner a link to set their own — this backend never
  // chooses or receives a credential for them.
});
export class CreateOwnerUserDto extends createZodDto(createOwnerUserSchema) {}
