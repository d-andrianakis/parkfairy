import type { AdminOverstay, AdminOverstays } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOverstay, loadOverstays } from '@/lib/admin.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { notFoundMock } from '@/test/server-mocks';

import OverstayPage from './[id]/page';
import OverstaysPage from './page';

vi.mock('@/lib/admin.server', () => ({ loadOverstay: vi.fn(), loadOverstays: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/server-env', () => ({
  parseServerEnv: () => ({ BETTER_AUTH_URL: 'http://localhost:3000' }),
}));
vi.mock('@/lib/admin-client', () => ({
  resolveOverstay: vi.fn(),
  useAdminError: () => () => 'error',
}));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());
vi.mock('next/navigation', async () => ({
  notFound: (await import('@/test/server-mocks')).notFoundMock,
}));

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const BOOKING = '8a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const staff = { session: { user: { name: 'Staff Sam' } }, standing: 'staff' as const };
const params = (locale: 'en' | 'el' = 'en', id = ID) => Promise.resolve({ locale, id });
const search = (value: Record<string, string | string[]> = {}) => Promise.resolve(value);
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await page}</>, { locale });

const item = (over: Partial<AdminOverstays['reports'][number]> = {}) => ({
  id: ID,
  status: 'open' as const,
  bookingId: BOOKING,
  reference: 'K7M4-Q2ZD',
  listingName: 'Γκαράζ Ερμού',
  contentLocale: 'el' as const,
  endedAt: '2026-11-16T10:00:00.000Z',
  reportedAt: '2026-11-16T13:00:00.000Z',
  ...over,
});
const queue = (over: Partial<AdminOverstays> = {}): AdminOverstays => ({
  reports: [item()],
  next: null,
  ...over,
});
const report = (over: Partial<AdminOverstay> = {}): AdminOverstay => ({
  id: ID,
  status: 'open',
  reportedAt: '2026-11-16T13:00:00.000Z',
  reporter: { name: 'Ελένη Παπά' },
  note: 'A grey Fiat\nstayed two hours on.',
  booking: {
    id: BOOKING,
    reference: 'K7M4-Q2ZD',
    listing: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Γκαράζ Ερμού',
      contentLocale: 'el',
    },
    spaceLabel: 'Α1',
    startsAt: '2026-11-16T08:00:00.000Z',
    endsAt: '2026-11-16T10:00:00.000Z',
  },
  resolution: null,
  canResolve: true,
  own: false,
  ...over,
});

beforeEach(() => {
  vi.mocked(loadOverstay).mockReset();
  vi.mocked(loadOverstays).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(staff as never);
  notFoundMock.mockClear();
});

describe('the overstays page', () => {
  it('lists open reports oldest first, each a link to its report, with no driver on a row', async () => {
    vi.mocked(loadOverstays).mockResolvedValue(queue());
    const { container } = await show(OverstaysPage({ params: params(), searchParams: search() }));
    expect(requireSession).toHaveBeenCalledWith('/overstays');
    expect(loadOverstays).toHaveBeenCalledWith('open', undefined);
    expect(screen.getByRole('heading', { level: 1, name: 'Overstays' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /K7M4-Q2ZD/ });
    expect(within(row).getByRole('link', { name: 'K7M4-Q2ZD' })).toHaveAttribute(
      'href',
      `/en/overstays/${ID}`,
    );
    expect(within(row).getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    expect(screen.getByRole('link', { name: 'Open', current: true })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('takes the status and the place from the address, each on its own', async () => {
    vi.mocked(loadOverstays).mockResolvedValue(queue({ next: '1700000000000_' + ID }));
    await show(
      OverstaysPage({
        params: params(),
        searchParams: search({ status: 'resolved', after: `1700000000000_${ID}` }),
      }),
    );
    expect(loadOverstays).toHaveBeenCalledWith('resolved', `1700000000000_${ID}`);
    expect(screen.getByRole('link', { name: 'First page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next page' })).toBeInTheDocument();
    vi.mocked(loadOverstays).mockClear();
    await show(
      OverstaysPage({ params: params(), searchParams: search({ status: 'nonsense', after: 'x' }) }),
    );
    expect(loadOverstays).toHaveBeenCalledWith('open', undefined);
  });

  it('says there is nothing, in the words of the list asked for', async () => {
    vi.mocked(loadOverstays).mockResolvedValue(queue({ reports: [] }));
    await show(OverstaysPage({ params: params(), searchParams: search() }));
    expect(screen.getByText('No open reports.')).toBeInTheDocument();
  });

  it.each([
    ['forbidden', /did not allow this request/],
    ['unavailable', /could not be loaded/],
  ])('says %s instead of showing a list', async (reason, words) => {
    vi.mocked(loadOverstays).mockResolvedValue(reason as never);
    await show(OverstaysPage({ params: params(), searchParams: search() }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(words);
  });

  it('shows someone who is not staff why, and no data', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(OverstaysPage({ params: params(), searchParams: search() }));
    expect(loadOverstays).not.toHaveBeenCalled();
    expect(screen.getByText('This account is not staff')).toBeInTheDocument();
  });

  it('reads in Greek, axe-clean', async () => {
    vi.mocked(loadOverstays).mockResolvedValue(queue());
    const { container } = await show(
      OverstaysPage({ params: params('el'), searchParams: search() }),
      'el',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Υπερβάσεις χρόνου' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('an overstay report', () => {
  it('shows who wrote it and what, the stay, a way to the booking, and the closing on offer', async () => {
    vi.mocked(loadOverstay).mockResolvedValue(report());
    const { container } = await show(OverstayPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith(`/overstays/${ID}`);
    expect(loadOverstay).toHaveBeenCalledWith(ID);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Overstay report K7M4-Q2ZD',
    );
    expect(screen.getByText('Ελένη Παπά')).toBeInTheDocument();
    expect(screen.getByText(/A grey Fiat/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open booking K7M4-Q2ZD' })).toHaveAttribute(
      'href',
      `/en/bookings/${BOOKING}`,
    );
    expect(screen.getByRole('button', { name: 'Close this report…' })).toBeInTheDocument();
    // The driver is not on it.
    expect(screen.queryByText(/IKB/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows how a closed one was closed, with nothing to do', async () => {
    vi.mocked(loadOverstay).mockResolvedValue(
      report({
        status: 'resolved',
        canResolve: false,
        resolution: {
          at: '2026-11-17T09:00:00.000Z',
          by: { name: 'Staff Sam' },
          note: 'Ticket 7001, owner called.',
        },
      }),
    );
    const { container } = await show(OverstayPage({ params: params() }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'How it was closed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ticket 7001, owner called.')).toBeInTheDocument();
    expect(screen.getByText('Staff Sam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close this report/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('says whose listing it is when the reader runs it, and offers no closing', async () => {
    vi.mocked(loadOverstay).mockResolvedValue(report({ canResolve: false, own: true }));
    await show(OverstayPage({ params: params() }));
    expect(screen.getByText(/someone else on the staff has to close/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close this report/ })).toBeNull();
  });

  it('is a 404 for what is no id, and for a report that is gone', async () => {
    await expect(OverstayPage({ params: params('en', 'nope') })).rejects.toThrow();
    expect(loadOverstay).not.toHaveBeenCalled();
    vi.mocked(loadOverstay).mockResolvedValue('not-found');
    await expect(OverstayPage({ params: params() })).rejects.toThrow();
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it('says it is unavailable, with a way back, instead of the report', async () => {
    vi.mocked(loadOverstay).mockResolvedValue('unavailable');
    await show(OverstayPage({ params: params() }));
    expect(screen.getByRole('link', { name: 'Back to the overstays' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close this report/ })).toBeNull();
  });

  it('reads in Greek, axe-clean', async () => {
    vi.mocked(loadOverstay).mockResolvedValue(report());
    const { container } = await show(OverstayPage({ params: params('el') }), 'el');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Αναφορά υπέρβασης χρόνου K7M4-Q2ZD',
    );
    await expectNoAxeViolations(container);
  });
});
