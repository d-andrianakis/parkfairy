import { settleMyPayment } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { isPaying } from '@/lib/payment-progress';
import { STRIPE_DARK, STRIPE_LIGHT } from '@/lib/stripe-appearance';
import { answer, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import PaymentStep from './payment-step';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  settleMyPayment: vi.fn(),
}));

const stripe = { confirmPayment: vi.fn() };
const elements = { id: 'elements' };
const elementsOptions = vi.fn();
const element = { ready: true, failLoad: false };
const loadStripe = vi.fn(() => Promise.resolve(stripe as unknown));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: () => loadStripe() }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children, options }: { children: ReactNode; options: unknown }) => {
    elementsOptions(options);
    return <div>{children}</div>;
  },
  PaymentElement: ({ onReady, onLoadError }: { onReady: () => void; onLoadError: () => void }) => {
    useEffect(() => {
      if (element.failLoad) onLoadError();
      else if (element.ready) onReady();
    }, [onReady, onLoadError]);
    return <div data-testid="payment-element" />;
  },
  useStripe: () => stripe,
  useElements: () => elements,
}));

const settle = vi.mocked(settleMyPayment);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);
const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const onPaying = vi.fn();
const show = (locale: 'en' | 'el' = 'en', amount = '€4.00') =>
  renderInSubtree(
    <PaymentStep
      id={ID}
      clientSecret="pi_1_secret_2"
      publishableKey={`pk_test_${Math.random().toString(36).slice(2)}`}
      amount={amount}
      onPaying={onPaying}
    />,
    { locale },
  );
const payButton = () => screen.getByRole('button', { name: 'Pay €4.00' });
/** jsdom has no media queries: the system's dark mode, as a browser would answer it. */
const dark = (system: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: system && query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  });

beforeEach(() => {
  vi.clearAllMocks();
  element.ready = true;
  element.failLoad = false;
  document.documentElement.className = '';
  dark(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PaymentStep', () => {
  it('takes the focus to say what is paid, with Stripe’s fields in the page’s language', async () => {
    const { container } = show('el', '4,00 €');
    expect(screen.getByRole('heading', { level: 2, name: 'Πληρωμή' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Πληρωμή' })).toBeInTheDocument();
    // The amount as Greek writes it, with its no-break space (the matcher folds it to a space).
    expect(
      screen.getByText(/^Πληρώνετε τώρα 4,00\s€\. Η κράτηση επιβεβαιώνεται μόλις ολοκληρωθεί/),
    ).toBeInTheDocument();
    expect(elementsOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSecret: 'pi_1_secret_2',
        locale: 'el',
        appearance: expect.objectContaining({ theme: 'stripe', labels: 'above' }),
      }),
    );
    expect(screen.getByRole('button', { name: 'Πληρωμή 4,00 €' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('leaves the focus with someone who moved on while it loaded', () => {
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    show();
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it('dresses Stripe’s fields in our colours, dark as the page is, the system’s included', () => {
    show();
    expect(elementsOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          theme: 'stripe',
          variables: expect.objectContaining({
            colorPrimary: STRIPE_LIGHT.primary,
            colorText: STRIPE_LIGHT.foreground,
          }),
        }),
      }),
    );
    // No theme chosen, and the system's dark: the page is dark, and so are the fields.
    dark(true);
    show();
    expect(elementsOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          theme: 'night',
          variables: expect.objectContaining({ colorBackground: STRIPE_DARK.background }),
        }),
      }),
    );
    // A light theme chosen wins over the system's dark.
    document.documentElement.className = 'light';
    show();
    expect(elementsOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ appearance: expect.objectContaining({ theme: 'stripe' }) }),
    );
  });

  it('says it is loading, and offers Pay only once Stripe’s fields are there', async () => {
    element.ready = false;
    show();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((region) => region.textContent === 'Loading the payment form…'),
      ).toBe(true),
    );
  });

  it('says so when Stripe’s fields can’t load, with a way to try again', async () => {
    element.failLoad = true;
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('The payment form couldn’t load.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so too when Stripe.js itself can’t load (blocked, offline)', async () => {
    loadStripe.mockResolvedValueOnce(null);
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('The payment form couldn’t load.');
  });

  it('pays, settles the booking and brings the page back with what happened', async () => {
    stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    settle.mockResolvedValue(answer({ status: 'confirmed', payment: 'succeeded' }) as never);
    show();
    await userEvent.click(payButton());
    expect(stripe.confirmPayment).toHaveBeenCalledWith({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/en/bookings/${ID}?done=paid` },
    });
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=paid`),
    );
    expect(settle).toHaveBeenCalledWith({ path: { id: ID } });
    // The page was told a payment was under way, so the hold's end waited for it.
    expect(onPaying).toHaveBeenCalledWith(true);
  });

  it('says what Stripe said of a card, and lets the page’s time run again', async () => {
    stripe.confirmPayment.mockResolvedValueOnce({
      error: { type: 'card_error', message: 'Your card was declined.' },
    });
    show();
    await userEvent.click(payButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(settle).not.toHaveBeenCalled();
    expect(onPaying).toHaveBeenLastCalledWith(false);
    expect(isPaying()).toBe(false);
  });

  it('asks the API when Stripe’s answer is unclear, and says only what is known', async () => {
    // Not paid after all: our words, not Stripe's.
    stripe.confirmPayment.mockResolvedValueOnce({
      error: { type: 'api_connection_error', message: 'Internal detail no driver needs' },
    });
    settle.mockResolvedValueOnce(answer({ status: 'held', payment: 'pending' }) as never);
    const view = show();
    await userEvent.click(payButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment didn’t go through. Try again, or use another card.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal detail');

    // The API can't say either: don't pay again yet.
    stripe.confirmPayment.mockResolvedValueOnce({ error: { type: 'api_error' } });
    settle.mockResolvedValueOnce(refusal('PAYMENT_PROVIDER_ERROR', 503) as never);
    await userEvent.click(payButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'We couldn’t tell whether your payment went through. Don’t pay again yet',
      ),
    );

    // Paid after all (another tab, a lost answer): the page moves on.
    stripe.confirmPayment.mockResolvedValueOnce({
      error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state' },
    });
    settle.mockResolvedValueOnce(answer({ status: 'confirmed', payment: 'succeeded' }) as never);
    await userEvent.click(payButton());
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=paid`),
    );
    view.unmount();
  });

  it('keeps a second press from paying twice while the first is on its way', async () => {
    let finish: (value: unknown) => void = () => undefined;
    stripe.confirmPayment.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    await userEvent.click(payButton());
    const busy = screen.getByRole('button', { name: 'Paying…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(busy);
    expect(stripe.confirmPayment).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ error: { type: 'card_error', message: 'Declined.' } });
      await Promise.resolve();
    });
  });
});
