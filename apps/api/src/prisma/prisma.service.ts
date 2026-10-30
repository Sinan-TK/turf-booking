import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { prisma } from '@venue/database';

/**
 * Thin NestJS wrapper around the shared @venue/database PrismaClient
 * singleton, so services depend on Nest's DI (testable/mockable) rather
 * than importing the client directly.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = prisma;

  async onModuleInit() {
    await this.client.$connect();
    // Opening a database connection takes about a second to a far-away database, and the pool opens them only as they are needed, so the
    // first search after a start used to pay for several at once. Open a handful now, in the background.
    void Promise.allSettled(Array.from({ length: 8 }, () => this.client.$queryRaw`SELECT 1`));
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
