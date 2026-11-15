import { acceptListingInvite, previewListingInvite } from '@parkfairy/api-client';
import { INVITE_TOKEN_PATTERN as CONTRACT_PATTERN } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { INVITE_TOKEN_PATTERN } from '@/lib/invite-token';
import { routerMock } from '@/test/navigation-mock';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { InviteAcceptance, KeepInviteToken } from './invite-acceptance';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  acceptListingInvite: vi.fn(),
  previewListingInvite: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);
const preview = vi.mocked(previewListingInvite);
const accept = vi.mocked(acceptListingInvite);

const TOKEN = 'Tok3n_with-43-characters_0123456789abcdefg'.padEnd(43, 'x').slice(0, 43);
const open = {
  state: 'open' as const,
  listingName: 'Γκαράζ Ερμού',
  contentLocale: 'el' as const,
  invitedBy: 'Maria',
  forYou: true,
};

const at = (hash: string) => window.history.replaceState(null, '', `/en/owner/invite${hash}`);
const show = (locale: 'en' | 'el' = 'en') => renderInSubtree(<InviteAcceptance />, { locale });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  at(`#${TOKEN}`);
});

afterEach(() => {
  at('');
});

describe('InviteAcceptance', () => {
  it('reads the token after the #, keeps it for the tab and takes it out of the address', async () => {
    preview.mockResolvedValue(answer(open) as never);
    const { container } = show();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the invitation…');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Maria invites you to co-own “Γκαράζ Ερμού”.',
      ),
    );
    // One status line throughout: "Reading…" becomes what the invitation is, in the same element.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(preview).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBe(TOKEN);
    // The listing's name read in the language it's written in.
    expect(screen.getByText('Γκαράζ Ερμού').closest('[lang]')).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
  });

  it('accepts, forgets the token, and says so with the way to the listing’s owners', async () => {
    preview.mockResolvedValue(answer(open) as never);
    accept.mockResolvedValue(answer({ listingId: LISTING_ID }) as never);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(accept).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(
      await screen.findByRole('heading', { name: 'You’re now one of this listing’s owners.' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'See the listing’s owners' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/owners`,
    );
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBeNull();
  });

  it('comes back to the token kept in the tab, after signing in on the way', async () => {
    sessionStorage.setItem('parkfairy:invite-token', TOKEN);
    at('');
    preview.mockResolvedValue(answer(open) as never);
    show();
    await screen.findByRole('button', { name: 'Accept invitation' });
    expect(preview).toHaveBeenCalledWith({ body: { token: TOKEN } });
  });

  it('offers nothing to accept to another account, and says why', async () => {
    preview.mockResolvedValue(answer({ ...open, forYou: false }) as never);
    const { container } = show();
    expect(
      await screen.findByText(/This invitation was sent to another email address/),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);

    // A way to the right account: out, then signing in with it, back here with the token.
    vi.mocked(authClient.signOut).mockResolvedValue({ data: { success: true } } as never);
    sessionStorage.setItem('parkfairy.sent-to:/sign-up', 'other@example.gr');
    const button = screen.getByRole('button', {
      name: 'Sign out, then sign in with the invited address',
    });
    // Pressed twice in a hurry: one sign-out.
    await userEvent.dblClick(button);
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith({
        pathname: '/sign-in',
        query: { next: '/owner/invite' },
      }),
    );
    expect(authClient.signOut).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('parkfairy.sent-to:/sign-up')).toBeNull();
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBe(TOKEN);
  });

  it.each([
    ['answers with an error', () => Promise.resolve({ error: { status: 500 } })],
    ['can’t be reached', () => Promise.reject(new Error('offline'))],
  ])('says so and stays when signing out %s', async (_, signOut) => {
    preview.mockResolvedValue(answer({ ...open, forYou: false }) as never);
    vi.mocked(authClient.signOut).mockImplementation(signOut as never);
    show();
    const button = await screen.findByRole('button', {
      name: 'Sign out, then sign in with the invited address',
    });
    await userEvent.click(button);
    // Said as an alert of its own, beside the notice that the invitation is another address's.
    const failed = await screen.findByText('We couldn’t sign you out. Try again.');
    expect(failed.closest('[role="alert"]')).not.toBeNull();
    // Still signed in: not sent to sign in, and the button can be pressed again.
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveTextContent('Sign out, then sign in with the invited address');
  });

  it('keeps the token when the invitation can’t be read for now', async () => {
    preview.mockResolvedValue(refusal('PAYMENT_PROVIDER_ERROR', 500) as never);
    show();
    expect(await screen.findByRole('alert')).toBeVisible();
    // A failure of ours, not of the link: the next try still has it.
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBe(TOKEN);
  });

  it.each([
    ['expired', 'This invitation has expired.'],
    ['used', 'This invitation has already been accepted or withdrawn.'],
  ] as const)('says an invitation %s is no use any more', async (state, text) => {
    preview.mockResolvedValue(answer({ ...open, state }) as never);
    show();
    expect(await screen.findByText(new RegExp(`^${text}`))).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Nothing of no use kept in the tab: a shared computer keeps no token.
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBeNull();
  });

  it('says plainly what a listing with no name yet is, with or without who invited', async () => {
    preview.mockResolvedValue(answer({ ...open, listingName: null }) as never);
    const first = show();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Maria invites you to co-own a parking listing.',
      ),
    );
    expect(screen.getByRole('status').textContent).not.toMatch(/“”|«»/);
    first.unmount();
    preview.mockResolvedValue(answer({ ...open, listingName: null, invitedBy: null }) as never);
    show('el');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Σας προσκαλούν να συμμετέχετε στην ιδιοκτησία ενός χώρου στάθμευσης.',
      ),
    );
  });

  it('names the inviter in Greek without gendering anyone, the name kept apart', async () => {
    preview.mockResolvedValue(answer(open) as never);
    show('el');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Maria σας προσκαλεί να συμμετέχετε στην ιδιοκτησία του χώρου «Γκαράζ Ερμού».',
      ),
    );
    // A person's name is isolated, so a name in another script doesn't reorder the sentence.
    expect(screen.getByText('Maria').tagName).toBe('BDI');
  });

  it('says a link that matches no invitation doesn’t work, and one without a token can’t', async () => {
    preview.mockResolvedValue(refusal('INVITE_NOT_FOUND', 404) as never);
    const first = show();
    expect(await screen.findByText(/This invitation link doesn’t work/)).toBeVisible();
    expect(sessionStorage.getItem('parkfairy:invite-token')).toBeNull();
    first.unmount();
    sessionStorage.clear();
    at('#not-a-token');
    show();
    expect(
      await screen.findByText(/This page needs the link from the invitation email/),
    ).toBeVisible();
    expect(preview).toHaveBeenCalledOnce();
  });

  it('says what went wrong with accepting, in words of ours, and in Greek', async () => {
    preview.mockResolvedValue(answer(open) as never);
    accept.mockResolvedValue(refusal('INVITE_EXPIRED') as never);
    show('el');
    await userEvent.click(await screen.findByRole('button', { name: 'Αποδοχή πρόσκλησης' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Η πρόσκληση έληξε. Ζητήστε νέα.');
  });
});

describe('the token, signed out', () => {
  it('is kept for the tab, so signing in on the way loses nothing', async () => {
    render(<KeepInviteToken />);
    await waitFor(() => expect(sessionStorage.getItem('parkfairy:invite-token')).toBe(TOKEN));
    expect(window.location.hash).toBe('');
  });

  it('has the contracts’ shape', () => {
    expect(INVITE_TOKEN_PATTERN.source).toBe(CONTRACT_PATTERN.source);
  });
});
