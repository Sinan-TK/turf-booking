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
import { FadeImage } from '@/components/fade-image';
import { Skeleton } from '@/components/skeleton';
import { OWNER_PORTAL_URL } from '@/lib/legal';
import { SiteFooter } from '@/components/site-footer';
import { Logo } from '@/components/logo';

// Each step has its own colour, so the three read as a path from first to last: light, dark, then the brand lime.
const STEPS = [
  { title: 'Find a venue', icon: 'search', text: 'Search by area or pick a type: turfs, courts, pools, game rooms and more.', card: 'bg-white text-slate-900 border-slate-200', body: 'text-slate-600', badge: 'bg-brand-400 text-brand-700', ghost: '#cbd5e1' },
  { title: 'Pick a time', icon: 'schedule', text: 'See which slots are free right now and choose the length that suits you.', card: 'bg-brand-700 text-white border-brand-700', body: 'text-white/75', badge: 'bg-brand-400 text-brand-700', ghost: 'rgba(255,255,255,0.28)' },
  { title: 'Book and play', icon: 'verified', text: 'Reserve with a small advance online and get your booking ID straight away.', card: 'bg-brand-400 text-brand-700 border-brand-400', body: 'text-brand-700/80', badge: 'bg-brand-700 text-brand-400', ghost: 'rgba(5,5,5,0.3)' },
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
          {c.imageUrl && <FadeImage src={c.imageUrl} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
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
  /** Every picture the venue has (none: the facility icon is shown instead). */
  photoUrls: string[];
  icon: { iconKey: string; iconSvg: string | null } | null;
  facilities: string[];
}

/** How long each of a venue's pictures stays before the card turns to the next. */
const PHOTO_MS = 3000;

/**
 * The card's picture area. The facility's icon is what shows whenever there is no picture to show yet: when the venue has none, while a
 * picture is still loading, and if it fails to load; a picture fades in over it once it has arrived. With several pictures they fade from
 * one to the next on their own (only onto ones that have loaded; paused while the card is hovered or focused, and not at all for people
 * who ask for less motion), with small dots showing which one it is.
 */
function CardPhotos({ photos, icon, name }: { photos: string[]; icon: FeaturedVenue['icon']; name: string }) {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  // Which pictures have arrived (a picture that fails never does, so the icon stays).
  const [ready, setReady] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  const arrived = (src: string) => setReady((cur) => (cur[src] ? cur : { ...cur, [src]: true }));
  useEffect(() => {
    if (photos.length < 2 || paused || still) return;
    const timer = setInterval(() => {
      setAt((i) => {
        for (let step = 1; step < photos.length; step++) {
          const next = (i + step) % photos.length;
          if (ready[photos[next]!]) return next;
        }
        return i;
      });
    }, PHOTO_MS);
    return () => clearInterval(timer);
  }, [photos, paused, still, ready]);

  const showing = photos[at] !== undefined && ready[photos[at]!] === true;

  return (
    <span
      className="absolute inset-0 block"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 ${showing ? 'opacity-0' : 'opacity-100'}`}>
        <CategoryIcon iconKey={icon?.iconKey ?? 'stadium'} iconSvg={icon?.iconSvg} className="text-[4rem]" />
      </span>
      {photos.map((src, i) => (
        <img
          key={src}
          // A picture that was already in the browser's cache can finish before React listens for it.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) arrived(src);
          }}
          src={src}
          alt=""
          aria-hidden={i !== at}
          loading={i === 0 ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => arrived(src)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 group-hover:scale-105 ${i === at && ready[src] ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
      {showing && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />}
      {photos.length > 1 && (
        <span role="img" aria-label={`${name}: picture ${at + 1} of ${photos.length}`} className="absolute right-3 top-4 flex gap-1.5">
          {photos.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full bg-white shadow transition-all duration-300 ${i === at ? 'w-4 opacity-100' : 'w-1.5 opacity-60'}`} />
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * One featured venue: a big picture with its kinds of facility on it, the name and place, and a Book now row. The whole card opens the
 * venue's page ("any" picks the venue's first unit, the same way the saved venues do), where the day and slots are chosen.
 */
function FeaturedCard({ venue: v }: { venue: FeaturedVenue }) {
  return (
    <li>
      <Link
        href={`/book/${encodeURIComponent(v.facilityCode)}/any`}
        aria-label={`${v.name}: view the venue and book`}
        className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-subtle transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-card ${focus}`}
      >
        <span className="relative block aspect-[4/3] overflow-hidden bg-brand-50 text-brand-700">
          <CardPhotos photos={v.photoUrls} icon={v.icon} name={v.name} />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-400 px-2.5 py-1 text-xs font-extrabold text-brand-700 shadow-sm">
            <Icon name="verified" className="text-[0.875rem]" />
            Featured
          </span>
          {v.facilities.length > 0 && (
            <span className="absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5">
              {v.facilities.map((f) => (
                <span key={f} className="rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-slate-900 shadow-sm backdrop-blur">
                  {f}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="flex flex-1 flex-col px-5 pb-5 pt-4">
          <span className="truncate text-xl font-black tracking-tight text-slate-900">{v.name}</span>
          <span className="mt-1.5 flex items-start gap-1.5 text-sm leading-snug text-slate-600">
            <Icon name="location_on" className="mt-px shrink-0 text-[1rem] text-slate-400" />
            <span className="line-clamp-2">{v.area ? `${v.area} · ${v.address}` : v.address}</span>
          </span>
          <span className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm font-extrabold text-slate-900">Book now</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-700 text-white transition group-hover:bg-brand-400 group-hover:text-brand-700">
              <Icon name="chevron_right" className="text-[1.25rem] transition group-hover:translate-x-0.5" />
            </span>
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
            {[
              ['#types', 'Venue types'],
              ['#how-it-works', 'How it works'],
              ['#for-owners', 'For owners'],
            ].map(([href, label]) => (
              <a key={href} href={href} className={`rounded-md px-3 py-1.5 transition hover:text-brand-700 ${focus}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ----------------------------------------------------------- Hero */}
        <section className={`${shell} pb-14 pt-10 text-center sm:pb-20 sm:pt-14`}>
          <Logo hole="#FFFCF6" className="logo-pop mx-auto mb-8 h-24 w-auto select-none sm:mb-10 sm:h-32 lg:h-40" />
          <h1 style={{ '--d': '250ms' } as React.CSSProperties} className="landing-rise mx-auto max-w-3xl text-balance text-[2.75rem] font-black leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            Book your game, <span className="rounded-md bg-brand-400 px-2 [box-decoration-break:clone]">in seconds.</span>
          </h1>
          <p style={{ '--d': '400ms' } as React.CSSProperties} className="landing-rise mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-slate-600">
            Turfs, courts, pools, game rooms and activity venues near you. See which slots are free right now and book in a minute.
          </p>

          <form
            onSubmit={search}
            role="search"
            style={{ '--d': '550ms' } as React.CSSProperties}
            className="landing-rise mx-auto mt-9 flex max-w-2xl flex-col gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_-18px_rgba(5,5,5,0.25)] transition focus-within:border-brand-700 sm:flex-row sm:rounded-full"
          >
            <label className="relative flex-1">
              <span className="sr-only">Search venues</span>
              <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-slate-400" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search venues, turfs, pools, badminton..."
                className="h-14 w-full rounded-full bg-transparent pl-12 pr-4 text-base font-medium text-slate-900 placeholder-slate-400 outline-none"
              />
            </label>
            <button
              type="submit"
              className={`inline-flex h-14 items-center justify-center gap-2 rounded-full bg-brand-700 px-8 text-base font-extrabold text-white transition hover:bg-brand-600 active:scale-[0.98] ${focus}`}
            >
              Find venues
              <Icon name="chevron_right" className="text-[1.125rem] text-brand-400" />
            </button>
          </form>

          <ul style={{ '--d': '700ms' } as React.CSSProperties} className="landing-rise mt-6 flex flex-wrap items-center justify-center gap-2.5 text-sm font-bold text-slate-700">
            {['Live availability', 'Pay only a small advance', 'Instant booking ID'].map((t) => (
              <li key={t} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-4 shadow-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-400 text-[0.9rem] text-brand-700">
                  <Icon name="check" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------- Venue types */}
        <section id="types" aria-labelledby="types-heading" className={`${shell} scroll-mt-20 pb-16 sm:pb-24`}>
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="featured-heading" className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  Featured venues
                </h2>
                <p className="mt-1.5 text-base text-slate-600">Popular places to play, picked for you. Tap one to see its open slots.</p>
              </div>
              <Link href="/explore" className={`inline-flex items-center gap-1 rounded-md text-[0.9375rem] font-bold text-brand-700 hover:underline ${focus}`}>
                See all venues
                <Icon name="chevron_right" className="text-[1.125rem]" />
              </Link>
            </div>
            <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]">
              {featured.map((v) => (
                <FeaturedCard key={v.id} venue={v} />
              ))}
            </ul>
          </section>
        )}

        {/* -------------------------------------------------- How it works */}
        <section id="how-it-works" className={`${shell} scroll-mt-20 py-16 sm:py-20`}>
          <h2 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">How it works</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-base text-slate-600">Three taps from searching to a confirmed slot.</p>
          <ol className="mt-10 grid gap-5 md:grid-cols-3 md:gap-6">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className={`group relative flex min-h-[15rem] flex-col overflow-hidden rounded-3xl border p-7 transition duration-300 hover:-translate-y-1 hover:shadow-card ${step.card} ${i === 1 ? 'md:translate-y-5 md:hover:translate-y-4' : ''}`}
              >
                {/* The step number, drawn large and hollow behind the words. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-6 -right-2 select-none text-[9rem] font-black leading-none transition duration-300 group-hover:-translate-y-1 group-hover:scale-105"
                  style={{ color: 'transparent', WebkitTextStroke: `2px ${step.ghost}` }}
                >
                  {i + 1}
                </span>
                <span className={`relative flex h-12 w-12 items-center justify-center rounded-2xl text-2xl ${step.badge}`}>
                  <Icon name={step.icon} />
                </span>
                <p className="relative mt-5 text-xs font-extrabold uppercase tracking-widest opacity-60">Step {i + 1}</p>
                <h3 className="relative mt-1 text-2xl font-black tracking-tight">{step.title}</h3>
                <p className={`relative mt-2 max-w-[17rem] text-pretty text-base leading-relaxed ${step.body}`}>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------------- For owners */}
        <section id="for-owners" className={`${shell} scroll-mt-20 pb-16 sm:pb-24`}>
          <div className="relative isolate overflow-hidden rounded-[2rem] bg-brand-700 px-6 py-10 text-white sm:px-10 sm:py-14 lg:px-14">
            {/* Soft lime glows and a faint dot grid give the dark card depth without noise. */}
            <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 -z-10 h-80 w-80 rounded-full bg-brand-400/25 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 -z-10 h-72 w-72 rounded-full bg-brand-400/10 blur-3xl" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 opacity-[0.12]"
              style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'linear-gradient(90deg, transparent, #000 85%)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 85%)' }}
            />

            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-widest text-brand-400 ring-1 ring-white/15">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  For venue owners
                </span>
                <h2 className="mt-5 text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
                  Own a venue? <span className="text-brand-400">Fill every slot.</span>
                </h2>
                <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-white/70 sm:text-lg">
                  List your turf, court or activity space on Bookyo, take online bookings and see your earnings in one place.
                </p>
                <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2.5 text-[0.9375rem] font-semibold text-white/90">
                  {['Online bookings, day and night', 'An advance paid up front', 'Earnings and payouts in one view'].map((perk) => (
                    <li key={perk} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-400 text-[0.8rem] text-brand-700">
                        <Icon name="check" />
                      </span>
                      {perk}
                    </li>
                  ))}
                </ul>
                <a
                  href={`${OWNER_PORTAL_URL}/register`}
                  className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-400 px-7 py-4 text-base font-extrabold text-brand-700 shadow-[0_10px_30px_-10px_rgba(165,245,43,0.7)] outline-none transition hover:bg-white focus-visible:ring-4 focus-visible:ring-white/40 active:scale-[0.98]"
                >
                  List your venue
                  <Icon name="chevron_right" className="text-[1.125rem] transition group-hover:translate-x-1" />
                </a>
              </div>

              {/* A made-up booking card, only to show what the owner's day looks like. */}
              <div aria-hidden="true" className="relative mx-auto hidden h-72 w-full max-w-md sm:block">
                <div style={{ '--r': '-3deg', '--d': '0ms' } as React.CSSProperties} className="float-soft absolute left-0 top-4 w-72 rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-widest text-slate-500">New booking</span>
                    <span className="rounded-full bg-brand-400 px-2.5 py-0.5 text-xs font-extrabold text-brand-700">Confirmed</span>
                  </div>
                  <p className="mt-3 text-xl font-black">Turf A · 7:00 PM</p>
                  <p className="text-sm font-medium text-slate-500">1 hour · advance paid online</p>
                  <div className="mt-4 flex gap-1.5">
                    {[40, 65, 50, 85, 70, 95, 60].map((h, i) => (
                      <span key={i} className="flex h-12 flex-1 items-end rounded-md bg-slate-100">
                        <span className="w-full rounded-md bg-brand-700" style={{ height: `${h}%` }} />
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ '--r': '4deg', '--d': '900ms' } as React.CSSProperties} className="float-soft absolute bottom-0 right-0 w-56 rounded-2xl bg-brand-400 p-5 text-brand-700 shadow-2xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-xl text-brand-400">
                    <Icon name="wallet" />
                  </span>
                  <p className="mt-3 text-xs font-extrabold uppercase tracking-widest opacity-70">This week</p>
                  <p className="text-2xl font-black">Payout on its way</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter wide />
    </div>
  );
}
