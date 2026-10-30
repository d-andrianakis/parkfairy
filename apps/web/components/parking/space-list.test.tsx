import { LISTING_SPACES_LIMIT } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SpaceList } from './space-list';

const spaces = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ label: `P${i + 1}`, features: [] }));

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
        }}
      />
    </>,
    { locale },
  );
}

describe('SpaceList', () => {
  it('names the spaces in the owner’s language', async () => {
    const { container } = renderList(2);
    expect(screen.getByRole('list', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('P1')).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
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
