'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  WEEKDAYS,
  describeTier,
  type CancellationTier,
  type CommercialTerms,
  type CommissionTier,
  type TermKey,
  type TermSource,
} from '@/lib/commercial';
import { Button, ErrorBanner, FieldError, Input, Label, Select, SuccessBanner, invalidClass } from '@/components/ui';

/**
 * Edits commercial terms at one level.
 *  - 'platform': every value, including the payout schedule (the default new facilities start from).
 *  - 'facility': every facility-level value.
 *  - 'override': a venue's own deal for a facility: each group has a switch; only switched-on groups are saved,
 *    the rest keep following the facility.
 */
type Mode = 'platform' | 'facility' | 'override';

type Group = 'commission' | 'cap' | 'afterCap' | 'advance' | 'cancellation' | 'cutoff' | 'payout';
const GROUP_KEYS: Record<Group, TermKey[]> = {
  commission: ['commissionTiers'],
  cap: ['monthlyCommissionCap'],
  afterCap: ['afterCapFeePercent'],
  advance: ['minAdvancePercent'],
  cancellation: ['cancellationTiers'],
  cutoff: ['cancelCutoffMinutes'],
  payout: ['payoutWeekday', 'payoutTimezone'],
};
const FACILITY_GROUPS: Group[] = ['commission', 'cap', 'afterCap', 'advance', 'cancellation', 'cutoff'];

interface Draft {
  commissionTiers: Array<{ fromBooking: string; type: 'PERCENTAGE' | 'FLAT'; value: string }>;
  monthlyCommissionCap: string;
  afterCapFeePercent: string;
  minAdvancePercent: string;
  cancellationTiers: Array<{ minHoursBeforeStart: string; refundPercent: string; ownerPercent: string }>;
  cancelCutoffMinutes: string;
  payoutWeekday: string;
  payoutTimezone: string;
}

function toDraft(t: CommercialTerms): Draft {
  return {
    commissionTiers: t.commissionTiers.map((x) => ({ fromBooking: String(x.fromBooking), type: x.type, value: String(x.value) })),
    monthlyCommissionCap: t.monthlyCommissionCap === null ? '' : String(t.monthlyCommissionCap),
    afterCapFeePercent: String(t.afterCapFeePercent),
    minAdvancePercent: String(t.minAdvancePercent),
    cancellationTiers: t.cancellationTiers.map((x) => ({
      minHoursBeforeStart: String(x.minHoursBeforeStart),
      refundPercent: String(x.refundPercent),
      ownerPercent: String(x.ownerPercent),
    })),
    cancelCutoffMinutes: String(t.cancelCutoffMinutes),
    payoutWeekday: String(t.payoutWeekday),
    payoutTimezone: t.payoutTimezone,
  };
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

/** Checks one group of the draft; returns a message or undefined. */
function groupError(group: Group, d: Draft): string | undefined {
  const pct = (v: string, label: string) => {
    const n = num(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return `${label} must be between 0 and 100.`;
  };
  switch (group) {
    case 'commission': {
      let prev = 0;
      for (const [i, t] of d.commissionTiers.entries()) {
        const from = num(t.fromBooking);
        const value = num(t.value);
        if (!Number.isInteger(from) || from < 1) return `Tier ${i + 1}: enter the booking number it starts from (1 or more).`;
        if (i === 0 && from !== 1) return 'The first tier must start at booking 1.';
        if (i > 0 && from <= prev) return `Tier ${i + 1} must start after booking ${prev}.`;
        if (!Number.isFinite(value) || value < 0) return `Tier ${i + 1}: enter the commission.`;
        if (t.type === 'PERCENTAGE' && value > 100) return `Tier ${i + 1}: a percentage can be at most 100.`;
        prev = from;
      }
      return undefined;
    }
    case 'cap': {
      if (d.monthlyCommissionCap.trim() === '') return undefined;
      const n = num(d.monthlyCommissionCap);
      return Number.isFinite(n) && n >= 0 ? undefined : 'Enter the monthly cap in rupees, or leave it empty for no cap.';
    }
    case 'afterCap':
      return pct(d.afterCapFeePercent, 'The after-cap fee');
    case 'advance':
      return pct(d.minAdvancePercent, 'The minimum advance');
    case 'cancellation': {
      const seen = new Set<number>();
      for (const [i, t] of d.cancellationTiers.entries()) {
        const hours = num(t.minHoursBeforeStart);
        const refund = num(t.refundPercent);
        const owner = num(t.ownerPercent);
        if (!Number.isFinite(hours) || hours < 0) return `Window ${i + 1}: enter the hours before the start.`;
        if (seen.has(hours)) return `Two windows start at ${hours} hours.`;
        seen.add(hours);
        if (!Number.isFinite(refund) || refund < 0 || refund > 100) return `Window ${i + 1}: the customer share must be 0–100%.`;
        if (!Number.isFinite(owner) || owner < 0 || owner > 100) return `Window ${i + 1}: the owner share must be 0–100%.`;
        if (refund + owner > 100) return `Window ${i + 1}: the customer and owner shares add up to more than 100%.`;
      }
      return undefined;
    }
    case 'cutoff': {
      const n = num(d.cancelCutoffMinutes);
      return Number.isInteger(n) && n >= 0 ? undefined : 'Enter the cut-off in whole minutes (0 or more).';
    }
    case 'payout':
      return d.payoutTimezone.trim() ? undefined : 'Enter the timezone payout weeks are counted in, e.g. Asia/Kolkata.';
  }
}

/** The draft group as the API wants it. */
function groupValue(group: Group, d: Draft): Partial<CommercialTerms> {
  switch (group) {
    case 'commission':
      return {
        commissionTiers: d.commissionTiers.map((t): CommissionTier => ({ fromBooking: Number(t.fromBooking), type: t.type, value: Number(t.value) })),
      };
    case 'cap':
      return { monthlyCommissionCap: d.monthlyCommissionCap.trim() === '' ? null : Number(d.monthlyCommissionCap) };
    case 'afterCap':
      return { afterCapFeePercent: Number(d.afterCapFeePercent) };
    case 'advance':
      return { minAdvancePercent: Number(d.minAdvancePercent) };
    case 'cancellation':
      return {
        cancellationTiers: d.cancellationTiers.map(
          (t): CancellationTier => ({
            minHoursBeforeStart: Number(t.minHoursBeforeStart),
            refundPercent: Number(t.refundPercent),
            ownerPercent: Number(t.ownerPercent),
          }),
        ),
      };
    case 'cutoff':
      return { cancelCutoffMinutes: Number(d.cancelCutoffMinutes) };
    case 'payout':
      return { payoutWeekday: Number(d.payoutWeekday), payoutTimezone: d.payoutTimezone.trim() };
  }
}

const SOURCE_LABEL: Record<TermSource, string> = {
  PLATFORM_DEFAULT: 'the platform default',
  FACILITY: 'the facility',
  VENUE_FACILITY: 'this venue',
};

function Unit({ children, unit }: { children: React.ReactNode; unit: string }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">{unit}</span>
    </div>
  );
}

function GroupCard({
  title,
  hint,
  children,
  override,
  error,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  override?: { on: boolean; onChange: (v: boolean) => void; inherited: string };
  error?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500">{hint}</p>
        </div>
        {override && (
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-700">
            <input type="checkbox" checked={override.on} onChange={(e) => override.onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Custom for this venue
          </label>
        )}
      </div>
      {override && !override.on ? <p className="text-sm text-gray-600">{override.inherited}</p> : children}
      <FieldError id={`err-${title}`} message={error} />
    </div>
  );
}

export function CommercialTermsEditor({
  mode,
  own,
  effective,
  sources,
  onSave,
  onRemove,
}: {
  mode: Mode;
  /** Values set at this level (override mode: null = no deal yet). */
  own: Partial<CommercialTerms> | null;
  /** What applies right now, to prefill and to describe what an unset group inherits. */
  effective: CommercialTerms;
  sources?: Record<TermKey, TermSource>;
  onSave: (terms: Partial<CommercialTerms>) => Promise<void>;
  /** Override mode: drop the venue's deal altogether. */
  onRemove?: () => Promise<void>;
}) {
  const groups = mode === 'platform' ? [...FACILITY_GROUPS, 'payout' as Group] : FACILITY_GROUPS;
  const initialDraft = toDraft({ ...effective, ...(own ?? {}) } as CommercialTerms);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [enabled, setEnabled] = useState<Record<Group, boolean>>(() =>
    Object.fromEntries(
      (Object.keys(GROUP_KEYS) as Group[]).map((g) => [g, mode !== 'override' || GROUP_KEYS[g].every((k) => own != null && k in own)]),
    ) as Record<Group, boolean>,
  );
  const [errors, setErrors] = useState<Partial<Record<Group, string>>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  };
  const inherited = (group: Group): string => {
    const key = GROUP_KEYS[group][0]!;
    const from = sources ? SOURCE_LABEL[sources[key]] : 'the facility';
    const t = effective;
    const text =
      group === 'commission'
        ? t.commissionTiers.map((x) => `${describeTier(x)} from booking ${x.fromBooking}`).join(', then ')
        : group === 'cap'
          ? t.monthlyCommissionCap === null
            ? 'No monthly cap'
            : `₹${t.monthlyCommissionCap} a month`
          : group === 'afterCap'
            ? `${t.afterCapFeePercent}%`
            : group === 'advance'
              ? `${t.minAdvancePercent}%`
              : group === 'cancellation'
                ? t.cancellationTiers.map((x) => `${x.minHoursBeforeStart}h+: ${x.refundPercent}% to the customer, ${x.ownerPercent}% to the owner`).join('; ')
                : group === 'cutoff'
                  ? `${t.cancelCutoffMinutes} minutes before the start`
                  : `${WEEKDAYS[t.payoutWeekday - 1]}, ${t.payoutTimezone}`;
    return `${text} (from ${from})`;
  };
  const override = (group: Group) =>
    mode === 'override' ? { on: enabled[group], onChange: (v: boolean) => setEnabled((e) => ({ ...e, [group]: v })), inherited: inherited(group) } : undefined;

  async function submit() {
    const active = groups.filter((g) => enabled[g]);
    const found: Partial<Record<Group, string>> = {};
    for (const g of active) {
      const message = groupError(g, draft);
      if (message) found[g] = message;
    }
    setErrors(found);
    setApiError(null);
    if (Object.keys(found).length > 0) return;
    const body = Object.assign({}, ...active.map((g) => groupValue(g, draft))) as Partial<CommercialTerms>;
    setSaving(true);
    try {
      await onSave(body);
      setSaved(true);
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const cell = 'min-w-0';
  const tier = (i: number, p: Partial<Draft['commissionTiers'][number]>) =>
    patch({ commissionTiers: draft.commissionTiers.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const window = (i: number, p: Partial<Draft['cancellationTiers'][number]>) =>
    patch({ cancellationTiers: draft.cancellationTiers.map((t, j) => (j === i ? { ...t, ...p } : t)) });

  return (
    <div className="space-y-4">
      {groups.includes('commission') && (
        <GroupCard
          title="Commission"
          hint="What the platform takes from the full price of each played booking, by the venue's booking count in the month. Add a tier to change the rate after a milestone."
          override={override('commission')}
          error={errors.commission}
        >
          <div className="space-y-2">
            {draft.commissionTiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <div className={cell}>
                  {i === 0 && <Label>From booking no.</Label>}
                  <Input type="number" min={1} value={t.fromBooking} onChange={(e) => tier(i, { fromBooking: e.target.value })} aria-label={`Tier ${i + 1} starts at booking`} />
                </div>
                <div className={cell}>
                  {i === 0 && <Label>Type</Label>}
                  <Select value={t.type} onChange={(e) => tier(i, { type: e.target.value as 'PERCENTAGE' | 'FLAT' })} aria-label={`Tier ${i + 1} type`}>
                    <option value="PERCENTAGE">Percentage</option>
                    <option value="FLAT">Flat ₹ per booking</option>
                  </Select>
                </div>
                <div className={cell}>
                  {i === 0 && <Label>{t.type === 'PERCENTAGE' ? 'Percent' : 'Amount'}</Label>}
                  <Unit unit={t.type === 'PERCENTAGE' ? '%' : '₹'}>
                    <Input type="number" min={0} step="0.01" value={t.value} onChange={(e) => tier(i, { value: e.target.value })} className="pr-8" aria-label={`Tier ${i + 1} value`} />
                  </Unit>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={draft.commissionTiers.length === 1}
                  onClick={() => patch({ commissionTiers: draft.commissionTiers.filter((_, j) => j !== i) })}
                  aria-label={`Remove tier ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const last = draft.commissionTiers[draft.commissionTiers.length - 1];
                patch({
                  commissionTiers: [
                    ...draft.commissionTiers,
                    { fromBooking: String((Number(last?.fromBooking) || 0) + 30), type: 'PERCENTAGE', value: last?.value ?? '10' },
                  ],
                });
              }}
            >
              Add a tier
            </Button>
          </div>
        </GroupCard>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {groups.includes('cap') && (
          <GroupCard title="Monthly cap" hint="Most commission one venue pays for this facility in a month. Empty = no cap." override={override('cap')} error={errors.cap}>
            <Unit unit="₹">
              <Input type="number" min={0} placeholder="No cap" value={draft.monthlyCommissionCap} onChange={(e) => patch({ monthlyCommissionCap: e.target.value })} className={`pr-8 ${errors.cap ? invalidClass : ''}`} aria-label="Monthly commission cap" />
            </Unit>
          </GroupCard>
        )}
        {groups.includes('afterCap') && (
          <GroupCard title="Fee after the cap" hint="Percentage of the amount paid online, charged once the cap is reached." override={override('afterCap')} error={errors.afterCap}>
            <Unit unit="%">
              <Input type="number" min={0} max={100} step="0.01" value={draft.afterCapFeePercent} onChange={(e) => patch({ afterCapFeePercent: e.target.value })} className="pr-8" aria-label="Fee after the cap" />
            </Unit>
          </GroupCard>
        )}
        {groups.includes('advance') && (
          <GroupCard title="Minimum advance" hint="Paid online, as a percentage of the full price. Commission is taken out of it." override={override('advance')} error={errors.advance}>
            <Unit unit="%">
              <Input type="number" min={0} max={100} step="0.01" value={draft.minAdvancePercent} onChange={(e) => patch({ minAdvancePercent: e.target.value })} className="pr-8" aria-label="Minimum advance" />
            </Unit>
          </GroupCard>
        )}
      </div>

      {groups.includes('cancellation') && (
        <GroupCard
          title="Cancellation windows"
          hint="A customer who cancels at least this many hours before the start gets the customer share back as coins; the owner share goes to the owner and the rest stays with the platform."
          override={override('cancellation')}
          error={errors.cancellation}
        >
          <div className="space-y-2">
            {draft.cancellationTiers.map((t, i) => {
              const platform = 100 - (Number(t.refundPercent) || 0) - (Number(t.ownerPercent) || 0);
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-2">
                  <div className={cell}>
                    {i === 0 && <Label>Hours before start</Label>}
                    <Input type="number" min={0} step="0.5" value={t.minHoursBeforeStart} onChange={(e) => window(i, { minHoursBeforeStart: e.target.value })} aria-label={`Window ${i + 1} hours`} />
                  </div>
                  <div className={cell}>
                    {i === 0 && <Label>Customer gets (coins)</Label>}
                    <Unit unit="%">
                      <Input type="number" min={0} max={100} value={t.refundPercent} onChange={(e) => window(i, { refundPercent: e.target.value })} className="pr-8" aria-label={`Window ${i + 1} customer share`} />
                    </Unit>
                  </div>
                  <div className={cell}>
                    {i === 0 && <Label>Owner gets</Label>}
                    <Unit unit="%">
                      <Input type="number" min={0} max={100} value={t.ownerPercent} onChange={(e) => window(i, { ownerPercent: e.target.value })} className="pr-8" aria-label={`Window ${i + 1} owner share`} />
                    </Unit>
                  </div>
                  <p className={`pb-2 text-xs ${platform < 0 ? 'text-red-600' : 'text-gray-500'}`}>Platform {platform}%</p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={draft.cancellationTiers.length === 1}
                    onClick={() => patch({ cancellationTiers: draft.cancellationTiers.filter((_, j) => j !== i) })}
                    aria-label={`Remove window ${i + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              onClick={() => patch({ cancellationTiers: [...draft.cancellationTiers, { minHoursBeforeStart: '1', refundPercent: '0', ownerPercent: '0' }] })}
            >
              Add a window
            </Button>
          </div>
        </GroupCard>
      )}

      {groups.includes('cutoff') && (
        <GroupCard title="Cancellation cut-off" hint="Customers can't cancel a paid booking inside this time before the start. Venue staff still can." override={override('cutoff')} error={errors.cutoff}>
          <div className="max-w-xs">
            <Unit unit="minutes">
              <Input type="number" min={0} value={draft.cancelCutoffMinutes} onChange={(e) => patch({ cancelCutoffMinutes: e.target.value })} className="pr-16" aria-label="Cancellation cut-off in minutes" />
            </Unit>
          </div>
        </GroupCard>
      )}

      {groups.includes('payout') && (
        <GroupCard title="Owner payouts" hint="Owners are paid once a week for the slots played before this day. Applies to every facility." error={errors.payout}>
          <div className="grid max-w-lg gap-3 sm:grid-cols-2">
            <div>
              <Label>Payout day</Label>
              <Select value={draft.payoutWeekday} onChange={(e) => patch({ payoutWeekday: e.target.value })} aria-label="Payout day">
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={draft.payoutTimezone} onChange={(e) => patch({ payoutTimezone: e.target.value })} aria-label="Payout timezone" />
            </div>
          </div>
        </GroupCard>
      )}

      {apiError && <ErrorBanner message={apiError} />}
      {saved && <SuccessBanner message="Saved. New bookings use these terms; existing bookings keep the terms they were made under." />}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={submit} loading={saving}>
          Save terms
        </Button>
        {mode === 'override' && onRemove && own && (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              setSaving(true);
              setApiError(null);
              try {
                await onRemove();
              } catch (err) {
                setApiError(err instanceof ApiError ? err.message : 'Could not remove');
              } finally {
                setSaving(false);
              }
            }}
          >
            Remove this venue's deal
          </Button>
        )}
      </div>
    </div>
  );
}
