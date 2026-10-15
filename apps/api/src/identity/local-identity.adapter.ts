import { Injectable } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { StaffAuthTokenPurpose, StaffPortal } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { StaffTokenService } from './staff-token.service';
import type { IdentityProvider } from './identity-provider.interface';

interface LinkRecipient {
  portal: StaffPortal;
  userId: string;
  email: string;
  name: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Credentials live in Neon (admin_users / venue_owner_users plus the
 * staff_* token tables); invite and reset links go out through MailService. */
@Injectable()
export class LocalIdentityAdapter implements IdentityProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: StaffTokenService,
    private readonly mail: MailService,
  ) {}

  async sendInvite(params: LinkRecipient) {
    await this.sendLink(params, StaffAuthTokenPurpose.INVITE);
  }

  async sendPasswordReset(params: LinkRecipient) {
    await this.sendLink(params, StaffAuthTokenPurpose.PASSWORD_RESET);
  }

  async revokeAllSessions(portal: StaffPortal, userId: string): Promise<void> {
    await this.prisma.client.staffRefreshSession.updateMany({
      where: { portal, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async sendLink(params: LinkRecipient, purpose: StaffAuthTokenPurpose) {
    const env = loadEnv();
    const isInvite = purpose === StaffAuthTokenPurpose.INVITE;
    const ttlMs = isInvite
      ? env.INVITE_TOKEN_TTL_HOURS * 3_600_000
      : env.RESET_TOKEN_TTL_MINUTES * 60_000;

    // A new link supersedes any outstanding one of the same purpose.
    await this.prisma.client.staffAuthToken.updateMany({
      where: { portal: params.portal, userId: params.userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    const { raw, hash } = this.tokens.generateOpaqueToken();
    await this.prisma.client.staffAuthToken.create({
      data: {
        portal: params.portal,
        userId: params.userId,
        purpose,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    const appUrl = params.portal === StaffPortal.ADMIN ? env.ADMIN_APP_URL : env.OWNER_APP_URL;
    const link = `${appUrl}/reset-password?token=${encodeURIComponent(raw)}`;
    const subject = isInvite ? 'You have been invited to Venue Booking' : 'Reset your Venue Booking password';
    const lead = isInvite
      ? 'You have been invited to Venue Booking. Set your password to get started.'
      : 'We received a request to reset your password.';
    const expiry = isInvite
      ? `${env.INVITE_TOKEN_TTL_HOURS} hours`
      : `${env.RESET_TOKEN_TTL_MINUTES} minutes`;
    const action = isInvite ? 'Set your password' : 'Reset your password';

    await this.mail.send({
      to: params.email,
      subject,
      text: `Hi ${params.name},\n\n${lead}\n\n${link}\n\nThis link works once and expires in ${expiry}. If you did not expect this email, you can ignore it.`,
      html: `<p>Hi ${escapeHtml(params.name)},</p><p>${lead}</p><p><a href="${link}">${action}</a></p><p>This link works once and expires in ${expiry}. If you did not expect this email, you can ignore it.</p>`,
    });
  }
}
