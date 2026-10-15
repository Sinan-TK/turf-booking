import { Injectable } from '@nestjs/common';
import { generateSecureToken, hashToken } from '@venue/shared';
import { loadEnv } from '@venue/config';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerSessionSourceLinkType } from '@venue/database';

/**
 * Customer auth mechanism (ARCHITECTURE.md §1 row 10, §12): a server-side
 * session, not a JWT. The raw token exists only in the httpOnly cookie
 * handed to the browser; the DB stores its hash (same pattern as
 * BookingSession.tokenHash), so a DB leak alone never yields a usable
 * session token.
 */
@Injectable()
export class CustomerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(customerId: string, sourceLinkType: CustomerSessionSourceLinkType) {
    const env = loadEnv();
    const rawToken = generateSecureToken();
    const session = await this.prisma.client.customerSession.create({
      data: {
        customerId,
        sessionTokenHash: hashToken(rawToken),
        sourceLinkType,
        expiresAt: new Date(Date.now() + env.CUSTOMER_SESSION_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return { rawToken, session };
  }

  /**
   * Validates a session cookie value and refreshes lastSeenAt on success.
   * Returns null for missing/expired/revoked sessions — never throws, so
   * the guard can treat "no valid session" uniformly with "no cookie."
   */
  async validateSession(rawToken: string) {
    const session = await this.prisma.client.customerSession.findUnique({
      where: { sessionTokenHash: hashToken(rawToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }
    await this.prisma.client.customerSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    return session;
  }

  async revokeSession(rawToken: string): Promise<void> {
    await this.prisma.client.customerSession.updateMany({
      where: { sessionTokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
