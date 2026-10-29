'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import type { AdminVenueCategory } from '@/lib/categories';
import { ErrorBanner, PageHeader, SkeletonDetailCard, SuccessBanner } from '@/components/ui';
import { CategoryForm } from '@/components/category-form';
import { FacilityTermsSection } from '@/components/facility-terms-section';

type Tab = 'info' | 'commission' | 'cancellation';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'info', label: 'Info' },
  { key: 'commission', label: 'Commission' },
  { key: 'cancellation', label: 'Cancellation' },
];

export default function EditVenueTypePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading } = useFetch<AdminVenueCategory>(`/admin/categories/${id}`);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>('info');

  // The tab lives in the address (?tab=commission) so a refresh or a shared link stays on it. Read in an effect rather than with
  // useSearchParams, which would need a Suspense boundary around the page.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t.key === wanted)) setTab(wanted as Tab);
  }, []);
  const choose = (next: Tab) => {
    setTab(next);
    setSaved(false);
    const url = new URL(window.location.href);
    if (next === 'info') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  if (loading) return <SkeletonDetailCard fields={6} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <div>
      <Link href="/venue-types" className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-800">
        ← Facilities
      </Link>
      <PageHeader
        title={data.name}
        subtitle={`${data.venueCount} venue${data.venueCount === 1 ? '' : 's'} offer this facility. Rule changes apply to new bookings straight away; existing bookings are not touched.`}
      />

      <div role="tablist" aria-label="Facility sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`facility-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="facility-tabpanel"
            onClick={() => choose(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="facility-tabpanel" role="tabpanel" aria-labelledby={`facility-tab-${tab}`}>
        {tab === 'info' && (
          <>
            {saved && (
              <div className="mb-4">
                <SuccessBanner message="Facility saved." />
              </div>
            )}
            <CategoryForm
              key={data.id}
              initial={data}
              onSaved={() => {
                setSaved(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                router.refresh();
              }}
            />
          </>
        )}
        {tab === 'commission' && <FacilityTermsSection categoryId={data.id} view="commission" />}
        {tab === 'cancellation' && <FacilityTermsSection categoryId={data.id} view="cancellation" />}
      </div>
    </div>
  );
}
