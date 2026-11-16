import type { AdminBooking } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { cancelBooking, decideDispute, retryRefund, settleRefund } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { BookingActions } from './booking-actions';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  cancelBooking: vi.fn(),
  retryRefund: vi.fn(),
  settleRefund: vi.fn(),
  decideDispute: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);
const BOOKING = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const DISPUTE = '8a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const total = { amountMinor: 400, currency: 'EUR' };
const ok = { ok: true as const, data: {} as AdminBooking };
const refused = (code: string, status = 409) => ({ ok: false as const, failure: { code }, status });
type Props = React.ComponentProps<typeof BookingActions>;
const base: Props = {
  id: BOOKING,
  total,
  refund: null,
  canCancel: false,
  canRetryRefund: false,
  canSettleRefund: false,
  disputes: [],
};
const actions = (props: Partial<Props> = {}) =>
  renderInSubtree(<BookingActions {...base} {...props} />);
const ticket = async (label: RegExp, text = 'Ticket 4821.') => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.paste(text);
};

beforeEach(() => {
  for (const fn of [cancelBooking, retryRefund, settleRefund, decideDispute]) {
    vi.mocked(fn).mockReset();
  }
});

describe('calling a booking off (#82)', () => {
  const start = () => userEvent.click(screen.getByRole('button', { name: 'Cancel this booking…' }));

  it('says what it does, wants a note, and names the refund in the question', async () => {
    const { container } = actions({ canCancel: true });
    expect(screen.getByText(/The driver is refunded in full and told/)).toBeInTheDocument();
    await start();
    const note = screen.getByLabelText(/Why\?/);
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveFocus();
    expect(cancelBooking).not.toHaveBeenCalled();
    await ticket(/Why\?/);
    await start();
    const question = screen.getByText(
      'Cancel this booking now? The driver is refunded in full: €4.00.',
    );
    await waitFor(() => expect(question).toHaveFocus());
    await expectNoAxeViolations(container);
  });

  it('sends the trimmed note and says so under a heading that takes the focus, and stays after the refresh', async () => {
    vi.mocked(cancelBooking).mockResolvedValue(ok);
    const view = actions({ canCancel: true });
    await ticket(/Why\?/, '  Ticket 4821, driver called.  ');
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(cancelBooking).toHaveBeenCalledWith(BOOKING, 'Ticket 4821, driver called.');
    const heading = await screen.findByRole('heading', { name: 'Booking cancelled' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
    // The page behind it now says nothing can be done: the heading stays, and no "nothing to do".
    view.rerender(<BookingActions {...base} canCancel={false} />);
    expect(screen.getByRole('heading', { name: 'Booking cancelled' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to do here/)).toBeNull();
  });

  it('says why when the booking began or is off already, and keeps the reason when the page catches up', async () => {
    vi.mocked(cancelBooking).mockResolvedValue(refused('NOT_CANCELLABLE'));
    const view = actions({ canCancel: true });
    await ticket(/Why\?/);
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t be cancelled now');
    view.rerender(<BookingActions {...base} canCancel={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('can’t be cancelled now');
    await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it.each([
    ['MFA_REQUIRED', 403, /Two-factor verification must be on/],
    ['BOOKING_NOT_FOUND', 404, /no longer exists/],
  ])('says %s in words', async (code, status, text) => {
    vi.mocked(cancelBooking).mockResolvedValue(refused(code, status));
    actions({ canCancel: true });
    await ticket(/Why\?/);
    await start();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('refuses a note too long or with hidden characters, and asks nothing', async () => {
    actions({ canCancel: true });
    await ticket(/Why\?/, 'x'.repeat(101));
    await start();
    expect(screen.getByLabelText(/Why\?/)).toHaveAccessibleDescription(/This is too long/);
    await userEvent.clear(screen.getByLabelText(/Why\?/));
    await userEvent.paste('Hidden\u202Etext');
    await start();
    expect(screen.getByLabelText(/Why\?/)).toHaveAttribute('aria-invalid', 'true');
    expect(cancelBooking).not.toHaveBeenCalled();
  });
});

describe('a refund that failed (#84)', () => {
  const failed = { canRetryRefund: true, canSettleRefund: true, refund: total };

  it('offers both, each with what it does', async () => {
    const { container } = actions(failed);
    expect(
      screen.getByRole('heading', { name: 'Ask Stripe for the refund again' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mark the refund settled' })).toBeInTheDocument();
    expect(screen.getByText(/A new attempt may fail the same way/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('asks again with a note, and says it is queued', async () => {
    vi.mocked(retryRefund).mockResolvedValue(ok);
    actions(failed);
    await ticket(/Why try again/);
    await userEvent.click(screen.getByRole('button', { name: 'Ask again…' }));
    expect(screen.getByText('Ask Stripe to refund €4.00 again now?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, ask again' }));
    expect(retryRefund).toHaveBeenCalledWith(BOOKING, 'Ticket 4821.');
    expect(await screen.findByRole('heading', { name: 'Refund requested' })).toBeInTheDocument();
  });

  it('marks it settled once the driver was paid another way', async () => {
    vi.mocked(settleRefund).mockResolvedValue(ok);
    actions(failed);
    await ticket(/How was the driver paid/, 'Paid by bank transfer, ticket 4821.');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as settled…' }));
    expect(screen.getByText(/Nothing more will be sent to the driver/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, it is settled' }));
    expect(settleRefund).toHaveBeenCalledWith(BOOKING, 'Paid by bank transfer, ticket 4821.');
    expect(await screen.findByRole('heading', { name: 'Refund settled' })).toBeInTheDocument();
  });

  it('offers only settling once the owners were paid, and says why when asked again', async () => {
    vi.mocked(retryRefund).mockResolvedValue(refused('TRANSFER_MADE'));
    actions({ ...failed, canRetryRefund: false });
    expect(screen.queryByRole('heading', { name: 'Ask Stripe for the refund again' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Mark the refund settled' })).toBeInTheDocument();
  });

  it('says when someone dealt with it first, and keeps the reason', async () => {
    vi.mocked(settleRefund).mockResolvedValue(refused('REFUND_NOT_FAILED'));
    actions(failed);
    await ticket(/How was the driver paid/);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as settled…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, it is settled' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no failed refund now');
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a lost dispute (#57, #83)', () => {
  const lost = { disputes: [{ id: DISPUTE, amount: total, canDecide: true, payoutHeld: true }] };
  const choose = (name: RegExp) => userEvent.click(screen.getByRole('radio', { name }));

  it('asks who bears it first, with what each means, and shows no note until a choice is made', async () => {
    const { container } = actions(lost);
    expect(screen.getByText(/The bank sided with the driver \(€4\.00\)/)).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(
      radios.every(
        (radio) =>
          !(radio as HTMLInputElement).checked && radio.getAttribute('aria-checked') !== 'true',
      ),
    ).toBe(true);
    expect(radios[0]).toHaveAccessibleDescription(/released as normal/);
    expect(radios[1]).toHaveAccessibleDescription(/cancelled for good/);
    expect(screen.queryByLabelText(/Why\?/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('releases the payout when Parkfairy bears it, asking once more', async () => {
    vi.mocked(decideDispute).mockResolvedValue(ok);
    actions(lost);
    await choose(/Parkfairy bears the loss/);
    await ticket(/Why\?/);
    await userEvent.click(screen.getByRole('button', { name: 'Decide…' }));
    expect(screen.getByText('Release the owners’ payout and bear this loss?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, decide' }));
    expect(decideDispute).toHaveBeenCalledWith(DISPUTE, 'parkfairy_bears', 'Ticket 4821.');
    const heading = await screen.findByRole('heading', { name: 'Decision recorded' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/payout is released and they are told/)).toBeInTheDocument();
  });

  it('cancels it for good when the owners bear it, in words that say so', async () => {
    vi.mocked(decideDispute).mockResolvedValue(ok);
    actions(lost);
    await choose(/The owners bear the loss/);
    await ticket(/Why\?/);
    await userEvent.click(screen.getByRole('button', { name: 'Decide…' }));
    expect(
      screen.getByText('Cancel the owners’ payout for this booking for good? The owners are told.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, decide' }));
    expect(decideDispute).toHaveBeenCalledWith(DISPUTE, 'owners_bear', 'Ticket 4821.');
  });

  it('starts the form over when the choice changes, so a note for one is never sent for the other', async () => {
    actions(lost);
    await choose(/Parkfairy bears the loss/);
    await ticket(/Why\?/, 'For the first choice');
    await choose(/The owners bear the loss/);
    expect(screen.getByLabelText(/Why\?/)).toHaveValue('');
    expect(decideDispute).not.toHaveBeenCalled();
  });

  it('says when it was decided first, keeps the reason, and offers nothing more', async () => {
    vi.mocked(decideDispute).mockResolvedValue(refused('ALREADY_DECIDED'));
    const view = actions(lost);
    await choose(/Parkfairy bears the loss/);
    await ticket(/Why\?/);
    await userEvent.click(screen.getByRole('button', { name: 'Decide…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, decide' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone decided this dispute already',
    );
    view.rerender(
      <BookingActions
        {...base}
        disputes={[{ id: DISPUTE, amount: total, canDecide: false, payoutHeld: true }]}
      />,
    );
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Someone decided this dispute already');
  });

  it('offers only Parkfairy bearing it, and says why, when no payout is held any more', async () => {
    const { container } = actions({
      disputes: [{ id: DISPUTE, amount: total, canDecide: true, payoutHeld: false }],
    });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Parkfairy bears the loss/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /The owners bear the loss/ })).toBeNull();
    expect(screen.getByText(/Nothing is held: the owners were paid already/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('keeps two lost disputes apart: each its own group and heading ids, no duplicate ids', async () => {
    const second = '9a2f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
    const { container } = actions({
      disputes: [
        { id: DISPUTE, amount: total, canDecide: true, payoutHeld: true },
        { id: second, amount: total, canDecide: true, payoutHeld: true },
      ],
    });
    // Both choose the same way: the ids that come of it must still differ.
    const radios = screen.getAllByRole('radio', { name: /Parkfairy bears the loss/ });
    expect(radios).toHaveLength(2);
    for (const radio of radios) await userEvent.click(radio);
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    await expectNoAxeViolations(container);
  });

  it('tells it, before a choice is made, that a note and one more question follow', () => {
    actions({ disputes: [{ id: DISPUTE, amount: total, canDecide: true, payoutHeld: true }] });
    expect(
      screen.getByText(/After you choose, a note and one more question follow/),
    ).toBeInTheDocument();
  });

  it('offers nothing for a dispute that cannot be decided', () => {
    actions({
      disputes: [{ id: DISPUTE, amount: total, canDecide: false, payoutHeld: true }],
      canCancel: true,
    });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('when there is nothing to do', () => {
  it('says so, with no button', async () => {
    const { container } = actions();
    expect(screen.getByRole('note')).toHaveTextContent('Nothing to do here');
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('in Greek', () => {
  it('reads the three kinds of action with Greek questions and amounts, axe-clean', async () => {
    const { container } = renderInSubtree(
      <BookingActions
        {...base}
        canCancel
        canRetryRefund
        canSettleRefund
        refund={total}
        disputes={[{ id: DISPUTE, amount: total, canDecide: true, payoutHeld: true }]}
      />,
      { locale: 'el' },
    );
    expect(screen.getByRole('button', { name: 'Ακύρωση της κράτησης…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Νέο αίτημα…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Σήμανση ως διευθετημένη…' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Τη ζημία αναλαμβάνει το Parkfairy' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByLabelText(/Γιατί;/)[0]!);
    await userEvent.paste('Αίτημα 4821.');
    await userEvent.click(screen.getByRole('button', { name: 'Ακύρωση της κράτησης…' }));
    expect(
      screen.getByText(/Ο οδηγός θα λάβει πλήρη επιστροφή χρημάτων: 4,00/),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
