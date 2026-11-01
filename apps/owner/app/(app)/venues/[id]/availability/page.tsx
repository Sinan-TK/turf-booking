import { redirect } from 'next/navigation';

/** Pricing and availability now live on the venue's own page; an old link or bookmark lands there. */
export default function AvailabilityMoved({ params }: { params: { id: string } }) {
  redirect(`/venues/${params.id}#pricing`);
}
