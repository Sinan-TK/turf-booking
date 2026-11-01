'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useLocationChoice, type LocationChoice } from '@/lib/location';
import type { VenueCategory } from '@/lib/categories';
import { AccountMenu } from '@/components/account-menu';
import { Icon } from '@/components/ui';
import { LocationPicker } from '@/components/location-picker';
import { VenueTypePicker } from '@/components/venue-type-picker';
import { RotatingTypeIcon } from '@/components/rotating-type-icon';

/** The header's place name on one line: "Malappuram, Kerala", "Kottakkal, Malappuram" or "Near Tirur". */
function placeLabel(choice: LocationChoice | null): string {
  if (!choice) return 'Select location';
  if (choice.mode === 'town') return `${choice.townName ?? choice.districtName}, ${choice.districtName}`;
  if (choice.mode === 'geo') return choice.nearTown ? `Near ${choice.nearTown}` : 'Your location';
  return choice.stateName ? `${choice.districtName}, ${choice.stateName}` : choice.districtName;
}

/**
 * The listing's header for the pages that sit beside it (a venue's booking page): the logo, the place, the search and the
 * venue types, with the account on the right. A search or a venue-type choice goes to the listing, which shows the results;
 * a new place is saved and used by the listing.
 */
export function BrowseHeader() {
  const router = useRouter();
  const { choice, setChoice } = useLocationChoice();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.get<VenueCategory[]>('/categories?available=true').then(setCategories).catch(() => undefined);
  }, []);

  const locationLabel = placeLabel(choice);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-6 md:flex-nowrap md:gap-x-4 lg:px-10 2xl:px-14">
          <Link href="/" aria-label="TurfX home" className="mr-2 hidden select-none whitespace-nowrap text-[1.75rem] font-black italic leading-none tracking-tight text-slate-900 lg:block">
            Turf<span className="text-brand-600">X</span>
          </Link>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={`Change location, now ${locationLabel}`}
            aria-haspopup="dialog"
            className="group flex h-11 min-w-0 max-w-[65%] items-center gap-1.5 px-1 text-left transition active:opacity-70 md:h-12 md:w-auto md:max-w-[16rem] md:shrink-0"
          >
            <Icon name="location_on" className="text-[1.125rem] text-brand-600" />
            <span className="min-w-0 truncate text-sm font-bold text-slate-900 underline decoration-transparent decoration-2 underline-offset-4 transition group-hover:decoration-brand-600">{locationLabel}</span>
            <Icon name="expand_more" className="text-[1rem] text-slate-400 transition group-hover:text-brand-600" />
          </button>
          <div className="ml-auto md:order-last">
            <AccountMenu />
          </div>
          <form
            onSubmit={search}
            role="search"
            className="nav-search order-last flex h-11 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 transition-[box-shadow,border-color,background-color] hover:border-slate-300 [&:has(input:focus)]:border-brand-500 [&:has(input:focus)]:bg-white md:order-none md:h-12 md:w-auto md:max-w-3xl md:flex-1"
          >
            <Icon name="search" className="text-[1.125rem] text-slate-500" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search venues"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none"
              placeholder="Search venues, turfs, pools, badminton, activities..."
              type="text"
            />
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
