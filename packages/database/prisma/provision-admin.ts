/**
 * Provisions a real Super Admin. There's deliberately no API endpoint for
 * this (no self-service Super Admin creation), so this script is the only
 * way to create the first one.
 *
 * Without a password argument it creates a passwordless AdminUser and
 * prints a single-use set-password link (valid 72h) — nothing secret is
 * ever passed on a command line. With a password argument it sets that
 * password directly (handy for local dev; it ends up in shell history, so
 * prefer the link for anything real). Re-running for an existing admin
 * issues a fresh link / resets the password.
 *
 * Reads DATABASE_URL (and ADMIN_APP_URL for the link) from the
 * environment, so it's safe to run against production via `railway run`
 * without pasting secrets into this file or the shell history.
 *
 * Usage:
 *   pnpm --filter @venue/database exec tsx prisma/provision-admin.ts <email> "<name>" [password]
 *   railway run pnpm --filter @venue/database exec tsx prisma/provision-admin.ts <email> "<name>"
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();

async function main() {
  const [rawEmail, name, password] = process.argv.slice(2);
  if (!rawEmail || !name) {
    throw new Error('Usage: tsx prisma/provision-admin.ts <email> "<name>" [password]');
  }
  const email = rawEmail.trim().toLowerCase();

  let admin = await prisma.adminUser.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (!admin) {
    admin = await prisma.adminUser.create({ data: { email, name, role: 'SUPER_ADMIN' } });
    console.log(`Created Super Admin ${email} (AdminUser id ${admin.id}).`);
  } else {
    console.log(`AdminUser already exists for ${email} (id ${admin.id}).`);
  }

  if (password) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(password) },
    });
    await prisma.staffRefreshSession.updateMany({
      where: { portal: 'ADMIN', userId: admin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.log('Password set. They can sign in at the admin portal now.');
    return;
  }

  const raw = randomBytes(32).toString('base64url');
  await prisma.staffAuthToken.updateMany({
    where: { portal: 'ADMIN', userId: admin.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.staffAuthToken.create({
    data: {
      portal: 'ADMIN',
      userId: admin.id,
      purpose: 'INVITE',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 72 * 3_600_000),
    },
  });
  const adminAppUrl = process.env.ADMIN_APP_URL ?? 'http://localhost:3001';
  console.log('\nSet-password link (single use, valid 72h):');
  console.log(`${adminAppUrl}/reset-password?token=${encodeURIComponent(raw)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
