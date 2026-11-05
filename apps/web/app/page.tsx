'use client';

/*
 * THESIS: the landing page is a departures board for game time: venue types listed like departures, a live clock, one search.
 *   It refuses the category default of a green gradient hero over rounded white cards.
 * OWN-WORLD: black flap panels split across the middle, lit yellow condensed capitals, a concrete-grey ground, one yellow band.
 * STORY: a group organiser sees what can be booked, searches or taps a venue type, and lands on live slots in /explore.
 * FIRST VIEWPORT: black board; headline and search on the left, the "Browse by type" board with a flipping clock on the right
 *   (stacked on phones, search first). The primary action is Find venues.
 * FORM: split-flap departures board, grounded list position 6, seed 6eaf877a.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { VenueCategory } from '@/lib/categories';
import { AccountMenu } from '@/components/account-menu';
import { BannerSlider } from '@/components/banner-slider';
import { CategoryIcon, Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { OWNER_PORTAL_URL } from '@/lib/legal';
import { SiteFooter } from '@/components/site-footer';
import { barlow, barlowCondensed } from './landing-fonts';
import { Logo } from '@/components/logo';
import s from './landing.module.css';

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

/** Keyboard focus on the board: a lit ring. */
const focusDark = 'outline-none focus-visible:ring-2 focus-visible:ring-[#ffcc1a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f0e]';

/** Characters on flaps; a character that changes turns over (it is keyed by its value, so a new one mounts and flips). */
function Flaps({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className="inline-flex gap-[3px]">
      {text.split('').map((ch, i) =>
        ch === ':' || ch === ' ' ? (
          <span key={`${i}-sep`} className="inline-flex w-[0.45em] items-center justify-center text-[#ffcc1a]">
            {ch}
          </span>
        ) : (
          <span key={`${i}-${ch}`} className={`${s.flap} ${className}`}>
            <span className={s.flipChar}>{ch}</span>
          </span>
        ),
      )}
    </span>
  );
}

/** The board's clock: the visitor's own time, turning over each minute. Drawn only in the browser (the server cannot know it). */
function BoardClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = now ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '--:--';
  const day = now ? now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase() : '';
  return (
    <span className="flex items-center gap-3">
      <span className="sr-only">Time now</span>
      <Flaps text={time} className="h-8 w-6 text-lg font-bold sm:h-9 sm:w-7 sm:text-xl" />
      <span aria-hidden="true" className={`${s.display} text-sm font-bold tracking-wide text-white/55`}>
        {day}
      </span>
    </span>
  );
}

/** The kinds of venue as departures: picture or icon, name in lit capitals, and the way to its slots. */
function TypeBoard({ categories }: { categories: VenueCategory[] | null }) {
  return (
    <section aria-labelledby="types-heading" className={`${s.rise} overflow-hidden rounded-md bg-[#161615] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10`} style={{ '--d': '120ms' } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 id="types-heading" className={`${s.display} text-xl text-[#ffcc1a] sm:text-2xl`}>
          Browse by type
        </h2>
        <BoardClock />
      </div>
      <div aria-hidden="true" className={`${s.display} grid grid-cols-[3rem_1fr_auto] gap-3 px-4 pb-1 pt-2.5 text-[0.75rem] font-bold tracking-[0.08em] text-white/45 sm:px-5`}>
        <span />
        <span>Venue</span>
        <span>Slots</span>
      </div>
      <ul className="max-h-[26rem] overflow-y-auto px-2 pb-2 sm:px-3">
        {categories === null &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="px-2 py-1.5">
              <Skeleton className="h-12 w-full rounded-md !bg-white/10" />
            </li>
          ))}
        {categories?.map((c, i) => (
          <li key={c.slug} className={s.row} style={{ '--d': `${200 + i * 70}ms` } as React.CSSProperties}>
            <Link
              href={`/explore?type=${encodeURIComponent(c.slug)}`}
              className={`group grid grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.06] ${focusDark}`}
            >
              <span className={`${s.tile} relative h-12 w-12 text-white/80`}>
                <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className="text-[1.5rem]" />
                {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />}
              </span>
              <span className={`${s.display} truncate text-[1.375rem] leading-none text-white transition-colors group-hover:text-[#ffcc1a] sm:text-[1.625rem]`}>{c.name}</span>
              <span className={`${s.display} inline-flex items-center gap-1 rounded-sm bg-[#ffcc1a] px-2.5 py-1.5 text-[0.9375rem] leading-none text-[#0f0f0e] transition group-hover:bg-white`}>
                See
                <Icon name="chevron_right" className="text-[1rem]" />
              </span>
            </Link>
          </li>
        ))}
        {categories && categories.length === 0 && <li className="px-3 py-6 text-sm text-white/70">Venues are being added. Check back soon.</li>}
      </ul>
    </section>
  );
}

/** The landing page: the board (search and venue types), advertising banners, how booking works, and a way in for venue owners. */
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
  const sectionTitle = `${s.display} text-balance text-[2.25rem] leading-[0.95] sm:text-5xl`;

  return (
    <div className={`${barlow.variable} ${barlowCondensed.variable} ${s.page} flex min-h-screen flex-col`}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0f0f0e]">
        <div className={`${shell} flex items-center gap-4 py-3`}>
          <Link href="/" aria-label="TurfX home" className={`flex select-none items-center gap-1 rounded-sm ${focusDark}`}>
            <Logo ink="#fff" hole="#0f0f0e" className="h-9 w-auto" />
          </Link>
          <nav aria-label="Main" className={`${s.display} ml-4 hidden items-center gap-1 text-lg font-bold text-white/70 md:flex`}>
            <Link href="/explore" className={`rounded-sm px-3 py-1.5 transition-colors hover:text-[#ffcc1a] ${focusDark}`}>
              Explore venues
            </Link>
            <Link href="/support" className={`rounded-sm px-3 py-1.5 transition-colors hover:text-[#ffcc1a] ${focusDark}`}>
              Support
            </Link>
          </nav>
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------------------------------------------------ The board */}
        <section className={`relative overflow-hidden bg-[#0f0f0e] text-white ${s.boardGrid}`}>
          <div className={`${shell} grid items-start gap-10 pb-14 pt-10 sm:pb-20 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:pb-24 lg:pt-20`}>
            <div className="lg:pt-4">
              <h1 className={`${s.display} ${s.rise} text-balance text-[3.25rem] leading-[0.88] sm:text-7xl lg:text-[6rem]`}>
                Book your game, <span className="text-[#ffcc1a]">in seconds.</span>
              </h1>
              <p className={`${s.rise} mt-6 max-w-[34rem] text-pretty text-[1.0625rem] leading-relaxed text-white/75 sm:text-lg`} style={{ '--d': '80ms' } as React.CSSProperties}>
                Turfs, courts, pools, game rooms and activity venues near you. See which slots are free right now, pay a small advance and
                get your booking ID straight away.
              </p>

              <form onSubmit={search} role="search" className={`${s.rise} mt-8 flex max-w-[36rem] flex-col gap-2 sm:flex-row`} style={{ '--d': '160ms' } as React.CSSProperties}>
                <label className="relative flex-1">
                  <span className="sr-only">Search venues</span>
                  <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.25rem] text-white/50" />
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Search venues, turfs, pools, badminton..."
                    className={`${s.search} h-14 w-full rounded-md border border-white/15 bg-[#1c1c1b] pl-12 pr-4 text-base font-medium text-white placeholder-white/45 transition-colors focus:border-[#ffcc1a] focus:outline-none`}
                  />
                </label>
                <button
                  type="submit"
                  className={`${s.display} h-14 rounded-md bg-[#ffcc1a] px-7 text-xl text-[#0f0f0e] transition hover:bg-white active:scale-[0.98] ${focusDark}`}
                >
                  Find venues
                </button>
              </form>
            </div>

            <TypeBoard categories={categories} />
          </div>
        </section>

        {/* ------------------------------------------------------ Advertising */}
        <section aria-label="Offers" className={`${shell} pt-10 sm:pt-14`}>
          <BannerSlider />
        </section>

        {/* ------------------------------------------------------ How it works */}
        <section className={`${shell} py-16 sm:py-24`}>
          <h2 className={sectionTitle}>How it works</h2>
          <ol className="mt-10 grid border-t-2 border-[#0f0f0e] md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-5 border-b border-[#cfcfc8] py-7 md:flex-col md:gap-6 md:border-b-0 md:border-r md:px-7 md:py-9 md:first:pl-0 md:last:border-r-0">
                <span aria-hidden="true" className={`${s.flap} ${s.display} h-16 w-12 shrink-0 text-[2.5rem] leading-none`}>
                  {i + 1}
                </span>
                <span>
                  <span className={`${s.display} block text-[1.75rem] leading-none`}>{step.title}</span>
                  <span className="mt-2.5 block max-w-xs text-pretty text-base leading-relaxed text-[#55554f]">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* -------------------------------------------------------------- Why */}
        <section className="bg-[#0f0f0e] text-white">
          <div className={`${shell} grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16`}>
            <div>
              <h2 className={`${sectionTitle} text-white`}>
                Why book with <span className="text-[#ffcc1a]">TurfX</span>
              </h2>
              <p className="mt-4 max-w-md text-pretty text-[1.0625rem] leading-relaxed text-white/70">Less chasing, more playing. Everything you need to get a slot sorted in a minute.</p>
            </div>
            <ul className="border-t border-white/15">
              {REASONS.map((r) => (
                <li key={r.title} className="grid grid-cols-[2.75rem_1fr] items-start gap-4 border-b border-white/15 py-5 sm:grid-cols-[2.75rem_16rem_1fr] sm:items-center">
                  <span className={`${s.flap} h-11 w-11 text-[1.25rem]`}>
                    <Icon name={r.icon} />
                  </span>
                  <span className={`${s.display} text-[1.5rem] leading-none text-[#ffcc1a]`}>{r.title}</span>
                  <span className="col-start-2 text-pretty text-base leading-relaxed text-white/75 sm:col-start-3">{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------- For owners */}
        <section className="bg-[#ffcc1a] text-[#0f0f0e]">
          <div className={`${shell} flex flex-col items-start justify-between gap-7 py-14 sm:flex-row sm:items-center sm:py-16`}>
            <div>
              <h2 className={`${s.display} text-balance text-[2.5rem] leading-[0.95] sm:text-6xl`}>Own a venue?</h2>
              <p className="mt-3 max-w-xl text-pretty text-[1.0625rem] font-medium leading-relaxed text-[#0f0f0e]/80">
                List your turf, court or activity space on TurfX, take online bookings and see your earnings in one place.
              </p>
            </div>
            <a
              href={`${OWNER_PORTAL_URL}/register`}
              className={`${s.display} inline-flex shrink-0 items-center gap-2 rounded-md bg-[#0f0f0e] px-7 py-4 text-xl text-white transition hover:bg-[#2a2a28] active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[#0f0f0e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#ffcc1a]`}
            >
              List your venue
              <Icon name="chevron_right" className="text-[1.25rem] text-[#ffcc1a]" />
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
