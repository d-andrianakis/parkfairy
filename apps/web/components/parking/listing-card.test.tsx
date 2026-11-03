import type { ParkingListingSummary, ParkingSearchResult } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ListingCard } from './listing-card';

const listing: ParkingListingSummary = {
  slug: 'syntagma-square-garage',
  name: 'Γκαράζ Πλατείας Συντάγματος',
  address: 'Όθωνος 10, Αθήνα 105 57',
  area: 'syntagma',
  contentLocale: 'el',
  hourlyRate: { amountMinor: 350, currency: 'EUR' },
  dailyMax: { amountMinor: 2500, currency: 'EUR' },
  features: ['covered', 'evCharging'],
  spaceCount: 12,
  spacePricesVary: false,
  coverPhoto: null,
};

const result: ParkingSearchResult = {
  ...listing,
  distanceMeters: 86,
  freeSpaces: 1,
  total: { amountMinor: 1050, currency: 'EUR' },
};

describe('ListingCard', () => {
  it('leaves the cover photo out of what a screen reader hears', () => {
    const photo = { key: 'a'.repeat(32), width: 1600, height: 1067, alt: 'x', color: '#112233' };
    const { container } = renderWithProviders(
      <ListingCard listing={{ ...listing, coverPhoto: photo }} />,
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('reads “from” when spaces cost different amounts', () => {
    renderWithProviders(<ListingCard listing={{ ...result, spacePricesVary: true }} />);
    expect(screen.getByText(/From €3\.50 an hour/)).toBeInTheDocument();
    expect(screen.getByText('Total from')).toBeInTheDocument();
  });

  it('links to the listing and marks the owner’s Greek text as Greek', async () => {
    const { container } = renderWithProviders(<ListingCard listing={listing} />);
    const link = screen.getByRole('link', { name: listing.name });
    expect(link).toHaveAttribute('href', '/en/parking/syntagma-square-garage');
    expect(screen.getByRole('heading', { level: 3, name: listing.name })).toHaveAttribute(
      'lang',
      'el',
    );
    expect(screen.getByText(listing.address)).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
  });

  it('summarises area, features, spaces and the hourly price', () => {
    renderWithProviders(<ListingCard listing={listing} />);
    expect(screen.getByText('Syntagma')).toBeInTheDocument();
    const features = screen.getByRole('list', { name: 'Features' });
    expect(
      within(features)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Covered', 'EV charging']);
    expect(screen.getByText(/12 spaces/)).toHaveTextContent('€3.50 per hour');
  });

  it('shows distance, free spaces and the total for a search result, in Greek', () => {
    renderWithProviders(
      <ListingCard
        listing={result}
        query={{
          startDate: '2026-11-02',
          startTime: '09:00',
          endDate: '2026-11-02',
          endTime: '12:00',
        }}
      />,
      { locale: 'el' },
    );
    // 86 m: metres (to 10 m) under a kilometre, not "0,1 χλμ.".
    expect(screen.getByText('σε απόσταση 90 μ.')).toBeInTheDocument();
    expect(screen.getByText(/1 ελεύθερη θέση/)).toBeInTheDocument();
    expect(screen.getByText('Σύνολο').nextSibling).toHaveTextContent('10,50 €');
    expect(screen.getByRole('link', { name: listing.name })).toHaveAttribute(
      'href',
      '/en/parking/syntagma-square-garage?startDate=2026-11-02&startTime=09%3A00&endDate=2026-11-02&endTime=12%3A00',
    );
  });

  it('rounds before choosing the unit: 996 m is 1 km, not 1.000 m', () => {
    renderWithProviders(<ListingCard listing={{ ...result, distanceMeters: 996 }} />, {
      locale: 'el',
    });
    expect(screen.getByText('σε απόσταση 1 χλμ.')).toBeInTheDocument();
  });
});
