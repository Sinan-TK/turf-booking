'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import { Button, ErrorBanner, FieldError, Label, invalidClass } from '@/components/ui';
import { newPasswordError } from '@/lib/validation';

// Landed on from the emailed link: both password-reset links and a
// first-time admin's invite link point here as /reset-password?token=…
// The token is single-use and expires; the API consumes it and sets the
// new password. The user then signs in with it — this page doesn't log
// anyone in.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    setToken(value);
    if (!value) setError('This link is invalid or incomplete. Request a new one.');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = newPasswordError(password);
    setPasswordMsg(problem);
    if (problem) {
      document.getElementById('reset-password')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/admin/reset-password', { token, password });
      router.push('/login');
    } catch {
      setError('Could not set your password. The link may have expired — request a new one.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Set a new password</h1>
        <p className="mb-6 text-sm text-gray-500">Choose a new password for your account.</p>

        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mb-6">
          <Label htmlFor="reset-password">New password</Label>
          <PasswordInput
            id="reset-password"
            autoComplete="new-password"
            value={password}
            aria-invalid={!!passwordMsg}
            aria-describedby={passwordMsg ? 'reset-password-error' : undefined}
            className={passwordMsg ? invalidClass : ''}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordMsg(undefined);
            }}
          />
          <FieldError id="reset-password-error" message={passwordMsg} />
          <p className="mt-1.5 text-xs text-gray-500">At least 8 characters, with a capital letter, a small letter, a number and a special character.</p>
        </div>
        <Button type="submit" loading={submitting} disabled={!token} className="w-full">
          {submitting ? 'Saving…' : 'Set password'}
        </Button>
        <a href="/forgot-password" className="mt-4 block text-center text-sm text-gray-500 hover:text-gray-700">
          Request a new link
        </a>
      </form>
    </main>
  );
}
