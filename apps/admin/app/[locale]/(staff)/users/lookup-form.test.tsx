import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { lookUpUser } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { LookupForm } from './lookup-form';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  lookUpUser: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.lookup);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const found = (id: string | null = ID) => ({ ok: true as const, data: { id } });
const email = () => screen.getByLabelText('Email address');
const find = () => userEvent.click(screen.getByRole('button', { name: 'Find the account' }));

beforeEach(() => {
  vi.mocked(lookUpUser).mockReset();
});

describe('finding an account', () => {
  it('asks for one whole address, described with its hint, axe-clean', async () => {
    const { container } = renderInSubtree(<LookupForm />);
    expect(email()).toHaveAccessibleDescription('The whole address, as the person gave it.');
    expect(email()).toHaveAttribute('autocomplete', 'off');
    await expectNoAxeViolations(container);
  });

  it('sends the address in a request, then opens the account it belongs to', async () => {
    vi.mocked(lookUpUser).mockResolvedValue(found());
    renderInSubtree(<LookupForm />);
    await userEvent.type(email(), 'Eleni@Example.gr');
    await find();
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/users/${ID}`));
    expect(lookUpUser).toHaveBeenCalledWith('eleni@example.gr');
    // The address is in no URL: the form is not a GET and the page address is untouched.
    expect(
      screen.getByRole('button', { name: 'Find the account' }).closest('form'),
    ).toHaveAttribute('method', 'post');
    expect(routerMock.push).not.toHaveBeenCalledWith(expect.stringContaining('example.gr'));
  });

  it('trims the address, and asks once however often it is pressed while working', async () => {
    let finish: (value: ReturnType<typeof found>) => void = () => undefined;
    vi.mocked(lookUpUser).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderInSubtree(<LookupForm />);
    expect(email()).toHaveAttribute('aria-required', 'true');
    await userEvent.type(email(), '  eleni@example.gr  ');
    await find();
    await userEvent.click(await screen.findByRole('button', { name: 'Looking…' }));
    expect(lookUpUser).toHaveBeenCalledTimes(1);
    expect(lookUpUser).toHaveBeenCalledWith('eleni@example.gr');
    finish(found());
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledTimes(1));
  });

  it('refuses what is not a whole address in words, with the focus there, and asks nothing', async () => {
    renderInSubtree(<LookupForm />);
    await userEvent.type(email(), 'eleni');
    await find();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveAccessibleDescription(/Check this field/);
    expect(email()).toHaveFocus();
    expect(lookUpUser).not.toHaveBeenCalled();
  });

  it('says so when no account has the address, and keeps what was typed', async () => {
    vi.mocked(lookUpUser).mockResolvedValue(found(null));
    renderInSubtree(<LookupForm />);
    await userEvent.type(email(), 'nobody@example.gr');
    await find();
    // Said at the field, which is described by it and has the focus: not an alert above the form.
    await waitFor(() => expect(email()).toHaveFocus());
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveAccessibleDescription(/No account has this address\./);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(email()).toHaveValue('nobody@example.gr');
    expect(routerMock.push).not.toHaveBeenCalled();
    // Typing again clears it.
    await userEvent.type(email(), 'x');
    expect(email()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('says why when the API refuses, and a 429 as too many', async () => {
    vi.mocked(lookUpUser)
      .mockResolvedValueOnce({ ok: false, failure: {}, status: 429 })
      .mockResolvedValueOnce({ ok: false, failure: { code: 'MFA_REQUIRED' }, status: 403 });
    renderInSubtree(<LookupForm />);
    await userEvent.type(email(), 'eleni@example.gr');
    await find();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
    await find();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Two-factor verification must be on'),
    );
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = renderInSubtree(<LookupForm />, { locale: 'el' });
    expect(screen.getByLabelText('Διεύθυνση email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Εύρεση λογαριασμού' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
