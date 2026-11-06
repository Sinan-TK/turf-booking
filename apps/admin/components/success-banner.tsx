'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/toast';

/**
 * A success message. It is shown as a toast at the bottom middle of the screen (and fades away), not as a box inside the page.
 * It shows when it appears, and again whenever its text changes.
 */
export function SuccessBanner({ message }: { message: React.ReactNode }) {
  const toast = useToast();
  const key = typeof message === 'string' ? message : '';
  useEffect(() => {
    toast.show(message);
  }, [key]);
  return null;
}
