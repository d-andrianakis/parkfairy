import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { renderWithProviders } from '@/test/render';
import { SignInForm } from './sign-in-form';

vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }));
const signIn = vi.mocked(authClient.signIn.email);

async function submit(email = 'maria@example.gr', password = 'correct horse battery') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText(/password|κωδικός/i), password);
  await userEvent.click(screen.getByRole('button'));
}

describe('SignInForm', () => {
  beforeEach(() => signIn.mockReset());

  it('validates in the user’s language before calling the server', async () => {
    const { container } = renderWithProviders(<SignInForm returnTo="/account" />, { locale: 'el' });
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
    renderWithProviders(<SignInForm returnTo="/account" />, { locale: 'el' });
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Το email ή ο κωδικός πρόσβασης δεν είναι σωστά.',
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('explains rate limiting', async () => {
    signIn.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many' } } as never);
    renderWithProviders(<SignInForm returnTo="/account" />);
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('returns to the requested page after signing in', async () => {
    signIn.mockResolvedValue({ data: { redirect: false }, error: null } as never);
    renderWithProviders(<SignInForm returnTo="/account?tab=bookings" />);
    await submit();

    expect(signIn).toHaveBeenCalledWith({
      email: 'maria@example.gr',
      password: 'correct horse battery',
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/account?tab=bookings');
  });

  it('continues to two-factor verification when the account requires it', async () => {
    signIn.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null } as never);
    renderWithProviders(<SignInForm returnTo="/account" />);
    await submit();

    expect(routerMock.push).toHaveBeenCalledWith('/two-factor');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
