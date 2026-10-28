'use client';

import { LoginGate } from '@/components/login-gate';
import { Icon } from '@/components/ui';
import { Screen } from '@/components/screen';
import { SupportPanel } from '@/components/support-panel';

/** Support on its own page: the contact form and the customer's earlier requests. Reached from the bottom of Profile. */
export default function SupportPage() {
  return (
    <Screen wide>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="support" />
        Support
      </h1>
      <LoginGate message="Log in to contact support.">
        <SupportPanel />
      </LoginGate>
    </Screen>
  );
}
