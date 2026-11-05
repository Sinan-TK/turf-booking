import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

import {
  Tag,
  MapPin,
  ArrowLeft,
  Check,
  ChevronDown,
  Search,
  Map,
  Zap,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  LocateFixed,
  Handshake,
  Activity,
  CircleDot,
  Waves,
  Dumbbell,
  Gamepad2,
  Puzzle,
  Dices,
  Camera,
  Music,
  Mic,
  Sailboat,
  Trophy,
  Swords,
  DoorOpen,
  BedDouble,
  PartyPopper,
  LayoutGrid,
  Flower2,
  Volleyball,
  User,
  Wallet,
  CalendarDays,
  LifeBuoy,
  Pencil,
  LogOut,
  LogIn,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Coins,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Plus,
  Phone,
  Layers,
  CalendarCheck,
  CalendarX,
  type LucideIcon
} from 'lucide-react';

import { CoinSvg } from '@/components/coin-icon';

/** The site's place icon: a bent arrow, drawn in the colour of the text around it (the 'navigation' icon, on the Directions buttons). */
function LocationArrow({ size = '1em', className }: { size?: string | number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 245 194" fill="currentColor" stroke="currentColor" aria-hidden="true" className={className}>
      <path d="M0.5 193.198V86.1976C0.5 86.1976 4.86418 75.5097 8.5 72.1976C12.7845 68.2947 23 64.1976 23 64.1976H154V1.19763L244 90.1976L154 180.198V116.198H52V193.198H0.5Z" />
    </svg>
  );
}

type IconComponent = LucideIcon | typeof LocationArrow | typeof CoinSvg;

const ICON_MAP: Record<string, IconComponent> = {
  // Facility icons (the keys the Super Admin picks in the facility catalogue).
  sports_soccer: CircleDot,
  sports_cricket: Trophy,
  sports_tennis: Activity,
  sports_basketball: Activity,
  sports_volleyball: Volleyball,
  sports_esports: Gamepad2,
  extension: Puzzle,
  casino: Dices,
  pool: Waves,
  kayaking: Sailboat,
  sports_martial_arts: Swords,
  fitness_center: Dumbbell,
  self_improvement: Flower2,
  music_note: Music,
  mic: Mic,
  photo_camera: Camera,
  meeting_room: DoorOpen,
  bedroom_parent: BedDouble,
  celebration: PartyPopper,
  category: LayoutGrid,
  apps: LayoutGrid,
  location_on: MapPin,
  offer: Tag,
  expand_more: ChevronDown,
  search: Search,
  stadium: Map,
  bolt: Zap,
  schedule: Clock,
  arrow_down_left: ArrowDownLeft,
  arrow_up_right: ArrowUpRight,
  close: X,
  add: Plus,
  coin: CoinSvg,
  call: Phone,
  my_location: LocateFixed,
  arrow_back: ArrowLeft,
  check: Check,
  handshake: Handshake,
  // The account's main options.
  person: User,
  wallet: Wallet,
  bookings: CalendarDays,
  support: LifeBuoy,
  edit: Pencil,
  logout: LogOut,
  login: LogIn,
  visibility: Eye,
  visibility_off: EyeOff,
  lock: KeyRound,
  verified: ShieldCheck,
  coins: Coins,
  // The venue cards.
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  bookmark: Bookmark,
  plus: Plus,
  navigation: LocationArrow,
  layers: Layers,
  calendar: CalendarDays,
  book: CalendarCheck,
  event_busy: CalendarX,
};

export function Icon({ name, className = '' }: { name: string; className?: string; filled?: boolean }) {
  const LucideIconComponent = ICON_MAP[name] || Activity;
  return <LucideIconComponent size="1em" className={`shrink-0 ${className}`} />;
}
/**
 * A facility's icon: its pasted SVG when it has one (drawn in its own colours, as an image, so it can never run code), else the
 * named icon.
 */
export function CategoryIcon({ iconKey, iconSvg, className = '' }: { iconKey: string; iconSvg?: string | null; className?: string }) {
  if (!iconSvg) return <Icon name={iconKey} className={className} />;
  return (
    <img
      alt=""
      aria-hidden="true"
      src={`data:image/svg+xml,${encodeURIComponent(iconSvg)}`}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ width: '1em', height: '1em' }}
    />
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
    primary: 'bg-brand-700 text-white hover:bg-brand-600 disabled:bg-brand-300',
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
      className={`w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-600 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', style, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm text-slate-700 shadow-sm transition-all hover:border-brand-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 ${className}`}
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

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-600">
      {children}
    </label>
  );
}

/** The red message under a form field; pair it with `aria-invalid` and `aria-describedby` on the input. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-medium text-red-600">
      {message}
    </p>
  );
}

/** Class to add to an Input/textarea that has an error. */
export const invalidClass = '!border-red-500 focus:!border-red-500';

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
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-gray-400">—</span>;
  const color = BADGE_COLORS[value] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block rounded-md px-2.5 py-0.5 text-xs font-medium ${color}`}>
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
