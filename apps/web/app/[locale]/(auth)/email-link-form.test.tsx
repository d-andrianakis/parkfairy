import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { rememberEmail, takeRememberedEmail } from '@/lib/remembered-email';
import { rendererFor } from '@/test/render';
import { EmailLinkForm } from './email-link-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({
  authClient: { requestPasswordReset: vi.fn(), sendVerificationEmail: vi.fn() },
}));
const requestReset = vi.mocked(authClient.requestPasswordReset);
const requestConfirmation = vi.mocked(authClient.sendVerificationEmail);

async function submit(email = 'maria@example.gr') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.click(screen.getByRole('button'));
}

describe('EmailLinkForm', () => {
  beforeEach(() => {
    requestReset.mockReset();
    requestConfirmation.mockReset();
    requestReset.mockResolvedValue({ data: { status: true }, error: null } as never);
    requestConfirmation.mockResolvedValue({ data: { status: true }, error: null } as never);
  });

  it('asks for a reset link and answers without saying if the account exists', async () => {
    const { container } = renderInSubtree(
      <EmailLinkForm purpose="reset-password" intro="Enter your email." />,
    );
    await submit();

    expect(requestReset).toHaveBeenCalledWith({ email: 'maria@example.gr' });
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toHaveFocus();
    expect(
      screen.getByText(
        'If there’s an account for maria@example.gr, we’ve sent it a link to choose a new password. The link works for 60 minutes.',
      ),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('asks for a confirmation link, in Greek too', async () => {
    renderInSubtree(<EmailLinkForm purpose="verify-email" intro="Enter your email." />, {
      locale: 'el',
    });
    await submit();

    expect(requestConfirmation).toHaveBeenCalledWith({ email: 'maria@example.gr' });
    expect(requestReset).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' }),
    ).toHaveFocus();
    expect(screen.getByText(/ισχύει για 24 ώρες/)).toBeInTheDocument();
  });

  it.each([
    ['reset-password', 'el', /Αν υπάρχει λογαριασμός με τη διεύθυνση maria@example.gr/],
    ['verify-email', 'en', /If maria@example.gr still needs confirming/],
  ] as const)('answers a %s request in %s', async (purpose, locale, text) => {
    renderInSubtree(<EmailLinkForm purpose={purpose} intro="Enter your email." />, { locale });
    await submit();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('drops the instruction once the form is gone', async () => {
    renderInSubtree(<EmailLinkForm purpose="reset-password" intro="Enter your email." />);
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    await submit();
    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(screen.queryByText('Enter your email.')).toBeNull();
  });

  it('fills in the address typed on sign-in, once', async () => {
    rememberEmail('maria@example.gr');
    renderInSubtree(<EmailLinkForm purpose="reset-password" intro="Enter your email." />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('maria@example.gr'));
    expect(takeRememberedEmail()).toBeNull();
  });

  it('leaves a confirmation form empty and the address in place', () => {
    rememberEmail('maria@example.gr');
    renderInSubtree(<EmailLinkForm purpose="verify-email" intro="Enter your email." />);
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(takeRememberedEmail()).toBe('maria@example.gr');
  });

  it('validates the address before calling the server', async () => {
    const { container } = renderInSubtree(
      <EmailLinkForm purpose="reset-password" intro="Enter your email." />,
    );
    await submit('');

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(requestReset).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 field needs your attention'),
    );
    await expectNoAxeViolations(container);
  });

  it('keeps the form and explains when too many links were asked for', async () => {
    requestReset.mockResolvedValue({ data: null, error: { status: 429 } } as never);
    renderInSubtree(<EmailLinkForm purpose="reset-password" intro="Enter your email." />);
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('keeps the button focusable while sending, and ignores repeat submits', async () => {
    let finish = () => {};
    requestReset.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { status: true }, error: null } as never);
        }),
    );
    const { container } = renderInSubtree(
      <EmailLinkForm purpose="reset-password" intro="Enter your email." />,
    );
    expect(container.querySelector('form')).toHaveAttribute('method', 'post');
    await submit();

    const button = screen.getByRole('button', { name: 'Sending…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(requestReset).toHaveBeenCalledOnce();
    finish();
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
  });
});
