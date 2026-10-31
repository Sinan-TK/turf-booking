'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { VenueCategory } from '@/lib/categories';
import { AccountMenu } from '@/components/account-menu';
import { BannerSlider } from '@/components/banner-slider';
import { CategoryIcon, Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/** Where owners sign in to list their venues (the owner portal). */
const OWNER_PORTAL_URL = process.env.NEXT_PUBLIC_OWNER_URL ?? 'http://localhost:3002';

const STEPS = [
  { icon: 'search', title: 'Find a venue', text: 'Search by area or pick a type: turfs, courts, pools, game rooms and more.' },
  { icon: 'schedule', title: 'Pick a time', text: 'See which slots are free right now and choose the length that suits you.' },
  { icon: 'check', title: 'Book and play', text: 'Reserve with a small advance online. Your confirmation arrives on WhatsApp.' },
] as const;

const REASONS = [
  { icon: 'bolt', title: 'Live availability', text: 'What you see is open right now, down to the hour.' },
  { icon: 'wallet', title: 'Pay only an advance', text: 'Hold a slot online and settle the rest at the venue.' },
  { icon: 'verified', title: 'Instant confirmation', text: 'No calls or waiting. You get a booking ID straight away.' },
  { icon: 'bookings', title: 'Everything in one place', text: 'Your bookings, your wallet and support, all under your account.' },
] as const;

/** The landing page: advertising banners, the kinds of venue, how booking works, and a way in for venue owners. */
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

  const shell = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10';

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className={`${shell} flex items-center gap-4 py-3`}>
          <Link href="/" aria-label="TurfX home" className="select-none whitespace-nowrap text-[1.75rem] font-black italic leading-none tracking-tight text-slate-900">
            Turf<span className="text-brand-600">X</span>
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-5 text-sm font-semibold text-slate-600 md:flex">
            <Link href="/explore" className="hover:text-brand-700">
              Explore venues
            </Link>
            <Link href="/support" className="hover:text-brand-700">
              Support
            </Link>
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------------------ Hero */}
        <section className="bg-gradient-to-b from-brand-50 to-white">
          <div className={`${shell} py-10 sm:py-16`}>
            <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Book your game, <span className="text-brand-600">in seconds.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base font-medium text-slate-600 sm:text-lg">
              Turfs, courts, pools, game rooms and activity venues near you. See live slots, reserve with a small advance and get your confirmation on WhatsApp.
            </p>
            <form onSubmit={search} role="search" className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Search venues</span>
                <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[1.125rem] text-slate-400" />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Search venues, turfs, pools, badminton, activities..."
                  className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm font-medium text-slate-800 placeholder-slate-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
                />
              </label>
              <button type="submit" className="h-12 rounded-lg bg-brand-700 px-6 text-sm font-bold text-white shadow-glow transition hover:bg-brand-800 active:scale-[0.99]">
                Find venues
              </button>
            </form>
            <p className="mt-3 text-sm text-slate-500">
              or{' '}
              <Link href="/explore" className="font-bold text-brand-700 hover:underline">
                browse every venue near you
              </Link>
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ Advertising */}
        <section aria-label="Offers" className={`${shell} pb-2`}>
          <BannerSlider />
        </section>

        {/* ----------------------------------------------------- Venue types */}
        <section className={`${shell} py-10 sm:py-14`}>
          <div className="mb-5 flex items-end justify-between gap-3">
            <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Browse by type</h2>
            <Link href="/explore" className="text-sm font-bold text-brand-700 hover:underline">
              See all venues
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {categories === null &&
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />)}
            {categories?.map((c) => (
              <Link
                key={c.slug}
                href={`/explore?type=${encodeURIComponent(c.slug)}`}
                className="group flex flex-col overflow-hidden rounded-xl border-2 border-slate-200 bg-white text-center transition hover:border-brand-500 hover:shadow-md"
              >
                <span className="relative block aspect-[4/3] w-full bg-brand-50">
                  <span className="absolute inset-0 flex items-center justify-center">
                    <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className="text-[2.5rem] text-slate-400" />
                  </span>
                  {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" />}
                </span>
                <span className="px-2 py-2.5 text-sm font-bold text-slate-800">{c.name}</span>
              </Link>
            ))}
            {categories && categories.length === 0 && <p className="col-span-full text-sm text-slate-500">Venues are being added. Check back soon.</p>}
          </div>
        </section>

        {/* ------------------------------------------------------ How it works */}
        <section className="bg-slate-50">
          <div className={`${shell} py-10 sm:py-14`}>
            <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">How it works</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-xl border border-slate-200 bg-white p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon name={s.icon} className="text-[1.375rem]" />
                  </span>
                  <h3 className="mt-3 text-base font-extrabold text-slate-900">
                    <span className="mr-1.5 text-brand-600">{i + 1}.</span>
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-600">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------------- Why */}
        <section className={`${shell} py-10 sm:py-14`}>
          <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">Why book with TurfX</h2>
          <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {REASONS.map((r) => (
              <li key={r.title} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white">
                  <Icon name={r.icon} className="text-[1.125rem]" />
                </span>
                <span>
                  <span className="block text-sm font-extrabold text-slate-900">{r.title}</span>
                  <span className="mt-0.5 block text-sm font-medium text-slate-600">{r.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------- For owners */}
        <section className={`${shell} pb-14`}>
          <div className="flex flex-col items-start justify-between gap-4 rounded-xl bg-brand-900 px-6 py-8 sm:flex-row sm:items-center sm:px-10">
            <div>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">Own a venue?</h2>
              <p className="mt-1 max-w-xl text-sm font-medium text-white/80 sm:text-base">List your turf, court or activity space on TurfX, take online bookings and see your earnings in one place.</p>
            </div>
            <a href={OWNER_PORTAL_URL} className="shrink-0 rounded-lg bg-white px-5 py-3 text-sm font-extrabold text-brand-800 transition hover:bg-brand-50">
              List your venue
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className={`${shell} flex flex-col items-start justify-between gap-3 py-6 text-sm text-slate-500 sm:flex-row sm:items-center`}>
          <span className="font-black italic text-slate-900">
            Turf<span className="text-brand-600">X</span>
          </span>
          <nav aria-label="Footer" className="flex gap-5 font-semibold">
            <Link href="/explore" className="hover:text-brand-700">
              Explore venues
            </Link>
            <Link href="/support" className="hover:text-brand-700">
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
