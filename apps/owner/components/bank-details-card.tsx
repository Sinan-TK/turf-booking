'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Button, Card, ErrorBanner, FieldError, Input, Label, PasswordInput, Select, SuccessBanner, invalidClass } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';
import { Modal } from '@/components/modal';
import { hasErrors, type FieldErrors } from '@/lib/validation';

interface BankAccount {
  status: 'NONE' | 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  accountHolderName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  accountType?: 'SAVINGS' | 'CURRENT';
  failureReason?: string | null;
}

type Field = 'holder' | 'number' | 'confirm' | 'ifsc' | 'bank' | 'password';

const STATUS_NOTE: Record<string, string> = {
  NOT_VERIFIED: 'Waiting for Bookyo to check these details. Payouts can be held until they are verified.',
  VERIFIED: 'Verified. Your weekly payouts are sent to this account.',
  FAILED: 'Bookyo could not verify these details. Fix them below and save again.',
};

/**
 * Where this business's weekly payouts go. One set per business. Once saved the account number is only shown masked, and changing
 * anything needs the owner's password; every change sends the details back to "not verified" until the Bookyo team checks them again.
 */
export function BankDetailsCard() {
  const { data, loading, error: loadError, refetch } = useFetch<BankAccount>('/owner/bank-account');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    holder: '',
    number: '',
    confirm: '',
    ifsc: '',
    bank: '',
    type: 'SAVINGS',
    password: '',
  });
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const has = !!data && data.status !== 'NONE';

  // The full account number: shown only after the password is typed, and hidden again after half a minute.
  const [revealing, setRevealing] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  async function reveal(e: React.FormEvent) {
    e.preventDefault();
    if (!revealPassword) {
      setRevealError('Enter your password.');
      return;
    }
    setChecking(true);
    setRevealError(null);
    try {
      const res = await api.post<{ accountNumber: string }>('/owner/bank-account/reveal', { password: revealPassword });
      setRevealed(res.accountNumber);
      setRevealing(false);
      setRevealPassword('');
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Could not show the number');
      setRevealPassword('');
    } finally {
      setChecking(false);
    }
  }

  function open() {
    setForm({
      holder: data?.accountHolderName ?? '',
      number: '', // never pre-filled: the full number is not sent to the browser
      confirm: '',
      ifsc: data?.ifsc ?? '',
      bank: data?.bankName ?? '',
      type: data?.accountType ?? 'SAVINGS',
      password: '',
    });
    setErrors({});
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const digits = form.number.replace(/[\s-]/g, '');
    const found: FieldErrors<Field> = {
      holder: form.holder.trim().length < 2 ? 'Enter the account holder name.' : undefined,
      number: /^\d{9,18}$/.test(digits) ? undefined : 'The account number is 9 to 18 digits.',
      confirm: digits && form.confirm.replace(/[\s-]/g, '') !== digits ? 'The two account numbers do not match.' : undefined,
      ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase()) ? undefined : 'Enter a valid IFSC code, like HDFC0001234.',
      bank: form.bank.trim().length < 2 ? 'Enter the bank name.' : undefined,
      password: form.password ? undefined : 'Enter your password to save.',
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['holder', 'number', 'confirm', 'ifsc', 'bank', 'password'] as Field[]).find((k) => found[k]);
      if (first) document.getElementById(`bank-${first}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await api.put('/owner/bank-account', {
        accountHolderName: form.holder,
        accountNumber: form.number,
        ifsc: form.ifsc,
        bankName: form.bank,
        accountType: form.type,
        password: form.password,
      });
      setEditing(false);
      setSaved(true);
      refetch();
    } catch (err) {
      setForm((f) => ({ ...f, password: '' }));
      setError(err instanceof ApiError ? err.message : 'Could not save your bank details');
    } finally {
      setSaving(false);
    }
  }

  const field = (id: Field, label: string, props: React.ComponentProps<typeof Input>) => (
    <div>
      <Label htmlFor={`bank-${id}`}>{label}</Label>
      <Input id={`bank-${id}`} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `bank-${id}-error` : undefined} className={errors[id] ? invalidClass : ''} {...props} />
      <FieldError id={`bank-${id}-error`} message={errors[id]} />
    </div>
  );

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-on-surface">Bank details for payouts</h2>
        {has && <Badge value={data.status} />}
      </div>
      <p className="mb-5 text-xs text-on-surface-variant">One account for your whole business. Your weekly earnings are paid here.</p>

      {loading && !data && <p className="text-sm text-on-surface-variant">Loading…</p>}
      {loadError && <ErrorBanner message={loadError} />}
      {saved && <SuccessBanner message="Saved. Bookyo will check your details and mark them verified." />}

      {!editing && data && (
        <>
          {has ? (
            <>
              <dl className="grid gap-x-8 gap-y-4 rounded-xl bg-surface-container-low p-4 text-sm sm:grid-cols-2">
                <Row label="Account holder" value={data.accountHolderName} />
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Account number</dt>
                  <dd data-testid="account-number" className="mt-0.5 break-words font-mono font-medium tracking-wide text-on-surface">{revealed ?? data.accountNumber}</dd>
                  <dd className="mt-1">
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={() => {
                        if (revealed) setRevealed(null);
                        else {
                          setRevealError(null);
                          setRevealing((v) => !v);
                        }
                      }}
                    >
                      <SvgIcon name={revealed ? 'eyeOff' : 'eye'} className="h-3.5 w-3.5" />
                      {revealed ? 'Hide account number' : 'View account number'}
                    </button>
                  </dd>
                </div>
                <Row label="IFSC" value={data.ifsc} mono />
                <Row label="Bank" value={data.bankName} />
                <Row label="Account type" value={data.accountType === 'CURRENT' ? 'Current' : 'Savings'} />
              </dl>
              <p className="mt-3 text-xs text-on-surface-variant">{STATUS_NOTE[data.status]}</p>
              {data.status === 'FAILED' && data.failureReason && (
                <p role="alert" className="mt-2 rounded-lg bg-error-container px-3 py-2 text-xs text-on-error-container">
                  {data.failureReason}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-on-surface-variant">You have not added your bank details yet. Add them so Bookyo knows where to send your payouts.</p>
          )}
          <Button type="button" variant="secondary" className="mt-4" onClick={open}>
            {has ? 'Change bank details' : 'Add bank details'}
          </Button>
        </>
      )}

      {editing && (
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          {error && <div className="sm:col-span-2"><ErrorBanner message={error} /></div>}
          {has && <p className="sm:col-span-2 rounded-lg bg-tertiary-container/30 px-3 py-2 text-xs text-on-tertiary-container">Saving changes marks your details as not verified until Bookyo checks them again.</p>}
          {field('holder', 'Account holder name', { value: form.holder, autoComplete: 'off', onChange: (e) => set('holder', e.target.value) })}
          {field('number', 'Account number', { value: form.number, inputMode: 'numeric', autoComplete: 'off', onChange: (e) => set('number', e.target.value) })}
          {field('confirm', 'Confirm account number', { value: form.confirm, inputMode: 'numeric', autoComplete: 'off', onChange: (e) => set('confirm', e.target.value) })}
          {field('ifsc', 'IFSC code', { value: form.ifsc, autoComplete: 'off', placeholder: 'HDFC0001234', onChange: (e) => set('ifsc', e.target.value.toUpperCase()) })}
          {field('bank', 'Bank name', { value: form.bank, autoComplete: 'off', onChange: (e) => set('bank', e.target.value) })}
          <div>
            <Label htmlFor="bank-type">Account type</Label>
            <Select id="bank-type" value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="SAVINGS">Savings</option>
              <option value="CURRENT">Current</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bank-password">Your password</Label>
            <PasswordInput
              id="bank-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'bank-password-error' : undefined}
              className={errors.password ? invalidClass : ''}
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
            <FieldError id="bank-password-error" message={errors.password} />
            <p className="mt-1 text-xs text-on-surface-variant">We ask for it again so nobody else can change where your money goes.</p>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save bank details'}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {revealing && !revealed && (
        <Modal title="View account number" subtitle="Type your password to see the full number." onClose={() => setRevealing(false)} busy={checking}>
          <form onSubmit={reveal} className="space-y-4 p-6" noValidate>
            <div>
              <Label htmlFor="bank-reveal-password">Your password</Label>
              <PasswordInput
                id="bank-reveal-password"
                autoComplete="current-password"
                aria-invalid={!!revealError}
                aria-describedby={revealError ? 'bank-reveal-error' : undefined}
                className={revealError ? invalidClass : ''}
                value={revealPassword}
                onChange={(e) => {
                  setRevealPassword(e.target.value);
                  setRevealError(null);
                }}
              />
              <FieldError id="bank-reveal-error" message={revealError ?? undefined} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={checking} onClick={() => setRevealing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={checking}>
                {checking ? 'Checking…' : 'Show number'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</dt>
      <dd className={`mt-0.5 break-words font-medium text-on-surface ${mono ? 'font-mono tracking-wide' : ''}`}>{value || '—'}</dd>
    </div>
  );
}
