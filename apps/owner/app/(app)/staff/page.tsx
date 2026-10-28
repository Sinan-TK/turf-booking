'use client';

import { useState } from 'react';
import { useListFilters } from '@/lib/use-list-filters';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Modal } from '@/components/modal';
import { DataTable, FilterSelect, ListToolbar, Pagination, ROW, SearchBox } from '@/components/list-kit';
import {
  Badge,
  Button,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  PageHeader,
  SuccessBanner,
  invalidClass,
} from '@/components/ui';
import { emailError, hasErrors, indianPhoneError, textError, type FieldErrors } from '@/lib/validation';
import { PhoneInput } from '@/components/phone-input';
import { AccessCard } from '@/components/access-card';

interface Staff {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  venues: Array<{ id: string; name: string }>;
}

interface VenueOption {
  id: string;
  name: string;
}

/** Venue checkboxes, with the message under them when none is ticked. */
function VenuePicker({
  venues,
  value,
  onChange,
  error,
}: {
  venues: VenueOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset aria-describedby={error ? 'staff-venues-error' : undefined} aria-invalid={!!error}>
      <legend className="mb-1 block font-label-md text-label-md text-on-surface-variant">Venues they work in</legend>
      <div
        className={`max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2 ${
          error ? 'border-error' : 'border-outline-variant/40'
        }`}
      >
        {venues.map((v) => (
          <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-container">
            <input type="checkbox" checked={value.includes(v.id)} onChange={() => toggle(v.id)} />
            <span className="text-body-md text-on-surface">{v.name}</span>
          </label>
        ))}
        {venues.length === 0 && <p className="px-2 py-1.5 text-sm text-on-surface-variant">Add a venue first.</p>}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <FieldError id="staff-venues-error" message={error} />
        <span className="ml-auto flex gap-3 text-xs">
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => onChange(venues.map((v) => v.id))}>
            All
          </button>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => onChange([])}>
            None
          </button>
        </span>
      </div>
    </fieldset>
  );
}

const noVenue = 'Choose at least one venue.';

function InviteModal({ venues, onClose, onDone }: { venues: VenueOption[]; onClose: () => void; onDone: (email: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [venueIds, setVenueIds] = useState<string[]>(venues.length === 1 ? [venues[0]!.id] : []);
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email' | 'phone' | 'venues'>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: 'name' | 'email' | 'phone', v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const phone = form.phone.trim();
    const found: FieldErrors<'name' | 'email' | 'phone' | 'venues'> = {
      name: textError(form.name, 'Name', 1, 150),
      email: emailError(form.email),
      phone: phone ? indianPhoneError(phone) : undefined,
      venues: venueIds.length === 0 ? noVenue : undefined,
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['name', 'email', 'phone'] as const).find((k) => found[k]);
      if (first) document.getElementById(`staff-${first}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await api.post('/owner/staff', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: phone || undefined,
        venueIds,
      });
      onDone(form.email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not invite this person');
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Invite staff"
      subtitle="They get an email to set a password, and can only work in the venues you choose."
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-6">
          {error && <ErrorBanner message={error} />}
          <div>
            <Label htmlFor="staff-name">Name</Label>
            <Input
              id="staff-name"
              value={form.name}
              aria-invalid={!!errors.name}
              className={errors.name ? invalidClass : ''}
              onChange={(e) => set('name', e.target.value)}
            />
            <FieldError id="staff-name-error" message={errors.name} />
          </div>
          <div>
            <Label htmlFor="staff-email">Email</Label>
            <Input
              id="staff-email"
              type="email"
              autoComplete="off"
              value={form.email}
              aria-invalid={!!errors.email}
              className={errors.email ? invalidClass : ''}
              onChange={(e) => set('email', e.target.value)}
            />
            <FieldError id="staff-email-error" message={errors.email} />
          </div>
          <div>
            <Label htmlFor="staff-phone">Phone (optional)</Label>
            <PhoneInput
              id="staff-phone"
              value={form.phone}
              invalid={!!errors.phone}
              onValueChange={(digits) => set('phone', digits)}
            />
            <FieldError id="staff-phone-error" message={errors.phone} />
          </div>
          <VenuePicker
            venues={venues}
            value={venueIds}
            error={errors.venues}
            onChange={(ids) => {
              setVenueIds(ids);
              setErrors((p) => ({ ...p, venues: undefined }));
            }}
          />
        </div>
        <footer className="flex justify-end gap-2 border-t border-outline-variant/20 bg-surface-container-low px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Inviting…' : 'Send invite'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function VenuesModal({
  staff,
  venues,
  onClose,
  onDone,
}: {
  staff: Staff;
  venues: VenueOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [venueIds, setVenueIds] = useState(staff.venues.map((v) => v.id));
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (venueIds.length === 0) {
      setErrorMsg(noVenue);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/owner/staff/${staff.id}/venues`, { venueIds });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Venues for ${staff.name}`} subtitle="The change applies the next time they open a page." onClose={onClose} busy={saving}>
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-6">
          {error && <ErrorBanner message={error} />}
          <VenuePicker
            venues={venues}
            value={venueIds}
            error={errorMsg}
            onChange={(ids) => {
              setVenueIds(ids);
              setErrorMsg(undefined);
            }}
          />
        </div>
        <footer className="flex justify-end gap-2 border-t border-outline-variant/20 bg-surface-container-low px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save venues'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

const MAX_VENUE_CHIPS = 3;

/** "Asha Menon" -> "AM". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
}

export default function StaffPage() {
  const { user } = useAuth();
  const f = useListFilters({ search: '', status: '' });
  const { rows: staff, total, error, loading, refetch } = usePagedFetch<Staff>('/owner/staff', f.query, f.page);
  const venues: VenueOption[] = user?.venues ?? [];

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [toggling, setToggling] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    setToggleError(null);
    try {
      await api.patch(`/owner/staff/${toggling.id}/status`, {
        status: toggling.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      });
      setToggling(null);
      refetch();
    } catch (err) {
      setToggleError(err instanceof ApiError ? err.message : 'Could not change this login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="People who take bookings at your venues. Each one can only work in the venues you assign."
        action={<Button onClick={() => setInviting(true)}>Invite staff</Button>}
      />
      {notice && (
        <div className="mb-4">
          <SuccessBanner message={notice} />
        </div>
      )}
      {!f.active && <div className="mb-6"><AccessCard audience="owner" /></div>}
      <ListToolbar
        active={f.active}
        total={total}
        noun="staff member"
        onClear={f.clear}
        search={
          <SearchBox
            label="Search staff"
            placeholder="Search name or email…"
            value={f.values.search}
            onChange={(v) => f.set('search', v)}
          />
        }
      >
        <FilterSelect
          label="Status"
          value={f.values.status}
          options={[
            { value: '', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'DISABLED', label: 'Disabled' },
          ]}
          onChange={(v) => f.set('status', v)}
        />
      </ListToolbar>
      {error && <ErrorBanner message={error} />}
      {!error && (
        <DataTable
          columns={['Staff member', 'Works in', 'Sign-in', { label: '', className: 'w-56' }]}
          loading={loading}
          rowCount={staff.length}
          empty={f.active ? 'No staff match your search or filters.' : 'No staff yet. Invite someone to let them take bookings at a venue.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {staff.map((s) => (
            <tr key={s.id} className={ROW}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      s.status === 'ACTIVE' ? 'bg-primary/10 text-primary' : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {initials(s.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-on-surface">{s.name}</p>
                    <p className="truncate text-xs text-on-surface-variant">{s.email}</p>
                    {s.phone && <p className="text-xs text-on-surface-variant">{s.phone}</p>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                {s.venues.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-500/30">
                    No venue yet: can&apos;t take bookings
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.venues.slice(0, MAX_VENUE_CHIPS).map((v) => (
                      <span key={v.id} className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs text-on-surface">
                        {v.name}
                      </span>
                    ))}
                    {s.venues.length > MAX_VENUE_CHIPS && (
                      <span
                        className="text-xs font-medium text-on-surface-variant"
                        title={s.venues.slice(MAX_VENUE_CHIPS).map((v) => v.name).join(', ')}
                      >
                        +{s.venues.length - MAX_VENUE_CHIPS} more
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                {s.status === 'ACTIVE' ? (
                  <span className="inline-flex items-center gap-2 text-sm text-on-surface">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    Active
                  </span>
                ) : (
                  <span className="block text-sm text-on-surface-variant">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-outline" aria-hidden="true" />
                      Disabled
                    </span>
                    <span className="block text-xs">Cannot sign in</span>
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-on-surface ring-1 ring-inset ring-outline-variant/50 transition-colors hover:bg-surface-container-low"
                    onClick={() => setEditing(s)}
                  >
                    Edit venues
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
                      s.status === 'ACTIVE'
                        ? 'text-error ring-error/30 hover:bg-error/5'
                        : 'text-primary ring-primary/30 hover:bg-primary/5'
                    }`}
                    onClick={() => {
                      setToggleError(null);
                      setToggling(s);
                    }}
                  >
                    {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {inviting && (
        <InviteModal
          venues={venues}
          onClose={() => setInviting(false)}
          onDone={(email) => {
            setInviting(false);
            setNotice(`Invite sent to ${email}.`);
            refetch();
          }}
        />
      )}
      {editing && (
        <VenuesModal
          staff={editing}
          venues={venues}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
      {toggling && (
        <ConfirmDialog
          title={toggling.status === 'ACTIVE' ? `Disable ${toggling.name}?` : `Enable ${toggling.name}?`}
          confirmLabel={toggling.status === 'ACTIVE' ? 'Disable' : 'Enable'}
          tone={toggling.status === 'ACTIVE' ? 'danger' : 'primary'}
          busy={busy}
          error={toggleError}
          onConfirm={confirmToggle}
          onCancel={() => setToggling(null)}
        >
          {toggling.status === 'ACTIVE'
            ? 'They are signed out everywhere and cannot sign in until you enable them again.'
            : 'They can sign in again and work in the venues assigned to them.'}
        </ConfirmDialog>
      )}
    </div>
  );
}
