'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { emailError, hasErrors, type FieldErrors } from '@/lib/validation';
import { Icon } from '@/components/icons';
import { PasswordInput } from '@/components/password-input';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'email' | 'password'>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const found: FieldErrors<'email' | 'password'> = {
      email: emailError(email),
      password: password ? undefined : 'Enter your password.',
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.email ? 'login-email' : 'login-password')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.push('/dashboard');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401 || status === 400) {
        // Which half was wrong is deliberately not revealed.
        setErrors({ password: 'Incorrect email or password.' });
        document.getElementById('login-password')?.focus();
      } else if (status === 429) {
        setBanner('Too many sign-in attempts. Wait a minute and try again.');
      } else {
        setBanner('We could not sign you in right now. Please try again.');
      }
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
        <form onSubmit={onSubmit} noValidate className="w-full max-w-sm animate-[rise_0.35s_ease-out_both]">
          <span className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30 lg:hidden">
            <Icon name="venue" className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mb-8 mt-1.5 text-sm text-gray-500">Sign in to manage the platform.</p>

          {banner && (
            <div className="mb-4">
              <ErrorBanner message={banner} />
            </div>
          )}

          <div className="mb-4">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              className={errors.email ? invalidClass : ''}
              onChange={(e) => {
                setEmail(e.target.value);
                setBanner(null);
                setErrors((p) => ({ ...p, email: undefined }));
              }}
            />
            <FieldError id="login-email-error" message={errors.email} />
          </div>
          <div className="mb-6">
            <Label htmlFor="login-password">Password</Label>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'login-password-error' : undefined}
              className={errors.password ? invalidClass : ''}
              onChange={(e) => {
                setPassword(e.target.value);
                setBanner(null);
                setErrors((p) => ({ ...p, password: undefined }));
              }}
            />
            <FieldError id="login-password-error" message={errors.password} />
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
