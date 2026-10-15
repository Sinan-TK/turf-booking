'use client';

import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { durationLabel, type AdminVenueCategory } from '@/lib/categories';
import { Button, ErrorBanner, Input, Label } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Props {
  /** Present = edit mode (slug is fixed; the booking style locks once venues exist). */
  initial?: AdminVenueCategory;
  onSaved: (category: AdminVenueCategory) => void;
}

const DEFAULT_POLICY = {
  slotIntervalMin: '60',
  minDurationMin: '60',
  maxDurationMin: '180',
  durationIncrementMin: '60',
  bufferBeforeMin: '0',
  bufferAfterMin: '0',
  maxAdvanceDays: '30',
  minLeadMinutes: '0',
};
type PolicyForm = typeof DEFAULT_POLICY;

const PRESETS: Array<{ label: string; hint: string; values: Partial<PolicyForm> }> = [
  { label: 'Hourly', hint: '1–3 h, hourly starts', values: { slotIntervalMin: '60', minDurationMin: '60', maxDurationMin: '180', durationIncrementMin: '60' } },
  { label: 'Half-hourly', hint: '30 min–2 h, every 30 min', values: { slotIntervalMin: '30', minDurationMin: '30', maxDurationMin: '120', durationIncrementMin: '30' } },
  { label: 'Quick sessions', hint: '15–60 min, every 15 min', values: { slotIntervalMin: '15', minDurationMin: '15', maxDurationMin: '60', durationIncrementMin: '15' } },
  { label: 'Half-day', hint: '2–6 h, hourly starts', values: { slotIntervalMin: '60', minDurationMin: '120', maxDurationMin: '360', durationIncrementMin: '60' } },
];

const ICON_CHOICES = [
  'sports_soccer', 'sports_cricket', 'sports_tennis', 'sports_basketball', 'sports_volleyball', 'sports_esports',
  'extension', 'casino', 'pool', 'kayaking', 'sports_martial_arts', 'fitness_center',
  'self_improvement', 'music_note', 'mic', 'photo_camera', 'meeting_room', 'bedroom_parent',
  'celebration', 'category',
];

function policyToForm(p: AdminVenueCategory['policy']): PolicyForm {
  return {
    slotIntervalMin: String(p.slotIntervalMin),
    minDurationMin: String(p.minDurationMin),
    maxDurationMin: String(p.maxDurationMin),
    durationIncrementMin: String(p.durationIncrementMin),
    bufferBeforeMin: String(p.bufferBeforeMin),
    bufferAfterMin: String(p.bufferAfterMin),
    maxAdvanceDays: String(p.maxAdvanceDays),
    minLeadMinutes: String(p.minLeadMinutes),
  };
}

/** Same rules the API enforces, so mistakes show up before saving. */
function validatePolicy(p: PolicyForm): { problem: string | null; durations: number[] } {
  const n = (v: string) => Number(v);
  const [interval, min, max, inc] = [n(p.slotIntervalMin), n(p.minDurationMin), n(p.maxDurationMin), n(p.durationIncrementMin)];
  if (![interval, min, max, inc, n(p.maxAdvanceDays), n(p.minLeadMinutes)].every(Number.isInteger)) {
    return { problem: 'Enter whole numbers.', durations: [] };
  }
  if (interval < 5 || 1440 % interval !== 0) {
    return { problem: 'Start interval must divide a 24-hour day evenly (e.g. 15, 30, 60).', durations: [] };
  }
  if (inc < 5 || min < 5) return { problem: 'Durations must be at least 5 minutes.', durations: [] };
  if (max < min) return { problem: 'Longest booking must be at least the shortest.', durations: [] };
  if (min % inc !== 0) return { problem: 'Shortest booking must be a multiple of the duration step.', durations: [] };
  if ((max - min) % inc !== 0) return { problem: 'Longest booking must be reachable from the shortest in whole steps.', durations: [] };
  if (n(p.maxAdvanceDays) < 1) return { problem: 'Advance booking window must be at least 1 day.', durations: [] };
  const durations: number[] = [];
  for (let d = min; d <= max && durations.length < 48; d += inc) durations.push(d);
  return { problem: null, durations };
}

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200/80 bg-white shadow-card">
      <header className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-gray-500">{children}</p>;
}

/** A number input with a unit suffix. */
function Field({
  label,
  hint,
  unit,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  hint?: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input type="number" min={min} value={value} onChange={(e) => onChange(e.target.value)} className="pr-14" />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400">{unit}</span>
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}

function MaterialIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined leading-none ${className}`} aria-hidden="true">
      {name || 'category'}
    </span>
  );
}

export function CategoryForm({ initial, onSaved }: Props) {
  const editing = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    slug: initial?.slug ?? '',
    defaultAllocationMode: initial?.defaultAllocationMode ?? 'EXCLUSIVE',
    iconKey: initial?.iconKey ?? 'category',
    unitLabel: initial?.unitLabel ?? 'Table',
    venueLabel: initial?.venueLabel ?? '',
    sortOrder: String(initial?.sortOrder ?? 100),
    isActive: initial?.isActive ?? true,
  });
  const [unitTypes, setUnitTypes] = useState<string[]>(initial?.unitTypes ?? []);
  const [unitTypeDraft, setUnitTypeDraft] = useState('');
  const [customRules, setCustomRules] = useState(true);
  const [policy, setPolicy] = useState<PolicyForm>(initial ? policyToForm(initial.policy) : DEFAULT_POLICY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { problem, durations } = useMemo(() => validatePolicy(policy), [policy]);
  const lockedMode = editing && (initial?.venueCount ?? 0) > 0;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setPol = (key: keyof PolicyForm) => (v: string) => setPolicy((p) => ({ ...p, [key]: v }));

  function onNameChange(name: string) {
    setForm((f) => ({
      ...f,
      name,
      slug: editing || slugTouched ? f.slug : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    }));
  }

  function addUnitType() {
    const t = unitTypeDraft.trim();
    if (t && !unitTypes.some((u) => u.toLowerCase() === t.toLowerCase())) setUnitTypes((u) => [...u, t]);
    setUnitTypeDraft('');
  }

  const activePreset = PRESETS.findIndex((p) =>
    (Object.entries(p.values) as Array<[keyof PolicyForm, string]>).every(([k, v]) => policy[k] === v),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (customRules && problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    try {
      const policyPayload = customRules
        ? Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, Number(v)]))
        : undefined;
      const draft = unitTypeDraft.trim();
      const types = draft && !unitTypes.includes(draft) ? [...unitTypes, draft] : unitTypes;
      const body = {
        name: form.name.trim(),
        defaultAllocationMode: form.defaultAllocationMode,
        iconKey: form.iconKey.trim(),
        unitLabel: form.unitLabel.trim(),
        venueLabel: form.venueLabel.trim() || 'Venue',
        unitTypes: types,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        ...(policyPayload ? { policy: policyPayload } : {}),
      };
      const saved = editing
        ? await api.patch<AdminVenueCategory>(`/admin/categories/${initial!.id}`, body)
        : await api.post<AdminVenueCategory>('/admin/categories', { slug: form.slug.trim(), ...body });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save venue type');
    } finally {
      setSubmitting(false);
    }
  }

  const unit = form.unitLabel.trim() || 'unit';
  const interval = Number(policy.slotIntervalMin);
  const sampleStarts = !problem && interval > 0 ? [0, 1, 2].map((i) => i * interval) : [];
  const clock = (mins: number) => {
    const h = 18 + Math.floor(mins / 60);
    const m = mins % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        {error && <ErrorBanner message={error} />}

        <Section step={1} title="Basics" description="How this type appears in the platform.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                required
                maxLength={80}
                placeholder="e.g. Chess"
                value={form.name}
                onChange={(e) => onNameChange(e.target.value)}
              />
              <Hint>Shown to customers and owners.</Hint>
            </div>
            <div>
              <Label>Identifier</Label>
              <Input
                required
                disabled={editing}
                placeholder="CHESS"
                className="font-mono"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set('slug', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
                }}
              />
              <Hint>{editing ? 'Fixed once created.' : 'Auto-filled from the name. Cannot be changed later.'}</Hint>
            </div>
          </div>

          <div>
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {ICON_CHOICES.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  title={icon}
                  aria-label={icon}
                  aria-pressed={form.iconKey === icon}
                  onClick={() => set('iconKey', icon)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                    form.iconKey === icon
                      ? 'border-brand-500 bg-brand-50 text-brand-700 ring-4 ring-brand-500/15'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800'
                  }`}
                >
                  <MaterialIcon name={icon} className="text-[22px]" />
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                required
                maxLength={40}
                placeholder="or type any Material Symbols name"
                className="max-w-xs font-mono text-xs"
                value={form.iconKey}
                onChange={(e) => set('iconKey', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
              <a
                href="https://fonts.google.com/icons"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-700 hover:underline"
              >
                Browse icons
              </a>
            </div>
          </div>
        </Section>

        <Section step={2} title="Wording" description="So the app speaks naturally for this type.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>One bookable unit is a…</Label>
              <Input required maxLength={40} placeholder="Table" value={form.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} />
              <Hint>Table, Court, Pitch, Room…</Hint>
            </div>
            <div>
              <Label>A venue of this type is a…</Label>
              <Input maxLength={60} placeholder="Chess club" value={form.venueLabel} onChange={(e) => set('venueLabel', e.target.value)} />
              <Hint>Chess club, Studio, Turf…</Hint>
            </div>
          </div>

          <div>
            <Label>Sub-types (optional)</Label>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-white p-2 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
              {unitTypes.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pl-2.5 pr-1 text-xs font-medium text-brand-800">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => setUnitTypes((u) => u.filter((x) => x !== t))}
                    className="rounded p-0.5 text-brand-700/70 hover:bg-brand-100 hover:text-brand-900"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={unitTypeDraft}
                onChange={(e) => setUnitTypeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addUnitType();
                  } else if (e.key === 'Backspace' && !unitTypeDraft && unitTypes.length) {
                    setUnitTypes((u) => u.slice(0, -1));
                  }
                }}
                onBlur={addUnitType}
                placeholder={unitTypes.length ? 'Add another…' : 'e.g. Rapid — press Enter'}
                className="min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-gray-400"
              />
            </div>
            <Hint>
              When set, owners must choose one for each {unit.toLowerCase()} and customers can filter by it. Leave empty to let owners type anything.
            </Hint>
          </div>
        </Section>

        <Section step={3} title="Booking style" description="How customers reserve this type.">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Booking style">
            {(
              [
                { value: 'EXCLUSIVE', title: `Pick one ${unit.toLowerCase()}`, text: 'Each unit is booked on its own. Right for tables, courts, rooms and pitches.' },
                { value: 'POOLED', title: 'Pool of identical units', text: 'Customers choose a quantity from a shared stock, like kayaks or bikes.' },
              ] as const
            ).map((o) => {
              const selected = form.defaultAllocationMode === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={lockedMode}
                  onClick={() => set('defaultAllocationMode', o.value)}
                  className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${
                    selected
                      ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10'
                      : 'border-gray-200 bg-white hover:border-gray-300 disabled:hover:border-gray-200'
                  } ${lockedMode && !selected ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">{o.title}</span>
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300'}`}
                    >
                      {selected && <Icon name="check" className="h-3 w-3" />}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">{o.text}</span>
                </button>
              );
            })}
          </div>
          {lockedMode && <Hint>Locked: venues already use this type.</Hint>}
        </Section>

        <Section
          step={4}
          title="Booking rules"
          description="Applied to every venue of this type. A venue or unit can still be given its own rules later."
        >
          {!editing && (
            <Switch
              checked={customRules}
              onChange={setCustomRules}
              label="Set custom rules"
              hint="Off uses the platform default: hourly starts, 1–3 hour bookings."
            />
          )}

          {customRules ? (
            <>
              <div>
                <Label>Quick presets</Label>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {PRESETS.map((p, i) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setPolicy((cur) => ({ ...cur, ...p.values }))}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        activePreset === i
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <span className="block text-sm font-medium">{p.label}</span>
                      <span className="block text-[11px] leading-tight text-gray-500">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Field label="Start every" unit="min" value={policy.slotIntervalMin} onChange={setPol('slotIntervalMin')} />
                <Field label="Shortest" unit="min" value={policy.minDurationMin} onChange={setPol('minDurationMin')} />
                <Field label="Longest" unit="min" value={policy.maxDurationMin} onChange={setPol('maxDurationMin')} />
                <Field label="Length step" unit="min" value={policy.durationIncrementMin} onChange={setPol('durationIncrementMin')} />
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                <Icon name="arrow" className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                Lead time, advance window and buffers
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Field label="Book up to" unit="days" min={1} value={policy.maxAdvanceDays} onChange={setPol('maxAdvanceDays')} hint="How far ahead." />
                  <Field label="Notice needed" unit="min" value={policy.minLeadMinutes} onChange={setPol('minLeadMinutes')} hint="0 = last minute." />
                  <Field label="Setup before" unit="min" value={policy.bufferBeforeMin} onChange={setPol('bufferBeforeMin')} hint="Kept free." />
                  <Field label="Clean-up after" unit="min" value={policy.bufferAfterMin} onChange={setPol('bufferAfterMin')} hint="Kept free." />
                </div>
              )}

              {problem ? (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>
              ) : (
                <p className="text-xs text-gray-500">
                  Owners set a price for each length. A length with no price can&apos;t be booked.
                </p>
              )}
            </>
          ) : null}
        </Section>

        <Section step={5} title="Visibility">
          <Switch
            checked={form.isActive}
            onChange={(v) => set('isActive', v)}
            label="Active"
            hint="Customers can see it and owners can pick it when adding a venue."
          />
          <div className="max-w-[12rem]">
            <Label>Display order</Label>
            <Input type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            <Hint>Lower numbers appear first.</Hint>
          </div>
        </Section>

        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white/90">
          {customRules && problem && <p className="mr-auto text-xs text-red-600">Fix the booking rules to save.</p>}
          <Button type="submit" loading={submitting} disabled={customRules && !!problem}>
            {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create venue type'}
          </Button>
        </div>
      </div>

      {/* Live preview — what customers will see. */}
      <aside className="space-y-3 lg:sticky lg:top-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Customer preview</p>
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-card">
          <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Category chips</p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-white shadow-sm">
                <MaterialIcon name={form.iconKey} className="text-[18px]" />
                {form.name.trim() || 'Venue type'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white py-1.5 pl-2.5 pr-3.5 text-sm text-gray-500">
                <MaterialIcon name="category" className="text-[18px]" />
                Other
              </span>
            </div>
            {unitTypes.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {unitTypes.map((t) => (
                  <span key={t} className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600">{t}</span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {form.name.trim() ? `${form.name.trim()} ${form.venueLabel.trim() ? '· ' + form.venueLabel.trim() : ''}` : 'Your venue'}
              </p>
              <p className="text-xs text-gray-500">{unit} 1 · Example</p>
            </div>
            {problem ? (
              <p className="text-xs text-gray-400">Fix the rules to see the booking options.</p>
            ) : customRules ? (
              <>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Starts</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sampleStarts.map((m) => (
                      <span key={m} className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800">{clock(m)}</span>
                    ))}
                    <span className="px-1 py-1 text-xs text-gray-400">…</span>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Length</p>
                  <div className="flex flex-wrap gap-1.5">
                    {durations.slice(0, 8).map((d) => (
                      <span key={d} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{durationLabel(d)}</span>
                    ))}
                    {durations.length > 8 && <span className="px-1 py-1 text-xs text-gray-400">+{durations.length - 8} more</span>}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">Hourly starts · 1, 2 or 3 hours.</p>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400">
          {form.isActive ? 'Visible to customers once saved.' : 'Hidden from customers until activated.'}
        </p>
      </aside>
    </form>
  );
}
