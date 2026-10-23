/** Commercial terms as the API returns and accepts them (packages/shared/src/commercial.ts). */
export interface CommissionTier {
  fromBooking: number;
  type: 'PERCENTAGE' | 'FLAT';
  value: number;
}

export interface CancellationTier {
  minHoursBeforeStart: number;
  refundPercent: number;
  ownerPercent: number;
}

export interface CommercialTerms {
  commissionTiers: CommissionTier[];
  monthlyCommissionCap: number | null;
  afterCapFeePercent: number;
  minAdvancePercent: number;
  cancellationTiers: CancellationTier[];
  cancelCutoffMinutes: number;
  payoutWeekday: number;
  payoutTimezone: string;
}

export type TermKey = keyof CommercialTerms;
export type TermSource = 'PLATFORM_DEFAULT' | 'FACILITY' | 'VENUE_FACILITY';

/** GET /admin/categories/:id/commercial-terms */
export interface FacilityTerms {
  own: Partial<CommercialTerms>;
  terms: CommercialTerms;
  sources: Record<TermKey, TermSource>;
}

/** GET /admin/venues/:id/commercial-terms (one row per facility the venue offers) */
export interface VenueFacilityTerms extends Omit<FacilityTerms, 'own'> {
  categoryId: string;
  name: string;
  own: Partial<CommercialTerms> | null;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "10%", "₹55 flat". */
export function describeTier(t: CommissionTier): string {
  return t.type === 'PERCENTAGE' ? `${t.value}%` : `₹${t.value} flat`;
}

/** One-line summary of a facility's terms, for lists. */
export function summarize(t: CommercialTerms): string {
  const commission = t.commissionTiers.map(describeTier).join(' → ');
  const cap = t.monthlyCommissionCap === null ? 'no cap' : `capped at ₹${t.monthlyCommissionCap}/month`;
  return `${commission} commission, ${cap}; ${t.minAdvancePercent}% minimum advance`;
}

export function money(value: string | number): string {
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
