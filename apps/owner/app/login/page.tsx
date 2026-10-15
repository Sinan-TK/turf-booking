'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, ErrorBanner, Input, Label } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-container-low p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-8 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-on-surface">Venue Owner Portal</h1>
        <p className="mb-6 text-sm text-on-surface-variant">Sign in to manage your venues.</p>

        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="mb-4">
          <Label>Email</Label>
          <Input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-6">
          <Label>Password</Label>
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <a
          href="/forgot-password"
          className="mt-4 block text-center text-sm text-on-surface-variant hover:text-on-surface"
        >
          Forgot password?
        </a>
      </form>
    </main>
  );
}
