import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SearchLink } from './search-link';

const press = (link: HTMLElement) => {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  return click;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SearchLink', () => {
  it('loads the search page itself where it can show a map, under its own policy (#41)', () => {
    vi.stubEnv('MAPBOX_PUBLIC_TOKEN', 'pk.test');
    renderWithProviders(<SearchLink query={{ area: 'koukaki' }}>Koukaki</SearchLink>, {
      locale: 'el',
    });
    const link = screen.getByRole('link', { name: 'Koukaki' });
    expect(link).toHaveAttribute('href', '/el/search?area=koukaki');
    // Nothing intercepts the press: no client navigation keeps the page it came from.
    expect(press(link).defaultPrevented).toBe(false);
  });

  it('navigates on the client where there is no map to allow, quicker and prefetched', () => {
    vi.stubEnv('MAPBOX_PUBLIC_TOKEN', '');
    renderWithProviders(<SearchLink query={{ area: 'koukaki' }}>Koukaki</SearchLink>);
    const link = screen.getByRole('link', { name: 'Koukaki' });
    expect(link).toHaveAttribute('href', '/en/search?area=koukaki');
    // The router's Link (a stand-in here, which keeps the press on the page).
    expect(press(link).defaultPrevented).toBe(true);
  });
});
