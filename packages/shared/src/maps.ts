import { z } from 'zod';
import { googleMapsUrlProblem } from './maps-url';

/** Empty or missing clears the link (null); anything else must pass `googleMapsUrlProblem`. */
export const optionalGoogleMapsUrlSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v.trim() === '' ? null : v.trim()))
  .superRefine((v, ctx) => {
    const problem = v === null ? undefined : googleMapsUrlProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
