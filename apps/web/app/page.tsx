'use client';

/*
 * The landing page, kept simple: a clean header, one headline with one search, the venue types as picture cards, how booking works,
 * why Bookyo, and a way in for venue owners. Black, warm white and the logo's lime; nothing else competes with the search.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { VenueCategory } from '@/lib/categories';
import { AccountMenu } from '@/components/account-menu';
import { CategoryIcon, Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { OWNER_PORTAL_URL } from '@/lib/legal';
import { SiteFooter } from '@/components/site-footer';
import { Logo } from '@/components/logo';

const STEPS = [
  { title: 'Find a venue', text: 'Search by area or pick a type: turfs, courts, pools, game rooms and more.' },
  { title: 'Pick a time', text: 'See which slots are free right now and choose the length that suits you.' },
  { title: 'Book and play', text: 'Reserve with a small advance online and get your booking ID straight away.' },
] as const;

const REASONS = [
  { icon: 'bolt', title: 'Live availability', text: 'What you see is open right now, down to the hour.' },
  { icon: 'wallet', title: 'Pay only an advance', text: 'Hold a slot online and settle the rest at the venue.' },
  { icon: 'verified', title: 'Instant confirmation', text: 'No calls or waiting. You get a booking ID straight away.' },
  { icon: 'bookings', title: 'Everything in one place', text: 'Your bookings, your wallet and support, all under your account.' },
] as const;

const focus = 'outline-none focus-visible:ring-4 focus-visible:ring-brand-700/20';
const shell = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8';

/** One venue type: its picture (or icon) and name, leading to its slots. */
function TypeCard({ category: c }: { category: VenueCategory }) {
  return (
    <li>
      <Link
        href={`/explore?type=${encodeURIComponent(c.slug)}`}
        className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card ${focus}`}
      >
        <span className="relative flex aspect-[4/3] items-center justify-center bg-brand-50 text-brand-700">
          <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className="text-[2.5rem]" />
          {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
        </span>
        <span className="flex items-center justify-between gap-2 px-4 py-3.5">
          <span className="truncate text-base font-bold text-slate-900">{c.name}</span>
          <Icon name="chevron_right" className="shrink-0 text-[1.25rem] text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
        </span>
      </Link>
    </li>
  );
}

/** The landing page: search, venue types, how booking works, why Bookyo, and a way in for venue owners. */
export default function LandingPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<VenueCategory[] | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get<VenueCategory[]>('/categories?available=true')
      .then((rows) => !cancelled && setCategories(rows))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
  }

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-cream/90 backdrop-blur">
        <div className={`${shell} flex items-center gap-4 py-3`}>
          <Link href="/" aria-label="Bookyo home" className={`flex select-none items-center rounded-md ${focus}`}>
            <Logo hole="#FFFCF6" className="h-9 w-auto" />
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 text-[0.9375rem] font-semibold text-slate-600 md:flex">
            <Link href="/explore" className={`rounded-md px-3 py-1.5 transition hover:text-brand-700 ${focus}`}>
              Explore venues
            </Link>
            <Link href="/support" className={`rounded-md px-3 py-1.5 transition hover:text-brand-700 ${focus}`}>
              Support
            </Link>
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ----------------------------------------------------------- Hero */}
        <section className={`${shell} pb-14 pt-14 text-center sm:pb-20 sm:pt-20`}>
          <h1 className="mx-auto max-w-3xl text-balance text-[2.75rem] font-black leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            Book your game, <span className="rounded-md bg-brand-400 px-2 [box-decoration-break:clone]">in seconds.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-slate-600">
            Turfs, courts, pools, game rooms and activity venues near you. See which slots are free right now and book in a minute.
          </p>

          <form
            onSubmit={search}
            role="search"
            className="mx-auto mt-8 flex max-w-2xl flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card sm:flex-row"
          >
            <label className="relative flex-1">
              <span className="sr-only">Search venues</span>
              <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-slate-400" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search venues, turfs, pools, badminton..."
                className="h-12 w-full rounded-xl bg-transparent pl-12 pr-4 text-base font-medium text-slate-900 placeholder-slate-400 outline-none"
              />
            </label>
            <button
              type="submit"
              className={`h-12 rounded-xl bg-brand-700 px-7 text-base font-bold text-white transition hover:bg-brand-600 active:scale-[0.98] ${focus}`}
            >
              Find venues
            </button>
          </form>

          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-slate-600">
            {['Live availability', 'Pay only a small advance', 'Instant booking ID'].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Icon name="check" className="text-[1rem] text-brand-700" />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------- Venue types */}
        <section aria-labelledby="types-heading" className={`${shell} pb-16 sm:pb-24`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="types-heading" className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Browse by type
              </h2>
              <p className="mt-1.5 text-base text-slate-600">Pick what you want to play and see its open slots.</p>
            </div>
            <Link href="/explore" className={`inline-flex items-center gap-1 rounded-md text-[0.9375rem] font-bold text-brand-700 hover:underline ${focus}`}>
              All venues
              <Icon name="chevron_right" className="text-[1.125rem]" />
            </Link>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {categories === null &&
              Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <Skeleton className="aspect-[4/3] w-full rounded-none" />
                  <div className="px-4 py-3.5">
                    <Skeleton className="h-5 w-2/3" />
                  </div>
                </li>
              ))}
            {categories?.map((c) => <TypeCard key={c.slug} category={c} />)}
          </ul>
          {categories && categories.length === 0 && <p className="mt-8 text-base text-slate-600">Venues are being added. Check back soon.</p>}
        </section>

        {/* -------------------------------------------------- How it works */}
        <section className="border-y border-slate-200 bg-white">
          <div className={`${shell} py-16 sm:py-20`}>
            <h2 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">How it works</h2>
            <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="rounded-2xl border border-slate-200 bg-cream p-6">
                  <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-400 text-lg font-black text-brand-700">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-xl font-extrabold text-slate-900">{step.title}</h3>
                  <p className="mt-1.5 text-pretty text-base leading-relaxed text-slate-600">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------------- Why */}
        <section className={`${shell} py-16 sm:py-20`}>
          <h2 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Why book with Bookyo</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-base text-slate-600">Less chasing, more playing. Get a slot sorted in a minute.</p>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {REASONS.map((r) => (
              <li key={r.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-[1.375rem] text-brand-700">
                  <Icon name={r.icon} />
                </span>
                <h3 className="mt-4 text-lg font-extrabold text-slate-900">{r.title}</h3>
                <p className="mt-1.5 text-pretty text-[0.9375rem] leading-relaxed text-slate-600">{r.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------- For owners */}
        <section className={`${shell} pb-16 sm:pb-24`}>
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-brand-700 p-8 text-white sm:flex-row sm:items-center sm:p-10">
            <div>
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Own a venue?</h2>
              <p className="mt-2 max-w-xl text-pretty text-base leading-relaxed text-white/75">
                List your turf, court or activity space on Bookyo, take online bookings and see your earnings in one place.
              </p>
            </div>
            <a
              href={`${OWNER_PORTAL_URL}/register`}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-400 px-6 py-3.5 text-base font-extrabold text-brand-700 outline-none transition hover:bg-white focus-visible:ring-4 focus-visible:ring-white/40 active:scale-[0.98]"
            >
              List your venue
              <Icon name="chevron_right" className="text-[1.125rem]" />
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
