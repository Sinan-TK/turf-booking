'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
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
        <dl className="text-sm">
          <dt className="text-on-surface-variant">Role</dt>
          <dd className="mb-2">{user?.ownerRole}</dd>
        </dl>
      </Card>

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
