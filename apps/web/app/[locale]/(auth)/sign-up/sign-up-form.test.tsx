import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock, setPathname } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { SignUpForm } from './sign-up-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({
  authClient: { signUp: { email: vi.fn() }, sendVerificationEmail: vi.fn() },
}));
const signUp = vi.mocked(authClient.signUp.email);
const resend = vi.mocked(authClient.sendVerificationEmail);

async function fill({
  name = 'Maria',
  email = 'maria@example.gr',
  password = 'correct horse battery',
}) {
  if (name) await userEvent.type(screen.getByLabelText(/^(name|όνομα)$/i), name);
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password)
    await userEvent.type(screen.getByLabelText(/^(password|κωδικός πρόσβασης)$/i), password);
  await userEvent.click(
    screen.getByRole('button', { name: /^(create account|δημιουργία λογαριασμού)$/i }),
  );
}

describe('SignUpForm', () => {
  beforeEach(() => {
    signUp.mockReset(); // braces: a returned function would run as a cleanup hook
    resend.mockReset();
    routerMock.replace.mockReset();
    sessionStorage.clear();
    setPathname('/');
  });

  it('can show the password, hiding it only once the form goes out', async () => {
    signUp.mockResolvedValue({ data: null, error: { status: 500 } } as never);
    renderInSubtree(<SignUpForm />);
    const password = screen.getByLabelText('Password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

    await fill({ password: 'short' });
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'));
    expect(password).toHaveAttribute('type', 'text');
    expect(signUp).not.toHaveBeenCalled();

    await userEvent.clear(password);
    await userEvent.type(password, 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(password).toHaveAttribute('type', 'password');
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
  });

  describe('after signing up', () => {
    beforeEach(() => {
      signUp.mockResolvedValue({ data: {}, error: null } as never);
    });

    beforeEach(() => {
      document.title = 'Create account · Parkfairy';
    });

    it.each([
      ['el', 'Ελέγξτε τα εισερχόμενά σας', 'Στείλαμε μήνυμα στη διεύθυνση maria@example.gr'],
      ['en', 'Check your inbox', 'We’ve sent an email to maria@example.gr'],
    ] as const)('asks to check the inbox, moving focus there (%s)', async (locale, title, body) => {
      const { container } = renderInSubtree(<SignUpForm />, { locale });
      await fill({});

      const heading = await screen.findByRole('heading', { name: title });
      expect(heading).toHaveFocus(); // the button that had it is gone
      expect(document.title).toBe(`${title} · Parkfairy`); // it no longer names the form
      expect(screen.getByText(new RegExp(body))).toBeInTheDocument();
      expect(container.querySelector('input')).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('comes back in the other language, with the address and no form', async () => {
      setPathname('/sign-up', 'sent=1');
      sessionStorage.setItem('parkfairy.sent-to:/sign-up', 'maria@example.gr');
      const { container } = renderInSubtree(<SignUpForm />, { locale: 'el' });

      const heading = await screen.findByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' });
      expect(heading).toHaveFocus();
      expect(screen.getByText(/στη διεύθυνση maria@example.gr/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Αποστολή ξανά' })).toBeInTheDocument();
      expect(container.querySelector('input')).toBeNull();
    });

    it('shows the heading, unfocused, until it knows the address', async () => {
      setPathname('/sign-up', 'sent=1');
      const { container } = renderInSubtree(<SignUpForm />, { locale: 'el' });

      const heading = screen.getByRole('heading', { name: 'Ελέγξτε τα εισερχόμενά σας' });
      expect(heading).not.toHaveFocus();
      expect(container.querySelector('input')).toBeNull();
      expect(routerMock.replace).toHaveBeenCalledExactlyOnceWith('/sign-up');
      await expectNoAxeViolations(container);
    });

    it('sends the link again on request and says so', async () => {
      resend.mockResolvedValue({ data: { status: true }, error: null } as never);
      renderInSubtree(<SignUpForm />);
      await fill({});

      await userEvent.click(await screen.findByRole('button', { name: 'Send it again' }));

      expect(resend).toHaveBeenCalledWith({ email: 'maria@example.gr' });
      expect(await screen.findByRole('status')).toHaveTextContent('Sent. Check your inbox.');
    });

    it('explains when too many links were asked for', async () => {
      resend.mockResolvedValue({ data: null, error: { status: 429 } } as never);
      renderInSubtree(<SignUpForm />);
      await fill({});

      await userEvent.click(await screen.findByRole('button', { name: 'Send it again' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('ignores a repeat press while sending, keeping the button focusable', async () => {
      let finish = () => {};
      resend.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ data: { status: true }, error: null } as never);
          }),
      );
      renderInSubtree(<SignUpForm />);
      await fill({});
      await userEvent.click(await screen.findByRole('button', { name: 'Send it again' }));

      const button = screen.getByRole('button', { name: 'Sending…' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(button);
      expect(resend).toHaveBeenCalledOnce();
      finish();
      expect(await screen.findByRole('button', { name: 'Send it again' })).toHaveFocus();
    });
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
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
  });
});
