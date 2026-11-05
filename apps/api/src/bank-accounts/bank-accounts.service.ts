import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { verifyPassword } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { SaveBankAccountDto } from './dto/bank-account.dto';

type Row = {
  id: string;
  organizationId: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  accountType: 'SAVINGS' | 'CURRENT';
  status: 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  failureReason: string | null;
  verifiedAt: Date | null;
  submittedAt: Date;
  updatedAt: Date;
};

/** What both sides get before any details are saved. */
const NONE = { status: 'NONE' as const };

/** Bullets followed by the last four digits: all an owner sees once the number is saved. */
export const maskAccountNumber = (n: string) => `${'•'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;

/**
 * A business's payout details. The owner admin writes them (only after re-entering their password), the Super Admin verifies or fails
 * them, and every real change sends them back to NOT_VERIFIED. The full account number is returned to the Super Admin only.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(row: Row, full: boolean) {
    const { accountNumber, ...rest } = row;
    return { ...rest, accountNumber: full ? accountNumber : maskAccountNumber(accountNumber), accountNumberLast4: accountNumber.slice(-4) };
  }

  private orgOf(actor: AuthContext): string {
    if (!actor.organizationId) throw new ForbiddenException('Not an owner account');
    return actor.organizationId;
  }

  async getForOwner(actor: AuthContext) {
    const row = await this.prisma.client.organizationBankAccount.findUnique({ where: { organizationId: this.orgOf(actor) } });
    return row ? this.view(row, false) : NONE;
  }

  async getForAdmin(organizationId: string) {
    const row = await this.prisma.client.organizationBankAccount.findUnique({ where: { organizationId } });
    return row ? this.view(row, true) : NONE;
  }

  async save(dto: SaveBankAccountDto, actor: AuthContext) {
    const organizationId = this.orgOf(actor);
    const user = await this.prisma.client.venueOwnerUser.findUnique({ where: { id: actor.id } });
    // The same message whether the password is wrong or the login has none, so nothing is revealed.
    if (!user || user.organizationId !== organizationId || !user.passwordHash || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new ForbiddenException('That password is not right. Your bank details were not changed.');
    }
    const data = {
      accountHolderName: dto.accountHolderName,
      accountNumber: dto.accountNumber,
      ifsc: dto.ifsc,
      bankName: dto.bankName,
      accountType: dto.accountType,
    };
    const existing = await this.prisma.client.organizationBankAccount.findUnique({ where: { organizationId } });
    if (existing && (Object.keys(data) as Array<keyof typeof data>).every((k) => existing[k] === data[k])) {
      return this.view(existing, false); // nothing changed: the status stays as it is
    }
    const reset = { status: 'NOT_VERIFIED' as const, failureReason: null, verifiedAt: null, verifiedByAdminId: null, submittedAt: new Date() };
    const row = await this.prisma.client.organizationBankAccount.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: { ...data, ...reset },
    });
    await this.audit.record({
      actor,
      action: existing ? 'BANK_ACCOUNT_CHANGED' : 'BANK_ACCOUNT_ADDED',
      entityType: 'OwnerOrganization',
      entityId: organizationId,
      metadata: { last4: data.accountNumber.slice(-4), ifsc: data.ifsc, bankName: data.bankName },
    });
    return this.view(row, false);
  }

  verify(organizationId: string, actor: AuthContext) {
    return this.decide(organizationId, actor, { ok: true });
  }

  fail(organizationId: string, reason: string, actor: AuthContext) {
    return this.decide(organizationId, actor, { ok: false, reason });
  }

  private async decide(organizationId: string, actor: AuthContext, outcome: { ok: true } | { ok: false; reason: string }) {
    const row = await this.prisma.client.organizationBankAccount.findUnique({ where: { organizationId } });
    if (!row) throw new NotFoundException('This business has not added bank details');
    if (row.status !== 'NOT_VERIFIED') throw new BadRequestException('Only details that are not verified can be verified or failed');
    const updated = await this.prisma.client.organizationBankAccount.update({
      where: { organizationId },
      data: outcome.ok
        ? { status: 'VERIFIED', failureReason: null, verifiedAt: new Date(), verifiedByAdminId: actor.id }
        : { status: 'FAILED', failureReason: outcome.reason, verifiedAt: null, verifiedByAdminId: actor.id },
    });
    const last4 = row.accountNumber.slice(-4);
    await this.audit.record({
      actor,
      action: outcome.ok ? 'BANK_ACCOUNT_VERIFIED' : 'BANK_ACCOUNT_FAILED',
      entityType: 'OwnerOrganization',
      entityId: organizationId,
      metadata: outcome.ok ? { last4 } : { last4, reason: outcome.reason },
    });
    const owners = await this.prisma.client.venueOwnerUser.findMany({ where: { organizationId, role: 'OWNER_ADMIN', status: 'ACTIVE' }, select: { id: true } });
    if (owners.length > 0) {
      await this.prisma.client.ownerNotification.createMany({
        data: owners.map((o) => ({
          ownerId: o.id,
          type: 'SYSTEM' as const,
          title: outcome.ok ? 'Bank details verified' : 'Bank details need fixing',
          message: outcome.ok
            ? `Your bank account ending ${last4} is verified. Payouts will go there.`
            : `Your bank details could not be verified: ${outcome.reason}. Please correct them in Settings.`,
          data: { organizationId, kind: 'BANK_ACCOUNT' },
        })),
      });
    }
    return this.view(updated, true);
  }
}
