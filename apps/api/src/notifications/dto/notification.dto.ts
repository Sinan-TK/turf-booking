import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createAdminNotificationSchema = z
  .object({
    title: z.string().min(1).max(150),
    message: z.string().min(1).max(2000),
    type: z.enum(['ADMIN_ANNOUNCEMENT', 'ADMIN_WARNING']),
    recipientType: z.enum(['ALL', 'SELECTED']),
    ownerIds: z.array(z.string().uuid()).optional(),
  })
  // SELECTED without a non-empty ownerIds list is meaningless — caught
  // here rather than left for the service to silently notify nobody.
  .refine((val) => val.recipientType !== 'SELECTED' || (val.ownerIds?.length ?? 0) > 0, {
    message: 'ownerIds is required and must be non-empty when recipientType is SELECTED',
    path: ['ownerIds'],
  });
export class CreateAdminNotificationDto extends createZodDto(createAdminNotificationSchema) {}
