'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, Select, SuccessBanner, invalidClass } from '@/components/ui';
import { hasErrors, numberError, uuidError, type FieldErrors } from '@/lib/validation';

interface Tier {
  minHoursBeforeStart: string;
  refundPercent: string;
}

function CancellationPolicyForm() {
  const [scope, setScope] = useState<'PLATFORM_DEFAULT' | 'VENUE'>('PLATFORM_DEFAULT');
  const [tiers, setTiers] = useState<Tier[]>([{ minHoursBeforeStart: '24', refundPercent: '100' }]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tierErrors, setTierErrors] = useState<FieldErrors<string>>({});

  function updateTier(i: number, key: keyof Tier, value: string) {
    setTierErrors((p) => ({ ...p, [`${i}-${key}`]: undefined }));
    setTiers((t) => t.map((tier, idx) => (idx === i ? { ...tier, [key]: value } : tier)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const found: FieldErrors<string> = {};
    tiers.forEach((t, i) => {
      found[`${i}-minHoursBeforeStart`] = numberError(t.minHoursBeforeStart, 'Hours before start', 0, 8760);
      found[`${i}-refundPercent`] = numberError(t.refundPercent, 'Refund %', 0, 100);
    });
    setTierErrors(found);
    if (hasErrors(found)) {
      const first = Object.keys(found).find((k) => found[k]);
      document.getElementById('tier-' + first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/cancellation-policies', {
        scope,
        tiers: tiers.map((t) => ({
          minHoursBeforeStart: Number(t.minHoursBeforeStart),
          refundPercent: Number(t.refundPercent),
        })),
      });
      setSuccess('Cancellation policy created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create policy');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-gray-900">New Cancellation Policy</h2>
      <p className="mb-4 text-xs text-gray-500">
        A VENUE-scoped policy overrides the platform default for that venue (assignment happens when the
        venue is configured). Refund tiers apply by hours-before-start, most specific first.
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        {error && <ErrorBanner message={error} />}
        {success && <SuccessBanner message={success} />}
        <div>
          <Label>Scope</Label>
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'PLATFORM_DEFAULT' | 'VENUE')}>
            <option value="PLATFORM_DEFAULT">PLATFORM_DEFAULT</option>
            <option value="VENUE">VENUE</option>
          </Select>
        </div>
        <div>
          <Label>Refund Tiers</Label>
          <div className="space-y-2">
            {tiers.map((tier, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    id={`tier-${i}-minHoursBeforeStart`}
                    type="number"
                    placeholder="Min hours before start"
                    aria-label={`Tier ${i + 1} minimum hours before start`}
                    aria-invalid={!!tierErrors[`${i}-minHoursBeforeStart`]}
                    className={tierErrors[`${i}-minHoursBeforeStart`] ? invalidClass : ''}
                    value={tier.minHoursBeforeStart}
                    onChange={(e) => updateTier(i, 'minHoursBeforeStart', e.target.value)}
                  />
                  <FieldError id={`tier-${i}-minHoursBeforeStart-error`} message={tierErrors[`${i}-minHoursBeforeStart`]} />
                </div>
                <div className="flex-1">
                  <Input
                    id={`tier-${i}-refundPercent`}
                    type="number"
                    placeholder="Refund %"
                    aria-label={`Tier ${i + 1} refund percent`}
                    aria-invalid={!!tierErrors[`${i}-refundPercent`]}
                    className={tierErrors[`${i}-refundPercent`] ? invalidClass : ''}
                    value={tier.refundPercent}
                    onChange={(e) => updateTier(i, 'refundPercent', e.target.value)}
                  />
                  <FieldError id={`tier-${i}-refundPercent-error`} message={tierErrors[`${i}-refundPercent`]} />
                </div>
                {tiers.length > 1 && (
                  <Button type="button" variant="secondary" onClick={() => setTiers((t) => t.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-gray-700 hover:underline"
            onClick={() => setTiers((t) => [...t, { minHoursBeforeStart: '', refundPercent: '' }])}
          >
            + Add tier
          </button>
        </div>
        <Button type="submit" loading={submitting}>
          {submitting ? 'Creating…' : 'Create Policy'}
        </Button>
      </form>
    </Card>
  );
}

function CommissionForm() {
  const [scope, setScope] = useState<'PLATFORM_DEFAULT' | 'ORGANIZATION'>('PLATFORM_DEFAULT');
  const [organizationId, setOrganizationId] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'organizationId' | 'value'>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const found: FieldErrors<'organizationId' | 'value'> = {
      organizationId: scope === 'ORGANIZATION' ? uuidError(organizationId, 'Organization ID') : undefined,
      value: numberError(value, 'Value', 0, type === 'PERCENTAGE' ? 100 : 1_000_000),
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.organizationId ? 'commission-organizationId' : 'commission-value')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/commissions', {
        scope,
        organizationId: scope === 'ORGANIZATION' ? organizationId.trim() : undefined,
        type,
        value: Number(value),
      });
      setSuccess('Commission rule created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create commission');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-gray-900">New Commission Rule</h2>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        {error && <ErrorBanner message={error} />}
        {success && <SuccessBanner message={success} />}
        <div>
          <Label>Scope</Label>
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'PLATFORM_DEFAULT' | 'ORGANIZATION')}>
            <option value="PLATFORM_DEFAULT">PLATFORM_DEFAULT</option>
            <option value="ORGANIZATION">ORGANIZATION</option>
          </Select>
        </div>
        {scope === 'ORGANIZATION' && (
          <div>
            <Label htmlFor="commission-organizationId">Organization ID</Label>
            <Input
              id="commission-organizationId"
              value={organizationId}
              aria-invalid={!!errors.organizationId}
              className={errors.organizationId ? invalidClass : ''}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setErrors((p) => ({ ...p, organizationId: undefined }));
              }}
            />
            <FieldError id="commission-organizationId-error" message={errors.organizationId} />
          </div>
        )}
        <div>
          <Label>Type</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FLAT')}>
            <option value="PERCENTAGE">PERCENTAGE</option>
            <option value="FLAT">FLAT</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="commission-value">{type === 'PERCENTAGE' ? 'Value (%)' : 'Value (INR)'}</Label>
          <Input
            id="commission-value"
            type="number"
            step="0.01"
            value={value}
            aria-invalid={!!errors.value}
            className={errors.value ? invalidClass : ''}
            onChange={(e) => {
              setValue(e.target.value);
              setErrors((p) => ({ ...p, value: undefined }));
            }}
          />
          <FieldError id="commission-value-error" message={errors.value} />
        </div>
        <Button type="submit" loading={submitting}>
          {submitting ? 'Creating…' : 'Create Commission'}
        </Button>
      </form>
    </Card>
  );
}

export default function PoliciesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Policies & Commissions" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CancellationPolicyForm />
        <CommissionForm />
      </div>
    </div>
  );
}
