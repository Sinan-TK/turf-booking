import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CheckStatus = 'ok' | 'down';

export interface SystemHealth {
  /** ok: everything works. degraded: the API answers but a part it relies on does not. */
  status: 'ok' | 'degraded';
  checkedAt: string;
  uptimeSeconds: number;
  checks: Array<{ name: string; status: CheckStatus; latencyMs: number; message: string }>;
}

/**
 * Liveness probe use-case. Owns the DB ping + timestamp shaping so
 * HealthController stays a thin HTTP adapter (Clean Architecture:
 * controllers never touch Prisma directly).
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** The public probe: throws when the database does not answer (the controller turns that into a 503). */
  async check(): Promise<{ status: string; timestamp: string }> {
    await this.prisma.client.$queryRaw`SELECT 1`;
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * The Super Admin's view: each part checked on its own, with how long it took. Messages are fixed sentences on purpose: an error from
   * the database can carry a host name, a user name or a query, none of which belong on a web page (the full error goes to the log).
   */
  async details(): Promise<SystemHealth> {
    const started = Date.now();
    let database: SystemHealth['checks'][number];
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      database = { name: 'Database', status: 'ok', latencyMs: Date.now() - started, message: 'Answering queries.' };
    } catch (err) {
      console.error('[health] database check failed:', err instanceof Error ? err.message : err);
      database = { name: 'Database', status: 'down', latencyMs: Date.now() - started, message: 'The database is not answering. Bookings and sign-in will fail until it is back.' };
    }
    const checks = [database];
    return {
      status: checks.every((c) => c.status === 'ok') ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks,
    };
  }
}
