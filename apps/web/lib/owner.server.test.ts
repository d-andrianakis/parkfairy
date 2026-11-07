import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadOtherListings,
  loadOwnerClosures,
  loadOwnerListing,
  loadOwnerOnboarding,
  loadOwnerProfile,
} from './owner.server';

vi.mock('server-only', () => ({}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(request.headers) }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn, // no request scope in unit tests
}));

const api = vi.hoisted(() => ({
  getListingHoursExceptions: vi.fn(),
  getOtherOwnerListings: vi.fn(),
  getOwnerListing: vi.fn(),
  getOwnerOnboarding: vi.fn(),
  getOwnerProfile: vi.fn(),
}));
vi.mock('@parkfairy/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@parkfairy/api-client')>()),
  ...api,
}));

const LISTING = { id: 'a' };
const answered = (status: number) => ({
  data: undefined,
  response: new Response(null, { status }),
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  request.headers = new Headers({ cookie: 'session=1', 'x-forwarded-for': '203.0.113.7' });
});

describe.each([
  ['loadOwnerListing', loadOwnerListing, api.getOwnerListing],
  ['loadOwnerClosures', loadOwnerClosures, api.getListingHoursExceptions],
] as const)('%s', (_name, load, call) => {
  it('returns the listing', async () => {
    call.mockResolvedValue({ data: LISTING, response: new Response() });
    await expect(load('a')).resolves.toBe(LISTING);
  });

  it('asks as the visitor, so the API decides what they may see', async () => {
    call.mockResolvedValue({ data: LISTING, response: new Response() });
    await load('a');
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'a' },
        headers: { cookie: 'session=1', 'x-forwarded-for': '203.0.113.7' },
      }),
    );
  });

  it('calls a 404 not found: another owner’s listing looks the same', async () => {
    call.mockResolvedValue(answered(404));
    await expect(load('a')).resolves.toBe('not-found');
  });

  it('never calls an outage not found, which would look like a lost listing', async () => {
    call.mockResolvedValue(answered(500));
    await expect(load('a')).resolves.toBe('unavailable');
    call.mockRejectedValue(new Error('timed out'));
    await expect(load('a')).resolves.toBe('unavailable');
  });
});

describe('loadOtherListings', () => {
  const others = [{ id: 'b', name: 'Β', contentLocale: 'el', status: 'draft' }];

  it('returns the owner’s other listings, asking as the visitor', async () => {
    api.getOtherOwnerListings.mockResolvedValue({ data: { listings: others } });
    await expect(loadOtherListings('a')).resolves.toBe(others);
    expect(api.getOtherOwnerListings).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'a' },
        headers: expect.objectContaining({ cookie: 'session=1' }),
      }),
    );
  });

  it('offers none when the API has no answer, so the page still works', async () => {
    api.getOtherOwnerListings.mockResolvedValue(answered(404));
    await expect(loadOtherListings('a')).resolves.toEqual([]);
    api.getOtherOwnerListings.mockRejectedValue(new Error('timed out'));
    await expect(loadOtherListings('a')).resolves.toEqual([]);
  });
});

describe.each([
  ['loadOwnerOnboarding', loadOwnerOnboarding, api.getOwnerOnboarding],
  ['loadOwnerProfile', loadOwnerProfile, api.getOwnerProfile],
] as const)('%s', (_name, load, call) => {
  it('returns what the API sends', async () => {
    call.mockResolvedValue({ data: LISTING });
    await expect(load()).resolves.toBe(LISTING);
  });

  it('is null when the API has no answer, for a page to explain', async () => {
    call.mockResolvedValue(answered(500));
    await expect(load()).resolves.toBeNull();
    call.mockRejectedValue(new Error('timed out'));
    await expect(load()).resolves.toBeNull();
  });
});
