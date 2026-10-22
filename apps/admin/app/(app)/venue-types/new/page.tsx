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
        ← Facilities
      </Link>
      <PageHeader
        title="New facility"
        subtitle="Set up something new to book — Chess, Swimming, Studio — then owners can add units of it to any venue."
      />
      <CategoryForm onSaved={() => router.push('/venue-types')} />
    </div>
  );
}
