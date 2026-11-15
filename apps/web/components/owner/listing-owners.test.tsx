import {
  inviteListingOwner,
  leaveListing,
  removeListingOwner,
  setListingShares,
  withdrawListingInvite,
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
const SECOND = 'c0c0c0c0-0000-4000-8000-000000000002';

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

/** A sentence whose names sit in their own elements: matched whole, on its paragraph. */
const sentence = (text: string) =>
  screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);

/** A refusal with what the API says besides its code. */
const refusedWith = (code: string, extra: Record<string, unknown>) => ({
  error: { code, statusCode: 409, message: code, ...extra },
  response: new Response(null, { status: 409 }),
});

/** An answer that comes when the test says so. */
function later<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ListingOwnersPanel, as the primary owner', () => {
  it('sets out each owner’s role, share and payouts, with a field for every share', async () => {
    const { container } = show();
    expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toBeVisible();
    expect(sentence('Maria (you)')).toBeVisible();
    expect(screen.getByText('Primary owner')).toBeVisible();
    expect(screen.getByText('Co-owner')).toBeVisible();
    expect(screen.getByText('Payouts not set up')).toBeVisible();
    const maria = screen.getByRole('spinbutton', { name: 'Share for Maria' });
    expect(maria).toHaveValue(100);
    // What's asked, said with the field: whole percents adding up to 100, the unit, the total.
    expect(maria).toHaveAccessibleDescription(
      'Whole percentages; together they must add up to 100%. In percent (%) Total: 100%',
    );
    expect(screen.getByRole('spinbutton', { name: 'Share for Eleni' })).toHaveValue(0);
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
    expect(screen.getByText(/Drivers can’t book this listing/)).toBeVisible();
  });

  it('says a total that isn’t 100 at the total, and marks every share field', async () => {
    const { container } = show();
    const eleni = screen.getByRole('spinbutton', { name: 'Share for Eleni' });
    await userEvent.clear(eleni);
    await userEvent.type(eleni, '10');
    expect(screen.getByText('Total: 110%')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save shares' }));
    // Said once, as it is, by the form's status; read with each field, never as an alert.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((region) => region.textContent === 'The shares must add up to 100%'),
      ).toBe(true),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const name of ['Share for Maria', 'Share for Eleni']) {
      const field = screen.getByRole('spinbutton', { name });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(/Total: 110% The shares must add up to 100%$/);
    }
    expect(setListingShares).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('says whose share waits on their details, at their field, in words of ours', async () => {
    vi.mocked(setListingShares).mockResolvedValue(
      refusedWith('OWNER_DETAILS_MISSING', { owners: [ELENI] }) as never,
    );
    const { container } = show();
    const maria = screen.getByRole('spinbutton', { name: 'Share for Maria' });
    const eleni = screen.getByRole('spinbutton', { name: 'Share for Eleni' });
    await userEvent.clear(maria);
    await userEvent.type(maria, '50');
    await userEvent.clear(eleni);
    await userEvent.type(eleni, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save shares' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An owner with a share, or the primary owner, hasn’t filled in “About you” and “Tax details” yet.',
    );
    const waits =
      'Eleni can have a share once they’ve filled in “About you” and “Tax details” in their own account.';
    expect(eleni).toHaveAttribute('aria-invalid', 'true');
    expect(eleni).toHaveAccessibleDescription(new RegExp(waits));
    expect(maria).not.toHaveAttribute('aria-invalid');
    await expectNoAxeViolations(container);
  });

  it('shows the primary, when theirs is the share that waits, where to fill them in', async () => {
    vi.mocked(setListingShares).mockResolvedValue(
      refusedWith('OWNER_DETAILS_MISSING', { owners: [MARIA] }) as never,
    );
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Save shares' }));
    expect(await screen.findByRole('link', { name: 'About you' })).toHaveAttribute(
      'href',
      '/en/owner/profile',
    );
    expect(screen.getByRole('link', { name: 'Tax details' })).toHaveAttribute(
      'href',
      '/en/owner/tax',
    );
    expect(screen.getByRole('spinbutton', { name: 'Share for Maria' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('removes a co-owner on the second press, says who went, and keeps the focus on the page', async () => {
    vi.mocked(removeListingOwner).mockResolvedValue(
      answer(owners({ owners: owners().owners.slice(0, 1) })) as never,
    );
    const { container } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eleni' }));
    // The first press only asks.
    expect(removeListingOwner).not.toHaveBeenCalled();
    const question = 'Remove Eleni from this listing’s owners? Their share goes back to you.';
    expect(sentence(question)).toHaveFocus();
    await expectNoAxeViolations(container);
    // The confirming button says whom it removes.
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toHaveAccessibleDescription(
      question,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Owners and shares' })).toHaveFocus(),
    );
    expect(removeListingOwner).toHaveBeenCalledWith({ path: { id: LISTING_ID, ownerId: ELENI } });
    await waitFor(() => expect(sentence('Removed Eleni.')).toBeVisible());
    // The name in its own element, so a name in another script or language is read as one.
    expect(screen.getAllByText('Eleni').some((name) => name.tagName === 'BDI')).toBe(true);
    expect(screen.queryByRole('spinbutton', { name: 'Share for Eleni' })).not.toBeInTheDocument();
  });

  it('keeps share edits not saved yet when an invitation is sent', async () => {
    vi.mocked(inviteListingOwner).mockResolvedValue(answer(owners({ room: 6 })) as never);
    show();
    const eleni = screen.getByRole('spinbutton', { name: 'Share for Eleni' });
    await userEvent.clear(eleni);
    await userEvent.type(eleni, '25');
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'k@example.gr');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByText('Invitation sent to k@example.gr.');
    expect(screen.getByRole('spinbutton', { name: 'Share for Eleni' })).toHaveValue(25);
  });

  it('gives the focus back to the button when the removal is kept, and says a refusal', async () => {
    vi.mocked(removeListingOwner).mockResolvedValue(refusal('OWNER_NOT_FOUND', 404) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eleni' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That person isn’t one of this listing’s owners any more.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'No, keep' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Eleni' })).toHaveFocus());
  });

  it('marks a Greek name on the English page as Greek, and reads dates on a 24-hour clock in Greek', () => {
    const greek = owners({
      owners: owners().owners.map((owner) =>
        owner.id === ELENI ? { ...owner, name: 'Ελένη Παππά' } : owner,
      ),
    });
    const english = show(greek);
    expect(screen.getAllByText('Ελένη Παππά')[0]?.closest('[lang]')).toHaveAttribute('lang', 'el');
    english.unmount();
    show(greek, 'el');
    // Greek plurals, with their numbers.
    expect(screen.getByText(/ισχύει για 7 ημέρες/)).toBeVisible();
    expect(
      screen.getByText('Μπορείτε να προσθέσετε ακόμη 7 ιδιοκτήτες ή προσκλήσεις.'),
    ).toBeVisible();
    expect(screen.getByText(/Ο σύνδεσμος ισχύει έως/)).toHaveTextContent('20 Νοεμβρίου');
    expect(screen.getByText(/Ο σύνδεσμος ισχύει έως/)).toHaveTextContent('12:00');
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-11-20T10:00:00.000Z');
  });
});

describe('ListingOwnersPanel, as a co-owner', () => {
  const asCoOwner = (): ListingOwners =>
    owners({
      role: 'co_owner',
      owners: [
        { ...owners().owners[0]!, email: null, payouts: null, you: false },
        { ...owners().owners[1]!, you: true },
      ],
      invites: [{ ...owners().invites[0]!, email: null, canWithdraw: false }],
    });

  it('shows the others’ names only, no fields, and no way to remove or withdraw', async () => {
    const { container } = show(asCoOwner());
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText('Share: 100%')).toBeVisible();
    expect(sentence('Eleni (you)')).toBeVisible();
    expect(screen.queryByText('maria@example.gr')).not.toBeInTheDocument();
    expect(screen.queryByText('Payouts set up')).not.toBeInTheDocument();
    // Only their own payouts: nothing is said of the primary's.
    expect(screen.getAllByText('Payouts not set up')).toHaveLength(1);
    expect(screen.getByText('Invitation', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Withdraw/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('leaves on the second press, and says so where the page was', async () => {
    vi.mocked(leaveListing).mockResolvedValue(answer(undefined) as never);
    const { container } = show(asCoOwner());
    await userEvent.click(screen.getByRole('button', { name: 'Leave this listing' }));
    expect(leaveListing).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, leave' }));
    const left = await screen.findByRole('heading', { name: 'You’ve left this listing.' });
    await waitFor(() => expect(left).toHaveFocus());
    await expectNoAxeViolations(container);
    expect(screen.getByRole('link', { name: 'Back to your listings' })).toHaveAttribute(
      'href',
      '/en/owner',
    );
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
    expect(
      await screen.findByText('Η πρόσκληση στάλθηκε στη διεύθυνση kostas@example.gr.'),
    ).toBeVisible();
    expect(field).toHaveValue('');
  });

  it('moves the focus to the section’s heading when the last place was taken', async () => {
    vi.mocked(inviteListingOwner).mockResolvedValue(answer(owners({ room: 0 })) as never);
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'z@example.gr');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Invite an owner' })).toHaveFocus(),
    );
    expect(
      screen.getByText('This listing already has the most owners and invitations allowed (10).'),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Email address' })).not.toBeInTheDocument();
  });

  it.each([
    ['day', /^You’ve sent as many invitations as one account can in a day\. Try again tomorrow\.$/],
    ['address', /^This address has had as many invitations to this listing as it can this week\./],
  ] as const)('says which cap an invitation met (%s), in words of ours', async (limit, text) => {
    vi.mocked(inviteListingOwner).mockResolvedValue(
      refusedWith('TOO_MANY_INVITES', { limit }) as never,
    );
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'x@example.gr');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('checks the address before asking the API', async () => {
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Email address' }), 'not an address');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('Enter a valid email address')).toBeVisible();
    expect(inviteListingOwner).not.toHaveBeenCalled();
  });

  it('lists invitations waiting until when, and withdraws one, the focus going to the next', async () => {
    const two = owners({
      invites: [
        owners().invites[0]!,
        { ...owners().invites[0]!, id: SECOND, email: 'kostas@example.gr' },
      ],
    });
    vi.mocked(withdrawListingInvite).mockResolvedValue(
      answer(owners({ invites: [two.invites[1]!] })) as never,
    );
    show(two);
    // The date in its own <time>: the sentence is matched whole, on its paragraph.
    const until = screen.getAllByText(
      (_, element) =>
        element?.tagName === 'P' && /^Link works until November 20/.test(element.textContent ?? ''),
    );
    expect(until[0]).toHaveTextContent('12:00');
    await userEvent.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to nikos@example.gr' }),
    );
    expect(await screen.findByText('Invitation to nikos@example.gr withdrawn.')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Withdraw the invitation to kostas@example.gr' }),
      ).toHaveFocus(),
    );
  });

  it('moves the focus to the invite section when the last invitation is withdrawn', async () => {
    vi.mocked(withdrawListingInvite).mockResolvedValue(answer(owners({ invites: [] })) as never);
    show();
    await userEvent.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to nikos@example.gr' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Invite an owner' })).toHaveFocus(),
    );
    expect(
      screen.queryByRole('heading', { name: 'Invitations waiting for an answer' }),
    ).not.toBeInTheDocument();
  });

  it('says an invitation is still being sent before its link exists', () => {
    show(owners({ invites: [{ ...owners().invites[0]!, expiresAt: null }] }));
    expect(screen.getByText('Being sent')).toBeVisible();
  });
});

describe('ListingOwnersPanel, where the focus goes', () => {
  const four = () =>
    owners({
      invites: ['one', 'two', 'three', 'four'].map((name, index) => ({
        ...owners().invites[0]!,
        id: `c0c0c0c0-0000-4000-8000-00000000000${index + 1}`,
        email: `${name}@example.gr`,
      })),
    });
  const withdrawButton = (name: string) =>
    screen.getByRole('button', { name: `Withdraw the invitation to ${name}@example.gr` });

  it('goes to the following invitation when one in the middle is withdrawn', async () => {
    const all = four();
    vi.mocked(withdrawListingInvite).mockResolvedValue(
      answer(
        owners({ invites: all.invites.filter((invite) => invite.email !== 'three@example.gr') }),
      ) as never,
    );
    show(all);
    await userEvent.click(withdrawButton('three'));
    await waitFor(() => expect(withdrawButton('four')).toHaveFocus());
  });

  it('goes to the one before when the last is withdrawn', async () => {
    const all = four();
    vi.mocked(withdrawListingInvite).mockResolvedValue(
      answer(owners({ invites: all.invites.slice(0, 3) })) as never,
    );
    show(all);
    await userEvent.click(withdrawButton('four'));
    await waitFor(() => expect(withdrawButton('three')).toHaveFocus());
  });

  it('goes to the invitations’ heading when the rest aren’t theirs to withdraw', async () => {
    const mine = {
      ...owners().invites[0]!,
      id: SECOND,
      email: 'mine@example.gr',
      canWithdraw: true,
    };
    const others = { ...owners().invites[0]!, email: null, canWithdraw: false };
    vi.mocked(withdrawListingInvite).mockResolvedValue(
      answer(owners({ role: 'co_owner', invites: [others] })) as never,
    );
    show(owners({ role: 'co_owner', invites: [others, mine] }));
    await userEvent.click(withdrawButton('mine'));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Invitations waiting for an answer' }),
      ).toHaveFocus(),
    );
  });

  it('leaves the focus where someone moved to while the answer was on its way', async () => {
    const removal = later<unknown>();
    vi.mocked(removeListingOwner).mockReturnValue(removal.promise as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Eleni' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    const email = screen.getByRole('textbox', { name: 'Email address' });
    email.focus();
    removal.resolve(answer(owners({ owners: owners().owners.slice(0, 1) })));
    await waitFor(() => expect(sentence('Removed Eleni.')).toBeVisible());
    expect(email).toHaveFocus();
  });
});
