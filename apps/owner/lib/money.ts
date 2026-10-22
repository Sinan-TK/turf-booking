/** How much of a booking is still to be paid (at the venue), never below zero. */
export function remainingAmount(b: { amount: string | number; paidAmount: string | number }): number {
  return Math.max(0, Math.round((Number(b.amount) - Number(b.paidAmount)) * 100) / 100);
}

export function formatMoney(currency: string, value: string | number): string {
  return `${currency} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
