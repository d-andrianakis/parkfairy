import type { AdminBooking, AdminPayments } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBooking, loadPayments } from '@/lib/admin.server';
import { requireSession } from '@/lib/session';
import { notFoundMock } from '@/test/server-mocks';
import { renderWithProviders } from '@/test/render';
import PaymentsPage from '../payments/page';
import BookingPage from './[id]/page';
import BookingsPage from './page';

vi.mock('@/lib/admin.server', () => ({ loadBooking: vi.fn(), loadPayments: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/server-env', () => ({
  parseServerEnv: () => ({ BETTER_AUTH_URL: 'http://localhost:3000' }),
}));
vi.mock('@/lib/admin-client', () => ({
  lookUpBooking: vi.fn(),
  cancelBooking: vi.fn(),
  retryRefund: vi.fn(),
  settleRefund: vi.fn(),
  decideDispute: vi.fn(),
  useAdminError: () => () => 'error',
}));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());
vi.mock('next/navigation', async () => ({
  notFound: (await import('@/test/server-mocks')).notFoundMock,
}));

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const DISPUTE = '8a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const staff = { session: { user: { name: 'Staff Sam' } }, standing: 'staff' as const };
const params = (locale: 'en' | 'el' = 'en', id = ID) => Promise.resolve({ locale, id });
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await page}</>, { locale });

// The generated client leaves a nullable enum without its null: what the API sends is cast in.
const booking = (over: Partial<AdminBooking> = {}): AdminBooking =>
  ({
    id: ID,
    reference: 'K7M4-Q2ZD',
    status: 'confirmed',
    listing: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Γκαράζ Ερμού',
      address: 'Ερμού 1, Αθήνα',
      contentLocale: 'el',
    },
    spaceLabel: 'Α1',
    startsAt: '2026-11-20T08:00:00.000Z',
    endsAt: '2026-11-20T10:30:00.000Z',
    driver: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Ελένη Παπά',
      email: 'eleni@example.gr',
    },
    vehiclePlate: 'IKB1234',
    total: { amountMinor: 1250, currency: 'EUR' },
    paymentStatus: 'succeeded',
    refund: { status: null, amount: null, attempts: 0 },
    cancelledBy: null,
    cancelledAt: null,
    transferStatus: null,
    disputes: [],
    canCancel: true,
    canRetryRefund: false,
    canSettleRefund: false,
    ...over,
  }) as unknown as AdminBooking;

beforeEach(() => {
  vi.mocked(loadBooking).mockReset();
  vi.mocked(loadPayments).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(staff as never);
  notFoundMock.mockClear();
});

describe('the bookings page', () => {
  it('asks for sign-in with its own address, and offers one reference and nothing to browse', async () => {
    const { container } = await show(BookingsPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith('/bookings');
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Booking reference')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows someone who is not staff why, and no form', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(BookingsPage({ params: params() }));
    expect(screen.queryByLabelText('Booking reference')).toBeNull();
    expect(screen.getByText('This account is not staff')).toBeInTheDocument();
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = await show(BookingsPage({ params: params('el') }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Κρατήσεις' })).toBeInTheDocument();
    expect(screen.getByLabelText('Κωδικός κράτησης')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('a booking', () => {
  it('shows what was booked, by whom, what was paid and where it stands, with the cancel on offer', async () => {
    vi.mocked(loadBooking).mockResolvedValue(booking());
    const { container } = await show(BookingPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith(`/bookings/${ID}`);
    expect(loadBooking).toHaveBeenCalledWith(ID);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Booking K7M4-Q2ZD');
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('€12.50')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('IKB1234')).toBeInTheDocument();
    expect(screen.getByText('eleni@example.gr')).toBeInTheDocument();
    // The driver's Greek name is marked Greek on an English page, and isolated.
    expect(screen.getByText('Ελένη Παπά').closest('bdi')).not.toBeNull();
    expect(screen.getByText('Ελένη Παπά')).toHaveAttribute('lang', 'el');
    expect(screen.getByRole('link', { name: 'Open the driver’s account' })).toHaveAttribute(
      'href',
      '/en/users/22222222-2222-4222-8222-222222222222',
    );
    expect(screen.getByRole('button', { name: 'Cancel this booking…' })).toBeInTheDocument();
    expect(screen.getByText('No disputes.')).toBeInTheDocument();
    for (const time of screen.getAllByRole('time')) expect(time).toHaveAttribute('datetime');
    await expectNoAxeViolations(container);
  });

  it('shows a cancelled booking with its refund and who called it off, and nothing to do', async () => {
    vi.mocked(loadBooking).mockResolvedValue(
      booking({
        status: 'cancelled',
        cancelledBy: 'owner',
        cancelledAt: '2026-11-16T09:00:00.000Z',
        refund: { status: 'owed', amount: { amountMinor: 1250, currency: 'EUR' }, attempts: 0 },
        canCancel: false,
      }),
    );
    await show(BookingPage({ params: params() }));
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Owed, not sent yet · €12\.50/)).toBeInTheDocument();
    expect(screen.getByText(/By an owner, a manager or support/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Nothing to do here');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a failed refund with its attempts, and both ways to deal with it', async () => {
    vi.mocked(loadBooking).mockResolvedValue(
      booking({
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: '2026-11-16T09:00:00.000Z',
        refund: { status: 'failed', amount: { amountMinor: 1250, currency: 'EUR' }, attempts: 2 },
        canCancel: false,
        canRetryRefund: true,
        canSettleRefund: true,
      }),
    );
    await show(BookingPage({ params: params() }));
    expect(screen.getByText(/Failed at Stripe · €12\.50, asked again 2 times/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask again…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as settled…' })).toBeInTheDocument();
  });

  it('lists its disputes, and offers the decision on a lost one nobody decided', async () => {
    vi.mocked(loadBooking).mockResolvedValue(
      booking({
        disputes: [
          {
            id: DISPUTE,
            status: 'lost',
            reason: 'fraudulent',
            amount: { amountMinor: 1250, currency: 'EUR' },
            dueBy: null,
            submissions: 1,
            decision: null as never,
            decidedAt: null,
            canDecide: true,
            payoutHeld: true,
          },
          {
            id: '9a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
            status: 'lost',
            reason: 'duplicate',
            amount: { amountMinor: 500, currency: 'EUR' },
            dueBy: null,
            submissions: 0,
            decision: 'owners_bear',
            decidedAt: '2026-11-16T10:00:00.000Z',
            canDecide: false,
            payoutHeld: true,
          },
        ],
      }),
    );
    await show(BookingPage({ params: params() }));
    const disputes = within(document.querySelector('ul') as HTMLElement);
    expect(disputes.getAllByRole('listitem')).toHaveLength(2);
    expect(disputes.getByText('Waiting for a decision')).toBeInTheDocument();
    expect(disputes.getByText('The owners bear the loss')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('says Stripe’s dispute reason in words, and marks one it does not know as English', async () => {
    const dispute = (reason: string, id: string) => ({
      id,
      status: 'lost' as const,
      reason,
      amount: { amountMinor: 1250, currency: 'EUR' },
      dueBy: null as never,
      submissions: 0,
      decision: null as never,
      decidedAt: null as never,
      canDecide: false,
      payoutHeld: true,
    });
    vi.mocked(loadBooking).mockResolvedValue(
      booking({
        disputes: [dispute('fraudulent', DISPUTE), dispute('something_new', ID)] as never,
      }),
    );
    await show(BookingPage({ params: params('el') }), 'el');
    expect(screen.getByText('Απάτη')).toBeInTheDocument();
    const unknown = screen.getByText('something new');
    expect(unknown).toHaveAttribute('lang', 'en');
  });

  it('keeps a heading when it cannot be loaded, so the page still has one', async () => {
    vi.mocked(loadBooking).mockResolvedValue('unavailable');
    await show(BookingPage({ params: params() }));
    expect(screen.getByRole('heading', { level: 1, name: 'Booking' })).toBeInTheDocument();
  });

  it('is a not-found page for an id that is not one, or a booking that is gone', async () => {
    await expect(BookingPage({ params: params('en', 'not-an-id') })).rejects.toThrow();
    expect(loadBooking).not.toHaveBeenCalled();
    vi.mocked(loadBooking).mockResolvedValue('not-found');
    await expect(BookingPage({ params: params() })).rejects.toThrow();
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });

  it('says in words when it cannot be loaded, with the way back', async () => {
    vi.mocked(loadBooking).mockResolvedValue('unavailable');
    await show(BookingPage({ params: params() }));
    expect(screen.getByRole('link', { name: 'Back to bookings' })).toHaveAttribute(
      'href',
      '/en/bookings',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['not-staff', 'This account is not staff'],
    ['no-second-factor', 'Turn on two-factor first'],
  ] as const)(
    'shows %s staff why, asks the API for nothing, and shows nothing of the driver',
    async (standing, title) => {
      vi.mocked(requireSession).mockResolvedValue({ session: { user: {} }, standing } as never);
      await show(BookingPage({ params: params() }));
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(loadBooking).not.toHaveBeenCalled();
      expect(screen.queryByText('eleni@example.gr')).toBeNull();
    },
  );

  it('reads in Greek, on the 24-hour clock, axe-clean', async () => {
    vi.mocked(loadBooking).mockResolvedValue(booking());
    const { container } = await show(BookingPage({ params: params('el') }), 'el');
    expect(screen.getByText('Επιβεβαιωμένη')).toBeInTheDocument();
    expect(screen.getByText('Πληρώθηκε')).toBeInTheDocument();
    for (const time of screen.getAllByRole('time')) {
      expect(time.textContent).not.toMatch(/π\.μ\.|μ\.μ\./);
    }
    expect(screen.getAllByRole('time')[0]?.textContent).toMatch(/10:00/);
    await expectNoAxeViolations(container);
  });
});

describe('the payments page', () => {
  const item = (over: Partial<AdminPayments['lostDisputes'][number]> = {}) =>
    ({
      bookingId: ID,
      reference: 'K7M4-Q2ZD',
      listingName: 'Γκαράζ Ερμού',
      contentLocale: 'el' as const,
      amount: { amountMinor: 1250, currency: 'EUR' },
      disputeId: DISPUTE,
      disputeStatus: 'lost' as const,
      reason: 'fraudulent',
      dueBy: null,
      attempts: 0,
      at: '2026-11-15T10:00:00.000Z',
      ...over,
    }) as unknown as AdminPayments['lostDisputes'][number];
  const none = {
    lostDisputes: [],
    openDisputes: [],
    failedRefunds: [],
    more: { lostDisputes: false, openDisputes: false, failedRefunds: false },
  };

  it('lists the three, each row a way into its booking, and says nothing of the driver', async () => {
    vi.mocked(loadPayments).mockResolvedValue({
      ...none,
      lostDisputes: [item()],
      openDisputes: [
        item({
          disputeStatus: 'needs_response',
          dueBy: '2026-11-20T10:00:00.000Z',
          reference: 'AAAA-BBBB',
        }),
      ],
      failedRefunds: [
        item({
          disputeId: null,
          disputeStatus: null as never,
          reason: null,
          attempts: 2,
          reference: 'CCCC-DDDD',
        }),
      ],
    });
    const { container } = await show(PaymentsPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith('/payments');
    expect(screen.getByRole('heading', { level: 1, name: 'Payments' })).toBeInTheDocument();
    const lost = screen.getByRole('table', { name: 'Lost disputes waiting for a decision' });
    expect(within(lost).getByRole('link', { name: 'K7M4-Q2ZD' })).toHaveAttribute(
      'href',
      `/en/bookings/${ID}`,
    );
    expect(within(lost).getByText('Lost')).toBeInTheDocument();
    expect(within(lost).getByText('€12.50')).toBeInTheDocument();
    const open = screen.getByRole('table', { name: 'Disputes still open at the bank' });
    expect(within(open).getByText('Needs a response')).toBeInTheDocument();
    expect(within(open).getAllByRole('time')[0]).toHaveAttribute(
      'datetime',
      '2026-11-20T10:00:00.000Z',
    );
    const failed = screen.getByRole('table', { name: 'Refunds that failed' });
    expect(within(failed).getByText('2')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/@|IKB/);
    await expectNoAxeViolations(container);
  });

  it('says so for a list with nothing in it, and when a full list has more', async () => {
    vi.mocked(loadPayments).mockResolvedValue({
      ...none,
      failedRefunds: [item({ disputeId: null, disputeStatus: null as never, reason: null })],
      more: { ...none.more, failedRefunds: true },
    });
    await show(PaymentsPage({ params: params() }));
    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    expect(screen.getByText('None open.')).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 1; there are more\./)).toBeInTheDocument();
  });

  it('says in words when it cannot be loaded', async () => {
    vi.mocked(loadPayments).mockResolvedValue('unavailable');
    await show(PaymentsPage({ params: params() }));
    expect(screen.getByRole('heading', { level: 1, name: 'Payments' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows someone who is not staff why, and asks the API for nothing', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(PaymentsPage({ params: params() }));
    expect(loadPayments).not.toHaveBeenCalled();
    expect(screen.getByText('This account is not staff')).toBeInTheDocument();
  });

  it('reads in Greek, axe-clean', async () => {
    vi.mocked(loadPayments).mockResolvedValue({ ...none, lostDisputes: [item()] });
    const { container } = await show(PaymentsPage({ params: params('el') }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Πληρωμές' })).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Χαμένες αμφισβητήσεις σε αναμονή απόφασης' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
