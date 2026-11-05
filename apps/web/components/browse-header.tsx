'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { placeLabel, placeLines, useLocationChoice, type LocationChoice } from '@/lib/location';
import type { VenueCategory } from '@/lib/categories';
import { AccountMenu } from '@/components/account-menu';
import { Icon } from '@/components/ui';
import { LocationPicker, warmPlaces } from '@/components/location-picker';
import { VenueTypePicker } from '@/components/venue-type-picker';
import { RotatingTypeIcon } from '@/components/rotating-type-icon';
import { BackButton } from '@/components/back-button';

/**
 * The listing's header for the pages that sit beside it (a venue's booking page): the logo, the place, the search and the
 * venue types, with the account on the right. A search or a venue-type choice goes to the listing, which shows the results;
 * a new place is saved and used by the listing. With phoneBack, a phone shows just a back button and the account.
 */
export function BrowseHeader({ phoneBack = false }: { phoneBack?: boolean }) {
  // On a phone this header can be only a back button and the account (the place and search are left to the listing).
  const wide = phoneBack ? 'hidden md:flex' : 'flex';
  const router = useRouter();
  const { choice, setChoice } = useLocationChoice();
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => warmPlaces(), []); // the places are fetched ahead, so the picker opens already filled
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.get<VenueCategory[]>('/categories?available=true').then(setCategories).catch(() => undefined);
  }, []);

  const locationLabel = placeLabel(choice);
  const lines = placeLines(choice);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-6 md:flex-nowrap md:gap-x-4 lg:px-10 2xl:px-14">
          {phoneBack && (
            <div className="md:hidden">
              <BackButton plain />
            </div>
          )}
          <Link href="/" aria-label="Bookyo home" className="mr-2 hidden select-none lg:block">
            <Logo className="h-9 w-auto" />
          </Link>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={`Change location, now ${locationLabel}`}
            aria-haspopup="dialog"
            className={`group ${wide} h-11 min-w-0 max-w-[65%] items-center gap-1.5 px-1 text-left transition active:opacity-70 md:h-12 md:w-auto md:max-w-[16rem] md:shrink-0`}
          >
            <Icon name="location_on" className="text-[1.75rem] text-brand-700" />
            <span className="min-w-0 truncate">
              <span className="text-base font-extrabold text-slate-900">{lines.primary}</span>
              {lines.secondary && <span className="text-sm font-medium text-slate-500">, {lines.secondary}</span>}
            </span>
          </button>
          <div className="ml-auto md:ml-0 md:order-last">
            <AccountMenu />
          </div>
          <form
            onSubmit={search}
            role="search"
            className={`nav-search order-last ${wide} h-9 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 transition-[box-shadow,border-color,background-color] hover:border-slate-300 [&:has(input:focus)]:border-brand-500 [&:has(input:focus)]:bg-white md:order-none md:ml-auto md:h-10 md:w-[24rem] md:flex-none lg:w-[28rem]`}
          >
            <div className="relative h-full min-w-0 flex-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search venues"
              className="peer h-full w-full min-w-0 bg-transparent pl-6 pr-2 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none [&:not(:placeholder-shown)]:pl-0"
              placeholder="Search venues, turfs, pools"
              type="text"
            />
              <Icon name="search" className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-[1rem] text-slate-400 peer-[:not(:placeholder-shown)]:hidden" />
            </div>
            <button
              type="button"
              onClick={() => setTypePickerOpen(true)}
              aria-label="Venue types"
              aria-haspopup="dialog"
              className="-mr-3.5 ml-1 inline-flex h-full flex-shrink-0 items-center gap-1.5 border-l border-slate-200 bg-transparent px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 sm:gap-2 sm:px-4"
            >
              <RotatingTypeIcon types={categories} className="text-[1.375rem] text-brand-600" />
              <span className="hidden sm:inline">Venue types</span>
            </button>
          </form>
        </div>
      </header>

      {pickerOpen && (
        <LocationPicker
          current={choice}
          onChoose={(next) => {
            setChoice(next);
            setPickerOpen(false);
            router.push('/explore'); // the listing searches the newly chosen place
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {typePickerOpen && (
        <VenueTypePicker
          categories={categories}
          selected={[]}
          onApply={(slugs) => {
            setTypePickerOpen(false);
            router.push(slugs.length > 0 ? `/explore?type=${encodeURIComponent(slugs.join(','))}` : '/explore');
          }}
          onClose={() => setTypePickerOpen(false)}
        />
      )}
    </>
  );
}
