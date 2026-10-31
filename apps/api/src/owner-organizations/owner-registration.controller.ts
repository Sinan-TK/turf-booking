import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { indianMobileSchema } from '../common/phone';
import { OwnerRegistrationService } from './owner-registration.service';

export const registerOwnerSchema = z.object({
  businessName: z.string().trim().min(2).max(150),
  name: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(254),
  phone: indianMobileSchema,
  // The owner must have agreed to the Venue Partner Terms.
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept the Venue Partner Terms.' }) }),
});
export class RegisterOwnerDto extends createZodDto(registerOwnerSchema) {}

export const emailCheckSchema = z.object({ email: z.string().trim().email().max(254) });
export class EmailCheckDto extends createZodDto(emailCheckSchema) {}

/** Public: a venue owner creating their own account. */
@Controller('auth/owner')
export class OwnerRegistrationController {
  constructor(private readonly registration: OwnerRegistrationService) {}

  /** Whether an owner login already uses this email, so the sign-up (and the invite forms) can say so while it is being typed. */
  @Post('email-check')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async emailCheck(@Body() dto: EmailCheckDto) {
    return { available: !(await this.registration.emailTaken(dto.email)) };
  }

  @Post('register')
  @HttpCode(202)
  // Anyone can call it, and each call can send an email, so it is held to a few a hour from one address.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async register(@Body() dto: RegisterOwnerDto, @Req() req: Request) {
    await this.registration.register(dto, req.ip);
    return { ok: true };
  }
}
