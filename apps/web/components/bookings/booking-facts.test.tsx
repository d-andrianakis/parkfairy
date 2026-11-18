import type { Booking } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BookingFacts } from './booking-facts';

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'b0b0b0b0-0000-4000-8000-000000000001',
  reference: 'K7M4-Q2ZD',
  status: 'confirmed',
  listing: {
    slug: 'ermou',
    name: 'Γκαράζ',
    address: 'Ερμού 1',
    contentLocale: 'el',
    timeZone: 'Europe/Athens',
  },
  spaceLabel: 'A1',
  spaceId: 'a1a1a1a1-0000-4000-8000-000000000001',
  vehicleId: null,
  start: '2099-01-01T08:00:00.000Z',
  end: '2099-01-01T10:00:00.000Z',
  total: { amountMinor: 400, currency: 'EUR' },
  cancellationPolicy: 'oneDay',
  holdExpiresAt: '2099-01-01T07:10:00.000Z',
  holdExtensionsLeft: 10,
  vehiclePlate: 'IKB1234',
  confirmedAt: '2098-12-31T08:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  refund: null,
  refundIfCancelled: null,
  checkout: 'payment',
  payment: 'succeeded',
  arrivalInstructions: null,
  arrivalInstructionsFrom: null,
  ...overrides,
});

describe('BookingFacts', () => {
  it('shows how to get in, with the owner’s line breaks and language', () => {
    renderWithProviders(
      <BookingFacts
        booking={booking({
          arrivalInstructions: { text: 'Κωδικός 4821.\nΔεύτερο επίπεδο.', contentLocale: 'el' },
        })}
      />,
    );
    const term = screen.getByText('How to get in');
    const text = term.parentElement?.querySelector('dd span');
    expect(text).toHaveAttribute('lang', 'el');
    expect(text).toHaveClass('whitespace-pre-line');
    expect(text?.textContent).toBe('Κωδικός 4821.\nΔεύτερο επίπεδο.');
  });

  it('says it in Greek on a Greek page', () => {
    renderWithProviders(
      <BookingFacts
        booking={booking({ arrivalInstructions: { text: 'Gate 4', contentLocale: 'en' } })}
      />,
      { locale: 'el' },
    );
    expect(screen.getByText('Πώς θα μπείτε')).toBeInTheDocument();
    expect(screen.getByText('Gate 4')).toHaveAttribute('lang', 'en');
  });

  it('says when the way in will be shown, in the listing’s time zone, and shows nothing of it yet', () => {
    const { container } = renderWithProviders(
      <BookingFacts booking={booking({ arrivalInstructionsFrom: '2099-01-01T08:00:00.000Z' })} />,
    );
    // 08:00 UTC is 10:00 in Athens.
    expect(screen.getByText('How to get in')).toBeInTheDocument();
    expect(screen.getByText(/Shown here from .*10:00/)).toBeInTheDocument();
    expect(container.querySelector('.whitespace-pre-line')).toBeNull();
  });

  it('says so in Greek', () => {
    renderWithProviders(
      <BookingFacts booking={booking({ arrivalInstructionsFrom: '2099-01-01T08:00:00.000Z' })} />,
      { locale: 'el' },
    );
    expect(screen.getByText('Πώς θα μπείτε')).toBeInTheDocument();
    expect(screen.getByText(/Εμφανίζονται εδώ από /)).toBeInTheDocument();
  });

  it('is axe clean with the way in shown, and with the promise of it', async () => {
    const shown = renderWithProviders(
      <BookingFacts
        booking={booking({ arrivalInstructions: { text: 'Gate 4', contentLocale: 'en' } })}
      />,
    );
    await expectNoAxeViolations(shown.container);
    shown.unmount();
    const later = renderWithProviders(
      <BookingFacts booking={booking({ arrivalInstructionsFrom: '2099-01-01T08:00:00.000Z' })} />,
    );
    await expectNoAxeViolations(later.container);
  });

  it('has no such line without instructions (a hold, an old booking, a stranger)', () => {
    renderWithProviders(<BookingFacts booking={booking()} />);
    expect(screen.queryByText('How to get in')).not.toBeInTheDocument();
  });

  it('puts the instructions in the page as text, not markup', () => {
    renderWithProviders(
      <BookingFacts
        booking={booking({
          arrivalInstructions: { text: '<img src=x onerror=alert(1)>', contentLocale: 'en' },
        })}
      />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
