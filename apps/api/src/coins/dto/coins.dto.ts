import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const adminAdjustCoinsSchema = z.object({
  customerId: z.string().uuid(),
  signedAmount: z.number().refine((v) => v !== 0, 'signedAmount must be non-zero'),
  reason: z.string().min(1).max(500),
});
export class AdminAdjustCoinsDto extends createZodDto(adminAdjustCoinsSchema) {}
