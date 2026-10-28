import { nextMonthStart } from '../src/settlements/settlements.service';

/** When a venue's commission cap and tiers start over: the first instant of the next month in the venue's own timezone. */
describe('nextMonthStart (pure, no database)', () => {
  it('is the 1st of the next month at local midnight', () => {
    // 1 November 00:00 in India is 31 October 18:30 UTC.
    expect(nextMonthStart('2026-10', 'Asia/Kolkata').toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(nextMonthStart('2026-02', 'UTC').toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rolls over the year', () => {
    expect(nextMonthStart('2026-12', 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(nextMonthStart('2026-12', 'Asia/Kolkata').toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('knows the length of the month, leap years included', () => {
    expect(nextMonthStart('2028-02', 'UTC').toISOString()).toBe('2028-03-01T00:00:00.000Z');
    expect(nextMonthStart('2026-04', 'UTC').toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('follows the venue\'s own zone, so the same month ends at different instants in different places', () => {
    const india = nextMonthStart('2026-10', 'Asia/Kolkata').getTime();
    const utc = nextMonthStart('2026-10', 'UTC').getTime();
    const newYork = nextMonthStart('2026-10', 'America/New_York').getTime();
    expect(india).toBeLessThan(utc);
    expect(utc).toBeLessThan(newYork);
  });
});
