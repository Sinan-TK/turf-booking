'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Customer } from '@/lib/customer';
import { Button, ErrorBanner, FieldError, Icon, Input, Label, SuccessBanner, invalidClass } from '@/components/ui';
import { GoogleButton } from '@/components/google-button';
import { PasswordInput } from '@/components/password-input';
import { codeError, emailError, indianPhoneError, nameError, newPasswordError, passwordError } from '@/lib/validation';
import { PhoneInput } from '@/components/phone-input';

type View = 'home' | 'signup-code' | 'forgot' | 'reset' | 'profile' | 'phone' | 'code';
type Tab = 'signin' | 'signup';

/**
 * Which ways of signing in are shown (build-time, comma separated). The phone one-time code is fully built but
 * off for now: add `phone` here (NEXT_PUBLIC_CUSTOMER_LOGIN_METHODS=google,email,phone) to show it.
 */
const METHODS = (process.env.NEXT_PUBLIC_CUSTOMER_LOGIN_METHODS ?? 'google,email').split(',').map((m) => m.trim());
const HAS = { google: METHODS.includes('google'), email: METHODS.includes('email'), phone: METHODS.includes('phone') };

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const BAD_LOGIN =
  'Incorrect email or password. Signed up with Google? Use the Google button, or choose Forgot password to set a password first.';

type Msgs = Partial<Record<'name' | 'email' | 'phone' | 'password' | 'confirm' | 'code', string>>;

export function LoginDialog({
  customer,
  onLoggedIn,
  onIncomplete,
  onDismiss,
}: {
  /** Someone already signed in who is missing a phone number or name: the dialog opens on that step. */
  customer?: Customer | null;
  onLoggedIn: (customer: Customer) => void;
  /** Signed in, but the profile step was closed before it was complete. */
  onIncomplete: (customer: Customer) => void;
  onDismiss: () => void;
}) {
  const [view, setView] = useState<View>(customer ? 'profile' : 'home');
  const [tab, setTab] = useState<Tab>('signin');
  // The customer who is signed in but still has to finish their profile.
  const [signed, setSigned] = useState<Customer | null>(customer ?? null);
  const [name, setName] = useState(customer?.name ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Handed back when a sign-up starts; only this browser can finish that sign-up.
  const [ticket, setTicket] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msgs>({});
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  function close() {
    if (signed) onIncomplete(signed);
    else onDismiss();
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const go = (next: View) => {
    setError(null);
    setMsgs({});
    setNotice(null);
    setView(next);
  };
  const clearMsg = (key: keyof Msgs) => setMsgs((m) => ({ ...m, [key]: undefined }));
  const focusFirstInvalid = (found: Msgs, ids: Record<string, string>) => {
    const first = Object.keys(found).find((k) => found[k as keyof Msgs]);
    if (first) document.getElementById(ids[first] ?? '')?.focus();
  };

  /** A sign-in worked. Done, unless the profile still needs a name or phone number. */
  function signedIn(c: Customer, needsProfile: boolean) {
    if (!needsProfile) return onLoggedIn(c);
    setSigned(c);
    if (c.name) setName(c.name);
    go('profile');
  }

  /**
   * Runs a request. A failure shows in the banner at the top, unless `field` says it belongs to a field (a function
   * decides from the error): then it is shown under that field, in red, so it is next to what is wrong.
   */
  async function run(action: () => Promise<void>, fallback: string, field?: keyof Msgs | ((err: ApiError) => keyof Msgs | undefined)) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      const target = err instanceof ApiError ? (typeof field === 'function' ? field(err) : field) : undefined;
      if (err instanceof ApiError && target) {
        setMsgs({ [target]: err.message });
        document.getElementById(target === 'code' ? 'login-code' : `login-${target}`)?.focus();
      } else {
        setError(err instanceof ApiError ? err.message : fallback);
      }
    } finally {
      setBusy(false);
    }
  }

  // --- Google ---------------------------------------------------------------
  const onGoogle = (credential: string) =>
    run(async () => {
      const res = await api.post<{ customer: Customer; needsProfile: boolean }>('/customer-auth/google', { credential });
      signedIn(res.customer, res.needsProfile);
    }, 'Google sign-in failed. Please try again.');

  // --- Email + password -----------------------------------------------------
  function signIn(e: React.FormEvent) {
    e.preventDefault();
    const found: Msgs = { email: emailError(email), password: passwordError(password) };
    setMsgs(found);
    if (found.email || found.password) return focusFirstInvalid(found, { email: 'login-email', password: 'login-password' });
    return run(async () => {
      try {
        const res = await api.post<{ customer: Customer; needsProfile: boolean }>('/customer-auth/login', { email: email.trim(), password });
        signedIn(res.customer, res.needsProfile);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new ApiError(401, BAD_LOGIN);
        throw err;
      }
    }, 'Could not sign in. Please try again.');
  }

  function signUp(e: React.FormEvent) {
    e.preventDefault();
    const found: Msgs = {
      name: nameError(name),
      email: emailError(email),
      phone: indianPhoneError(phone),
      password: newPasswordError(password),
    };
    setMsgs(found);
    if (Object.values(found).some(Boolean)) {
      return focusFirstInvalid(found, { name: 'login-name', email: 'login-email', phone: 'login-phone', password: 'login-password' });
    }
    return run(async () => {
      try {
        const res = await api.post<{ resendAfterSeconds: number; ticket: string }>('/customer-auth/signup', {
          name: name.trim(),
          email: email.trim(),
          phone,
          password,
        });
        setTicket(res.ticket);
        setResendIn(res.resendAfterSeconds);
        setCode('');
        go('signup-code');
      } catch (err) {
        // A taken email or number belongs under its own field.
        if (err instanceof ApiError && err.status === 409) {
          setMsgs(/number/i.test(err.message) ? { phone: err.message } : { email: err.message });
          setError(null);
          return;
        }
        throw err;
      }
    }, 'Could not create your account. Please try again.');
  }

  function forgot(e: React.FormEvent) {
    e.preventDefault();
    const problem = emailError(email);
    setMsgs({ email: problem });
    if (problem) return document.getElementById('login-email')?.focus();
    return run(async () => {
      await api.post('/customer-auth/forgot-password', { email: email.trim() });
      setResendIn(30);
      setCode('');
      setPassword('');
      setConfirm('');
      go('reset');
    }, 'Could not send the code. Please try again.');
  }

  /** The emailed code creates the account (sign-up) and signs the customer in. */
  function verifySignUp(e: React.FormEvent) {
    e.preventDefault();
    const problem = codeError(code);
    setMsgs({ code: problem });
    if (problem) return document.getElementById('login-code')?.focus();
    return run(async () => {
      const res = await api.post<{ customer: Customer; needsProfile: boolean }>('/customer-auth/signup/verify', { email: email.trim(), code, ticket });
      signedIn(res.customer, res.needsProfile);
    }, 'Could not verify the code. Please try again.', 'code');
  }

  /** Asks for a fresh sign-up code (the details are still in the form). */
  function resendSignUp() {
    return run(async () => {
      const res = await api.post<{ resendAfterSeconds: number; ticket: string }>('/customer-auth/signup', {
        name: name.trim(),
        email: email.trim(),
        phone,
        password,
      });
      setTicket(res.ticket);
      setResendIn(res.resendAfterSeconds);
      setCode('');
      setNotice('We sent a new code.');
    }, 'Could not send the code. Please try again.', 'code');
  }

  function resendReset() {
    return run(async () => {
      await api.post('/customer-auth/forgot-password', { email: email.trim() });
      setResendIn(30);
      setNotice('If an account exists for that email, a new code is on its way.');
    }, 'Could not send the code. Please try again.', 'code');
  }

  function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    const found: Msgs = {
      code: codeError(code),
      password: newPasswordError(password),
      confirm: password !== confirm ? 'The two passwords are not the same.' : undefined,
    };
    setMsgs(found);
    if (Object.values(found).some(Boolean)) return focusFirstInvalid(found, { code: 'login-code', password: 'login-password', confirm: 'login-confirm' });
    return run(async () => {
      await api.post('/customer-auth/reset-password', { email: email.trim(), code, password });
      setPassword('');
      setConfirm('');
      setCode('');
      setTab('signin');
      go('home');
      setNotice('Your password is set. Sign in with your email and new password.');
    }, 'Could not set your password. Please try again.', (err) => (/code|attempt/i.test(err.message) ? 'code' : undefined));
  }

  // --- Profile step (name, and a phone number if there is none) -------------
  function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!signed) return;
    const needsPhone = !signed.phone;
    const found: Msgs = { name: nameError(name), phone: needsPhone ? indianPhoneError(phone) : undefined };
    setMsgs(found);
    if (found.name || found.phone) return focusFirstInvalid(found, { name: 'login-name', phone: 'login-phone' });
    return run(async () => {
      try {
        const updated = await api.patch<Customer>('/customer-auth/me', {
          name: name.trim(),
          ...(needsPhone ? { phone } : {}),
        });
        onLoggedIn(updated);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setMsgs({ phone: err.message });
          setError(null);
          return;
        }
        throw err;
      }
    }, 'Could not save your details. Please try again.');
  }

  // --- Phone one-time code (off by default) ---------------------------------
  function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (view === 'phone') {
      const problem = indianPhoneError(phone);
      setMsgs({ phone: problem });
      if (problem) return document.getElementById('login-phone')?.focus();
    }
    return run(async () => {
      const res = await api.post<{ resendAfterSeconds: number }>('/customer-auth/request-code', { phone });
      setResendIn(res.resendAfterSeconds);
      setCode('');
      go('code');
    }, 'Could not send the code. Please try again.', view === 'code' ? 'code' : undefined);
  }

  function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const problem = codeError(code);
    setMsgs({ code: problem });
    if (problem) return document.getElementById('login-code')?.focus();
    return run(async () => {
      const res = await api.post<{ customer: Customer; needsProfile: boolean }>('/customer-auth/verify', { phone, code });
      signedIn(res.customer, res.needsProfile);
    }, 'Could not verify the code. Please try again.', 'code');
  }

  const completing = !!customer;
  const titles: Record<View, [string, string]> = {
    home: ['Log in or sign up', HAS.google ? 'Continue with Google, or use your email.' : 'Use your email and password.'],
    'signup-code': ['Verify your email', `We sent a 6-digit code to ${email.trim()}.`],
    forgot: ['Set or reset your password', 'We will email you a code to choose a new password.'],
    reset: ['Enter the code', `If ${email.trim()} has an account, a 6-digit code is on its way.`],
    profile: [
      completing ? 'Add your phone number' : 'Almost done',
      completing ? 'The venue needs a number to reach you about your booking.' : 'Used on your bookings. You can change them later.',
    ],
    phone: ['Log in with your phone', 'We will send a 6-digit code to your phone.'],
    code: ['Enter the code', `Sent to +91 ${phone}.`],
  };
  const [title, subtitle] = titles[view];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="login-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="text-[1.25rem]" />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}

        {view === 'home' && (
          <div className="space-y-4">
            {notice && <SuccessBanner message={notice} />}
            {HAS.google && <GoogleButton onCredential={onGoogle} disabled={busy} />}
            {HAS.google && HAS.email && (
              <div className="flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}

            {HAS.email && (
              <>
                <div role="tablist" aria-label="Email sign-in" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
                  {(['signin', 'signup'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => {
                        setTab(t);
                        setError(null);
                        setMsgs({});
                      }}
                      className={`rounded-lg py-1.5 transition ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {t === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                  ))}
                </div>

                {tab === 'signin' ? (
                  <form onSubmit={signIn} noValidate className="space-y-3">
                    <div>
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        aria-invalid={!!msgs.email}
                        className={msgs.email ? invalidClass : ''}
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          clearMsg('email');
                        }}
                      />
                      <FieldError id="login-email-error" message={msgs.email} />
                    </div>
                    <div>
                      <Label htmlFor="login-password">Password</Label>
                      <PasswordInput
                        id="login-password"
                        autoComplete="current-password"
                        aria-invalid={!!msgs.password}
                        className={msgs.password ? invalidClass : ''}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          clearMsg('password');
                        }}
                      />
                      <FieldError id="login-password-error" message={msgs.password} />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? 'Signing in…' : 'Sign in'}
                    </Button>
                    <button type="button" onClick={() => go('forgot')} className="block w-full text-center text-sm font-medium text-emerald-700 hover:underline">
                      Forgot password?
                    </button>
                  </form>
                ) : (
                  <form onSubmit={signUp} noValidate className="space-y-3">
                    <div>
                      <Label htmlFor="login-name">Your name</Label>
                      <Input
                        id="login-name"
                        autoComplete="name"
                        maxLength={80}
                        aria-invalid={!!msgs.name}
                        className={msgs.name ? invalidClass : ''}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          clearMsg('name');
                        }}
                      />
                      <FieldError id="login-name-error" message={msgs.name} />
                    </div>
                    <div>
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        aria-invalid={!!msgs.email}
                        className={msgs.email ? invalidClass : ''}
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          clearMsg('email');
                        }}
                      />
                      <FieldError id="login-email-error" message={msgs.email} />
                    </div>
                    <div>
                      <Label htmlFor="login-phone">Phone number</Label>
                      <PhoneInput
                        id="login-phone"
                        invalid={!!msgs.phone}
                        value={phone}
                        onValueChange={(digits) => {
                          setPhone(digits);
                          clearMsg('phone');
                        }}
                      />
                      <FieldError id="login-phone-error" message={msgs.phone} />
                    </div>
                    <div>
                      <Label htmlFor="login-password">Password</Label>
                      <PasswordInput
                        id="login-password"
                        autoComplete="new-password"
                        aria-invalid={!!msgs.password}
                        className={msgs.password ? invalidClass : ''}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          clearMsg('password');
                        }}
                      />
                      <FieldError id="login-password-error" message={msgs.password} />
                      <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {busy ? 'Creating…' : 'Create account'}
                    </Button>
                  </form>
                )}
              </>
            )}

            {HAS.phone && (
              <button type="button" onClick={() => go('phone')} className="block w-full text-center text-sm font-medium text-slate-600 hover:underline">
                Use a phone code instead
              </button>
            )}
          </div>
        )}

        {view === 'forgot' && (
          <form onSubmit={forgot} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                aria-invalid={!!msgs.email}
                className={msgs.email ? invalidClass : ''}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearMsg('email');
                }}
              />
              <FieldError id="login-email-error" message={msgs.email} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
            <button type="button" onClick={() => go('home')} className="block w-full text-center text-sm font-medium text-slate-600 hover:underline">
              Back to sign in
            </button>
          </form>
        )}

        {view === 'signup-code' && (
          <form onSubmit={verifySignUp} noValidate className="space-y-3">
            {notice && <SuccessBanner message={notice} />}
            <div>
              <Label htmlFor="login-code">6-digit code</Label>
              <Input
                id="login-code"
                autoFocus
                aria-invalid={!!msgs.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className={`text-center text-lg tracking-[0.4em] ${msgs.code ? invalidClass : ''}`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  clearMsg('code');
                }}
              />
              <FieldError id="login-code-error" message={msgs.code} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Verify and create account'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => go('home')} className="font-medium text-slate-600 hover:underline">
                Change details
              </button>
              <button
                type="button"
                onClick={() => resendSignUp()}
                disabled={busy || resendIn > 0}
                className="font-medium text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {view === 'reset' && (
          <form onSubmit={resetPassword} noValidate className="space-y-3">
            {notice && <SuccessBanner message={notice} />}
            <div>
              <Label htmlFor="login-code">6-digit code</Label>
              <Input
                id="login-code"
                autoFocus
                aria-invalid={!!msgs.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className={`text-center text-lg tracking-[0.4em] ${msgs.code ? invalidClass : ''}`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  clearMsg('code');
                }}
              />
              <FieldError id="login-code-error" message={msgs.code} />
            </div>
            <div>
              <Label htmlFor="login-password">New password</Label>
              <PasswordInput
                id="login-password"
                autoComplete="new-password"
                aria-invalid={!!msgs.password}
                className={msgs.password ? invalidClass : ''}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearMsg('password');
                }}
              />
              <FieldError id="login-password-error" message={msgs.password} />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
            </div>
            <div>
              <Label htmlFor="login-confirm">Repeat the password</Label>
              <PasswordInput
                id="login-confirm"
                autoComplete="new-password"
                aria-invalid={!!msgs.confirm}
                className={msgs.confirm ? invalidClass : ''}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  clearMsg('confirm');
                }}
              />
              <FieldError id="login-confirm-error" message={msgs.confirm} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => go('forgot')} className="font-medium text-slate-600 hover:underline">
                Change email
              </button>
              <button
                type="button"
                onClick={() => resendReset()}
                disabled={busy || resendIn > 0}
                className="font-medium text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {view === 'profile' && signed && (
          <form onSubmit={saveProfile} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-name">Your name</Label>
              <Input
                id="login-name"
                autoFocus={!!signed.phone}
                autoComplete="name"
                maxLength={80}
                aria-invalid={!!msgs.name}
                className={msgs.name ? invalidClass : ''}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearMsg('name');
                }}
              />
              <FieldError id="login-name-error" message={msgs.name} />
            </div>
            {!signed.phone && (
              <div>
                <Label htmlFor="login-phone">Phone number</Label>
                <PhoneInput
                  id="login-phone"
                  autoFocus
                  invalid={!!msgs.phone}
                  value={phone}
                  onValueChange={(digits) => {
                    setPhone(digits);
                    clearMsg('phone');
                  }}
                />
                <FieldError id="login-phone-error" message={msgs.phone} />
                <p className="mt-1 text-xs text-slate-500">
                  {completing
                    ? 'If your number was verified on another account, it was removed from this one. Please add it again.'
                    : "We don't check this number yet. Venues use it to reach you about your booking."}
                </p>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        )}

        {view === 'phone' && (
          <form onSubmit={sendCode} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-phone">Phone number</Label>
              <PhoneInput
                id="login-phone"
                autoFocus
                invalid={!!msgs.phone}
                value={phone}
                onValueChange={(digits) => {
                  setPhone(digits);
                  clearMsg('phone');
                }}
              />
              <FieldError id="login-phone-error" message={msgs.phone} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
            <button type="button" onClick={() => go('home')} className="block w-full text-center text-sm font-medium text-slate-600 hover:underline">
              Back
            </button>
          </form>
        )}

        {view === 'code' && (
          <form onSubmit={verifyCode} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-code">6-digit code</Label>
              <Input
                id="login-code"
                autoFocus
                aria-invalid={!!msgs.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className={`text-center text-lg tracking-[0.4em] ${msgs.code ? invalidClass : ''}`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  clearMsg('code');
                }}
              />
              <FieldError id="login-code-error" message={msgs.code} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Verify and continue'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={() => go('phone')} className="font-medium text-slate-600 hover:underline">
                Change number
              </button>
              <button
                type="button"
                onClick={() => sendCode()}
                disabled={busy || resendIn > 0}
                className="font-medium text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
