/**
 * The only way domain/application code talks to a customer outside the
 * website. Implementations know the channel (WhatsApp today); callers
 * never do. Every method must resolve or reject — callers decide whether a
 * failure is fatal (login code) or best-effort (confirmations, via .catch).
 */
export const CUSTOMER_MESSENGER = Symbol('CUSTOMER_MESSENGER');

export interface CustomerMessenger {
  bookingConfirmed(toPhone: string, orderId: string): Promise<void>;
  bookingCancelled(toPhone: string, orderId: string, coinsCredited?: string): Promise<void>;
}
