import { z } from 'zod';

/**
 * Commercial terms: what the platform earns on a booking, how much must be paid online, what a cancellation
 * returns and when owners are paid. Nothing here is a hard-coded business number: every value comes from a
 * stored policy (platform default -> facility -> venue's own deal), merged field by field.
 *
 * Money maths works in minor units (paise) as integers, so it is exact.
 */

export const commissionTierSchema = z
  .object({
    /** The tier applies from this booking of the month onwards (1 = from the first). */
    fromBooking: z.number().int().min(1),
    type: z.enum(['PERCENTAGE', 'FLAT']),
    /** A percentage of the full price, or a flat amount per booking. */
    value: z.number().min(0),
  })
  .refine((t) => t.type !== 'PERCENTAGE' || t.value <= 100, {
    message: 'A percentage commission can be at most 100.',
    path: ['value'],
  });
export type CommissionTier = z.infer<typeof commissionTierSchema>;

export const cancellationTierSchema = z
  .object({
    /** Applies to cancellations made at least this many hours before the start. */
    minHoursBeforeStart: z.number().min(0),
    /** Share of what was paid online returned to the customer as coins. */
    refundPercent: z.number().min(0).max(100),
    /** Share paid to the venue owner. The platform keeps the rest. */
    ownerPercent: z.number().min(0).max(100),
  })
  .refine((t) => t.refundPercent + t.ownerPercent <= 100, {
    message: 'Refund and owner shares together can be at most 100%.',
    path: ['ownerPercent'],
  });
export type CancellationTier = z.infer<typeof cancellationTierSchema>;

const commissionTiers = z
  .array(commissionTierSchema)
  .min(1)
  .max(20)
  .refine((tiers) => tiers[0]?.fromBooking === 1, { message: 'The first commission tier must start at booking 1.' })
  .refine((tiers) => tiers.every((t, i) => i === 0 || t.fromBooking > tiers[i - 1]!.fromBooking), {
    message: 'Commission tiers must be in increasing booking order.',
  });

const cancellationTiers = z
  .array(cancellationTierSchema)
  .min(1)
  .max(20)
  .refine((tiers) => new Set(tiers.map((t) => t.minHoursBeforeStart)).size === tiers.length, {
    message: 'Two cancellation windows start at the same time.',
  });

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Terms that can differ per facility (and per venue deal). */
const facilityTermsShape = {
  commissionTiers,
  /** Most commission one venue pays per facility per month; null = no cap. */
  monthlyCommissionCap: z.number().min(0).nullable(),
  /** On = the cap is multiplied by the number of units the venue has in this facility (two turfs: twice the cap). Missing in older terms = on. */
  capPerUnit: z.boolean().default(true),
  /** Percentage of what was paid online charged instead of commission once the cap is reached. */
  afterCapFeePercent: z.number().min(0).max(100),
  /** The online advance must be at least this percentage of the full price. */
  minAdvancePercent: z.number().min(0).max(100),
  /** Off = customers can't cancel a paid booking at all (staff still can). Missing in older terms = on. */
  cancellationEnabled: z.boolean().default(true),
  cancellationTiers,
  /** Customers can't cancel a paid booking less than this many minutes before the start. */
  cancelCutoffMinutes: z.number().int().min(0).max(60 * 24 * 365),
};

/** Terms that only exist platform-wide (owners get one payout across all their facilities). */
const platformTermsShape = {
  /** Owners are paid weekly on this ISO weekday (1 = Monday ... 7 = Sunday). */
  payoutWeekday: z.number().int().min(1).max(7),
  /** The timezone payout weeks are counted in. */
  payoutTimezone: z.string().refine(isTimeZone, { message: 'Unknown timezone.' }),
  /** An Initiated payout that is still unpaid this many days after it was created is shown to the admin as overdue. Missing in older terms = 5. */
  payoutOverdueDays: z.number().int().min(1).max(365).default(5),
};

export const commercialTermsSchema = z.object({ ...facilityTermsShape, ...platformTermsShape }).strict();
export type CommercialTerms = z.infer<typeof commercialTermsSchema>;
export type CommercialTermKey = keyof CommercialTerms;

/** A facility's or a venue deal's own terms: only the keys it sets, the rest inherit. */
export const commercialTermsOverrideSchema = z.object(facilityTermsShape).partial().strict();
export type CommercialTermsOverride = z.infer<typeof commercialTermsOverrideSchema>;

export const COMMERCIAL_TERM_KEYS = Object.keys(commercialTermsSchema.shape) as CommercialTermKey[];
export const PLATFORM_ONLY_TERM_KEYS: CommercialTermKey[] = ['payoutWeekday', 'payoutTimezone', 'payoutOverdueDays'];

export type CommercialSource = 'PLATFORM_DEFAULT' | 'FACILITY' | 'VENUE_FACILITY';

export interface ResolvedCommercialTerms {
  terms: CommercialTerms;
  /** Where each value came from, for "inherited from ..." labels. */
  sources: Record<CommercialTermKey, CommercialSource>;
}

/**
 * Field-by-field merge, most specific layer first: a venue deal can change one number and keep the rest of the
 * facility's terms. Throws when no layer sets a key (the platform default must be complete).
 */
export function mergeCommercialTerms(
  layers: Array<{ source: CommercialSource; terms: Partial<CommercialTerms> | null | undefined }>,
): ResolvedCommercialTerms {
  const terms: Partial<Record<CommercialTermKey, unknown>> = {};
  const sources: Partial<Record<CommercialTermKey, CommercialSource>> = {};
  for (const key of COMMERCIAL_TERM_KEYS) {
    const layer = layers.find((l) => l.terms && Object.prototype.hasOwnProperty.call(l.terms, key));
    // Terms saved before the switch existed have no value for it: cancelling stays on.
    if (!layer && key === 'payoutOverdueDays') {
      terms[key] = 5;
      sources[key] = 'PLATFORM_DEFAULT';
      continue;
    }
    if (!layer && (key === 'cancellationEnabled' || key === 'capPerUnit')) {
      terms[key] = true;
      sources[key] = 'PLATFORM_DEFAULT';
      continue;
    }
    if (!layer) throw new Error(`Commercial terms are not configured: "${key}" has no value at any level.`);
    terms[key] = (layer.terms as Record<string, unknown>)[key];
    sources[key] = layer.source;
  }
  return {
    terms: commercialTermsSchema.parse(terms),
    sources: sources as Record<CommercialTermKey, CommercialSource>,
  };
}

/** Rules that span several fields, checked on the merged result. Returns human-readable problems. */
export function commercialTermsProblems(terms: CommercialTerms): string[] {
  const problems: string[] = [];
  const maxPercent = Math.max(0, ...terms.commissionTiers.filter((t) => t.type === 'PERCENTAGE').map((t) => t.value));
  if (maxPercent > terms.minAdvancePercent) {
    problems.push(
      `The commission (${maxPercent}%) can't be more than the minimum online advance (${terms.minAdvancePercent}%), because the commission is taken out of the advance.`,
    );
  }
  if (terms.cancellationEnabled === false) return problems;
  const lowestWindowMinutes = Math.min(...terms.cancellationTiers.map((t) => t.minHoursBeforeStart)) * 60;
  if (lowestWindowMinutes > terms.cancelCutoffMinutes) {
    problems.push(
      'The last cancellation window must start at or before the cancellation cut-off, so every allowed cancellation has a refund rule.',
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Money maths (integers in minor units)
// ---------------------------------------------------------------------------

export function toMinor(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

export function fromMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** The smallest online advance allowed for a full price (rounded up, so it never falls short). */
export function minAdvanceMinor(fullPriceMinor: number, terms: Pick<CommercialTerms, 'minAdvancePercent'>): number {
  return Math.ceil((fullPriceMinor * terms.minAdvancePercent) / 100);
}

/** The tier that applies to the n-th settled booking of the month (n starts at 1). */
export function commissionTierFor(tiers: CommissionTier[], bookingNumber: number): CommissionTier {
  let tier = tiers[0]!;
  for (const t of tiers) if (t.fromBooking <= bookingNumber) tier = t;
  return tier;
}

/** The monthly cap that applies to a venue: the cap times its units in the facility when capPerUnit is on. null = no cap. */
export function effectiveMonthlyCap(
  terms: Pick<CommercialTerms, 'monthlyCommissionCap'> & { capPerUnit?: boolean },
  unitCount: number,
): number | null {
  if (terms.monthlyCommissionCap === null) return null;
  const units = terms.capPerUnit === false ? 1 : Math.max(1, Math.floor(unitCount));
  return Math.round(terms.monthlyCommissionCap * units * 100) / 100;
}

export interface PlayedSettlementInput {
  /** The booking's full price (the commission base). */
  fullPriceMinor: number;
  /** What the platform collected online for it (money or coins). */
  collectedMinor: number;
  /** Settled, cap-counted bookings of this venue + facility earlier in the month. */
  bookingsBefore: number;
  /** Commission already charged to this venue + facility this month. */
  commissionBeforeMinor: number;
  terms: Pick<CommercialTerms, 'commissionTiers' | 'monthlyCommissionCap' | 'afterCapFeePercent'> & { capPerUnit?: boolean };
  /** The venue's units in this facility (the cap is multiplied by it when capPerUnit is on). Default 1. */
  unitCount?: number;
}

export interface PlayedSettlement {
  tier: CommissionTier;
  bookingNumber: number;
  commissionMinor: number;
  feeMinor: number;
  ownerMinor: number;
  platformMinor: number;
  /** The cap was already reached before this booking, so only the fee applied. */
  capReachedBefore: boolean;
}

/**
 * A played (or no-show) booking: commission by the month's tier, limited by the monthly cap; once the cap has
 * been reached, the after-cap fee applies instead. Both come out of what was collected online.
 */
export function settlePlayedBooking(input: PlayedSettlementInput): PlayedSettlement {
  const bookingNumber = input.bookingsBefore + 1;
  const tier = commissionTierFor(input.terms.commissionTiers, bookingNumber);
  let commission =
    tier.type === 'PERCENTAGE' ? Math.round((input.fullPriceMinor * tier.value) / 100) : toMinor(tier.value);

  const cap = effectiveMonthlyCap(input.terms, input.unitCount ?? 1);
  const capMinor = cap === null ? null : toMinor(cap);
  const capReachedBefore = capMinor !== null && input.commissionBeforeMinor >= capMinor;
  if (capMinor !== null) commission = Math.min(commission, Math.max(0, capMinor - input.commissionBeforeMinor));
  let fee = capReachedBefore ? Math.round((input.collectedMinor * input.terms.afterCapFeePercent) / 100) : 0;

  // Never take more than was collected online (a flat commission on a small advance, say).
  commission = Math.min(commission, input.collectedMinor);
  fee = Math.min(fee, input.collectedMinor - commission);
  return {
    tier,
    bookingNumber,
    commissionMinor: commission,
    feeMinor: fee,
    ownerMinor: input.collectedMinor - commission - fee,
    platformMinor: commission + fee,
    capReachedBefore,
  };
}

export type CancellationOutcome =
  | { allowed: false; reason: 'CUTOFF' | 'DISABLED' }
  | {
      allowed: true;
      tier: CancellationTier;
      refundMinor: number;
      ownerMinor: number;
      platformMinor: number;
    };

/** What a customer cancellation `minutesBeforeStart` before the start does with the amount paid online. */
export function cancellationOutcome(
  terms: Pick<CommercialTerms, 'cancellationTiers' | 'cancelCutoffMinutes'> & { cancellationEnabled?: boolean },
  minutesBeforeStart: number,
  collectedMinor: number,
): CancellationOutcome {
  if (terms.cancellationEnabled === false) return { allowed: false, reason: 'DISABLED' };
  if (minutesBeforeStart < terms.cancelCutoffMinutes) return { allowed: false, reason: 'CUTOFF' };
  const tier = [...terms.cancellationTiers]
    .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
    .find((t) => minutesBeforeStart >= t.minHoursBeforeStart * 60);
  if (!tier) return { allowed: false, reason: 'CUTOFF' };
  const refund = Math.round((collectedMinor * tier.refundPercent) / 100);
  const owner = Math.min(Math.round((collectedMinor * tier.ownerPercent) / 100), collectedMinor - refund);
  return { allowed: true, tier, refundMinor: refund, ownerMinor: owner, platformMinor: collectedMinor - refund - owner };
}

/** The cancellation windows of a booking as absolute times, latest-ending first (for "free until 4 PM" copy). */
export function cancellationDeadlines(
  terms: Pick<CommercialTerms, 'cancellationTiers' | 'cancelCutoffMinutes'>,
  startTime: Date,
): { windows: Array<{ until: Date; refundPercent: number }>; closesAt: Date } {
  const ms = (minutes: number) => startTime.getTime() - minutes * 60_000;
  const windows = [...terms.cancellationTiers]
    .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
    .map((t) => ({ until: new Date(ms(t.minHoursBeforeStart * 60)), refundPercent: t.refundPercent }));
  return { windows, closesAt: new Date(ms(terms.cancelCutoffMinutes)) };
}
