import { Injectable, NotFoundException } from '@nestjs/common';
import { generateSecureToken, hashToken } from '@venue/shared';
import { loadEnv } from '@venue/config';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerSessionService } from '../auth/customer-session.service';
import type { BookingSessionSource } from '@venue/database';

/**
 * The 20-minute browsing JOURNEY placeholder (ARCHITECTURE.md) — NOT a
 * slot reservation. Distinct from SlotHold (bookings.service.ts) and
 * from CustomerSession (the auth mechanism).
 */
@Injectable()
export class BookingSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly customerSessions: CustomerSessionService,
  ) {}

  async start(whatsappNumber: string, source: BookingSessionSource) {
    const env = loadEnv();
    const customer = await this.customers.findOrCreateByWhatsAppNumber(whatsappNumber);

    const rawToken = generateSecureToken();
    const session = await this.prisma.client.bookingSession.create({
      data: {
        tokenHash: hashToken(rawToken),
        customerId: customer.id,
        source,
        expiresAt: new Date(Date.now() + env.BOOKING_SESSION_TTL_MINUTES * 60 * 1000),
      },
    });

    // A CustomerSession is deliberately NOT created here: its raw token
    // only exists for the instant it's generated (the DB stores just its
    // hash), and WhatsApp only ever hands the customer the
    // bookingSessionToken as a link — a CustomerSession minted here would
    // have its raw token immediately discarded, unrecoverable, and
    // permanently orphaned in the database. Instead `resolve()` below
    // mints it lazily, the moment the browser actually opens the link and
    // can receive the Set-Cookie.
    return { bookingSessionToken: rawToken, session };
  }

  /**
   * Resolves a token from the /book/:token URL AND authenticates the
   * browser for the rest of the customer API in the same call — the one
   * moment a raw CustomerSession token can actually reach a Set-Cookie
   * header, so it's minted here rather than at `start()` (see there for
   * why). Safe to call more than once (e.g. a page refresh): each call
   * simply issues a fresh CustomerSession, exactly like a JWT refresh
   * would, and previous ones just age out on their own TTL.
   */
  async resolveAndAuthenticate(rawToken: string) {
    const session = await this.prisma.client.bookingSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!session || session.status !== 'ACTIVE' || session.expiresAt < new Date()) {
      throw new NotFoundException('Booking session not found or expired');
    }
    await this.prisma.client.bookingSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });
    const { rawToken: customerSessionToken } = await this.customerSessions.createSession(
      session.customerId,
      'BOOKING',
    );
    return { session, customerSessionToken };
  }
}
