'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { PhoneInput } from '@/components/phone-input';
import { Button, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';
import { emailError, hasErrors, indianPhoneError, type FieldErrors } from '@/lib/validation';
import { CUSTOMER_SITE_URL } from '@/lib/legal';

type Field = 'businessName' | 'name' | 'email' | 'phone' | 'terms';

const link = 'font-semibold text-primary underline underline-offset-2';

/** A required text field: the message when empty, and its length limits. */
function required(value: string, empty: string, min: number, max: number, label: string): string | undefined {
  const v = value.trim();
  if (!v) return empty;
  if (v.length < min) return `${label} needs at least ${min} characters.`;
  if (v.length > max) return `${label} can be at most ${max} characters.`;
}

/** A venue owner creating their own account. No password here: an emailed link, which also proves the address, lets them choose one. */
export default function RegisterPage() {
  const [form, setForm] = useState({ businessName: '', name: '', email: '', phone: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setBanner(null);
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const found: FieldErrors<Field> = {
      businessName: required(form.businessName, 'Enter the business or venue name.', 2, 150, 'The business or venue name'),
      name: required(form.name, 'Enter your name.', 1, 150, 'Your name'),
      email: emailError(form.email),
      phone: form.phone ? indianPhoneError(form.phone) : 'Enter your mobile number.',
      terms: accepted ? undefined : 'Please accept the Venue Partner Terms to continue.',
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['businessName', 'name', 'email', 'phone', 'terms'] as Field[]).find((f) => found[f])!;
      document.getElementById(`register-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/owner/register', {
        businessName: form.businessName.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone,
        acceptTerms: true,
      });
      setSentTo(form.email.trim());
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 429) setBanner('Too many sign-up attempts. Please try again in an hour.');
      else if (status === 400 && err instanceof ApiError) setBanner(err.message || 'Please check the details and try again.');
      else setBanner('We could not create your account right now. Please try again in a few minutes.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle="One last step to open your account.">
        <p className="rounded-lg bg-primary-fixed-dim/20 px-4 py-3 text-sm leading-relaxed text-on-primary-container">
          We sent a link to <strong>{sentTo}</strong>. Open it to choose your password and sign in. If you already have an account with this email, use <a href="/forgot-password" className={link}>Forgot password</a> instead.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
          After you sign in you can add your venue. It goes live for customers once our team has had a look at it.
        </p>
        <a href="/login" className="mt-6 block text-center text-sm text-on-surface-variant transition-colors hover:text-primary">
          Back to sign in
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="List your venue" subtitle="Create an owner account to take bookings online.">
      <form onSubmit={onSubmit} noValidate>
        {banner && (
          <div className="mb-4">
            <ErrorBanner message={banner} />
          </div>
        )}
        <div className="mb-4">
          <Label htmlFor="register-businessName">Business or venue name</Label>
          <Input
            id="register-businessName"
            autoComplete="organization"
            value={form.businessName}
            aria-invalid={!!errors.businessName}
            aria-describedby={errors.businessName ? 'register-businessName-error' : undefined}
            className={errors.businessName ? invalidClass : ''}
            onChange={(e) => set('businessName', e.target.value)}
          />
          <FieldError id="register-businessName-error" message={errors.businessName} />
        </div>
        <div className="mb-4">
          <Label htmlFor="register-name">Your name</Label>
          <Input
            id="register-name"
            autoComplete="name"
            value={form.name}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'register-name-error' : undefined}
            className={errors.name ? invalidClass : ''}
            onChange={(e) => set('name', e.target.value)}
          />
          <FieldError id="register-name-error" message={errors.name} />
        </div>
        <div className="mb-4">
          <Label htmlFor="register-email">Email</Label>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={form.email}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'register-email-error' : undefined}
            className={errors.email ? invalidClass : ''}
            onChange={(e) => set('email', e.target.value)}
          />
          <FieldError id="register-email-error" message={errors.email} />
        </div>
        <div className="mb-4">
          <Label htmlFor="register-phone">Mobile number</Label>
          <PhoneInput id="register-phone" value={form.phone} invalid={!!errors.phone} onValueChange={(digits) => set('phone', digits)} />
          <FieldError id="register-phone-error" message={errors.phone} />
        </div>

        <div className="mb-6">
          <label className="flex items-start gap-2.5 text-sm leading-relaxed text-on-surface-variant">
            <input
              id="register-terms"
              type="checkbox"
              checked={accepted}
              aria-invalid={!!errors.terms}
              onChange={(e) => {
                setAccepted(e.target.checked);
                setErrors((p) => ({ ...p, terms: undefined }));
              }}
              className="mt-1 h-4 w-4 shrink-0 rounded border-outline accent-primary"
            />
            <span>
              I agree to the{' '}
              <a href="/partner-terms" target="_blank" rel="noopener" className={link}>
                Venue Partner Terms
              </a>{' '}
              and the{' '}
              <a href={`${CUSTOMER_SITE_URL}/privacy`} target="_blank" rel="noopener" className={link}>
                Privacy Policy
              </a>
              .
            </span>
          </label>
          <FieldError id="register-terms-error" message={errors.terms} />
        </div>

        <Button type="submit" disabled={submitting} className="w-full py-2.5">
          {submitting ? 'Creating your account…' : 'Create account'}
        </Button>
        <p className="mt-5 text-center text-sm text-on-surface-variant">
          Already have an account?{' '}
          <a href="/login" className={link}>
            Sign in
          </a>
        </p>
      </form>
    </AuthShell>
  );
}
