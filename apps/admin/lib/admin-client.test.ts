import { describe, expect, it } from 'vitest';

import { adminErrorKey } from './admin-client';

describe('what a refusal from the admin routes is called', () => {
  it.each([
    'LISTING_NOT_FOUND',
    'NOT_IN_REVIEW',
    'OWN_LISTING',
    'OWNER_DETAILS_MISSING',
    'USER_NOT_FOUND',
    'OWN_ACCOUNT',
    'STAFF_ACCOUNT',
    'NO_TWO_FACTOR',
    'NOT_PUBLISHED',
    'NOT_SUSPENDED',
    'ALREADY_SUSPENDED',
    'BOOKING_NOT_FOUND',
    'NOT_CANCELLABLE',
    'REFUND_NOT_FAILED',
    'TRANSFER_MADE',
    'DISPUTE_NOT_FOUND',
    'NOT_LOST',
    'ALREADY_DECIDED',
    'OVERSTAY_NOT_FOUND',
    'ALREADY_RESOLVED',
    'MFA_REQUIRED',
    'INVALID_ORIGIN',
  ])('knows %s', (code) => {
    expect(adminErrorKey({ code }, 409)).toBe(code);
  });

  it('says the session ended for a 401, whatever else the answer carried', () => {
    expect(adminErrorKey({}, 401)).toBe('SESSION_ENDED');
    expect(adminErrorKey({ code: 'NOT_IN_REVIEW' }, 401)).toBe('NOT_IN_REVIEW');
  });

  it('says "too many" for a 429 with no code, and "unknown" for anything else', () => {
    expect(adminErrorKey({}, 429)).toBe('TOO_MANY_REQUESTS');
    expect(adminErrorKey({}, 500)).toBe('UNKNOWN');
    expect(adminErrorKey({}, undefined)).toBe('UNKNOWN');
    expect(adminErrorKey({ code: 'SOMETHING_ELSE' }, 400)).toBe('UNKNOWN');
    // A code from the prototype chain is not a known one.
    expect(adminErrorKey({ code: 'constructor' }, 400)).toBe('UNKNOWN');
  });
});
