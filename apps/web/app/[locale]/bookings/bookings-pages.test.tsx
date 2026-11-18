import type { Booking, BookingList } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBooking, loadBookings, loadVehicles } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import BookingPage, { generateMetadata } from './[id]/page';
import BookingsPage from './page';

vi.mock('@/lib/bookings.server', () => ({
  loadBooking: vi.fn(),
  loadBookings: vi.fn(),
  loadVehicles: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/payments.server', () => ({ stripePublishableKey: vi.fn(() => 'pk_test_1') }));
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
  arrivalInstructions: null,
  arrivalInstructionsFrom: null,
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
  spaceId: 'a1a1a1a1-0000-4000-8000-000000000001',
  vehicleId: null,
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
  checkout: 'confirm',
  payment: null,
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
    expect(screen.getByRole('heading', { level: 1, name: 'Complete your booking' })).toBeVisible();
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
    // Paid without Stripe (a local run): no card to speak of.
    expect(screen.queryByText(/back to the card you paid with/)).not.toBeInTheDocument();
  });

  it('says where a refund at Stripe goes and how long it takes, in Greek too (4.2)', async () => {
    const cancelled = (refundMinor: number) =>
      confirmed({
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: '2099-12-02T10:00:00.000Z',
        refund: { amountMinor: refundMinor, currency: 'EUR' },
        refundIfCancelled: null,
        checkout: 'payment',
        payment: 'succeeded',
      });
    const view = await showBooking(cancelled(400));
    expect(
      screen.getByText(
        'It goes back to the card you paid with and can take a few days to show on your card or bank statement.',
      ),
    ).toBeInTheDocument();
    view.unmount();
    const greek = await showBooking(cancelled(400), undefined, 'el');
    expect(
      screen.getByText(/^Επιστρέφεται στην κάρτα με την οποία πληρώσατε\./),
    ).toBeInTheDocument();
    greek.unmount();
    // Nothing back under the terms: nothing to say about a card.
    await showBooking(cancelled(0));
    expect(screen.queryByText(/back to the card you paid with/)).not.toBeInTheDocument();
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
      screen.getByRole('heading', { level: 1, name: 'Ολοκληρώστε την κράτησή σας' }),
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

describe('a booking’s page, paying (decisions #3, #49)', () => {
  const paying = (overrides: Partial<Booking> = {}) =>
    booking({ checkout: 'payment', ...overrides });

  it('asks for the car and then the payment, with nothing said of a test site', async () => {
    const { container } = await showBooking(paying());
    expect(screen.getByRole('textbox', { name: 'Number plate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument();
    expect(screen.queryByText(/takes no payment/)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('says the bank is still deciding, in place of the form, focused just after paying', async () => {
    const { container } = await showBooking(paying({ payment: 'processing' }), 'paid');
    expect(
      screen.getByRole('heading', { level: 2, name: 'We’re confirming your payment' }),
    ).toHaveFocus();
    expect(screen.queryByRole('textbox', { name: 'Number plate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('keeps saying so for a late payment, after the hold ran out', async () => {
    await showBooking(paying({ status: 'expired', payment: 'processing' }));
    expect(
      screen.getByRole('heading', { name: 'We’re confirming your payment' }),
    ).not.toHaveFocus();
    expect(screen.queryByText('Your hold has ended')).not.toBeInTheDocument();
  });

  it('says the booking is made when paid', async () => {
    await showBooking(confirmed({ checkout: 'payment', payment: 'succeeded' }), 'paid');
    expect(screen.getByRole('heading', { level: 2, name: 'Booking confirmed' })).toHaveFocus();
  });

  it('says a payment too late for the space goes back, with the way to choose again', async () => {
    const { container } = await showBooking(
      paying({ status: 'expired', payment: 'refunded' }),
      'paid',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your payment has been refunded' }),
    ).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Choose another space' })).toBeInTheDocument();
    expect(screen.queryByText('Your hold has ended')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('back from the bank before the webhook, asks how it went rather than for a payment again', async () => {
    await showBooking(paying({ payment: 'pending' }), 'paid');
    expect(
      screen.getByRole('heading', { level: 2, name: 'We’re confirming your payment' }),
    ).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: 'Payment in progress' })).toBeVisible();
    expect(screen.getByText('Paying')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('says a payment that didn’t go through, with the form there to pay again', async () => {
    const { container } = await showBooking(paying({ payment: 'pending' }), 'unpaid');
    expect(
      screen.getByRole('heading', { level: 2, name: 'The payment didn’t go through' }),
    ).toHaveFocus();
    expect(screen.getByText(/^Nothing was charged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('says a payment called off after the hold ended charged nothing, and offers no payment', async () => {
    for (const locale of ['en', 'el'] as const) {
      const view = await showBooking(
        paying({ status: 'expired', payment: 'canceled' }),
        'unpaid',
        locale,
      );
      const english = locale === 'en';
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: english ? 'Your hold has ended' : 'Η δέσμευση της θέσης έληξε',
        }),
      ).toHaveFocus();
      expect(
        screen.getByText(english ? /^Nothing was charged: / : /^Δεν έγινε καμία χρέωση: /),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await expectNoAxeViolations(view.container);
      view.unmount();
    }
  });

  it('says so too for a hold let go, with a heading where the payment was', async () => {
    const { container } = await showBooking(
      paying({ status: 'released', payment: 'canceled' }),
      'unpaid',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'The payment didn’t go through' }),
    ).toHaveFocus();
    expect(screen.getByText(/^Nothing was charged: /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose another space' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('is titled and badged by its money when that says more', async () => {
    await showBooking(paying({ status: 'released', payment: 'refunding' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Not booked' })).toBeVisible();
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your payment is being refunded' }),
    ).toBeInTheDocument();
    // Not "you let this space go": the driver let nothing go.
    expect(screen.queryByText(/You let this space go/)).not.toBeInTheDocument();
  });

  it('takes Stripe’s parameters out of the address back from the bank', async () => {
    window.history.replaceState(
      null,
      '',
      `/en/bookings/${ID}?done=paid&payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=succeeded`,
    );
    await showBooking(confirmed({ checkout: 'payment', payment: 'succeeded' }), 'paid');
    expect(window.location.search).toBe('?done=paid');
  });

  it('says it for a hold let go and paid for, in Greek too', async () => {
    await showBooking(paying({ status: 'released', payment: 'refunded' }), undefined, 'el');
    expect(screen.getByRole('heading', { name: 'Τα χρήματά σας επιστράφηκαν' })).not.toHaveFocus();
    expect(screen.getAllByRole('link', { name: 'Επιλέξτε άλλη θέση' })).toHaveLength(1);
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

  it('badges a booking by its money where that says more', async () => {
    await show(
      {},
      list([booking({ id: 'r', status: 'expired', checkout: 'payment', payment: 'refunded' })]),
    );
    expect(screen.getByText('Refunded')).toBeInTheDocument();
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

// Book again, and the vehicles on a booking (5A.2).
describe('book again', () => {
  const SPACE = 'a1a1a1a1-0000-4000-8000-000000000001';
  // Over long ago: Monday 6 January 2020, 10:00 to 12:00 in Athens.
  const over = (overrides: Partial<Booking> = {}) =>
    confirmed({
      start: '2020-01-06T08:00:00.000Z',
      end: '2020-01-06T10:00:00.000Z',
      refundIfCancelled: null,
      vehicleId: 'a0a0a0a0-0000-4000-8000-000000000001',
      spaceId: SPACE,
      ...overrides,
    });
  const list = (bookings: Booking[]): BookingList => ({ bookings, page: 1, hasMore: false });
  const showList = async (found: BookingList, searchParams: Record<string, string> = {}) => {
    vi.mocked(loadBookings).mockResolvedValue(found);
    return renderWithProviders(
      await BookingsPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve(searchParams),
      }),
    );
  };

  it('offers it on a stay that is over, saying which weekday and times, in the list', async () => {
    const { container } = await showList(list([over()]), { when: 'past' });
    const button = screen.getByRole('button', { name: 'Book again' });
    expect(button).toHaveAccessibleDescription(
      /^Same weekday and times: Mon.*10:00\sAM.*12:00\sPM Γκαράζ Ερμού$/,
    );
    await expectNoAxeViolations(container);
  });

  it('offers it for none of the others: to come, cancelled, or a space that is gone', async () => {
    await showList(
      list([
        confirmed({ id: 'a' }),
        over({ id: 'b', status: 'cancelled', refund: { amountMinor: 0, currency: 'EUR' } }),
        over({ id: 'c', spaceId: null }),
        booking({ id: 'd', status: 'expired' }),
      ]),
      { when: 'past' },
    );
    expect(screen.queryByRole('button', { name: 'Book again' })).toBeNull();
  });

  it('offers it on the booking’s own page, once the stay is over, and not before', async () => {
    const view = await showBooking(over());
    expect(screen.getByRole('button', { name: 'Book again' })).toBeInTheDocument();
    view.unmount();
    await showBooking(confirmed());
    expect(screen.queryByRole('button', { name: 'Book again' })).toBeNull();
  });
});

describe('a held booking’s vehicles (5A.2)', () => {
  const WORK = { id: 'a0a0a0a0-0000-4000-8000-000000000001', plate: 'IKB1234', name: 'Work car' };
  const SPARE = { id: 'a0a0a0a0-0000-4000-8000-000000000002', plate: 'YZM5678', name: null };
  const sized = (vehicle: { id: string; plate: string; name: string | null }) => ({
    ...vehicle,
    heightCm: null,
    lengthCm: null,
    widthCm: null,
  });

  it('puts the driver’s saved vehicles in the form, the one the space was held for chosen', async () => {
    vi.mocked(loadVehicles).mockResolvedValueOnce([sized(WORK), sized(SPARE)]);
    await showBooking(booking({ vehicleId: SPARE.id }));
    const picker = screen.getByRole('combobox', { name: 'Vehicle' });
    expect(picker).toHaveValue(SPARE.id);
    expect(screen.queryByRole('textbox', { name: 'Number plate' })).toBeNull();
  });

  it('asks for a plate as before when none is saved, or the list could not be read', async () => {
    const first = await showBooking(booking());
    expect(screen.getByRole('textbox', { name: 'Number plate' })).toBeInTheDocument();
    first.unmount();
    vi.mocked(loadVehicles).mockResolvedValueOnce(null);
    await showBooking(booking());
    expect(screen.getByRole('textbox', { name: 'Number plate' })).toBeInTheDocument();
  });

  it('reads no vehicles for a booking that is not asking for the car', async () => {
    await showBooking(confirmed());
    expect(loadVehicles).not.toHaveBeenCalled();
  });
});
