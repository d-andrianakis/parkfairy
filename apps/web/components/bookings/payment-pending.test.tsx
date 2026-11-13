import { settleMyPayment } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepFocusThroughUrlChange } from '@/components/route-focus';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { LOOKS_MS, PaymentPending } from './payment-pending';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  settleMyPayment: vi.fn(),
}));
vi.mock('@/components/route-focus', () => ({ keepFocusThroughUrlChange: vi.fn() }));
const settle = vi.mocked(settleMyPayment);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);
const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const still = () => answer({ status: 'held', payment: 'processing' }) as never;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PaymentPending', () => {
  it('says the bank is still deciding, and takes the focus when just paid', async () => {
    const { container } = renderInSubtree(<PaymentPending id={ID} focus />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'We’re confirming your payment' }),
    ).toHaveFocus();
    expect(screen.getByText(/We’ll email you once it’s settled/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('speaks Greek', () => {
    renderInSubtree(<PaymentPending id={ID} focus={false} />, { locale: 'el' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Επιβεβαιώνουμε την πληρωμή σας' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Έλεγχος ξανά' })).toBeInTheDocument();
  });

  it('looks again less and less often, within the route’s limit, and leaves the button alone', async () => {
    vi.useFakeTimers();
    settle.mockResolvedValue(still());
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    const button = screen.getByRole('button', { name: 'Check again' });
    // No more than nine looks in any minute: the settle route allows ten, a press included.
    let atMinute = 0;
    for (let first = 0; first < LOOKS_MS.length; first++) {
      let total = 0;
      let count = 0;
      for (let i = first; i < LOOKS_MS.length && total + (LOOKS_MS[i] ?? 0) <= 60_000; i++) {
        total += LOOKS_MS[i] ?? 0;
        count++;
      }
      atMinute = Math.max(atMinute, count);
    }
    expect(atMinute).toBeLessThan(10);
    await act(() => vi.advanceTimersByTimeAsync(LOOKS_MS[0] ?? 0));
    expect(settle).toHaveBeenCalledOnce();
    // A look in the background never says "unavailable" on the button.
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('waits while the tab is hidden', async () => {
    vi.useFakeTimers();
    settle.mockResolvedValue(still());
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(settle).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(settle).toHaveBeenCalledOnce();
  });

  it('moves on once booked, keeping the focus where the driver is', async () => {
    vi.useFakeTimers();
    settle
      .mockResolvedValueOnce(still())
      .mockResolvedValueOnce(answer({ status: 'confirmed', payment: 'succeeded' }) as never);
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    await act(() => vi.advanceTimersByTimeAsync(LOOKS_MS[0] ?? 0));
    expect(routerMock.replace).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(LOOKS_MS[1] ?? 0));
    expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=paid`);
    // Nobody pressed anything: the focus stays where it was.
    expect(keepFocusThroughUrlChange).toHaveBeenCalledOnce();
  });

  it('looks at once back from the bank, and says a payment not made', async () => {
    settle.mockResolvedValue(answer({ status: 'held', payment: 'pending' }) as never);
    renderInSubtree(<PaymentPending id={ID} focus now />);
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=unpaid`),
    );
  });

  it('says a payment called off at Stripe is not made', async () => {
    settle.mockResolvedValue(answer({ status: 'expired', payment: 'canceled' }) as never);
    renderInSubtree(<PaymentPending id={ID} focus now />);
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=unpaid`),
    );
  });

  it('moves on to the refund too, on a press, the focus going with it', async () => {
    settle.mockResolvedValue(answer({ status: 'expired', payment: 'refunding' }) as never);
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(settle).toHaveBeenCalledWith({ path: { id: ID } });
    expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=paid`);
    expect(keepFocusThroughUrlChange).not.toHaveBeenCalled();
  });

  it('says what a press found when it is still with the bank', async () => {
    settle.mockResolvedValue(still());
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(
      screen
        .getAllByRole('status')
        .some((region) => /^Still with your bank \(checked at /.test(region.textContent)),
    ).toBe(true);
  });

  it('stops looking after a few minutes, and says so', async () => {
    vi.useFakeTimers();
    settle.mockResolvedValue(still());
    renderInSubtree(<PaymentPending id={ID} focus={false} />);
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
    expect(settle).toHaveBeenCalledTimes(LOOKS_MS.length);
    expect(screen.getByText(/We’ve stopped checking on this page/)).toBeInTheDocument();
  });
});
