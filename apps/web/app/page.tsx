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
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

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

/** Keyboard focus that is as visible here as the rest of the site's controls. */
const focus = 'outline-none focus-visible:ring-4 focus-visible:ring-brand-600/25';

/** A facility's tile: its picture, or its icon on a soft field until (and unless) it has one. */
function TypeArt({ c, iconSize }: { c: VenueCategory; iconSize: string }) {
  return (
    <>
      <span className="absolute inset-0 flex items-center justify-center">
        <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className={`${iconSize} text-brand-700/50`} />
      </span>
      {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
    </>
  );
}

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
  const sectionTitle = 'text-balance text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-3xl';
  const mosaic = (categories ?? []).slice(0, 4);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className={`${shell} flex items-center gap-4 py-3`}>
          <Link href="/" aria-label="TurfX home" className={`select-none whitespace-nowrap rounded-md text-[1.75rem] font-black italic leading-none tracking-tight text-slate-900 ${focus}`}>
            Turf<span className="text-brand-600">X</span>
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 text-sm font-bold text-slate-600 md:flex">
            <Link href="/explore" className={`rounded-md px-3 py-2 transition hover:bg-slate-100 hover:text-brand-700 ${focus}`}>
              Explore venues
            </Link>
            <Link href="/support" className={`rounded-md px-3 py-2 transition hover:bg-slate-100 hover:text-brand-700 ${focus}`}>
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
        <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-brand-50/60 to-white">
          <div className={`${shell} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:py-20`}>
            <div>
              <h1 className="landing-rise text-balance text-[2.5rem] font-black leading-[1.02] tracking-tight text-slate-900 sm:text-6xl lg:text-[4.25rem]">
                Book your game, <span className="text-brand-600">in seconds.</span>
              </h1>
              <p className="landing-rise mt-4 max-w-xl text-pretty text-base font-medium leading-relaxed text-slate-600 sm:text-lg" style={{ '--d': '90ms' } as React.CSSProperties}>
                Turfs, courts, pools, game rooms and activity venues near you. See live slots, reserve with a small advance and get your confirmation on WhatsApp.
              </p>

              <form onSubmit={search} role="search" className="landing-rise mt-7 flex max-w-xl flex-col gap-2.5 sm:flex-row" style={{ '--d': '180ms' } as React.CSSProperties}>
                <label className="relative flex-1">
                  <span className="sr-only">Search venues</span>
                  <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-slate-400" />
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Search venues, turfs, pools, badminton..."
                    className="h-14 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-base font-medium text-slate-800 shadow-sm placeholder-slate-400 transition focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15"
                  />
                </label>
                <button
                  type="submit"
                  className={`h-14 rounded-xl bg-brand-700 px-7 text-base font-extrabold text-white shadow-glow transition hover:bg-brand-800 active:scale-[0.98] ${focus}`}
                >
                  Find venues
                </button>
              </form>

              {/* Straight to a kind of venue. */}
              <div className="landing-rise mt-5 flex max-w-2xl flex-wrap items-center gap-2" style={{ '--d': '260ms' } as React.CSSProperties}>
                {categories === null && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-28 rounded-lg" />)}
                {categories?.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/explore?type=${encodeURIComponent(c.slug)}`}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-3 text-sm font-bold text-slate-700 transition hover:border-brand-500 hover:bg-white hover:text-brand-800 ${focus}`}
                  >
                    <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className="text-[1.0625rem] text-brand-700" />
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>

            {/* The kinds of venue, as a mosaic (wide screens only). */}
            {mosaic.length > 0 && (
              <div aria-hidden="true" className="landing-rise hidden grid-cols-2 gap-4 lg:grid" style={{ '--d': '200ms' } as React.CSSProperties}>
                {mosaic.map((c, i) => (
                  <div key={c.slug} className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 border-white bg-brand-100 shadow-[0_18px_40px_-18px_rgba(10,46,29,0.45)] ${i % 2 === 1 ? 'translate-y-8' : ''}`}>
                    <TypeArt c={c} iconSize="text-[4.5rem]" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-950/80 via-brand-950/35 to-transparent px-3.5 pb-3 pt-12 text-sm font-extrabold text-white">{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------ Advertising */}
        <section aria-label="Offers" className={`${shell} pt-2 sm:pt-4`}>
          <BannerSlider />
        </section>

        {/* ----------------------------------------------------- Venue types */}
        <section className={`${shell} py-14 sm:py-20`}>
          <div className="mb-7 flex items-end justify-between gap-3">
            <h2 className={sectionTitle}>Browse by type</h2>
            <Link href="/explore" className={`inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-extrabold text-brand-700 hover:underline ${focus}`}>
              See all venues
              <Icon name="chevron_right" className="text-[1rem]" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
            {categories === null && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />)}
            {categories?.map((c) => (
              <Link
                key={c.slug}
                href={`/explore?type=${encodeURIComponent(c.slug)}`}
                className={`group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition duration-300 hover:-translate-y-1 hover:border-brand-500 hover:shadow-[0_16px_32px_-16px_rgba(10,46,29,0.4)] ${focus}`}
              >
                <span className="relative block aspect-[4/3] w-full overflow-hidden bg-brand-50">
                  <span className="absolute inset-0 transition duration-500 group-hover:scale-105">
                    <TypeArt c={c} iconSize="text-[3rem]" />
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 px-3.5 py-3 text-[0.9375rem] font-extrabold text-slate-900">
                  {c.name}
                  <Icon name="chevron_right" className="text-[1rem] text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </span>
              </Link>
            ))}
            {categories && categories.length === 0 && <p className="col-span-full text-sm text-slate-500">Venues are being added. Check back soon.</p>}
          </div>
        </section>

        {/* ------------------------------------------------------ How it works */}
        <section className="bg-slate-50">
          <div className={`${shell} py-14 sm:py-20`}>
            <h2 className={sectionTitle}>How it works</h2>
            {/* One line from first step to last, not three boxes. */}
            <ol className="relative mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
              <span aria-hidden="true" className="absolute left-[1.375rem] top-3 hidden h-px w-[calc(100%-3rem)] bg-gradient-to-r from-brand-300 via-brand-200 to-transparent md:block" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 md:block">
                  <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white shadow-[0_8px_18px_-8px_rgba(12,90,68,0.7)] ring-4 ring-slate-50">
                    <Icon name={s.icon} className="text-[1.25rem]" />
                  </span>
                  <span className="block md:mt-5">
                    <span className="block text-lg font-black tracking-tight text-slate-900">
                      <span className="mr-1.5 text-brand-600">{i + 1}.</span>
                      {s.title}
                    </span>
                    <span className="mt-1 block max-w-xs text-pretty text-[0.9375rem] font-medium leading-relaxed text-slate-600">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* -------------------------------------------------------------- Why */}
        <section className={`${shell} grid gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16`}>
          <div>
            <h2 className={sectionTitle}>Why book with TurfX</h2>
            <p className="mt-3 max-w-md text-pretty text-base font-medium leading-relaxed text-slate-600">Less chasing, more playing. Everything you need to get a slot sorted in a minute.</p>
          </div>
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {REASONS.map((r) => (
              <li key={r.title} className="flex gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Icon name={r.icon} className="text-[1.25rem]" />
                </span>
                <span>
                  <span className="block text-base font-extrabold text-slate-900">{r.title}</span>
                  <span className="mt-0.5 block text-pretty text-[0.9375rem] font-medium leading-relaxed text-slate-600">{r.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------- For owners */}
        <section className={`${shell} pb-16 sm:pb-24`}>
          <div className="relative overflow-hidden rounded-xl bg-brand-900 px-6 py-10 sm:px-12 sm:py-12">
            <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[28px] border-white/[0.04]" />
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-32 right-24 h-64 w-64 rounded-full border-[22px] border-white/[0.04]" />
            <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-balance text-2xl font-black tracking-tight text-white sm:text-3xl">Own a venue?</h2>
                <p className="mt-2 max-w-xl text-pretty text-base font-medium leading-relaxed text-white/80">
                  List your turf, court or activity space on TurfX, take online bookings and see your earnings in one place.
                </p>
              </div>
              <a
                href={OWNER_PORTAL_URL}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-extrabold text-brand-800 transition hover:bg-brand-50 active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:outline-none`}
              >
                List your venue
                <Icon name="chevron_right" className="text-[1.125rem]" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className={`${shell} flex flex-col gap-5 py-8 text-sm text-slate-500`}>
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <span className="text-lg font-black italic text-slate-900">
              Turf<span className="text-brand-600">X</span>
            </span>
            <nav aria-label="Footer" className="flex gap-5 font-bold">
              <Link href="/explore" className={`rounded-md hover:text-brand-700 ${focus}`}>
                Explore venues
              </Link>
              <Link href="/support" className={`rounded-md hover:text-brand-700 ${focus}`}>
                Support
              </Link>
            </nav>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
              {LEGAL_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={`rounded-md hover:text-brand-700 ${focus}`}>
                  {l.label}
                </Link>
              ))}
            </nav>
            <p>&copy; {new Date().getFullYear()} {LEGAL.operator}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
