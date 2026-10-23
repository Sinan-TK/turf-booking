'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import type { CommercialTerms } from '@/lib/commercial';
import { CommercialTermsEditor } from '@/components/commercial-terms-editor';
import { ErrorBanner, PageHeader, SkeletonDetailCard } from '@/components/ui';

/**
 * The platform default commercial terms. Each facility has its own terms (edit them on the facility's page); this
 * default pre-fills a newly created facility and holds the payout schedule that applies to every owner.
 */
export default function PoliciesPage() {
  const { data, error, loading, refetch } = useFetch<{ terms: CommercialTerms | null }>('/admin/commercial-terms/default');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commercial terms"
        subtitle="The platform default. Every facility keeps its own commission, cap, minimum advance and cancellation terms, edited on the facility's page; this default pre-fills a new facility and sets the weekly owner payout day."
      />
      {loading && !data && <SkeletonDetailCard fields={4} />}
      {error && <ErrorBanner message={error} />}
      {data && !data.terms && <ErrorBanner message="No platform default is configured. Run the database seed or migration." />}
      {data?.terms && (
        <section className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-card">
          <CommercialTermsEditor
            mode="platform"
            own={data.terms}
            effective={data.terms}
            onSave={async (terms) => {
              // The platform default is always saved whole.
              await api.put('/admin/commercial-terms/default', { ...data.terms, ...terms });
              refetch();
            }}
          />
        </section>
      )}
    </div>
  );
}
