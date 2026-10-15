import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness probe use-case. Owns the DB ping + timestamp shaping so
 * HealthController stays a thin HTTP adapter (Clean Architecture:
 * controllers never touch Prisma directly).
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{ status: string; timestamp: string }> {
    await this.prisma.client.$queryRaw`SELECT 1`;
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
