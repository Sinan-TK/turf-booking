'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, ErrorBanner, Input, Label } from '@/components/ui';
import { Icon } from '@/components/icons';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gray-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
            <Icon name="venue" className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">Venue Booking</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Every venue, owner and booking in one place.
          </h2>
          <p className="mt-4 text-base text-gray-400">
            Create venue types, manage owners and keep the whole platform running from a single console.
          </p>
        </div>
        <p className="relative text-xs text-gray-500">Super Admin console</p>
      </aside>

      <section className="flex items-center justify-center bg-gray-50 p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm animate-[rise_0.35s_ease-out_both]">
          <span className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 lg:hidden">
            <Icon name="venue" className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mb-8 mt-1.5 text-sm text-gray-500">Sign in to manage the platform.</p>

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
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="mb-6">
            <Label>Password</Label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                className="pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-gray-400 transition-colors hover:text-gray-700"
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
          <Button type="submit" loading={submitting} className="w-full py-2.5">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <a
            href="/forgot-password"
            className="mt-5 block text-center text-sm text-gray-500 transition-colors hover:text-brand-700"
          >
            Forgot password?
          </a>
        </form>
      </section>
    </main>
  );
}
