'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '@/lib/api';
import { Button, FieldError, Icon, Input, Label } from '@/components/ui';
import { codeError } from '@/lib/validation';

/**
 * "Verify your email": sends a 6-digit code to the address on the account as soon as it opens, and marks the email
 * verified when the code comes back. Esc, Cancel and a click outside close it; focus starts in the code box.
 */
export function VerifyEmailDialog({ email, onVerified, onClose }: { email: string; onVerified: () => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(true);
  const [resendIn, setResendIn] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const sentOnce = useRef(false);

  async function sendCode() {
    setSending(true);
    setCodeMsg(undefined);
    try {
      const res = await api.post<{ resendAfterSeconds: number }>('/customer-auth/email/send-code');
      setResendIn(res.resendAfterSeconds);
    } catch (err) {
      // A code was sent a moment ago (for example before a page reload): it still works, and the server says how long
      // is left before another can be sent, so the countdown carries on instead of starting again.
      const left = err instanceof ApiError && err.status === 429 ? (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
      if (left) setResendIn(left);
      else setCodeMsg(err instanceof ApiError ? err.message : 'Could not send the code. Please try again.');
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (sentOnce.current) return; // React strict mode runs effects twice in development
    sentOnce.current = true;
    void sendCode();
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = codeError(code);
    setCodeMsg(problem);
    if (problem) return void document.getElementById('verify-email-code')?.focus();
    setBusy(true);
    try {
      await api.post('/customer-auth/email/verify', { code });
      onVerified();
    } catch (err) {
      setCodeMsg(err instanceof ApiError ? err.message : 'Could not verify the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-email-title"
        className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl ring-1 ring-black/5 sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon name="verified" className="text-[1.25rem]" />
          </span>
          <div className="min-w-0">
            <h2 id="verify-email-title" className="text-lg font-semibold text-gray-900">
              Verify your email
            </h2>
            <p className="mt-0.5 break-words text-sm text-gray-600">
              {sending ? 'Sending a 6-digit code to ' : 'Enter the 6-digit code emailed to '}
              <span className="font-medium text-gray-900">{email}</span>.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-3">
          <div>
            <Label htmlFor="verify-email-code">6-digit code</Label>
            <Input
              id="verify-email-code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              aria-invalid={!!codeMsg}
              className={`text-center text-lg tracking-[0.4em] ${codeMsg ? '!border-red-500' : ''}`}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setCodeMsg(undefined);
              }}
            />
            <FieldError id="verify-email-code-error" message={codeMsg} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={sending || resendIn > 0}
              className="text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Verify'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
