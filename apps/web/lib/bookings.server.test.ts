import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBooking, loadBookings, loadOwnerBookings } from './bookings.server';

vi.mock('server-only', () => ({}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(request.headers) }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn, // no request scope in unit tests
}));

const api = vi.hoisted(() => ({
  getMyBooking: vi.fn(),
  getMyBookings: vi.fn(),
  getListingBookings: vi.fn(),
}));
vi.mock('@parkfairy/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@parkfairy/api-client')>()),
  ...api,
}));

const FOUND = { id: 'b' };
const answered = (status: number) => ({
  data: undefined,
  response: new Response(null, { status }),
});
const VISITOR = { cookie: 'session=1', 'x-forwarded-for': '203.0.113.7' };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  request.headers = new Headers(VISITOR);
});

describe.each([
  ['loadBooking', () => loadBooking('b'), api.getMyBooking, { path: { id: 'b' } }],
  [
    'loadOwnerBookings',
    () => loadOwnerBookings('l', '1762934400000_0b1e7a52-3f4c-4d2a-9e8b-5c6d7e8f9a0b'),
    api.getListingBookings,
    { path: { id: 'l' }, query: { after: '1762934400000_0b1e7a52-3f4c-4d2a-9e8b-5c6d7e8f9a0b' } },
  ],
] as const)('%s', (_name, load, call, asked) => {
  it('asks as the visitor, so the API decides whose it is', async () => {
    call.mockResolvedValue({ data: FOUND, response: new Response() });
    await expect(load()).resolves.toBe(FOUND);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ ...asked, headers: VISITOR }));
  });

  it('tells a booking or listing that isn’t theirs from an outage', async () => {
    call.mockResolvedValue(answered(404));
    await expect(load()).resolves.toBe('not-found');
    call.mockResolvedValue(answered(401));
    await expect(load()).resolves.toBe('unavailable');
    call.mockRejectedValue(new Error('timeout'));
    await expect(load()).resolves.toBe('unavailable');
  });
});

it('asks for the first page of an owner’s list without a place, and back from one with it', async () => {
  const place = '1762934400000_0b1e7a52-3f4c-4d2a-9e8b-5c6d7e8f9a0b';
  api.getListingBookings.mockResolvedValue({ data: FOUND, response: new Response() });
  await loadOwnerBookings('l');
  expect(api.getListingBookings).toHaveBeenLastCalledWith(expect.objectContaining({ query: {} }));
  await loadOwnerBookings('l', '', place);
  expect(api.getListingBookings).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: { before: place } }),
  );
});

describe('loadBookings', () => {
  it('asks for one list and page as the visitor', async () => {
    api.getMyBookings.mockResolvedValue({ data: FOUND, response: new Response() });
    await expect(loadBookings('past', 3)).resolves.toBe(FOUND);
    expect(api.getMyBookings).toHaveBeenCalledWith(
      expect.objectContaining({ query: { when: 'past', page: 3 }, headers: VISITOR }),
    );
  });

  it('answers null when the API can’t, and sends no cookie it wasn’t given', async () => {
    request.headers = new Headers();
    api.getMyBookings.mockRejectedValue(new Error('down'));
    await expect(loadBookings('upcoming', 1)).resolves.toBeNull();
    expect(api.getMyBookings).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
  });
});
