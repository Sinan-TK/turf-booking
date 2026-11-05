import Link from 'next/link';
import { Logo } from '@/components/logo';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

const focus = 'rounded-md outline-none focus-visible:ring-4 focus-visible:ring-brand-600/25';
const item = `inline-block py-1 text-[0.9375rem] font-semibold text-slate-600 transition hover:text-brand-700 ${focus}`;

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
      <ul className="mt-3 space-y-1">{children}</ul>
    </nav>
  );
}

/** The footer of the customer site's public pages: who we are, where to go, and the legal pages. */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))] lg:gap-12">
          <div className="max-w-sm">
            <Link href="/" aria-label={`${LEGAL.brand} home`} className={`inline-block select-none rounded-md ${focus}`}>
              <Logo hole="#FFFCF6" className="h-10 w-auto" />
            </Link>
            <p className="mt-4 text-pretty text-[0.9375rem] font-medium leading-relaxed text-slate-600">
              Turfs, courts, pools, game rooms and activity venues near you. Live slots, a small advance, and your confirmation on WhatsApp.
            </p>
          </div>

          <Column title="Explore">
            <li>
              <Link href="/explore" className={item}>
                All venues
              </Link>
            </li>
            <li>
              <Link href="/account?tab=bookings" className={item}>
                My bookings
              </Link>
            </li>
            <li>
              <Link href="/support" className={item}>
                Support
              </Link>
            </li>
          </Column>

          <Column title="Legal">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={item}>
                  {l.label}
                </Link>
              </li>
            ))}
          </Column>
        </div>

        <div className="flex flex-col gap-1 border-t border-slate-200 py-5 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {LEGAL.operator}. All rights reserved.
          </p>
          {LEGAL.email && (
            <a href={`mailto:${LEGAL.email}`} className={`font-semibold hover:text-brand-700 ${focus}`}>
              {LEGAL.email}
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
