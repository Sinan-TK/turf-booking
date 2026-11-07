'use client';

/*
 * The landing page, kept simple: a clean header, one headline with one search, the venue types as picture cards, how booking works,
 * why Bookyo, and a way in for venue owners. Black, warm white and the logo's lime; nothing else competes with the search.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
// The sections run the full width of the page, with an even margin at each side.
const shell = 'w-full px-4 sm:px-6 lg:px-10 xl:px-14';

/** One venue type: its picture (or icon) and name, leading to its slots. */
function TypeCard({ category: c }: { category: VenueCategory }) {
  return (
    <li className="min-w-[10.5rem] flex-1 shrink-0 snap-start sm:min-w-[13rem]">
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

/** The venue types in one row that scrolls sideways (swipe, trackpad or the arrows), each card snapping into place. */
function TypeCarousel({ categories }: { categories: VenueCategory[] | null }) {
  const row = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, categories]);

  const go = (dir: -1 | 1) => row.current?.scrollBy({ left: dir * Math.max(240, Math.round(row.current.clientWidth * 0.8)), behavior: 'smooth' });
  const arrow = `absolute top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900 shadow-card transition hover:bg-brand-50 disabled:pointer-events-none disabled:opacity-0 sm:flex ${focus}`;

  return (
    <div className="relative mt-8">
      <button type="button" aria-label="Previous venue types" disabled={edge.start} onClick={() => go(-1)} className={`${arrow} -left-5`}>
        <Icon name="chevron_left" className="text-[1.375rem]" />
      </button>
      <button type="button" aria-label="Next venue types" disabled={edge.end} onClick={() => go(1)} className={`${arrow} -right-5`}>
        <Icon name="chevron_right" className="text-[1.375rem]" />
      </button>
      <ul
        ref={row}
        onScroll={measure}
        className="scrollbar-hide -mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto scroll-smooth px-4 pb-2 sm:-mx-6 sm:scroll-pl-6 sm:gap-4 sm:px-6 lg:-mx-10 lg:scroll-pl-10 lg:px-10 xl:-mx-14 xl:scroll-pl-14 xl:px-14"
      >
        {categories === null &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="min-w-[10.5rem] flex-1 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:min-w-[13rem]">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="px-4 py-3.5">
                <Skeleton className="h-5 w-2/3" />
              </div>
            </li>
          ))}
        {categories?.map((c) => <TypeCard key={c.slug} category={c} />)}
      </ul>
    </div>
  );
}

interface FeaturedVenue {
  id: string;
  name: string;
  address: string;
  area: string | null;
  facilityCode: string;
  photoUrl: string | null;
  facilities: string[];
}

/** One featured venue: its picture, name, place and the kinds of facility it has, leading to its slots. */
function FeaturedCard({ venue: v }: { venue: FeaturedVenue }) {
  return (
    <li>
      <Link
        href={`/explore?q=${encodeURIComponent(v.name)}`}
        className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card ${focus}`}
      >
        <span className="relative flex aspect-[16/10] items-center justify-center bg-brand-50 text-brand-700">
          <Icon name="stadium" className="text-[2.5rem]" />
          {v.photoUrl && <img src={v.photoUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
        </span>
        <span className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5">
          <span className="truncate text-lg font-extrabold text-slate-900">{v.name}</span>
          <span className="flex items-center gap-1.5 text-sm text-slate-600">
            <Icon name="location_on" className="shrink-0 text-[1rem] text-slate-400" />
            <span className="truncate">{v.area ? `${v.area} · ${v.address}` : v.address}</span>
          </span>
          {v.facilities.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {v.facilities.map((f) => (
                <span key={f} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                  {f}
                </span>
              ))}
            </span>
          )}
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-bold text-brand-700">
            View slots
            <Icon name="chevron_right" className="text-[1.125rem] transition group-hover:translate-x-0.5" />
          </span>
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
  // The venues the Super Admin chose to feature (none: the section is not shown).
  const [featured, setFeatured] = useState<FeaturedVenue[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<FeaturedVenue[]>('/site/featured-venues')
      .then((rows) => !cancelled && setFeatured(rows))
      .catch(() => undefined);
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
          <nav aria-label="Main" className="flex items-center gap-1 text-[0.9375rem] font-semibold text-slate-600">
            <Link href="/explore" className={`rounded-md px-3 py-1.5 transition hover:text-brand-700 ${focus}`}>
              Explore venues
            </Link>
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ----------------------------------------------------------- Hero */}
        <section className={`${shell} pb-14 pt-10 text-center sm:pb-20 sm:pt-14`}>
          <Logo hole="#FFFCF6" className="mx-auto mb-8 h-16 w-auto select-none sm:mb-10 sm:h-24" />
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
          <TypeCarousel categories={categories} />
          {categories && categories.length === 0 && <p className="mt-8 text-base text-slate-600">Venues are being added. Check back soon.</p>}
        </section>

        {/* ------------------------------------------------- Featured venues */}
        {featured.length > 0 && (
          <section aria-labelledby="featured-heading" className={`${shell} pb-16 sm:pb-24`}>
            <h2 id="featured-heading" className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Featured venues
            </h2>
            <p className="mt-1.5 text-base text-slate-600">Popular places to play, picked for you.</p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {featured.map((v) => (
                <FeaturedCard key={v.id} venue={v} />
              ))}
            </ul>
          </section>
        )}

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

      <SiteFooter wide />
    </div>
  );
}
