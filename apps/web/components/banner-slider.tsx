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

  if (banners === null) return <Skeleton className="aspect-[16/5] w-full rounded-xl" />;
  if (count === 0) return null;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Offers and announcements"
      className="group relative overflow-hidden rounded-xl bg-brand-800"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="relative aspect-[16/5] w-full" aria-live={held ? 'polite' : 'off'}>
        {banners.map((b, i) => {
          const link = safeLink(b.linkUrl);
          const body = (
            <>
              {b.imageUrl ? (
                <img src={b.imageUrl} alt="" decoding="async" loading={i === 0 ? 'eager' : 'lazy'} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900" />
              )}
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex max-w-[80%] flex-col justify-center gap-1 px-5 sm:px-10">
                <h3 className="text-lg font-black leading-tight tracking-tight text-white sm:text-3xl">{b.title}</h3>
                {b.subtitle && <p className="text-xs font-medium text-white/90 sm:text-base">{b.subtitle}</p>}
              </div>
            </>
          );
          const shared = {
            'aria-roledescription': 'slide',
            'aria-label': `${i + 1} of ${count}: ${b.title}`,
            'aria-hidden': i !== index,
            tabIndex: i === index ? 0 : -1,
            className: `absolute inset-0 block transition-opacity duration-500 ${i === index ? 'opacity-100' : 'pointer-events-none opacity-0'}`,
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
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Icon name="chevron_left" className="text-[1.125rem]" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next banner"
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
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
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
