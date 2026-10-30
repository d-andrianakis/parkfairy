import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { SignInForm } from './sign-in-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }));
const signIn = vi.mocked(authClient.signIn.email);

async function submit(email = 'maria@example.gr', password = 'correct horse battery') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText(/password|κωδικός/i), password);
  await userEvent.click(screen.getByRole('button'));
}

describe('SignInForm', () => {
  beforeEach(() => {
    signIn.mockReset(); // braces: a returned function would run as a cleanup hook
  });

  it('validates in the user’s language before calling the server', async () => {
    const { container } = renderInSubtree(<SignInForm returnTo="/account" />, { locale: 'el' });
    await submit('', '');

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Εισαγάγετε μια έγκυρη διεύθυνση email');
    expect(screen.getByLabelText('Κωδικός πρόσβασης')).toHaveAccessibleDescription(
      'Εισαγάγετε τον κωδικό πρόσβασής σας',
    );
    expect(signIn).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('shows a translated message for wrong credentials, not the server text', async () => {
    signIn.mockResolvedValue({
      data: null,
      error: {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        status: 401,
        message: 'Invalid email or password',
      },
    } as never);
    renderInSubtree(<SignInForm returnTo="/account" />, { locale: 'el' });
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Το email ή ο κωδικός πρόσβασης δεν είναι σωστά.',
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('explains rate limiting', async () => {
    signIn.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many' } } as never);
    renderInSubtree(<SignInForm returnTo="/account" />);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('returns to the requested page after signing in', async () => {
    signIn.mockResolvedValue({ data: { redirect: false }, error: null } as never);
    renderInSubtree(<SignInForm returnTo="/account?tab=bookings" />);
    await submit();

    expect(signIn).toHaveBeenCalledWith({
      email: 'maria@example.gr',
      password: 'correct horse battery',
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/account?tab=bookings');
  });

  it('continues to two-factor verification when the account requires it', async () => {
    signIn.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null } as never);
    renderInSubtree(<SignInForm returnTo="/account" />);
    await submit();

    expect(routerMock.push).toHaveBeenCalledWith('/two-factor');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('keeps the button focusable while signing in, and ignores repeat submits', async () => {
    let finish = () => {};
    signIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { redirect: false }, error: null } as never);
        }),
    );
    renderInSubtree(<SignInForm returnTo="/account" />);
    await submit();

    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button); // a double sign-in would also spend the 3-per-10 s limit
    expect(signIn).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/account'));
  });

  it('clears the failed-submit announcement once the form is valid', async () => {
    signIn.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 },
    } as never);
    renderInSubtree(<SignInForm returnTo="/account" />);
    await submit('', '');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2 fields need your attention'),
    );

    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('posts, never GETs, if submitted before the page is interactive', () => {
    const { container } = renderInSubtree(<SignInForm returnTo="/account" />);
    // A GET would put the password in the URL, the history and server logs.
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
  });
});
