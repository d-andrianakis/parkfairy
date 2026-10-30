import type { ParkingListingDetail } from '@parkfairy/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFeaturedListings, loadListing, loadSearchResults } from './api.server';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(request.headers) }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn, // no request scope in unit tests
}));

const api = vi.hoisted(() => ({
  getFeaturedParking: vi.fn(),
  searchParking: vi.fn(),
  getParkingListing: vi.fn(),
}));
vi.mock('@parkfairy/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@parkfairy/api-client')>()),
  ...api,
}));

const window = { start: '2026-11-02T07:00:00Z', end: '2026-11-02T09:00:00Z' };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  request.headers = new Headers({ 'x-forwarded-for': '203.0.113.7' });
});

describe('loadFeaturedListings', () => {
  it('returns no listings, rather than failing the home page, when the API is down', async () => {
    api.getFeaturedParking.mockRejectedValue(new TypeError('fetch failed'));
    await expect(loadFeaturedListings()).resolves.toEqual([]);
  });
});

describe('loadSearchResults', () => {
  it('passes the visitor’s address on (per-visitor rate limits) and no cookies', async () => {
    api.searchParking.mockResolvedValue({ data: { ...window, results: [] } });
    await loadSearchResults('syntagma', undefined, undefined, window.start, window.end);
    const [options] = api.searchParking.mock.calls[0] as [Record<string, unknown>];
    expect(options.headers).toEqual({ 'x-forwarded-for': '203.0.113.7' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options).not.toHaveProperty('credentials');
  });

  it('sends no forwarding header when the request has none', async () => {
    request.headers = new Headers();
    api.searchParking.mockResolvedValue({ data: { ...window, results: [] } });
    await loadSearchResults('syntagma', undefined, undefined, window.start, window.end);
    const [options] = api.searchParking.mock.calls[0] as [Record<string, unknown>];
    expect(options.headers).toEqual({});
  });

  it('returns null when the API fails or answers with an error', async () => {
    api.searchParking.mockResolvedValue({ data: undefined, error: { statusCode: 429 } });
    await expect(
      loadSearchResults('syntagma', undefined, undefined, window.start, window.end),
    ).resolves.toBeNull();
    api.searchParking.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(
      loadSearchResults('syntagma', undefined, undefined, window.start, window.end),
    ).resolves.toBeNull();
  });
});

describe('loadListing', () => {
  it('returns the listing, asking for the window only when both ends are given', async () => {
    api.getParkingListing.mockResolvedValue({
      data: { slug: 'demo' } as ParkingListingDetail,
      response: new Response(null, { status: 200 }),
    });
    await expect(loadListing('demo', window.start, window.end)).resolves.toEqual({ slug: 'demo' });
    expect(api.getParkingListing).toHaveBeenCalledWith(
      expect.objectContaining({ path: { slug: 'demo' }, query: window }),
    );
    await loadListing('demo', window.start, undefined);
    expect(api.getParkingListing).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: undefined }),
    );
  });

  it('passes the visitor’s address on, like search', async () => {
    api.getParkingListing.mockResolvedValue({
      data: { slug: 'demo' } as ParkingListingDetail,
      response: new Response(null, { status: 200 }),
    });
    await loadListing('demo', undefined, undefined);
    expect(api.getParkingListing).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'x-forwarded-for': '203.0.113.7' } }),
    );
  });

  it('tells "not found" (404, or a malformed slug never sent) from "unavailable"', async () => {
    api.getParkingListing.mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 404 }),
    });
    await expect(loadListing('gone', undefined, undefined)).resolves.toBe('not-found');

    api.getParkingListing.mockResolvedValue({
      data: undefined,
      response: new Response(null, { status: 500 }),
    });
    await expect(loadListing('demo', undefined, undefined)).resolves.toBe('unavailable');

    api.getParkingListing.mockRejectedValue(new TypeError('fetch failed'));
    await expect(loadListing('demo', undefined, undefined)).resolves.toBe('unavailable');

    api.getParkingListing.mockClear();
    await expect(loadListing('..', undefined, undefined)).resolves.toBe('not-found');
    expect(api.getParkingListing).not.toHaveBeenCalled();
  });
});
