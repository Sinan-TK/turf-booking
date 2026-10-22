'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';
import { emailError } from '@/lib/validation';

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = emailError(email);
    setEmailMsg(problem);
    if (problem) {
      document.getElementById('forgot-email')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      // Always show success, whether or not the email exists — never
      // let this page reveal which owner emails are registered.
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      {sent ? (
        <p className="rounded-lg bg-primary-fixed-dim/20 px-4 py-3 text-sm text-on-primary-container">
          If an account exists for that email, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          {error && (
            <div className="mb-4">
              <ErrorBanner message={error} />
            </div>
          )}
          <div className="mb-6">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              aria-invalid={!!emailMsg}
              aria-describedby={emailMsg ? 'forgot-email-error' : undefined}
              className={emailMsg ? invalidClass : ''}
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailMsg(undefined);
              }}
            />
            <FieldError id="forgot-email-error" message={emailMsg} />
          </div>
          <Button type="submit" disabled={submitting} className="w-full py-2.5">
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <a href="/login" className="mt-5 block text-center text-sm text-on-surface-variant transition-colors hover:text-primary">
        Back to sign in
      </a>
    </AuthShell>
  );
}
