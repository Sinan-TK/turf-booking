import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, P, UL, type LegalSection } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms of Use | Bookyo', description: 'The rules for using Bookyo to find and book venues.' };

const link = 'font-bold text-brand-700 underline underline-offset-2';

const sections: LegalSection[] = [
  {
    id: 'about',
    title: 'About these terms',
    body: (
      <P>
        These terms are an agreement between you and {LEGAL.operator} (&quot;we&quot;, &quot;us&quot;) for your use of {LEGAL.brand}. By creating an account, booking a slot or otherwise using the
        service you accept them, together with our <Link href="/privacy" className={link}>Privacy Policy</Link>, <Link href="/refunds" className={link}>Cancellation &amp; Refund
        Policy</Link> and <Link href="/cookies" className={link}>Cookie Policy</Link>. If you do not agree, please do not use the service.
      </P>
    ),
  },
  {
    id: 'service',
    title: 'What Bookyo is',
    body: (
      <P>
        {LEGAL.brand} is a booking platform. Venues (turfs, courts, pools, game rooms and similar) are run by independent owners who set their own prices, hours, rules and facilities. When you
        book, the booking is between you and the venue; we provide the technology to show availability, take payment and confirm the booking. We do not own, operate or control the venues,
        and we are not responsible for how a venue is run, though we will help resolve problems where we can.
      </P>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <UL>
        <li>You must be 18 or over, or use the service through a parent or guardian, and give accurate details.</li>
        <li>You are responsible for what happens under your account and for keeping your password and one-time codes private. Tell us at once if you think someone else has used them.</li>
        <li>One person, one account. You may not sell, share or transfer an account.</li>
        <li>We may suspend or close an account that breaks these terms, is used for fraud or abuse, or puts others at risk.</li>
      </UL>
    ),
  },
  {
    id: 'booking',
    title: 'Booking a slot',
    body: (
      <>
        <UL>
          <li>Slots shown are live, but a slot is yours only once it is held and your payment succeeds. A held slot is kept for a few minutes while you pay and is then released.</li>
          <li>You normally pay an advance online and the balance at the venue, as shown at checkout. The prices shown include what you are asked to pay online; the venue tells you what is due on arrival.</li>
          <li>Your booking confirmation (with its order ID) is your proof of booking. Show it, or the booking in your account, at the venue.</li>
          <li>Arrive on time. A slot ends at its booked time, so arriving late does not extend it and the slot after yours may already be taken.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'payments',
    title: 'Payments, cancellation and refunds',
    body: (
      <P>
        Payments are handled by Razorpay. Cancellation rules, how much is returned and how refunds are paid are set out in our <Link href="/refunds" className={link}>Cancellation &amp; Refund
        Policy</Link>, and the rules that apply to your booking are shown at checkout and on your booking page. A booking made under certain rules keeps them even if the venue changes its rules later.
      </P>
    ),
  },
  {
    id: 'conduct',
    title: 'Using a venue and the service',
    body: (
      <>
        <P>You agree to:</P>
        <UL>
          <li>follow the venue&apos;s rules, staff instructions and safety requirements, and treat staff and other players with respect;</li>
          <li>take care of the venue&apos;s property and pay for any damage you or your group cause;</li>
          <li>keep to the number of players and the use the booking was made for;</li>
          <li>not misuse the service: no false or duplicate bookings to block slots, no automated scraping or bulk requests, no attempts to break into or disrupt it, and no unlawful use.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'risk',
    title: 'Sport, safety and risk',
    body: (
      <P>
        Sports and activities carry a risk of injury. You take part at your own risk and are responsible for your own fitness and for the safety of anyone you book for, including children. Venues are
        responsible for the safety of their premises and equipment. We do not supervise activities and are not a party to any injury or loss that happens at a venue, except where the law says otherwise.
      </P>
    ),
  },
  {
    id: 'content',
    title: 'Our content and your content',
    body: (
      <P>
        The {LEGAL.brand} name, logo, design and software belong to us or our licensors and may not be copied or reused without permission. Venue names, photos and descriptions belong to their owners.
        If you send us a message or feedback, you allow us to use it to run and improve the service.
      </P>
    ),
  },
  {
    id: 'liability',
    title: 'Our responsibility',
    body: (
      <>
        <P>
          We work to keep the service accurate and available, but we cannot promise it will always be uninterrupted or error free, or that a venue&apos;s details are complete or current. To the extent the law
          allows, we are not liable for indirect or consequential loss, for the acts of venues or other users, or for events outside our control. Where we are liable to you for a booking made through the
          service, our total liability is limited to the amount you paid us for that booking. Nothing in these terms limits liability that cannot be limited by law.
        </P>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to the service and these terms',
    body: <P>We may change or stop parts of the service, and may update these terms. The date at the top shows the latest version. If you keep using the service after a change you accept the new terms; bookings already made keep the terms they were made under.</P>,
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    body: (
      <P>
        These terms are governed by the laws of {LEGAL.law}. Please contact us first so we can try to put things right. If we cannot, the courts at {LEGAL.courts} have exclusive jurisdiction, subject to any
        right you have under consumer protection law to bring a claim elsewhere.
      </P>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <ContactLine />,
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={<p>Please read these terms before you use {LEGAL.brand}. They explain how booking works, what we expect from you and what you can expect from us.</p>}
      sections={sections}
    />
  );
}
