import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { TwoFactorSettings } from './two-factor-settings';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);

// The steps' code held back, as on a slow network where nothing preloaded it.
const gate = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open: () => open() };
});
vi.mock('./two-factor-steps', async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});
vi.mock('@/lib/auth-client', () => ({
  authClient: { twoFactor: { enable: vi.fn(), disable: vi.fn(), verifyTotp: vi.fn() } },
}));

describe('TwoFactorSettings while a step’s code loads', () => {
  it('keeps the button there and busy, with the focus on it, until the step arrives', async () => {
    const { container } = renderInSubtree(
      <TwoFactorSettings enabled={false} email="demo@example.com" />,
    );
    const button = screen.getByRole('button', { name: 'Set up two-factor authentication' });
    await userEvent.click(button);

    // Nothing vanished while the code is on its way, and the button says it is busy.
    expect(button).toBeInTheDocument();
    expect(button).toHaveFocus();
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('Off.');
    await expectNoAxeViolations(container);

    gate.open();
    const heading = await screen.findByRole('heading', { name: 'Confirm it’s you' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.queryByRole('button', { name: 'Set up two-factor authentication' }),
    ).not.toBeInTheDocument();
  });
});
