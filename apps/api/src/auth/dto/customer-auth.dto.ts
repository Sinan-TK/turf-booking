import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { passwordPolicyProblem } from '@venue/shared';

export const requestCodeSchema = z.object({ phone: z.string().min(1).max(30) });
export class RequestCodeDto extends createZodDto(requestCodeSchema) {}

export const verifyCodeSchema = z.object({
  phone: z.string().min(1).max(30),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export class VerifyCodeDto extends createZodDto(verifyCodeSchema) {}

const email = z.string().trim().email('Enter a valid email address, like you@example.com.').max(254);
const newPassword = z
  .string()
  .max(128, 'Use at most 128 characters.')
  .superRefine((v, ctx) => {
    const problem = passwordPolicyProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
const name = z.string().trim().min(1, 'Enter your name.').max(80);

/** Google's signed ID token, as the browser's "Sign in with Google" button returns it. */
export const googleLoginSchema = z.object({ credential: z.string().min(1).max(4000) });
export class GoogleLoginDto extends createZodDto(googleLoginSchema) {}

export const signUpSchema = z.object({
  name,
  email,
  phone: z.string().trim().min(1, 'Enter your phone number.').max(30),
  password: newPassword,
});
export class SignUpDto extends createZodDto(signUpSchema) {}

export const emailCheckSchema = z.object({ email });
export class EmailCheckDto extends createZodDto(emailCheckSchema) {}

// The login password is deliberately not length-checked, so the policy isn't revealed.
export const passwordLoginSchema = z.object({ email, password: z.string().min(1).max(128) });
export class PasswordLoginDto extends createZodDto(passwordLoginSchema) {}

export const forgotPasswordSchema = z.object({ email });
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}

const emailCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');

export const verifySignUpSchema = z.object({ email, code: emailCode, ticket: z.string().min(20).max(200) });
export class VerifySignUpDto extends createZodDto(verifySignUpSchema) {}

export const verifyEmailSchema = z.object({ code: emailCode });
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}

export const resetPasswordSchema = z.object({ email, code: emailCode, password: newPassword });
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword });
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

export const updateProfileSchema = z
  .object({
    name: name.optional(),
    phone: z.string().trim().min(1, 'Enter your phone number.').max(30).optional(),
    email: email.optional(),
  })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.email !== undefined, {
    message: 'Nothing to update.',
  });
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
