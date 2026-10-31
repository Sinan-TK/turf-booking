'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
}

const EVERY_MS = 5500;
/** Taller on a phone (the words need the room), wide and low on a desktop, so the banner never takes over the page. */
const SHAPE = 'aspect-[16/8] sm:aspect-[16/5] lg:aspect-[16/4.4]';

/** A link is followed only if it is a path on this site or an https address (the API refuses anything else when it is saved; checked again here). */
function safeLink(url: string | null): { href: string; external: boolean } | null {
  if (!url) return null;
  if (/^\/(?!\/)\S*$/.test(url)) return { href: url, external: false };
  if (/^https:\/\/[^\s/]+\S*$/.test(url)) return { href: url, external: true };
  return null;
}

/**
 * The advertising banners (managed by the Super Admin), as a slider: one at a time, moving on by itself while nobody is looking
 * or touching it and the person has not asked for less motion, with arrows and dots. Shows nothing at all when there are none.
 */
export function BannerSlider() {
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Banner[]>('/banners')
      .then((rows) => !cancelled && setBanners(rows))
      .catch(() => !cancelled && setBanners([]));
    setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return () => {
      cancelled = true;
    };
  }, []);

  const count = banners?.length ?? 0;
  useEffect(() => {
    if (count < 2 || held || still) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % count);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [count, held, still]);

  if (banners === null) return <Skeleton className={`${SHAPE} w-full rounded-xl`} />;
  if (count === 0) return null;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Offers and announcements"
      className="group relative overflow-hidden rounded-xl bg-brand-800 shadow-[0_18px_40px_-24px_rgba(10,46,29,0.55)]"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className={`relative ${SHAPE} w-full`} aria-live={held ? 'polite' : 'off'}>
        {banners.map((b, i) => {
          const link = safeLink(b.linkUrl);
          const body = (
            <>
              {b.imageUrl ? (
                <img src={b.imageUrl} alt="" decoding="async" loading={i === 0 ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover transition duration-[1200ms] ease-out group-hover/slide:scale-[1.03]" />
              ) : (
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
              )}
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/25 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex max-w-[85%] flex-col items-start justify-center gap-1.5 px-5 sm:max-w-[70%] sm:gap-2 sm:px-10 lg:px-14">
                <h3 className="text-balance text-xl font-black leading-tight tracking-tight text-white drop-shadow-sm sm:text-3xl lg:text-4xl">{b.title}</h3>
                {b.subtitle && <p className="text-pretty text-sm font-medium leading-snug text-white/90 sm:text-lg">{b.subtitle}</p>}
                {link && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-xs font-extrabold text-brand-800 shadow-sm transition group-hover/slide:bg-brand-50 sm:mt-2 sm:px-4 sm:py-2 sm:text-sm">
                    View offer
                    <Icon name="chevron_right" className="text-[1rem]" />
                  </span>
                )}
              </div>
            </>
          );
          const shared = {
            'aria-roledescription': 'slide',
            'aria-label': `${i + 1} of ${count}: ${b.title}`,
            'aria-hidden': i !== index,
            tabIndex: i === index ? 0 : -1,
            className: `group/slide absolute inset-0 block rounded-xl outline-none transition-opacity duration-700 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white/70 ${i === index ? 'opacity-100' : 'pointer-events-none opacity-0'}`,
          } as const;
          if (!link) return <div key={b.id} {...shared}>{body}</div>;
          return link.external ? (
            <a key={b.id} href={link.href} target="_blank" rel="noopener noreferrer sponsored" {...shared}>
              {body}
            </a>
          ) : (
            <Link key={b.id} href={link.href} {...shared}>
              {body}
            </Link>
          );
        })}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous banner"
            className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 opacity-0 shadow-md transition hover:bg-white hover:scale-105 group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Icon name="chevron_left" className="text-[1.125rem]" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next banner"
            className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 opacity-0 shadow-md transition hover:bg-white hover:scale-105 group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Icon name="chevron_right" className="text-[1.125rem]" />
          </button>
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Banner ${i + 1} of ${count}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/55 hover:bg-white/90'}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
