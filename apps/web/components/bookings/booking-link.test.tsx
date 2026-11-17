import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stripePublishableKey } from '@/lib/payments.server';
import { renderWithProviders } from '@/test/render';

import { BookingLink } from './booking-link';

vi.mock('@/lib/payments.server', () => ({ stripePublishableKey: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookingLink', () => {
  it('loads a real page where drivers pay, so the page’s own CSP lets Stripe in', () => {
    vi.mocked(stripePublishableKey).mockReturnValue('pk_test_1');
    renderWithProviders(<BookingLink id="b1">Booking</BookingLink>, { locale: 'el' });
    const link = screen.getByRole('link', { name: 'Booking' });
    expect(link).toHaveAttribute('href', '/el/bookings/b1');
    // A plain link: nothing stops the browser from loading the page.
    expect(fireEvent.click(link)).toBe(true);
  });

  it('stays a client navigation for a booking made, which takes no payment', () => {
    vi.mocked(stripePublishableKey).mockReturnValue('pk_test_1');
    renderWithProviders(
      <BookingLink id="b1" paying={false}>
        Booking
      </BookingLink>,
    );
    expect(fireEvent.click(screen.getByRole('link', { name: 'Booking' }))).toBe(false);
  });

  it('stays a client navigation where nothing is paid', () => {
    vi.mocked(stripePublishableKey).mockReturnValue(null);
    renderWithProviders(<BookingLink id="b1">Booking</BookingLink>);
    const link = screen.getByRole('link', { name: 'Booking' });
    expect(link).toHaveAttribute('href', '/en/bookings/b1');
    expect(fireEvent.click(link)).toBe(false);
  });
});
