import { openPayoutDashboard, startPayoutOnboarding } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { loadPage } from '@/lib/load-page';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { PayoutButton } from './payout-button';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  startPayoutOnboarding: vi.fn(),
  openPayoutDashboard: vi.fn(),
}));
vi.mock('@/lib/load-page', () => ({ loadPage: vi.fn() }));
const start = vi.mocked(startPayoutOnboarding);
const dashboard = vi.mocked(openPayoutDashboard);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PayoutButton', () => {
  it('asks for a link into Stripe’s onboarding in the page’s language, and goes there', async () => {
    start.mockResolvedValue(
      answer({ url: 'https://connect.stripe.com/setup/e/acct_1/x' }) as never,
    );
    const { container } = renderInSubtree(<PayoutButton kind="start" />, { locale: 'el' });
    await userEvent.click(screen.getByRole('button', { name: 'Ρύθμιση πληρωμών στη Stripe' }));
    expect(start).toHaveBeenCalledWith({ body: { locale: 'el' } });
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/x'),
    );
    await expectNoAxeViolations(container);
  });

  it('carries on with onboarding, or opens the dashboard once set up', async () => {
    start.mockResolvedValue(answer({ url: 'https://connect.stripe.com/setup/2' }) as never);
    const { unmount } = renderInSubtree(<PayoutButton kind="continue" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Stripe' }));
    expect(start).toHaveBeenCalledOnce();
    unmount();
    dashboard.mockResolvedValue(answer({ url: 'https://connect.stripe.com/express/x' }) as never);
    renderInSubtree(<PayoutButton kind="dashboard" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open your Stripe dashboard' }));
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith('https://connect.stripe.com/express/x'),
    );
  });

  it('says why not, and stays', async () => {
    start.mockResolvedValue(refusal('PROFILE_REQUIRED') as never);
    renderInSubtree(<PayoutButton kind="start" />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up payouts with Stripe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fill in your details first: Stripe needs to know whether you rent as an individual or a business.',
    );
    expect(loadPage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set up payouts with Stripe' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('takes one press at a time', async () => {
    start.mockReturnValue(new Promise(() => undefined) as never);
    renderInSubtree(<PayoutButton kind="start" />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up payouts with Stripe' }));
    const busy = screen.getByRole('button', { name: 'Opening Stripe…' });
    await userEvent.click(busy);
    expect(start).toHaveBeenCalledOnce();
  });
});
