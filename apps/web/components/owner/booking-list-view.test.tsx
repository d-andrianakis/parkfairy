import type { OwnerBookingList, OwnerBookingListItem } from '@parkfairy/api-client';
import { ownerBookingsReach } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BookingListView, type WindowProblem } from './booking-list-view';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const OTHER = '8a2a4b63-7b4a-4b4a-8d1c-1b2c3d4e5f60';
const PLACE = '1700000000000_5b1d3a52-3f0e-4a77-9a5b-9d4d2c4f6a10';
const listing = { id: ID, name: 'Γκαράζ Κολωνακίου', contentLocale: 'el' as const };
const booking = (patch: Partial<OwnerBookingListItem> = {}): OwnerBookingListItem => ({
  id: ID,
  reference: 'K7M4-Q2ZD',
  listing,
  timeZone: 'Europe/Athens',
  spaceLabel: 'A1',
  start: '2026-11-18T07:00:00.000Z',
  end: '2026-11-18T09:00:00.000Z',
  driverName: 'Maria',
  vehiclePlate: 'IKB1234',
  total: { amountMinor: 1250, currency: 'EUR' },
  state: 'upcoming',
  cancelledBy: null,
  cancelledAt: null,
  ...patch,
});
const cancelled = (patch: Partial<OwnerBookingListItem> = {}) =>
  booking({
    state: 'cancelled',
    cancelledBy: 'owner',
    // 22:30 UTC: already the 11th in Athens, the app's zone.
    cancelledAt: '2026-11-10T22:30:00.000Z',
    ...patch,
  });
const list = (patch: Partial<OwnerBookingList> = {}): OwnerBookingList => ({
  status: 'upcoming',
  listing: null,
  from: null,
  to: null,
  listings: [listing, { id: OTHER, name: null, contentLocale: 'el' }],
  bookings: [booking(), booking({ id: OTHER, reference: 'A6GT-K7C0' })],
  previous: null,
  next: null,
  ...patch,
});
const none = { from: '', to: '' };
const view = (value: OwnerBookingList, asked = none, problem: WindowProblem | null = null) => (
  <BookingListView list={value} asked={asked} problem={problem} />
);
const cards = () => screen.getAllByRole('listitem').filter((item) => item.querySelector('h3'));

describe('BookingListView', () => {
  it('lists each booking with who is coming, in which car, and what was paid', async () => {
    const { container } = renderWithProviders(view(list()));
    expect(cards()).toHaveLength(2);
    // The group is the section's heading; each booking is one under it.
    expect(screen.getByRole('heading', { level: 2, name: 'Upcoming bookings' })).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Booking K7M4-Q2ZD',
      'Booking A6GT-K7C0',
    ]);
    const first = within(cards()[0] as HTMLElement);
    expect(first.getByText('IKB1234')).toBeInTheDocument();
    // The driver's own words, isolated from ours.
    expect(first.getByText('Maria').closest('bdi')).not.toBeNull();
    expect(first.getByText('€12.50')).toBeInTheDocument();
    expect(first.getByText('Upcoming', { selector: 'dd' })).toBeInTheDocument();
    // The stay on Athens's clock, two hours ahead in November, and not UTC's.
    const stay = first.getByText('Arrival and departure').nextElementSibling;
    expect(stay?.textContent).toMatch(/09:00.*11:00|9:00.*11:00/);
    expect(stay?.textContent).not.toMatch(/07:00|7:00/);
    await expectNoAxeViolations(container);
  });

  it('marks a listing’s name as its own language, and the unnamed one’s as ours', () => {
    renderWithProviders(
      view(
        list({ bookings: [booking({ listing: { id: OTHER, name: null, contentLocale: 'el' } })] }),
      ),
    );
    // Our own words on an English page, though the listing's content is Greek.
    const unnamed = screen.getByText('Unnamed listing', { selector: 'dd' });
    expect(unnamed.querySelector('[lang]')).toBeNull();
    expect(screen.getByRole('option', { name: 'Unnamed listing' })).not.toHaveAttribute('lang');
    expect(screen.getByRole('option', { name: 'Γκαράζ Κολωνακίου' })).toHaveAttribute('lang', 'el');
  });

  it('marks the listing’s name on a card in the language it was written in', () => {
    renderWithProviders(view(list()));
    const [named] = screen.getAllByText('Γκαράζ Κολωνακίου', { selector: 'span' });
    expect(named?.closest('[lang]')).toHaveAttribute('lang', 'el');
  });

  it('says in words, not colour, where each booking stands', () => {
    renderWithProviders(
      view(
        list({
          bookings: [
            booking({ state: 'underWay' }),
            booking({ id: '1'.repeat(8) + ID.slice(8), state: 'ended' }),
          ],
        }),
      ),
    );
    expect(screen.getByText('Under way', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Ended', { selector: 'dd' })).toBeInTheDocument();
  });

  it('shows who cancelled a booking and the day, on the app’s clock', () => {
    renderWithProviders(view(list({ status: 'cancelled', bookings: [cancelled()] })));
    expect(screen.getByText('Cancelled', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('The listing’s team or our support')).toBeInTheDocument();
    const when = screen.getByText('November 11, 2026');
    expect(when.tagName).toBe('TIME');
    expect(when).toHaveAttribute('datetime', '2026-11-10T22:30:00.000Z');
  });

  it('leaves out what a cancelled booking does not know', () => {
    renderWithProviders(
      view(
        list({
          status: 'cancelled',
          bookings: [cancelled({ cancelledBy: null, cancelledAt: null })],
        }),
      ),
    );
    expect(screen.queryByText('Cancelled by')).toBeNull();
    expect(screen.queryByText('Cancelled on')).toBeNull();
  });

  it('links only a booking still to come or under way to its listing’s bookings, named by the booking', () => {
    const { rerender } = renderWithProviders(
      view(list({ bookings: [booking({ state: 'underWay' })] })),
    );
    expect(
      screen.getByRole('link', { name: 'Open this listing’s bookings (booking K7M4-Q2ZD)' }),
    ).toHaveAttribute('href', `/en/owner/listings/${ID}/bookings`);
    for (const over of [booking({ state: 'ended' }), cancelled()]) {
      rerender(view(list({ status: 'past', bookings: [over] })));
      expect(screen.queryByRole('link', { name: /Open this listing’s bookings/ })).toBeNull();
    }
  });

  it('shows the three groups as links, the current one marked, keeping the listing', () => {
    renderWithProviders(view(list({ status: 'past', listing: ID })));
    const nav = screen.getByRole('navigation', { name: 'Which bookings' });
    expect(within(nav).getByRole('link', { name: 'Past' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Upcoming' })).not.toHaveAttribute('aria-current');
    // A window of days belongs to one group: switching starts from that group's own.
    expect(within(nav).getByRole('link', { name: 'Cancelled' })).toHaveAttribute(
      'href',
      `/en/owner/bookings?status=cancelled&listing=${ID}`,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Past bookings' })).toBeVisible();
  });

  it('filters by a labelled form that works without scripts and keeps what was asked', () => {
    renderWithProviders(
      view(list({ status: 'past', listing: ID }), { from: '2026-10-01', to: '2026-10-31' }),
    );
    const form = screen.getByRole('form', { name: 'Filter bookings' });
    expect(form).toHaveAttribute('method', 'get');
    expect(within(form).getByRole('combobox', { name: 'Listing' })).toHaveValue(ID);
    const days = within(form).getByRole('group', { name: 'Days stays start on' });
    const first = within(days).getByLabelText('First day');
    const last = within(days).getByLabelText('Last day');
    expect(first).toHaveValue('2026-10-01');
    expect(last).toHaveValue('2026-10-31');
    expect(first).toHaveAttribute('type', 'date');
    expect(document.querySelector('input[name="status"]')).toHaveValue('past');
    // The long hint is read once, on the first field; neither field is marked wrong.
    expect(first).toHaveAccessibleDescription(/each listing’s own time zone.*last 90 days/);
    expect(last).not.toHaveAccessibleDescription();
    expect(first).toBeValid();
    // The browser stops at the days the API takes.
    const { min, max } = ownerBookingsReach();
    expect(first).toHaveAttribute('min', min);
    expect(last).toHaveAttribute('max', max);
  });

  it('starts the days over when the group changes, whatever was typed and not sent', () => {
    const { rerender } = renderWithProviders(view(list({ status: 'past' })));
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-10-01' } });
    expect(screen.getByLabelText('First day')).toHaveValue('2026-10-01');
    rerender(view(list({ status: 'cancelled' })));
    expect(screen.getByLabelText('First day')).toHaveValue('');
  });

  it('says which days it read, as the API worked them out', () => {
    const { rerender } = renderWithProviders(
      view(list({ status: 'past', from: '2026-08-18', to: '2026-11-16' })),
    );
    expect(
      screen.getByText(
        'Showing bookings whose stay starts from August 18, 2026 to November 16, 2026.',
      ),
    ).toBeVisible();
    rerender(view(list({ status: 'cancelled', from: '2026-08-18', to: null })));
    expect(
      screen.getByText('Showing bookings whose stay starts on or after August 18, 2026.'),
    ).toBeVisible();
    rerender(view(list({ status: 'upcoming', from: null, to: '2026-11-16' })));
    expect(
      screen.getByText('Showing bookings whose stay starts on or before November 16, 2026.'),
    ).toBeVisible();
    rerender(view(list()));
    expect(screen.queryByText(/Showing bookings/)).toBeNull();
  });

  it('never prints a window backwards: past stays asked for from a day still to come', () => {
    renderWithProviders(view(list({ status: 'past', from: '2026-12-01', to: '2026-11-16' })));
    expect(
      screen.getByText('Showing bookings whose stay starts on or after December 1, 2026.'),
    ).toBeVisible();
  });

  it('pages with places that keep the filters, and shows only the sides that exist', () => {
    const { rerender } = renderWithProviders(
      view(list({ status: 'past', listing: ID, next: PLACE }), { from: '2026-10-01', to: '' }),
    );
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/en/owner/bookings?status=past&listing=${ID}&from=2026-10-01&after=${PLACE}`,
    );
    expect(within(pages).queryByRole('link', { name: 'Previous page' })).toBeNull();
    rerender(view(list({ previous: PLACE })));
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      `/en/owner/bookings?status=upcoming&before=${PLACE}`,
    );
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
    rerender(view(list({ previous: PLACE, next: PLACE })));
    expect(screen.getByRole('link', { name: 'Previous page' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Next page' })).toBeVisible();
    rerender(view(list()));
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('says what is missing for each group when nothing matches', () => {
    const { rerender } = renderWithProviders(view(list({ bookings: [] })));
    expect(screen.getByText('No upcoming bookings.')).toBeInTheDocument();
    rerender(view(list({ status: 'past', bookings: [] })));
    expect(screen.getByText('No past bookings in these days.')).toBeInTheDocument();
    rerender(view(list({ status: 'cancelled', bookings: [] })));
    expect(screen.getByText('No cancelled bookings in these days.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it.each(['en', 'el'] as const)(
    'explains days the wrong way round before the form, on the last day, in %s',
    async (locale) => {
      const { container } = renderWithProviders(
        view(list({ bookings: [] }), { from: '2026-11-02', to: '2026-11-01' }, 'order'),
        { locale },
      );
      const alert = screen.getByRole('alert');
      const form = screen.getByRole('form');
      // Read before the fields it is about, and a link straight to the one to change.
      expect(alert.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const reason =
        locale === 'en'
          ? 'The last day is before the first day. Choose a last day on or after the first.'
          : 'Η τελευταία ημέρα είναι πριν από την πρώτη. Επιλέξτε τελευταία ημέρα ίδια με την πρώτη ή μεταγενέστερη.';
      expect(within(alert).getByRole('link', { name: reason })).toHaveAttribute(
        'href',
        '#booking-list-to',
      );
      const [first, last] = [
        document.getElementById('booking-list-from') as HTMLElement,
        document.getElementById('booking-list-to') as HTMLElement,
      ];
      expect(last).toBeInvalid();
      expect(first).toBeValid();
      expect(last).toHaveAccessibleDescription(reason);
      expect(first).toHaveAccessibleDescription(new RegExp(`^${reason}`));
      // The fields keep what was typed, and no list is shown for days that were refused.
      expect(last).toHaveValue('2026-11-01');
      expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
      expect(container.querySelector('ul.grid.gap-3')).toBeNull();
      await expectNoAxeViolations(container);
    },
  );

  it('explains days too far apart, which either day can put right', () => {
    renderWithProviders(
      view(list({ bookings: [] }), { from: '2025-01-01', to: '2026-06-01' }, 'span'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The days are more than a year apart. Choose days at most a year apart.',
    );
    expect(screen.getByLabelText('First day')).toBeInvalid();
    expect(screen.getByLabelText('Last day')).toBeInvalid();
    expect(screen.queryByText(/No upcoming bookings/)).toBeNull();
  });

  it('reads in Greek, with money and days the Greek way', async () => {
    const { container } = renderWithProviders(
      view(
        list({
          status: 'cancelled',
          from: '2026-08-18',
          to: '2026-11-16',
          bookings: [cancelled()],
        }),
      ),
      { locale: 'el' },
    );
    expect(screen.getByRole('navigation', { name: 'Ποιες κρατήσεις' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ακυρωμένες κρατήσεις' })).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Κράτηση K7M4-Q2ZD' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ακυρωμένη', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Ποιος ακύρωσε')).toBeInTheDocument();
    expect(screen.getByText('Η ομάδα του χώρου ή η υποστήριξή μας')).toBeInTheDocument();
    expect(screen.getByText('11 Νοεμβρίου 2026')).toBeInTheDocument();
    expect(screen.getByText(/^12,50\s€$/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Εμφανίζονται οι κρατήσεις με έναρξη στάθμευσης από 18 Αυγούστου 2026 έως και 16 Νοεμβρίου 2026.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Πρώτη ημέρα')).toHaveAccessibleDescription(
      /τελευταίες 90 ημέρες/,
    );
    await expectNoAxeViolations(container);
  });
});
