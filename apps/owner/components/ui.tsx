'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SvgIcon } from '@/components/svg-icons';
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
      className={`w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface transition-colors placeholder:text-on-surface-variant/60 hover:border-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant ${className}`}
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
      className={`w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface transition-colors placeholder:text-on-surface-variant/60 hover:border-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant ${className}`}
      {...props}
    />
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1 block font-label-md text-label-md text-on-surface-variant">{children}</label>;
}

const BADGE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-primary-fixed-dim/30 text-on-primary-container',
  CONFIRMED: 'bg-primary-fixed-dim/30 text-on-primary-container',
  SUCCESS: 'bg-primary-fixed-dim/30 text-on-primary-container',
  COMPLETED: 'bg-primary-fixed-dim/30 text-on-primary-container',
  OPEN: 'bg-secondary-container text-on-secondary-container',
  PENDING: 'bg-tertiary-container/30 text-on-tertiary-container',
  INITIATED: 'bg-tertiary-container/30 text-on-tertiary-container',
  PENDING_PAYMENT: 'bg-tertiary-container/30 text-on-tertiary-container',
  PROCESSING: 'bg-tertiary-container/30 text-on-tertiary-container',
  IN_PROGRESS: 'bg-tertiary-container/30 text-on-tertiary-container',
  DRAFT: 'bg-surface-container-high text-on-surface-variant',
  INACTIVE: 'bg-surface-container-high text-on-surface-variant',
  CANCELLED: 'bg-error-container text-on-error-container',
  NO_SHOW: 'bg-tertiary-container/30 text-on-tertiary-container',
  FAILED: 'bg-error-container text-on-error-container',
  VERIFIED: 'bg-primary-fixed-dim/30 text-on-primary-container',
  NOT_VERIFIED: 'bg-tertiary-container/30 text-on-tertiary-container',
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
      {value.replace(/_/g, " ")}
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

export { SuccessBanner } from '@/components/success-banner';

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

export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Link to the parent page, shown above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-flex items-center gap-1.5 rounded-lg py-1 pr-2 text-body-md font-medium text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <SvgIcon name="back" className="h-4 w-4" />
            {back.label}
          </Link>
        )}
        <p className="mb-1 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          Owner Portal
        </p>
        <h1 className="font-headline-md text-headline-md text-on-surface">{title}</h1>
        {subtitle && <p className="mt-1 text-body-md text-on-surface-variant">{subtitle}</p>}
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

/** Password field with a show/hide toggle. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={`pr-11 ${className}`} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-400 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <SvgIcon name={visible ? 'eyeOff' : 'eye'} className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

/** The red message under a form field; pair it with `aria-invalid` and `aria-describedby` on the input. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-error">
      {message}
    </p>
  );
}

/** Class to add to an Input/Select/PasswordInput that has an error. */
export const invalidClass = '!border-error focus:!ring-error/20';
