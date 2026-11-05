import { Logo } from '@/components/logo';
import { SvgIcon, type SvgIconName } from '@/components/svg-icons';

const HIGHLIGHTS: Array<{ icon: SvgIconName; text: string }> = [
  { icon: 'calendar', text: 'Live bookings and availability for every pitch' },
  { icon: 'card', text: 'Payments and payouts, always reconciled' },
  { icon: 'bell', text: 'Instant alerts when a slot is booked' },
];

/** Split-screen frame shared by the sign-in, forgot-password and reset-password pages. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-on-primary-container p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-28 -top-28 h-[26rem] w-[26rem] rounded-full bg-primary-container/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 -left-20 h-[26rem] w-[26rem] rounded-full bg-primary-fixed-dim/15 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <Logo ink="#ffffff" hole="#050505" className="h-10 w-auto" />
        </div>

        <div className="relative max-w-md">
          <p className="font-label-md text-label-md uppercase text-primary-fixed-dim">Owner portal</p>
          <h2 className="mt-3 font-display-lg text-display-lg">Your venues, filled and running smoothly.</h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.icon} className="flex items-center gap-3 text-body-lg text-white/85">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <SvgIcon name={h.icon} className="h-5 w-5 text-primary-fixed-dim" />
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">Venue owners and staff</p>
      </aside>

      <section className="flex items-center justify-center bg-surface-container-low p-6">
        <div className="w-full max-w-sm animate-[rise_0.35s_ease-out_both]">
          <span className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/30 lg:hidden">
            <SvgIcon name="ball" />
          </span>
          <h1 className="font-headline-md text-headline-md text-on-surface">{title}</h1>
          <p className="mb-8 mt-1.5 text-body-md text-on-surface-variant">{subtitle}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
