import type { PrismaClient } from '@prisma/client';

/**
 * Removes the data the automated tests create, and everything that hangs off it, so the tests leave the database as they found it.
 *
 * What counts as test data is decided only by names the tests give their own data (never "everything recent"):
 *  - facilities with a slug starting PW_ or E2E_,
 *  - venues and owner organisations named "PW …" or "E2E …",
 *  - owner logins with an email starting pw- or e2e-, and admin logins with an email starting e2e-,
 *  - customers named "PW …" or "E2E …" or with an email like pw…@example.com.
 *
 * Rows that depend on those (units, bookings, payments, prices, sessions…) go with them. The dependency map is read from the
 * database's own foreign keys, so new tables are covered without changing this file. It works from the seeds downwards and never
 * deletes a parent of something it keeps, and it runs in one transaction: any problem leaves everything as it was.
 */
const SEEDS: Record<string, string> = {
  venue_categories: `"slug" LIKE 'PW\_%' OR "slug" LIKE 'E2E\_%'`,
  venues: `"name" LIKE 'PW %' OR "name" LIKE 'E2E %'`,
  owner_organizations: `"name" LIKE 'PW %' OR "name" LIKE 'E2E %'`,
  venue_owner_users: `"email" LIKE 'pw-%@%' OR "email" LIKE 'e2e-%@%'`,
  admin_users: `"email" LIKE 'e2e-%@%'`,
  customer_profiles: `"name" LIKE 'PW %' OR "name" LIKE 'E2E %' OR "email" LIKE 'pw%@example.com'`,
};

interface Fk {
  child: string;
  childCol: string;
  parent: string;
  parentCol: string;
  rule: string;
}

export interface PurgeResult {
  /** Rows removed (or, in a dry run, that would be removed) per table, only tables with rows. */
  tables: Record<string, number>;
  total: number;
  dryRun: boolean;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function purgeTestData(prisma: PrismaClient, options: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const dryRun = options.dryRun ?? false;
  return prisma.$transaction(
    async (tx) => {
      const fks = (await tx.$queryRawUnsafe<Fk[]>(`
        SELECT c.conrelid::regclass::text AS child, ca.attname AS "childCol", c.confrelid::regclass::text AS parent,
               pa.attname AS "parentCol", c.confdeltype::text AS rule
        FROM pg_constraint c
        JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1
          AND c.conrelid <> c.confrelid`)).filter((f) => f.rule !== 'n'); // SET NULL children keep their rows
      const composite = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND array_length(conkey, 1) > 1`,
      );
      if (composite[0]!.n > 0) throw new Error('A multi-column foreign key exists; purgeTestData does not handle it yet.');

      const cols = await tx.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      const hasId = new Set(cols.filter((c) => c.column_name === 'id').map((c) => c.table_name));
      const tables = [...new Set(cols.map((c) => c.table_name))].filter((t) => t !== '_prisma_migrations');
      for (const f of fks) if (f.parentCol !== 'id' || !hasId.has(f.parent)) throw new Error(`${f.child}.${f.childCol} refers to ${f.parent}.${f.parentCol}, not an "id".`);
      for (const t of Object.keys(SEEDS)) if (!tables.includes(t)) throw new Error(`Table ${t} not found; update purge-test-data.ts.`);

      // Parents before children, so each table's selection can refer to its parents' already-chosen ids.
      const order: string[] = [];
      const placed = new Set<string>();
      while (order.length < tables.length) {
        const ready = tables.filter((t) => !placed.has(t) && fks.filter((f) => f.child === t).every((f) => placed.has(f.parent)));
        if (ready.length === 0) throw new Error('The foreign keys form a cycle; purgeTestData cannot order them.');
        for (const t of ready) {
          order.push(t);
          placed.add(t);
        }
      }

      // Which tables can hold test rows: the seeded ones and, transitively, everything that refers to them.
      const reach = new Set(Object.keys(SEEDS));
      for (let grew = true; grew; ) {
        grew = false;
        for (const f of fks) if (reach.has(f.parent) && !reach.has(f.child)) (reach.add(f.child), (grew = true));
      }

      const chosen = order.filter((t) => reach.has(t));
      for (const t of chosen) {
        const parts = [
          ...(SEEDS[t] ? [`(${SEEDS[t]})`] : []),
          ...fks.filter((f) => f.child === t && reach.has(f.parent)).map((f) => `${q(f.childCol)} IN (SELECT id FROM ${q(`d_${f.parent}`)})`),
        ];
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE ${q(`d_${t}`)} ON COMMIT DROP AS SELECT ctid AS rid${hasId.has(t) ? ', id' : ''} FROM ${q(t)} WHERE ${parts.join(' OR ')}`,
        );
      }

      const counts: Record<string, number> = {};
      for (const t of chosen) {
        const n = (await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${q(`d_${t}`)}`))[0]?.n ?? 0;
        if (n > 0) counts[t] = n;
      }
      if (!dryRun) {
        // Children first, so nothing is still referenced when its parent goes.
        for (const t of [...chosen].reverse()) {
          // By id where there is one: another table's SET NULL rule can update a row and so move its physical position (ctid).
          if (counts[t]) await tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE ${hasId.has(t) ? 'id IN (SELECT id FROM' : 'ctid IN (SELECT rid FROM'} ${q(`d_${t}`)})`);
        }
      }
      return { tables: counts, total: Object.values(counts).reduce((a, b) => a + b, 0), dryRun };
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}
