import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { passwordPolicyProblem } from '@venue/shared';

/** A NEW password: 8 or more characters with a capital, a small letter, a number and a special character. */
const password = z.string().max(128).superRefine((v, ctx) => {
  const problem = passwordPolicyProblem(v);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export const staffLoginSchema = z.object({
  email: z.string().email().max(254),
  // Not length-validated on login: never reveal the password policy to a
  // guesser, and legacy passwords must still be able to authenticate.
  password: z.string().min(1).max(128),
});
export class StaffLoginDto extends createZodDto(staffLoginSchema) {}

export const forgotPasswordSchema = z.object({ email: z.string().email().max(254) });
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
