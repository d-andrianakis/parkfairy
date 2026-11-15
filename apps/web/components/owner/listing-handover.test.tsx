import {
  acceptListingHandover,
  offerListingHandover,
  withdrawListingHandover,
  type ListingOwners,
} from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { ListingOwnersPanel } from './listing-owners';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  acceptListingHandover: vi.fn(),
  inviteListingOwner: vi.fn(),
  leaveListing: vi.fn(),
  offerListingHandover: vi.fn(),
  removeListingOwner: vi.fn(),
  setListingShares: vi.fn(),
  withdrawListingHandover: vi.fn(),
  withdrawListingInvite: vi.fn(),
}));
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

const MARIA = 'a0a0a0a0-0000-4000-8000-000000000001';
const ELENI = 'a0a0a0a0-0000-4000-8000-000000000002';
const OFFER = {
  toOwnerId: ELENI,
  expiresAt: '2026-11-22T10:00:00.000Z',
  canAccept: false,
  canWithdraw: true,
};

/** The listing as the primary (Maria) or the co-owner (Eleni) sees it. */
const owners = (
  as: 'primary' | 'co_owner',
  handover: ListingOwners['handover'] = null,
): ListingOwners => ({
  listingId: LISTING_ID,
  name: 'Γκαράζ Ερμού',
  contentLocale: 'el',
  role: as,
  owners: [
    {
      id: MARIA,
      name: 'Maria',
      email: 'maria@example.gr',
      role: as === 'primary' ? 'primary' : 'co_owner',
      sharePercent: 60,
      payouts: 'active',
      you: as === 'primary',
    },
    {
      id: ELENI,
      name: 'Eleni',
      email: 'eleni@example.gr',
      role: as === 'primary' ? 'co_owner' : 'primary',
      sharePercent: 40,
      payouts: 'active',
      you: as === 'co_owner',
    },
  ],
  invites: [],
  handover,
  payable: true,
  room: 8,
});

const show = (initial: ListingOwners, locale: 'en' | 'el' = 'en') =>
  renderInSubtree(<ListingOwnersPanel initial={initial} />, { locale });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handing over the primary role', () => {
  it('offers it to a co-owner on the second press, then shows the offer and its end', async () => {
    vi.mocked(offerListingHandover).mockResolvedValue(answer(owners('primary', OFFER)) as never);
    show(owners('primary'));
    await userEvent.click(screen.getByRole('button', { name: 'Offer the primary role to Eleni' }));
    // Asked twice: nothing was sent by the first press, and the question says what follows.
    expect(offerListingHandover).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing changes until they accept/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, offer it' }));
    await waitFor(() =>
      expect(offerListingHandover).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: { ownerId: ELENI },
      }),
    );
    expect(await screen.findByText(/has been offered the primary role/)).toBeVisible();
    // Said once, in the announcing region (the name sits in its own element).
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Offered the primary role to Eleni.',
      ),
    ).toBeInTheDocument();
    // Only taking it back is left, and the focus is there, not lost with the pressed button.
    expect(screen.queryByRole('button', { name: /Offer the primary role/ })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Take the offer back' })).toHaveFocus(),
    );
  });

  it('lets the primary take an offer back', async () => {
    vi.mocked(withdrawListingHandover).mockResolvedValue(answer(owners('primary')) as never);
    show(owners('primary', OFFER));
    await userEvent.click(screen.getByRole('button', { name: 'Take the offer back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take it back' }));
    expect(await screen.findByText('The offer of the primary role is closed.')).toBeInTheDocument();
    expect(withdrawListingHandover).toHaveBeenCalledWith({ path: { id: LISTING_ID } });
    expect(screen.getByRole('button', { name: 'Offer the primary role to Eleni' })).toBeVisible();
  });

  it('shows the co-owner the offer, and takes over on the second press', async () => {
    vi.mocked(acceptListingHandover).mockResolvedValue(answer(owners('primary')) as never);
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    expect(screen.getByText(/You’ve been offered the primary role/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Take over as primary owner' }));
    expect(acceptListingHandover).not.toHaveBeenCalled();
    expect(screen.getByText(/stays on as a co-owner with their share/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
    expect(await screen.findByText('You’re now the primary owner.')).toBeInTheDocument();
    expect(acceptListingHandover).toHaveBeenCalledWith({ path: { id: LISTING_ID } });
    // Now the primary's panel: the shares can be saved.
    expect(screen.getByRole('button', { name: 'Save shares' })).toBeVisible();
  });

  it('lets the co-owner decline instead', async () => {
    vi.mocked(withdrawListingHandover).mockResolvedValue(answer(owners('co_owner')) as never);
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline the offer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, decline' }));
    expect(await screen.findByText('The offer of the primary role is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take over as primary owner' })).toBeNull();
  });

  it('says why when the co-owner can’t take over yet, and changes nothing', async () => {
    vi.mocked(acceptListingHandover).mockResolvedValue(refusal('PAYOUTS_NOT_ACTIVE', 409) as never);
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Take over as primary owner' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
    expect(await screen.findByText(/payouts must be set up with Stripe first/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save shares' })).toBeNull();
  });

  it('keeps quiet for a co-owner with nothing offered, and for a primary with no co-owner', () => {
    const { unmount } = show(owners('co_owner'));
    expect(screen.queryByText('Handing over the primary role')).toBeNull();
    unmount();
    const alone = owners('primary');
    show({ ...alone, owners: alone.owners.slice(0, 1) });
    expect(screen.queryByText('Handing over the primary role')).toBeNull();
  });

  it('speaks Greek and passes axe, with the offer shown and the question asked', async () => {
    const { container } = show(owners('co_owner', { ...OFFER, canAccept: true }), 'el');
    expect(screen.getByRole('heading', { level: 2, name: /Παράδοση του ρόλου/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Αναλάβετε ως κύριος ιδιοκτήτης' }));
    expect(screen.getByRole('button', { name: 'Ναι, αναλαμβάνω' })).toBeVisible();
    await expectNoAxeViolations(container);
  });
});
