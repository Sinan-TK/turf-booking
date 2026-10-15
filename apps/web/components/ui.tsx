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
/** Material Symbols has no WhatsApp glyph (it's a brand mark, not a
 * generic icon) — a small inline SVG instead, so the WhatsApp CTAs stay
 * recognizable rather than falling back to a generic chat bubble. */
export function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.472-.148-.67.15-.198.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.004 2.003c-5.514 0-9.997 4.483-9.997 9.997 0 1.762.462 3.485 1.34 5.003L2 22l5.13-1.345a9.96 9.96 0 0 0 4.874 1.242h.004c5.514 0 9.997-4.483 9.997-9.997s-4.483-9.997-9.997-9.997zm0 18.19a8.174 8.174 0 0 1-4.166-1.14l-.299-.177-3.113.817.83-3.033-.194-.312a8.19 8.19 0 0 1-1.256-4.351c0-4.522 3.68-8.203 8.202-8.203 4.522 0 8.202 3.68 8.202 8.203 0 4.523-3.68 8.196-8.2 8.196z" />
    </svg>
  );
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

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-gray-50 px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-lg md:max-w-2xl">{children}</div>
    </main>
  );
}
