import { LISTING_SPACES_LIMIT } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { SpaceList } from './space-list';

const spaces = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    label: `P${i + 1}`,
    features: [],
    maxHeightCm: null,
    maxLengthCm: null,
    maxWidthCm: null,
    hourlyRate: { amountMinor: 300, currency: 'EUR' as const },
    total: null,
  }));

function renderList(spaceCount: number, locale: 'el' | 'en' = 'en') {
  return renderWithProviders(
    <>
      <h2 id="spaces">Spaces</h2>
      <SpaceList
        labelledBy="spaces"
        listing={{
          spaces: spaces(Math.min(spaceCount, LISTING_SPACES_LIMIT)),
          spaceCount,
          contentLocale: 'el',
          spacePricesVary: false,
        }}
      />
    </>,
    { locale },
  );
}

describe('limits (5A.1)', () => {
  it('shows the limits an owner gave, and nothing for a space that has none', () => {
    const [first, second] = spaces(2);
    renderWithProviders(
      <SpaceList
        labelledBy="spaces"
        listing={{
          spaces: [{ ...first!, maxHeightCm: 190, maxWidthCm: 210 }, second!],
          spaceCount: 2,
          contentLocale: 'el',
          spacePricesVary: false,
        }}
      />,
    );
    const row = (label: string) => screen.getByText(label).closest('li');
    expect(row('P1')).toHaveTextContent('Vehicles up to 190 cm high');
    expect(row('P1')).toHaveTextContent('Vehicles up to 210 cm wide');
    expect(row('P2')).not.toHaveTextContent('cm');
  });
});

describe('SpaceList', () => {
  it('counts only free spaces past those shown when a stay was asked about', () => {
    renderWithProviders(
      <SpaceList
        labelledBy="x"
        freeSpaces={LISTING_SPACES_LIMIT + 2}
        listing={{
          spaces: spaces(LISTING_SPACES_LIMIT),
          spaceCount: 300,
          contentLocale: 'el',
          spacePricesVary: false,
        }}
      />,
    );
    expect(screen.getByText('and 2 more free spaces')).toBeInTheDocument();
  });

  it('shows no empty list when nothing is free', () => {
    renderWithProviders(
      <SpaceList
        labelledBy="x"
        freeSpaces={0}
        listing={{ spaces: [], spaceCount: 3, contentLocale: 'el', spacePricesVary: false }}
      />,
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('shows each space’s price and total only where they differ', () => {
    const total = { amountMinor: 700, currency: 'EUR' as const };
    const priced = spaces(1).map((space) => ({ ...space, total }));
    const list = (spacePricesVary: boolean) => (
      <SpaceList
        labelledBy="x"
        listing={{ spaces: priced, spaceCount: 1, contentLocale: 'el', spacePricesVary }}
      />
    );
    const { unmount } = renderWithProviders(list(true));
    expect(screen.getByText('€3.00 an hour · €7.00 for your stay')).toBeInTheDocument();
    unmount();
    renderWithProviders(list(false));
    expect(screen.queryByText(/an hour/)).not.toBeInTheDocument();
  });

  it('names the spaces in the owner’s language', async () => {
    const { container } = renderList(2);
    expect(screen.getByRole('list', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('P1')).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
  });

  it('marks a Greek label in an English listing, and leaves a Latin one', () => {
    renderWithProviders(
      <>
        <h2 id="spaces">Spaces</h2>
        <SpaceList
          labelledBy="spaces"
          listing={{
            spaces: [
              { ...spaces(1)[0]!, label: 'Θέση 1' },
              { ...spaces(2)[1]!, label: 'P2' },
            ],
            spaceCount: 2,
            contentLocale: 'en',
            spacePricesVary: false,
          }}
        />
      </>,
    );
    // The number after the space is the same in both languages, and stays with the label.
    const greek = screen.getByText('Θέση');
    expect(greek).toHaveAttribute('lang', 'el');
    expect(greek.parentElement).toHaveAttribute('lang', 'en');
    expect(greek.parentElement).toHaveTextContent(/^Θέση 1$/);
    expect(screen.getByText('P2')).toHaveAttribute('lang', 'en');
  });

  it('says how many more a big garage has, in the page language', () => {
    renderList(LISTING_SPACES_LIMIT + 3, 'el');
    expect(screen.getAllByRole('listitem')).toHaveLength(LISTING_SPACES_LIMIT);
    expect(screen.getByText('και 3 ακόμη θέσεις')).toBeInTheDocument();
  });

  it('uses the singular for one more', () => {
    renderList(LISTING_SPACES_LIMIT + 1);
    expect(screen.getByText('and 1 more space')).toBeInTheDocument();
  });

  it('says nothing more at exactly the limit', () => {
    renderList(LISTING_SPACES_LIMIT);
    expect(screen.queryByText(/more space/)).toBeNull();
  });
});
