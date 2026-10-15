import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { loadEnv } from '@venue/config';
import { constantTimeEquals } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerSessionService } from './customer-session.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { normalizePhone } from '../common/phone';

const INVALID = 'Invalid or expired code';

/**
 * Phone + one-time-code login for the customer website. Codes are never
 * stored (only an HMAC keyed with CUSTOMER_SESSION_SECRET, because a
 * 6-digit code alone would be trivially brute-forced from a leaked hash),
 * are single use, expire quickly, and are limited per code (attempts) and
 * per phone (cooldown, hourly cap).
 */
@Injectable()
export class CustomerOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly sessions: CustomerSessionService,
    @Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,
  ) {}

  private hash(phone: string, code: string): string {
    return createHmac('sha256', loadEnv().CUSTOMER_SESSION_SECRET).update(`${phone}:${code}`).digest('hex');
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizePhone(raw, loadEnv().DEFAULT_COUNTRY_CODE);
    if (!phone) throw new BadRequestException('Enter a valid phone number');
    return phone;
  }

  async requestCode(rawPhone: string) {
    const env = loadEnv();
    const phone = this.phoneOrThrow(rawPhone);
    const now = new Date();

    const recent = await this.prisma.client.loginCode.findMany({
      where: { phone, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent.length >= env.OTP_MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new HttpException(
        `Please wait ${env.OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // A new code retires every older one, so only the newest can ever work.
    await this.prisma.client.$transaction([
      this.prisma.client.loginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.client.loginCode.create({
        data: {
          phone,
          codeHash: this.hash(phone, code),
          expiresAt: new Date(now.getTime() + env.OTP_TTL_MINUTES * 60_000),
        },
      }),
    ]);

    try {
      await this.messenger.loginCode(phone, code);
    } catch {
      // Never leave a code the customer never received usable.
      await this.prisma.client.loginCode.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw new ServiceUnavailableException('Could not send the code. Please try again.');
    }
    return { resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS, expiresInSeconds: env.OTP_TTL_MINUTES * 60 };
  }

  async verifyCode(rawPhone: string, code: string) {
    const env = loadEnv();
    const phone = this.phoneOrThrow(rawPhone);
    const now = new Date();

    const latest = await this.prisma.client.loginCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw new UnauthorizedException(INVALID);

    // Count the attempt before comparing, atomically, so parallel guesses
    // cannot exceed the limit.
    const counted = await this.prisma.client.loginCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    if (counted.attempts > env.OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }
    if (!constantTimeEquals(latest.codeHash, this.hash(phone, code))) {
      throw new UnauthorizedException(INVALID);
    }

    // Single-use claim: only one concurrent verify can flip consumedAt.
    const claimed = await this.prisma.client.loginCode.updateMany({
      where: { id: latest.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new UnauthorizedException(INVALID);

    const customer = await this.customers.findOrCreateByWhatsAppNumber(phone);
    const { rawToken } = await this.sessions.createSession(customer.id, 'LOGIN');
    return {
      rawToken,
      customer: { id: customer.id, name: customer.name, phone: customer.whatsappNumber },
      needsName: !customer.name,
    };
  }
}
