import type { AdminUser } from '@parkfairy/api-client';
import { ADMIN_IDENTITY_NOTE_MAX } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { removeTwoFactor } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { RemoveTwoFactorPanel } from './remove-two-factor-panel';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  removeTwoFactor: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const ok = { ok: true as const, data: {} as AdminUser };
const refused = (code: string, status = 409) => ({
  ok: false as const,
  failure: { code },
  status,
});
const panel = (props: Partial<React.ComponentProps<typeof RemoveTwoFactorPanel>> = {}) =>
  renderInSubtree(
    <RemoveTwoFactorPanel
      id={ID}
      own={false}
      staff={false}
      twoFactorEnabled
      canRemove
      {...props}
    />,
  );
const note = () => screen.getByLabelText('How did you check who they are?');
const ask = () =>
  userEvent.click(screen.getByRole('button', { name: 'Remove two-factor authentication…' }));
const identified = async (text = 'Video call, ticket 4821') => {
  await userEvent.click(note());
  await userEvent.paste(text);
  await ask();
};
const confirm = () => userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));

beforeEach(() => {
  vi.mocked(removeTwoFactor).mockReset();
});

describe('removing a second factor', () => {
  it('wants a note first, in words, with the focus on it, and asks nothing yet', async () => {
    const { container } = panel();
    await ask();
    expect(note()).toHaveAttribute('aria-invalid', 'true');
    expect(note()).toHaveAccessibleDescription(/Check this field/);
    expect(note()).toHaveFocus();
    expect(removeTwoFactor).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('refuses a note too long, and one with characters that read differently from how they look', async () => {
    panel();
    await identified('x'.repeat(ADMIN_IDENTITY_NOTE_MAX + 1));
    expect(note()).toHaveAccessibleDescription(/This is too long/);
    await userEvent.clear(note());
    await identified('Call\u202Eevil');
    expect(screen.queryByText(/Remove two-factor authentication from this account now/)).toBeNull();
    expect(removeTwoFactor).not.toHaveBeenCalled();
  });

  it('asks once more before it signs the person out, with the focus on the question', async () => {
    const { container } = panel();
    await identified();
    const question = screen.getByText(/Remove two-factor authentication from this account now/);
    await waitFor(() => expect(question).toHaveFocus());
    expect(removeTwoFactor).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('a "not yet" goes back to the note, which keeps what was written', async () => {
    panel();
    await identified('Video call');
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() => expect(note()).toHaveFocus());
    expect(note()).toHaveValue('Video call');
    expect(removeTwoFactor).not.toHaveBeenCalled();
  });

  it('sends the note as written, says so under a heading that takes the focus, and refreshes', async () => {
    vi.mocked(removeTwoFactor).mockResolvedValue(ok);
    panel();
    await identified('Video call, ticket 4821');
    await confirm();
    expect(removeTwoFactor).toHaveBeenCalledWith(ID, 'Video call, ticket 4821');
    const heading = await screen.findByRole('heading', {
      name: 'Two-factor authentication removed',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
    // Nothing left to press twice.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why in words when refused, and refreshes when someone did it first', async () => {
    vi.mocked(removeTwoFactor).mockResolvedValue(refused('NO_TWO_FACTOR'));
    panel();
    await identified();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'has no two-factor authentication now',
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('says "too many" for a 429 and something plain for anything else', async () => {
    vi.mocked(removeTwoFactor)
      .mockResolvedValueOnce(refused('', 429))
      .mockResolvedValueOnce({ ok: false, failure: {} });
    panel();
    await identified();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
    await confirm();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
  });

  it('sends the note trimmed, and describes the note with its hint about what not to write', async () => {
    vi.mocked(removeTwoFactor).mockResolvedValue(ok);
    panel();
    expect(note()).toHaveAttribute('aria-required', 'true');
    expect(note()).toHaveAccessibleDescription(/ticket reference and the kind of check/);
    expect(note()).toHaveAccessibleDescription(/No names, ID numbers or document details/);
    await userEvent.click(note());
    await userEvent.paste('   Video call, ticket 4821   ');
    await ask();
    await confirm();
    expect(removeTwoFactor).toHaveBeenCalledWith(ID, 'Video call, ticket 4821');
  });

  it.each([
    ['USER_NOT_FOUND', 404, /no longer exists/, false],
    ['OWN_ACCOUNT', 403, /your own account/, false],
    ['STAFF_ACCOUNT', 403, /staff account/, true],
    ['NO_TWO_FACTOR', 409, /has no two-factor authentication now/, true],
    ['MFA_REQUIRED', 403, /Two-factor verification must be on/, false],
  ])(
    'says %s in words, and refreshes only when the page is out of date',
    async (code, status, text, refreshes) => {
      vi.mocked(removeTwoFactor).mockResolvedValue(refused(code, status));
      panel();
      await identified();
      await confirm();
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(routerMock.refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
    },
  );

  it('says a session that ended in words, and asks nothing more', async () => {
    vi.mocked(removeTwoFactor).mockResolvedValue({ ok: false, failure: {}, status: 401 });
    panel();
    await identified();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended');
  });

  it('keeps the reason and the focus when the page catches up and the panel turns into a notice', async () => {
    vi.mocked(removeTwoFactor).mockResolvedValue(refused('NO_TWO_FACTOR'));
    const view = panel();
    await identified();
    await confirm();
    await screen.findByRole('alert');
    // What `router.refresh()` does: the same panel, with what the page now knows.
    view.rerender(
      <RemoveTwoFactorPanel
        id={ID}
        own={false}
        staff={false}
        twoFactorEnabled={false}
        canRemove={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('has no two-factor authentication now');
    expect(screen.getByRole('note')).toHaveTextContent(
      'has no two-factor authentication to remove',
    );
    // The question and its button are gone: the focus is on what replaced them, not on <body>.
    await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('ignores a second press while it is working', async () => {
    let finish: (value: typeof ok) => void = () => undefined;
    vi.mocked(removeTwoFactor).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    panel();
    await identified();
    await confirm();
    await userEvent.click(screen.getByRole('button', { name: 'Removing…' }));
    expect(removeTwoFactor).toHaveBeenCalledTimes(1);
    finish(ok);
    await screen.findByRole('heading', { name: 'Two-factor authentication removed' });
  });
});

describe('when there is nothing to remove, or it is not for support', () => {
  it.each([
    ['your own account', { own: true }, /your own account/],
    ['a staff account', { staff: true }, /staff account/],
    ['an account with none', { twoFactorEnabled: false, canRemove: false }, /has no two-factor/],
  ])('says so for %s, with no button', async (_name, props, text) => {
    const { container } = panel(props);
    expect(screen.getByRole('note')).toHaveTextContent(text);
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('in Greek', () => {
  it('reads, axe-clean', async () => {
    const { container } = renderInSubtree(
      <RemoveTwoFactorPanel id={ID} own={false} staff={false} twoFactorEnabled canRemove />,
      { locale: 'el' },
    );
    expect(screen.getByLabelText('Πώς ελέγξατε την ταυτότητα του ατόμου;')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Αφαίρεση ελέγχου ταυτότητας δύο παραγόντων…' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
