'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { LoginGate } from '@/components/login-gate';
import { Button, Card, ErrorBanner, FieldError, Icon, Input, Label, LoadingState, invalidClass } from '@/components/ui';
import { emailError, indianPhoneError, nameError, newPasswordError, passwordError, passwordStrength } from '@/lib/validation';
import { useDebounced } from '@/lib/use-debounced';
import { PasswordInput } from '@/components/password-input';
import { PhoneInput, formatPhone, toNationalDigits } from '@/components/phone-input';
import { useToast } from '@/components/toast';
import { BookingsPanel } from '@/components/bookings-panel';
import { LogoutButton } from '@/components/logout-button';
import { SupportPanel } from '@/components/support-panel';
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
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? '');
  // The 10 digits after +91; the flag and +91 are shown in front of the field.
  const [phone, setPhone] = useState(toNationalDigits(customer?.phone));
  const [email, setEmail] = useState(customer?.email ?? '');
  // The details are shown as plain text; Edit turns them into fields.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Partial<Record<'name' | 'phone' | 'email', string>>>({});

  // A verified phone or email is the customer's identity: shown, not editable.
  const phoneLocked = !!customer?.phoneVerified;
  const emailLocked = !!customer?.emailVerified;
  const changed = {
    name: name.trim() !== (customer?.name ?? ''),
    phone: !phoneLocked && phone !== toNationalDigits(customer?.phone),
    email: !emailLocked && email.trim().toLowerCase() !== (customer?.email ?? ''),
  };
  const dirty = changed.name || changed.phone || changed.email;

  function startEdit() {
    setName(customer?.name ?? '');
    setPhone(toNationalDigits(customer?.phone));
    setEmail(customer?.email ?? '');
    setMsgs({});
    setError(null);
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
      phone: changed.phone ? indianPhoneError(phone) : undefined,
      email: changed.email ? emailError(email) : undefined,
    };
    setMsgs(found);
    const first = (['name', 'phone', 'email'] as const).find((k) => found[k]);
    if (first) return void document.getElementById(`account-${first}`)?.focus();
    setSaving(true);
    setError(null);
    try {
      await api.patch('/customer-auth/me', {
        ...(changed.name ? { name: name.trim() } : {}),
        ...(changed.phone ? { phone } : {}),
        ...(changed.email ? { email: email.trim() } : {}),
      });
      await refresh();
      setEditing(false);
      toast.show('Profile saved.');
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
          <Button type="button" className="inline-flex items-center gap-1.5 !px-3 !py-1.5" onClick={startEdit}>
            <Icon name="edit" className="text-[14px]" />
            Edit
          </Button>
        )}
      </div>
      {!editing && (
        <dl className="grid gap-4 text-sm md:grid-cols-3">
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
                  {formatPhone(customer.phone)}
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
      <form onSubmit={onSave} noValidate className="space-y-3 md:grid md:grid-cols-3 md:gap-4 md:space-y-0">
        {error && (
          <div role="alert" className="md:col-span-3">
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
          <PhoneInput
            id="account-phone"
            value={phone}
            readOnly={phoneLocked}
            invalid={!!msgs.phone}
            onValueChange={(digits) => {
              setPhone(digits);
              setMsgs((m) => ({ ...m, phone: undefined }));
            }}
          />
          <FieldError id="account-phone-error" message={msgs.phone} />
          {customer?.phone && !phoneLocked && (
            <p className="mt-1 text-xs text-gray-500">We don&apos;t check this number yet. Venues use it to reach you about your bookings.</p>
          )}
        </div>
        <div className="flex gap-2 md:col-span-3">
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
type PasswordField = 'current' | 'next' | 'confirm';
const STRENGTH_BAR = ['bg-red-400', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-600'];

/** Where the API's validation answers belong: the field names it uses, mapped to this form's. */
const SERVER_FIELD: Record<string, PasswordField> = { currentPassword: 'current', newPassword: 'next' };

function ChangePassword() {
  const { refresh } = useCustomer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // What the API said about a field; cleared as soon as that field is edited.
  const [serverMsgs, setServerMsgs] = useState<Partial<Record<PasswordField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Live checks wait until typing pauses, so a message doesn't flash on every keystroke.
  const dCurrent = useDebounced(current);
  const dNext = useDebounced(next);
  const dConfirm = useDebounced(confirm);

  function check(c: string, n: string, r: string, live: boolean): Partial<Record<PasswordField, string>> {
    const out: Partial<Record<PasswordField, string>> = {};
    // While typing only a field that has something in it is judged; after Update, every field is.
    if (!live || c) out.current = passwordError(c);
    if (!live || n) out.next = newPasswordError(n) ?? (c && n === c ? 'Choose a password different from your current one.' : undefined);
    if (!live || r) out.confirm = n !== r ? 'The two passwords are not the same.' : undefined;
    return out;
  }
  const live = check(dCurrent, dNext, dConfirm, true);
  const msg = (k: PasswordField) => serverMsgs[k] ?? (submitted ? check(current, next, confirm, false)[k] : live[k]);
  const strength = passwordStrength(next);

  function close() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setSubmitted(false);
    setServerMsgs({});
    setError(null);
    setOpen(false);
  }
  const edit = (k: PasswordField, set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setServerMsgs((m) => ({ ...m, [k]: undefined }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    // 1. The browser's checks, straight away.
    setSubmitted(true);
    const found = check(current, next, confirm, false);
    const first = (['current', 'next', 'confirm'] as const).find((k) => found[k]);
    if (first) return void document.getElementById(`password-${first}`)?.focus();
    // 2. Then the server's, whose answer is placed under the field it is about.
    setSaving(true);
    setError(null);
    try {
      await api.post('/customer-auth/change-password', { currentPassword: current, newPassword: next });
      close();
      toast.show('Password changed. Other devices have been signed out.');
      await refresh();
    } catch (err) {
      if (!(err instanceof ApiError)) return void setError('Could not change your password.');
      const body = (err.details ?? {}) as { code?: string; errors?: Array<{ path?: unknown[]; message?: string }> };
      const placed: Partial<Record<PasswordField, string>> = {};
      if (body.code === 'CURRENT_PASSWORD_WRONG') placed.current = err.message;
      else if (body.code === 'NEW_PASSWORD_SAME') placed.next = err.message;
      for (const issue of body.errors ?? []) {
        const field = SERVER_FIELD[String(issue.path?.[0])];
        if (field && issue.message && !placed[field]) placed[field] = issue.message;
      }
      const target = (['current', 'next', 'confirm'] as const).find((k) => placed[k]);
      if (target) {
        setServerMsgs(placed);
        document.getElementById(`password-${target}`)?.focus();
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const field = (k: PasswordField, id: string, label: string, value: string, set: (v: string) => void, autoComplete: string, extra?: React.ReactNode) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <PasswordInput
        id={id}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={!!msg(k)}
        className={msg(k) ? invalidClass : ''}
        onChange={edit(k, set)}
      />
      <FieldError id={`${id}-error`} message={msg(k)} />
      {extra}
    </div>
  );

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Change password</h2>
        {!open && (
          <Button type="button" variant="secondary" className="!px-3 !py-1.5" onClick={() => setOpen(true)}>
            Change
          </Button>
        )}
      </div>
      {!open && <p className="mt-1 text-sm text-gray-500">Choose a new password for signing in with your email.</p>}
      {open && (
        <form onSubmit={onSubmit} noValidate className="mt-3 space-y-3 md:grid md:grid-cols-3 md:gap-4 md:space-y-0">
          {error && (
            <div role="alert" className="md:col-span-3">
              <ErrorBanner message={error} />
            </div>
          )}
          {field('current', 'password-current', 'Current password', current, setCurrent, 'current-password')}
          {field(
            'next',
            'password-next',
            'New password',
            next,
            setNext,
            'new-password',
            <div className="mt-1.5" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <span key={n} className={`h-1.5 flex-1 rounded-full ${next && strength.level >= n ? STRENGTH_BAR[strength.level] : 'bg-gray-200'}`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">{strength.label ? `Strength: ${strength.label}` : 'At least 8 characters.'}</p>
            </div>,
          )}
          {field('confirm', 'password-confirm', 'Repeat the new password', confirm, setConfirm, 'new-password')}
          <div className="flex gap-2 md:col-span-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Update password'}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
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
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'bookings', label: 'Bookings', icon: 'bookings' },
  { id: 'support', label: 'Support', icon: 'support' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Details, and a Change password card for customers who have a password (Google-only customers have none). */
function ProfileTab() {
  const { customer } = useCustomer();
  return (
    <>
      <Profile />
      {customer?.hasPassword && <ChangePassword />}
    </>
  );
}

/** The sections of the account, switched with tabs. The chosen one is kept in the address (?tab=wallet), so the menu can link straight to it. */
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
      <div role="tablist" aria-label="Account sections" onKeyDown={onKeyDown} className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1 text-xs font-semibold sm:text-sm">
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
            className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 transition sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 ${tab === t.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <Icon name={t.icon} className="text-[18px]" />
            {t.label}
          </button>
        ))}
      </div>
      <div id="account-panel" role="tabpanel" aria-labelledby={`account-tab-${tab}`}>
        {tab === 'profile' && <ProfileTab />}
        {tab === 'wallet' && <Wallet />}
        {tab === 'bookings' && <BookingsPanel />}
        {tab === 'support' && <SupportPanel />}
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <Screen topRight={<LogoutButton />} wide>
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
