import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/icons';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200/80 bg-white p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3.2a4.8 4.8 0 00-4.8 4.8H4z"
      />
    </svg>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  /** Shows an inline spinner and disables the button — the button's own
   * instant, "optimistic" feedback that a click registered, independent
   * of whatever else the page does while the request is in flight. */
  loading?: boolean;
}) {
  const variants = {
    primary:
      'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
    secondary:
      'bg-white text-gray-800 border border-gray-300 shadow-sm hover:bg-gray-50 hover:border-gray-400 disabled:text-gray-400 disabled:hover:bg-white',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

const FIELD =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-gray-50 disabled:text-gray-400 disabled:hover:border-gray-300';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD} ${className}`} {...props} />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-gray-700">{children}</label>;
}

const BADGE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  SUCCESS: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  OPEN: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  PENDING_PAYMENT: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  PROCESSING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  DRAFT: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  INACTIVE: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-600/20',
  FAILED: 'bg-red-50 text-red-700 ring-red-600/20',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-600/20',
  CLOSED: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const color = BADGE_COLORS[value] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="animate-[fade-in_0.15s_ease-out] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="animate-[fade-in_0.15s_ease-out] rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
    >
      {message}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
      <Spinner className="h-4 w-4 text-brand-600" />
      Loading…
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Icon name="inbox" className="h-5 w-5" />
      </span>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A dashboard metric: icon chip, label, big number. */
export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: React.ReactNode;
  icon: IconName;
  tone?: 'brand' | 'sky' | 'amber' | 'violet';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <Card className="group animate-[rise_0.3s_ease-out_both] transition hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">{value}</p>
    </Card>
  );
}

// ---- Skeleton loading ----
// Shares one shimmer keyframe (defined once in globals.css) so every
// skeleton across the app pulses in sync rather than each mounting its
// own independent animation phase.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200/80 ${className}`} />;
}

/** Mirrors the stat-card grid on the dashboard — same column count, same
 * card padding, so the layout doesn't jump when real data replaces it. */
export function SkeletonStatGrid({ count = 7 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-8 w-20" />
        </Card>
      ))}
    </div>
  );
}

/** Mirrors every list page's `<Card className="overflow-x-auto p-0">`
 * table exactly — same header row, same cell padding — so the table
 * shell never shifts once real rows arrive. */
export function SkeletonTable({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-4 py-3">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-gray-100 last:border-0">
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className="px-4 py-3.5">
                  <Skeleton className="h-4 w-full max-w-[10rem]" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Mirrors a detail page's top `<Card>` — a badge line plus a 2-column
 * definition-list grid. */
export function SkeletonDetailCard({ fields = 4 }: { fields?: number }) {
  return (
    <Card>
      <Skeleton className="mb-4 h-5 w-24 rounded-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SkeletonText({ className = 'h-4 w-full' }: { className?: string }) {
  return <Skeleton className={className} />;
}
