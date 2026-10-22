'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Customer } from '@/lib/customer';
import { Button, ErrorBanner, FieldError, Icon, Input, Label, invalidClass } from '@/components/ui';
import { codeError, nameError, phoneError } from '@/lib/validation';

type Step = 'phone' | 'code' | 'name';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function LoginDialog({
  onLoggedIn,
  onDismiss,
}: {
  onLoggedIn: (customer: Customer) => void;
  onDismiss: () => void;
}) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The message under the field of the step being shown (each step has exactly one field).
  const [fieldMsg, setFieldMsg] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  // The customer exists server-side from the moment the code is verified,
  // so closing the name step still counts as a completed login.
  const [verified, setVerified] = useState<Customer | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  function close() {
    if (verified) onLoggedIn(verified);
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

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (step === 'phone') {
      const problem = phoneError(phone);
      setFieldMsg(problem);
      if (problem) {
        document.getElementById('login-phone')?.focus();
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ resendAfterSeconds: number }>('/customer-auth/request-code', { phone });
      setResendIn(res.resendAfterSeconds);
      setCode('');
      setFieldMsg(undefined);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = codeError(code);
    setFieldMsg(problem);
    if (problem) {
      document.getElementById('login-code')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ customer: Customer; needsName: boolean }>('/customer-auth/verify', {
        phone,
        code,
      });
      if (res.needsName) {
        setVerified(res.customer);
        setFieldMsg(undefined);
        setStep('name');
      } else {
        onLoggedIn(res.customer);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !verified) return;
    const problem = nameError(name);
    setFieldMsg(problem);
    if (problem) {
      document.getElementById('login-name')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Customer>('/customer-auth/me', { name: name.trim() });
      onLoggedIn(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name. Please try again.');
      setBusy(false);
    }
  }

  const title = step === 'phone' ? 'Log in to book' : step === 'code' ? 'Enter the code' : 'What should we call you?';

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
        className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="login-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {step === 'phone' && 'We will send a 6-digit code to your WhatsApp.'}
              {step === 'code' && `Sent to ${phone} on WhatsApp.`}
              {step === 'name' && 'Used on your bookings. You can change it later.'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}

        {step === 'phone' && (
          <form onSubmit={sendCode} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-phone">WhatsApp number</Label>
              <Input
                id="login-phone"
                autoFocus
                aria-invalid={!!fieldMsg}
                aria-describedby={fieldMsg ? 'login-phone-error' : undefined}
                className={fieldMsg ? invalidClass : ''}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFieldMsg(undefined);
                }}
              />
              <FieldError id="login-phone-error" message={fieldMsg} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-code">6-digit code</Label>
              <Input
                id="login-code"
                autoFocus
                aria-invalid={!!fieldMsg}
                aria-describedby={fieldMsg ? 'login-code-error' : undefined}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className={`text-center text-lg tracking-[0.4em] ${fieldMsg ? invalidClass : ''}`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setFieldMsg(undefined);
                }}
              />
              <FieldError id="login-code-error" message={fieldMsg} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Verify and continue'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setFieldMsg(undefined);
                  setStep('phone');
                }}
                className="font-medium text-slate-600 hover:underline"
              >
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

        {step === 'name' && (
          <form onSubmit={saveName} noValidate className="space-y-3">
            <div>
              <Label htmlFor="login-name">Your name</Label>
              <Input
                id="login-name"
                autoFocus
                aria-invalid={!!fieldMsg}
                aria-describedby={fieldMsg ? 'login-name-error' : undefined}
                className={fieldMsg ? invalidClass : ''}
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldMsg(undefined);
                }}
              />
              <FieldError id="login-name-error" message={fieldMsg} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
