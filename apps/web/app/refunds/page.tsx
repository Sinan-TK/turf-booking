import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, P, UL, type LegalSection } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Cancellation & Refund Policy | Bookyo', description: 'How cancelling a Bookyo booking works and how refunds are paid.' };

const link = 'font-bold text-brand-700 underline underline-offset-2';

const sections: LegalSection[] = [
  {
    id: 'rules',
    title: 'Each booking shows its own rules',
    body: (
      <P>
        Cancellation rules are set by the venue type and venue, and the rules for your booking are shown at checkout and on your booking page: a list of times, each with the share of your
        online payment returned if you cancel before it, and the time after which cancelling is closed. A booking keeps the rules it was made under, even if the venue changes them later.
      </P>
    ),
  },
  {
    id: 'cancel',
    title: 'How to cancel',
    body: (
      <UL>
        <li>Open the booking under <strong>Account &rarr; Bookings</strong> and choose Cancel. You see what you will get back before you confirm.</li>
        <li>Cancelling is possible until the cut-off shown for your booking. After the cut-off the booking can no longer be cancelled online.</li>
        <li>If you need help, or the venue cannot honour your booking, contact Support.</li>
      </UL>
    ),
  },
  {
    id: 'refund',
    title: 'What you get back and how',
    body: (
      <>
        <UL>
          <li>The refund is a percentage of what you paid online, depending on how early you cancel, as shown in your booking&apos;s rules. The balance you were to pay at the venue is not charged.</li>
          <li><strong>Refunds are paid as coins in your {LEGAL.brand} wallet</strong>, not back to your card, UPI or bank account. Coins are added to your wallet straight away and can be used towards future bookings.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'venue',
    title: 'If the venue cancels or cannot host you',
    body: (
      <P>
        If a venue cancels a booking, closes your slot, or cannot give you what you booked, the booking is cancelled and the full amount you paid online is returned to your wallet as coins. If something
        was wrong at the venue, tell Support within a reasonable time and we will look into it with the venue.
      </P>
    ),
  },
  {
    id: 'noshow',
    title: 'Not turning up',
    body: <P>If you do not arrive for your slot, the booking is treated as used and the advance is not refunded. Please cancel in good time if your plans change, so the slot can go to someone else.</P>,
  },
  {
    id: 'failed',
    title: 'Failed or double payments',
    body: (
      <P>
        If money is taken from you but the booking is not confirmed (for example the slot was released while you were paying), or you are charged twice, contact Support with your payment reference. Amounts
        confirmed as taken in error are returned to the original payment method through our payment provider once we have confirmed them.
      </P>
    ),
  },
  {
    id: 'wallet',
    title: 'Using your coins',
    body: (
      <P>
        Coins in your wallet can be used towards bookings made on {LEGAL.brand}, as shown at checkout. They are not cash and cannot be transferred to another account or withdrawn, except where the law requires
        otherwise. See the <Link href="/terms" className={link}>Terms of Use</Link> for the full rules.
      </P>
    ),
  },
  {
    id: 'contact',
    title: 'Questions',
    body: <ContactLine />,
  },
];

export default function RefundsPage() {
  return (
    <LegalPage
      title="Cancellation & Refund Policy"
      intro={<p>How cancelling a booking works, what you get back and how it is paid. The exact times and percentages for your booking are always shown before you pay.</p>}
      sections={sections}
    />
  );
}
