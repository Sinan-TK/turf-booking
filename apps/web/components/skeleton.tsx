/**
 * Skeleton loading: grey placeholder shapes that look like the content that is about to appear, in the same
 * layout, so the page doesn't jump when it arrives. Each set is announced to screen readers once, as a status
 * message, and the shapes themselves are hidden from them. The pulse stops for people who ask for less motion.
 */

/** One grey shape. Give it the size with Tailwind classes (h-4 w-24 ...). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200 motion-reduce:animate-none ${className}`} />;
}

/** Wraps a set of skeleton shapes with the message a screen reader (and a test) can find. */
function Region({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * One venue card's shape, part for part like the real card: the banner (with its photo dots and save button), the name and address with
 * Directions, the unit tabs, the day's hour bar with its time labels and legend, and Book Now. A grid item, so it can sit among real cards.
 */
export function VenueCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
      <div className="relative aspect-[16/7] bg-slate-100">
        <Skeleton className="h-full w-full rounded-none bg-slate-200" />
        <Skeleton className="absolute right-2.5 top-2.5 h-9 w-9 rounded-full bg-white/70" />
        <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-1.5 w-1.5 rounded-full bg-white/70" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3.5 px-3.5 pb-3.5 pt-3 sm:px-4 sm:pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-[1.125rem] w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <Skeleton className="h-8 w-[5.75rem] shrink-0 rounded-xl" />
        </div>
        <div className="-m-0.5 flex gap-2 overflow-hidden p-0.5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex w-[8.5rem] shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-2 py-2.5 sm:w-[calc((100%-1rem)/3)]">
              <Skeleton className="h-[1.125rem] w-[1.125rem] shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <div>
            <div className="mb-1.5 flex justify-between">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-2.5 w-8" />
              ))}
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: 18 }, (_, i) => (
                <Skeleton key={i} className="h-6 flex-1 rounded-[3px]" />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Search results on the home page while they load: venue card shapes in the same grid as the real cards. */
export function VenueCardsSkeleton({ count = 3, label = 'Checking live availability…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <VenueCardSkeleton key={i} />
      ))}
    </Region>
  );
}

/** The screen-reader message for skeleton cards placed straight into a grid of real ones (no wrapper of its own). */
export function LoadingNote({ label }: { label: string }) {
  return (
    <span role="status" aria-busy="true" className="sr-only">
      {label}
    </span>
  );
}

/** A slim bar for a re-search while the previous results are still on screen. */
export function SearchingBar({ label = 'Checking live availability…' }: { label?: string }) {
  return (
    <Region label={label} className="mb-3">
      <Skeleton className="h-1.5 w-full rounded-md" />
    </Region>
  );
}

/** The My bookings cards, in the same grid as the real ones (1, 2, then 4 across): date block and status, venue, unit, time, then amount and action. */
export function BookingRowsSkeleton({ count = 4, label = 'Loading your bookings…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-16 w-14 rounded-xl" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </Region>
  );
}

/** The Saved venues cards, in the same grid as the real ones: picture, name and address with Directions, then the two buttons. */
export function SavedCardsSkeleton({ count = 4, label = 'Loading your saved venues…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="flex flex-col gap-4 p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-8 w-24 rounded-xl" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1 rounded-xl" />
              <Skeleton className="h-8 flex-1 rounded-xl" />
            </div>
          </div>
        </div>
      ))}
    </Region>
  );
}

/** Simple rows inside a card: support requests, wallet transactions, towns. */
export function RowsSkeleton({ count = 3, label = 'Loading…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="divide-y divide-gray-100">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </Region>
  );
}

/** The wallet: the balance, then the transactions. */
export function WalletSkeleton({ label = 'Loading your wallet…' }: { label?: string }) {
  return (
    <Region label={label}>
      <Skeleton className="h-9 w-24" />
      <Skeleton className="mb-5 mt-2 h-3 w-2/3 max-w-sm" />
      <RowsSkeleton count={3} label="Loading your transactions…" />
    </Region>
  );
}

/** The account page: the tab bar and a profile card. */
export function AccountSkeleton({ label = 'Loading your account…' }: { label?: string }) {
  return (
    <Region label={label}>
      <div className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-11 rounded-lg bg-gray-200/80" />
        ))}
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </Region>
  );
}

/** One booking's page: the picture and venue, then the slot and payment cards side by side, then the info card. */
export function BookingDetailSkeleton({ label = 'Loading your booking…' }: { label?: string }) {
  const card = (rows: number) => (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <Skeleton className="mb-4 h-4 w-24" />
      <div className="space-y-3.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <Region label={label} className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-start sm:gap-4">
        <Skeleton className="aspect-[2/1] w-full shrink-0 rounded-xl sm:aspect-auto sm:h-36 sm:w-48" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="mt-3 h-8 w-24 rounded-xl" />
        </div>
      </div>
      <div className="space-y-4">
        {card(5)}
        {card(4)}
        {card(2)}
      </div>
    </Region>
  );
}

/** A booking's checkout: a title, label/value rows and a button. */
export function DetailSkeleton({ rows = 6, label = 'Loading your booking…' }: { rows?: number; label?: string }) {
  return (
    <Region label={label}>
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <div className="space-y-3.5">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-6">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-6 h-11 w-full rounded-md" />
      </div>
    </Region>
  );
}

/**
 * The venue's Book Now page while it loads, laid out like the page: on the left the big picture, the facility tabs, then the name, address
 * and description; on the right the day chips and the slot card (its date, length and quantity chips, the slot grid and the Book button).
 */
export function BookPageSkeleton({ label = 'Loading this venue…' }: { label?: string }) {
  return (
    <Region label={label} className="grid gap-6 pb-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-5">
        <Skeleton className="aspect-[16/9] w-full rounded-xl sm:aspect-[16/7]" />
        <div className="-m-1 flex gap-2.5 overflow-hidden p-1">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-36 shrink-0 rounded-xl sm:h-28 sm:w-44" />
          ))}
        </div>
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
                <Skeleton className={`h-3.5 ${i === 1 ? 'w-3/5' : 'w-4/5'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-5">
        <div className="-mx-1 flex gap-2 overflow-hidden px-1">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-16 shrink-0 rounded-xl" />
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
            <Skeleton className="h-6 w-24 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-md" />
            <Skeleton className="h-6 w-32 rounded-md" />
          </div>
          <div className="space-y-3 p-5">
            <Skeleton className="h-4 w-2/3" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} className="h-[3.25rem] rounded-xl" />
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 bg-white p-4">
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </Region>
  );
}
