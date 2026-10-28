'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, FieldError, Input, Label, PasswordInput, invalidClass } from '@/components/ui';
import { emailError, hasErrors } from '@/lib/validation';

type Field = 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

function validate(email: string, password: string): FieldErrors {
  return { email: emailError(email), password: password ? undefined : 'Enter your password.' };
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clear(field: Field) {
    setBanner(null);
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const found = validate(email, password);
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
    <AuthShell title="Welcome back" subtitle="Sign in to manage your venues.">
      <form onSubmit={onSubmit} noValidate>
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
              clear('email');
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
              clear('password');
            }}
          />
          <FieldError id="login-password-error" message={errors.password} />
        </div>
        <Button type="submit" disabled={submitting} className="w-full py-2.5">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <a
          href="/forgot-password"
          className="mt-5 block text-center text-sm text-on-surface-variant transition-colors hover:text-primary"
        >
          Forgot password?
        </a>
      </form>

    </AuthShell>
  );
}
