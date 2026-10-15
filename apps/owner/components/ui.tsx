import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl bg-surface-container-lowest p-container-padding shadow-sm ring-1 ring-outline-variant/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary/90 disabled:bg-primary/40 shadow-sm',
    secondary:
      'bg-surface-container-lowest text-on-surface ring-1 ring-outline-variant/40 hover:bg-surface-container',
    danger: 'bg-error text-on-error hover:bg-error/90 disabled:bg-error/40',
  };
  return (
    <button
      className={`rounded-lg px-4 py-2 font-label-md text-label-md transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border-none bg-surface-container px-3 py-2 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`}
      {...props}
    />
  );
}

/** A pill-shaped search input with a leading icon, matching the
 * reference header's search field — used at the top of every list page
 * to filter what's already been fetched (client-side; these lists are
 * capped at 100 rows, so there's no need for a server round trip per
 * keystroke). */
export function SearchInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant"
      />
      <input
        className="w-full rounded-full border-none bg-surface-container py-2 pl-10 pr-4 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
        {...props}
      />
    </div>
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border-none bg-surface-container px-3 py-2 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block font-label-md text-label-md text-on-surface-variant">{children}</label>;
}

const BADGE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-primary-fixed-dim/30 text-on-primary-container',
  CONFIRMED: 'bg-primary-fixed-dim/30 text-on-primary-container',
  SUCCESS: 'bg-primary-fixed-dim/30 text-on-primary-container',
  COMPLETED: 'bg-primary-fixed-dim/30 text-on-primary-container',
  OPEN: 'bg-secondary-container text-on-secondary-container',
  PENDING: 'bg-tertiary-container/30 text-on-tertiary-container',
  PENDING_PAYMENT: 'bg-tertiary-container/30 text-on-tertiary-container',
  PROCESSING: 'bg-tertiary-container/30 text-on-tertiary-container',
  IN_PROGRESS: 'bg-tertiary-container/30 text-on-tertiary-container',
  DRAFT: 'bg-surface-container-high text-on-surface-variant',
  INACTIVE: 'bg-surface-container-high text-on-surface-variant',
  CANCELLED: 'bg-error-container text-on-error-container',
  FAILED: 'bg-error-container text-on-error-container',
  SUSPENDED: 'bg-error-container text-on-error-container',
  CLOSED: 'bg-surface-container-high text-on-surface-variant',
  RESOLVED: 'bg-primary-fixed-dim/30 text-on-primary-container',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-on-surface-variant/50">—</span>;
  const color = BADGE_COLORS[value] ?? 'bg-surface-container-high text-on-surface-variant';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${color}`}
    >
      {value}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-error-container px-4 py-3 text-body-md text-on-error-container">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-primary-fixed-dim/20 px-4 py-3 text-body-md text-on-primary-container">
      {message}
    </div>
  );
}

export function LoadingState() {
  return <div className="p-6 text-body-md text-on-surface-variant">Loading…</div>;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-md text-on-surface-variant">
      {message}
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        <p className="mb-1 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          Owner Portal
        </p>
        <h1 className="font-headline-md text-headline-md text-on-surface">{title}</h1>
      </div>
      {action}
    </div>
  );
}

/** Material Symbols icon — a thin wrapper so call sites don't repeat the
 * `material-symbols-outlined` class + the CSS-var trick for weight/fill
 * (defined once in app/globals.css). */
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}
