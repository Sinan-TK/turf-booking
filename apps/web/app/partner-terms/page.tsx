import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, P, UL, type LegalSection } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Venue Partner Terms | TurfX', description: 'The terms for venue owners who list and take bookings on TurfX.' };

const link = 'font-bold text-brand-700 underline underline-offset-2';

const sections: LegalSection[] = [
  {
    id: 'scope',
    title: 'Who these terms are for',
    body: (
      <P>
        These terms apply to the person or business (&quot;you&quot;, the &quot;Venue Partner&quot;) that lists a venue on {LEGAL.brand} and takes bookings through it, and are an agreement with {LEGAL.operator}. They sit alongside the{' '}
        <Link href="/terms" className={link}>Terms of Use</Link> and <Link href="/privacy" className={link}>Privacy Policy</Link>. By creating an owner account or listing a venue you accept them.
      </P>
    ),
  },
  {
    id: 'listing',
    title: 'Listing your venue',
    body: (
      <UL>
        <li>You confirm that you own the venue or have the right to rent it out, and that the details you give (name, address, location, photos, opening hours, prices and rules) are true and kept up to date.</li>
        <li>New venues and changes may be reviewed by us, and we may decline, hide or remove a listing that is inaccurate, unsafe or breaks these terms.</li>
        <li>You must hold the licences, permissions and insurance your venue and activities need, and keep the venue safe, clean and fit for the activities offered.</li>
      </UL>
    ),
  },
  {
    id: 'bookings',
    title: 'Bookings and customers',
    body: (
      <UL>
        <li>You must honour every confirmed booking at the time and price shown. Keep your calendar and any blocks up to date so customers are never booked for a slot you cannot offer.</li>
        <li>If you must cancel or cannot host a booking, cancel it in the portal as soon as you can; the customer is refunded in full as coins.</li>
        <li>You may use customers&apos; contact and booking details only to run their booking, and must not contact them for marketing or share their details with anyone else.</li>
        <li>Treat customers fairly. Do not charge more than the price shown for the booking, or add undisclosed charges.</li>
      </UL>
    ),
  },
  {
    id: 'fees',
    title: 'Commission and payouts',
    body: (
      <UL>
        <li>We take a commission on each completed booking, and may apply other fees, as shown to you in the owner portal under your commercial terms. A booking keeps the terms it was made under.</li>
        <li>Customers pay an advance online. Your earnings from played bookings are settled and paid out to your bank account on the payout schedule shown in the portal, after commission and any adjustments.</li>
        <li>Refunds and cancellations follow the rules set for your venue and are paid to customers as coins; the matching amount is taken from your earnings for that booking.</li>
        <li>You are responsible for your own taxes, including any GST and income tax on what you earn, and for giving us the details we need to pay you.</li>
      </UL>
    ),
  },
  {
    id: 'staff',
    title: 'Your staff and account',
    body: <P>You are responsible for everything done under your account and by the staff logins you create, and for removing access when someone leaves. Keep passwords private, and tell us at once if you think an account has been misused.</P>,
  },
  {
    id: 'liability',
    title: 'Responsibility',
    body: (
      <P>
        You run the venue and are responsible for it, including injuries, loss or damage at it, and for compensating us for claims, losses and costs that arise from your venue, your breach of these terms or your breach of the law, to the extent the
        law allows. We provide the platform &quot;as is&quot; and are not liable for lost income, bookings or profits, except where the law does not allow us to exclude it.
      </P>
    ),
  },
  {
    id: 'ending',
    title: 'Ending the partnership',
    body: <P>You may remove your venue and close your account at any time, after bookings already confirmed have been honoured or cancelled and any payouts due have been settled. We may suspend or end your access if you break these terms, put customers at risk or misuse the platform. Money already owed to either side stays owed.</P>,
  },
  {
    id: 'law',
    title: 'Governing law and changes',
    body: <P>These terms are governed by the laws of {LEGAL.law}, and the courts at {LEGAL.courts} have exclusive jurisdiction. We may update them; the date at the top shows the latest version, and continuing to use the owner portal means you accept it.</P>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <ContactLine />,
  },
];

export default function PartnerTermsPage() {
  return <LegalPage title="Venue Partner Terms" intro={<p>The terms for venue owners who list their turf, court or activity space on {LEGAL.brand} and take bookings through it.</p>} sections={sections} />;
}
