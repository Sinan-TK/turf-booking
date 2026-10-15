import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const saveVenueSchema = z.object({
  venueId: z.string().uuid(),
});
export class SaveVenueDto extends createZodDto(saveVenueSchema) {}
