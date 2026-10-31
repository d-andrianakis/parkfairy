import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { catalogs, rendererFor } from '@/test/render';
import { SignOutButton } from './sign-out-button';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);

vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

describe('SignOutButton', () => {
  beforeEach(() => {
    vi.mocked(authClient.signOut).mockReset();
    vi.mocked(authClient.signOut).mockResolvedValue({ data: { success: true } } as never);
    routerMock.replace.mockReset();
  });

  it('leaves nothing of the visitor in this tab', async () => {
    sessionStorage.setItem('parkfairy.sent-to:/sign-up', 'maria@example.gr');
    const queries = new QueryClient();
    queries.setQueryData(['me'], { id: 'u' });
    renderInSubtree(
      <QueryClientProvider client={queries}>
        <SignOutButton />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('parkfairy.sent-to:/sign-up')).toBeNull();
    expect(queries.getQueryData(['me'])).toBeUndefined();
  });

  it('clears this tab even when the server reports an error', async () => {
    sessionStorage.setItem('parkfairy.sent-to:/sign-up', 'maria@example.gr');
    vi.mocked(authClient.signOut).mockResolvedValue({
      data: null,
      error: { status: 500 },
    } as never);
    renderInSubtree(<SignOutButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('parkfairy.sent-to:/sign-up')).toBeNull();
  });

  it('shows it is working and cannot be pressed twice', async () => {
    let finish = () => {};
    vi.mocked(authClient.signOut).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { success: true } } as never);
        }),
    );
    renderInSubtree(<SignOutButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Signing out…' })).toBeDisabled();
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
    expect(authClient.signOut).toHaveBeenCalledOnce();
  });

  it('speaks Greek and has no accessibility violations', async () => {
    const { container } = renderInSubtree(<SignOutButton />, { locale: 'el' });
    expect(screen.getByRole('button', { name: catalogs.el.Account.signOut })).toBeEnabled();
    await expectNoAxeViolations(container);
  });
});
