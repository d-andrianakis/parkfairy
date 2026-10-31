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

  it('keeps a reset link working in the other language', () => {
    // Without its token the page could only say the link is dead, which would be untrue.
    setPathname('/reset-password', 'token=abc&utm=x');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/reset-password?token=abc',
    );
  });

  it('keeps the outcome of a reset in the other language', () => {
    setPathname('/reset-password', 'done=1');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/reset-password?done=1',
    );
  });

  it.each(['/sign-up', '/forgot-password', '/verify-email'])(
    'keeps the check-your-inbox panel of %s in the other language',
    (page) => {
      setPathname(page, 'sent=1');
      renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
      expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
        'href',
        `/en${page}?sent=1`,
      );
    },
  );

  it('carries the panel mark only on the pages that have the panel', () => {
    setPathname('/sign-in', 'sent=1');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/en/sign-in');
  });

  it('keeps a confirmation link working in the other language', () => {
    setPathname('/verify-email', 'token=abc&utm=x');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/verify-email?token=abc',
    );
  });

  it('carries a token only on the page that uses it', () => {
    setPathname('/sign-in', 'token=abc');
    renderInSubtree(<LocaleSwitcher signedIn={false} />, { locale: 'el' });
    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute('href', '/en/sign-in');
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
