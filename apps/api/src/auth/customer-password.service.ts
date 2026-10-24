import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { loadEnv } from '@venue/config';
import { hashPassword, verifyPassword } from '@venue/database';
import { constantTimeEquals, generateSecureToken, hashToken } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService, normalizeEmail } from '../customers/customers.service';
import { MailService } from '../identity/mail.service';
import { normalizePhone } from '../common/phone';

type CodePurpose = 'SIGNUP' | 'RESET';
interface SignUpPayload {
  name: string;
  phone: string;
  passwordHash: string;
  /** sha256 of the ticket handed to the browser that started this sign-up; only that browser can finish it. */
  ticketHash: string;
}

const INVALID_LOGIN = 'Incorrect email or password';
const INVALID_CODE = 'That code is incorrect or has expired.';
const NO_PASSWORD_YET =
  "You haven't set a password yet. Use Forgot password on the sign-in screen to set one.";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Customer email + password. Sign-up and password reset both prove the mailbox with a six-digit code sent by
 * email: the sign-up details wait in a pending row and the account only exists once the code is entered, so an
 * address nobody proved never holds one; a reset needs the code too. Codes are stored as an HMAC (never in
 * clear), single use, short lived, limited per code (attempts) and per address (cooldown, hourly cap). Sign-in
 * runs one hash comparison every time so timing doesn't reveal whether the account exists, and gives one
 * message for every failure. A customer who only ever used Google has no password; they set one through
 * Forgot password. A pending sign-up is bound to the browser that started it by a one-time ticket, so someone
 * else starting a sign-up for the same address can neither finish nor take over another person's.
 */
@Injectable()
export class CustomerPasswordService {
  private readonly logger = new Logger(CustomerPasswordService.name);
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly mail: MailService,
  ) {}

  /** Checks the details, emails a code, and holds the sign-up until the code comes back (see verifySignUp). */
  async startSignUp(input: { name: string; email: string; phone: string; password: string }) {
    const env = loadEnv();
    const phone = normalizePhone(input.phone, env.DEFAULT_COUNTRY_CODE);
    if (!phone) throw new BadRequestException('Enter a valid phone number, like +91 98765 43210.');
    const email = normalizeEmail(input.email);
    await this.customers.assertSignUpPossible(email, phone);
    const ticket = generateSecureToken();
    const payload: SignUpPayload = {
      name: input.name.trim(),
      phone,
      passwordHash: await hashPassword(input.password),
      ticketHash: hashToken(ticket),
    };
    await this.issueCode(email, 'SIGNUP', payload, payload.name, { explicit: true });
    return { ticket, expiresInMinutes: env.EMAIL_OTP_TTL_MINUTES, resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
  }

  /** The emailed code creates the account, with the address marked verified. */
  async verifySignUp(rawEmail: string, code: string, ticket: string) {
    const email = normalizeEmail(rawEmail);
    const ticketHash = hashToken(ticket);
    const row = await this.consumeCode(email, 'SIGNUP', code, (r) => {
      const stored = (r.payload as unknown as SignUpPayload | null)?.ticketHash;
      return !!stored && constantTimeEquals(stored, ticketHash);
    });
    const payload = row.payload as unknown as SignUpPayload;
    return this.customers.signUp({ name: payload.name, phone: payload.phone, passwordHash: payload.passwordHash, email });
  }

  async login(email: string, password: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { email: normalizeEmail(email) } });
    // Always run one scrypt verification, so response time doesn't reveal whether the account exists
    // or has a password at all.
    const hash = customer?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await verifyPassword(password, hash);
    if (!customer || !customer.passwordHash || !passwordOk || customer.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    return customer;
  }

  /** Always resolves, whether or not an account exists (and whether or not the mail could be sent). */
  async forgotPassword(rawEmail: string): Promise<void> {
    try {
      const email = normalizeEmail(rawEmail);
      const customer = await this.prisma.client.customerProfile.findUnique({ where: { email } });
      if (!customer?.email || customer.status !== 'ACTIVE') return;
      await this.issueCode(email, 'RESET', null, customer.name ?? 'there', { explicit: false });
    } catch (error) {
      // Never reveal anything through an error: log it and answer as if it worked.
      this.logger.error(`forgot-password failed: ${String(error)}`);
    }
  }

  async resetPassword(rawEmail: string, code: string, password: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { email } });
    // The same message whether the address has no account or the code is wrong, so this can't be used to probe.
    if (!customer || customer.status !== 'ACTIVE') throw new BadRequestException(INVALID_CODE);
    await this.consumeCode(email, 'RESET', code);
    const passwordHash = await hashPassword(password);
    await this.prisma.client.$transaction([
      // Entering the emailed code proves the customer reads this mailbox.
      this.prisma.client.customerProfile.update({ where: { id: customer.id }, data: { passwordHash, emailVerified: true } }),
      this.prisma.client.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  /** Returns the customer; the caller starts a fresh session (every old one is revoked here). */
  async changePassword(customerId: string, currentPassword: string, newPassword: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { id: customerId } });
    if (!customer) throw new UnauthorizedException('Authentication required');
    if (customer.status !== 'ACTIVE') throw new ForbiddenException('This account has been blocked. Please contact support.');
    if (!customer.passwordHash) throw new BadRequestException(NO_PASSWORD_YET);
    if (!(await verifyPassword(currentPassword, customer.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.customerProfile.update({ where: { id: customerId }, data: { passwordHash } }),
      this.prisma.client.customerSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return customer;
  }

  private hashCode(email: string, purpose: CodePurpose, code: string): string {
    return createHmac('sha256', loadEnv().CUSTOMER_SESSION_SECRET).update(`email:${purpose}:${email}:${code}`).digest('hex');
  }

  /**
   * Creates a fresh code (retiring older ones) and emails it. `explicit` means the caller may be told about
   * limits and delivery trouble (sign-up); otherwise limits and failures are silent (forgot password).
   */
  private async issueCode(email: string, purpose: CodePurpose, payload: SignUpPayload | null, name: string, opts: { explicit: boolean }) {
    const env = loadEnv();
    const now = new Date();
    const recent = await this.prisma.client.customerEmailCode.findMany({
      where: { email, purpose, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    const wait = !!recent[0] && now.getTime() - recent[0].createdAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    if (recent.length >= env.OTP_MAX_CODES_PER_HOUR || wait) {
      if (!opts.explicit) return;
      throw new HttpException(
        wait ? `Please wait ${env.OTP_RESEND_COOLDOWN_SECONDS} seconds before asking for another code.` : 'Too many codes requested. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.client.$transaction([
      this.prisma.client.customerEmailCode.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.client.customerEmailCode.create({
        data: {
          email,
          purpose,
          codeHash: this.hashCode(email, purpose, code),
          payload: payload ? { ...payload } : undefined,
          expiresAt: new Date(now.getTime() + env.EMAIL_OTP_TTL_MINUTES * 60_000),
        },
      }),
    ]);

    const sent = await this.sendCode(email, purpose, code, name);
    if (!sent && this.mail.isConfigured()) {
      // Never leave a code the customer never received usable.
      await this.prisma.client.customerEmailCode.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      if (opts.explicit) throw new ServiceUnavailableException('Could not send the code. Please try again.');
    }
  }

  private sendCode(to: string, purpose: CodePurpose, code: string, rawName: string) {
    const env = loadEnv();
    const name = rawName || 'there';
    const minutes = env.EMAIL_OTP_TTL_MINUTES;
    const signup = purpose === 'SIGNUP';
    const heading = signup ? 'Verify your email' : 'Reset your password';
    const intro = signup
      ? 'Use this code to finish creating your Venue Booking account.'
      : 'Use this code to set a new password for your Venue Booking account.';
    return this.mail.send({
      to,
      subject: signup ? `${code} is your Venue Booking verification code` : `${code} is your Venue Booking password reset code`,
      text: `Hi ${name},\n\n${intro}\n\nYour code: ${code}\n\nIt works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>${intro}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.</p>`,
      template: env.RESEND_OTP_TEMPLATE_ID
        ? { id: env.RESEND_OTP_TEMPLATE_ID, variables: { HEADING: heading, INTRO: intro, CODE: code, NAME: escapeHtml(name), EXPIRES_IN_MINUTES: minutes } }
        : undefined,
    });
  }

  /** Checks the code against the newest live one for this address and purpose and uses it up. */
  private async consumeCode(email: string, purpose: CodePurpose, code: string, extraCheck?: (row: { payload: unknown }) => boolean) {
    const env = loadEnv();
    const now = new Date();
    const latest = await this.prisma.client.customerEmailCode.findFirst({
      where: { email, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw new BadRequestException(INVALID_CODE);
    // Count the attempt before comparing, atomically, so parallel guesses can't exceed the limit.
    const counted = await this.prisma.client.customerEmailCode.update({ where: { id: latest.id }, data: { attempts: { increment: 1 } } });
    if (counted.attempts > env.OTP_MAX_ATTEMPTS) throw new BadRequestException('Too many attempts. Ask for a new code.');
    if (!constantTimeEquals(latest.codeHash, this.hashCode(email, purpose, code))) throw new BadRequestException(INVALID_CODE);
    // Checked before the code is used up, so a wrong ticket can't burn someone else's code.
    if (extraCheck && !extraCheck(latest)) throw new BadRequestException(INVALID_CODE);
    // Single-use claim: only one concurrent request can flip consumedAt.
    const claimed = await this.prisma.client.customerEmailCode.updateMany({ where: { id: latest.id, consumedAt: null }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw new BadRequestException(INVALID_CODE);
    return latest;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }
}
