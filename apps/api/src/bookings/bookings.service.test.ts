import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Database } from '@parkfairy/database';
import { describe, expect, it } from 'vitest';
import { BookingsService } from './bookings.service.js';

/** A database that fails the test if anything reaches it. */
const untouched = new Proxy(
  {},
  {
    get: (_target, name) => {
      throw new Error(`database used: ${String(name)}`);
    },
  },
) as Database;

const hold = {
  listing: 'syntagma-square-garage',
  spaceId: '6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c',
  start: '2026-12-10T08:00:00.000Z',
  end: '2026-12-10T10:00:00.000Z',
};

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code?: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (caught: unknown) => caught,
  );
  if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error;
  return { status: error.getStatus(), ...(error.getResponse() as { code?: string }) };
}

describe('BookingsService where no payment can be taken (decision #33)', () => {
  const service = new BookingsService(untouched, { bookingWithoutPayment: false });

  it('holds nothing and confirms nothing, before touching the database', async () => {
    expect(await refusal(service.hold('user', hold))).toMatchObject({
      status: 409,
      code: 'BOOKING_UNAVAILABLE',
    });
    expect(
      await refusal(service.confirm('user', hold.spaceId, { vehiclePlate: 'IKB1234' })),
    ).toMatchObject({ status: 409, code: 'BOOKING_UNAVAILABLE' });
    expect(await refusal(service.extend('user', hold.spaceId))).toMatchObject({
      status: 409,
      code: 'BOOKING_UNAVAILABLE',
    });
  });
});

describe('BookingsService with ids that cannot exist', () => {
  const service = new BookingsService(untouched, { bookingWithoutPayment: true });

  it.each([
    ['get', (s: BookingsService) => s.get('user', 'B1')],
    ['cancel', (s: BookingsService) => s.cancel('user', "1' or '1'='1")],
    ['confirm', (s: BookingsService) => s.confirm('user', '..', { vehiclePlate: 'IKB1234' })],
  ])('answers %s with a 404 without a query', async (_name, call) => {
    expect(await refusal(call(service))).toMatchObject({ status: 404, code: 'BOOKING_NOT_FOUND' });
  });

  it("answers an owner's malformed listing id the same way as another owner's", async () => {
    expect(await refusal(service.listingBookings('user', 'x', {}))).toMatchObject({
      status: 404,
      code: 'LISTING_NOT_FOUND',
    });
    expect(await refusal(service.cancelForOwner('user', 'x', hold.spaceId))).toMatchObject({
      status: 404,
      code: 'LISTING_NOT_FOUND',
    });
  });
});
