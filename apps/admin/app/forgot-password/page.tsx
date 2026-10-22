'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
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
      // let this page reveal which admin emails are registered.
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-gray-900">Reset your password</h1>
        <p className="mb-6 text-sm text-gray-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {sent ? (
          <p className="text-sm text-gray-700">
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
                autoComplete="username"
                value={email}
                aria-invalid={!!emailMsg}
                aria-describedby={emailMsg ? 'forgot-email-error' : undefined}
                className={emailMsg ? invalidClass : ''}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailMsg(undefined);
                }}
              />
              <FieldError id="forgot-email-error" message={emailMsg} />
            </div>
            <Button type="submit" loading={submitting} className="w-full">
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}

        <a href="/login" className="mt-4 block text-center text-sm text-gray-500 hover:text-gray-700">
          Back to sign in
        </a>
      </div>
    </main>
  );
}
