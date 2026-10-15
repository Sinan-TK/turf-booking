import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const tierSchema = z.object({
  minHoursBeforeStart: z.number().min(0),
  refundPercent: z.number().min(0).max(100),
});

export const createCancellationPolicySchema = z.object({
  scope: z.enum(['PLATFORM_DEFAULT', 'VENUE']),
  tiers: z.array(tierSchema).min(1),
});
export class CreateCancellationPolicyDto extends createZodDto(createCancellationPolicySchema) {}

export const createCommissionSchema = z.object({
  scope: z.enum(['PLATFORM_DEFAULT', 'ORGANIZATION']),
  organizationId: z.string().uuid().optional(),
  type: z.enum(['PERCENTAGE', 'FLAT']),
  value: z.number().min(0),
});
export class CreateCommissionDto extends createZodDto(createCommissionSchema) {}
