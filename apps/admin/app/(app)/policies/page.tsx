'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, Input, Label, PageHeader, Select, SuccessBanner } from '@/components/ui';

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

  function updateTier(i: number, key: keyof Tier, value: string) {
    setTiers((t) => t.map((tier, idx) => (idx === i ? { ...tier, [key]: value } : tier)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
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
      <form onSubmit={onSubmit} className="space-y-3">
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
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Min hours before start"
                  value={tier.minHoursBeforeStart}
                  onChange={(e) => updateTier(i, 'minHoursBeforeStart', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Refund %"
                  value={tier.refundPercent}
                  onChange={(e) => updateTier(i, 'refundPercent', e.target.value)}
                />
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post('/admin/commissions', {
        scope,
        organizationId: scope === 'ORGANIZATION' ? organizationId : undefined,
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
      <form onSubmit={onSubmit} className="space-y-3">
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
            <Label>Organization ID</Label>
            <Input required value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
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
          <Label>Value</Label>
          <Input required type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
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
