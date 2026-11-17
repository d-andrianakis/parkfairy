import type { ListingOwners } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadListingOwners } from '@/lib/owner.server';
import { getLayoutSession, requireSession } from '@/lib/session';
import { LISTING_ID } from '@/test/owner-fixtures';
import { renderWithProviders } from '@/test/render';

import InvitePage, { generateMetadata as inviteMetadata } from './invite/page';
import OwnerLayout from './layout';
import OwnersPage, { generateMetadata as ownersMetadata } from './listings/[id]/owners/page';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  acceptListingInvite: vi.fn(),
  previewListingInvite: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('@/lib/owner.server', () => ({ loadListingOwners: vi.fn() }));
vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve()),
  getLayoutSession: vi.fn(() => Promise.resolve({ user: { id: 'u' } })),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator }, { default: messages }] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
  ]);
  return {
    getTranslations: ({ namespace }: { namespace: string }) =>
      Promise.resolve(createTranslator({ locale: 'en', messages, namespace: namespace as never })),
  };
});

/** Inside the owner layout, as in the app: client components get only the owner namespaces. */
const renderInOwnerArea = async (page: ReactElement) =>
  renderWithProviders(<>{await OwnerLayout({ children: page })}</>);

const owners = (): ListingOwners => ({
  listingId: LISTING_ID,
  name: 'Γκαράζ Ερμού',
  contentLocale: 'el',
  role: 'primary',
  owners: [
    {
      id: 'a0a0a0a0-0000-4000-8000-000000000001',
      name: 'Maria',
      email: 'maria@example.gr',
      role: 'primary',
      sharePercent: 100,
      payouts: 'none',
      you: true,
    },
  ],
  managers: [],
  invites: [],
  handover: null,
  payable: false,
  room: 9,
  managersRoom: 5,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a listing’s owners page', () => {
  const params = Promise.resolve({ locale: 'en', id: LISTING_ID });

  it('needs the owner signed in, and is named for the listing', async () => {
    vi.mocked(loadListingOwners).mockResolvedValue(owners());
    await expect(ownersMetadata({ params })).resolves.toEqual({
      title: 'Owners of “Γκαράζ Ερμού”',
    });
    const { container } = await renderInOwnerArea(await OwnersPage({ params }));
    expect(requireSession).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/owners`);
    expect(screen.getByRole('heading', { level: 1, name: 'Owners' })).toBeVisible();
    expect(screen.getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    expect(screen.getByText(/Only the primary owner can remove owners/)).toBeVisible();
    // Nobody with a share can be paid yet: the page says drivers can't book.
    expect(screen.getByText(/Drivers can’t book this listing/)).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('is the same 404 for another owner’s listing, and says when the API can’t answer', async () => {
    vi.mocked(loadListingOwners).mockResolvedValue('not-found');
    await expect(OwnersPage({ params })).rejects.toThrow('not found');
    expect(notFound).toHaveBeenCalled();
    vi.mocked(loadListingOwners).mockResolvedValue('unavailable');
    await renderInOwnerArea(await OwnersPage({ params }));
    expect(screen.getByRole('heading', { level: 1, name: 'Owners' })).toBeVisible();
    expect(screen.getByText(/Something went wrong/)).toBeVisible();
  });
});

describe('the invite page', () => {
  const params = Promise.resolve({ locale: 'en' });

  it('asks someone signed out to sign in or sign up, and comes back here after', async () => {
    vi.mocked(getLayoutSession).mockResolvedValue(null);
    await expect(inviteMetadata({ params })).resolves.toEqual({
      title: 'Invitation to a listing',
    });
    const { container } = await renderInOwnerArea(await InvitePage({ params }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Invitation to a listing' }),
    ).toBeVisible();
    expect(screen.getByText(/Sign in, or create an account, with the email address/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/en/sign-in?next=%2Fowner%2Finvite',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/en/sign-up?next=%2Fowner%2Finvite',
    );
    await expectNoAxeViolations(container);
  });

  it('reads the invitation for someone signed in', async () => {
    vi.mocked(getLayoutSession).mockResolvedValue({ user: { id: 'u' } } as never);
    window.history.replaceState(null, '', `/en/owner/invite#${'A'.repeat(43)}`);
    await renderInOwnerArea(await InvitePage({ params }));
    expect(screen.getByRole('status')).toHaveTextContent('Reading the invitation…');
    window.history.replaceState(null, '', '/');
  });
});
