'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { Button, Card, ErrorBanner, FieldError, Icon, Label, SuccessBanner, invalidClass } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';
import { Screen } from '@/components/screen';
import { newPasswordError } from '@/lib/validation';

/**
 * Where the emailed link lands: choose a password. Works for a first password (a customer who signed up with
 * Google) and for a forgotten one. It does not sign anyone in; afterwards they sign in the usual way.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { requireLogin } = useCustomer();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msgs, setMsgs] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [linkBad, setLinkBad] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read from the address after the page loads, so this page needs no server-side rendering of the query.
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    const found = { password: newPasswordError(password), confirm: password !== confirm ? 'The two passwords are not the same.' : undefined };
    setMsgs(found);
    if (found.password) return void document.getElementById('reset-password')?.focus();
    if (found.confirm) return void document.getElementById('reset-confirm')?.focus();
    setBusy(true);
    setError(null);
    try {
      await api.post('/customer-auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && /invalid or has expired/i.test(err.message)) setLinkBad(true);
      else setError(err instanceof ApiError ? err.message : 'Could not set your password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const noLink = token === '' || linkBad;

  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="handshake" />
        Set your password
      </h1>
      <Card>
        {token === null && <p className="text-center text-sm text-gray-500">Loading…</p>}

        {noLink && (
          <div className="space-y-3 text-center">
            <ErrorBanner message="This link is invalid or has expired." />
            <p className="text-sm text-gray-600">Links work once and expire after an hour. Ask for a new one from the sign-in screen: choose Forgot password.</p>
            <Link href="/" className="inline-block rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600">
              Back to the site
            </Link>
          </div>
        )}

        {done && (
          <div className="space-y-3 text-center">
            <SuccessBanner message="Your password is set. Sign in with your email and password." />
            <Button
              className="w-full"
              onClick={() =>
                requireLogin()
                  .then(() => router.push('/'))
                  .catch(() => undefined)
              }
            >
              Sign in
            </Button>
          </div>
        )}

        {token && !noLink && !done && (
          <form onSubmit={onSubmit} noValidate className="space-y-3">
            {error && (
              <div role="alert">
                <ErrorBanner message={error} />
              </div>
            )}
            <div>
              <Label htmlFor="reset-password">New password</Label>
              <PasswordInput
                id="reset-password"
                autoFocus
                autoComplete="new-password"
                aria-invalid={!!msgs.password}
                className={msgs.password ? invalidClass : ''}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setMsgs((m) => ({ ...m, password: undefined }));
                }}
              />
              <FieldError id="reset-password-error" message={msgs.password} />
              <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
            </div>
            <div>
              <Label htmlFor="reset-confirm">Repeat the password</Label>
              <PasswordInput
                id="reset-confirm"
                autoComplete="new-password"
                aria-invalid={!!msgs.confirm}
                className={msgs.confirm ? invalidClass : ''}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setMsgs((m) => ({ ...m, confirm: undefined }));
                }}
              />
              <FieldError id="reset-confirm-error" message={msgs.confirm} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </Button>
          </form>
        )}
      </Card>
    </Screen>
  );
}
