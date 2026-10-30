import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { ResetPasswordForm } from './reset-password-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({ authClient: { resetPassword: vi.fn() } }));
const resetPassword = vi.mocked(authClient.resetPassword);

async function submit(password = 'correct horse battery') {
  if (password) await userEvent.type(screen.getByLabelText(/password|κωδικός/i), password);
  await userEvent.click(screen.getByRole('button'));
}

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    resetPassword.mockReset();
    routerMock.refresh.mockReset();
    routerMock.replace.mockReset();
  });

  it('sets the new password with the token from the link', async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null } as never);
    const { container } = renderInSubtree(<ResetPasswordForm token="abc" />);
    await submit();

    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: 'correct horse battery',
      token: 'abc',
    });
    // Off the page holding the spent token; the server renders what comes next.
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/reset-password?done=1'));
    // This browser may have been signed in; the header must not keep saying so.
    expect(routerMock.refresh).toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('applies the sign-up password rule, stated up front', async () => {
    const { container } = renderInSubtree(<ResetPasswordForm token="abc" />, { locale: 'el' });
    const password = screen.getByLabelText('Νέος κωδικός πρόσβασης');
    expect(password).toHaveAccessibleDescription('Τουλάχιστον 10 χαρακτήρες.');
    expect(password).toHaveAttribute('autocomplete', 'new-password');

    await submit('short');

    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(resetPassword).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status')).not.toBeEmptyDOMElement());
    await expectNoAxeViolations(container);
  });

  it('offers a new link when this one has expired or was used', async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TOKEN', status: 400 },
    } as never);
    renderInSubtree(<ResetPasswordForm token="abc" />, { locale: 'el' });
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ο σύνδεσμος έχει λήξει ή έχει ήδη χρησιμοποιηθεί.',
    );
    expect(screen.getByRole('link', { name: 'Ζητήστε νέο σύνδεσμο' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/forgot-password$/),
    );
  });

  it('keeps the form for an error that a new link would not fix', async () => {
    resetPassword.mockResolvedValue({ data: null, error: { status: 500 } } as never);
    renderInSubtree(<ResetPasswordForm token="abc" />);
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('keeps the button focusable while saving, and ignores repeat submits', async () => {
    let finish = () => {};
    resetPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { status: true }, error: null } as never);
        }),
    );
    const { container } = renderInSubtree(<ResetPasswordForm token="abc" />);
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
    await submit();

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(resetPassword).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  });
});
