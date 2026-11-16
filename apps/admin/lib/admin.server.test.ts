// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  getAdminQueue: vi.fn(),
  getAdminListing: vi.fn(),
  getAdminUser: vi.fn(),
  getAdminBooking: vi.fn(),
  getAdminPayments: vi.fn(),
  getAuditLog: vi.fn(),
}));
vi.mock('@parkfairy/api-client', () => ({
  createClient: () => ({}),
  createConfig: (config: unknown) => config,
  ...sdk,
}));
let incoming = new Headers();
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(incoming) }));
vi.mock('server-only', () => ({}));

const { loadAudit, loadBooking, loadPayments, loadQueue, loadReview, loadUser } =
  await import('./admin.server');
const answer = (status: number, data?: unknown) => ({
  data,
  response: new Response(null, { status }),
});
const lastOptions = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.at(-1)?.[0] as { headers: Record<string, string>; query?: unknown; path?: unknown };

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockReset();
  incoming = new Headers({
    cookie: 'parkfairy.session_token=abc',
    'x-forwarded-for': '203.0.113.9',
  });
});

describe('what staff pages learn from the API', () => {
  it.each([
    [404, 'not-found'],
    [401, 'forbidden'],
    [403, 'forbidden'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('reads a %s as %s', async (status, expected) => {
    sdk.getAdminQueue.mockResolvedValue(answer(status));
    sdk.getAdminListing.mockResolvedValue(answer(status));
    sdk.getAuditLog.mockResolvedValue(answer(status));
    expect(await loadQueue('in_review', `q${status}`)).toBe(expected);
    expect(await loadReview(`id${status}`)).toBe(expected);
    sdk.getAdminUser.mockResolvedValue(answer(status));
    expect(await loadUser(`user${status}`)).toBe(expected);
    sdk.getAdminBooking.mockResolvedValue(answer(status));
    expect(await loadBooking(`booking${status}`)).toBe(expected);
    sdk.getAdminPayments.mockResolvedValue(answer(status));
    expect(await loadPayments()).toBe(expected);
    expect(await loadAudit(undefined, `a${status}`)).toBe(expected);
  });

  it('reads a call that threw as unavailable, and one with no answer too', async () => {
    sdk.getAdminQueue.mockRejectedValue(new Error('timeout'));
    sdk.getAdminListing.mockResolvedValue({});
    expect(await loadQueue('published', 'thrown')).toBe('unavailable');
    expect(await loadReview('noanswer')).toBe('unavailable');
  });

  it('gives the data when there is some', async () => {
    sdk.getAdminQueue.mockResolvedValue(answer(200, { listings: [], next: null }));
    expect(await loadQueue('suspended', 'ok')).toEqual({ listings: [], next: null });
  });

  it('asks as the signed-in staff member: their cookie and address go along', async () => {
    sdk.getAdminQueue.mockResolvedValue(answer(200, { listings: [], next: null }));
    await loadQueue('changes_requested', 'fwd');
    expect(lastOptions(sdk.getAdminQueue).headers).toEqual({
      cookie: 'parkfairy.session_token=abc',
      'x-forwarded-for': '203.0.113.9',
    });
    expect(lastOptions(sdk.getAdminQueue).query).toEqual({
      status: 'changes_requested',
      after: 'fwd',
    });
  });

  it('sends no cookie when it has none, and asks for the log with the filter and the place', async () => {
    incoming = new Headers();
    sdk.getAuditLog.mockResolvedValue(answer(200, { entries: [], next: null }));
    await loadAudit('listing.approved', 'place');
    expect(lastOptions(sdk.getAuditLog).headers).toEqual({});
    expect(lastOptions(sdk.getAuditLog).query).toEqual({
      action: 'listing.approved',
      after: 'place',
    });
  });

  it('asks for an account by its own id, as the signed-in staff member, and reads a throw as unavailable', async () => {
    sdk.getAdminUser.mockResolvedValue(answer(200, { id: 'x' }));
    expect(await loadUser('7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f')).toEqual({ id: 'x' });
    expect(lastOptions(sdk.getAdminUser).path).toEqual({
      id: '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
    });
    expect(lastOptions(sdk.getAdminUser).headers).toMatchObject({
      cookie: 'parkfairy.session_token=abc',
    });
    sdk.getAdminUser.mockRejectedValue(new Error('timeout'));
    expect(await loadUser('thrown')).toBe('unavailable');
  });

  it('asks for a booking by its own id, and for the payments, as the signed-in staff member', async () => {
    sdk.getAdminBooking.mockResolvedValue(answer(200, { id: 'x' }));
    expect(await loadBooking('7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f')).toEqual({ id: 'x' });
    expect(lastOptions(sdk.getAdminBooking).path).toEqual({
      id: '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
    });
    expect(lastOptions(sdk.getAdminBooking).headers).toMatchObject({
      cookie: 'parkfairy.session_token=abc',
    });
    sdk.getAdminPayments.mockResolvedValue(answer(200, { lostDisputes: [] }));
    await loadPayments();
    expect(lastOptions(sdk.getAdminPayments).headers).toMatchObject({
      cookie: 'parkfairy.session_token=abc',
    });
    sdk.getAdminBooking.mockRejectedValue(new Error('timeout'));
    expect(await loadBooking('thrown')).toBe('unavailable');
  });

  it('asks for a listing by its own id', async () => {
    sdk.getAdminListing.mockResolvedValue(answer(200, { id: 'x' }));
    await loadReview('7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f');
    expect(lastOptions(sdk.getAdminListing).path).toEqual({
      id: '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
    });
  });
});
