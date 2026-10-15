'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, ErrorBanner, Input, Label, PageHeader, SuccessBanner } from '@/components/ui';

export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
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
        <form onSubmit={onSubmit} className="space-y-3">
          {error && <ErrorBanner message={error} />}
          {success && <SuccessBanner message="Password changed." />}
          <div>
            <Label>Current Password</Label>
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <Label>New Password</Label>
            <Input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Changing…' : 'Change Password'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
