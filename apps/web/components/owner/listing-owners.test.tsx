import {
  inviteListingOwner,
  leaveListing,
  removeListingOwner,
  setListingShares,
  withdrawListingInvite,
  type ListingOwners,
} from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { ListingOwnersPanel } from './listing-owners';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  inviteListingOwner: vi.fn(),
  leaveListing: vi.fn(),
  removeListingOwner: vi.fn(),
  setListingShares: vi.fn(),
  withdrawListingInvite: vi.fn(),
}));
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

const MARIA = 'a0a0a0a0-0000-4000-8000-000000000001';
const ELENI = 'a0a0a0a0-0000-4000-8000-000000000002';
const INVITE = 'c0c0c0c0-0000-4000-8000-000000000001';

const owners = (overrides: Partial<ListingOwners> = {}): ListingOwners => ({
  listingId: LISTING_ID,
  name: 'Γκαράζ Ερμού',
  contentLocale: 'el',
  role: 'primary',
  owners: [
    {
      id: MARIA,
      name: 'Maria',
      email: 'maria@example.gr',
      role: 'primary',
      sharePercent: 100,
      payouts: 'active',
      you: true,
    },
    {
      id: ELENI,
      name: 'Eleni',
      email: 'eleni@example.gr',
      role: 'co_owner',
      sharePercent: 0,
      payouts: 'none',
      you: false,
    },
  ],
  invites: [
    {
      id: INVITE,
      email: 'nikos@example.gr',
      invitedBy: 'Maria',
      expiresAt: '2026-11-20T10:00:00.000Z',
      canWithdraw: true,
    },
  ],
  payable: true,
  room: 7,
  ...overrides,
});

const show = (initial = owners(), locale: 'en' | 'el' = 'en') =>
  renderInSubtree(<ListingOwnersPanel initial={initial} />, { locale });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ListingOwnersPanel, as the primary owner', () => {
  it('sets out each owner’s role, share and payouts, with a field for every share', async () => {
    const { container } = show();
    expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toBeVisible();
    expect(screen.getByText('Maria (you)')).toBeVisible();
    expect(screen.getByText('Primary owner')).toBeVisible();
    expect(screen.getByText('Co-owner')).toBeVisible();
    expect(screen.getByText('Payouts not set up')).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Share for Maria' })).toHaveValue(100);
    expect(screen.getByRole('spinbutton', { name: 'Share for Eleni' })).toHaveValue(0);
    expect(screen.getByText('Total: 100%')).toBeVisible();
    // Drivers can book: nothing to warn of.
    expect(screen.queryByText(/Drivers can’t book this listing/)).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('saves shares adding up to 100, and says so', async () => {
    vi.mocked(setListingShares).mockResolvedValue(
      answer(
        owners({
          owners: owners().owners.map((owner) => ({
            ...owner,
            sharePercent: owner.id === MARIA ? 60 : 40,
          })),
          payable: false,
        }),
      ) as never,
    );
    show();
    const maria = screen.getByRole('spinbutton', { name: 'Share for Maria' });
    const eleni = screen.getByRole('spinbutton', { name: 'Share for Eleni' });
    await userEvent.clear(maria);
    await userEvent.type(maria, '60');
    await userEvent.clear(eleni);
    await userEvent.type(eleni, '40');
    expect(screen.getByText('Total: 100%')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save shares' }));
    await waitFor(() =>
      expect(setListingShares).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: {
          shares: [
            { ownerId: MARIA, percent: 60 },
            { ownerId: ELENI, percent: 40 },
          ],
        },
      }),
    );
    expect(await screen.findByText('Shares saved.')).toBeVisible();
    // Eleni has a share now and can't be paid: drivers can't book it, and the page says so.
    expect(screen.getByText(/Drivers can’t book this listing/)).toBeVisible();
  });

  it('refuses shares that don’t add up to 100, before asking the API', async () => {
    show();
    const eleni = screen.getByRole('spinbutton', { name: 'Share for Eleni' });
    await userEvent.clear(eleni);
    await userEvent.type(eleni, '10');
    expect(screen.getByText('Total: 110%')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save shares' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The shares must add up to 100%');
    expect(setListingShares).not.toHaveBeenCalled();
  });

  it('removes a co-owner on the second press, and says who went', async () => {
    vi.mocked(removeListingOwner).mockResolvedValue(
      answer(owners({ owners: owners().owners.slice(0, 1) })) as never,
    );
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eleni' }));
    expect(screen.getByText(/Remove Eleni from this listing’s owners\?/)).toHaveFocus();
    expect(removeListingOwner).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() =>
      expect(removeListingOwner).toHaveBeenCalledWith({ path: { id: LISTING_ID, ownerId: ELENI } }),
    );
    expect(await screen.findByText('Removed Eleni.')).toBeVisible();
    expect(screen.queryByRole('spinbutton', { name: 'Share for Eleni' })).not.toBeInTheDocument();
  });

  it('gives the focus back to the button when the removal is kept', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eleni' }));
    await userEvent.click(screen.getByRole('button', { name: 'No, keep' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Eleni' })).toHaveFocus());
  });
});

describe('ListingOwnersPanel, as a co-owner', () => {
  const asCoOwner = () =>
    owners({
      role: 'co_owner',
      owners: owners().owners.map((owner) => ({ ...owner, you: owner.id === ELENI })),
      invites: [{ ...owners().invites[0]!, canWithdraw: false }],
    });

  it('shows the shares without fields, and leaves on the second press', async () => {
    vi.mocked(leaveListing).mockResolvedValue(answer(undefined) as never);
    const { container } = show(asCoOwner());
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('Share: 100%')).toBeVisible();
    expect(screen.getByText('Eleni (you)')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    // Another's invitation: theirs, or the primary's, to withdraw.
    expect(screen.queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Leave this listing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, leave' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/owner'));
    expect(leaveListing).toHaveBeenCalledWith({ path: { id: LISTING_ID } });
  });
});

describe('ListingOwnersPanel, invitations', () => {
  it('invites by email in the page’s language, and says it went', async () => {
    vi.mocked(inviteListingOwner).mockResolvedValue(answer(owners({ room: 6 })) as never);
    show(owners(), 'el');
    const field = screen.getByRole('textbox', { name: 'Διεύθυνση email' });
    await userEvent.type(field, 'kostas@example.gr');
    await userEvent.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    await waitFor(() =>
      expect(inviteListingOwner).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: { email: 'kostas@example.gr', locale: 'el' },
      }),
    );
    expect(await screen.findByText('Η πρόσκληση στάλθηκε στο kostas@example.gr.')).toBeVisible();
    expect(field).toHaveValue('');
  });

  it('says why an invitation was refused, in words of ours', async () => {
    vi.mocked(inviteListingOwner).mockResolvedValue(refusal('ALREADY_INVITED') as never);
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'x@example.gr');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An invitation to that address is already waiting for an answer.',
    );
  });

  it('checks the address before asking the API', async () => {
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'not an address');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Enter a valid email address')).toBeVisible();
    expect(inviteListingOwner).not.toHaveBeenCalled();
  });

  it('lists invitations waiting, when each link works until, and withdraws one', async () => {
    vi.mocked(withdrawListingInvite).mockResolvedValue(answer(owners({ invites: [] })) as never);
    show();
    const waiting = screen.getByRole('heading', {
      level: 2,
      name: 'Invitations waiting for an answer',
    });
    const card = waiting.closest('div[data-slot="card"]') ?? document.body;
    expect(within(card as HTMLElement).getByText('nikos@example.gr')).toBeVisible();
    expect(within(card as HTMLElement).getByText(/Link works until November 20/)).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to nikos@example.gr' }),
    );
    expect(await screen.findByText('Invitation to nikos@example.gr withdrawn.')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Invitations waiting for an answer' }),
    ).not.toBeInTheDocument();
  });

  it('offers no form once the listing has as many owners and invitations as it can', () => {
    show(owners({ room: 0 }));
    expect(
      screen.getByText('This listing has as many owners and invitations as it can.'),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Email address' })).not.toBeInTheDocument();
  });

  it('says an invitation is still being sent before its link exists', () => {
    show(owners({ invites: [{ ...owners().invites[0]!, expiresAt: null }] }));
    expect(screen.getByText(/Being sent/)).toBeVisible();
  });
});
