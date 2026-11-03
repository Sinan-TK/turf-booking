'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { optimistic, type Mutate } from '@/lib/optimistic';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBanner, FieldError, Input, Label, PageHeader, Select, SkeletonText, invalidClass } from '@/components/ui';
import { Modal } from '@/components/modal';
import { hasErrors, numberError, textError, type FieldErrors } from '@/lib/validation';
import { Pagination, usePageSlice } from '@/components/pagination';

type Status = 'ACTIVE' | 'INACTIVE';
interface Country {
  id: string;
  name: string;
}
interface State {
  id: string;
  name: string;
  code: string;
  status: Status;
}
interface District {
  id: string;
  name: string;
  code: string;
  timezone: string;
  status: Status;
}
interface Area {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  status: Status;
}

const PAGE = 10;

/** "Deactivate" / "Activate" in a row: the row changes at once, then the list is read again; if the server refuses, the row goes back with a message. */
function useSwitch<T extends { id: string; status: Status }>(path: string, mutate: Mutate<T[]>, refetch: () => void, onError: (m: string) => void) {
  return {
    busy: null as string | null,
    async toggle(id: string, status: Status) {
      const next: Status = status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await optimistic(mutate, (all) => all.map((x) => (x.id === id ? { ...x, status: next } : x)), () => api.patch(`${path}/${id}`, { status: next }), onError);
      refetch();
    },
  };
}

function RowActions({ status, busy, onEdit, onToggle, what }: { status: Status; busy: boolean; onEdit: () => void; onToggle: () => void; what: string }) {
  return (
    <div className="flex justify-end gap-3 text-xs font-medium">
      <button type="button" onClick={onEdit} aria-label={`Edit ${what}`} className="text-brand-700 hover:underline">
        Edit
      </button>
      <button type="button" onClick={onToggle} disabled={busy} aria-label={`${status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${what}`} className="text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50">
        {status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      </button>
    </div>
  );
}

/** A small dialog for changing a name (and, for a district, its timezone; for an area, its centre). Saves with one PATCH. */
function EditDialog({
  title,
  path,
  initial,
  with: extra,
  onClose,
  onSaved,
}: {
  title: string;
  path: string;
  initial: { name: string; timezone?: string; lat?: number | null; lng?: number | null };
  with: 'name' | 'timezone' | 'centre';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [timezone, setTimezone] = useState(initial.timezone ?? '');
  const [lat, setLat] = useState(initial.lat == null ? '' : String(initial.lat));
  const [lng, setLng] = useState(initial.lng == null ? '' : String(initial.lng));
  const [errors, setErrors] = useState<FieldErrors<'name' | 'timezone' | 'lat' | 'lng'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found: FieldErrors<'name' | 'timezone' | 'lat' | 'lng'> = { name: textError(name, 'Name', 1, 100) };
    if (extra === 'timezone' && timezone.trim() === '') found.timezone = 'Enter the timezone, like Asia/Kolkata.';
    const hasCentre = lat.trim() !== '' || lng.trim() !== '';
    if (extra === 'centre' && hasCentre) {
      found.lat = numberError(lat, 'Latitude', -90, 90);
      found.lng = numberError(lng, 'Longitude', -180, 180);
    }
    setErrors(found);
    if (hasErrors(found)) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(path, {
        name: name.trim(),
        ...(extra === 'timezone' ? { timezone: timezone.trim() } : {}),
        ...(extra === 'centre' ? (hasCentre ? { lat: Number(lat), lng: Number(lng) } : { lat: null, lng: null }) : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate className="flex flex-col gap-4 px-6 py-5">
        {error && <ErrorBanner message={error} />}
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} className={errors.name ? invalidClass : ''} />
          <FieldError id="edit-name-error" message={errors.name} />
        </div>
        {extra === 'timezone' && (
          <div>
            <Label htmlFor="edit-timezone">Timezone</Label>
            <Input id="edit-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-invalid={!!errors.timezone} className={errors.timezone ? invalidClass : ''} />
            <FieldError id="edit-timezone-error" message={errors.timezone} />
          </div>
        )}
        {extra === 'centre' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-lat">Latitude</Label>
              <Input id="edit-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-invalid={!!errors.lat} className={errors.lat ? invalidClass : ''} />
              <FieldError id="edit-lat-error" message={errors.lat} />
            </div>
            <div>
              <Label htmlFor="edit-lng">Longitude</Label>
              <Input id="edit-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} aria-invalid={!!errors.lng} className={errors.lng ? invalidClass : ''} />
              <FieldError id="edit-lng-error" message={errors.lng} />
            </div>
            <p className="col-span-2 text-xs text-gray-500">The town&apos;s centre lets customers search near it. Leave both empty to clear it.</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const th = 'py-2';

export default function LocationsPage() {
  const { data: countries } = useFetch<Country[]>('/countries');
  const { data: states, loading: statesLoading, refetch: refetchStates, mutate: mutateStates } = useFetch<State[]>('/admin/states');
  const [stateId, setStateId] = useState('');
  const { data: districts, refetch: refetchDistricts, mutate: mutateDistricts } = useFetch<District[]>(stateId ? `/admin/districts?stateId=${stateId}` : null);
  const [districtId, setDistrictId] = useState('');
  const { data: areas, refetch: refetchAreas, mutate: mutateAreas } = useFetch<Area[]>(districtId ? `/admin/areas?districtId=${districtId}` : null);

  const [pageError, setPageError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ title: string; path: string; initial: { name: string; timezone?: string; lat?: number | null; lng?: number | null }; with: 'name' | 'timezone' | 'centre'; done: () => void } | null>(null);

  const stateSwitch = useSwitch<State>('/admin/states', mutateStates, refetchStates, setPageError);
  const districtSwitch = useSwitch<District>('/admin/districts', mutateDistricts, refetchDistricts, setPageError);
  const areaSwitch = useSwitch<Area>('/admin/areas', mutateAreas, refetchAreas, setPageError);

  const statePage = usePageSlice(states ?? [], PAGE, 'states');
  const districtPage = usePageSlice(districts ?? [], PAGE, stateId);
  const areaPage = usePageSlice(areas ?? [], PAGE, districtId);

  // ---- add forms ----
  const [stateForm, setStateForm] = useState({ name: '', code: '', countryId: '' });
  const [stateErrors, setStateErrors] = useState<FieldErrors<'name' | 'code'>>({});
  const [stateError, setStateError] = useState<string | null>(null);
  const [addingState, setAddingState] = useState(false);

  const [districtForm, setDistrictForm] = useState({ name: '', code: '', timezone: 'Asia/Kolkata' });
  const [districtErrors, setDistrictErrors] = useState<FieldErrors<'name' | 'code' | 'timezone'>>({});
  const [districtError, setDistrictError] = useState<string | null>(null);
  const [addingDistrict, setAddingDistrict] = useState(false);

  const [areaForm, setAreaForm] = useState({ name: '', lat: '', lng: '' });
  const [areaErrors, setAreaErrors] = useState<FieldErrors<'name' | 'lat' | 'lng'>>({});
  const [areaError, setAreaError] = useState<string | null>(null);
  const [addingArea, setAddingArea] = useState(false);

  const codeError = (code: string, what: string) => (code.trim() === '' ? `Enter the ${what} code, like KL.` : code.trim().length > 10 ? 'The code can be at most 10 characters.' : undefined);

  async function addState(e: React.FormEvent) {
    e.preventDefault();
    setStateError(null);
    const found = { name: textError(stateForm.name, 'State name', 1, 100), code: codeError(stateForm.code, 'state') };
    setStateErrors(found);
    if (hasErrors(found)) return;
    const countryId = stateForm.countryId || countries?.[0]?.id;
    if (!countryId) return setStateError('No country is set up yet.');
    setAddingState(true);
    try {
      const created = await api.post<State>('/admin/states', { countryId, name: stateForm.name.trim(), code: stateForm.code.trim() });
      setStateForm((f) => ({ ...f, name: '', code: '' }));
      refetchStates();
      setStateId(created.id);
      setDistrictId('');
    } catch (err) {
      setStateError(err instanceof ApiError ? err.message : 'Could not add the state.');
    } finally {
      setAddingState(false);
    }
  }

  async function addDistrict(e: React.FormEvent) {
    e.preventDefault();
    if (!stateId) return;
    setDistrictError(null);
    const found = {
      name: textError(districtForm.name, 'District name', 1, 100),
      code: codeError(districtForm.code, 'district'),
      timezone: districtForm.timezone.trim() === '' ? 'Enter the timezone, like Asia/Kolkata.' : undefined,
    };
    setDistrictErrors(found);
    if (hasErrors(found)) return;
    setAddingDistrict(true);
    try {
      const created = await api.post<District>('/admin/districts', { stateId, name: districtForm.name.trim(), code: districtForm.code.trim(), timezone: districtForm.timezone.trim() });
      setDistrictForm((f) => ({ ...f, name: '', code: '' }));
      refetchDistricts();
      setDistrictId(created.id);
    } catch (err) {
      setDistrictError(err instanceof ApiError ? err.message : 'Could not add the district.');
    } finally {
      setAddingDistrict(false);
    }
  }

  async function addArea(e: React.FormEvent) {
    e.preventDefault();
    if (!districtId) return;
    setAreaError(null);
    const hasCentre = areaForm.lat.trim() !== '' || areaForm.lng.trim() !== '';
    const found: FieldErrors<'name' | 'lat' | 'lng'> = { name: textError(areaForm.name, 'Area name', 1, 100) };
    if (hasCentre) {
      found.lat = numberError(areaForm.lat, 'Latitude', -90, 90);
      found.lng = numberError(areaForm.lng, 'Longitude', -180, 180);
    }
    setAreaErrors(found);
    if (hasErrors(found)) return;
    setAddingArea(true);
    try {
      await api.post('/admin/areas', { districtId, name: areaForm.name.trim(), ...(hasCentre ? { lat: Number(areaForm.lat), lng: Number(areaForm.lng) } : {}) });
      setAreaForm({ name: '', lat: '', lng: '' });
      refetchAreas();
    } catch (err) {
      setAreaError(err instanceof ApiError ? err.message : 'Could not add the area.');
    } finally {
      setAddingArea(false);
    }
  }

  const selectedState = states?.find((s) => s.id === stateId);
  const selectedDistrict = districts?.find((d) => d.id === districtId);
  const head = 'border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500';

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" subtitle="States, their districts and the areas (towns) customers can search from. The codes become part of each venue's facility code, so they cannot be changed." />
      {pageError && <ErrorBanner message={pageError} />}

      {/* ---------------------------------------------------------------- States */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">States</h2>
        {statesLoading && (
          <div className="mb-6 space-y-2">
            <SkeletonText className="h-8 w-full" />
            <SkeletonText className="h-8 w-full" />
          </div>
        )}
        {states && states.length === 0 && <EmptyState message="No states yet. Add the first one below." />}
        {states && states.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={head}>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Code</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {statePage.rows.map((s) => (
                  <tr key={s.id} className={`border-b border-gray-100 last:border-0 ${s.id === stateId ? 'bg-brand-50/50' : ''}`}>
                    <td className="py-2 font-medium">
                      <button type="button" onClick={() => { setStateId(s.id); setDistrictId(''); }} className="text-left hover:underline" aria-label={`Open ${s.name}`}>
                        {s.name}
                      </button>
                    </td>
                    <td className="py-2 font-mono text-xs">{s.code}</td>
                    <td className="py-2"><Badge value={s.status} /></td>
                    <td className="py-2">
                      <RowActions
                        what={`state ${s.name}`}
                        status={s.status}
                        busy={stateSwitch.busy === s.id}
                        onToggle={() => stateSwitch.toggle(s.id, s.status)}
                        onEdit={() => setEditing({ title: `Edit ${s.name}`, path: `/admin/states/${s.id}`, initial: { name: s.name }, with: 'name', done: refetchStates })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={statePage.page} pageSize={PAGE} total={statePage.total} onPage={statePage.setPage} />
          </div>
        )}

        <form onSubmit={addState} noValidate className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4" aria-label="Add a state">
          {stateError && <div className="sm:col-span-4"><ErrorBanner message={stateError} /></div>}
          <div>
            <Label htmlFor="state-name">State name</Label>
            <Input id="state-name" value={stateForm.name} aria-invalid={!!stateErrors.name} className={stateErrors.name ? invalidClass : ''}
              onChange={(e) => { setStateForm((f) => ({ ...f, name: e.target.value })); setStateErrors((p) => ({ ...p, name: undefined })); }} />
            <FieldError id="state-name-error" message={stateErrors.name} />
          </div>
          <div>
            <Label htmlFor="state-code">State code (e.g. TN)</Label>
            <Input id="state-code" value={stateForm.code} aria-invalid={!!stateErrors.code} className={stateErrors.code ? invalidClass : ''}
              onChange={(e) => { setStateForm((f) => ({ ...f, code: e.target.value.toUpperCase() })); setStateErrors((p) => ({ ...p, code: undefined })); }} />
            <FieldError id="state-code-error" message={stateErrors.code} />
          </div>
          {countries && countries.length > 1 && (
            <div>
              <Label htmlFor="state-country">Country</Label>
              <Select id="state-country" value={stateForm.countryId || countries[0]!.id} onChange={(e) => setStateForm((f) => ({ ...f, countryId: e.target.value }))}>
                {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          )}
          <div className="flex items-end">
            <Button type="submit" loading={addingState}>{addingState ? 'Adding…' : 'Add state'}</Button>
          </div>
        </form>
      </Card>

      {/* ------------------------------------------------------------- Districts */}
      {selectedState && (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Districts in {selectedState.name}</h2>
          {!districts && <SkeletonText className="mb-6 h-8 w-full" />}
          {districts && districts.length === 0 && <EmptyState message={`No districts in ${selectedState.name} yet.`} />}
          {districts && districts.length > 0 && (
            <div className="mb-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={head}>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Code</th>
                    <th className={th}>Timezone</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {districtPage.rows.map((d) => (
                    <tr key={d.id} className={`border-b border-gray-100 last:border-0 ${d.id === districtId ? 'bg-brand-50/50' : ''}`}>
                      <td className="py-2 font-medium">
                        <button type="button" onClick={() => setDistrictId(d.id)} className="text-left hover:underline" aria-label={`Open ${d.name}`}>
                          {d.name}
                        </button>
                      </td>
                      <td className="py-2 font-mono text-xs">{d.code}</td>
                      <td className="py-2 text-gray-600">{d.timezone}</td>
                      <td className="py-2"><Badge value={d.status} /></td>
                      <td className="py-2">
                        <RowActions
                          what={`district ${d.name}`}
                          status={d.status}
                          busy={districtSwitch.busy === d.id}
                          onToggle={() => districtSwitch.toggle(d.id, d.status)}
                          onEdit={() => setEditing({ title: `Edit ${d.name}`, path: `/admin/districts/${d.id}`, initial: { name: d.name, timezone: d.timezone }, with: 'timezone', done: refetchDistricts })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={districtPage.page} pageSize={PAGE} total={districtPage.total} onPage={districtPage.setPage} />
            </div>
          )}

          <form onSubmit={addDistrict} noValidate className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4" aria-label="Add a district">
            {districtError && <div className="sm:col-span-4"><ErrorBanner message={districtError} /></div>}
            <div>
              <Label htmlFor="district-name">District name</Label>
              <Input id="district-name" value={districtForm.name} aria-invalid={!!districtErrors.name} className={districtErrors.name ? invalidClass : ''}
                onChange={(e) => { setDistrictForm((f) => ({ ...f, name: e.target.value })); setDistrictErrors((p) => ({ ...p, name: undefined })); }} />
              <FieldError id="district-name-error" message={districtErrors.name} />
            </div>
            <div>
              <Label htmlFor="district-code">District code (e.g. MPM)</Label>
              <Input id="district-code" value={districtForm.code} aria-invalid={!!districtErrors.code} className={districtErrors.code ? invalidClass : ''}
                onChange={(e) => { setDistrictForm((f) => ({ ...f, code: e.target.value.toUpperCase() })); setDistrictErrors((p) => ({ ...p, code: undefined })); }} />
              <FieldError id="district-code-error" message={districtErrors.code} />
            </div>
            <div>
              <Label htmlFor="district-timezone">Timezone</Label>
              <Input id="district-timezone" value={districtForm.timezone} aria-invalid={!!districtErrors.timezone} className={districtErrors.timezone ? invalidClass : ''}
                onChange={(e) => { setDistrictForm((f) => ({ ...f, timezone: e.target.value })); setDistrictErrors((p) => ({ ...p, timezone: undefined })); }} />
              <FieldError id="district-timezone-error" message={districtErrors.timezone} />
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={addingDistrict}>{addingDistrict ? 'Adding…' : 'Add district'}</Button>
            </div>
          </form>
        </Card>
      )}

      {/* ----------------------------------------------------------------- Areas */}
      {selectedDistrict && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Areas in {selectedDistrict.name}</h2>
          <p className="mb-4 text-xs text-gray-500">
            Customers pick one of these as &quot;Area, {selectedDistrict.name}, {selectedState?.name}&quot;. Add the town&apos;s centre (latitude and longitude) so venues can be searched near it.
          </p>
          {!areas && <SkeletonText className="mb-6 h-8 w-full" />}
          {areas && areas.length === 0 && <EmptyState message={`No areas in ${selectedDistrict.name} yet.`} />}
          {areas && areas.length > 0 && (
            <div className="mb-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={head}>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Centre</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {areaPage.rows.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 font-medium">{a.name}</td>
                      <td className="py-2 font-mono text-xs text-gray-600">{a.lat === null || a.lng === null ? 'not set' : `${a.lat}, ${a.lng}`}</td>
                      <td className="py-2"><Badge value={a.status} /></td>
                      <td className="py-2">
                        <RowActions
                          what={`area ${a.name}`}
                          status={a.status}
                          busy={areaSwitch.busy === a.id}
                          onToggle={() => areaSwitch.toggle(a.id, a.status)}
                          onEdit={() => setEditing({ title: `Edit ${a.name}`, path: `/admin/areas/${a.id}`, initial: { name: a.name, lat: a.lat, lng: a.lng }, with: 'centre', done: refetchAreas })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={areaPage.page} pageSize={PAGE} total={areaPage.total} onPage={areaPage.setPage} />
            </div>
          )}

          <form onSubmit={addArea} noValidate className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4" aria-label="Add an area">
            {areaError && <div className="sm:col-span-4"><ErrorBanner message={areaError} /></div>}
            <div>
              <Label htmlFor="area-name">Area name</Label>
              <Input id="area-name" value={areaForm.name} aria-invalid={!!areaErrors.name} className={areaErrors.name ? invalidClass : ''}
                onChange={(e) => { setAreaForm((f) => ({ ...f, name: e.target.value })); setAreaErrors((p) => ({ ...p, name: undefined })); }} />
              <FieldError id="area-name-error" message={areaErrors.name} />
            </div>
            <div>
              <Label htmlFor="area-lat">Latitude (optional)</Label>
              <Input id="area-lat" inputMode="decimal" value={areaForm.lat} aria-invalid={!!areaErrors.lat} className={areaErrors.lat ? invalidClass : ''}
                onChange={(e) => { setAreaForm((f) => ({ ...f, lat: e.target.value })); setAreaErrors((p) => ({ ...p, lat: undefined })); }} />
              <FieldError id="area-lat-error" message={areaErrors.lat} />
            </div>
            <div>
              <Label htmlFor="area-lng">Longitude (optional)</Label>
              <Input id="area-lng" inputMode="decimal" value={areaForm.lng} aria-invalid={!!areaErrors.lng} className={areaErrors.lng ? invalidClass : ''}
                onChange={(e) => { setAreaForm((f) => ({ ...f, lng: e.target.value })); setAreaErrors((p) => ({ ...p, lng: undefined })); }} />
              <FieldError id="area-lng-error" message={areaErrors.lng} />
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={addingArea}>{addingArea ? 'Adding…' : 'Add area'}</Button>
            </div>
          </form>
        </Card>
      )}

      {editing && <EditDialog title={editing.title} path={editing.path} initial={editing.initial} with={editing.with} onClose={() => setEditing(null)} onSaved={editing.done} />}
    </div>
  );
}
