import { PrismaClient } from '@prisma/client';

/**
 * Single shared PrismaClient instance per process. NestJS services should
 * inject this via a PrismaModule provider (apps/api) rather than
 * constructing their own client.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export * from '@prisma/client';
export * from './password';
