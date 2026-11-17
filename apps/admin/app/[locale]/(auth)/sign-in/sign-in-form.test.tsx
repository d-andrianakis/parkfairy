import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';

import { SignInForm } from './sign-in-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }));
const signIn = vi.mocked(authClient.signIn.email);

async function submit(email = 'sam@parkfairy.gr', password = 'correct horse battery') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password)
    await userEvent.type(screen.getByLabelText(/^(password|κωδικός πρόσβασης)$/i), password);
  await userEvent.click(screen.getByRole('button', { name: /^(sign in|σύνδεση)$/i }));
}

beforeEach(() => {
  signIn.mockReset(); // braces: a returned function would run as a cleanup hook
});

describe('staff SignInForm', () => {
  it('validates in the user’s language before calling the server', async () => {
    const { container } = renderInSubtree(<SignInForm returnTo="/listings" />, { locale: 'el' });
    await submit('', '');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Εισαγάγετε μια έγκυρη διεύθυνση email',
    );
    expect(screen.getByLabelText('Κωδικός πρόσβασης')).toHaveAccessibleDescription(
      'Εισαγάγετε τον κωδικό πρόσβασής σας',
    );
    expect(signIn).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('has no way to sign up or reset, as that is not done here', () => {
    renderInSubtree(<SignInForm returnTo="/listings" />);
    expect(screen.queryByRole('link')).toBeNull();
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
    renderInSubtree(<SignInForm returnTo="/listings" />);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
    expect(screen.queryByText('Invalid email or password')).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('goes on to the second step, carrying where it was headed', async () => {
    signIn.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null } as never);
    renderInSubtree(<SignInForm returnTo="/audit" />);
    await submit();
    expect(signIn).toHaveBeenCalledWith({
      email: 'sam@parkfairy.gr',
      password: 'correct horse battery',
    });
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/two-factor',
      query: { next: '/audit' },
    });
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('goes straight to the page when no second step is asked', async () => {
    signIn.mockResolvedValue({ data: { user: {} }, error: null } as never);
    renderInSubtree(<SignInForm returnTo="/listings/abc" />);
    await submit();
    expect(routerMock.replace).toHaveBeenCalledWith('/listings/abc');
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('ignores a second press while the first is working, and keeps the button focusable', async () => {
    let finish: (value: unknown) => void = () => undefined;
    signIn.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    renderInSubtree(<SignInForm returnTo="/listings" />);
    await submit();
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    await userEvent.click(busy);
    expect(signIn).toHaveBeenCalledTimes(1);
    finish({ data: { user: {} }, error: null });
  });
});
