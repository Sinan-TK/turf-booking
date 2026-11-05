'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { Modal } from '@/components/modal';
import { Badge, Button, Card, ErrorBanner, FieldError, Input, Label } from '@/components/ui';

export interface BankAccount {
  status: 'NONE' | 'NOT_VERIFIED' | 'VERIFIED' | 'FAILED';
  accountHolderName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  accountType?: 'SAVINGS' | 'CURRENT';
  failureReason?: string | null;
  verifiedAt?: string | null;
  submittedAt?: string;
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** What to say about a payout's destination when the details are not good to pay yet. */
export function bankWarning(bank: Pick<BankAccount, 'status'> | null | undefined): string | null {
  if (!bank || bank.status === 'NONE') return 'This business has not added bank details yet, so there is nowhere to send this payout.';
  if (bank.status === 'NOT_VERIFIED') return 'The bank details have not been verified yet. Check them before you send money.';
  if (bank.status === 'FAILED') return 'The bank details failed verification. Ask the owner to fix them before you send money.';
  return null;
}

export function BankAccountDetails({ bank }: { bank: BankAccount }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <Item label="Account holder" value={bank.accountHolderName} />
      <Item label="Account number" value={bank.accountNumber} mono copy />
      <Item label="IFSC" value={bank.ifsc} mono copy />
      <Item label="Bank" value={bank.bankName} />
      <Item label="Account type" value={bank.accountType === 'CURRENT' ? 'Current' : 'Savings'} />
    </dl>
  );
}

function Item({ label, value, mono, copy }: { label: string; value?: string | null; mono?: boolean; copy?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-2 font-medium text-gray-900 ${mono ? 'font-mono tracking-wide' : ''}`}>
        {value || '—'}
        {copy && value && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            className="rounded px-1.5 py-0.5 font-sans text-xs font-medium text-brand-700 hover:bg-brand-50"
            onClick={() => void navigator.clipboard?.writeText(value)}
          >
            Copy
          </button>
        )}
      </dd>
    </div>
  );
}

/** A business's bank details in full, with the buttons that decide whether they are good. */
export function BankDetailsPanel({ organizationId, onChanged }: { organizationId: string; onChanged?: () => void }) {
  const { data: bank, loading, error, refetch } = useFetch<BankAccount>(`/admin/organizations/${organizationId}/bank-account`);
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(kind: 'verify' | 'fail') {
    if (kind === 'fail' && reason.trim().length < 3) {
      setReasonError('Say what is wrong, so the owner can fix it.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/organizations/${organizationId}/bank-account/${kind}`, kind === 'fail' ? { reason } : {});
      setFailing(false);
      setReason('');
      refetch();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setBusy(false);
    }
  }

  const has = !!bank && bank.status !== 'NONE';
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Bank details</h2>
        {has && <Badge value={bank.status} />}
      </div>
      {loading && !bank && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <ErrorBanner message={error} />}
      {bank && !has && <p className="text-sm text-gray-500">This business has not added bank details yet.</p>}
      {bank && has && (
        <>
          <BankAccountDetails bank={bank} />
          <p className="mt-3 text-xs text-gray-500">
            Added or changed {when(bank.submittedAt)}
            {bank.status === 'VERIFIED' && <> · verified {when(bank.verifiedAt)}</>}
          </p>
          {bank.status === 'FAILED' && bank.failureReason && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Marked failed: {bank.failureReason}</p>
          )}
          {actionError && <div className="mt-3"><ErrorBanner message={actionError} /></div>}
          {bank.status === 'NOT_VERIFIED' && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" loading={busy && !failing} onClick={() => void decide('verify')}>
                Verify
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setReason('');
                  setReasonError(undefined);
                  setFailing(true);
                }}
              >
                Mark failed
              </Button>
            </div>
          )}
        </>
      )}

      {failing && (
        <Modal title="Mark bank details as failed" subtitle="The owner sees your reason and is asked to fix the details." onClose={() => setFailing(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="bank-fail-reason">What is wrong?</Label>
              <Input
                id="bank-fail-reason"
                value={reason}
                maxLength={300}
                placeholder="For example: the name does not match the bank record"
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(undefined);
                }}
              />
              <FieldError id="bank-fail-reason-error" message={reasonError} />
            </div>
            {actionError && <ErrorBanner message={actionError} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setFailing(false)}>
                Cancel
              </Button>
              <Button type="button" loading={busy} onClick={() => void decide('fail')}>
                Mark failed
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
