import { normalizePhone } from '../src/common/phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['00919876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
  ])('canonicalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '98765x43210', '+', '1'.repeat(16)])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('honours another default country code for 10-digit numbers', () => {
    expect(normalizePhone('4155550123', '1')).toBe('+14155550123');
  });
});
