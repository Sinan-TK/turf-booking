import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestCodeSchema = z.object({ phone: z.string().min(1).max(30) });
export class RequestCodeDto extends createZodDto(requestCodeSchema) {}

export const verifyCodeSchema = z.object({
  phone: z.string().min(1).max(30),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export class VerifyCodeDto extends createZodDto(verifyCodeSchema) {}

export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(80) });
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
