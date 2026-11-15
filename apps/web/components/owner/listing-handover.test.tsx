import {
  acceptListingHandover,
  getListingOwners,
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
  getListingOwners: vi.fn(),
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
  managers: [],
  invites: [],
  handover,
  payable: true,
  room: 8,
  managersRoom: 5,
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
    await userEvent.click(screen.getByRole('button', { name: 'Take over the primary role' }));
    expect(acceptListingHandover).not.toHaveBeenCalled();
    expect(screen.getByText(/stays on as a co-owner with their share/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
    expect(await screen.findByText('You’re now the primary owner.')).toBeInTheDocument();
    expect(acceptListingHandover).toHaveBeenCalledWith({ path: { id: LISTING_ID } });
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toHaveFocus(),
    );
    // Now the primary's panel: the shares can be saved.
    expect(screen.getByRole('button', { name: 'Save shares' })).toBeVisible();
  });

  it('lets the co-owner decline instead', async () => {
    vi.mocked(withdrawListingHandover).mockResolvedValue(answer(owners('co_owner')) as never);
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline the offer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, decline' }));
    expect(await screen.findByText('The offer of the primary role is closed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take over the primary role' })).toBeNull();
    // The card is gone with the offer: the focus goes to a heading that stays, not to the page top.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toHaveFocus(),
    );
  });

  it('says why when the co-owner can’t take over yet, and changes nothing', async () => {
    vi.mocked(acceptListingHandover).mockResolvedValue(refusal('PAYOUTS_NOT_ACTIVE', 409) as never);
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Take over the primary role' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
    expect(await screen.findByText(/needs payouts set up with Stripe first/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save shares' })).toBeNull();
  });

  it('links the co-owner offered the role to their payouts page', () => {
    show(owners('co_owner', { ...OFFER, canAccept: true }));
    expect(screen.getByRole('link', { name: 'Set up your payouts' })).toHaveAttribute(
      'href',
      '/en/owner/payouts',
    );
  });

  it('has no payouts link for the primary, whose co-owner it is who must act', () => {
    show(owners('primary', OFFER));
    expect(screen.queryByRole('link', { name: 'Set up your payouts' })).toBeNull();
  });

  describe('an offer that is no longer in force', () => {
    it('reads the page again instead of keeping a button that can only fail, co-owner', async () => {
      vi.mocked(acceptListingHandover).mockResolvedValue(
        refusal('HANDOVER_NOT_FOUND', 404) as never,
      );
      vi.mocked(getListingOwners).mockResolvedValue(answer(owners('co_owner')) as never);
      show(owners('co_owner', { ...OFFER, canAccept: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Take over the primary role' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
      // The page is read as it stands now: the offer, and the card with it, are gone.
      await waitFor(() =>
        expect(getListingOwners).toHaveBeenCalledWith({ path: { id: LISTING_ID } }),
      );
      await waitFor(() => expect(screen.queryByText('Handing over the primary role')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Yes, take over' })).toBeNull();
      // Said where a screen reader hears it, with the focus on a heading that stays.
      expect(
        await screen.findByText(/That offer is no longer open, so this page now shows/),
      ).toBeVisible();
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toHaveFocus(),
      );
    });

    it('does the same for a lapsed offer, and the primary can offer again', async () => {
      vi.mocked(withdrawListingHandover).mockResolvedValue(
        refusal('HANDOVER_EXPIRED', 409) as never,
      );
      vi.mocked(getListingOwners).mockResolvedValue(answer(owners('primary')) as never);
      show(owners('primary', OFFER));
      await userEvent.click(screen.getByRole('button', { name: 'Take the offer back' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, take it back' }));
      expect(await screen.findByText(/That offer is no longer open/)).toBeVisible();
      expect(
        await screen.findByRole('button', { name: 'Offer the primary role to Eleni' }),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          screen.getByRole('heading', { level: 2, name: 'Handing over the primary role' }),
        ).toHaveFocus(),
      );
    });

    it('keeps the question, and says why, when the page can’t be read again', async () => {
      vi.mocked(acceptListingHandover).mockResolvedValue(
        refusal('HANDOVER_NOT_FOUND', 404) as never,
      );
      vi.mocked(getListingOwners).mockResolvedValue(refusal('GENERIC', 500) as never);
      show(owners('co_owner', { ...OFFER, canAccept: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Take over the primary role' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
      await waitFor(() => expect(getListingOwners).toHaveBeenCalled());
      // Nothing was learned: the question stays, and the refusal's own words say what happened.
      expect(
        await screen.findByText(/There’s no open offer of the primary role any more/),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Yes, take over' })).toBeVisible();
      expect(screen.getByText(/Take over the primary role\?/)).toBeVisible();
    });

    it('puts the focus on the owners heading when the card goes with the offer being accepted', async () => {
      // The primary takes the offer back, but the co-owner had already accepted it: they are a
      // co-owner now, and the card they pressed in is gone.
      vi.mocked(withdrawListingHandover).mockResolvedValue(
        refusal('HANDOVER_NOT_FOUND', 404) as never,
      );
      vi.mocked(getListingOwners).mockResolvedValue(answer(owners('co_owner')) as never);
      show(owners('primary', OFFER));
      await userEvent.click(screen.getByRole('button', { name: 'Take the offer back' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, take it back' }));
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toHaveFocus(),
      );
      expect(screen.queryByText('Handing over the primary role')).toBeNull();
    });

    it('does not read the page again for a refusal that is not about the offer', async () => {
      vi.mocked(acceptListingHandover).mockResolvedValue(
        refusal('PAYOUTS_NOT_ACTIVE', 409) as never,
      );
      show(owners('co_owner', { ...OFFER, canAccept: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Take over the primary role' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, take over' }));
      expect(await screen.findByText(/needs payouts set up with Stripe first/)).toBeVisible();
      expect(getListingOwners).not.toHaveBeenCalled();
    });

    it('reads the page again when a co-owner accepts an offer that has lapsed, in Greek too', async () => {
      vi.mocked(acceptListingHandover).mockResolvedValue(refusal('HANDOVER_EXPIRED', 409) as never);
      vi.mocked(getListingOwners).mockResolvedValue(answer(owners('co_owner')) as never);
      show(owners('co_owner', { ...OFFER, canAccept: true }), 'el');
      await userEvent.click(
        screen.getByRole('button', { name: 'Αναλάβετε τον ρόλο του κύριου ιδιοκτήτη' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Ναι, αναλαμβάνω' }));
      expect(await screen.findByText(/Η πρόταση δεν είναι πλέον ανοιχτή/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Ναι, αναλαμβάνω' })).toBeNull();
    });
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
    await userEvent.click(
      screen.getByRole('button', { name: 'Αναλάβετε τον ρόλο του κύριου ιδιοκτήτη' }),
    );
    expect(screen.getByRole('button', { name: 'Ναι, αναλαμβάνω' })).toBeVisible();
    await expectNoAxeViolations(container);
  });
});
