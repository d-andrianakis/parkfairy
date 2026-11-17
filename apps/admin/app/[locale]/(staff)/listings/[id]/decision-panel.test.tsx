import type { AdminListingReview } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { approve, requestChanges } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';

import { DecisionPanel } from './decision-panel';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  approve: vi.fn(),
  requestChanges: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.review);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const ok = { ok: true as const, data: {} as AdminListingReview };
const refused = (code: string, status = 409, extra: object = {}) => ({
  ok: false as const,
  failure: { code, ...extra },
  status,
});
const panel = (props: Partial<React.ComponentProps<typeof DecisionPanel>> = {}) =>
  renderInSubtree(<DecisionPanel id={ID} canDecide own={false} status="in_review" {...props} />);

beforeEach(() => {
  vi.mocked(approve).mockReset();
  vi.mocked(requestChanges).mockReset();
});

describe('approving', () => {
  it('asks again before it publishes, and a "not yet" gives the focus back', async () => {
    const { container } = panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    expect(screen.getByText('Publish this listing now?')).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve this listing' })).toHaveFocus(),
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it('moves the focus to the question when it asks, so it is read', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    await waitFor(() => expect(screen.getByText('Publish this listing now?')).toHaveFocus());
  });

  it('records it, refreshes the page and says so under a heading that takes the focus', async () => {
    vi.mocked(approve).mockResolvedValue(ok);
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, publish it' }));
    expect(approve).toHaveBeenCalledWith(ID);
    const heading = await screen.findByRole('heading', { name: 'Listing approved' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
    // Nothing left to press twice.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why in words when it is refused, and refreshes when someone decided first', async () => {
    vi.mocked(approve).mockResolvedValue(refused('NOT_IN_REVIEW'));
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, publish it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone decided this listing already',
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('names the owners whose details are incomplete', async () => {
    vi.mocked(approve).mockResolvedValue(
      refused('OWNER_DETAILS_MISSING', 409, { owners: ['Ann', 'Bob'] }),
    );
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, publish it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('are incomplete now: Ann, Bob');
  });

  it('says "too many" for a 429, and something plain for anything else', async () => {
    vi.mocked(approve).mockResolvedValueOnce(refused('', 429)).mockResolvedValueOnce({
      ok: false,
      failure: {},
    });
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, publish it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, publish it' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
  });

  it('ignores a second press while it is working', async () => {
    let finish: (value: typeof ok) => void = () => undefined;
    vi.mocked(approve).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this listing' }));
    const confirm = screen.getByRole('button', { name: 'Yes, publish it' });
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Publishing…' }));
    expect(approve).toHaveBeenCalledTimes(1);
    finish(ok);
    await screen.findByRole('heading', { name: 'Listing approved' });
  });
});

describe('sending back', () => {
  const note = () => screen.getByLabelText('What should the owner change?');

  it('refuses an empty note in words and puts the focus there', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Send back with this note' }));
    expect(note()).toHaveAttribute('aria-invalid', 'true');
    expect(note()).toHaveAccessibleDescription(/Check this field/);
    expect(note()).toHaveFocus();
    expect(requestChanges).not.toHaveBeenCalled();
  });

  it('refuses a note too long, and one with characters that read differently from how they look', async () => {
    panel();
    await userEvent.click(note());
    await userEvent.paste('x'.repeat(2001));
    await userEvent.click(screen.getByRole('button', { name: 'Send back with this note' }));
    expect(note()).toHaveAccessibleDescription(/This is too long/);
    await userEvent.clear(note());
    await userEvent.paste('Fix this\u202Eevil');
    await userEvent.click(screen.getByRole('button', { name: 'Send back with this note' }));
    expect(requestChanges).not.toHaveBeenCalled();
    expect(note()).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends the note as written, says so, and refreshes the page', async () => {
    vi.mocked(requestChanges).mockResolvedValue(ok);
    panel();
    await userEvent.click(note());
    await userEvent.paste('Please add a photo.\nThanks!');
    await userEvent.click(screen.getByRole('button', { name: 'Send back with this note' }));
    expect(requestChanges).toHaveBeenCalledWith(ID, 'Please add a photo.\nThanks!');
    const heading = await screen.findByRole('heading', { name: 'Listing sent back' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('shows a refusal above the form, keeping the note', async () => {
    vi.mocked(requestChanges).mockResolvedValue(refused('OWN_LISTING', 403));
    panel();
    await userEvent.click(note());
    await userEvent.paste('Add a photo.');
    await userEvent.click(screen.getByRole('button', { name: 'Send back with this note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You own, co-own or manage');
    expect(note()).toHaveValue('Add a photo.');
  });
});

describe('when there is nothing to decide', () => {
  it('tells someone deciding their own listing that another must', () => {
    panel({ own: true });
    expect(screen.getByText(/someone else on the staff has to decide/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says where a listing stands that no one is waiting on', () => {
    panel({ canDecide: false, status: 'published' });
    expect(screen.getByText(/not waiting for a decision. Its status is: Live/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = renderInSubtree(
      <DecisionPanel id={ID} canDecide own={false} status="in_review" />,
      { locale: 'el' },
    );
    expect(screen.getByRole('button', { name: 'Έγκριση του χώρου' })).toBeInTheDocument();
    expect(screen.getByLabelText('Τι πρέπει να αλλάξει ο ιδιοκτήτης;')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
