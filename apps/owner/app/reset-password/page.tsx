'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, FieldError, Label, PasswordInput, invalidClass } from '@/components/ui';
import { newPasswordError } from '@/lib/validation';

// Landed on from the emailed link: both password-reset links and a
// first-time, admin-invited owner's invite link point here as
// /reset-password?token=… The token is single-use and expires; the API
// consumes it and sets the new password. The user then signs in with it —
// this page doesn't log anyone in.
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
      await api.post('/auth/owner/reset-password', { token, password });
      router.push('/login');
    } catch {
      setError('Could not set your password. The link may have expired — request a new one.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a new password for your account.">
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mb-6">
          <Label htmlFor="reset-password">New password</Label>
          <PasswordInput
            id="reset-password"
            aria-invalid={!!passwordMsg}
            aria-describedby={passwordMsg ? 'reset-password-error' : undefined}
            className={passwordMsg ? invalidClass : ''}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordMsg(undefined);
            }}
          />
          <FieldError id="reset-password-error" message={passwordMsg} />
          <p className="mt-1.5 text-xs text-on-surface-variant">At least 8 characters.</p>
        </div>
        <Button type="submit" disabled={submitting || !token} className="w-full py-2.5">
          {submitting ? 'Saving…' : 'Set password'}
        </Button>
        <a
          href="/forgot-password"
          className="mt-5 block text-center text-sm text-on-surface-variant transition-colors hover:text-primary"
        >
          Request a new link
        </a>
      </form>
    </AuthShell>
  );
}
