import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOwnerListing, loadOwnerOnboarding, loadOwnerProfile } from './owner.server';

vi.mock('server-only', () => ({}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(request.headers) }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn, // no request scope in unit tests
}));

const api = vi.hoisted(() => ({
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

describe('loadOwnerListing', () => {
  it('returns the listing', async () => {
    api.getOwnerListing.mockResolvedValue({ data: LISTING, response: new Response() });
    await expect(loadOwnerListing('a')).resolves.toBe(LISTING);
  });

  it('asks as the visitor, so the API decides what they may see', async () => {
    api.getOwnerListing.mockResolvedValue({ data: LISTING, response: new Response() });
    await loadOwnerListing('a');
    expect(api.getOwnerListing).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'a' },
        headers: { cookie: 'session=1', 'x-forwarded-for': '203.0.113.7' },
      }),
    );
  });

  it('calls a 404 not found: another owner’s listing looks the same', async () => {
    api.getOwnerListing.mockResolvedValue(answered(404));
    await expect(loadOwnerListing('a')).resolves.toBe('not-found');
  });

  it('never calls an outage not found, which would look like a lost listing', async () => {
    api.getOwnerListing.mockResolvedValue(answered(500));
    await expect(loadOwnerListing('a')).resolves.toBe('unavailable');
    api.getOwnerListing.mockRejectedValue(new Error('timed out'));
    await expect(loadOwnerListing('a')).resolves.toBe('unavailable');
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
