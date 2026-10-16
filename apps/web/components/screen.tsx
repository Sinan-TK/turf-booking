import Link from 'next/link';
import { AccountMenu } from '@/components/account-menu';

/** Page shell for the account/checkout pages: a slim top bar (home link and
 * account menu) above a centred content column. */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-8 sm:px-6 sm:pb-12">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between py-4 md:max-w-2xl">
        <Link href="/" className="text-sm font-semibold text-slate-700 hover:underline">
          ← Home
        </Link>
        <AccountMenu />
      </div>
      <div className="mx-auto w-full max-w-lg md:max-w-2xl">{children}</div>
    </main>
  );
}
