'use client';

import { useEffect, useState } from 'react';
import { CategoryIcon } from '@/components/ui';
import { VenueTypesIcon } from '@/components/venue-types-icon';

interface TypeIcon {
  slug: string;
  iconKey: string;
  iconSvg?: string | null;
}

const EVERY_MS = 1600;

/**
 * The Venue types button's icon: the facilities' own icons stacked in one spot, fading in and out one after another (football, pool,
 * kayaking...), so it says "all kinds of venues" without a word. Stops moving for people who ask for less motion and while the tab
 * is in the background, and falls back to the plain mark until the facilities have loaded.
 */
export function RotatingTypeIcon({ types, className = '' }: { types: TypeIcon[]; className?: string }) {
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (still || types.length < 2) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => i + 1);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [still, types.length]);

  if (types.length === 0) return <VenueTypesIcon className={className} />;
  const current = index % types.length;
  return (
    <span aria-hidden="true" className={`relative inline-block h-[1em] w-[1em] shrink-0 align-middle ${className}`}>
      {types.map((t, i) => (
        <span
          key={t.slug}
          className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ease-out ${
            i === current ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
          }`}
        >
          <CategoryIcon iconKey={t.iconKey} iconSvg={t.iconSvg} />
        </span>
      ))}
    </span>
  );
}
