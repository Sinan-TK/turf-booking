import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, P, UL, type LegalSection } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Cookie Policy | Bookyo', description: 'The cookies and browser storage Bookyo uses, and why.' };

const link = 'font-bold text-brand-700 underline underline-offset-2';

const sections: LegalSection[] = [
  {
    id: 'what',
    title: 'What cookies and browser storage are',
    body: <P>Cookies are small files a website saves in your browser. Browser storage (localStorage and sessionStorage) is similar: it keeps small pieces of information on your device. We use both only so the site works and remembers your choices.</P>,
  },
  {
    id: 'use',
    title: 'What we use',
    body: (
      <>
        <P>These are needed for the site to work and do not need your consent:</P>
        <UL>
          <li><strong>Sign-in cookies:</strong> secure, HTTP-only cookies that keep you signed in and protect your account. They cannot be read by scripts on the page.</li>
          <li><strong>Your location choice:</strong> the place you chose to search in, kept in your browser (localStorage) so the site opens where you left off.</li>
          <li><strong>Recent searches:</strong> the last few venue searches, kept in your browser for this tab only (sessionStorage), so a repeat visit shows results quickly. It is cleared when you close the tab.</li>
        </UL>
      </>
    ),
  },
  {
    id: 'third',
    title: 'Third-party services',
    body: (
      <>
        <P>Some features load services from other companies, which may set their own cookies or read information such as your IP address under their own policies:</P>
        <UL>
          <li><strong>Google:</strong> the Sign in with Google button, which loads from Google only when you open the sign-in window.</li>
          <li><strong>Razorpay:</strong> the secure payment window when you pay for a booking.</li>
          <li><strong>OpenStreetMap:</strong> map tiles shown to venue owners and administrators when they place a venue on a map.</li>
        </UL>
        <P>We do not use advertising or cross-site tracking cookies.</P>
      </>
    ),
  },
  {
    id: 'control',
    title: 'Your choices',
    body: (
      <P>
        You can delete or block cookies and clear site data in your browser settings. If you block the sign-in cookies you will not be able to log in or book, and clearing site data resets your saved location.
        More about how we handle personal information is in our <Link href="/privacy" className={link}>Privacy Policy</Link>.
      </P>
    ),
  },
  {
    id: 'contact',
    title: 'Questions',
    body: (
      <>
        <P>If you have a question about how {LEGAL.brand} uses cookies, get in touch.</P>
        <ContactLine />
      </>
    ),
  },
];

export default function CookiesPage() {
  return <LegalPage title="Cookie Policy" intro={<p>The short version: we use only the cookies and browser storage the site needs to work, and none for advertising.</p>} sections={sections} />;
}
