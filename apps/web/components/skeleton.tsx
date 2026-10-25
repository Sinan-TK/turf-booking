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

/** Search results on the home page: venue cards with their slot grid. */
export function VenueCardsSkeleton({ count = 3, label = 'Checking live availability…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="flex flex-col gap-3 sm:gap-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-6 w-14" />
            </div>
            <Skeleton className="mt-1 hidden h-10 w-full rounded-xl sm:block" />
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 p-4 sm:grid-cols-4 sm:border-l sm:border-t-0 sm:p-5">
            {Array.from({ length: 8 }, (_, j) => (
              <Skeleton key={j} className="h-12 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </Region>
  );
}

/** A slim bar for a re-search while the previous results are still on screen. */
export function SearchingBar({ label = 'Checking live availability…' }: { label?: string }) {
  return (
    <Region label={label} className="mb-3">
      <Skeleton className="h-1.5 w-full rounded-full" />
    </Region>
  );
}

/** A list of cards, each a title line, a detail line and a status chip: bookings. */
export function BookingRowsSkeleton({ count = 3, label = 'Loading your bookings…' }: { count?: number; label?: string }) {
  return (
    <Region label={label} className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-3/4 max-w-xs" />
          </div>
          <div className="space-y-2">
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="ml-auto h-5 w-24 rounded-full" />
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

/** A booking's details or its checkout: a title, label/value rows and a button. */
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
