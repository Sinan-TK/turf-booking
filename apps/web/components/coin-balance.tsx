'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/** "120", "1,250", "12.5K": whole coins as they are, long numbers shortened so the header never grows. */
function formatCoins(balance: number): string {
  if (balance >= 10_000) return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(balance);
  return Number.isInteger(balance)
    ? balance.toLocaleString('en-IN')
    : balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The customer's coin balance, shown in the header just before the profile button: a coin icon and the count.
 * Tapping it opens the wallet. It reloads when the person comes back to the tab, so a refund or a spend shows
 * without a full refresh. Nothing is shown if the balance can't be read.
 */
export function CoinBalance() {
  const { customer } = useCustomer();
  const customerId = customer?.id;
  const [balance, setBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ cachedBalance: string }>('/me/coins')
      .then((wallet) => {
        setBalance(Number(wallet.cachedBalance));
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!customerId) return;
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [customerId, load]);

  if (!customerId || failed) return null;
  if (balance === null) return <Skeleton className="h-10 w-20 rounded-xl" />;

  return (
    <Link
      href="/account?tab=wallet"
      title="Coins wallet"
      aria-label={`${formatCoins(balance)} coins. Open your wallet`}
      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-sm font-bold text-amber-900 transition hover:bg-amber-100 active:scale-95 md:h-11 md:px-3.5"
    >
      <Icon name="coins" className="text-[1.125rem] text-amber-500" />
      <span>
        {formatCoins(balance)}
      </span>
    </Link>
  );
}
