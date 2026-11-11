import type { Booking, BookingList } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBooking, loadBookings } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import BookingPage, { generateMetadata } from './[id]/page';
import BookingsPage from './page';

vi.mock('@/lib/bookings.server', () => ({ loadBooking: vi.fn(), loadBookings: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator, createFormatter }, en, el] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
    import('@/messages/el.json'),
  ]);
  const catalogs = { en: en.default, el: el.default };
  return {
    getTranslations: ({ locale, namespace }: { locale: 'en' | 'el'; namespace: string }) =>
      Promise.resolve(
        createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never }),
      ),
    getFormatter: ({ locale }: { locale: 'en' | 'el' }) =>
      Promise.resolve(createFormatter({ locale, timeZone: 'Europe/Athens' })),
  };
});

const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: ID,
  reference: 'K7M4-Q2ZD',
  status: 'held',
  listing: {
    slug: 'ermou-garage',
    name: 'Γκαράζ Ερμού',
    address: 'Ερμού 1, Αθήνα',
    contentLocale: 'el',
    timeZone: 'Europe/Athens',
  },
  spaceLabel: 'Α1',
  // Far ahead, so the clock never makes these past: 10:00 to 12:00 in Athens.
  start: '2099-12-10T08:00:00.000Z',
  end: '2099-12-10T10:00:00.000Z',
  total: { amountMinor: 400, currency: 'EUR' },
  cancellationPolicy: 'oneDay',
  holdExpiresAt: '2099-12-01T10:10:00.000Z',
  holdExtensionsLeft: 10,
  vehiclePlate: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  refund: null,
  refundIfCancelled: null,
  ...overrides,
});
const confirmed = (overrides: Partial<Booking> = {}) =>
  booking({
    status: 'confirmed',
    vehiclePlate: 'IKB1234',
    confirmedAt: '2099-12-01T10:05:00.000Z',
    refundIfCancelled: { amountMinor: 400, currency: 'EUR' },
    ...overrides,
  });

async function showBooking(
  found: Awaited<ReturnType<typeof loadBooking>>,
  done?: string,
  locale = 'en',
) {
  vi.mocked(loadBooking).mockResolvedValue(found);
  const page = await BookingPage({
    params: Promise.resolve({ locale, id: ID }),
    searchParams: Promise.resolve(done ? { done } : {}),
  });
  return renderWithProviders(page, { locale: locale as 'en' | 'el' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a booking’s page', () => {
  it('needs the driver signed in, and treats another’s booking as none at all', async () => {
    await expect(showBooking('not-found')).rejects.toThrow('not found');
    expect(requireSession).toHaveBeenCalledWith(`/bookings/${ID}`);
  });

  it('keeps an outage apart from a missing booking, with a heading to land on', async () => {
    await showBooking('unavailable');
    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Your booking' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });

  it('asks a held booking for the car, saying until when the space is kept', async () => {
    const { container } = await showBooking(booking());
    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your booking' })).toBeVisible();
    expect(screen.getByText('Held for you')).toBeInTheDocument();
    // In Greek time, said so, and the owner's label in their language inside the sentence.
    expect(document.body).toHaveTextContent(
      /keeping space Α1 for you until 12:10 PM \(Greek time\)/,
    );
    expect(screen.getByText('Α1', { selector: 'p span' })).toHaveAttribute('lang', 'el');
    expect(screen.getByRole('textbox', { name: 'Number plate' })).toBeInTheDocument();
    expect(screen.getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    // No reference before it's booked: it names a booking, not a hold.
    expect(screen.queryByText('K7M4-Q2ZD')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('marks the Greek words in an English listing’s words, the space’s label included', async () => {
    const english = {
      ...booking().listing,
      name: 'Garage by Πλατεία Κλαυθμώνος',
      address: 'Ermou 1, Σύνταγμα, Athens',
      contentLocale: 'en' as const,
    };
    const { container } = await showBooking(booking({ listing: english, spaceLabel: 'Α1' }));
    // Inside the sentence that holds it: a Greek alpha, read as Greek in an English label.
    const held = screen.getByText(/keeping space/);
    const label = within(held).getByText('Α1');
    expect(label).toHaveAttribute('lang', 'el');
    expect(label.parentElement).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Πλατεία Κλαυθμώνος')).toHaveAttribute('lang', 'el');
    expect(screen.getByText('Σύνταγμα')).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
  });

  it('marks them in the facts of a booking made', async () => {
    const english = { ...booking().listing, contentLocale: 'en' as const };
    await showBooking(confirmed({ listing: english, spaceLabel: 'Θέση Α1' }), 'confirmed');
    const label = screen.getByText('Θέση Α1');
    expect(label).toHaveAttribute('lang', 'el');
    expect(label.parentElement).toHaveAttribute('lang', 'en');
    expect(label.parentElement).toHaveClass('font-mono');
  });

  it('asks to choose again as soon as the hold has run out, swept or not (decision #37)', async () => {
    const lapsed = new Date(Date.now() - 60_000).toISOString();
    for (const status of ['held', 'expired'] as const) {
      const { unmount } = await showBooking(booking({ status, holdExpiresAt: lapsed }));
      expect(screen.getByRole('heading', { level: 2, name: 'Your hold has ended' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Keep it/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('offers to keep a running hold longer, beside Confirm', async () => {
    await showBooking(booking());
    expect(screen.getByRole('button', { name: 'Keep it for 10 more minutes' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/if you need longer, keep it for another 10 minutes/);
  });

  it('asks to choose again for a hold long gone', async () => {
    await showBooking(booking({ status: 'expired', holdExpiresAt: '2020-01-01T00:00:00.000Z' }));
    expect(screen.getByText(/may be someone else’s now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose another space' })).toBeInTheDocument();
  });

  it('says plainly when cancelling gave nothing back', async () => {
    await showBooking(
      confirmed({
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: '2099-12-09T09:00:00.000Z',
        refund: { amountMinor: 0, currency: 'EUR' },
        refundIfCancelled: null,
      }),
    );
    expect(
      screen.getByText(/Under the cancellation terms, nothing comes back to you/),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent('€0.00 comes back');
  });

  it('puts the notice after the page’s heading, in reading order', async () => {
    await showBooking(confirmed(), 'confirmed');
    const [h1, notice] = screen.getAllByRole('heading').slice(0, 2);
    expect(h1).toHaveTextContent('Your booking');
    expect(notice).toHaveTextContent('Booking confirmed');
  });

  it('announces what was just confirmed, with the reference, car and a way to cancel', async () => {
    await showBooking(confirmed(), 'confirmed');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Booking confirmed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('K7M4-Q2ZD')).toBeInTheDocument();
    expect(screen.getByText('IKB1234')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says a cancel after a confirm on the same page, though only the query changed', async () => {
    const { rerender } = await showBooking(confirmed(), 'confirmed');
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    document.body.append(main);
    main.focus(); // where `RouteFocus` puts it after the navigation
    const cancelled = confirmed({
      status: 'cancelled',
      cancelledBy: 'driver',
      cancelledAt: '2099-12-02T10:00:00.000Z',
      refund: { amountMinor: 400, currency: 'EUR' },
      refundIfCancelled: null,
    });
    vi.mocked(loadBooking).mockResolvedValue(cancelled);
    rerender(
      await BookingPage({
        params: Promise.resolve({ locale: 'en', id: ID }),
        searchParams: Promise.resolve({ done: 'cancelled' }),
      }),
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    main.remove();
  });

  it('announces nothing for a `done` that doesn’t match the booking', async () => {
    await showBooking(confirmed(), 'cancelled');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('says a stay under way can’t be cancelled here, and one over is over', async () => {
    await showBooking(confirmed({ refundIfCancelled: null, start: '2020-01-01T08:00:00.000Z' }));
    expect(screen.getByText(/can’t be cancelled here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });

  it('says who called it off and what comes back', async () => {
    await showBooking(
      confirmed({
        status: 'cancelled',
        cancelledBy: 'owner',
        cancelledAt: '2099-12-02T10:00:00.000Z',
        refund: { amountMinor: 400, currency: 'EUR' },
        refundIfCancelled: null,
      }),
      'cancelled',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Cancelled booking' })).toBeVisible();
    expect(screen.getByText(/The owner had to cancel this booking/)).toHaveTextContent('€4.00');
  });

  it('sends a driver who let the space go back to the listing for the same times', async () => {
    await showBooking(booking({ status: 'released' }));
    expect(screen.getByRole('link', { name: 'Choose another space' })).toHaveAttribute(
      'href',
      '/en/parking/ermou-garage?startDate=2099-12-10&startTime=10%3A00&endDate=2099-12-10&endTime=12%3A00',
    );
  });

  it('speaks Greek on a 24-hour clock', async () => {
    await showBooking(booking(), undefined, 'el');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Επιβεβαιώστε την κράτησή σας' }),
    ).toBeVisible();
    expect(document.body).toHaveTextContent(/έως τις 12:10 \(ώρα Ελλάδας\)/);
  });

  it('names the tab for what the booking is', async () => {
    vi.mocked(loadBooking).mockResolvedValue(confirmed());
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', id: ID }),
      searchParams: Promise.resolve({}),
    });
    expect(metadata.title).toBe('Your booking');
  });
});

describe('the bookings list', () => {
  const list = (bookings: Booking[], extra: Partial<BookingList> = {}): BookingList => ({
    bookings,
    page: 1,
    hasMore: false,
    ...extra,
  });
  const show = async (searchParams: Record<string, string>, found: BookingList | null) => {
    vi.mocked(loadBookings).mockResolvedValue(found);
    return renderWithProviders(
      await BookingsPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve(searchParams),
      }),
    );
  };

  it('shows upcoming bookings first, each a link to its page', async () => {
    const { container } = await show({}, list([confirmed(), booking({ id: 'h', status: 'held' })]));
    expect(requireSession).toHaveBeenCalledWith('/bookings');
    expect(loadBookings).toHaveBeenCalledWith('upcoming', 1);
    const tabs = screen.getByRole('navigation', { name: 'Which bookings' });
    expect(within(tabs).getByRole('link', { name: 'Upcoming' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const [first] = screen.getAllByRole('link', { name: 'Γκαράζ Ερμού' });
    expect(first).toHaveAttribute('href', `/en/bookings/${ID}`);
    expect(screen.getAllByText('Booking K7M4-Q2ZD')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('marks the Greek words in an English listing’s name and space', async () => {
    const english = {
      ...booking().listing,
      name: 'Garage by Πλατεία Κλαυθμώνος',
      contentLocale: 'en' as const,
    };
    const { container } = await show({}, list([confirmed({ listing: english })]));
    const link = screen.getByRole('link', { name: 'Garage by Πλατεία Κλαυθμώνος' });
    const greek = within(link).getByText('Πλατεία Κλαυθμώνος');
    expect(greek).toHaveAttribute('lang', 'el');
    expect(greek.parentElement).toHaveAttribute('lang', 'en');
    const space = screen.getByText('Α1');
    expect(space).toHaveAttribute('lang', 'el');
    expect(space.parentElement).toHaveAttribute('lang', 'en');
    await expectNoAxeViolations(container);
  });

  it('leaves an unnamed listing’s name, ours, unmarked', async () => {
    const unnamed = { ...booking().listing, name: null };
    await show({}, list([confirmed({ listing: unnamed })]));
    const link = screen.getByRole('link', { name: 'Unnamed parking' });
    expect(link.querySelector('[lang]')).toBeNull();
  });

  it('pages through the past, and keeps a made-up page in range', async () => {
    await show({ when: 'past', page: '2' }, list([confirmed()], { page: 2, hasMore: true }));
    expect(loadBookings).toHaveBeenCalledWith('past', 2);
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/en/bookings?when=past',
    );
    expect(within(pages).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/en/bookings?when=past&page=3',
    );
    await show({ page: '9999' }, list([]));
    expect(loadBookings).toHaveBeenLastCalledWith('upcoming', 50);
    await show({ page: 'x' }, list([]));
    expect(loadBookings).toHaveBeenLastCalledWith('upcoming', 1);
  });

  it('says when there is nothing, and when it can’t say', async () => {
    await show({}, list([]));
    expect(screen.getByText('You have no upcoming bookings.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find parking' })).toBeInTheDocument();
    await show({}, null);
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });
});
