import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { hashPassword, verifyPassword } from '@venue/database';
import { generateSecureToken, hashToken } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService, normalizeEmail } from '../customers/customers.service';
import { MailService } from '../identity/mail.service';
import { normalizePhone } from '../common/phone';

const INVALID_LOGIN = 'Incorrect email or password';
const INVALID_LINK = 'This link is invalid or has expired';
const NO_PASSWORD_YET =
  "You haven't set a password yet. Use Forgot password on the sign-in screen to set one.";
/** One reset email per account per this long, so an address can't be mail-bombed through the form. */
const RESET_COOLDOWN_MS = 60_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Customer email + password: sign-up, sign-in, and the emailed reset link. Modelled on the staff flow
 * (StaffAuthService): one hash comparison on every login so timing doesn't reveal whether the account exists,
 * the same message for every failure, single-use hashed reset tokens, and every session revoked on reset.
 * A customer who only ever used Google has no password; they set one through Forgot password.
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

  async signUp(input: { name: string; email: string; phone: string; password: string }) {
    const phone = normalizePhone(input.phone, loadEnv().DEFAULT_COUNTRY_CODE);
    if (!phone) throw new BadRequestException('Enter a valid phone number, like +91 98765 43210.');
    const passwordHash = await hashPassword(input.password);
    return this.customers.signUp({ name: input.name.trim(), email: input.email, phone, passwordHash });
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
  async forgotPassword(email: string): Promise<void> {
    try {
      const customer = await this.prisma.client.customerProfile.findUnique({ where: { email: normalizeEmail(email) } });
      if (!customer?.email || customer.status !== 'ACTIVE') return;

      const recent = await this.prisma.client.customerAuthToken.findFirst({
        where: { customerId: customer.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
        select: { id: true },
      });
      if (recent) return;

      const env = loadEnv();
      const raw = generateSecureToken();
      // A new link supersedes any outstanding one.
      await this.prisma.client.customerAuthToken.updateMany({
        where: { customerId: customer.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.prisma.client.customerAuthToken.create({
        data: {
          customerId: customer.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      });

      const link = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(raw)}`;
      const name = customer.name ?? 'there';
      const expiry = `${env.RESET_TOKEN_TTL_MINUTES} minutes`;
      await this.mail.send({
        to: customer.email,
        subject: 'Set or reset your Venue Booking password',
        text: `Hi ${name},\n\nUse this link to set a new password for your Venue Booking account:\n\n${link}\n\nThis link works once and expires in ${expiry}. If you did not ask for it, you can ignore this email.`,
        html: `<p>Hi ${escapeHtml(name)},</p><p>Use this link to set a new password for your Venue Booking account:</p><p><a href="${escapeHtml(link)}">Set your password</a></p><p>This link works once and expires in ${expiry}. If you did not ask for it, you can ignore this email.</p>`,
      });
    } catch (error) {
      // Never reveal anything through an error: log it and answer as if it worked.
      this.logger.error(`forgot-password failed: ${String(error)}`);
    }
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    const token = await this.prisma.client.customerAuthToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { customer: { select: { status: true } } },
    });
    if (!token || token.usedAt || token.expiresAt <= new Date() || token.customer.status !== 'ACTIVE') {
      throw new BadRequestException(INVALID_LINK);
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.client.$transaction(async (tx) => {
      // Atomic single-use claim: two requests with the same link can't both win.
      const claimed = await tx.customerAuthToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
      await tx.customerAuthToken.updateMany({ where: { customerId: token.customerId, usedAt: null }, data: { usedAt: new Date() } });
      // Following the emailed link proves the customer reads this mailbox.
      await tx.customerProfile.update({ where: { id: token.customerId }, data: { passwordHash, emailVerified: true } });
      await tx.customerSession.updateMany({ where: { customerId: token.customerId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
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

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }
}
