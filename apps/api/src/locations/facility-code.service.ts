import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Implements ARCHITECTURE.md §6.6. Never called from a controller
 * directly — only from VenuesService, at facility-creation time, and the
 * result is written once and never updated (facilityCode is immutable).
 */
@Injectable()
export class FacilityCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(districtId: string): Promise<string> {
    const district = await this.prisma.client.district.findUnique({
      where: { id: districtId },
      include: { state: true },
    });
    if (!district) {
      throw new NotFoundException('District not found');
    }

    // Single atomic UPDATE...RETURNING — Postgres's row-level lock on this
    // statement serializes concurrent callers for the same district, so
    // two simultaneous facility creations can never receive the same
    // number. Verified under real concurrency in Phase 2 (20 simultaneous
    // callers -> 20 unique sequential values, zero collisions) — see
    // ARCHITECTURE.md §6.6.
    const rows = await this.prisma.client.$queryRaw<Array<{ nextNumber: number }>>`
      UPDATE facility_code_sequences
      SET "nextNumber" = "nextNumber" + 1, "updatedAt" = now()
      WHERE "districtId" = ${districtId}::uuid
      RETURNING "nextNumber"
    `;
    const nextNumber = rows[0]?.nextNumber;
    if (nextNumber === undefined) {
      // A District should never exist without its FacilityCodeSequence
      // row — LocationsService creates both together — but guard anyway
      // rather than generating a malformed code.
      throw new NotFoundException('District has no facility code sequence');
    }

    return `${district.state.code}${district.code}${String(nextNumber).padStart(5, '0')}`;
  }
}
