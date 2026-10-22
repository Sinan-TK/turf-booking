'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Button, ErrorBanner, Input } from '@/components/ui';

interface StatusActionProps {
  /** PATCH endpoint taking { status, reason }. */
  path: string;
  /** True while the record is in its restricted state (blocked, suspended, disabled). */
  restricted: boolean;
  /** Status sent to restrict / to restore. */
  restrictStatus: string;
  restoreStatus: string;
  restrictLabel: string;
  restoreLabel: string;
  /** Confirmation copy shown before anything changes. */
  restrictTitle: string;
  restrictBody: string;
  restoreTitle: string;
  restoreBody: string;
  confirmRestrict: string;
  confirmRestore: string;
  onChanged: () => void;
  /** Small text-style trigger with a popover, for table rows. */
  compact?: boolean;
}

/** Restrict / restore button with an inline confirmation (and optional audit-log reason). */
export function StatusAction(p: StatusActionProps) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(p.path, {
        status: p.restricted ? p.restoreStatus : p.restrictStatus,
        reason: reason.trim() || undefined,
      });
      setConfirming(false);
      setReason('');
      p.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the status');
    } finally {
      setBusy(false);
    }
  }

  const trigger = p.compact ? (
    <button
      type="button"
      onClick={() => setConfirming((c) => !c)}
      className={`text-sm font-medium hover:underline ${p.restricted ? 'text-emerald-700' : 'text-red-600'}`}
    >
      {p.restricted ? p.restoreLabel : p.restrictLabel}
    </button>
  ) : (
    <Button variant={p.restricted ? 'secondary' : 'danger'} onClick={() => setConfirming(true)}>
      <Icon name={p.restricted ? 'check' : 'ban'} className="h-4 w-4" />
      {p.restricted ? p.restoreLabel : p.restrictLabel}
    </Button>
  );

  if (!confirming) return trigger;

  const panel = (
    <div
      className={`w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 text-left shadow-pop sm:w-80 ${
        p.compact ? 'absolute right-0 top-full z-30 mt-1.5' : ''
      }`}
    >
      <p className="text-sm font-medium text-gray-900">{p.restricted ? p.restoreTitle : p.restrictTitle}</p>
      <p className="mt-1 text-xs text-gray-500">{p.restricted ? p.restoreBody : p.restrictBody}</p>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <Input
        className="mt-3"
        placeholder="Reason (optional, kept in the audit log)"
        aria-label="Reason"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
        <Button variant={p.restricted ? 'primary' : 'danger'} onClick={apply} loading={busy}>
          {p.restricted ? p.confirmRestore : p.confirmRestrict}
        </Button>
      </div>
    </div>
  );

  return p.compact ? (
    <div className="relative inline-block">
      {trigger}
      {panel}
    </div>
  ) : (
    panel
  );
}
