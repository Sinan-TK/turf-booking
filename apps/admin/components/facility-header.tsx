'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { AdminVenueCategory } from '@/lib/categories';
import { Button, FieldError, Input, Label } from '@/components/ui';

/**
 * The top section of a facility's page: its name and venue count on the left; on the right its status (Active switch) and
 * its Display order. Both save on their own, straight away, so they never depend on the Info tab's Save button.
 */
export function FacilityHeader({ category, onChanged }: { category: AdminVenueCategory; onChanged: () => void }) {
  const [order, setOrder] = useState(String(category.sortOrder));
  const [toggling, setToggling] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | undefined>();
  // The facility that already has the typed number: it can be asked to switch places.
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);
  const [switching, setSwitching] = useState(false);

  const typed = order.trim() === '' ? NaN : Number(order);
  const orderValid = Number.isInteger(typed) && typed >= 0 && typed <= 100000;
  const orderChanged = orderValid && typed !== category.sortOrder;

  async function toggle() {
    setToggling(true);
    setStatusError(null);
    try {
      await api.post(`/admin/categories/${category.id}/${category.isActive ? 'deactivate' : 'activate'}`);
      onChanged();
    } catch (err) {
      // e.g. upcoming bookings still exist under it: the API says how many.
      setStatusError(err instanceof ApiError ? err.message : 'Could not change the status.');
    } finally {
      setToggling(false);
    }
  }

  async function saveOrder() {
    if (!orderValid) {
      setOrderError('Enter a whole number from 0 to 100000.');
      return;
    }
    setSavingOrder(true);
    setOrderError(undefined);
    setTaken(null);
    try {
      await api.patch(`/admin/categories/${category.id}`, { sortOrder: typed });
      onChanged();
    } catch (err) {
      const takenBy = err instanceof ApiError && err.status === 409 ? (err.details as { takenBy?: { id: string; name: string } } | undefined)?.takenBy : undefined;
      if (takenBy) setTaken(takenBy);
      else setOrderError(err instanceof ApiError ? err.message : 'Could not save the display order.');
    } finally {
      setSavingOrder(false);
    }
  }

  async function switchPlaces() {
    if (!taken) return;
    setSwitching(true);
    setOrderError(undefined);
    try {
      await api.post(`/admin/categories/${category.id}/swap-order`, { withId: taken.id });
      setTaken(null);
      onChanged();
    } catch (err) {
      setOrderError(err instanceof ApiError ? err.message : 'Could not switch places.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <section className="mb-5 flex flex-col gap-5 rounded-xl border border-gray-200/80 bg-white p-5 shadow-card md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{category.name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {category.venueCount} venue{category.venueCount === 1 ? '' : 's'} offer this facility. Rule changes apply to new bookings straight away;
          existing bookings are not touched.
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start md:justify-end">
        <div className="sm:w-52">
          <p className="mb-1.5 text-sm font-medium text-gray-700">Status</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={category.isActive}
              aria-label="Active"
              disabled={toggling}
              onClick={toggle}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${category.isActive ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${category.isActive ? 'translate-x-5' : ''}`} />
            </button>
            <span className={`text-sm font-medium ${category.isActive ? 'text-emerald-700' : 'text-gray-500'}`}>{category.isActive ? 'Active' : 'Inactive'}</span>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {category.isActive ? 'Customers can see it and owners can pick it.' : 'Hidden from customers and from owners adding a venue.'}
          </p>
          {statusError && (
            <p role="alert" className="mt-1.5 text-xs text-red-600">
              {statusError}
            </p>
          )}
        </div>

        <div className="sm:w-72">
          <Label htmlFor="facility-order">Display order</Label>
          <div className="flex items-center gap-2">
            <Input
              id="facility-order"
              type="number"
              min={0}
              value={order}
              aria-invalid={!!orderError}
              onChange={(e) => {
                setOrder(e.target.value);
                setOrderError(undefined);
                setTaken(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && orderChanged) void saveOrder();
              }}
              className="w-24"
            />
            <Button type="button" variant="secondary" disabled={!orderChanged} loading={savingOrder} onClick={saveOrder}>
              Save
            </Button>
          </div>
          <FieldError id="facility-order-error" message={orderError} />
          {taken && (
            <div role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <p>
                <strong>{taken.name}</strong> already has number {typed}. Pick another number, or switch places: {taken.name} would take number{' '}
                {category.sortOrder} and {category.name} would take {typed}.
              </p>
              <Button type="button" variant="secondary" className="mt-2" loading={switching} onClick={switchPlaces}>
                Switch places with {taken.name}
              </Button>
            </div>
          )}
          {!orderError && !taken && <p className="mt-1.5 text-xs text-gray-500">Lower numbers appear first. Each facility needs its own number.</p>}
        </div>
      </div>
    </section>
  );
}
