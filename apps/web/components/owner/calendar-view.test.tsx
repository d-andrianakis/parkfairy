import type { CalendarBooking, OwnerCalendar } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { CalendarView } from './calendar-view';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const OTHER = '8a2a4b63-7b4a-4b4a-8d1c-1b2c3d4e5f60';
const listing = { id: ID, name: 'Γκαράζ Κολωνακίου', contentLocale: 'el' as const };
const booking = (patch: Partial<CalendarBooking> = {}): CalendarBooking => ({
  id: ID,
  reference: 'K7M4-Q2ZD',
  listing,
  spaceLabel: 'A1',
  start: '2026-11-18T07:00:00.000Z',
  end: '2026-11-18T09:00:00.000Z',
  timeZone: 'Europe/Athens',
  driverName: 'Maria',
  vehiclePlate: 'IKB1234',
  ...patch,
});
const calendar = (patch: Partial<OwnerCalendar> = {}): OwnerCalendar => ({
  month: '2026-11',
  previous: '2026-10',
  next: '2026-12',
  listing: null,
  listings: [listing, { id: OTHER, name: null, contentLocale: 'en' }],
  days: [
    { date: '2026-11-18', bookings: [booking(), booking({ id: OTHER, reference: 'A6GT-K7C0' })] },
    { date: '2026-11-20', bookings: [booking({ id: '1'.repeat(8) + ID.slice(8) })] },
  ],
  truncated: false,
  ...patch,
});

describe('CalendarView', () => {
  it('lists the bookings under a heading for each day, in the page’s language', async () => {
    const { container } = renderWithProviders(<CalendarView calendar={calendar()} />);
    const days = screen.getAllByRole('heading', { level: 2 });
    expect(days.map((day) => day.textContent)).toEqual([
      'Wednesday, November 18',
      'Friday, November 20',
    ]);
    expect(days[0]?.querySelector('time')).toHaveAttribute('datetime', '2026-11-18');
    const first = within(days[0]?.parentElement as HTMLElement);
    expect(first.getAllByRole('listitem')).toHaveLength(2);
    expect(first.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Booking K7M4-Q2ZD',
      'Booking A6GT-K7C0',
    ]);
    // The stay on the listing's own clock (Athens is two hours ahead in November).
    expect(first.getAllByText(/09:00|9:00/).length).toBeGreaterThan(0);
    expect(first.getAllByText('IKB1234')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('names the month and the days in Greek', () => {
    renderWithProviders(<CalendarView calendar={calendar()} />, { locale: 'el' });
    expect(screen.getByText('Νοέμβριος 2026')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Τετάρτη 18 Νοεμβρίου' }),
    ).toBeInTheDocument();
  });

  it('marks a listing’s name in the language it was written in, and names the unnamed', () => {
    renderWithProviders(<CalendarView calendar={calendar()} />);
    const [first] = screen.getAllByText('Γκαράζ Κολωνακίου', { selector: 'span' });
    expect(first?.closest('[lang]')).toHaveAttribute('lang', 'el');
    expect(screen.getByRole('option', { name: 'Unnamed listing' })).toBeInTheDocument();
  });

  it('moves between months, and keeps the listing chosen', () => {
    renderWithProviders(<CalendarView calendar={calendar({ listing: ID })} />);
    const months = screen.getByRole('navigation', { name: 'Month' });
    expect(within(months).getByRole('link', { name: 'Previous month' })).toHaveAttribute(
      'href',
      `/en/owner/calendar?month=2026-10&listing=${ID}`,
    );
    expect(within(months).getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      `/en/owner/calendar?month=2026-12&listing=${ID}`,
    );
  });

  it('offers no month past the edge of what can be looked at', () => {
    renderWithProviders(<CalendarView calendar={calendar({ previous: null, next: null })} />);
    expect(screen.queryByRole('link', { name: 'Previous month' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Next month' })).toBeNull();
  });

  it('filters by a real, labelled select that works without scripts, and shows the listing once it is chosen', () => {
    const { rerender } = renderWithProviders(<CalendarView calendar={calendar()} />);
    const select = screen.getByRole('combobox', { name: 'Listing' });
    expect(select).toHaveValue('');
    expect(select.closest('form')).toHaveAttribute('method', 'get');
    expect(select).toHaveAttribute('name', 'listing');
    expect(document.querySelector('input[name="month"]')).toHaveValue('2026-11');
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
    // Every card says which listing, until one is chosen and it needn't.
    expect(screen.getAllByText('Listing', { selector: 'dt' })).toHaveLength(3);
    rerender(<CalendarView calendar={calendar({ listing: ID })} />);
    expect(screen.getByRole('combobox', { name: 'Listing' })).toHaveValue(ID);
    expect(screen.queryAllByText('Listing', { selector: 'dt' })).toHaveLength(0);
  });

  it('links each booking to its listing’s bookings, where it can be cancelled', () => {
    renderWithProviders(<CalendarView calendar={calendar()} />);
    for (const link of screen.getAllByRole('link', { name: /^Open this listing’s bookings/ })) {
      expect(link).toHaveAttribute('href', `/en/owner/listings/${ID}/bookings`);
    }
  });

  it('says so when the month is empty, and when it was cut short', () => {
    const { rerender } = renderWithProviders(<CalendarView calendar={calendar({ days: [] })} />);
    expect(screen.getByText('No bookings this month.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    rerender(<CalendarView calendar={calendar({ truncated: true })} />);
    expect(screen.getByText(/more bookings than can be shown here/)).toBeVisible();
  });
});
