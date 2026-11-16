import type { AdminListingReview } from '@parkfairy/api-client';
import { ADMIN_REASON_NOTE_MAX, OWNER_LIMITS } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { reinstateListing, suspendListing } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { ModerationPanel } from './moderation-panel';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  suspendListing: vi.fn(),
  reinstateListing: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.moderation);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const ok = { ok: true as const, data: {} as AdminListingReview };
const refused = (code: string, status = 409) => ({ ok: false as const, failure: { code }, status });
const live = { own: false, canSuspend: true, canReinstate: false, upcomingBookings: 0 };
const panel = (props: Partial<React.ComponentProps<typeof ModerationPanel>> = {}) =>
  renderInSubtree(<ModerationPanel id={ID} {...live} {...props} />);
const note = (name = /Why is it suspended/) => screen.getByLabelText(name);
const ask = () => userEvent.click(screen.getByRole('button', { name: 'Suspend this listing…' }));
const why = async (text = 'The deed shows another owner.') => {
  await userEvent.click(note());
  await userEvent.paste(text);
  await ask();
};
const confirm = () => userEvent.click(screen.getByRole('button', { name: 'Yes, suspend it' }));

beforeEach(() => {
  vi.mocked(suspendListing).mockReset();
  vi.mocked(reinstateListing).mockReset();
});

describe('suspending a listing', () => {
  it('wants a note first, says so in words with the focus on it, and asks nothing yet', async () => {
    const { container } = panel();
    await ask();
    expect(note()).toHaveAttribute('aria-invalid', 'true');
    expect(note()).toHaveAttribute('aria-required', 'true');
    expect(note()).toHaveFocus();
    expect(note()).toHaveAccessibleDescription(/Plain words, up to 2,000 characters/);
    expect(suspendListing).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('refuses a note too long, and one with characters that read differently from how they look', async () => {
    panel();
    await userEvent.click(note());
    await userEvent.paste('x'.repeat(OWNER_LIMITS.reviewNote + 1));
    await ask();
    expect(note()).toHaveAccessibleDescription(/This is too long/);
    await userEvent.clear(note());
    await userEvent.paste('Hidden\u202Etext');
    await ask();
    expect(note()).toHaveAttribute('aria-invalid', 'true');
    expect(suspendListing).not.toHaveBeenCalled();
  });

  it('offers no choice about bookings when there are none, and sends false', async () => {
    vi.mocked(suspendListing).mockResolvedValue(ok);
    panel({ upcomingBookings: 0 });
    expect(screen.queryByRole('checkbox')).toBeNull();
    await why();
    expect(screen.getByText('Suspend this listing now?')).toBeInTheDocument();
    await confirm();
    expect(suspendListing).toHaveBeenCalledWith(ID, 'The deed shows another owner.', false);
  });

  it('asks about upcoming bookings, unticked by default, with what happens in words', async () => {
    const { container } = panel({ upcomingBookings: 3 });
    const box = screen.getByRole('checkbox', { name: 'Also cancel its 3 upcoming bookings' });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/refunded in full and emailed/);
    await expectNoAxeViolations(container);
  });

  it('leaves the bookings standing unless staff tick the box, and the question says what it will do', async () => {
    vi.mocked(suspendListing).mockResolvedValue(ok);
    panel({ upcomingBookings: 1 });
    expect(
      screen.getByRole('checkbox', { name: 'Also cancel its 1 upcoming booking' }),
    ).toBeVisible();
    await why();
    expect(screen.getByText('Suspend this listing now?')).toBeInTheDocument();
    await confirm();
    expect(suspendListing).toHaveBeenCalledWith(ID, expect.any(String), false);
  });

  it('cancels them when staff tick it, and the question names the number and the refund', async () => {
    vi.mocked(suspendListing).mockResolvedValue(ok);
    panel({ upcomingBookings: 2 });
    await userEvent.click(screen.getByRole('checkbox'));
    await why();
    expect(
      screen.getByText(
        'Suspend this listing and cancel its 2 upcoming bookings now? The drivers are refunded in full.',
      ),
    ).toBeInTheDocument();
    await confirm();
    expect(suspendListing).toHaveBeenCalledWith(ID, 'The deed shows another owner.', true);
  });

  it('moves the focus to the question, and a "not yet" gives it back to the note, which keeps its text', async () => {
    panel();
    await why('Keep this');
    await waitFor(() => expect(screen.getByText('Suspend this listing now?')).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() => expect(note()).toHaveFocus());
    expect(note()).toHaveValue('Keep this');
    expect(suspendListing).not.toHaveBeenCalled();
  });

  it('says so under a heading that takes the focus, and refreshes the page', async () => {
    vi.mocked(suspendListing).mockResolvedValue(ok);
    panel();
    await why();
    await confirm();
    const heading = await screen.findByRole('heading', { name: 'Listing suspended' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why in words when refused, and keeps the reason when the page catches up', async () => {
    vi.mocked(suspendListing).mockResolvedValue(refused('NOT_PUBLISHED'));
    const view = panel();
    await why();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('is not live now');
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    // What `router.refresh()` does: the same panel, with what the page now knows.
    view.rerender(
      <ModerationPanel id={ID} own={false} canSuspend={false} canReinstate upcomingBookings={0} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('is not live now');
    expect(screen.getByRole('button', { name: 'Reinstate this listing…' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus());
  });

  it('says it again, with the focus on it, when the same refusal comes twice, and never two alerts', async () => {
    vi.mocked(suspendListing).mockResolvedValue(refused('NOT_PUBLISHED'));
    panel();
    await why();
    await confirm();
    const first = await screen.findByRole('alert');
    await waitFor(() => expect(first.parentElement).toHaveFocus());
    // The page behind it did not change (the refresh found the same): pressing again says it again.
    await confirm();
    await waitFor(() => expect(screen.getByRole('alert').parentElement).toHaveFocus());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(suspendListing).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['OWN_LISTING', 403, /You own, co-own or manage/],
    ['LISTING_NOT_FOUND', 404, /no longer exists/],
    ['MFA_REQUIRED', 403, /Two-factor verification must be on/],
  ])('says %s in words', async (code, status, text) => {
    vi.mocked(suspendListing).mockResolvedValue(refused(code, status));
    panel();
    await why();
    await confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('says "too many" for a 429 and ignores a second press while it is working', async () => {
    let finish: (value: typeof ok) => void = () => undefined;
    vi.mocked(suspendListing).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    panel();
    await why();
    await confirm();
    await userEvent.click(screen.getByRole('button', { name: 'Suspending…' }));
    expect(suspendListing).toHaveBeenCalledTimes(1);
    finish({ ok: false, failure: {}, status: 429 } as never);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
  });
});

describe('reinstating a listing', () => {
  const props = { own: false, canSuspend: false, canReinstate: true, upcomingBookings: 0 };
  const lift = () =>
    userEvent.click(screen.getByRole('button', { name: 'Reinstate this listing…' }));

  it('wants a short note for the log, which its owners do not read', async () => {
    const { container } = panel(props);
    expect(screen.getByText(/the owners don’t read it/)).toBeInTheDocument();
    await lift();
    const reason = screen.getByLabelText(/Why is it reinstated/);
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription(
      new RegExp(`up to ${ADMIN_REASON_NOTE_MAX} characters`),
    );
    await userEvent.click(reason);
    await userEvent.paste('x'.repeat(ADMIN_REASON_NOTE_MAX + 1));
    await lift();
    expect(reason).toHaveAccessibleDescription(/This is too long/);
    expect(reinstateListing).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('asks once more, sends the note, and says so under a heading that takes the focus', async () => {
    vi.mocked(reinstateListing).mockResolvedValue(ok);
    panel(props);
    await userEvent.click(screen.getByLabelText(/Why is it reinstated/));
    await userEvent.paste('  Ticket 4822.  ');
    await lift();
    expect(screen.getByText('Put this listing back on the site now?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reinstate it' }));
    expect(reinstateListing).toHaveBeenCalledWith(ID, 'Ticket 4822.');
    const heading = await screen.findByRole('heading', { name: 'Listing reinstated' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('refreshes and keeps the reason when someone lifted it first', async () => {
    vi.mocked(reinstateListing).mockResolvedValue(refused('NOT_SUSPENDED'));
    panel(props);
    await userEvent.click(screen.getByLabelText(/Why is it reinstated/));
    await userEvent.paste('Ticket 4822.');
    await lift();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reinstate it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The suspension is already lifted');
    expect(routerMock.refresh).toHaveBeenCalled();
  });
});

describe('when there is nothing to do', () => {
  it('tells staff who own, co-own or manage the listing that someone else must, with no button', async () => {
    const { container } = panel({ own: true, canSuspend: false });
    expect(screen.getByRole('note')).toHaveTextContent('someone else on the staff has to do this');
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('says so for a listing that is neither live nor suspended', () => {
    panel({ canSuspend: false, canReinstate: false });
    expect(screen.getByRole('note')).toHaveTextContent('neither live nor suspended');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('in Greek', () => {
  it('reads, with the booking choice in Greek plurals, axe-clean', async () => {
    const { container } = renderInSubtree(
      <ModerationPanel id={ID} {...live} upcomingBookings={2} />,
      { locale: 'el' },
    );
    expect(
      screen.getByRole('checkbox', { name: 'Ακύρωση και των 2 επερχόμενων κρατήσεων' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Αναστολή του χώρου…' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByLabelText(/Γιατί τίθεται σε αναστολή/));
    await userEvent.paste('Ο τίτλος δεν ταιριάζει.');
    await userEvent.click(screen.getByRole('button', { name: 'Αναστολή του χώρου…' }));
    expect(
      screen.getByText(
        'Να τεθεί τώρα ο χώρος σε αναστολή και να ακυρωθούν οι 2 επερχόμενες κρατήσεις του; Οι οδηγοί θα λάβουν πλήρη επιστροφή χρημάτων.',
      ),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
