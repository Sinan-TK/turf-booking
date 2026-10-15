import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { StaffPortal, hashPassword, verifyPassword } from '@venue/database';
import { Role } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StaffTokenService } from '../identity/staff-token.service';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../identity/identity-provider.interface';
import type { AuthContext } from './auth.types';

interface StaffRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  /** Profile (and, for owners, organization) is ACTIVE. */
  active: boolean;
  ctx: AuthContext;
}

export interface StaffSession {
  ctx: AuthContext;
  accessToken: string;
  refreshToken: string;
}

/** A rotated refresh token presented again this long after rotation is
 * treated as theft (all sessions revoked); inside the window it is just a
 * lost race between two tabs sharing one cookie jar. */
const REFRESH_REUSE_GRACE_MS = 30_000;

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_LINK = 'This link is invalid or has expired';

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: StaffTokenService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  async login(portal: StaffPortal, email: string, password: string): Promise<StaffSession> {
    const user = await this.load(portal, { email });
    // Always run one scrypt verification, so response time doesn't reveal
    // whether the account exists or has a password yet.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await verifyPassword(password, hash);
    if (!user || !user.passwordHash || !passwordOk || !user.active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.startSession(portal, user.ctx);
  }

  async refresh(portal: StaffPortal, rawRefreshToken: string): Promise<StaffSession> {
    const session = await this.prisma.client.staffRefreshSession.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawRefreshToken) },
    });
    if (!session || session.portal !== portal) throw new UnauthorizedException('Session expired');

    const now = new Date();
    if (session.revokedAt) {
      if (now.getTime() - session.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
        this.logger.warn(`Refresh token reuse detected for ${portal} user ${session.userId}`);
        await this.identity.revokeAllSessions(portal, session.userId);
      }
      throw new UnauthorizedException('Session expired');
    }
    if (session.expiresAt <= now) throw new UnauthorizedException('Session expired');

    // Atomic claim: two concurrent refreshes with the same token can't both win.
    const claimed = await this.prisma.client.staffRefreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count === 0) throw new UnauthorizedException('Session expired');

    // Re-read the user: role, organization and status changes (or a
    // disabled account) take effect at the next refresh at the latest.
    const user = await this.load(portal, { id: session.userId });
    if (!user || !user.active) throw new UnauthorizedException('Session expired');
    return this.startSession(portal, user.ctx);
  }

  async logout(portal: StaffPortal, rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.prisma.client.staffRefreshSession.updateMany({
      where: {
        portal,
        tokenHash: this.tokens.hashOpaqueToken(rawRefreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  /** Always resolves, whether or not the account exists. Also serves as
   * "resend invite" for a user who hasn't set a password yet. */
  async forgotPassword(portal: StaffPortal, email: string): Promise<void> {
    try {
      const user = await this.load(portal, { email });
      if (!user || !user.active) return;
      await this.identity.sendPasswordReset({
        portal,
        userId: user.id,
        email: user.email,
        name: user.name,
      });
    } catch (error) {
      this.logger.error(`forgotPassword failed: ${String(error)}`);
    }
  }

  /** Consumes an invite or password-reset link. Does not sign the user in. */
  async resetPassword(portal: StaffPortal, rawToken: string, newPassword: string): Promise<void> {
    const record = await this.prisma.client.staffAuthToken.findUnique({
      where: { tokenHash: this.tokens.hashOpaqueToken(rawToken) },
    });
    const now = new Date();
    if (!record || record.portal !== portal || record.usedAt || record.expiresAt <= now) {
      throw new BadRequestException(INVALID_LINK);
    }
    const user = await this.load(portal, { id: record.userId });
    if (!user || !user.active) throw new BadRequestException(INVALID_LINK);

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.client.$transaction(async (tx) => {
      // Claim this link, and void any other outstanding ones for the user.
      const claimed = await tx.staffAuthToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) throw new BadRequestException(INVALID_LINK);
      await tx.staffAuthToken.updateMany({
        where: { portal, userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      if (portal === StaffPortal.ADMIN) {
        await tx.adminUser.update({ where: { id: user.id }, data: { passwordHash } });
      } else {
        await tx.venueOwnerUser.update({ where: { id: user.id }, data: { passwordHash } });
      }
      await tx.staffRefreshSession.updateMany({
        where: { portal, userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  /** Verifies the current password, sets the new one, ends every other
   * session, and returns a fresh session for the caller. */
  async changePassword(
    portal: StaffPortal,
    ctx: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<StaffSession> {
    const user = await this.load(portal, { id: ctx.id });
    if (!user || !user.active || !user.passwordHash) throw new UnauthorizedException('Not signed in');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await hashPassword(newPassword);
    if (portal === StaffPortal.ADMIN) {
      await this.prisma.client.adminUser.update({ where: { id: user.id }, data: { passwordHash } });
    } else {
      await this.prisma.client.venueOwnerUser.update({ where: { id: user.id }, data: { passwordHash } });
    }
    await this.identity.revokeAllSessions(portal, user.id);
    return this.startSession(portal, user.ctx);
  }

  private async startSession(portal: StaffPortal, ctx: AuthContext): Promise<StaffSession> {
    const env = loadEnv();
    const accessToken = await this.tokens.signAccessToken(ctx);
    const { raw, hash } = this.tokens.generateOpaqueToken();
    await this.prisma.client.staffRefreshSession.create({
      data: {
        portal,
        userId: ctx.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });
    return { ctx, accessToken, refreshToken: raw };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }

  private async load(
    portal: StaffPortal,
    by: { id: string } | { email: string },
  ): Promise<StaffRecord | null> {
    const where =
      'id' in by ? { id: by.id } : { email: { equals: by.email.trim(), mode: 'insensitive' as const } };

    if (portal === StaffPortal.ADMIN) {
      const row = await this.prisma.client.adminUser.findFirst({ where });
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        active: row.status === 'ACTIVE',
        ctx: { role: Role.SUPER_ADMIN, id: row.id },
      };
    }

    const row = await this.prisma.client.venueOwnerUser.findFirst({
      where,
      include: { organization: { select: { status: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      active: row.status === 'ACTIVE' && row.organization.status === 'ACTIVE',
      ctx: {
        role: Role.VENUE_OWNER,
        id: row.id,
        organizationId: row.organizationId,
        ownerRole: row.role,
      },
    };
  }
}
