import { BadRequestException, NotFoundException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import type { ParkingListingDetail, ParkingSearchResult } from '@parkfairy/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../auth/auth.decorators.js';
import { ParkingController } from './parking.controller.js';
import type { ParkingService } from './parking.service.js';

const search = vi.fn<ParkingService['search']>();
const findBySlug = vi.fn<ParkingService['findBySlug']>();
const featured = vi.fn<ParkingService['featured']>();
const controller = new ParkingController({
  search,
  findBySlug,
  featured,
} as unknown as ParkingService);

const window = { start: '2026-10-29T09:00:00Z', end: '2026-10-29T11:00:00Z' };

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T08:12:00Z'));
  for (const fn of [search, findBySlug, featured]) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('ParkingController.searchParking', () => {
  it('passes a valid query on and echoes the normalised window', async () => {
    search.mockResolvedValue([] as ParkingSearchResult[]);
    const response = await controller.searchParking({ area: 'syntagma', ...window });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ area: 'syntagma' }));
    expect(response).toEqual({
      start: '2026-10-29T09:00:00.000Z',
      end: '2026-10-29T11:00:00.000Z',
      results: [],
    });
  });

  it('answers 400 with translation keys for an invalid query, without searching', async () => {
    const error = await rejection(
      controller.searchParking({ start: window.end, end: window.start }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: ['locationRequired', 'endBeforeStart'],
    });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('ParkingController.getParkingListing', () => {
  it('returns the listing, with the window when one is given', async () => {
    findBySlug.mockResolvedValue({ slug: 'demo' } as ParkingListingDetail);
    await controller.getParkingListing('demo', window);
    expect(findBySlug).toHaveBeenCalledWith('demo', {
      start: new Date(window.start),
      end: new Date(window.end),
    });
  });

  it('answers 404 with a stable code for unknown slugs', async () => {
    findBySlug.mockResolvedValue(null);
    const error = await rejection(controller.getParkingListing('nowhere', {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'LISTING_NOT_FOUND' });
  });

  it('does not query the database for malformed slugs', async () => {
    const error = await rejection(controller.getParkingListing("x' OR 1=1--", {}));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(findBySlug).not.toHaveBeenCalled();
  });
});

describe('ParkingController routes', () => {
  const handlers = Object.getOwnPropertyNames(ParkingController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => [name, Reflect.get(ParkingController.prototype, name) as object] as const);

  it('are all public reads, each opted in on its own (never by the class)', () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ParkingController)).toBeUndefined();
    for (const [name, handler] of handlers) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler), name).toBe(true);
      expect(Reflect.getMetadata(METHOD_METADATA, handler), name).toBe(RequestMethod.GET);
    }
  });
});
