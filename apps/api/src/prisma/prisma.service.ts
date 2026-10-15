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
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
