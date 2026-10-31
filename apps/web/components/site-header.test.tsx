import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SiteHeader } from './site-header';

describe('SiteHeader', () => {
  it('offers sign-in, sign-up, language and theme to anonymous visitors', async () => {
    const { container } = renderWithProviders(<SiteHeader theme="system" signedIn={false} />, {
      locale: 'el',
    });

    const account = screen.getByRole('navigation', { name: 'Λογαριασμός' });
    expect(within(account).getByRole('link', { name: 'Σύνδεση' })).toHaveAttribute(
      'href',
      '/en/sign-in',
    );
    expect(
      within(account).getByRole('link', { name: 'Δημιουργία λογαριασμού' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Γλώσσα' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Εμφάνιση' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Αρχική σελίδα Parkfairy' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('links signed-in readers to their account', () => {
    renderWithProviders(<SiteHeader theme="system" signedIn />);

    const account = screen.getByRole('navigation', { name: 'Account' });
    expect(within(account).getAllByRole('link')).toHaveLength(1);
    expect(within(account).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/en/account',
    );
  });
});
