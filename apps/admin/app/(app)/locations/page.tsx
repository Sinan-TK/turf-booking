'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, Select, SkeletonText, invalidClass } from '@/components/ui';
import { hasErrors, textError, type FieldErrors } from '@/lib/validation';
import { Pagination, usePageSlice } from '@/components/pagination';

interface State {
  id: string;
  name: string;
  code: string;
}
interface District {
  id: string;
  name: string;
  code: string;
  timezone: string;
}

export default function LocationsPage() {
  const { data: states, refetch: refetchStates } = useFetch<State[]>('/states');
  const [stateId, setStateId] = useState('');
  const { data: districts, refetch: refetchDistricts } = useFetch<District[]>(
    stateId ? `/districts?stateId=${stateId}` : null,
  );

  const districtPage = usePageSlice(districts ?? [], 10, stateId);

  const [districtForm, setDistrictForm] = useState({ name: '', code: '', timezone: 'Asia/Kolkata' });
  const [districtError, setDistrictError] = useState<string | null>(null);
  const [creatingDistrict, setCreatingDistrict] = useState(false);
  const [districtErrors, setDistrictErrors] = useState<FieldErrors<'name' | 'code'>>({});

  async function onCreateDistrict(e: React.FormEvent) {
    e.preventDefault();
    if (!stateId) return;
    setDistrictError(null);
    const found: FieldErrors<'name' | 'code'> = {
      name: textError(districtForm.name, 'District name', 1, 100),
      code:
        districtForm.code.trim() === ''
          ? 'Enter the district code, like MPM.'
          : districtForm.code.trim().length > 10
            ? 'The code can be at most 10 characters.'
            : undefined,
    };
    setDistrictErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.name ? 'district-name' : 'district-code')?.focus();
      return;
    }
    setCreatingDistrict(true);
    try {
      await api.post('/admin/districts', { stateId, ...districtForm });
      setDistrictForm({ name: '', code: '', timezone: 'Asia/Kolkata' });
      setDistrictErrors({});
      refetchDistricts();
    } catch (err) {
      setDistrictError(err instanceof ApiError ? err.message : 'Failed to create district');
    } finally {
      setCreatingDistrict(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" />

      <Card>
        <Label>State</Label>
        <Select value={stateId} onChange={(e) => setStateId(e.target.value)} className="max-w-xs">
          <option value="">Select state…</option>
          {states?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="mt-2 block text-xs text-gray-500 hover:underline"
          onClick={refetchStates}
        >
          Refresh states
        </button>
      </Card>

      {stateId && (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Districts</h2>
          {!districts && (
            <div className="mb-6 space-y-2">
              <SkeletonText className="h-8 w-full" />
              <SkeletonText className="h-8 w-full" />
              <SkeletonText className="h-8 w-full" />
            </div>
          )}
          {districts && districts.length > 0 && (
            <div className="mb-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2">Name</th>
                    <th className="py-2">Code</th>
                    <th className="py-2">Timezone</th>
                  </tr>
                </thead>
                <tbody>
                  {districtPage.rows.map((d) => (
                    <tr key={d.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 font-medium">{d.name}</td>
                      <td className="py-2 font-mono text-xs">{d.code}</td>
                      <td className="py-2 text-gray-600">{d.timezone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={districtPage.page} pageSize={10} total={districtPage.total} onPage={districtPage.setPage} />
            </div>
          )}

          <form onSubmit={onCreateDistrict} noValidate className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
            {districtError && (
              <div className="col-span-3">
                <ErrorBanner message={districtError} />
              </div>
            )}
            <div>
              <Label htmlFor="district-name">District Name</Label>
              <Input
                id="district-name"
                aria-invalid={!!districtErrors.name}
                className={districtErrors.name ? invalidClass : ''}
                value={districtForm.name}
                onChange={(e) => {
                  setDistrictForm((f) => ({ ...f, name: e.target.value }));
                  setDistrictErrors((p) => ({ ...p, name: undefined }));
                }}
              />
              <FieldError id="district-name-error" message={districtErrors.name} />
            </div>
            <div>
              <Label htmlFor="district-code">District Code (e.g. MPM)</Label>
              <Input
                id="district-code"
                aria-invalid={!!districtErrors.code}
                className={districtErrors.code ? invalidClass : ''}
                value={districtForm.code}
                onChange={(e) => {
                  setDistrictForm((f) => ({ ...f, code: e.target.value.toUpperCase() }));
                  setDistrictErrors((p) => ({ ...p, code: undefined }));
                }}
              />
              <FieldError id="district-code-error" message={districtErrors.code} />
            </div>
            <Button type="submit" loading={creatingDistrict}>
              {creatingDistrict ? 'Adding…' : 'Add District'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
