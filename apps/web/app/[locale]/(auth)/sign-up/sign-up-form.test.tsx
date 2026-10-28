import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { renderWithProviders } from '@/test/render';
import { SignUpForm } from './sign-up-form';

vi.mock('@/lib/auth-client', () => ({ authClient: { signUp: { email: vi.fn() } } }));
const signUp = vi.mocked(authClient.signUp.email);

async function fill({
  name = 'Maria',
  email = 'maria@example.gr',
  password = 'correct horse battery',
}) {
  if (name) await userEvent.type(screen.getByLabelText(/^(name|όνομα)$/i), name);
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText(/password|κωδικός/i), password);
  await userEvent.click(screen.getByRole('button'));
}

describe('SignUpForm', () => {
  beforeEach(() => signUp.mockReset());

  it('explains the password rule up front and when it is broken', async () => {
    const { container } = renderWithProviders(<SignUpForm />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAccessibleDescription('At least 10 characters.');

    await fill({ password: 'short' });

    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription(
      'At least 10 characters. Use at least 10 characters',
    );
    expect(signUp).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it.each(['el', 'en'] as const)('stores %s as the account language', async (locale) => {
    signUp.mockResolvedValue({ data: {}, error: null } as never);
    renderWithProviders(<SignUpForm />, { locale });
    await fill({});

    expect(signUp).toHaveBeenCalledWith({
      name: 'Maria',
      email: 'maria@example.gr',
      password: 'correct horse battery',
      locale,
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/account');
  });

  it('tells people when the email is already registered', async () => {
    signUp.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 },
    } as never);
    renderWithProviders(<SignUpForm />, { locale: 'el' });
    await fill({});

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Υπάρχει ήδη λογαριασμός με αυτό το email.',
    );
  });
});
