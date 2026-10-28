import type { MeResponse } from '@parkfairy/api-client';
import { DEFAULT_TIME_ZONE } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ApiIdentity } from './api-identity';

const me: MeResponse = {
  id: '6eae16ad-2ef5-451c-a2b8-301747d83f7e',
  email: 'maria@example.gr',
  name: 'Maria',
  role: 'user',
  locale: 'en',
  emailVerified: false,
  twoFactorEnabled: false,
  createdAt: '2026-10-28T23:30:00.000Z',
};

const queryFn = vi.fn<() => Promise<MeResponse>>();
vi.mock('@parkfairy/api-client/react-query', () => ({
  getMeOptions: () => ({ queryKey: ['getMe'], queryFn }),
}));

describe('ApiIdentity', () => {
  it('announces that it is checking the session', () => {
    queryFn.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ApiIdentity />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session with the API');
  });

  it('shows the API-verified identity formatted for the reader’s locale and time zone', async () => {
    queryFn.mockResolvedValue(me);
    const { container } = renderWithProviders(<ApiIdentity />, { locale: 'el' });

    expect(await screen.findByTestId('api-user-id')).toHaveTextContent(me.id);
    expect(screen.getByText('Μέλος')).toBeInTheDocument();
    expect(screen.getByText('Ανενεργός')).toBeInTheDocument();
    // The account's language is named in that language and marked up as such.
    expect(screen.getByTestId('api-user-locale')).toHaveTextContent('English');
    expect(screen.getByTestId('api-user-locale')).toHaveAttribute('lang', 'en');
    // 23:30 UTC on 28 Oct is already 29 Oct in Athens.
    const expectedDate = new Intl.DateTimeFormat('el', {
      dateStyle: 'long',
      timeZone: DEFAULT_TIME_ZONE,
    }).format(new Date(me.createdAt));
    expect(expectedDate).toContain('29');
    expect(screen.getByText(expectedDate)).toHaveAttribute('datetime', me.createdAt);
    await expectNoAxeViolations(container);
  });

  it('reports when the API rejects the session', async () => {
    queryFn.mockRejectedValue({ statusCode: 401 });
    renderWithProviders(<ApiIdentity />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The API could not verify your session.',
    );
  });
});
