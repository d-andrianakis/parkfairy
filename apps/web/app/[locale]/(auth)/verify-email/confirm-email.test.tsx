import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { rendererFor } from '@/test/render';
import { ConfirmEmail } from './confirm-email';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({
  authClient: { verifyEmail: vi.fn(), requestPasswordReset: vi.fn() },
}));
const verifyEmail = vi.mocked(authClient.verifyEmail);

describe('ConfirmEmail', () => {
  beforeEach(() => {
    verifyEmail.mockReset();
    document.title = 'Confirm your email · Parkfairy';
  });

  it('confirms nothing until the button is pressed: scanners open links', async () => {
    const { container } = renderInSubtree(<ConfirmEmail token="abc" />);

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(verifyEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/If you didn’t sign up for Parkfairy/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('confirms on the press, then offers sign-in', async () => {
    verifyEmail.mockResolvedValue({ data: { status: true }, error: null } as never);
    const { container } = renderInSubtree(<ConfirmEmail token="abc" />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }));

    expect(verifyEmail).toHaveBeenCalledWith({ query: { token: 'abc' } });
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toHaveFocus();
    expect(document.title).toBe('Email confirmed · Parkfairy');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/en/sign-in');
    await expectNoAxeViolations(container);
  });

  it('offers a new link when this one no longer works, in Greek too', async () => {
    verifyEmail.mockResolvedValue({
      data: null,
      error: { code: 'TOKEN_EXPIRED', status: 401 },
    } as never);
    const { container } = renderInSubtree(<ConfirmEmail token="abc" />, { locale: 'el' });

    await userEvent.click(screen.getByRole('button', { name: 'Επιβεβαίωση email' }));

    expect(
      await screen.findByRole('heading', { name: 'Ο σύνδεσμος δεν ισχύει πια' }),
    ).toHaveFocus();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Αποστολή συνδέσμου' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('keeps the button focusable while confirming, and ignores repeat presses', async () => {
    let finish = () => {};
    verifyEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { status: true }, error: null } as never);
        }),
    );
    renderInSubtree(<ConfirmEmail token="abc" />);
    await userEvent.click(screen.getByRole('button'));

    const button = screen.getByRole('button', { name: 'Confirming…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(verifyEmail).toHaveBeenCalledOnce();
    finish();
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  });
});
