import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, P, UL, type LegalSection } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Policy | Bookyo', description: 'What personal information Bookyo collects, why, who it is shared with and the choices you have.' };

const sections: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <P>
        {LEGAL.brand} is run by {LEGAL.operator} (&quot;we&quot;, &quot;us&quot;). We let you find and book sports, games and activity venues, and we let venue owners take those
        bookings. For the personal information described here we decide why and how it is used, which makes us the &quot;data fiduciary&quot; under the Digital Personal Data
        Protection Act, 2023 and the &quot;controller&quot; in plain terms.
      </P>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <P>We collect only what is needed to run bookings and keep accounts safe:</P>
        <UL>
          <li><strong>Account details:</strong> your name, mobile number and email address, and a password you choose (stored only as a one-way hash, never readable). If you sign in with Google we receive your Google name, email address and profile identifier, not your Google password.</li>
          <li><strong>Booking details:</strong> the venue, unit, date, time and length you book, its price, and the status of the booking (confirmed, cancelled, completed).</li>
          <li><strong>Payment details:</strong> the amount, a payment reference and whether it succeeded. Card, UPI and bank details are entered on Razorpay&apos;s secure checkout and are never seen or stored by us.</li>
          <li><strong>Wallet:</strong> your coin balance and the history of coins added or used.</li>
          <li><strong>Messages and support:</strong> what you send to Support and our replies.</li>
          <li><strong>Location (only if you allow it):</strong> when you press &quot;Use my current location&quot;, your browser shares your position so we can find venues near you. It is used for that search and is not kept in your account.</li>
          <li><strong>Technical data:</strong> your IP address and the time of important actions such as signing in, kept in security and audit logs, plus the sign-in cookies described in our <Link href="/cookies" className="font-bold text-brand-700 underline underline-offset-2">Cookie Policy</Link>.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <UL>
        <li>To create and secure your account and recognise you when you return.</li>
        <li>To hold a slot, take your advance payment and confirm, change or cancel your booking.</li>
        <li>To send you your booking confirmation, one-time codes and booking updates by WhatsApp or email.</li>
        <li>To tell the venue who is coming and when, so they can host you.</li>
        <li>To answer your support requests and settle disputes.</li>
        <li>To prevent fraud, abuse and mistakes, and to keep records the law requires, including tax and accounting records.</li>
        <li>To understand, in aggregate, how the service is used so we can fix and improve it.</li>
      </UL>
    ),
  },
  {
    id: 'share',
    title: 'Who we share it with',
    body: (
      <>
        <P>We do not sell your personal information. We share it only as needed to provide the service:</P>
        <UL>
          <li><strong>The venue you book:</strong> your name, contact number and booking details, so they can honour the booking and contact you about it. Venue owners and their staff may use this only to run your booking.</li>
          <li><strong>Payment provider:</strong> Razorpay processes your payment under its own privacy policy.</li>
          <li><strong>Sign-in provider:</strong> Google, when you choose to sign in with Google.</li>
          <li><strong>Message and email providers:</strong> the services that deliver our WhatsApp and email messages receive your number or address and the message text.</li>
          <li><strong>Hosting and infrastructure:</strong> our cloud hosting, database and file-storage providers hold the data on our behalf under contract.</li>
          <li><strong>Authorities:</strong> where the law requires it, or to protect our rights, other users or the public.</li>
          <li><strong>A buyer or successor</strong> if the business is sold or merged, with the same protections for your information.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'keep',
    title: 'How long we keep it',
    body: (
      <P>
        We keep your account information while your account is open. Booking and payment records are kept for as long as the law requires for tax, accounting and dispute purposes,
        and for as long as needed to resolve any claim about a booking. When information is no longer needed for these purposes we delete it or make it anonymous.
      </P>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <P>
        Passwords are stored as one-way hashes. Sessions use secure, HTTP-only cookies. Connections are encrypted, the sites apply a strict content security policy, and access to
        administration tools is limited and recorded in an audit log. No system is perfectly secure, so please use a strong, unique password and tell us at once if you think your
        account has been misused.
      </P>
    ),
  },
  {
    id: 'rights',
    title: 'Your choices and rights',
    body: (
      <>
        <P>You can, subject to the law:</P>
        <UL>
          <li>see and correct the details in your Profile, and ask us for a copy of the information we hold about you;</li>
          <li>ask us to delete your account and information (we may have to keep some records, such as payments, for the period the law requires);</li>
          <li>withdraw consent you gave us, for example turning off location sharing in your browser at any time;</li>
          <li>tell us if you are not happy with how your information has been handled, and have the matter looked into.</li>
        </UL>
        <P>To use any of these, contact us as described below. We may need to confirm it is really you before we act.</P>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <P>The service is meant for people aged 18 and over. A child under 18 should book only through a parent or guardian, who is then responsible for the booking. We do not knowingly collect a child&apos;s information for any other purpose.</P>,
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: <P>We may update this policy as the service changes or the law requires. The date at the top shows when it last changed. If a change is significant we will tell you in the app or by message.</P>,
  },
  {
    id: 'contact',
    title: 'Contact and grievances',
    body: (
      <>
        <P>For any question, request or complaint about your personal information, or to reach our grievance contact, write to us:</P>
        <ContactLine />
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p>This policy explains what personal information {LEGAL.brand} collects when you use our website, why we collect it, who it is shared with and the choices you have. By using {LEGAL.brand} you confirm you have read it.</p>}
      sections={sections}
    />
  );
}
