import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { routerMock, setPathname } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';

import { SiteHeader } from './site-header';

// The header itself is a server component, so it also reads the layout's own words.
const renderInSubtree = rendererFor([...CLIENT_NAMESPACES.root, 'Layout']);

vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));
const signOut = vi.mocked(authClient.signOut);

beforeEach(() => {
  signOut.mockReset();
  setPathname('/listings');
});

describe('the staff header', () => {
  it('offers staff the two screens, marking the one they are on', async () => {
    const { container } = renderInSubtree(<SiteHeader signedIn staff />);
    const nav = screen.getByRole('navigation', { name: 'Staff' });
    expect(within(nav).getByRole('link', { name: 'Listings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Audit log' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('marks a listing’s review as being under Listings', () => {
    setPathname('/listings/7f1f3a52');
    renderInSubtree(<SiteHeader signedIn staff />);
    expect(screen.getByRole('link', { name: 'Listings' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows no staff links to anyone who is not staff, but lets them leave', () => {
    renderInSubtree(<SiteHeader signedIn staff={false} />);
    expect(screen.queryByRole('navigation', { name: 'Staff' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows nothing but the brand and the languages when signed out', () => {
    renderInSubtree(<SiteHeader signedIn={false} staff={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'Parkfairy staff' })).toHaveAttribute(
      'href',
      '/en/sign-in',
    );
  });

  it('offers each language by its own name, on the same page and with the same query', () => {
    setPathname('/audit', 'action=listing.approved');
    renderInSubtree(<SiteHeader signedIn staff />, { locale: 'el' });
    const english = screen.getByRole('link', { name: 'English' });
    expect(english).toHaveAttribute('href', '/en/audit?action=listing.approved');
    expect(english).toHaveAttribute('hreflang', 'en');
    expect(english).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('link', { name: 'Ελληνικά' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'Γλώσσα' })).toBeInTheDocument();
  });

  it('signs out, then goes to sign-in even if the call failed', async () => {
    signOut.mockRejectedValue(new Error('network'));
    renderInSubtree(<SiteHeader signedIn staff />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/sign-in'));
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('ignores a second press while signing out', async () => {
    let finish: () => void = () => undefined;
    signOut.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)) as never);
    renderInSubtree(<SiteHeader signedIn staff />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Signing out…' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
  });
});
