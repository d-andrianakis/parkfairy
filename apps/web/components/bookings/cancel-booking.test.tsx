import { cancelMyBooking } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { CancelBooking } from './cancel-booking';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  cancelMyBooking: vi.fn(),
}));
const cancel = vi.mocked(cancelMyBooking);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);
const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const euros = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CancelBooking', () => {
  it('asks first, saying what comes back, and puts the question in focus', async () => {
    const { container } = renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByText('Cancel this booking? You’ll get €8.00 back.')).toHaveFocus();
    expect(cancel).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('says so when nothing comes back', async () => {
    renderInSubtree(<CancelBooking id={ID} refund={euros(0)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByText(/nothing comes back/)).toBeInTheDocument();
  });

  it('cancels on the second press, for the amount shown, and comes back cancelled', async () => {
    cancel.mockResolvedValue(answer({ id: ID, status: 'cancelled' }) as never);
    renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=cancelled`),
    );
    expect(cancel).toHaveBeenCalledWith({ path: { id: ID }, body: { expectedRefundMinor: 800 } });
  });

  it('asks again with the new amount when less comes back now, and agrees to that', async () => {
    cancel.mockResolvedValueOnce({
      error: { code: 'REFUND_CHANGED', statusCode: 409, refund: euros(400) },
      response: new Response(null, { status: 409 }),
    } as never);
    cancel.mockResolvedValueOnce(answer({ id: ID, status: 'cancelled' }) as never);
    renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    const changed = await screen.findByText(
      /Less comes back now that your arrival is nearer: €4.00/,
    );
    await waitFor(() => expect(changed).toHaveFocus());
    expect(routerMock.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce());
    expect(cancel).toHaveBeenLastCalledWith({
      path: { id: ID },
      body: { expectedRefundMinor: 400 },
    });
  });

  it('keeps it, with the focus back where the question began', async () => {
    renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toHaveFocus();
  });

  it('ignores a second press while it cancels', async () => {
    let settle: (value: unknown) => void = () => undefined;
    cancel.mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelling…' }));
    expect(cancel).toHaveBeenCalledOnce();
    settle(answer({ id: ID }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce());
  });

  it('says why when it is refused, in Greek', async () => {
    cancel.mockResolvedValue(refusal('BOOKING_STARTED') as never);
    renderInSubtree(<CancelBooking id={ID} refund={euros(800)} />, { locale: 'el' });
    await userEvent.click(screen.getByRole('button', { name: 'Ακύρωση κράτησης' }));
    expect(screen.getByText('Να ακυρωθεί η κράτηση; Θα σας επιστραφεί ποσό 8,00 €.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ναι, ακύρωση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('έχει ήδη αρχίσει');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
