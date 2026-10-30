import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { setPathname } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { LocaleSwitcher } from './locale-switcher';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.root);

vi.mock('@/lib/auth-client', () => ({ authClient: { updateUser: vi.fn() } }));

const updateUser = vi.mocked(authClient.updateUser);

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    setPathname('/sign-in');
    updateUser.mockReset();
  });

  it('offers each language by its own name, on the same page', async () => {
    const { container } = renderInSubtree(<LocaleSwitcher signedIn={false} />, {
      locale: 'el',
    });

    expect(screen.getByRole('navigation', { name: 'Γλώσσα' })).toBeInTheDocument();
    const greek = screen.getByRole('link', { name: 'Ελληνικά' });
    const english = screen.getByRole('link', { name: 'English' });
    expect(english).toHaveAttribute('href', '/en/sign-in');
    expect(english).toHaveAttribute('hreflang', 'en');
    expect(english).toHaveAttribute('lang', 'en');
    expect(greek).toHaveAttribute('aria-current', 'true');
    expect(english).not.toHaveAttribute('aria-current');
    await expectNoAxeViolations(container);
  });

  it('keeps the search and stay window when switching language', () => {
    setPathname('/search', 'area=syntagma&startDate=2026-11-02&startTime=09%3A00');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/search?area=syntagma&startDate=2026-11-02&startTime=09%3A00',
    );
  });

  it('drops query parameters that are not part of a search (tokens and the like)', () => {
    setPathname('/search', 'area=syntagma&token=secret&next=%2Faccount');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/search?area=syntagma&next=%2Faccount',
    );
  });

  it('remembers the choice on the account when signed in', async () => {
    renderInSubtree(<LocaleSwitcher signedIn />, { locale: 'el' });

    await userEvent.click(screen.getByRole('link', { name: 'English' }));
    // The auth client is loaded on demand, so the call lands a moment later.
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ locale: 'en' }));
  });

  it('does not call the API for anonymous visitors or the current language', async () => {
    const { unmount } = renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    await userEvent.click(screen.getByRole('link', { name: 'English' }));
    unmount();

    renderInSubtree(<LocaleSwitcher signedIn />, { locale: 'el' });
    await userEvent.click(screen.getByRole('link', { name: 'Ελληνικά' }));

    await vi.dynamicImportSettled(); // any lazy auth-client load would have finished
    expect(updateUser).not.toHaveBeenCalled();
  });
});
