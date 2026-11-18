import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { SecurityBadges, SpaceLimits } from './feature-badges';

describe('SecurityBadges', () => {
  it('names the list and each thing the listing offers, in either language', async () => {
    const { container } = renderWithProviders(<SecurityBadges security={['cctv', 'gated']} />);
    const list = screen.getByRole('list', { name: 'Security' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['CCTV', 'Gated entry']);
    await expectNoAxeViolations(container);
  });

  it('says it in Greek', () => {
    renderWithProviders(<SecurityBadges security={['lit']} />, { locale: 'el' });
    expect(screen.getByRole('list', { name: 'Ασφάλεια' })).toHaveTextContent('Φωτισμός τη νύχτα');
  });

  it('shows nothing for a listing that offers none', () => {
    const { container } = renderWithProviders(<SecurityBadges security={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('can go without its own name inside a description, as the features do', () => {
    renderWithProviders(<SecurityBadges security={['lit']} named={false} />);
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-label');
  });
});

describe('SpaceLimits', () => {
  it('reads each limit the owner gave, in centimetres, and no other', async () => {
    const { container } = renderWithProviders(
      <SpaceLimits maxHeightCm={190} maxLengthCm={null} maxWidthCm={210} />,
    );
    const list = screen.getByRole('list', { name: 'Largest vehicle it takes' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Vehicles up to 190 cm high', 'Vehicles up to 210 cm wide']);
    await expectNoAxeViolations(container);
  });

  it('says it in Greek', () => {
    renderWithProviders(<SpaceLimits maxHeightCm={190} maxLengthCm={480} maxWidthCm={null} />, {
      locale: 'el',
    });
    const list = screen.getByRole('list', { name: 'Μέγιστο μέγεθος οχήματος' });
    expect(list).toHaveTextContent('Ύψος οχήματος έως 190 εκ.');
    expect(list).toHaveTextContent('Μήκος οχήματος έως 480 εκ.');
  });

  it('shows nothing where the owner gave no limit: not a promise that any size fits', () => {
    const { container } = renderWithProviders(
      <SpaceLimits maxHeightCm={null} maxLengthCm={null} maxWidthCm={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('data from before 5A.1 (a cached list, or a deploy half done)', () => {
  it('shows no security rather than failing, when a listing has none to give', () => {
    const { container } = renderWithProviders(<SecurityBadges security={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no limits rather than failing, when a space has none to give', () => {
    const { container } = renderWithProviders(<SpaceLimits />);
    expect(container).toBeEmptyDOMElement();
  });
});
