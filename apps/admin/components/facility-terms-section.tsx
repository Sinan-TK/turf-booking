'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import type { CommercialTerms, FacilityTerms } from '@/lib/commercial';
import { CommercialTermsEditor } from '@/components/commercial-terms-editor';
import { ErrorBanner, SkeletonDetailCard } from '@/components/ui';

/** A facility's commission, cap, minimum advance and cancellation terms — the main place they are edited. */
export function FacilityTermsSection({ categoryId }: { categoryId: string }) {
  const { data, error, loading, refetch } = useFetch<FacilityTerms>(`/admin/categories/${categoryId}/commercial-terms`);
  if (loading && !data) return <SkeletonDetailCard fields={4} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <section className="mt-6 rounded-xl border border-gray-200/80 bg-white shadow-card">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Commission &amp; cancellation</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          What the platform earns and how cancellations work for every venue offering this facility. A single venue can have its own deal on the
          venue's page.
        </p>
      </header>
      <div className="p-5">
        <CommercialTermsEditor
          mode="facility"
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
