import { BOOKING_ERROR_CODES } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';
import el from '../messages/el.json';
import en from '../messages/en.json';
import { BOOKING_CODES, CHOOSE_AGAIN } from './booking-client';
import { listingStayHref } from './booking-links';

describe('booking codes', () => {
  it('mirror what the API answers with', () => {
    expect([...BOOKING_CODES].sort()).toEqual([...BOOKING_ERROR_CODES].sort());
  });

  it('each have words in both languages', () => {
    for (const catalog of [en, el]) {
      for (const code of BOOKING_CODES) expect(catalog.BookingErrors[code]).toBeTruthy();
    }
  });

  it('send the driver back to choose only where choosing again helps', () => {
    expect(CHOOSE_AGAIN.has('SPACE_TAKEN')).toBe(true);
    expect(CHOOSE_AGAIN.has('OWN_LISTING')).toBe(false);
  });
});

describe('listingStayHref', () => {
  it('fills the listing page with the stay on the Athens wall clock', () => {
    // 10:00 to 12:30 in winter (UTC+2), and across midnight.
    expect(listingStayHref('ermou', '2026-12-10T08:00:00.000Z', '2026-12-10T22:30:00.000Z')).toBe(
      '/parking/ermou?startDate=2026-12-10&startTime=10%3A00&endDate=2026-12-11&endTime=00%3A30',
    );
  });

  it('reads summer time too', () => {
    expect(listingStayHref('ermou', '2027-07-01T07:00:00.000Z', '2027-07-01T09:00:00.000Z')).toBe(
      '/parking/ermou?startDate=2027-07-01&startTime=10%3A00&endDate=2027-07-01&endTime=12%3A00',
    );
  });
});
