'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { PhoneInput, formatPhone } from '@/components/phone-input';
import { Button, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';
import { emailError, indianPhoneError, type FieldErrors } from '@/lib/validation';
import { CUSTOMER_SITE_URL } from '@/lib/legal';

type Field = 'name' | 'email' | 'businessName' | 'phone' | 'terms';

/** The three steps: who you are, your business, then a look over everything before it is sent. */
const STEPS = [
  { title: 'About you', blurb: 'Who should we send the sign-in link to?' },
  { title: 'Business', blurb: 'Tell us about the venue business you run.' },
  { title: 'Review', blurb: 'Check your details and agree to the terms.' },
] as const;

/** Which fields each step asks for (the review step asks for the terms). */
const STEP_FIELDS: Field[][] = [['name', 'email'], ['businessName', 'phone'], ['terms']];

const link = 'font-semibold text-primary underline underline-offset-2';

/** A required text field: the message when empty, and its length limits. */
function required(value: string, empty: string, min: number, max: number, label: string): string | undefined {
  const v = value.trim();
  if (!v) return empty;
  if (v.length < min) return `${label} needs at least ${min} characters.`;
  if (v.length > max) return `${label} can be at most ${max} characters.`;
}

/** The progress bar: finished steps show a tick, the current one is filled, the rest are outlined. */
function Progress({ step }: { step: number }) {
  return (
    <ol aria-label="Sign-up progress" className="mb-7 flex items-center">
      {STEPS.map((s, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={s.title} aria-current={current ? 'step' : undefined} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
            <span className="flex items-center gap-2.5">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  done ? 'bg-primary text-on-primary' : current ? 'bg-primary text-on-primary ring-4 ring-primary/20' : 'bg-surface-container text-on-surface-variant ring-1 ring-outline-variant/60'
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 10.5l4 4 8-9" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`hidden whitespace-nowrap text-sm font-semibold sm:block ${current ? 'text-on-surface' : done ? 'text-on-surface-variant' : 'text-on-surface-variant/70'}`}>
                <span className="sr-only">{done ? 'Done: ' : current ? 'Current step: ' : ''}</span>
                {s.title}
              </span>
            </span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className={`mx-3 h-0.5 flex-1 rounded-full transition-colors ${done ? 'bg-primary' : 'bg-outline-variant/50'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** A venue owner creating their own account, one small step at a time. No password here: an emailed link, which also proves the address, lets them choose one. */
export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', email: '', businessName: '', phone: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const stepBox = useRef<HTMLDivElement>(null);

  // A new step puts the cursor in its first field (or, on the review step, on the heading), so the keyboard carries on where the eyes are.
  useEffect(() => {
    const target = stepBox.current?.querySelector<HTMLElement>('input:not([type="checkbox"])') ?? stepBox.current?.querySelector<HTMLElement>('[data-step-heading]');
    target?.focus();
  }, [step]);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setBanner(null);
    setErrors((p) => (p[field] ? { ...p, [field]: undefined } : p));
  }

  const check = (): FieldErrors<Field> => ({
    name: required(form.name, 'Enter your name.', 1, 150, 'Your name'),
    email: emailError(form.email),
    businessName: required(form.businessName, 'Enter the business or venue name.', 2, 150, 'The business or venue name'),
    phone: form.phone ? indianPhoneError(form.phone) : 'Enter your mobile number.',
    terms: accepted ? undefined : 'Please accept the Venue Partner Terms to continue.',
  });

  /** Checks the fields of one step; shows what is wrong and puts the cursor on the first problem. */
  function stepIsValid(index: number): boolean {
    const all = check();
    const mine = STEP_FIELDS[index]!;
    const found = Object.fromEntries(mine.map((f) => [f, all[f]])) as FieldErrors<Field>;
    setErrors((p) => ({ ...p, ...found }));
    const bad = mine.find((f) => found[f]);
    if (bad) document.getElementById(`register-${bad}`)?.focus();
    return !bad;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!stepIsValid(step)) return;
    if (step < STEPS.length - 1) return setStep(step + 1);

    // The last step: every earlier step is checked again, in case something was changed on the way back.
    const all = check();
    const firstBad = [0, 1].find((i) => STEP_FIELDS[i]!.some((f) => all[f]));
    if (firstBad !== undefined) {
      setStep(firstBad);
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
    const NEXT = [
      { title: 'Open the email', text: `We sent a link to ${sentTo}.` },
      { title: 'Choose your password', text: 'The link lets you set it and sign in.' },
      { title: 'Add your venue', text: 'It goes live for customers once our team has had a look at it.' },
    ];
    return (
      <AuthShell title="Check your email" subtitle="Your account is created. One last step to open it.">
        <ol className="space-y-4">
          {NEXT.map((n, i) => (
            <li key={n.title} className="flex gap-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{i + 1}</span>
              <span>
                <span className="block text-sm font-bold text-on-surface">{n.title}</span>
                <span className="block text-sm leading-relaxed text-on-surface-variant">{n.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm leading-relaxed text-on-surface-variant">
          Already had an account with this email? Use <a href="/forgot-password" className={link}>Forgot password</a> to get back in.
        </p>
        <a href="/login" className="mt-6 block text-center text-sm text-on-surface-variant transition-colors hover:text-primary">
          Back to sign in
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="List your venue" subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]!.blurb}`}>
      <Progress step={step} />

      <form onSubmit={onSubmit} noValidate>
        {banner && (
          <div className="mb-4">
            <ErrorBanner message={banner} />
          </div>
        )}

        {/* Re-keyed per step so each one eases in; the motion is off for anyone who asks for less. */}
        <div key={step} ref={stepBox} className="motion-safe:animate-[rise_0.35s_ease-out_both]">
          {step === 0 && (
            <>
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
              <div className="mb-6">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={form.email}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'register-email-error' : 'register-email-hint'}
                  className={errors.email ? invalidClass : ''}
                  onChange={(e) => set('email', e.target.value)}
                />
                <FieldError id="register-email-error" message={errors.email} />
                {!errors.email && (
                  <p id="register-email-hint" className="mt-1.5 text-xs text-on-surface-variant">
                    We email you a link to set your password, so use an address you can open.
                  </p>
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
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
              <div className="mb-6">
                <Label htmlFor="register-phone">Mobile number</Label>
                <PhoneInput id="register-phone" value={form.phone} invalid={!!errors.phone} onValueChange={(digits) => set('phone', digits)} />
                <FieldError id="register-phone-error" message={errors.phone} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 data-step-heading tabIndex={-1} className="sr-only">
                Review your details
              </h2>
              <dl className="mb-5 divide-y divide-outline-variant/40 rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                {(
                  [
                    ['Your name', form.name.trim(), 0],
                    ['Email', form.email.trim(), 0],
                    ['Business or venue', form.businessName.trim(), 1],
                    ['Mobile number', formatPhone(`+91${form.phone}`), 1],
                  ] as const
                ).map(([label, value, back]) => (
                  <div key={label} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-on-surface-variant">{label}</dt>
                      <dd className="truncate text-sm font-semibold text-on-surface">{value}</dd>
                    </div>
                    <button type="button" onClick={() => setStep(back)} aria-label={`Change ${label.toLowerCase()}`} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                      Change
                    </button>
                  </div>
                ))}
              </dl>

              <div className="mb-6">
                <label className="flex items-start gap-2.5 text-sm leading-relaxed text-on-surface-variant">
                  <input
                    id="register-terms"
                    type="checkbox"
                    checked={accepted}
                    aria-invalid={!!errors.terms}
                    aria-describedby={errors.terms ? 'register-terms-error' : undefined}
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
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {step > 0 && (
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => setStep(step - 1)} className="px-5 py-2.5">
              Back
            </Button>
          )}
          <Button type="submit" disabled={submitting} className="flex-1 py-2.5">
            {step < STEPS.length - 1 ? 'Continue' : submitting ? 'Creating your account…' : 'Create account'}
          </Button>
        </div>

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
