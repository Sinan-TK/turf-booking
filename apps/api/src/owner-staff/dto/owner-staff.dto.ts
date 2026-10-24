import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { indianMobileSchema } from '../../common/phone';

const venueIds = z.array(z.string().uuid()).min(1, 'Choose at least one venue').max(200);

export const inviteStaffSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(150),
  phone: indianMobileSchema.optional(),
  venueIds,
});
export class InviteStaffDto extends createZodDto(inviteStaffSchema) {}

export const setStaffVenuesSchema = z.object({ venueIds });
export class SetStaffVenuesDto extends createZodDto(setStaffVenuesSchema) {}

export const setStaffStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });
export class SetStaffStatusDto extends createZodDto(setStaffStatusSchema) {}
