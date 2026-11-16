import type { AdminUser } from '@parkfairy/api-client';
import { ADMIN_REASON_NOTE_MAX } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { reinstateUser, suspendUser } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { AccountModerationPanel } from './account-moderation-panel';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  suspendUser: vi.fn(),
  reinstateUser: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const ok = { ok: true as const, data: {} as AdminUser };
const refused = (code: string, status = 409) => ({ ok: false as const, failure: { code }, status });
const active = {
  own: false,
  staff: false,
  canSuspend: true,
  canReinstate: false,
  liveListings: 0,
};
const panel = (props: Partial<React.ComponentProps<typeof AccountModerationPanel>> = {}) =>
  renderInSubtree(<AccountModerationPanel id={ID} {...active} {...props} />);
const why = async (label: RegExp, button: string, text = 'Ticket 4821.') => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.paste(text);
  await userEvent.click(screen.getByRole('button', { name: button }));
};
const suspendWhy = (text?: string) =>
  why(/Why\? \(for the audit log only\)/, 'Suspend this account…', text);

beforeEach(() => {
  vi.mocked(suspendUser).mockReset();
  vi.mocked(reinstateUser).mockReset();
});

describe('suspending an account', () => {
  it('says what it does and does not do, and wants a short note for the log', async () => {
    const { container } = panel();
    expect(
      screen.getByText(/without your reason\. Nothing they own is changed/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend this account…' }));
    const note = screen.getByLabelText(/Why\?/);
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveAttribute('aria-required', 'true');
    expect(note).toHaveFocus();
    expect(note).toHaveAccessibleDescription(
      new RegExp(`up to ${ADMIN_REASON_NOTE_MAX} characters`),
    );
    expect(note).toHaveAccessibleDescription(/The person never sees this/);
    expect(suspendUser).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('warns how many live listings it owns, which stay live', () => {
    panel({ liveListings: 2 });
    expect(screen.getByRole('note')).toHaveTextContent(
      'primary owner of 2 live listings, which stay live until you suspend them',
    );
    const single = panel({ liveListings: 1 });
    expect(single.container.textContent).toMatch(/1 live listing, which stays live/);
  });

  it('says nothing of listings for one with none', () => {
    panel({ liveListings: 0 });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('asks once more, then sends the note, and says so under a heading that takes the focus', async () => {
    vi.mocked(suspendUser).mockResolvedValue(ok);
    panel();
    await suspendWhy('  Ticket 4821, chargeback fraud.  ');
    const question = screen.getByText(/Suspend this account now\? The person is signed out/);
    await waitFor(() => expect(question).toHaveFocus());
    expect(suspendUser).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, suspend it' }));
    expect(suspendUser).toHaveBeenCalledWith(ID, 'Ticket 4821, chargeback fraud.');
    const heading = await screen.findByRole('heading', { name: 'Account suspended' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('a "not yet" goes back to the note, which keeps what was written', async () => {
    panel();
    await suspendWhy('Keep this');
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() => expect(screen.getByLabelText(/Why\?/)).toHaveFocus());
    expect(screen.getByLabelText(/Why\?/)).toHaveValue('Keep this');
  });

  it('says why, and keeps the reason when someone suspended it first and the page catches up', async () => {
    vi.mocked(suspendUser).mockResolvedValue(refused('ALREADY_SUSPENDED'));
    const view = panel();
    await suspendWhy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, suspend it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('suspended already');
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <AccountModerationPanel
        id={ID}
        {...active}
        canSuspend={false}
        canReinstate
        liveListings={0}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('suspended already');
    // The question of the first action is gone; the new one starts from its own form.
    expect(screen.getByRole('button', { name: 'Reinstate this account…' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus());
  });

  it.each([
    ['OWN_ACCOUNT', 403, /your own account/],
    ['STAFF_ACCOUNT', 403, /staff account/],
    ['USER_NOT_FOUND', 404, /no longer exists/],
  ])('says %s in words', async (code, status, text) => {
    vi.mocked(suspendUser).mockResolvedValue(refused(code, status));
    panel();
    await suspendWhy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, suspend it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('refusals and limits', () => {
  it('says "too many" for a 429, and ignores a second press while it is working', async () => {
    let finish: (value: never) => void = () => undefined;
    vi.mocked(suspendUser).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    panel();
    await suspendWhy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, suspend it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Suspending…' }));
    expect(suspendUser).toHaveBeenCalledTimes(1);
    finish({ ok: false, failure: {}, status: 429 } as never);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
  });

  it('refuses a note too long, or one with hidden characters, and asks nothing', async () => {
    panel();
    await userEvent.click(screen.getByLabelText(/Why\?/));
    await userEvent.paste('x'.repeat(ADMIN_REASON_NOTE_MAX + 1));
    await userEvent.click(screen.getByRole('button', { name: 'Suspend this account…' }));
    expect(screen.getByLabelText(/Why\?/)).toHaveAccessibleDescription(/This is too long/);
    await userEvent.clear(screen.getByLabelText(/Why\?/));
    await userEvent.paste('Hidden‮text');
    await userEvent.click(screen.getByRole('button', { name: 'Suspend this account…' }));
    expect(screen.getByLabelText(/Why\?/)).toHaveAttribute('aria-invalid', 'true');
    expect(suspendUser).not.toHaveBeenCalled();
  });

  it('says so, and refreshes, when someone lifted the suspension first', async () => {
    vi.mocked(reinstateUser).mockResolvedValue(refused('NOT_SUSPENDED'));
    panel({ ...active, canSuspend: false, canReinstate: true });
    await why(/Why is it reinstated/, 'Reinstate this account…', 'Ticket 4822.');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reinstate it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The suspension is already lifted');
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('reinstating an account', () => {
  const lift = { ...active, canSuspend: false, canReinstate: true };

  it('says what it does and does not restore, and sends the note', async () => {
    vi.mocked(reinstateUser).mockResolvedValue(ok);
    const { container } = panel(lift);
    expect(screen.getByText(/Nothing is republished or restored for them/)).toBeInTheDocument();
    await why(/Why is it reinstated/, 'Reinstate this account…', 'Ticket 4822.');
    expect(screen.getByText('Lift the suspension of this account now?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reinstate it' }));
    expect(reinstateUser).toHaveBeenCalledWith(ID, 'Ticket 4822.');
    const heading = await screen.findByRole('heading', { name: 'Account reinstated' });
    await waitFor(() => expect(heading).toHaveFocus());
    await expectNoAxeViolations(container);
  });

  it('does not warn about listings: nothing is restored', () => {
    panel({ ...lift, liveListings: 3 });
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('when there is nothing to do', () => {
  it.each([
    ['your own account', { own: true, canSuspend: false }, /your own account/],
    ['a staff account', { staff: true, canSuspend: false }, /staff account/],
    ['one with nothing to do', { canSuspend: false, canReinstate: false }, /Nothing to do/],
  ])('says so for %s, with no button', async (_name, props, text) => {
    const { container } = panel(props);
    expect(screen.getByRole('note')).toHaveTextContent(text);
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('in Greek', () => {
  it('reads, with the live-listing warning in Greek plurals, axe-clean', async () => {
    const { container } = renderInSubtree(
      <AccountModerationPanel id={ID} {...active} liveListings={2} />,
      { locale: 'el' },
    );
    expect(screen.getByRole('button', { name: 'Αναστολή του λογαριασμού…' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('κύριος ιδιοκτήτης 2 ενεργών χώρων');
    await userEvent.click(screen.getByLabelText(/Γιατί;/));
    await userEvent.paste('Αίτημα 4821.');
    await userEvent.click(screen.getByRole('button', { name: 'Αναστολή του λογαριασμού…' }));
    expect(screen.getByText(/Να τεθεί τώρα ο λογαριασμός σε αναστολή/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
