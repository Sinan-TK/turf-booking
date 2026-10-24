import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Customer login is a one-time code sent over WhatsApp, which a browser test cannot receive. The API
 * stores only an HMAC of each code, so the tests plant a code they know for the phone number the UI
 * just asked for (the same database row the API would have written) and type that into the dialog.
 * Everything else about the login (the dialog, the API verify call, the session cookie) is the real thing.
 */

/** DATABASE_URL and CUSTOMER_SESSION_SECRET come from the API's own env file, as the API itself reads them. */
function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const text = readFileSync(resolve(__dirname, '../../api/.env'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

let db: Promise<typeof import('../../../packages/database/dist')['prisma']> | undefined;
export function database() {
  db ??= (async () => {
    process.env.DATABASE_URL ??= apiEnv().DATABASE_URL;
    return (await import('../../../packages/database/dist')).prisma;
  })();
  return db;
}

/** Makes `code` the one valid login code for this E.164 phone number (e.g. +919876543210). */
export async function plantLoginCode(phone: string, code = '123456'): Promise<void> {
  const secret = apiEnv().CUSTOMER_SESSION_SECRET;
  if (!secret) throw new Error('CUSTOMER_SESSION_SECRET is not set in apps/api/.env');
  const prisma = await database();
  const now = new Date();
  await prisma.loginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } });
  await prisma.loginCode.create({
    data: {
      phone,
      codeHash: createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex'),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    },
  });
}

export async function closeDatabase(): Promise<void> {
  if (db) await (await db).$disconnect();
}

/**
 * Makes `code` the valid emailed code for this address (the API stores only an HMAC of each code and the email
 * cannot be read by a test). The row is created by the real sign-up or forgot-password call.
 */
export async function plantEmailCode(email: string, purpose: 'SIGNUP' | 'RESET', code = '123456'): Promise<void> {
  const secret = apiEnv().CUSTOMER_SESSION_SECRET;
  if (!secret) throw new Error('CUSTOMER_SESSION_SECRET is not set in apps/api/.env');
  const prisma = await database();
  const address = email.toLowerCase();
  // The browser's request may still be on its way, so give the row a few seconds to appear.
  let row = null;
  for (let i = 0; i < 40 && !row; i++) {
    row = await prisma.customerEmailCode.findFirst({ where: { email: address, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row) await new Promise((r) => setTimeout(r, 250));
  }
  if (!row) throw new Error(`No ${purpose} code was issued for ${address}`);
  await prisma.customerEmailCode.update({
    where: { id: row.id },
    data: { codeHash: createHmac('sha256', secret).update(`email:${purpose}:${address}:${code}`).digest('hex') },
  });
}
