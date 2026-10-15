/**
 * Human-readable Order ID format: "BK" + zero-padded sequence, e.g. BK10294.
 *
 * The sequence itself is generated atomically by a Postgres SEQUENCE in
 * apps/api (bookings.repository.ts), guaranteeing uniqueness under
 * concurrent booking creation without a round-trip "check then insert"
 * race. This module only owns the display format so it's identical
 * everywhere the brief requires it: WhatsApp, web, My Bookings, payment
 * records, cancellation, refund, support tickets.
 */

const ORDER_ID_PREFIX = 'BK';
const ORDER_ID_MIN_DIGITS = 5;

export function formatOrderId(sequence: number | bigint): string {
  return `${ORDER_ID_PREFIX}${sequence.toString().padStart(ORDER_ID_MIN_DIGITS, '0')}`;
}

const ORDER_ID_PATTERN = new RegExp(`^${ORDER_ID_PREFIX}(\\d{${ORDER_ID_MIN_DIGITS},})$`);

export function parseOrderId(orderId: string): number | null {
  const match = ORDER_ID_PATTERN.exec(orderId.trim().toUpperCase());
  return match?.[1] ? Number(match[1]) : null;
}
