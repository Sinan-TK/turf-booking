import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  PLATFORM_ONLY_TERM_KEYS,
  commercialTermsOverrideSchema,
  commercialTermsProblems,
  commercialTermsSchema,
  mergeCommercialTerms,
  type CommercialTerms,
  type CommercialTermsOverride,
  type ResolvedCommercialTerms,
} from '@venue/shared';
import type { CommercialPolicy, Prisma } from '@venue/database';
import type { ZodError } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import type { AuthContext } from '../auth/auth.types';

type Tx = Prisma.TransactionClient;

function zodMessages(error: ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join(' ');
}

/** Parses a request body against a schema, turning problems into a 400 with readable messages. */
function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: ZodError } }, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(zodMessages(result.error));
  return result.data;
}

/**
 * Commercial terms (packages/shared/src/commercial.ts) live on three levels: the platform default (complete,
 * pre-fills new facilities, holds the payout schedule), each facility, and optionally one venue's deal for one
 * facility. Resolution merges field by field, most specific first. Only the Super Admin writes them; every
 * write is validated against every combination it affects, so a booking never resolves to invalid terms.
 */
@Injectable()
export class CommercialTermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: OwnerScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  /** The terms a booking of this facility in this venue runs on. */
  async resolve(venueId: string, categoryId: string): Promise<ResolvedCommercialTerms> {
    const rows = await this.prisma.client.commercialPolicy.findMany({
      where: {
        OR: [
          { scope: 'PLATFORM_DEFAULT' },
          { scope: 'FACILITY', categoryId },
          { scope: 'VENUE_FACILITY', venueId, categoryId },
        ],
      },
    });
    return this.mergeRows(rows, venueId, categoryId);
  }

  /** The facility (category) a bookable unit belongs to. */
  async categoryOf(target: { resourceId?: string | null; resourceGroupId?: string | null }): Promise<string> {
    if (target.resourceId) {
      const r = await this.prisma.client.resource.findUnique({ where: { id: target.resourceId }, select: { categoryId: true } });
      if (r) return r.categoryId;
    }
    if (target.resourceGroupId) {
      const g = await this.prisma.client.resourceGroup.findUnique({
        where: { id: target.resourceGroupId },
        select: { categoryId: true },
      });
      if (g) return g.categoryId;
    }
    throw new NotFoundException('The booked unit no longer exists');
  }

  private mergeRows(rows: CommercialPolicy[], venueId: string | null, categoryId: string): ResolvedCommercialTerms {
    const own = (scope: CommercialPolicy['scope']) =>
      rows.find(
        (r) =>
          r.scope === scope &&
          (scope === 'PLATFORM_DEFAULT' || r.categoryId === categoryId) &&
          (scope !== 'VENUE_FACILITY' || r.venueId === venueId),
      )?.terms as Partial<CommercialTerms> | undefined;
    try {
      return mergeCommercialTerms([
        { source: 'VENUE_FACILITY', terms: venueId ? own('VENUE_FACILITY') : undefined },
        { source: 'FACILITY', terms: own('FACILITY') },
        { source: 'PLATFORM_DEFAULT', terms: own('PLATFORM_DEFAULT') },
      ]);
    } catch (error) {
      throw new InternalServerErrorException(
        `Commercial terms are not configured correctly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Platform default
  // ---------------------------------------------------------------------------

  async getDefault() {
    const row = await this.prisma.client.commercialPolicy.findFirst({ where: { scope: 'PLATFORM_DEFAULT' } });
    return { terms: (row?.terms ?? null) as CommercialTerms | null };
  }

  async putDefault(body: unknown, actor: AuthContext) {
    const terms = parseOrThrow(commercialTermsSchema, body);
    const all = await this.prisma.client.commercialPolicy.findMany();
    const candidate = this.replaceRow(all, { scope: 'PLATFORM_DEFAULT', categoryId: null, venueId: null }, terms);
    await this.assertValid(candidate, all.filter((r) => r.scope !== 'PLATFORM_DEFAULT'));

    const existing = all.find((r) => r.scope === 'PLATFORM_DEFAULT');
    const row = existing
      ? await this.prisma.client.commercialPolicy.update({ where: { id: existing.id }, data: { terms } })
      : await this.prisma.client.commercialPolicy.create({ data: { scope: 'PLATFORM_DEFAULT', terms } });
    await this.audit.record({
      actor,
      action: 'COMMERCIAL_TERMS_UPDATED',
      entityType: 'CommercialPolicy',
      entityId: row.id,
      metadata: { scope: 'PLATFORM_DEFAULT', terms },
    });
    return { terms };
  }

  // ---------------------------------------------------------------------------
  // Facility
  // ---------------------------------------------------------------------------

  /** A new facility's own terms: a copy of the default's facility-level values (later default edits don't move it). */
  async createFacilityTerms(tx: Tx, categoryId: string) {
    const def = await tx.commercialPolicy.findFirst({ where: { scope: 'PLATFORM_DEFAULT' } });
    const source = (def?.terms ?? {}) as Record<string, unknown>;
    const terms = Object.fromEntries(
      Object.entries(source).filter(([key]) => !PLATFORM_ONLY_TERM_KEYS.includes(key as keyof CommercialTerms)),
    );
    await tx.commercialPolicy.create({ data: { scope: 'FACILITY', categoryId, terms: terms as Prisma.InputJsonValue } });
  }

  async getFacility(categoryId: string) {
    await this.assertCategory(categoryId);
    const rows = await this.rowsFor(null, categoryId);
    const own = rows.find((r) => r.scope === 'FACILITY')?.terms ?? {};
    return { own, ...this.mergeRows(rows, null, categoryId) };
  }

  async putFacility(categoryId: string, body: unknown, actor: AuthContext) {
    await this.assertCategory(categoryId);
    const own = parseOrThrow(commercialTermsOverrideSchema, body);
    const all = await this.prisma.client.commercialPolicy.findMany();
    const candidate = this.replaceRow(all, { scope: 'FACILITY', categoryId, venueId: null }, own);
    await this.assertValid(
      candidate,
      candidate.filter((r) => r.categoryId === categoryId),
    );

    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.commercialPolicy.findFirst({ where: { scope: 'FACILITY', categoryId } });
      if (existing) await tx.commercialPolicy.update({ where: { id: existing.id }, data: { terms: own } });
      else await tx.commercialPolicy.create({ data: { scope: 'FACILITY', categoryId, terms: own } });
    });
    await this.audit.record({
      actor,
      action: 'COMMERCIAL_TERMS_UPDATED',
      entityType: 'VenueCategory',
      entityId: categoryId,
      metadata: { scope: 'FACILITY', terms: own },
    });
    return this.getFacility(categoryId);
  }

  // ---------------------------------------------------------------------------
  // A venue's deal for one facility
  // ---------------------------------------------------------------------------

  /** Every facility the venue offers (or has a deal for), with its effective terms and the venue's own overrides. */
  async listForVenue(venueId: string) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId }, select: { id: true } });
    if (!venue) throw new NotFoundException('Venue not found');
    const categories = await this.venueCategories(venueId);
    const rows = await this.prisma.client.commercialPolicy.findMany({
      where: {
        OR: [
          { scope: 'PLATFORM_DEFAULT' },
          { scope: 'FACILITY', categoryId: { in: categories.map((c) => c.id) } },
          { scope: 'VENUE_FACILITY', venueId },
        ],
      },
    });
    return categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      own: (rows.find((r) => r.scope === 'VENUE_FACILITY' && r.categoryId === c.id)?.terms ?? null) as
        | CommercialTermsOverride
        | null,
      ...this.mergeRows(rows, venueId, c.id),
    }));
  }

  /**
   * listForVenue for many venues at once, in a fixed number of queries instead of several per venue: an owner with
   * hundreds of venues would otherwise wait on hundreds of round trips. Same items, same order, keyed by venue id.
   */
  async listForVenues(venueIds: string[]) {
    type Item = Awaited<ReturnType<CommercialTermsService['listForVenue']>>[number];
    const result = new Map<string, Item[]>();
    if (venueIds.length === 0) return result;
    const [resources, groups, deals] = await Promise.all([
      this.prisma.client.resource.findMany({
        where: { venueId: { in: venueIds } },
        select: { venueId: true, categoryId: true },
        distinct: ['venueId', 'categoryId'],
      }),
      this.prisma.client.resourceGroup.findMany({
        where: { venueId: { in: venueIds } },
        select: { venueId: true, categoryId: true },
        distinct: ['venueId', 'categoryId'],
      }),
      this.prisma.client.commercialPolicy.findMany({
        where: { scope: 'VENUE_FACILITY', venueId: { in: venueIds } },
        select: { venueId: true, categoryId: true },
      }),
    ]);
    // The facilities each venue offers through its units, plus any it has a deal for.
    const offered = new Map<string, Set<string>>();
    const offer = (venueId: string | null, categoryId: string | null) => {
      if (!venueId || !categoryId) return;
      const set = offered.get(venueId) ?? new Set<string>();
      set.add(categoryId);
      offered.set(venueId, set);
    };
    for (const r of [...resources, ...groups, ...deals]) offer(r.venueId, r.categoryId);
    const categoryIds = [...new Set([...offered.values()].flatMap((set) => [...set]))];
    const [categories, rows] = await Promise.all([
      this.prisma.client.venueCategory.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.client.commercialPolicy.findMany({
        where: {
          OR: [
            { scope: 'PLATFORM_DEFAULT' },
            { scope: 'FACILITY', categoryId: { in: categoryIds } },
            { scope: 'VENUE_FACILITY', venueId: { in: venueIds } },
          ],
        },
      }),
    ]);
    for (const venueId of venueIds) {
      const mine = offered.get(venueId) ?? new Set<string>();
      result.set(
        venueId,
        categories
          .filter((c) => mine.has(c.id))
          .map((c) => ({
            categoryId: c.id,
            name: c.name,
            own: (rows.find((r) => r.scope === 'VENUE_FACILITY' && r.venueId === venueId && r.categoryId === c.id)?.terms ?? null) as
              | CommercialTermsOverride
              | null,
            ...this.mergeRows(rows, venueId, c.id),
          })),
      );
    }
    return result;
  }

  async putVenueFacility(venueId: string, categoryId: string, body: unknown, actor: AuthContext) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId }, select: { id: true } });
    if (!venue) throw new NotFoundException('Venue not found');
    await this.assertCategory(categoryId);
    const own = parseOrThrow(commercialTermsOverrideSchema, body);
    const all = await this.prisma.client.commercialPolicy.findMany();
    const candidate = this.replaceRow(all, { scope: 'VENUE_FACILITY', categoryId, venueId }, own);
    await this.assertValid(
      candidate,
      candidate.filter((r) => r.scope === 'VENUE_FACILITY' && r.venueId === venueId && r.categoryId === categoryId),
    );

    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.commercialPolicy.findFirst({ where: { scope: 'VENUE_FACILITY', venueId, categoryId } });
      if (existing) await tx.commercialPolicy.update({ where: { id: existing.id }, data: { terms: own } });
      else await tx.commercialPolicy.create({ data: { scope: 'VENUE_FACILITY', venueId, categoryId, terms: own } });
    });
    await this.audit.record({
      actor,
      action: 'COMMERCIAL_TERMS_UPDATED',
      entityType: 'Venue',
      entityId: venueId,
      metadata: { scope: 'VENUE_FACILITY', categoryId, terms: own },
    });
    return this.listForVenue(venueId);
  }

  async deleteVenueFacility(venueId: string, categoryId: string, actor: AuthContext) {
    const { count } = await this.prisma.client.commercialPolicy.deleteMany({
      where: { scope: 'VENUE_FACILITY', venueId, categoryId },
    });
    if (count > 0) {
      await this.audit.record({
        actor,
        action: 'COMMERCIAL_TERMS_REMOVED',
        entityType: 'Venue',
        entityId: venueId,
        metadata: { scope: 'VENUE_FACILITY', categoryId },
      });
    }
    return this.listForVenue(venueId);
  }

  /** The owner's read-only view: what applies to each facility of their venue. */
  async listForOwner(venueId: string, actor: AuthContext) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId }, select: { organizationId: true } });
    if (!venue) throw new NotFoundException('Venue not found');
    if (venue.organizationId !== actor.organizationId) throw new ForbiddenException("Cannot access another organization's venue");
    await this.scope.assertVenue(actor, venueId);
    return (await this.listForVenue(venueId)).map(({ categoryId, name, terms }) => ({ categoryId, name, terms }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertCategory(categoryId: string) {
    const category = await this.prisma.client.venueCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw new NotFoundException('Facility not found');
  }

  private rowsFor(venueId: string | null, categoryId: string) {
    return this.prisma.client.commercialPolicy.findMany({
      where: {
        OR: [
          { scope: 'PLATFORM_DEFAULT' },
          { scope: 'FACILITY', categoryId },
          ...(venueId ? [{ scope: 'VENUE_FACILITY' as const, venueId, categoryId }] : []),
        ],
      },
    });
  }

  /** Facilities a venue offers through its units, plus any it has a deal for. */
  private async venueCategories(venueId: string) {
    return this.prisma.client.venueCategory.findMany({
      where: {
        OR: [
          { resources: { some: { venueId } } },
          { resourceGroups: { some: { venueId } } },
          { commercialPolicies: { some: { scope: 'VENUE_FACILITY', venueId } } },
        ],
      },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** The policy rows as they would be after writing `terms` at `target`. */
  private replaceRow(
    rows: CommercialPolicy[],
    target: { scope: CommercialPolicy['scope']; categoryId: string | null; venueId: string | null },
    terms: Partial<CommercialTerms>,
  ): CommercialPolicy[] {
    const same = (r: CommercialPolicy) =>
      r.scope === target.scope && r.categoryId === target.categoryId && r.venueId === target.venueId;
    const replacement = { ...(rows.find(same) ?? { id: 'candidate', createdAt: new Date(), updatedAt: new Date() }), ...target, terms };
    return [...rows.filter((r) => !same(r)), replacement as CommercialPolicy];
  }

  /**
   * Every facility / venue-deal combination touched by a write must still merge into complete, valid terms.
   * `affected` are the FACILITY / VENUE_FACILITY rows to check; the platform default is always checked on its
   * own facility-level values too.
   */
  private async assertValid(rows: CommercialPolicy[], affected: CommercialPolicy[]) {
    const combos = new Map<string, { venueId: string | null; categoryId: string }>();
    for (const r of affected) {
      if (!r.categoryId) continue;
      combos.set(`${r.venueId ?? ''}:${r.categoryId}`, { venueId: r.venueId, categoryId: r.categoryId });
    }
    const names = new Map(
      (
        await this.prisma.client.venueCategory.findMany({
          where: { id: { in: [...combos.values()].map((c) => c.categoryId) } },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );

    const problems: string[] = [];
    const def = rows.find((r) => r.scope === 'PLATFORM_DEFAULT');
    if (def) {
      const parsed = commercialTermsSchema.safeParse(def.terms);
      if (parsed.success) problems.push(...commercialTermsProblems(parsed.data).map((p) => `Platform default: ${p}`));
    }
    for (const { venueId, categoryId } of combos.values()) {
      let terms: CommercialTerms;
      try {
        terms = mergeCommercialTerms([
          { source: 'VENUE_FACILITY', terms: venueId ? (rows.find((r) => r.scope === 'VENUE_FACILITY' && r.venueId === venueId && r.categoryId === categoryId)?.terms as Partial<CommercialTerms>) : undefined },
          { source: 'FACILITY', terms: rows.find((r) => r.scope === 'FACILITY' && r.categoryId === categoryId)?.terms as Partial<CommercialTerms> },
          { source: 'PLATFORM_DEFAULT', terms: def?.terms as Partial<CommercialTerms> },
        ]).terms;
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      const label = `${names.get(categoryId) ?? 'Facility'}${venueId ? ' (venue deal)' : ''}`;
      problems.push(...commercialTermsProblems(terms).map((p) => `${label}: ${p}`));
    }
    if (problems.length > 0) throw new BadRequestException([...new Set(problems)].join(' '));
  }
}
