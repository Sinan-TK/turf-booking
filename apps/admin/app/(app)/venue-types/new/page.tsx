'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { CategoryForm } from '@/components/category-form';

export default function NewVenueTypePage() {
  const router = useRouter();
  return (
    <div>
      <Link href="/venue-types" className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-800">
        ← Venue types
      </Link>
      <PageHeader
        title="New venue type"
        subtitle="Set up something new to book — Chess, Badminton, Studio — then owners can add venues of this type."
      />
      <CategoryForm onSaved={() => router.push('/venue-types')} />
    </div>
  );
}
