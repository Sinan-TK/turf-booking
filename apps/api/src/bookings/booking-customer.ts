/** The customer shown on a booking: a customer account, or for a walk-in the name and phone staff recorded on it. */
export interface BookingCustomerView {
  /** Null for a walk-in: there is no account behind it. */
  id: string | null;
  name: string | null;
  whatsappNumber: string | null;
  phoneVerified: boolean;
  email: string | null;
}

/**
 * A walk-in has no customer account (customerId is null); what staff typed lives on the booking as walkInName and
 * walkInPhone. Lists and details present both kinds the same way, as `customer`, plus `isWalkIn`, so screens need
 * no second shape. Nothing here ever looks a walk-in up among the customer accounts.
 */
export function presentCustomer<
  C extends { id: string; name: string | null; whatsappNumber: string | null; phoneVerified: boolean; email: string | null },
  T extends { customer: C | null; walkInName: string | null; walkInPhone: string | null },
>(booking: T): Omit<T, 'customer' | 'walkInName' | 'walkInPhone'> & { customer: BookingCustomerView; isWalkIn: boolean } {
  const { customer, walkInName, walkInPhone, ...rest } = booking;
  return {
    ...rest,
    isWalkIn: customer === null,
    customer: customer ?? { id: null, name: walkInName, whatsappNumber: walkInPhone, phoneVerified: false, email: null },
  };
}
