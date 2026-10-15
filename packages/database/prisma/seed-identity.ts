/**
 * Provisions the dev Super Admin and dev Venue Owner (AdminUser /
 * VenueOwnerUser rows with a known dev password). Deliberately separate
 * from seed.ts (which only ever writes plain reference data) because it
 * creates login credentials, so it must never run implicitly as part of
 * `prisma db seed` / CI / a fresh-DB bootstrap, and refuses to run in
 * production.
 *
 * Re-runnable: an existing user is left alone unless it has no password
 * yet (e.g. a row left over from the old Supabase setup), in which case
 * the dev password is set on it.
 *
 * Usage: pnpm --filter @venue/database seed:identity
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/password';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'DevPassword123!';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed-identity.ts seeds *.local placeholder emails with a known password — never run it in ' +
        'production. Use provision-admin.ts, or the admin API, for real accounts.',
    );
  }
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const admin = await prisma.adminUser.findUnique({ where: { email: 'admin@turf.local' } });
  if (!admin) {
    await prisma.adminUser.create({
      data: {
        email: 'admin@turf.local',
        name: 'Platform Super Admin',
        role: 'SUPER_ADMIN',
        passwordHash,
      },
    });
    console.log(`Created dev Super Admin admin@turf.local / ${DEV_PASSWORD}`);
  } else if (!admin.passwordHash) {
    await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash } });
    console.log(`Set dev password on existing Super Admin admin@turf.local / ${DEV_PASSWORD}`);
  } else {
    console.log('Dev Super Admin already provisioned, skipping.');
  }

  const devOrg = await prisma.ownerOrganization.findUnique({
    where: { id: '00000000-0000-0000-0000-000000000003' },
  });
  if (!devOrg) {
    throw new Error('Dev owner organization not found — run `pnpm db:seed` first.');
  }

  const owner = await prisma.venueOwnerUser.findUnique({ where: { email: 'owner@turf.local' } });
  if (!owner) {
    await prisma.venueOwnerUser.create({
      data: {
        organizationId: devOrg.id,
        email: 'owner@turf.local',
        name: 'Dev Owner Admin',
        role: 'OWNER_ADMIN',
        passwordHash,
      },
    });
    console.log(`Created dev Venue Owner owner@turf.local / ${DEV_PASSWORD}`);
  } else if (!owner.passwordHash) {
    await prisma.venueOwnerUser.update({ where: { id: owner.id }, data: { passwordHash } });
    console.log(`Set dev password on existing Venue Owner owner@turf.local / ${DEV_PASSWORD}`);
  } else {
    console.log('Dev Venue Owner already provisioned, skipping.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
