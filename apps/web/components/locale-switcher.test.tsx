import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { setPathname } from '@/test/navigation-mock';
import { renderWithProviders } from '@/test/render';
import { LocaleSwitcher } from './locale-switcher';

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: vi.fn(), updateUser: vi.fn() },
}));

const useSession = vi.mocked(authClient.useSession);
const updateUser = vi.mocked(authClient.updateUser);

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    setPathname('/sign-in');
    useSession.mockReturnValue({ data: null } as ReturnType<typeof authClient.useSession>);
    updateUser.mockReset();
  });

  it('offers each language by its own name, on the same page', async () => {
    const { container } = renderWithProviders(<LocaleSwitcher />, { locale: 'el' });

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

  it('remembers the choice on the account when signed in', async () => {
    useSession.mockReturnValue({ data: { user: {} } } as ReturnType<typeof authClient.useSession>);
    renderWithProviders(<LocaleSwitcher />, { locale: 'el' });

    await userEvent.click(screen.getByRole('link', { name: 'English' }));
    expect(updateUser).toHaveBeenCalledWith({ locale: 'en' });
  });

  it('does not call the API for anonymous visitors or the current language', async () => {
    renderWithProviders(<LocaleSwitcher />, { locale: 'el' });
    await userEvent.click(screen.getByRole('link', { name: 'English' }));

    useSession.mockReturnValue({ data: { user: {} } } as ReturnType<typeof authClient.useSession>);
    await userEvent.click(screen.getByRole('link', { name: 'Ελληνικά' }));

    expect(updateUser).not.toHaveBeenCalled();
  });
});
