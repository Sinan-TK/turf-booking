'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Button, Card, ErrorBanner, Label, PageHeader, Select, SkeletonDetailCard, SuccessBanner } from '@/components/ui';

interface SiteView {
  googleSignIn: boolean;
  maxFeatured: number;
  featured: Array<{ id: string; name: string; address: string; status: string }>;
}
interface Venue {
  id: string;
  name: string;
  address: string;
  status: string;
  facilityCode: string;
}

/** The public site's controls: whether Google sign-in is on, and which venues the landing page features. */
export default function SitePage() {
  const { data, error, loading, refetch } = useFetch<SiteView>('/admin/site');
  const { data: venues } = useFetch<Venue[]>('/venues/mine');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pick, setPick] = useState('');

  if (loading && !data) return <SkeletonDetailCard fields={4} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      refetch();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setBusy(false);
    }
  }

  const ids = data.featured.map((f) => f.id);
  const save = (next: string[], done: string) => run(() => api.put('/admin/site/featured', { venueIds: next }), done);
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void save(next, 'Order saved.');
  };
  // Only venues that are live can be shown to customers, so only those are offered.
  const choices = (venues ?? []).filter((v) => v.status === 'ACTIVE' && !ids.includes(v.id)).sort((a, b) => a.name.localeCompare(b.name));
  const full = ids.length >= data.maxFeatured;

  return (
    <div className="space-y-6">
      <PageHeader title="Landing page & sign-in" subtitle="What customers see on the home page, and how they can sign in." />
      {failure && <ErrorBanner message={failure} />}
      {notice && <SuccessBanner message={notice} />}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-gray-900">Google sign-in</h2>
            <p className="mt-1 text-sm text-gray-600">
              When this is off, the Google button is hidden on the log in and sign up screens, and Google sign-in does not work at all.
              Turn it on once Google has approved the app. Customers can always use their email and password.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={data.googleSignIn}
            aria-label="Google sign-in"
            disabled={busy}
            onClick={() => void run(() => api.put('/admin/site/google', { enabled: !data.googleSignIn }), data.googleSignIn ? 'Google sign-in is off.' : 'Google sign-in is on.')}
            className="inline-flex shrink-0 items-center gap-2.5 disabled:opacity-60"
          >
            <span className={`relative h-7 w-12 rounded-full transition-colors ${data.googleSignIn ? 'bg-emerald-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${data.googleSignIn ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
            <span className={`text-sm font-semibold ${data.googleSignIn ? 'text-emerald-700' : 'text-gray-600'}`}>{data.googleSignIn ? 'On' : 'Off'}</span>
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-gray-900">Featured venues</h2>
        <p className="mt-1 text-sm text-gray-600">
          Shown in this order in a section on the landing page. Only live venues appear to customers, up to {data.maxFeatured}. With none chosen, the
          section is hidden.
        </p>

        {data.featured.length === 0 ? (
          <p className="mt-5 rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No venues are featured yet.</p>
        ) : (
          <ol className="mt-5 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {data.featured.map((v, i) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-sm font-semibold tabular-nums text-gray-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{v.name}</span>
                  <span className="block truncate text-xs text-gray-500">{v.address}</span>
                </span>
                {v.status !== 'ACTIVE' && (
                  <span title="Customers do not see this venue while it is not live">
                    <Badge value={v.status} />
                  </span>
                )}
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Move ${v.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded-md border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-40">
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${v.name} down`} disabled={busy || i === ids.length - 1} onClick={() => move(i, 1)} className="rounded-md border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-40">
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${v.name} from featured venues`}
                    disabled={busy}
                    onClick={() => void save(ids.filter((x) => x !== v.id), 'Removed.')}
                    className="rounded-md border border-red-200 px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1 sm:max-w-md">
            <Label htmlFor="feature-pick">Add a venue</Label>
            <Select id="feature-pick" value={pick} disabled={busy || full || choices.length === 0} onChange={(e) => setPick(e.target.value)}>
              <option value="">{full ? `You have chosen ${data.maxFeatured} venues` : choices.length === 0 ? 'No more live venues to add' : 'Choose a venue…'}</option>
              {choices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.facilityCode})
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            disabled={busy || !pick}
            onClick={() => {
              const id = pick;
              setPick('');
              void save([...ids, id], 'Added to the landing page.');
            }}
          >
            Add venue
          </Button>
        </div>
      </Card>
    </div>
  );
}
