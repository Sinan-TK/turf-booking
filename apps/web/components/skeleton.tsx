/**
 * Skeleton loading: grey placeholder shapes that look like the content that is about to appear, in the same
 * layout, so the page doesn't jump when it arrives. Each set is announced to screen readers once, as a status
 * message, and the shapes themselves are hidden from them. The pulse stops for people who ask for less motion.
 */

/** One grey shape. Give it the size with Tailwind classes (h-4 w-24 ...). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200/80 motion-reduce:animate-none ${className}`} />;
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

/** One venue card's shape (photo, name, unit tiles, day timeline, Book Now). A grid item, so it can sit among real cards. */
export function VenueCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
      <Skeleton className="aspect-[16/7] w-full rounded-none" />
      <div className="flex flex-col gap-3.5 px-3.5 pb-3.5 pt-3 sm:px-4 sm:pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-24 rounded-xl" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }, (_, j) => (
            <Skeleton key={j} className="h-14 rounded-xl" />
          ))}
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-6 w-full rounded-md" />
        <Skeleton className="mx-auto h-3 w-1/2" />
        <Skeleton className="h-12 w-full rounded-xl" />
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
    <Region label={label} className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-20 w-20 shrink-0 rounded-xl sm:h-24 sm:w-32" />
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
