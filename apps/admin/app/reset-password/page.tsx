'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, ErrorBanner, Input, Label } from '@/components/ui';

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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    setToken(value);
    if (!value) setError('This link is invalid or incomplete. Request a new one.');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
          <Label>New password</Label>
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
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
