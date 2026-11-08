import { cancelListingBooking } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { CancelListingBooking } from './cancel-listing-booking';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  cancelListingBooking: vi.fn(),
}));
const cancel = vi.mocked(cancelListingBooking);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);
const BOOKING = 'b0b0b0b0-0000-4000-8000-000000000001';

const show = (locale: 'en' | 'el' = 'en') =>
  renderInSubtree(
    <>
      <h1 id="owner-bookings-heading" tabIndex={-1}>
        Bookings
      </h1>
      <CancelListingBooking listingId={LISTING_ID} bookingId={BOOKING} reference="K7M4-Q2ZD" />
    </>,
    { locale },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CancelListingBooking', () => {
  it('names the booking and asks first, saying the driver is refunded', async () => {
    const { container } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' }));
    expect(screen.getByText(/The driver gets the full amount back/)).toHaveFocus();
    expect(cancel).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('cancels, and comes back to the page naming the booking that went', async () => {
    cancel.mockResolvedValue(answer(undefined) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        `/owner/listings/${LISTING_ID}/bookings?cancelled=K7M4-Q2ZD`,
      ),
    );
    expect(cancel).toHaveBeenCalledWith({ path: { id: LISTING_ID, bookingId: BOOKING } });
  });

  it('keeps it, and the focus goes back to the button', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Cancel booking K7M4-Q2ZD' })).toHaveFocus();
  });

  it('says why in Greek when the stay has begun meanwhile', async () => {
    cancel.mockResolvedValue(refusal('BOOKING_STARTED') as never);
    show('el');
    await userEvent.click(screen.getByRole('button', { name: 'Ακύρωση της κράτησης K7M4-Q2ZD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ναι, ακύρωση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('έχει ήδη αρχίσει');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
