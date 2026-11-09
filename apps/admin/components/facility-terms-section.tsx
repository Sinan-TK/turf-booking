'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import type { CommercialTerms, FacilityTerms } from '@/lib/commercial';
import { CommercialTermsEditor, type Group } from '@/components/commercial-terms-editor';
import { ErrorBanner, SkeletonDetailCard } from '@/components/ui';

const VIEWS = {
  commission: {
    title: 'Commission',
    hint: 'What the platform earns on each booking, the monthly cap and the fee after it, and the least a customer pays online, for every venue offering this facility.',
    groups: ['commission', 'cap', 'afterCap', 'advance'] as Group[],
  },
  cancellation: {
    title: 'Cancellation',
    hint: 'How refunds and the owner share work when a customer cancels, and the cut-off after which they cannot, for every venue offering this facility.',
    groups: ['cancelSwitch', 'cancellation', 'cutoff'] as Group[],
  },
};

/**
 * A facility's commission or cancellation terms (one tab of the facility page) — the main place they are edited. A venue can have
 * its own deal on the venue's page. Both tabs save the whole set, so saving one never changes the other.
 */
export function FacilityTermsSection({ categoryId, view }: { categoryId: string; view: keyof typeof VIEWS }) {
  const { data, error, loading, refetch } = useFetch<FacilityTerms>(`/admin/categories/${categoryId}/commercial-terms`);
  if (loading && !data) return <SkeletonDetailCard fields={4} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <section className="rounded-xl border border-gray-200/80 bg-white shadow-card">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">{VIEWS[view].title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{VIEWS[view].hint} A single venue can have its own deal on the venue&apos;s page.</p>
      </header>
      <div className="p-5">
        <CommercialTermsEditor
          mode="facility"
          show={VIEWS[view].groups}
          own={data.own}
          effective={data.terms}
          sources={data.sources}
          onSave={async (terms: Partial<CommercialTerms>) => {
            await api.put(`/admin/categories/${categoryId}/commercial-terms`, terms);
            refetch();
          }}
        />
      </div>
    </section>
  );
}
