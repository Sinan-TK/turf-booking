'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL, ROLE_SUMMARY } from '@/lib/access';
import { AccessCard } from '@/components/access-card';
import { BankDetailsCard } from '@/components/bank-details-card';
import { Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, SuccessBanner, invalidClass } from '@/components/ui';
import { hasErrors, newPasswordError, type FieldErrors } from '@/lib/validation';

export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'current' | 'next' | 'confirm'>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const found: FieldErrors<'current' | 'next' | 'confirm'> = {
      current: currentPassword ? undefined : 'Enter your current password.',
      next: newPasswordError(newPassword) ?? (newPassword === currentPassword ? 'The new password must be different from the current one.' : undefined),
      confirm: confirmPassword === newPassword ? undefined : 'The two new passwords do not match.',
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.current ? 'settings-current' : found.next ? 'settings-new' : 'settings-confirm')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/owner/change-password', { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : 'Failed to change password',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your profile, where your payouts go, and your password." />

      <div className="grid items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-on-primary-container text-xl font-semibold text-white"
              >
                {initial}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-on-surface">{user?.name ?? 'Account'}</h2>
                <p className="truncate text-sm text-on-surface-variant">{user?.email}</p>
              </div>
            </div>
            <dl className="mt-5 space-y-4 border-t border-outline-variant/30 pt-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Role</dt>
                <dd className="mt-1 inline-flex rounded-full bg-primary-fixed-dim/30 px-2.5 py-0.5 text-xs font-semibold text-on-primary-container">
                  {user ? ROLE_LABEL[user.ownerRole] : ''}
                </dd>
                {user && <dd className="mt-2 text-xs leading-relaxed text-on-surface-variant">{ROLE_SUMMARY[user.ownerRole]}</dd>}
              </div>
              {user?.ownerRole === 'OWNER_STAFF' && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">Your venues</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {user.venues.length === 0 && <span className="text-xs text-on-surface-variant">No venue is assigned to you yet.</span>}
                    {user.venues.map((v) => (
                      <span key={v.id} className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs text-on-surface">
                        {v.name}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          {user?.ownerRole === 'OWNER_STAFF' && <AccessCard audience="staff" />}
        </div>

        <div className="space-y-6">
          {user?.ownerRole === 'OWNER_ADMIN' && <BankDetailsCard />}

          <Card>
            <h2 className="text-sm font-semibold text-on-surface">Change Password</h2>
            <p className="mb-4 mt-0.5 text-xs text-on-surface-variant">Changing your password signs you out of your other devices.</p>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {error && <ErrorBanner message={error} />}
              {success && <SuccessBanner message="Password changed." />}
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="settings-current">Current Password</Label>
                  <Input
                    id="settings-current"
                    aria-invalid={!!errors.current}
                    aria-describedby={errors.current ? 'settings-current-error' : undefined}
                    className={errors.current ? invalidClass : ''}
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      setErrors((p) => ({ ...p, current: undefined }));
                    }}
                  />
                  <FieldError id="settings-current-error" message={errors.current} />
                </div>
                <div>
                  <Label htmlFor="settings-new">New Password</Label>
                  <Input
                    id="settings-new"
                    aria-invalid={!!errors.next}
                    aria-describedby={errors.next ? 'settings-new-error' : undefined}
                    className={errors.next ? invalidClass : ''}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setErrors((p) => ({ ...p, next: undefined }));
                    }}
                  />
                  <FieldError id="settings-new-error" message={errors.next} />
                </div>
                <div>
                  <Label htmlFor="settings-confirm">Confirm New Password</Label>
                  <Input
                    id="settings-confirm"
                    aria-invalid={!!errors.confirm}
                    aria-describedby={errors.confirm ? 'settings-confirm-error' : undefined}
                    className={errors.confirm ? invalidClass : ''}
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setErrors((p) => ({ ...p, confirm: undefined }));
                    }}
                  />
                  <FieldError id="settings-confirm-error" message={errors.confirm} />
                </div>
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Changing…' : 'Change Password'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
