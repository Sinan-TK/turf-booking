'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL, ROLE_SUMMARY } from '@/lib/access';
import { AccessCard } from '@/components/access-card';
import { Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, SuccessBanner, invalidClass } from '@/components/ui';
import { hasErrors, newPasswordError, type FieldErrors } from '@/lib/validation';

export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'current' | 'next'>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const found: FieldErrors<'current' | 'next'> = {
      current: currentPassword ? undefined : 'Enter your current password.',
      next: newPasswordError(newPassword) ?? (newPassword === currentPassword ? 'The new password must be different from the current one.' : undefined),
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.current ? 'settings-current' : 'settings-new')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/owner/change-password', { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
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

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card className="max-w-md">
        <h2 className="mb-4 text-sm font-semibold text-on-surface">Account</h2>
        <dl className="space-y-3 text-sm">
          {user?.name && (
            <div>
              <dt className="text-on-surface-variant">Name</dt>
              <dd>{user.name}</dd>
            </div>
          )}
          {user?.email && (
            <div>
              <dt className="text-on-surface-variant">Email</dt>
              <dd>{user.email}</dd>
            </div>
          )}
          <div>
            <dt className="text-on-surface-variant">Role</dt>
            <dd className="font-medium">{user ? ROLE_LABEL[user.ownerRole] : ''}</dd>
            {user && <dd className="mt-0.5 text-xs text-on-surface-variant">{ROLE_SUMMARY[user.ownerRole]}</dd>}
          </div>
          {user?.ownerRole === 'OWNER_STAFF' && (
            <div>
              <dt className="text-on-surface-variant">Your venues</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
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
      {user?.ownerRole === 'OWNER_STAFF' && (
        <div className="max-w-md">
          <AccessCard audience="staff" />
        </div>
      )}

      <Card className="max-w-md">
        <h2 className="mb-1 text-sm font-semibold text-on-surface">Change Password</h2>
        <p className="mb-4 text-xs text-on-surface-variant">
          Changing your password signs you out of your other devices.
        </p>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          {error && <ErrorBanner message={error} />}
          {success && <SuccessBanner message="Password changed." />}
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
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Changing…' : 'Change Password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
