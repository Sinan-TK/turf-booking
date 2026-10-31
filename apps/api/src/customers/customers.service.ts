import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CustomerProfile, type CustomerStatus } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { contains } from '../common/list-filters';
import { INDIAN_MOBILE_MESSAGE, normalizeIndianMobile } from '../common/phone';

export const PHONE_TAKEN =
  'This number is already registered to another account. Sign in to that account, or use a different number.';
export const EMAIL_TAKEN = 'This email is already registered. Sign in, or use Forgot password.';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/**
 * What the customer's own web app is told about them. Never the password hash, never another account's data.
 * `phone` may be null (a Google or email account that hasn't given one), and each of phone and email says
 * whether it has been verified.
 */
export function customerView(c: Pick<CustomerProfile, 'id' | 'name' | 'whatsappNumber' | 'email' | 'phoneVerified' | 'emailVerified' | 'passwordHash'>) {
  return {
    id: c.id,
    name: c.name,
    phone: c.whatsappNumber,
    email: c.email,
    phoneVerified: c.phoneVerified,
    emailVerified: c.emailVerified,
    hasPassword: c.passwordHash !== null,
    /** Still missing what a booking needs (a name and a phone number): the web app asks for them. */
    needsProfile: !c.name || !c.whatsappNumber,
  };
}

/** Admin responses carry the profile but never the password hash. */
function withoutSecrets<T extends { passwordHash: string | null }>(row: T): Omit<T, 'passwordHash'> & { hasPassword: boolean } {
  const { passwordHash, ...rest } = row;
  return { ...rest, hasPassword: passwordHash !== null };
}

export interface AdminCustomerFilters {
  status?: string;
  /** Matches WhatsApp number, name or email. */
  search?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity. A customer is reached through one of three sign-in methods (a phone code, Google, email +
  // password); every one ends in the same CustomerProfile + CoinWallet pair, created together so each
  // customer has exactly one wallet from the moment they exist (never lazily on first credit).
  //
  // The phone number (`whatsappNumber`) is an identity only while `phoneVerified`: a number verified on
  // one account can't be used on any other, unverified numbers may repeat, and verifying a number clears
  // it from every other account still holding it unverified (see markPhoneVerified).
  // ---------------------------------------------------------------------------

  /** A phone-code login: the profile that owns this verified number, created (verified) the first time. */
  async findOrCreateByWhatsAppNumber(phone: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const verified = await tx.customerProfile.findFirst({ where: { whatsappNumber: phone, phoneVerified: true } });
          if (verified) return verified;

          // Venue staff may already have recorded this person as a walk-in. That profile has no credentials,
          // so nobody could be impersonating through it: it becomes theirs, history included.
          const guest = await tx.customerProfile.findFirst({
            where: { whatsappNumber: phone, phoneVerified: false, googleSub: null, passwordHash: null, email: null },
            orderBy: { createdAt: 'asc' },
          });
          const customer = guest ?? (await this.createWithWallet(tx, { whatsappNumber: phone }));
          return this.verifyPhoneIn(tx, customer.id, phone);
        });
      } catch (error) {
        // Two logins for a brand-new number raced and the other one verified it first (the unique index, or the
        // 'already verified' check, stopped this one). Start over: this time the winner's profile is found.
        const lostRace =
          error instanceof ConflictException ||
          (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');
        if (attempt < 2 && lostRace) continue;
        throw error;
      }
    }
  }

  /**
   * A customer recorded by venue staff (walk-in) or the booking-session shortcut: whoever already owns the
   * number, otherwise a credential-less, UNVERIFIED profile. Nothing proves the number belongs to them, so it
   * is never marked verified here (it becomes verified when they log in with the code).
   */
  async findOrCreateGuestByPhone(rawPhone: string) {
    const phone = normalizeIndianMobile(rawPhone);
    if (!phone) throw new BadRequestException(INDIAN_MOBILE_MESSAGE);
    const db = this.prisma.client;
    const verified = await db.customerProfile.findFirst({ where: { whatsappNumber: phone, phoneVerified: true } });
    if (verified) return verified;
    const guest = await db.customerProfile.findFirst({
      where: { whatsappNumber: phone, googleSub: null, passwordHash: null, email: null },
      orderBy: { createdAt: 'asc' },
    });
    if (guest) return guest;
    return db.$transaction((tx) => this.createWithWallet(tx, { whatsappNumber: phone }));
  }

  /**
   * Marks a number verified on this account (the one place that does). Refused when another profile already
   * holds it verified; otherwise every OTHER profile holding it unverified loses it (they are asked for a
   * number again next time) and the count is recorded in the audit log.
   */
  async markPhoneVerified(customerId: string, phone: string) {
    const customer = await this.prisma.client.$transaction((tx) => this.verifyPhoneIn(tx, customerId, phone));
    return customer;
  }

  private async verifyPhoneIn(tx: Prisma.TransactionClient, customerId: string, phone: string) {
    const holder = await tx.customerProfile.findFirst({
      where: { whatsappNumber: phone, phoneVerified: true, id: { not: customerId } },
      select: { id: true },
    });
    if (holder) throw new ConflictException(PHONE_TAKEN);
    // Cleared first, then set, so the verified-number unique index is never violated.
    const cleared = await tx.customerProfile.updateMany({
      where: { whatsappNumber: phone, phoneVerified: false, id: { not: customerId } },
      data: { whatsappNumber: null },
    });
    const customer = await tx.customerProfile.update({
      where: { id: customerId },
      data: { whatsappNumber: phone, phoneVerified: true },
    });
    if (cleared.count > 0) {
      await tx.auditLog.create({
        data: {
          action: 'PHONE_UNVERIFIED_CLEARED',
          entityType: 'CustomerProfile',
          entityId: customerId,
          actorType: 'SYSTEM',
          metadata: { cleared: cleared.count },
        },
      });
    }
    return customer;
  }

  /** The profile for a verified Google identity: found by Google id, linked by a verified email, or created. */
  async findOrCreateByGoogle(identity: { sub: string; email: string; name: string | null; picture: string | null }) {
    const email = normalizeEmail(identity.email);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const bySub = await tx.customerProfile.findUnique({ where: { googleSub: identity.sub } });
          if (bySub) return bySub;

          const holder = await tx.customerProfile.findUnique({ where: { email } });
          if (holder) {
            // The same mailbox, already proven (by a reset link) and not tied to another Google account: link it.
            if (holder.emailVerified && !holder.googleSub) {
              return tx.customerProfile.update({ where: { id: holder.id }, data: { googleSub: identity.sub } });
            }
            if (holder.emailVerified) throw new ConflictException(EMAIL_TAKEN);
            // Someone typed this address at sign-up without proving it: Google has proved it, so it is ours.
            // The other account keeps its history but loses the email and the password tied to it.
            await tx.customerProfile.update({ where: { id: holder.id }, data: { email: null, passwordHash: null } });
            await tx.auditLog.create({
              data: {
                action: 'EMAIL_UNVERIFIED_CLEARED',
                entityType: 'CustomerProfile',
                entityId: holder.id,
                actorType: 'SYSTEM',
                metadata: { reason: 'verified by Google sign-in' },
              },
            });
          }
          return this.createWithWallet(tx, {
            email,
            emailVerified: true,
            googleSub: identity.sub,
            name: identity.name,
            profilePhotoUrl: identity.picture,
          });
        });
      } catch (error) {
        if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
  }

  /** Whether a customer account already uses this email (other kinds of account do not count). */
  async emailTaken(rawEmail: string): Promise<boolean> {
    const found = await this.prisma.client.customerProfile.findUnique({ where: { email: normalizeEmail(rawEmail) }, select: { id: true } });
    return !!found;
  }

  /** Refuses early (before a code is emailed) a sign-up that could not succeed. */
  async assertSignUpPossible(email: string, phone: string) {
    const db = this.prisma.client;
    if (await db.customerProfile.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException(EMAIL_TAKEN);
    if (await db.customerProfile.findFirst({ where: { whatsappNumber: phone, phoneVerified: true }, select: { id: true } })) {
      throw new ConflictException(PHONE_TAKEN);
    }
  }

  /** Email + password sign-up, after the emailed code proved the address. The phone is not verified. */
  async signUp(input: { name: string; email: string; phone: string; passwordHash: string }) {
    const email = normalizeEmail(input.email);
    const db = this.prisma.client;
    if (await db.customerProfile.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException(EMAIL_TAKEN);
    if (await db.customerProfile.findFirst({ where: { whatsappNumber: input.phone, phoneVerified: true }, select: { id: true } })) {
      throw new ConflictException(PHONE_TAKEN);
    }
    try {
      return await db.$transaction((tx) =>
        this.createWithWallet(tx, {
          name: input.name,
          email,
          whatsappNumber: input.phone,
          passwordHash: input.passwordHash,
          emailVerified: true,
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException(EMAIL_TAKEN);
      throw error;
    }
  }

  /**
   * The customer edits their own profile. A verified phone or email is their identity and can't be changed
   * here; an unverified one can, and stays unverified. A number another account holds verified, or an email
   * any other account holds, is refused.
   */
  async updateProfile(customerId: string, input: { name?: string; phone?: string; email?: string }) {
    const db = this.prisma.client;
    const current = await db.customerProfile.findUnique({ where: { id: customerId } });
    if (!current) throw new NotFoundException('Customer not found');
    const data: Prisma.CustomerProfileUpdateInput = {};

    if (input.name !== undefined) data.name = input.name.trim();

    if (input.phone !== undefined) {
      // Saving the number already on the account again is fine (it may predate the Indian-mobile rule); a new one must pass it.
      const phone = input.phone.trim() === current.whatsappNumber ? current.whatsappNumber : normalizeIndianMobile(input.phone);
      if (!phone) throw new BadRequestException(INDIAN_MOBILE_MESSAGE);
      if (!(current.phoneVerified && current.whatsappNumber === phone)) {
        if (current.phoneVerified) {
          throw new BadRequestException("Your number is verified, so it can't be changed here.");
        }
        if (await db.customerProfile.findFirst({ where: { whatsappNumber: phone, phoneVerified: true, id: { not: customerId } }, select: { id: true } })) {
          throw new ConflictException(PHONE_TAKEN);
        }
        data.whatsappNumber = phone;
        data.phoneVerified = false;
      }
    }

    if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      if (!EMAIL_SHAPE.test(email)) throw new BadRequestException('Enter a valid email address, like you@example.com.');
      if (email !== current.email) {
        if (current.emailVerified) throw new BadRequestException("Your email is verified, so it can't be changed here.");
        if (await db.customerProfile.findFirst({ where: { email, id: { not: customerId } }, select: { id: true } })) {
          throw new ConflictException(EMAIL_TAKEN);
        }
        data.email = email;
        data.emailVerified = false;
      }
    }

    try {
      return await db.customerProfile.update({ where: { id: customerId }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(data.email ? EMAIL_TAKEN : PHONE_TAKEN);
      }
      throw error;
    }
  }

  /** Names a customer who has none yet (a walk-in recorded by venue staff). */
  async updateName(customerId: string, name: string) {
    return this.prisma.client.customerProfile.update({ where: { id: customerId }, data: { name } });
  }

  private async createWithWallet(tx: Prisma.TransactionClient, data: Prisma.CustomerProfileCreateInput) {
    const customer = await tx.customerProfile.create({ data });
    await tx.coinWallet.create({ data: { customerId: customer.id } });
    return customer;
  }

  getOwnProfile(customerId: string) {
    return this.prisma.client.customerProfile.findUnique({ where: { id: customerId } });
  }

  /** The signed-in customer's own profile, as their web app sees it. */
  async getOwnView(customerId: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customerView(customer);
  }

  /** Platform-wide customer directory for the Super Admin Portal (§12). */
  private adminCustomerWhere(filters: AdminCustomerFilters) {
    const q = filters.search;
    return {
      status: filters.status ? (filters.status as CustomerStatus) : undefined,
      OR: q
        ? [
            { whatsappNumber: contains(q) },
            { name: contains(q) },
            { email: contains(q) },
          ]
        : undefined,
    };
  }

  async searchForAdmin(filters: AdminCustomerFilters, page: { limit: number; offset: number } = { limit: 50, offset: 0 }) {
    const rows = await this.prisma.client.customerProfile.findMany({
      where: this.adminCustomerWhere(filters),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: Math.min(page.limit, 200),
      skip: page.offset,
    });
    return rows.map(withoutSecrets);
  }

  async countForAdmin(filters: AdminCustomerFilters) {
    return this.prisma.client.customerProfile.count({ where: this.adminCustomerWhere(filters) });
  }

  /**
   * Profile plus what an admin needs to judge the account at a glance:
   * booking counts, spend, first/last booking, open tickets, and the
   * latest bookings and wallet movements.
   */
  async getForAdmin(customerId: string) {
    const customer = await this.prisma.client.customerProfile.findUnique({
      where: { id: customerId },
      include: { coinWallet: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const db = this.prisma.client;
    const [byStatus, spent, span, openTickets, lastSession, recentBookings, recentTransactions] = await Promise.all([
      db.booking.groupBy({ by: ['status'], where: { customerId }, _count: { _all: true } }),
      db.booking.aggregate({
        where: { customerId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { amount: true },
      }),
      db.booking.aggregate({ where: { customerId }, _min: { createdAt: true }, _max: { createdAt: true } }),
      db.supportTicket.count({ where: { customerId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      db.customerSession.findFirst({ where: { customerId }, orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
      db.booking.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderId: true,
          status: true,
          amount: true,
          currency: true,
          startTime: true,
          venue: { select: { name: true } },
        },
      }),
      db.coinTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, type: true, amount: true, balanceAfter: true, createdAt: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    let totalBookings = 0;
    for (const row of byStatus) {
      counts[row.status] = row._count._all;
      totalBookings += row._count._all;
    }

    return {
      ...withoutSecrets(customer),
      stats: {
        totalBookings,
        bookingsByStatus: counts,
        totalSpent: (spent._sum.amount ?? 0).toString(),
        firstBookedAt: span._min.createdAt,
        lastBookedAt: span._max.createdAt,
        openTickets,
        lastSeenAt: lastSession?.lastSeenAt ?? null,
      },
      recentBookings,
      recentTransactions,
    };
  }

  /**
   * Blocking cuts off the web: sessions are revoked now and
   * CustomerSessionService/OTP refuse a blocked customer afterwards.
   */
  async setStatusForAdmin(customerId: string, status: CustomerStatus, reason: string | undefined, admin: AuthContext) {
    const customer = await this.prisma.client.customerProfile.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === status) return withoutSecrets(customer);

    const [updated] = await this.prisma.client.$transaction([
      this.prisma.client.customerProfile.update({ where: { id: customerId }, data: { status } }),
      ...(status === 'BLOCKED'
        ? [
            this.prisma.client.customerSession.updateMany({
              where: { customerId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    await this.audit.record({
      actor: admin,
      action: status === 'BLOCKED' ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entityType: 'CustomerProfile',
      entityId: customerId,
      metadata: { reason: reason ?? null, from: customer.status },
    });
    return withoutSecrets(updated);
  }
}
