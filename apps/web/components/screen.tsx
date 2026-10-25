import { AccountMenu } from '@/components/account-menu';
import { BackButton } from '@/components/back-button';

/** Page shell for the account/checkout pages: a slim top bar (a round back button and, unless the page is the
 * account itself, the account menu) above a centred content column. */
export function Screen({
  children,
  showAccountMenu = true,
  topRight,
  wide = false,
}: {
  children: React.ReactNode;
  showAccountMenu?: boolean;
  /** Replaces the account menu in the top right corner. */
  topRight?: React.ReactNode;
  wide?: boolean;
}) {
  // Narrow, centred columns suit a phone; a wide page uses the whole laptop screen.
  // A wide page (the account) fills the screen; a form-like page (checkout, one booking) is a wide, centred column.
  const width = wide ? 'max-w-lg md:max-w-2xl lg:max-w-none' : 'max-w-lg md:max-w-3xl lg:max-w-4xl';
  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-8 sm:px-6 sm:pb-12 lg:px-10 2xl:px-14">
      <div className={`mx-auto flex w-full items-center justify-between py-4 ${width}`}>
        <BackButton />
        {topRight ?? (showAccountMenu ? <AccountMenu /> : null)}
      </div>
      <div className={`mx-auto w-full ${width}`}>{children}</div>
    </main>
  );
}
