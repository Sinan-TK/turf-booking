import {
  cancellationDeadlines,
  cancellationOutcome,
  commercialTermsOverrideSchema,
  commercialTermsProblems,
  commercialTermsSchema,
  mergeCommercialTerms,
  minAdvanceMinor,
  settlePlayedBooking,
  type CommercialTerms,
} from '@venue/shared';

/**
 * The pure commercial rules (packages/shared/src/commercial.ts): term merging and validation, commission with
 * tiers and a monthly cap, the after-cap fee, the minimum advance and the cancellation windows. No app or
 * database: every number comes from the terms passed in.
 */
const base: CommercialTerms = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: 2500,
  afterCapFeePercent: 2.5,
  minAdvancePercent: 25,
  cancellationTiers: [
    { minHoursBeforeStart: 6, refundPercent: 100, ownerPercent: 0 },
    { minHoursBeforeStart: 1, refundPercent: 30, ownerPercent: 50 },
  ],
  cancelCutoffMinutes: 60,
  payoutWeekday: 1,
  payoutTimezone: 'Asia/Kolkata',
};

describe('commercial terms: merging and validation', () => {
  test('the most specific layer wins per field, and sources say where each value came from', () => {
    const resolved = mergeCommercialTerms([
      { source: 'VENUE_FACILITY', terms: { monthlyCommissionCap: 2000 } },
      { source: 'FACILITY', terms: { minAdvancePercent: 50, monthlyCommissionCap: null } },
      { source: 'PLATFORM_DEFAULT', terms: base },
    ]);
    expect(resolved.terms.monthlyCommissionCap).toBe(2000);
    expect(resolved.sources.monthlyCommissionCap).toBe('VENUE_FACILITY');
    expect(resolved.terms.minAdvancePercent).toBe(50);
    expect(resolved.sources.minAdvancePercent).toBe('FACILITY');
    expect(resolved.terms.payoutWeekday).toBe(1);
    expect(resolved.sources.payoutWeekday).toBe('PLATFORM_DEFAULT');
  });

  test('an explicit null (no cap) overrides an inherited cap', () => {
    const resolved = mergeCommercialTerms([
      { source: 'FACILITY', terms: { monthlyCommissionCap: null } },
      { source: 'PLATFORM_DEFAULT', terms: base },
    ]);
    expect(resolved.terms.monthlyCommissionCap).toBeNull();
  });

  test('a key set nowhere is an error, not a silent default', () => {
    const { payoutTimezone: _omit, ...incomplete } = base;
    expect(() => mergeCommercialTerms([{ source: 'PLATFORM_DEFAULT', terms: incomplete }])).toThrow(/payoutTimezone/);
  });

  test('facility overrides cannot set platform-only keys, and unknown keys are rejected', () => {
    expect(commercialTermsOverrideSchema.safeParse({ payoutWeekday: 3 }).success).toBe(false);
    expect(commercialTermsOverrideSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(commercialTermsOverrideSchema.safeParse({ minAdvancePercent: 40 }).success).toBe(true);
  });

  test('field rules: tier order, percentages, refund + owner share, timezone', () => {
    const bad = (patch: Partial<CommercialTerms>) => commercialTermsSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ commissionTiers: [{ fromBooking: 2, type: 'PERCENTAGE', value: 10 }] })).toBe(false);
    expect(
      bad({
        commissionTiers: [
          { fromBooking: 1, type: 'PERCENTAGE', value: 10 },
          { fromBooking: 1, type: 'PERCENTAGE', value: 5 },
        ],
      }),
    ).toBe(false);
    expect(bad({ commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 101 }] })).toBe(false);
    expect(bad({ cancellationTiers: [{ minHoursBeforeStart: 1, refundPercent: 60, ownerPercent: 50 }] })).toBe(false);
    expect(bad({ payoutTimezone: 'Mars/Olympus' })).toBe(false);
    expect(bad({})).toBe(true);
  });

  test('cross-field rules: commission within the advance, windows reach the cut-off', () => {
    expect(commercialTermsProblems(base)).toEqual([]);
    expect(
      commercialTermsProblems({ ...base, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 30 }] }),
    ).toHaveLength(1);
    expect(commercialTermsProblems({ ...base, cancelCutoffMinutes: 30 })).toHaveLength(1);
  });
});

describe('commercial maths', () => {
  test('minimum advance rounds up to the paisa', () => {
    expect(minAdvanceMinor(120_000, { minAdvancePercent: 25 })).toBe(30_000);
    expect(minAdvanceMinor(99_999, { minAdvancePercent: 33 })).toBe(33_000);
  });

  test('commission is capped per month: full, partial, then only the after-cap fee', () => {
    const terms = { ...base, monthlyCommissionCap: 250 };
    const at = (bookingsBefore: number, commissionBeforeMinor: number) =>
      settlePlayedBooking({ fullPriceMinor: 100_000, collectedMinor: 30_000, bookingsBefore, commissionBeforeMinor, terms });

    const first = at(0, 0);
    expect(first.commissionMinor).toBe(10_000);
    expect(first.feeMinor).toBe(0);
    expect(first.ownerMinor).toBe(20_000);

    const third = at(2, 20_000); // 50 left under the cap
    expect(third.commissionMinor).toBe(5_000);
    expect(third.feeMinor).toBe(0);
    expect(third.capReachedBefore).toBe(false);

    const fourth = at(3, 25_000);
    expect(fourth.commissionMinor).toBe(0);
    expect(fourth.capReachedBefore).toBe(true);
    expect(fourth.feeMinor).toBe(750); // 2.5% of 300
    expect(fourth.ownerMinor).toBe(29_250);
    expect(fourth.platformMinor).toBe(750);
  });

  test('no cap means commission on every booking and never a fee', () => {
    const r = settlePlayedBooking({
      fullPriceMinor: 160_000,
      collectedMinor: 80_000,
      bookingsBefore: 500,
      commissionBeforeMinor: 10_000_000,
      terms: { ...base, monthlyCommissionCap: null, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 18 }] },
    });
    expect(r.commissionMinor).toBe(28_800);
    expect(r.feeMinor).toBe(0);
  });

  test('tiers change the rate from the given booking of the month', () => {
    const terms = {
      ...base,
      monthlyCommissionCap: null,
      commissionTiers: [
        { fromBooking: 1, type: 'PERCENTAGE' as const, value: 15 },
        { fromBooking: 30, type: 'PERCENTAGE' as const, value: 12 },
      ],
    };
    const n = (bookingsBefore: number) =>
      settlePlayedBooking({ fullPriceMinor: 100_000, collectedMinor: 30_000, bookingsBefore, commissionBeforeMinor: 0, terms });
    expect(n(28).commissionMinor).toBe(15_000); // 29th booking
    expect(n(29).commissionMinor).toBe(12_000); // 30th booking
  });

  test('a flat commission never takes more than was collected', () => {
    const r = settlePlayedBooking({
      fullPriceMinor: 50_000,
      collectedMinor: 5_000,
      bookingsBefore: 0,
      commissionBeforeMinor: 0,
      terms: { ...base, monthlyCommissionCap: null, commissionTiers: [{ fromBooking: 1, type: 'FLAT', value: 80 }] },
    });
    expect(r.commissionMinor).toBe(5_000);
    expect(r.ownerMinor).toBe(0);
  });

  test('cancellation windows: full refund, late split, then blocked', () => {
    const paid = 30_000;
    const early = cancellationOutcome(base, 7 * 60, paid);
    expect(early).toMatchObject({ allowed: true, refundMinor: 30_000, ownerMinor: 0, platformMinor: 0 });
    const late = cancellationOutcome(base, 3 * 60, paid);
    expect(late).toMatchObject({ allowed: true, refundMinor: 9_000, ownerMinor: 15_000, platformMinor: 6_000 });
    const edge = cancellationOutcome(base, 60, paid); // exactly at the cut-off is still allowed
    expect(edge.allowed).toBe(true);
    expect(cancellationOutcome(base, 59, paid)).toEqual({ allowed: false, reason: 'CUTOFF' });
    expect(cancellationOutcome(base, -10, paid)).toEqual({ allowed: false, reason: 'CUTOFF' });
  });

  test('deadlines are absolute times before the start', () => {
    const start = new Date('2026-11-10T14:00:00Z');
    const d = cancellationDeadlines(base, start);
    expect(d.windows.map((w) => w.until.toISOString())).toEqual(['2026-11-10T08:00:00.000Z', '2026-11-10T13:00:00.000Z']);
    expect(d.windows.map((w) => w.refundPercent)).toEqual([100, 30]);
    expect(d.closesAt.toISOString()).toBe('2026-11-10T13:00:00.000Z');
  });
});
