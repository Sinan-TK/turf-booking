'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import type { AdminVenueCategory } from '@/lib/categories';
import { ErrorBanner, PageHeader, SkeletonDetailCard, SuccessBanner } from '@/components/ui';
import { CategoryForm } from '@/components/category-form';

export default function EditVenueTypePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading } = useFetch<AdminVenueCategory>(`/admin/categories/${id}`);
  const [saved, setSaved] = useState(false);

  if (loading) return <SkeletonDetailCard fields={6} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <div>
      <Link href="/venue-types" className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-800">
        ← Venue types
      </Link>
      <PageHeader
        title={data.name}
        subtitle={`${data.venueCount} venue${data.venueCount === 1 ? '' : 's'} use this type. Rule changes apply to new bookings straight away; existing bookings are not touched.`}
      />
      {saved && (
        <div className="mb-4">
          <SuccessBanner message="Venue type saved." />
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
    </div>
  );
}
