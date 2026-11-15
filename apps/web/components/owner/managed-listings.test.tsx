import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ManagedListings } from './managed-listings';

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const OTHER = '8a2a4b63-7b4a-4b4a-8d1c-1b2c3d4e5f60';
const listings = [
  { id: ID, name: 'Γκαράζ Ερμού', contentLocale: 'el' as const },
  { id: OTHER, name: null, contentLocale: 'en' as const },
];

describe('ManagedListings', () => {
  it('shows nothing to someone who manages nothing', () => {
    const { container } = renderWithProviders(<ManagedListings listings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gives each listing three ways in, the calendar filtered to it', async () => {
    const { container } = renderWithProviders(<ManagedListings listings={listings} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Listings you manage' })).toBeVisible();
    const links = within(screen.getByRole('list', { name: 'Γκαράζ Ερμού' }));
    expect(links.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      `/en/owner/calendar?listing=${ID}`,
    );
    expect(links.getByRole('link', { name: 'Bookings' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${ID}/bookings`,
    );
    expect(links.getByRole('link', { name: 'Closures and special hours' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${ID}/closures`,
    );
    // The name in the language it was written in, and a listing without one called what it is.
    expect(
      screen.getByText('Γκαράζ Ερμού', { selector: 'span, h3' }).closest('[lang]'),
    ).toHaveAttribute('lang', 'el');
    expect(screen.getByRole('list', { name: 'Unnamed listing' })).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('says it in Greek', () => {
    renderWithProviders(<ManagedListings listings={listings} />, { locale: 'el' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Χώροι που διαχειρίζεστε' }),
    ).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Ημερολόγιο' })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Χώρος χωρίς όνομα' })).toBeVisible();
  });
});
