import type { Metadata } from 'next';
import { CUSTOMER_SITE_URL, LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Venue Partner Terms — TurfX', description: 'The terms for venue owners who list and take bookings on TurfX.' };

const link = 'font-semibold text-primary underline underline-offset-2';
const p = 'mt-3 text-pretty text-body-md leading-relaxed text-on-surface-variant';
const ul = 'mt-3 list-disc space-y-1.5 pl-5 text-body-md leading-relaxed text-on-surface-variant marker:text-primary';

const sections: Array<{ id: string; title: string; body: React.ReactNode }> = [
  {
    id: 'scope',
    title: 'Who these terms are for',
    body: (
      <p className={p}>
        These terms apply to the person or business (&quot;you&quot;, the &quot;Venue Partner&quot;) that lists a venue on {LEGAL.brand} and takes bookings through it, and are an agreement with {LEGAL.operator}. They sit alongside the{' '}
        <a href={`${CUSTOMER_SITE_URL}/terms`} className={link}>Terms of Use</a> and <a href={`${CUSTOMER_SITE_URL}/privacy`} className={link}>Privacy Policy</a>. By creating an owner account or listing a venue you accept them.
      </p>
    ),
  },
  {
    id: 'listing',
    title: 'Listing your venue',
    body: (
      <ul className={ul}>
        <li>You confirm that you own the venue or have the right to rent it out, and that the details you give (name, address, location, photos, opening hours, prices and rules) are true and kept up to date.</li>
        <li>A new venue stays hidden from customers until we have looked at it and made it live. We may decline, hide or remove a listing that is inaccurate, unsafe or breaks these terms.</li>
        <li>You must hold the licences, permissions and insurance your venue and activities need, and keep the venue safe, clean and fit for the activities offered.</li>
      </ul>
    ),
  },
  {
    id: 'bookings',
    title: 'Bookings and customers',
    body: (
      <ul className={ul}>
        <li>You must honour every confirmed booking at the time and price shown. Keep your calendar and any blocks up to date so customers are never booked for a slot you cannot offer.</li>
        <li>If you must cancel or cannot host a booking, cancel it in the portal as soon as you can; the customer is refunded in full as coins.</li>
        <li>You may use customers&apos; contact and booking details only to run their booking, and must not contact them for marketing or share their details with anyone else.</li>
        <li>Treat customers fairly. Do not charge more than the price shown for the booking, or add undisclosed charges.</li>
      </ul>
    ),
  },
  {
    id: 'fees',
    title: 'Commission and payouts',
    body: (
      <ul className={ul}>
        <li>We take a commission on each completed booking, and may apply other fees, as shown to you in this portal under your commercial terms. A booking keeps the terms it was made under.</li>
        <li>Customers pay an advance online. Your earnings from played bookings are settled and paid out to your bank account on the payout schedule shown in the portal, after commission and any adjustments.</li>
        <li>Refunds and cancellations follow the rules set for your venue and are paid to customers as coins; the matching amount is taken from your earnings for that booking.</li>
        <li>You are responsible for your own taxes, including any GST and income tax on what you earn, and for giving us the details we need to pay you.</li>
      </ul>
    ),
  },
  {
    id: 'staff',
    title: 'Your staff and account',
    body: <p className={p}>You are responsible for everything done under your account and by the staff logins you create, and for removing access when someone leaves. Keep passwords private, and tell us at once if you think an account has been misused.</p>,
  },
  {
    id: 'liability',
    title: 'Responsibility',
    body: (
      <p className={p}>
        You run the venue and are responsible for it, including injuries, loss or damage at it, and for compensating us for claims, losses and costs that arise from your venue, your breach of these terms or your breach of the law, to the extent the
        law allows. We provide the platform &quot;as is&quot; and are not liable for lost income, bookings or profits, except where the law does not allow us to exclude it.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Ending the partnership',
    body: <p className={p}>You may remove your venue and close your account at any time, after bookings already confirmed have been honoured or cancelled and any payouts due have been settled. We may suspend or end your access if you break these terms, put customers at risk or misuse the platform. Money already owed to either side stays owed.</p>,
  },
  {
    id: 'law',
    title: 'Governing law and changes',
    body: <p className={p}>These terms are governed by the laws of {LEGAL.law}, and the courts at {LEGAL.courts} have exclusive jurisdiction. We may update them; the date at the top shows the latest version, and continuing to use the owner portal means you accept it.</p>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <p className={p}>
        Write to us through the platform&apos;s support{LEGAL.email ? <> at <a href={`mailto:${LEGAL.email}`} className={link}>{LEGAL.email}</a></> : null}.{LEGAL.address ? ` Our address is ${LEGAL.address}.` : ''}
      </p>
    ),
  },
];

/** The Venue Partner Terms, public so an owner can read them before creating an account. */
export default function PartnerTermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <header className="border-b border-outline-variant/60 bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/login" className="font-headline-sm text-headline-sm text-on-surface">
            {LEGAL.brand} <span className="text-primary">for venue owners</span>
          </a>
          <a href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container">
            Sign in
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-balance font-display-lg text-display-lg text-on-surface">Venue Partner Terms</h1>
        <p className="mt-2 text-sm font-semibold text-on-surface-variant">Last updated {LEGAL.updated}</p>
        <p className="mt-5 max-w-3xl text-pretty text-body-lg leading-relaxed text-on-surface-variant">
          The terms for venue owners who list their turf, court or activity space on {LEGAL.brand} and take bookings through it.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
            <p className="text-sm font-bold text-on-surface">On this page</p>
            <ol className="mt-3 space-y-1.5 border-l border-outline-variant text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 font-medium text-on-surface-variant hover:border-primary hover:text-primary">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="max-w-3xl">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-6 border-t border-outline-variant/50 py-7 first:border-0 first:pt-0">
                <h2 className="text-balance font-headline-sm text-headline-sm text-on-surface">{s.title}</h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-outline-variant/60 bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-on-surface-variant sm:px-6">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
            <a href={`${CUSTOMER_SITE_URL}/terms`} className="hover:text-primary">Terms of Use</a>
            <a href={`${CUSTOMER_SITE_URL}/privacy`} className="hover:text-primary">Privacy Policy</a>
            <a href={`${CUSTOMER_SITE_URL}/refunds`} className="hover:text-primary">Cancellation &amp; Refunds</a>
          </nav>
          <p>&copy; {new Date().getFullYear()} {LEGAL.operator}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
