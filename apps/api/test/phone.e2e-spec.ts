import { normalizeIndianMobile } from '../src/common/phone';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['6000000001', '+916000000001'],
  ])('canonicalises %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '12345',
    '98765x43210',
    '5876543210', // starts below 6
    '1234567890',
    '9999999999', // one digit repeated
    '98765432101', // eleven digits
    '+14155550123', // another country
    '4155550123',
    '+',
  ])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});
