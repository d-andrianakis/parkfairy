import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { SignUpForm } from './sign-up-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

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
  beforeEach(() => {
    signUp.mockReset(); // braces: a returned function would run as a cleanup hook
  });

  it('explains the password rule up front and when it is broken', async () => {
    const { container } = renderInSubtree(<SignUpForm />);
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
    renderInSubtree(<SignUpForm />, { locale });
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
    renderInSubtree(<SignUpForm />, { locale: 'el' });
    await fill({});

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Υπάρχει ήδη λογαριασμός με αυτό το email.',
    );
  });

  it('announces how many fields need attention, in the page language', async () => {
    renderInSubtree(<SignUpForm />, { locale: 'el' });
    await fill({ name: '', email: '', password: '' });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('3 πεδία χρειάζονται διόρθωση'),
    );
    expect(signUp).not.toHaveBeenCalled();
  });

  it('keeps the button focusable while creating the account, and ignores repeat submits', async () => {
    let finish = () => {};
    signUp.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: {}, error: null } as never);
        }),
    );
    const { container } = renderInSubtree(<SignUpForm />);
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
    await fill({});

    const button = screen.getByRole('button', { name: 'Creating account…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(signUp).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
  });
});
