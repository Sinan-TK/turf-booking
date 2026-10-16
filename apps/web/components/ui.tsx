import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

import {
  MapPin,
  ChevronDown,
  Search,
  Map,
  Zap,
  Clock,
  X,
  LocateFixed,
  Handshake,
  Activity,
  type LucideIcon
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  sports_soccer: Activity, // Fallback for a generic activity/sport icon
  location_on: MapPin,
  expand_more: ChevronDown,
  search: Search,
  stadium: Map,
  bolt: Zap,
  schedule: Clock,
  close: X,
  my_location: LocateFixed,
  handshake: Handshake,
};

export function Icon({ name, className = '' }: { name: string; className?: string; filled?: boolean }) {
  const LucideIconComponent = ICON_MAP[name] || Activity;
  return <LucideIconComponent size="1em" className={`shrink-0 ${className}`} />;
}
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
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
    primary: 'bg-emerald-700 text-white hover:bg-emerald-600 disabled:bg-emerald-300',
    secondary: 'bg-white text-gray-900 border border-gray-300 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  };
  return (
    <button
      className={`rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', style, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm text-slate-700 shadow-sm transition-all hover:border-emerald-400 focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10 ${className}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.75rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1em 1em',
        ...style,
      }}
      {...props}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>;
}

const BADGE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  SUCCESS: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-green-100 text-green-800',
  PENDING: 'bg-yellow-100 text-yellow-800',
  PENDING_PAYMENT: 'bg-yellow-100 text-yellow-800',
  PROCESSING: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
  NO_SHOW: 'bg-gray-100 text-gray-700',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const color = BADGE_COLORS[value] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {value}
    </span>
  );
}

export function ErrorBanner({ message }: { message: React.ReactNode }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: React.ReactNode }) {
  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
      {message}
    </div>
  );
}

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return <div className="p-6 text-center text-sm text-gray-500">{message}</div>;
}
