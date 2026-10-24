import { AccountMenu } from '@/components/account-menu';
import { BackButton } from '@/components/back-button';

/** Page shell for the account/checkout pages: a slim top bar (a round back button and, unless the page is the
 * account itself, the account menu) above a centred content column. */
export function Screen({ children, showAccountMenu = true }: { children: React.ReactNode; showAccountMenu?: boolean }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-8 sm:px-6 sm:pb-12">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between py-4 md:max-w-2xl">
        <BackButton />
        {showAccountMenu ? <AccountMenu /> : null}
      </div>
      <div className="mx-auto w-full max-w-lg md:max-w-2xl">{children}</div>
    </main>
  );
}
