import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** The business's payout details, plus the password of the owner saving them (checked before anything is written). */
export const saveBankAccountSchema = z.object({
  accountHolderName: z.string().transform(clean).pipe(z.string().min(2, 'Enter the account holder name').max(120)),
  accountNumber: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{9,18}$/, 'The account number is 9 to 18 digits')),
  ifsc: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(IFSC_PATTERN, 'Enter a valid IFSC code, like HDFC0001234')),
  bankName: z.string().transform(clean).pipe(z.string().min(2, 'Enter the bank name').max(120)),
  branch: z
    .string()
    .transform(clean)
    .pipe(z.string().max(120))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  accountType: z.enum(['SAVINGS', 'CURRENT']).default('SAVINGS'),
  upiId: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.union([z.literal(''), z.string().regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/, 'Enter a valid UPI id, like name@bank')]))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  password: z.string().min(1, 'Enter your password to save changes').max(200),
});
export class SaveBankAccountDto extends createZodDto(saveBankAccountSchema) {}

export const failBankAccountSchema = z.object({
  reason: z.string().transform(clean).pipe(z.string().min(3, 'Say what is wrong, so the owner can fix it').max(300)),
});
export class FailBankAccountDto extends createZodDto(failBankAccountSchema) {}
