import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { forgetAccountData } from '@/lib/account-cache';
import { useToast } from '@/components/toast';

/**
 * The customer's saved venues, for the save buttons on the listing's cards and on a venue's page. Saving needs an account:
 * logged out, a tap opens the login. The button flips at once and flips back (with a message) if the server refuses.
 */
export function useSavedVenues() {
  const { customer, requireLogin } = useCustomer();
  const toast = useToast();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!customer) return setSavedIds(new Set());
    api
      // The list is the saved venues themselves (each has its own id); older shapes carried a venueId or a nested venue.
      .get<Array<{ id?: string; venueId?: string; venue?: { id: string } }>>('/me/saved-venues')
      .then((rows) => setSavedIds(new Set(rows.map((r) => r.id ?? r.venue?.id ?? r.venueId ?? '').filter(Boolean))))
      .catch(() => undefined);
  }, [customer]);

  async function toggle(venueId: string) {
    try {
      await requireLogin();
    } catch {
      return; // the login was dismissed
    }
    const wasSaved = savedIds.has(venueId);
    const flip = (on: boolean) =>
      setSavedIds((ids) => {
        const next = new Set(ids);
        if (on) next.add(venueId);
        else next.delete(venueId);
        return next;
      });
    flip(!wasSaved);
    try {
      if (wasSaved) await api.delete(`/me/saved-venues/${venueId}`);
      else await api.post('/me/saved-venues', { venueId });
      if (customer) forgetAccountData(customer.id, 'saved-venues'); // the Saved tab shows the change, not its older copy
    } catch {
      flip(wasSaved);
      toast.show(wasSaved ? 'Could not remove it from your saved venues.' : 'Could not save that venue. Please try again.');
    }
  }

  return { isSaved: (venueId: string) => savedIds.has(venueId), toggle };
}
