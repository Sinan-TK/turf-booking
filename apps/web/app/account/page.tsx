'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { LoginGate } from '@/components/login-gate';
import { Button, Card, ErrorBanner, FieldError, Icon, Input, Label, LoadingState, SuccessBanner, invalidClass } from '@/components/ui';
import { emailError, nameError, newPasswordError, passwordError, phoneError } from '@/lib/validation';
import { PasswordInput } from '@/components/password-input';
import { Screen } from '@/components/screen';

interface CoinWallet {
  cachedBalance: string;
  currency: string;
}
interface CoinTransaction {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  BOOKING_REWARD: 'Booking reward',
  REFUND: 'Cancellation refund',
  REFERRAL: 'Referral bonus',
  PROMOTION: 'Promotion',
  BOOKING_REDEMPTION: 'Used for a booking',
  ADMIN_ADJUSTMENT: 'Adjustment',
};

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** "Verified" / "Not verified", next to a phone number or an email. */
function VerifiedChip({ verified, what }: { verified: boolean; what: string }) {
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${
        verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
      }`}
      aria-label={`${what} ${verified ? 'verified' : 'not verified'}`}
    >
      {verified ? 'Verified' : 'Not verified'}
    </span>
  );
}

function Profile() {
  const { customer, refresh } = useCustomer();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  // The details are shown as plain text; Edit turns them into fields.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Partial<Record<'name' | 'phone' | 'email', string>>>({});

  // A verified phone or email is the customer's identity: shown, not editable.
  const phoneLocked = !!customer?.phoneVerified;
  const emailLocked = !!customer?.emailVerified;
  const changed = {
    name: name.trim() !== (customer?.name ?? ''),
    phone: !phoneLocked && phone.trim() !== (customer?.phone ?? ''),
    email: !emailLocked && email.trim().toLowerCase() !== (customer?.email ?? ''),
  };
  const dirty = changed.name || changed.phone || changed.email;

  function startEdit() {
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setMsgs({});
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  function cancelEdit() {
    setMsgs({});
    setError(null);
    setEditing(false);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = {
      name: changed.name ? nameError(name) : undefined,
      phone: changed.phone ? phoneError(phone) : undefined,
      email: changed.email ? emailError(email) : undefined,
    };
    setMsgs(found);
    const first = (['name', 'phone', 'email'] as const).find((k) => found[k]);
    if (first) return void document.getElementById(`account-${first}`)?.focus();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch('/customer-auth/me', {
        ...(changed.name ? { name: name.trim() } : {}),
        ...(changed.phone ? { phone: phone.trim() } : {}),
        ...(changed.email ? { email: email.trim() } : {}),
      });
      await refresh();
      setSaved(true);
      setEditing(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save your details.';
      // A number or email that belongs to someone else is shown under its own field.
      if (err instanceof ApiError && err.status === 409) setMsgs({ [/number/i.test(message) ? 'phone' : 'email']: message });
      else setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Profile</h2>
        {!editing && (
          <Button type="button" variant="secondary" className="!px-3 !py-1.5" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>
      {saved && !editing && (
        <div className="mb-3">
          <SuccessBanner message="Saved." />
        </div>
      )}
      {!editing && (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-gray-500">Name</dt>
            <dd className="mt-0.5 text-gray-900">{customer?.name || <span className="text-gray-400">Not added</span>}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="mt-0.5 break-all text-gray-900">
              {customer?.email ? (
                <>
                  {customer.email}
                  <VerifiedChip verified={emailLocked} what="Email" />
                </>
              ) : (
                <span className="text-gray-400">Not added</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Phone number</dt>
            <dd className="mt-0.5 text-gray-900">
              {customer?.phone ? (
                <>
                  {customer.phone}
                  <VerifiedChip verified={phoneLocked} what="Phone number" />
                </>
              ) : (
                <span className="text-gray-400">Not added</span>
              )}
            </dd>
          </div>
        </dl>
      )}
      {editing && (
      <form onSubmit={onSave} noValidate className="space-y-3">
        {error && (
          <div role="alert">
            <ErrorBanner message={error} />
          </div>
        )}
        <div>
          <Label htmlFor="account-name">Name</Label>
          <Input
            id="account-name"
            autoFocus
            maxLength={80}
            value={name}
            aria-invalid={!!msgs.name}
            className={msgs.name ? invalidClass : ''}
            onChange={(e) => {
              setName(e.target.value);
              setMsgs((m) => ({ ...m, name: undefined }));
            }}
          />
          <FieldError id="account-name-error" message={msgs.name} />
        </div>
        <div>
          <Label htmlFor="account-email">
            Email
            {customer?.email && <VerifiedChip verified={emailLocked} what="Email" />}
          </Label>
          <Input
            id="account-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            readOnly={emailLocked}
            value={email}
            aria-invalid={!!msgs.email}
            className={`${emailLocked ? 'bg-gray-50 text-gray-500' : ''} ${msgs.email ? invalidClass : ''}`}
            onChange={(e) => {
              setEmail(e.target.value);
              setMsgs((m) => ({ ...m, email: undefined }));
            }}
          />
          <FieldError id="account-email-error" message={msgs.email} />
          {customer && !customer.email && <p className="mt-1 text-xs text-gray-500">Add an email so you can also sign in with it.</p>}
        </div>
        <div>
          <Label htmlFor="account-phone">
            Phone number
            {customer?.phone && <VerifiedChip verified={phoneLocked} what="Phone number" />}
          </Label>
          <Input
            id="account-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            readOnly={phoneLocked}
            value={phone}
            placeholder="98765 43210"
            aria-invalid={!!msgs.phone}
            className={`${phoneLocked ? 'bg-gray-50 text-gray-500' : ''} ${msgs.phone ? invalidClass : ''}`}
            onChange={(e) => {
              setPhone(e.target.value);
              setMsgs((m) => ({ ...m, phone: undefined }));
            }}
          />
          <FieldError id="account-phone-error" message={msgs.phone} />
          {customer?.phone && !phoneLocked && (
            <p className="mt-1 text-xs text-gray-500">We don&apos;t check this number yet. Venues use it to reach you about your bookings.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={cancelEdit}>
            Cancel
          </Button>
        </div>
      </form>
      )}
    </Card>
  );
}

/** Only for customers who have a password. Google-only customers set one through Forgot password on the sign-in screen. */
function ChangePassword() {
  const { refresh } = useCustomer();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msgs, setMsgs] = useState<Partial<Record<'current' | 'next' | 'confirm', string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = {
      current: passwordError(current),
      next: newPasswordError(next),
      confirm: next !== confirm ? 'The two passwords are not the same.' : undefined,
    };
    setMsgs(found);
    const first = (['current', 'next', 'confirm'] as const).find((k) => found[k]);
    if (first) return void document.getElementById(`password-${first}`)?.focus();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post('/customer-auth/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Change password</h2>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        {error && (
          <div role="alert">
            <ErrorBanner message={error} />
          </div>
        )}
        {saved && <SuccessBanner message="Password changed. Other devices have been signed out." />}
        <div>
          <Label htmlFor="password-current">Current password</Label>
          <PasswordInput
            id="password-current"
            autoComplete="current-password"
            value={current}
            aria-invalid={!!msgs.current}
            className={msgs.current ? invalidClass : ''}
            onChange={(e) => {
              setCurrent(e.target.value);
              setMsgs((m) => ({ ...m, current: undefined }));
            }}
          />
          <FieldError id="password-current-error" message={msgs.current} />
        </div>
        <div>
          <Label htmlFor="password-next">New password</Label>
          <PasswordInput
            id="password-next"
            autoComplete="new-password"
            value={next}
            aria-invalid={!!msgs.next}
            className={msgs.next ? invalidClass : ''}
            onChange={(e) => {
              setNext(e.target.value);
              setMsgs((m) => ({ ...m, next: undefined }));
            }}
          />
          <FieldError id="password-next-error" message={msgs.next} />
        </div>
        <div>
          <Label htmlFor="password-confirm">Repeat the new password</Label>
          <PasswordInput
            id="password-confirm"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={!!msgs.confirm}
            className={msgs.confirm ? invalidClass : ''}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMsgs((m) => ({ ...m, confirm: undefined }));
            }}
          />
          <FieldError id="password-confirm-error" message={msgs.confirm} />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function Wallet() {
  const { refresh } = useCustomer();
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [txs, setTxs] = useState<CoinTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<CoinWallet>('/me/coins'),
      api.get<CoinTransaction[]>('/me/coins/transactions'),
    ])
      .then(([w, t]) => {
        setWallet(w);
        setTxs(t.slice(0, 20));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Could not load your wallet.');
      });
  }, [refresh]);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Coins wallet</h2>
      {error && <ErrorBanner message={error} />}
      {!error && !wallet && <LoadingState />}
      {wallet && (
        <>
          <p className="text-3xl font-semibold text-gray-900">{wallet.cachedBalance}</p>
          <p className="mb-4 text-xs text-gray-500">Coins from cancelled bookings. Use them to pay for your next one.</p>
          {txs && txs.length === 0 && <p className="text-sm text-gray-500">No transactions yet.</p>}
          {txs && txs.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm">
              {txs.map((t) => {
                const credit = Number(t.amount) >= 0;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-gray-900">{labelFor(t.type)}</p>
                      <p className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</p>
                    </div>
                    <p className={`shrink-0 font-medium ${credit ? 'text-emerald-700' : 'text-gray-900'}`}>
                      {credit ? '+' : ''}
                      {t.amount}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'security', label: 'Security' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Security: a password can be changed only by someone who has one; a Google-only customer has none. */
function Security() {
  const { customer } = useCustomer();
  if (customer?.hasPassword) return <ChangePassword />;
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Sign-in method</h2>
      <p className="text-sm text-gray-600">
        You sign in with Google, so this account has no password. Your Google account keeps it secure.
      </p>
    </Card>
  );
}

/** The three sections of the account, switched with tabs. The chosen one is kept in the address (?tab=wallet), so the menu can link straight to it. */
function AccountTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const wanted = useSearchParams().get('tab');
  const tab: TabId = TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'profile';
  const choose = (id: TabId) => router.replace(`${pathname}?tab=${id}`, { scroll: false });

  function onKeyDown(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length]!;
    choose(target.id);
    document.getElementById(`account-tab-${target.id}`)?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Account sections" onKeyDown={onKeyDown} className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`account-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="account-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => choose(t.id)}
            className={`rounded-lg px-3 py-2 transition ${tab === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="account-panel" role="tabpanel" aria-labelledby={`account-tab-${tab}`}>
        {tab === 'profile' && <Profile />}
        {tab === 'wallet' && <Wallet />}
        {tab === 'security' && <Security />}
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="handshake" />
        My account
      </h1>
      <LoginGate message="Log in to see your account.">
        <Suspense fallback={<LoadingState />}>
          <AccountTabs />
        </Suspense>
      </LoginGate>
    </Screen>
  );
}
