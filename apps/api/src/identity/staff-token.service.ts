import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import type { OwnerUserRole } from '@venue/shared';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'turf-booking-api';
const AUDIENCE = 'venue-staff';

interface StaffAccessPayload {
  sub: string;
  role: typeof Role.SUPER_ADMIN | typeof Role.VENUE_OWNER;
  organizationId?: string;
  ownerRole?: OwnerUserRole;
}

/**
 * Admin/owner credentials plumbing: short-lived HS256 access JWTs (claims
 * = role + ids, so AuthGuard reads who and which role from them, then confirms the account is still active) and opaque
 * random tokens (refresh, invite, password-reset) of which only the sha256
 * is ever stored.
 */
@Injectable()
export class StaffTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private key() {
    return new TextEncoder().encode(loadEnv().AUTH_JWT_SECRET);
  }

  async signAccessToken(ctx: AuthContext): Promise<string> {
    const env = loadEnv();
    const payload: Omit<StaffAccessPayload, 'sub'> = {
      role: ctx.role as StaffAccessPayload['role'],
      ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      ...(ctx.ownerRole ? { ownerRole: ctx.ownerRole } : {}),
    };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ctx.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
      .sign(this.key());
  }

  /** Returns null instead of throwing — AuthGuard falls through to other
   * mechanisms (other candidate tokens, customer cookie) on null. */
  async verifyAccessToken(token: string): Promise<AuthContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.key(), {
        algorithms: ['HS256'], // pinned: no alg-confusion / "none"
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const claims = payload as unknown as StaffAccessPayload;
      if (!payload.sub) return null;
      if (claims.role === Role.SUPER_ADMIN) {
        return { role: Role.SUPER_ADMIN, id: payload.sub };
      }
      if (claims.role === Role.VENUE_OWNER) {
        if (!claims.organizationId || !claims.ownerRole) return null;
        return {
          role: Role.VENUE_OWNER,
          id: payload.sub,
          organizationId: claims.organizationId,
          ownerRole: claims.ownerRole,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Whether the person behind a verified access token may still act: their login is active (and, for an owner, so is their
   * organisation), and an owner's role is still the one in the token. A token is only a signed claim that lives for minutes, so
   * without this a login that was blocked, an organisation that was suspended, or a staff member who was demoted would keep
   * working until the token ran out. One lookup by primary key per request.
   */
  async isStillActive(ctx: AuthContext): Promise<boolean> {
    if (ctx.role === Role.SUPER_ADMIN) {
      const admin = await this.prisma.client.adminUser.findUnique({ where: { id: ctx.id }, select: { status: true } });
      return admin?.status === 'ACTIVE';
    }
    if (ctx.role === Role.VENUE_OWNER) {
      const user = await this.prisma.client.venueOwnerUser.findUnique({
        where: { id: ctx.id },
        select: { status: true, role: true, organizationId: true, organization: { select: { status: true } } },
      });
      return (
        !!user &&
        user.status === 'ACTIVE' &&
        user.organization.status === 'ACTIVE' &&
        user.organizationId === ctx.organizationId &&
        user.role === ctx.ownerRole
      );
    }
    return false;
  }

  generateOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
